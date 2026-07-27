// Customer-facing ABI entrypoint (Phase 2). Deliberately a SEPARATE
// endpoint from /api/command — different persona, much smaller tool
// set (no inventory writes, no other-customer data, no delete), and
// a different auth check (verifyCustomer, not verifyAdmin). abos-chat
// ka customer chat widget yahan hit karta hai.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { callGroqAgent, type GroqMessage } from "../lib/groqClient.js";
import { verifyCustomer, isAllowedOrigin } from "../lib/auth.js";
import { getCustomerToolDefinitions, getCustomerToolByName } from "../lib/toolRegistry.js";
import { logAction } from "../lib/auditLog.js";

const CUSTOMER_SYSTEM_PROMPT = `Tum ABI ho — is dukaan/store ka apna AI sales & support assistant, customer se seedha baat kar rahe ho. Tum hamesha honest ho ke tum AI ho, kabhi khud ko insaan zahir mat karo.

Tumhara scope:
- Products dikhana/dhoondna (browse_products)
- Customer ke apne orders ka status batana (get_my_orders — sirf isi customer ke, kisi aur ke nahi)
- Naya order place karna (place_order) — items aur total pehle confirm karo, phir tool call karo
- Related/complementary products suggest karna (suggest_related_products) — jab mauqa mile, naturally upsell/cross-sell karo, pushy hue baghair
- Agar customer insaan se baat karna chahay, ya frustrated lagay, ya sawal tumhare scope se bahar ho, escalate_to_human call karo

Tumhare paas kabhi bhi price/stock/order status ke baray mein guess karne ki ijazat nahi — hamesha tool se live data lo. Kisi doosre customer ka data kabhi mat do, kabhi mat batao ke wo exist karta hai.

Jawab hamesha Roman Urdu mein, dosti-anay, chota aur seedha rakho — jaisay ek achi dukaan ka helpful salesperson baat karta hai. English sirf product names/numbers ke liye.`;

const MAX_TOOL_HOPS = 4;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin as string | undefined;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin!);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await verifyCustomer(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message });

  const { command, sourceApp, history, conversation_id } = req.body || {};
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "'command' (string) required" });
  }

  const messages: GroqMessage[] = [
    { role: "system", content: CUSTOMER_SYSTEM_PROMPT },
    ...((history as GroqMessage[]) || []),
    { role: "user", content: command },
  ];

  const tools = getCustomerToolDefinitions();
  const toolsCalled: string[] = [];

  try {
    let hops = 0;
    let assistantMessage = await callGroqAgent(messages, tools);

    while (assistantMessage?.tool_calls?.length && hops < MAX_TOOL_HOPS) {
      messages.push(assistantMessage);

      for (const call of assistantMessage.tool_calls) {
        const toolName = call.function.name;
        const toolArgs = JSON.parse(call.function.arguments || "{}");
        // escalate_to_human ko conversation_id chahiye — agar model ne
        // nahi diya lekin caller (abos-chat widget) ne request mein
        // bheja hai, wahin se bhar do.
        if (toolName === "escalate_to_human" && !toolArgs.conversation_id && conversation_id) {
          toolArgs.conversation_id = conversation_id;
        }
        const tool = getCustomerToolByName(toolName);

        let result: unknown;
        if (!tool) {
          result = { error: `Unknown tool: ${toolName}` };
        } else {
          result = await tool.execute(toolArgs, {
            userId: auth.userId,
            role: "customer",
            sourceApp: sourceApp || "unknown",
          });
          toolsCalled.push(toolName);
        }

        await logAction({
          actorId: auth.userId,
          actorRole: "customer",
          sourceApp: sourceApp || "unknown",
          commandText: command,
          toolName,
          toolArgs,
          toolResult: result,
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: toolName,
          content: JSON.stringify(result),
        });
      }

      hops += 1;
      assistantMessage = await callGroqAgent(messages, tools);
    }

    return res.status(200).json({
      reply: assistantMessage?.content || "",
      toolsCalled,
    });
  } catch (err: any) {
    console.error("ABI customer-command error:", err);
    return res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
}
