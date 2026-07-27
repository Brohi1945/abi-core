// Phase 2 safety layer. Pehle confirm sirf system-prompt ka instruction
// tha — model ke "sahi samajhne" par depend karta tha. Ab risky tools
// (jaise delete_product) seedha execute nahi hotay: pehle "propose"
// karte hain (DB mein ek pending row + product/order ka preview), aur
// asal execution sirf `confirm_pending_action` tool se hoti hai — jo
// yahan check karta hai ke: (a) row abhi bhi status='pending' hai,
// (b) expire nahi hui, (c) wahi actor hai jisne propose kiya tha.
// Is se ek cheez guarantee hoti hai: chahay model kabhi confuse ho ke
// user ne confirm kiya ya nahi, asal delete/write sirf tab hoga jab
// ek REAL pending row exist karti ho — sirf model ka "maan lo confirm
// ho gaya" kaafi nahi hai.
import { supabaseServer } from "./supabaseServer.js";
import type { ToolContext } from "./toolRegistry.js";

const DEFAULT_TTL_MINUTES = 10;

export async function proposeAction(
  toolName: string,
  args: Record<string, unknown>,
  preview: unknown,
  ctx: ToolContext
): Promise<{ requires_confirmation: true; pending_action_id: string; preview: unknown; expires_in_minutes: number }> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("abi_pending_actions")
    .insert({
      actor_id: ctx.userId,
      actor_role: ctx.role,
      source_app: ctx.sourceApp,
      tool_name: toolName,
      tool_args: args,
      preview,
      expires_at: new Date(Date.now() + DEFAULT_TTL_MINUTES * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create pending action: ${error.message}`);

  return {
    requires_confirmation: true,
    pending_action_id: data.id,
    preview,
    expires_in_minutes: DEFAULT_TTL_MINUTES,
  };
}

/**
 * confirm_pending_action tool ka execute() yahan se call hota hai.
 * getToolByName import yahan nahi hota (circular import se bachne ke
 * liye) — caller (toolRegistry.ts) apna executor function pass karta hai.
 */
export async function resolvePendingAction(
  pendingActionId: string,
  ctx: ToolContext,
  executeUnderlyingTool: (toolName: string, args: any, ctx: ToolContext) => Promise<unknown>
): Promise<unknown> {
  const supabase = supabaseServer();

  const { data: pending, error } = await supabase
    .from("abi_pending_actions")
    .select("*")
    .eq("id", pendingActionId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!pending) return { error: "Pending action not found. Shayad expire ho gayi ya galat id hai." };
  if (pending.actor_id !== ctx.userId) {
    return { error: "Yeh pending action aapki nahi hai." };
  }
  if (pending.status !== "pending") {
    return { error: `Yeh action already '${pending.status}' hai, dobara confirm nahi ho sakti.` };
  }
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    await supabase.from("abi_pending_actions").update({ status: "expired" }).eq("id", pendingActionId);
    return { error: "Yeh confirmation expire ho chuki hai (10 min limit) — dobara request karein." };
  }

  const result = await executeUnderlyingTool(pending.tool_name, pending.tool_args, ctx);

  await supabase
    .from("abi_pending_actions")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", pendingActionId);

  return { confirmed: true, tool_name: pending.tool_name, result };
}
