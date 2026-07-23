// Main ABI entrypoint. Koi bhi calling app (ABOS-main, abos-chat, ya
// future project) yahan { command, sourceApp, history } bhejta hai,
// admin JWT ke sath. Yeh Groq ko tool-calling ke sath call karta hai,
// jo bhi tool model choose karay wo registry se execute hota hai,
// result wapas jata hai — sath hi audit log likhi jati hai.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { callGroqAgent, type GroqMessage } from "../lib/groqClient.js";
import { verifyAdmin, isAllowedOrigin } from "../lib/auth.js";
import { getToolDefinitions, getToolByName } from "../lib/toolRegistry.js";
import { logAction } from "../lib/auditLog.js";

// Yeh tools jab successfully chalein to Supabase data badal chuka hota
// hai — calling app ko batana zaroori hai taake wo apna local/cached
// state (products/orders arrays) refetch kar le, warna stale dikhega.
const WRITE_TOOLS = new Set([
  "update_product",
  "add_product",
  "delete_product",
  "update_order_status",
  "create_order",
]);

const SYSTEM_PROMPT = `Tum ABI ho — store admin ka apna AI chief-of-staff, Jarvis ki tarah. Tumhara kaam admin ki har madad karna hai: stock check/update karna, naya product add karna, orders dekhna ya unka status badalna, revenue batana, waghera — hamesha live tool-data se, kabhi guess nahi karna.

Tumhare paas real actions perform karne ki power hai (available tools use karke), na sirf sawal ka jawab dena. Jab admin kuch karne ko kahay ("stock 50 kar do", "naya order daal do", "is product ka price badal do"), matching tool call karo — sirf bata mat do ke kya karna chahiye, khud kar do.

Agar koi cheez clear na ho (konsa product, konsa order, konsi date), tab tak guess mat karo — pehle find_product ya get_todays_orders se sahi cheez confirm karo, ya seedha clarifying sawal poocho.

⚠️ CONFIRMATION RULE: delete_product jaisa irreversible action lene se pehle, exactly batao kya karne wale ho ("'Old Product X' ko delete karna hai — yeh wapas nahi ho sakta, confirm karein?") aur sirf tab tool call karo jab admin ne apne agle message mein explicitly haan/confirm/yes/delete kar do kaha ho. Bina confirmation ke kabhi delete mat karo.

Jawab hamesha Roman Urdu mein, chota, seedha, aur spoken-friendly rakho (yeh voice se bhi suna ja sakta hai) — English sirf product/customer names, numbers, ya jin cheezon ke liye Urdu word na ho, unke liye use karo.`;

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

  const auth = await verifyAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message });

  const { command, sourceApp, history } = req.body || {};
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "'command' (string) required" });
  }

  const messages: GroqMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...((history as GroqMessage[]) || []),
    { role: "user", content: command },
  ];

  const tools = getToolDefinitions();
  const toolsCalled: string[] = [];

  try {
    let hops = 0;
    let assistantMessage = await callGroqAgent(messages, tools);

    while (assistantMessage?.tool_calls?.length && hops < MAX_TOOL_HOPS) {
      messages.push(assistantMessage);

      for (const call of assistantMessage.tool_calls) {
        const toolName = call.function.name;
        const toolArgs = JSON.parse(call.function.arguments || "{}");
        const tool = getToolByName(toolName);

        let result: unknown;
        if (!tool) {
          result = { error: `Unknown tool: ${toolName}` };
        } else {
          result = await tool.execute(toolArgs, {
            userId: auth.userId,
            role: auth.role,
            sourceApp: sourceApp || "unknown",
          });
          toolsCalled.push(toolName);
        }

        await logAction({
          actorId: auth.userId,
          actorRole: auth.role,
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

    const dataChanged = toolsCalled.some((name) => WRITE_TOOLS.has(name));

    return res.status(200).json({
      reply: assistantMessage?.content || "",
      toolsCalled,
      dataChanged,
    });
  } catch (err: any) {
    console.error("ABI command error:", err);
    return res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
}
