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
