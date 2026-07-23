// Central registry — har domain (inventory, orders, reports, chat,
// waghera) apna tool module yahan register karta hai. Naya project
// apni tools file tools/ mein banaye aur ek line yahan add karay —
// is se zyada core mein kuch nahi badalna parta.
//
// Har tool module ek array export karta hai jis mein { definition,
// execute } objects hotay hain — definition Groq ko bheji jati hai,
// execute() actual DB read/write karta hai.

import type { GroqTool } from "./groqClient.js";
import { inventoryTools } from "../tools/inventory.tools.js";
import { orderTools } from "../tools/orders.tools.js";
import { reportTools } from "../tools/reports.tools.js";
import { chatTools } from "../tools/chat.tools.js";
// Naya domain add karna ho, yahan import add karo, jaise:
// import { customerTools } from "../tools/customers.tools.js";

export type ToolModule = {
  definition: GroqTool;
  execute: (args: any, ctx: ToolContext) => Promise<unknown>;
};

export type ToolContext = {
  userId: string;
  role: "owner" | "agent";
  sourceApp: string;
};

const ALL_TOOLS: ToolModule[] = [
  ...inventoryTools,
  ...orderTools,
  ...reportTools,
  ...chatTools,
  // ...customerTools,
];

export function getToolDefinitions(): GroqTool[] {
  return ALL_TOOLS.map((t) => t.definition);
}

export function getToolByName(name: string): ToolModule | undefined {
  return ALL_TOOLS.find((t) => t.definition.function.name === name);
}
