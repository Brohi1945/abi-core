// Phase 3 — proactive agent ki pehli eint. Yeh Vercel Cron se roz
// (vercel.json ka "crons" dekho) khud chalta hai, koi admin ne "batao"
// nahi kaha hota. Deterministic aggregation hai — Groq/LLM call NAHI
// hoti (fast, free, aur non-negotiable numbers hain, koi hallucination
// risk nahi). Result abi_digests mein save hota hai — ABOS-main
// dashboard yahan se "Aaj ka AI Brief" widget bana sakta hai bina
// dobara query kiye.
//
// AGLA QADAM (abhi is file mein NAHI hai — env vars/creds chahiye):
// digest ready hone ke baad WhatsApp/email se owner ko push karna.
// Woh Twilio/WhatsApp Cloud API/Resend keys abi-core ke apne env
// vars mein add karne parenge (ABOS-main ke keys yahan copy nahi hotay).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseServer } from "../../lib/supabaseServer.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron, CRON_SECRET env var set hone par, khud
  // "Authorization: Bearer <CRON_SECRET>" bhejta hai — is se koi bhi
  // is endpoint ko public se spam nahi kar sakta.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = (req.headers.authorization as string) || "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const supabase = supabaseServer();

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    // Kal ki revenue/orders
    const { data: yesterdayOrders, error: revErr } = await supabase
      .from("orders")
      .select("total, status, payment_status")
      .gte("created_at", startOfYesterday.toISOString())
      .lt("created_at", startOfToday.toISOString());
    if (revErr) throw revErr;

    const paidOrders = (yesterdayOrders || []).filter((o: any) => o.payment_status === "paid");
    const revenueYesterday = paidOrders.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);

    // Abhi ke pending orders (koi bhi din ke)
    const { count: pendingCount, error: pendErr } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (pendErr) throw pendErr;

    // Low stock products
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, name, stock, threshold");
    if (prodErr) throw prodErr;
    const lowStock = (products || [])
      .filter((p: any) => p.stock <= (p.threshold ?? 10))
      .map((p: any) => ({ id: p.id, name: p.name, stock: p.stock, threshold: p.threshold }));

    // Purani/stale conversations — 24 ghante se open/pending, koi reply nahi
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleConvos, error: convErr } = await supabase
      .from("abos_chat_conversations")
      .select("id, status, last_message_at")
      .in("status", ["open", "pending"])
      .lt("last_message_at", dayAgo);
    if (convErr) throw convErr;

    const payload = {
      revenue_yesterday: revenueYesterday,
      orders_yesterday: (yesterdayOrders || []).length,
      pending_orders_now: pendingCount || 0,
      low_stock: lowStock,
      stale_conversations: (staleConvos || []).length,
      generated_at: now.toISOString(),
    };

    const digestDate = startOfToday.toISOString().slice(0, 10);
    const { error: upsertErr } = await supabase
      .from("abi_digests")
      .upsert({ digest_date: digestDate, payload }, { onConflict: "digest_date" });
    if (upsertErr) throw upsertErr;

    return res.status(200).json({ ok: true, digest_date: digestDate, payload });
  } catch (err: any) {
    console.error("ABI daily-digest error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
