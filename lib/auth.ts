// Verifies the caller is an authenticated admin (owner/agent) —
// regardless of which app (ABOS-main, abos-chat, ya future project)
// the request came from. This is the "admin-only, always" boundary
// from ABI_ARCHITECTURE_BLUEPRINT.md §5.
//
// Design note: dono existing apps ke apne role-tables alag hain
// (abos-chat: abos_chat_profiles, ABOS-main: filhaal koi role table
// nahi). ABI is liye apni ek shared `abi_admins` table use karti hai,
// taake ABI kisi bhi app ke internal auth-schema par depend na ho.
// abi_admins(id uuid primary key references auth.users, role text)

import type { VercelRequest } from "@vercel/node";
import { supabaseServer } from "./supabaseServer.js";

export type AuthResult =
  | { ok: true; userId: string; role: "owner" | "agent" }
  | { ok: false; status: number; message: string };

export async function verifyAdmin(req: VercelRequest): Promise<AuthResult> {
  const authHeader = (req.headers.authorization as string) || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return { ok: false, status: 401, message: "Missing Authorization header" };
  }

  const supabase = supabaseServer();

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, message: "Invalid or expired session" };
  }

  const { data: admin } = await supabase
    .from("abi_admins")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!admin || (admin.role !== "owner" && admin.role !== "agent")) {
    return { ok: false, status: 403, message: "Admin access required" };
  }

  return { ok: true, userId: userData.user.id, role: admin.role };
}

// ---- Customer-side auth (Phase 2) --------------------------------------
// Design note: abos-chat customers already have real Supabase Auth
// sessions — RLS policies wahan `customer_id = auth.uid()` use karte
// hain (abos_chat_profiles.id === auth.users.id, verified against live
// schema). Is liye ABI customer-mode wahi getUser(token) pattern reuse
// karta hai jo admin side pe hai, bas role-table alag hai
// (abos_chat_profiles instead of abi_admins) aur role check ulta hai.

export type CustomerAuthResult =
  | { ok: true; userId: string; profileId: string; name: string | null; customerNumber: string }
  | { ok: false; status: number; message: string };

export async function verifyCustomer(req: VercelRequest): Promise<CustomerAuthResult> {
  const authHeader = (req.headers.authorization as string) || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return { ok: false, status: 401, message: "Missing Authorization header" };
  }

  const supabase = supabaseServer();

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, message: "Invalid or expired session" };
  }

  const { data: profile } = await supabase
    .from("abos_chat_profiles")
    .select("id, name, customer_number, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile || profile.role !== "customer") {
    return { ok: false, status: 403, message: "Customer access required" };
  }

  return {
    ok: true,
    userId: userData.user.id,
    profileId: profile.id,
    name: profile.name,
    customerNumber: profile.customer_number,
  };
}

/** CORS check against ALLOWED_ORIGINS — naya project add karne ke liye
 * bas env var mein uska origin add karna hai, code nahi chhona. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}
