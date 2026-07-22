// Inventory domain tools — Phase A (Read-only), ABI_README §3 se.
// Har naya tool isi shape mein add hota hai: { definition, execute }.
import type { ToolModule } from "../lib/toolRegistry.js";
import { supabaseServer } from "../lib/supabaseServer.js";

const getStockLevels: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "get_stock_levels",
      description:
        "Get current stock levels for products. Optionally filter by low-stock only.",
      parameters: {
        type: "object",
        properties: {
          low_stock_only: {
            type: "boolean",
            description: "If true, only return products below their low-stock threshold.",
          },
        },
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    let query = supabase.from("products").select("id, name, stock, low_stock_threshold, category");

    const { data, error } = await query;
    if (error) return { error: error.message };

    if (args?.low_stock_only) {
      return (data || []).filter(
        (p: any) => p.stock <= (p.low_stock_threshold ?? 5)
      );
    }
    return data;
  },
};

const findProductByName: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "find_product",
      description: "Look up a product by name (partial match) to get its price, stock, and category.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Product name or partial name" },
        },
        required: ["name"],
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const { data, error } = await supabase
      .from("products")
      .select("id, name, price, cost, stock, category")
      .ilike("name", `%${args.name}%`)
      .limit(5);
    if (error) return { error: error.message };
    return data;
  },
};

export const inventoryTools: ToolModule[] = [getStockLevels, findProductByName];
