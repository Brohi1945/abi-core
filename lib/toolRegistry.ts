// Central registry — har domain (inventory, orders, reports, chat,
// waghera) apna tool module yahan register karta hai. Naya project
// apni tools file tools/ mein banaye aur ek line yahan add karay —
// is se zyada core mein kuch nahi badalna parta.
//
// Har tool module ek array export karta hai jis mein { definition,
// execute } objects hotay hain — definition Groq ko bheji jati hai,
// execute() actual DB read/write karta hai.

import type { GroqTool } from "./groqClient.js";
import { inventoryTools, executeDeleteProduct } from "../tools/inventory.tools.js";
import { orderTools } from "../tools/orders.tools.js";
import { reportTools } from "../tools/reports.tools.js";
import { chatTools } from "../tools/chat.tools.js";
import { salesTools } from "../tools/sales.tools.js";
import { customerTools } from "../tools/customer.tools.js";
import { resolvePendingAction } from "./pendingActions.js";

export type ToolModule = {
  definition: GroqTool;
  execute: (args: any, ctx: ToolContext) => Promise<unknown>;
};

export type ToolContext = {
  userId: string;
  role: "owner" | "agent" | "customer";
  sourceApp: string;
};

// ---- Confirm-flow (Phase 2) ---------------------------------------------
// Tools jo pehle "propose" karte hain (delete_product waghera) unki asal
// execution yahan register hoti hai — is map ke bahar model in executors
// ko kabhi seedha nahi bula sakta, sirf confirm_pending_action ke zariye,
// jo lib/pendingActions.ts mein real server-side verification karta hai.
const CONFIRMABLE_EXECUTORS: Record<string, (args: any, ctx: ToolContext) => Promise<unknown>> = {
  delete_product: executeDeleteProduct,
};

const confirmPendingAction: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "confirm_pending_action",
      description:
        "Actually execute a previously-proposed risky action (e.g. delete_product) after the user has explicitly confirmed in their latest message. Requires the pending_action_id that was returned by the proposing tool call.",
      parameters: {
        type: "object",
        properties: {
          pending_action_id: { type: "string" },
        },
        required: ["pending_action_id"],
      },
    },
  },
  execute: async (args, ctx) => {
    if (!args?.pending_action_id) return { error: "pending_action_id is required" };
    return resolvePendingAction(args.pending_action_id, ctx, async (toolName, toolArgs, execCtx) => {
      const fn = CONFIRMABLE_EXECUTORS[toolName];
      if (!fn) return { error: `No confirmable executor registered for tool: ${toolName}` };
      return fn(toolArgs, execCtx);
    });
  },
};

// ---- Admin persona (ABOS-main / abos-chat owner+agent) -------------------
const ADMIN_TOOLS: ToolModule[] = [
  ...inventoryTools,
  ...orderTools,
  ...reportTools,
  ...chatTools,
  ...salesTools,
  confirmPendingAction,
];

export function getToolDefinitions(): GroqTool[] {
  return ADMIN_TOOLS.map((t) => t.definition);
}

export function getToolByName(name: string): ToolModule | undefined {
  return ADMIN_TOOLS.find((t) => t.definition.function.name === name);
}

// ---- Customer persona (abos-chat customer-facing sales assistant) --------
const CUSTOMER_TOOLS: ToolModule[] = [...customerTools, ...salesTools];

export function getCustomerToolDefinitions(): GroqTool[] {
  return CUSTOMER_TOOLS.map((t) => t.definition);
}

export function getCustomerToolByName(name: string): ToolModule | undefined {
  return CUSTOMER_TOOLS.find((t) => t.definition.function.name === name);
}
