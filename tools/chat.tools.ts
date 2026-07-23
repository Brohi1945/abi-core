// abos-chat visibility tools — ABI admin ke liye customer conversations
// dekh sakta hai (read-only, abhi ke liye). Yeh wahi tables hain jo
// abos-chat app khud use karti hai.
import type { ToolModule } from "../lib/toolRegistry.js";
import { supabaseServer } from "../lib/supabaseServer.js";

const getRecentConversations: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "get_recent_conversations",
      description:
        "Get recent abos-chat customer conversations — customer name/number, last message time, status, and whether AI or a human owner is currently handling it.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max conversations to return. Defaults to 20." },
          status: { type: "string", description: "Filter by conversation status, if given." },
        },
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    let query = supabase
      .from("abos_chat_conversations")
      .select("id, customer_id, last_message_at, status, ai_mode, tags")
      .order("last_message_at", { ascending: false })
      .limit(Number(args?.limit) || 20);

    if (args?.status) query = query.eq("status", args.status);

    const { data: conversations, error } = await query;
    if (error) return { error: error.message };

    const customerIds = [...new Set((conversations || []).map((c: any) => c.customer_id))];
    let profiles: any[] = [];
    if (customerIds.length) {
      const { data } = await supabase
        .from("abos_chat_profiles")
        .select("id, name, customer_number")
        .in("id", customerIds);
      profiles = data || [];
    }

    return (conversations || []).map((c: any) => {
      const profile = profiles.find((p) => p.id === c.customer_id);
      return {
        conversation_id: c.id,
        customer_name: profile?.name || "Unknown",
        customer_number: profile?.customer_number || null,
        last_message_at: c.last_message_at,
        status: c.status,
        ai_mode: c.ai_mode,
        tags: c.tags,
      };
    });
  },
};

const getConversationMessages: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "get_conversation_messages",
      description:
        "Get recent messages from a specific conversation. Use get_recent_conversations or find_customer_chat first to get the conversation_id.",
      parameters: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          limit: { type: "number", description: "Max messages to return. Defaults to 30, most recent." },
        },
        required: ["conversation_id"],
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const { data, error } = await supabase
      .from("abos_chat_messages")
      .select("sender_role, sender_name, is_ai, kind, body, created_at")
      .eq("conversation_id", args.conversation_id)
      .order("created_at", { ascending: false })
      .limit(Number(args?.limit) || 30);
    if (error) return { error: error.message };
    return (data || []).reverse();
  },
};

const findCustomerChat: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "find_customer_chat",
      description: "Find a customer's chat profile by name or phone number, and their most recent conversation.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Customer name or phone number (partial match)." },
        },
        required: ["query"],
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const { data: profiles, error } = await supabase
      .from("abos_chat_profiles")
      .select("id, name, customer_number")
      .or(`name.ilike.%${args.query}%,customer_number.ilike.%${args.query}%`)
      .limit(5);
    if (error) return { error: error.message };
    if (!profiles?.length) return { matches: [] };

    const ids = profiles.map((p: any) => p.id);
    const { data: conversations } = await supabase
      .from("abos_chat_conversations")
      .select("id, customer_id, last_message_at, status, ai_mode")
      .in("customer_id", ids)
      .order("last_message_at", { ascending: false });

    return {
      matches: profiles.map((p: any) => ({
        ...p,
        conversation: (conversations || []).find((c: any) => c.customer_id === p.id) || null,
      })),
    };
  },
};

export const chatTools: ToolModule[] = [getRecentConversations, getConversationMessages, findCustomerChat];
