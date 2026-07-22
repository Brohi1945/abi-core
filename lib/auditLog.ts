// Har ABI action ka record — read actions optional, write actions
// hamesha log hoti hain (ABI_ARCHITECTURE_BLUEPRINT.md §6).
import { supabaseServer } from "./supabaseServer.js";

export async function logAction(entry: {
  actorId: string;
  actorRole: string;
  sourceApp: string;
  commandText: string;
  toolName: string;
  toolArgs: unknown;
  toolResult: unknown;
}) {
  const supabase = supabaseServer();
  const { error } = await supabase.from("abi_action_log").insert({
    actor_id: entry.actorId,
    actor_role: entry.actorRole,
    source_app: entry.sourceApp,
    command_text: entry.commandText,
    tool_name: entry.toolName,
    tool_args: entry.toolArgs,
    tool_result: entry.toolResult,
  });
  if (error) {
    // Audit log fail hone se poori request fail nahi honi chahiye —
    // sirf console mein error log karo.
    console.error("abi_action_log insert failed:", error.message);
  }
}
