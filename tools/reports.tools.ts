// Reports / accounting / "data analyst" tools — ABI_README §3 se.
// Important caveats jo tool descriptions mein bhi hain:
//   - orders.items mein price save nahi hoti (sirf productId, name, qty),
//     is liye product-level revenue CURRENT price se estimate hoti hai,
//     asal sale-time price se farq ho sakta hai agar price kabhi badli ho.
//   - App mein "return" ka koi alag status nahi hai — "cancelled" hi
//     sabse qareeb proxy hai returns ke liye.
import type { ToolModule } from "../lib/toolRegistry.js";
import { supabaseServer } from "../lib/supabaseServer.js";

function resolveDateRange(startDate?: string, endDate?: string): { from: string; to: string } {
  let start: Date;
  if (startDate) {
    start = new Date(startDate + "T00:00:00");
  } else {
    start = new Date();
    start.setHours(0, 0, 0, 0);
  }

  let end: Date;
  if (endDate) {
    end = new Date(endDate + "T00:00:00");
    end.setDate(end.getDate() + 1); // end_date ka poora din shamil karne ke liye
  } else {
    end = new Date(start);
    end.setDate(end.getDate() + 1); // sirf ek din ka range (start_date ya aaj)
  }

  return { from: start.toISOString(), to: end.toISOString() };
}

const getSalesReport: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "get_sales_report",
      description:
        "Get a sales report for a date range — total revenue, order count, and top-selling products by quantity. Defaults to today if no dates given. Product-level revenue is ESTIMATED using current prices (order line items don't store historical price), so mention it's approximate.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "ISO date, e.g. 2026-07-01. Defaults to today." },
          end_date: { type: "string", description: "ISO date, inclusive. Defaults to start_date (or today)." },
        },
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const { from, to } = resolveDateRange(args?.start_date, args?.end_date);

    const { data, error } = await supabase
      .from("orders")
      .select("id, items, total, status, created_at")
      .gte("created_at", from)
      .lt("created_at", to)
      .neq("status", "cancelled");
    if (error) return { error: error.message };

    const orders = data || [];
    const totalRevenue = orders.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);

    const qtyByProduct: Record<string, { name: string; qty: number }> = {};
    for (const o of orders) {
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        if (!it.productId) continue;
        if (!qtyByProduct[it.productId]) qtyByProduct[it.productId] = { name: it.name || it.productId, qty: 0 };
        qtyByProduct[it.productId].qty += Number(it.qty) || 0;
      }
    }

    const productIds = Object.keys(qtyByProduct);
    let topProducts: any[] = [];
    if (productIds.length) {
      const { data: products } = await supabase.from("products").select("id, price").in("id", productIds);
      topProducts = Object.entries(qtyByProduct)
        .map(([id, v]) => {
          const price = products?.find((p: any) => p.id === id)?.price || 0;
          return { product_id: id, name: v.name, qty_sold: v.qty, estimated_revenue: price * v.qty };
        })
        .sort((a, b) => b.qty_sold - a.qty_sold)
        .slice(0, 10);
    }

    return {
      date_range: { from, to },
      order_count: orders.length,
      total_revenue: totalRevenue,
      top_products_by_qty: topProducts,
    };
  },
};

const getReturnsReport: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "get_returns_report",
      description:
        "Get cancelled orders for a date range, broken down by product. NOTE: this app has no separate 'return' concept — 'cancelled' order status is the closest available proxy. Mention this if the admin asks specifically about post-delivery returns. Defaults to today.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "ISO date. Defaults to today." },
          end_date: { type: "string", description: "ISO date, inclusive. Defaults to start_date (or today)." },
        },
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const { from, to } = resolveDateRange(args?.start_date, args?.end_date);

    const { data, error } = await supabase
      .from("orders")
      .select("id, customer, items, total, created_at")
      .eq("status", "cancelled")
      .gte("created_at", from)
      .lt("created_at", to);
    if (error) return { error: error.message };

    const orders = data || [];
    const qtyByProduct: Record<string, { name: string; qty: number }> = {};
    for (const o of orders) {
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        if (!it.productId) continue;
        if (!qtyByProduct[it.productId]) qtyByProduct[it.productId] = { name: it.name || it.productId, qty: 0 };
        qtyByProduct[it.productId].qty += Number(it.qty) || 0;
      }
    }

    return {
      date_range: { from, to },
      cancelled_order_count: orders.length,
      cancelled_orders: orders.map((o: any) => ({ id: o.id, customer: o.customer, total: o.total })),
      products_involved: Object.entries(qtyByProduct).map(([id, v]) => ({ product_id: id, name: v.name, qty: v.qty })),
    };
  },
};

