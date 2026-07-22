// Groq (OpenAI-compatible) caller with tool-calling support.
// Yeh abos-chat/api/_lib/groqClient.js ka hi proven pattern hai,
// TypeScript mein port kiya gaya — retry/backoff/timeout logic same.

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 20000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(attempt: number, response?: Response) {
  const retryAfterHeader = response?.headers?.get?.("retry-after");
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  }
  const jitter = Math.random() * 250;
  return BASE_DELAY_MS * 2 ** attempt + jitter;
}

async function fetchWithTimeout(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type GroqMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
};

export type GroqTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * Groq ke chat-completions endpoint ko call karta hai. Poora message
 * history (pichle tool calls/results samet) aur available tools
 * bhejta hai. Return: raw assistant message — {content, tool_calls}
 * — taake caller apna tool-execution loop chala sakay.
 */
export async function callGroqAgent(
  messages: GroqMessage[],
  tools?: GroqTool[]
): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err: any = new Error("GROQ_API_KEY is not set in Vercel environment variables");
    err.status = 500;
    throw err;
  }

  const body = JSON.stringify({
    model: "openai/gpt-oss-120b",
    messages,
    temperature: 0.3,
    max_completion_tokens: 800,
    ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
  });

  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
      });
    } catch (networkErr) {
      lastErr = networkErr;
      if (attempt < MAX_RETRIES) {
        await sleep(computeDelay(attempt));
        continue;
      }
      const err: any = new Error("Could not reach Groq (network error or timeout)");
      err.status = 502;
      throw err;
    }

    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      lastErr = { status: response.status };
      await sleep(computeDelay(attempt, response));
      continue;
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const err: any = new Error(response.status === 429 ? "Groq rate limit hit" : "Groq API error");
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data?.choices?.[0]?.message || null;
  }

  const err: any = new Error("Groq API error after retries");
  err.status = lastErr?.status || 502;
  throw err;
}
