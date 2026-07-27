// Sales-intelligence domain — Phase 2. Pehla concrete "sales" tool:
// co-purchase se related products nikalna (jo bhi orders mein X ke
// saath frequently khareeda gaya). Groq/rules-based hai, koi extra
// infra nahi chahiye — sirf orders.items jsonb use karta hai jo
// already store ho raha hai.
import type { ToolModule } from "../lib/toolRegistry.js";
import { supabaseServer } from "../lib/supabaseServer.js";

const suggestRelatedProducts: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "suggest_related_products",
      description:
        "Suggest products frequently bought together with a given product, based on real past orders (co-purchase analysis). Use this for upsell/cross-sell — e.g. when a customer is asking about or has ordered a product, or when the admin asks what to bundle/recommend with something.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "The product to find companions for. Use find_product/browse_products first if you only have a name." },
          limit: { type: "number", description: "Max suggestions. Defaults to 3." },
        },
        required: ["product_id"],
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const limit = Number(args?.limit) || 3;

    // Sirf woh orders lao jin mein yeh product ho (last 500 non-cancelled
    // orders scan karna kaafi hai chhoti/medium business ke liye —
    // scale hone par is ko materialized view mein move karna).
    const { data: orders, error } = await supabase
      .from("orders")
      .select("items")
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return { error: error.message };

    const coCount: Record<string, { name: string; count: number }> = {};
    let baseOrderCount = 0;

    for (const o of orders || []) {
      const items = Array.isArray((o as any).items) ? (o as any).items : [];
      const hasBase = items.some((it: any) => it.productId === args.product_id);
      if (!hasBase) continue;
      baseOrderCount += 1;
      for (const it of items) {
        if (!it.productId || it.productId === args.product_id) continue;
        if (!coCount[it.productId]) coCount[it.productId] = { name: it.name || it.productId, count: 0 };
        coCount[it.productId].count += 1;
      }
    }

    if (baseOrderCount === 0) {
      return {
        product_id: args.product_id,
        based_on_orders: 0,
        suggestions: [],
        note: "Is product ke sath koi past order data nahi mila — nayi/kam-selling item ho sakti hai. Category ke hisaab se manual suggest karo.",
      };
    }

    const suggestions = Object.entries(coCount)
      .map(([id, v]) => ({ product_id: id, name: v.name, bought_together_count: v.count }))
      .sort((a, b) => b.bought_together_count - a.bought_together_count)
      .slice(0, limit);

    return { product_id: args.product_id, based_on_orders: baseOrderCount, suggestions };
  },
};

export const salesTools: ToolModule[] = [suggestRelatedProducts];
