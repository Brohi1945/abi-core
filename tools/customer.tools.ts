// Customer-facing tools — Phase 2. Yeh ABI ka "sales assistant" side
// hai. Scope jaan-boojh kar bohot tang rakha gaya hai: koi bhi tool
// jo doosre customer ka data dikha sakay ya inventory/pricing badal
// sakay, yahan NAHI hai. ctx.userId (= abos_chat_profiles.id = auth.uid())
// har query mein ownership filter ke tor par use hota hai.
import type { ToolModule } from "../lib/toolRegistry.js";
import { supabaseServer } from "../lib/supabaseServer.js";

const browseProducts: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "browse_products",
      description: "Search available products by name or category. Only shows customer-safe fields (no cost/margin).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Product name or category keyword, partial match." },
        },
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    let query = supabase
      .from("products")
      .select("id, name, category, price, stock, specs")
      .gt("stock", 0)
      .limit(15);
    if (args?.query) {
      query = query.or(`name.ilike.%${args.query}%,category.ilike.%${args.query}%`);
    }
    const { data, error } = await query;
    if (error) return { error: error.message };
    return data;
  },
};

const getMyOrders: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "get_my_orders",
      description: "Get the authenticated customer's own past/current orders and their status. Never returns other customers' orders.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status, if given." },
        },
      },
    },
  },
  execute: async (args, ctx) => {
    const supabase = supabaseServer();
    let query = supabase
      .from("orders")
      .select("id, items, total, status, payment_status, created_at")
      .eq("customer_profile_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (args?.status) query = query.eq("status", args.status);

    const { data, error } = await query;
    if (error) return { error: error.message };
    if (!data?.length) {
      return {
        orders: [],
        note: "Koi linked order nahi mila. Note: sirf woh orders jo aapne is AI assistant/apne account se place kiye hon link hote hain — purane orders jo phone/walk-in se hue thay unka record account se link nahi hai.",
      };
    }
    return data;
  },
};

const placeOrder: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "place_order",
      description:
        "Place a new order for the authenticated customer. Use browse_products first to resolve product names to ids and confirm stock. Always read back the items and total to the customer before calling this, in your reply — the order itself is created immediately (status: pending, unpaid) since it isn't destructive and can be cancelled.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product_id: { type: "string" },
                qty: { type: "number" },
              },
              required: ["product_id", "qty"],
            },
          },
          address: { type: "string", description: "Delivery address, if given." },
        },
        required: ["items"],
      },
    },
  },
  execute: async (args, ctx) => {
    const supabase = supabaseServer();
    const items = Array.isArray(args?.items) ? args.items : [];
    if (!items.length) return { error: "At least one item is required." };

    const ids = items.map((it: any) => it.product_id);
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, name, price, stock")
      .in("id", ids);
    if (prodErr) return { error: prodErr.message };

    const lines: { productId: string; name: string; qty: number }[] = [];
    for (const it of items) {
      const product = (products || []).find((p: any) => p.id === it.product_id);
      if (!product) return { error: `Product not found: ${it.product_id}` };
      const qty = Number(it.qty) || 1;
      if (product.stock < qty) {
        return { error: `Not enough stock for ${product.name} (have ${product.stock}, need ${qty})` };
      }
      lines.push({ productId: product.id, name: product.name, qty });
    }

    const total = lines.reduce((sum, line) => {
      const product = products!.find((p: any) => p.id === line.productId)!;
      return sum + product.price * line.qty;
    }, 0);

    // Customer profile se naam/contact khud utha rahe hain — customer
    // ke bhejay hue arbitrary "customer name" par bharosa nahi karte,
    // is se koi apna order kisi aur ke naam se nahi bana sakta.
    const { data: profile } = await supabase
      .from("abos_chat_profiles")
      .select("name, customer_number")
      .eq("id", ctx.userId)
      .maybeSingle();

    const newOrder = {
      id: `ORD-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      customer: profile?.name || profile?.customer_number || "Customer",
      customer_profile_id: ctx.userId,
      items: lines,
      total,
      status: "pending",
      payment_status: "unpaid",
      date: new Date().toLocaleString(),
      address: args?.address || null,
      channel: "AI Assistant (Customer)",
    };

    const { data, error } = await supabase.from("orders").insert(newOrder).select().single();
    if (error) return { error: error.message };

    for (const line of lines) {
      const product = products!.find((p: any) => p.id === line.productId)!;
      await supabase.from("products").update({ stock: product.stock - line.qty }).eq("id", line.productId);
    }

    return { created: data };
  },
};

const escalateToHuman: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "escalate_to_human",
      description:
        "Hand the conversation off to a human owner/agent — use when the customer explicitly asks for a person, or seems frustrated/stuck, or the request is outside what you can safely handle.",
      parameters: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "The abos-chat conversation id, if known." },
          reason: { type: "string" },
        },
      },
    },
  },
  execute: async (args, ctx) => {
    if (!args?.conversation_id) {
      return { escalated: false, note: "conversation_id nahi mila — customer ko bata do ke wo owner ko seedha chat/call kar len." };
    }
    const supabase = supabaseServer();
    const { data: convo } = await supabase
      .from("abos_chat_conversations")
      .select("id, customer_id, tags")
      .eq("id", args.conversation_id)
      .maybeSingle();

    if (!convo || convo.customer_id !== ctx.userId) {
      return { error: "Conversation not found or not yours." };
    }

    const tags = Array.isArray(convo.tags) ? convo.tags : [];
    const { error } = await supabase
      .from("abos_chat_conversations")
      .update({ ai_mode: false, tags: [...new Set([...tags, "needs_human"])] })
      .eq("id", args.conversation_id);
    if (error) return { error: error.message };

    return { escalated: true };
  },
};

export const customerTools: ToolModule[] = [browseProducts, getMyOrders, placeOrder, escalateToHuman];
