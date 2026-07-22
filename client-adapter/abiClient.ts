// Yeh file ABOS-main aur abos-chat dono mein copy hogi
// (src/lib/abiClient.ts). Har app ka ABI se lena-dena bas is ek
// function tak mehdood hai — koi core logic yahan nahi.
//
// Required env var (har app mein):
//   VITE_ABI_API_URL=https://abi-core.vercel.app

export async function askABI(
  command: string,
  authToken: string,
  sourceApp: "abos-main" | "abos-chat" | string,
  history: Array<{ role: string; content: string }> = []
) {
  const apiUrl = import.meta.env.VITE_ABI_API_URL;
  if (!apiUrl) {
    console.error("VITE_ABI_API_URL missing — .env ya Vercel env vars check karein.");
    return { error: "ABI not configured" };
  }

  const res = await fetch(`${apiUrl}/api/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ command, sourceApp, history }),
  });

  return res.json();
}
