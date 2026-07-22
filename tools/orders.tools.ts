// Orders domain tools — Phase A (Read-only), ABI_README §3 se.
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

    let query = supabase
      .from("orders")
      .select("id, status, payment_status, total, customer_id, created_at")
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

export const orderTools: ToolModule[] = [getTodaysOrders, getRevenueSummary];
