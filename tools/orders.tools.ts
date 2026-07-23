// Orders domain tools — Phase A (Read) + Phase B (Write), ABI_README §3 se.
import type { ToolModule } from "../lib/toolRegistry.js";
import { supabaseServer } from "../lib/supabaseServer.js";

const getTodaysOrders: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "get_todays_orders",
      description: "Get today's orders, optionally filtered by status (pending, confirmed, delivered, cancelled).",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by order status, if given." },
        },
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // 🐛 FIX: asal orders table mein "customer_id" column nahi hai — customer
    // ka naam seedha "customer" (text) column mein store hota hai. Yeh query
    // pehle Postgres error deti (column customer_id does not exist).
    let query = supabase
      .from("orders")
      .select("id, customer, phone, status, payment_status, total, channel, created_at")
      .gte("created_at", startOfDay.toISOString())
      .order("created_at", { ascending: false });

    if (args?.status) query = query.eq("status", args.status);

    const { data, error } = await query;
    if (error) return { error: error.message };
    return data;
  },
};

const getRevenueSummary: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "get_revenue_summary",
      description: "Get total revenue and order count for today.",
      parameters: { type: "object", properties: {} },
    },
  },
  execute: async () => {
    const supabase = supabaseServer();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("orders")
      .select("total")
      .gte("created_at", startOfDay.toISOString())
      .eq("payment_status", "paid");

    if (error) return { error: error.message };

    const total = (data || []).reduce((sum: number, o: any) => sum + (o.total || 0), 0);
    return { order_count: data?.length || 0, total_revenue: total };
  },
};

// ---- Writes (Phase B) --------------------------------------------------

const updateOrderStatus: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "update_order_status",
      description:
        "Change an order's status (pending, confirmed, delivered, cancelled) and/or payment status (unpaid, paid). Use get_todays_orders first if you need to find the order_id.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          status: { type: "string", description: "One of: pending, confirmed, delivered, cancelled." },
          payment_status: { type: "string", description: "One of: unpaid, paid." },
        },
        required: ["order_id"],
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const fields: Record<string, any> = {};
    if (args?.status) fields.status = args.status;
    if (args?.payment_status) fields.payment_status = args.payment_status;
    if (Object.keys(fields).length === 0) {
      return { error: "Provide status and/or payment_status to update." };
    }

    const { data, error } = await supabase
      .from("orders")
      .update(fields)
      .eq("id", args.order_id)
      .select()
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: `No order found with id ${args.order_id}` };
    return { updated: data };
  },
};

const createOrder: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "create_order",
      description:
        "Manually log a new order — e.g. a phone call or walk-in sale the admin describes out loud. Use find_product first to resolve product names to ids. Stock is validated and decremented automatically.",
      parameters: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Customer name." },
          phone: { type: "string" },
          channel: { type: "string", description: "e.g. Phone, Walk-in, AI Assistant. Defaults to 'AI Assistant'." },
          items: {
            type: "array",
            description: "List of items in the order.",
            items: {
              type: "object",
              properties: {
                product_id: { type: "string" },
                qty: { type: "number" },
              },
              required: ["product_id", "qty"],
            },
          },
        },
        required: ["items"],
      },
    },
  },
  execute: async (args) => {
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

    const newOrder = {
      id: `ORD-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      customer: args.customer || "Walk-in customer",
      phone: args.phone || null,
      items: lines,
      total,
      status: "pending",
      payment_status: "unpaid",
      date: new Date().toLocaleString(),
      channel: args.channel || "AI Assistant",
    };

    const { data, error } = await supabase.from("orders").insert(newOrder).select().single();
    if (error) return { error: error.message };

    // Stock decrement — har line item ke liye alag update (RPC/transaction
    // nahi hai abhi, is liye race-condition ka chhota sa risk hai agar
    // ek hi second mein 2 orders same product ke liye ban rahe hon —
    // chhoti business ke liye phase B mein acceptable).
    for (const line of lines) {
      const product = products!.find((p: any) => p.id === line.productId)!;
      await supabase
        .from("products")
        .update({ stock: product.stock - line.qty })
        .eq("id", line.productId);
    }

    return { created: data };
  },
};

export const orderTools: ToolModule[] = [
  getTodaysOrders,
  getRevenueSummary,
  updateOrderStatus,
  createOrder,
];
