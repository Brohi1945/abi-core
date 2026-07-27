// Inventory domain tools — Phase A (Read) + Phase B (Write), ABI_README §3 se.
// Har naya tool isi shape mein add hota hai: { definition, execute }.
import type { ToolModule, ToolContext } from "../lib/toolRegistry.js";
import { supabaseServer } from "../lib/supabaseServer.js";
import { proposeAction } from "../lib/pendingActions.js";

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
    // 🐛 FIX: asal products table mein column "threshold" hai, "low_stock_threshold"
    // nahi (pichli starter file mein ghalti se likha gaya tha — yeh query pehle
    // Postgres error deti, kyunke wo column exist hi nahi karta).
    const { data, error } = await supabase.from("products").select("id, name, stock, threshold, category");
    if (error) return { error: error.message };

    if (args?.low_stock_only) {
      return (data || []).filter((p: any) => p.stock <= (p.threshold ?? 10));
    }
    return data;
  },
};

const findProductByName: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "find_product",
      description: "Look up a product by name (partial match) to get its id, price, stock, and category.",
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
      .select("id, name, price, cost, stock, category, threshold, barcode")
      .ilike("name", `%${args.name}%`)
      .limit(5);
    if (error) return { error: error.message };
    return data;
  },
};

// ---- Writes (Phase B) --------------------------------------------------

const updateProduct: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "update_product",
      description:
        "Update one or more fields on an existing product — price, cost, stock, threshold, name, category, barcode, or specs. Only pass fields that are actually changing. Use find_product first to get the product_id if you don't already have it.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "The product's id, from find_product or get_stock_levels." },
          name: { type: "string" },
          category: { type: "string" },
          price: { type: "number" },
          cost: { type: "number" },
          stock: { type: "number" },
          threshold: { type: "number" },
          barcode: { type: "string" },
          specs: { type: "string" },
        },
        required: ["product_id"],
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    const { product_id, ...rest } = args || {};
    if (!product_id) return { error: "product_id is required" };

    const fields = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined && v !== null)
    );
    if (Object.keys(fields).length === 0) return { error: "No fields provided to update." };

    const { data, error } = await supabase
      .from("products")
      .update(fields)
      .eq("id", product_id)
      .select()
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: `No product found with id ${product_id}` };
    return { updated: data };
  },
};

const addProduct: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "add_product",
      description: "Add a new product to inventory.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          price: { type: "number" },
          cost: { type: "number" },
          stock: { type: "number" },
          threshold: { type: "number", description: "Low-stock threshold. Defaults to 10 if not given." },
          barcode: { type: "string" },
        },
        required: ["name", "price"],
      },
    },
  },
  execute: async (args) => {
    const supabase = supabaseServer();
    if (!args?.name || args?.price === undefined) {
      return { error: "name and price are required" };
    }
    const newProduct = {
      id: `P-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      name: args.name,
      category: args.category || "Uncategorized",
      price: Number(args.price) || 0,
      cost: Number(args.cost) || 0,
      stock: Number(args.stock) || 0,
      threshold: Number(args.threshold) || 10,
      barcode: args.barcode || `BC-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    };
    const { data, error } = await supabase.from("products").insert(newProduct).select().single();
    if (error) return { error: error.message };
    return { created: data };
  },
};

// 🔒 PHASE 2: yeh ab seedha delete NAHI karta — sirf "propose" karta hai
// (product fetch karke pending_action row banata hai, preview return
// karta hai). Asal delete sirf confirm_pending_action se hoti hai
// (lib/pendingActions.ts + toolRegistry.ts ka CONFIRMABLE_EXECUTORS
// dekho), taake yeh model ke "maan lo confirm ho gaya" par depend na
// karay — server khud verify karta hai ke ek real pending row hai.
const deleteProduct: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "delete_product",
      description:
        "Propose permanently deleting a product. This does NOT delete anything — it returns a preview and a pending_action_id. Tell the admin exactly what will be deleted and ask them to confirm. Only after they explicitly confirm, call confirm_pending_action with that pending_action_id to actually perform the deletion.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string" },
        },
        required: ["product_id"],
      },
    },
  },
  execute: async (args, ctx) => {
    const supabase = supabaseServer();
    const { data: product, error } = await supabase
      .from("products")
      .select("id, name, price, stock, category")
      .eq("id", args.product_id)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!product) return { error: `No product found with id ${args.product_id}` };

    return proposeAction("delete_product", { product_id: args.product_id }, { about_to_delete: product }, ctx);
  },
};

/** Raw executor — sirf resolvePendingAction se call hota hai, model ko
 * kabhi seedha nahi dikhta (ALL_TOOLS/getToolDefinitions mein nahi hai). */
export async function executeDeleteProduct(args: { product_id: string }, _ctx: ToolContext) {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("products")
    .delete()
    .eq("id", args.product_id)
    .select()
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: `No product found with id ${args.product_id}` };
  return { deleted: data };
}

export const inventoryTools: ToolModule[] = [
  getStockLevels,
  findProductByName,
  updateProduct,
  addProduct,
  deleteProduct,
];
