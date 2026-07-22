// Main ABI entrypoint. Koi bhi calling app (ABOS-main, abos-chat, ya
// future project) yahan { command, sourceApp } bhejta hai, admin JWT
// ke sath. Yeh Groq ko tool-calling ke sath call karta hai, jo bhi
// tool model choose karay wo registry se execute hota hai, result
// wapas jata hai — sath hi audit log likhi jati hai.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { callGroqAgent, type GroqMessage } from "../lib/groqClient.js";
import { verifyAdmin, isAllowedOrigin } from "../lib/auth.js";
import { getToolDefinitions, getToolByName } from "../lib/toolRegistry.js";
import { logAction } from "../lib/auditLog.js";

const SYSTEM_PROMPT = `Tum ABI ho — store admin ka apna AI assistant.
Tumhara kaam admin ki madad karna hai: stock check karna, orders dekhna,
revenue batana, waghera — hamesha live tool-data se, kabhi guess nahi
karna. Agar koi cheez clear na ho (konsa product, konsi date), tab tak
mat guess karo — pehle clarifying sawal poocho. Jawab hamesha chota,
seedha, aur spoken-friendly rakho (yeh voice se bhi suna ja sakta hai).`;

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

    return res.status(200).json({
      reply: assistantMessage?.content || "",
    });
  } catch (err: any) {
    console.error("ABI command error:", err);
    return res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
}