const getAccountingSummary: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "get_accounting_summary",
      description:
        "Get revenue, cost of goods sold (COGS), gross profit, and margin for a date range, using CURRENT product costs (not historical cost at time of sale). Defaults to today.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "ISO date. Defaults to today." },
          end_date: { type: "string", description: "ISO date, inclusive. Defaults to start_date (or today)." },
        },
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const { from, to } = resolveDateRange(args?.start_date, args?.end_date);

    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, items, total, status, created_at")
      .neq("status", "cancelled")
      .gte("created_at", from)
      .lt("created_at", to);
    if (error) return { error: error.message };

    const revenue = (orders || []).reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);

    const qtyByProduct: Record<string, number> = {};
    for (const o of orders || []) {
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        if (!it.productId) continue;
        qtyByProduct[it.productId] = (qtyByProduct[it.productId] || 0) + (Number(it.qty) || 0);
      }
    }

    const productIds = Object.keys(qtyByProduct);
    let cogs = 0;
    if (productIds.length) {
      const { data: products } = await supabase.from("products").select("id, cost").in("id", productIds);
      for (const id of productIds) {
        const cost = products?.find((p: any) => p.id === id)?.cost || 0;
        cogs += cost * qtyByProduct[id];
      }
    }

    const grossProfit = revenue - cogs;
    const marginPercent = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;

    return {
      date_range: { from, to },
      order_count: (orders || []).length,
      revenue,
      estimated_cogs: cogs,
      gross_profit: grossProfit,
      margin_percent: marginPercent,
      note: "COGS current product cost se estimate ki gayi hai — agar cost kabhi update hui ho to sale ke waqt ki asal cost se farq ho sakta hai.",
    };
  },
};

const suggestRestock: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "suggest_restock",
      description:
        "Analyze recent sales velocity (default: last 30 days) against current stock, and suggest which products need reordering soon, with a suggested reorder quantity to cover the next 30 days. This is the 'data analyst' tool — use it when the admin asks what to restock or for inventory suggestions.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Lookback window in days for sales velocity. Defaults to 30." },
        },
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const days = Number(args?.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: orders, error: ordErr } = await supabase
      .from("orders")
      .select("items, created_at, status")
      .neq("status", "cancelled")
      .gte("created_at", since);
    if (ordErr) return { error: ordErr.message };

    const qtyByProduct: Record<string, number> = {};
    for (const o of orders || []) {
      const items = Array.isArray(o.items) ? o.items : [];
      for (const it of items) {
        if (!it.productId) continue;
        qtyByProduct[it.productId] = (qtyByProduct[it.productId] || 0) + (Number(it.qty) || 0);
      }
    }

    const { data: products, error: prodErr } = await supabase.from("products").select("id, name, stock, threshold");
    if (prodErr) return { error: prodErr.message };

    const suggestions = (products || [])
      .map((p: any) => {
        const qtySold = qtyByProduct[p.id] || 0;
        const dailyVelocity = qtySold / days;
        const daysOfStockLeft = dailyVelocity > 0 ? p.stock / dailyVelocity : null;
        const lowStock = p.stock <= (p.threshold ?? 10);
        const runningOutSoon = daysOfStockLeft !== null && daysOfStockLeft < 14;

        if (!lowStock && !runningOutSoon) return null;

        const suggestedReorderQty =
          dailyVelocity > 0
            ? Math.max(0, Math.ceil(dailyVelocity * 30) - p.stock)
            : Math.max(0, (p.threshold ?? 10) * 2 - p.stock);

        return {
          product_id: p.id,
          name: p.name,
          current_stock: p.stock,
          threshold: p.threshold,
          qty_sold_last_n_days: qtySold,
          days_of_stock_left: daysOfStockLeft !== null ? Math.round(daysOfStockLeft * 10) / 10 : null,
          suggested_reorder_qty: suggestedReorderQty,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => (a.days_of_stock_left ?? 9999) - (b.days_of_stock_left ?? 9999));

    return { lookback_days: days, suggestions };
  },
};

export const reportTools: ToolModule[] = [
  getSalesReport,
  getReturnsReport,
  getAccountingSummary,
  suggestRestock,
];
