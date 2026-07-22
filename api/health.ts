// Simple ping — deployment check ke liye. Auth nahi chahiye.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({ status: "ok", service: "abi-core", time: new Date().toISOString() });
}
