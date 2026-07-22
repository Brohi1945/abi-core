# ABI Core

ABOS admin ke liye shared AI-assistant service — standalone, Vercel par
apni deployment, koi bhi project isay use kar sakta hai sirf ek env
variable set karke. Poora architecture/reasoning
`ABI_ARCHITECTURE_BLUEPRINT.md` mein hai.

## Setup (naya deploy)

1. `.env.example` copy karo Vercel ke Environment Variables mein.
2. `supabase/migration_abi_core.sql` run karo — usi Supabase project
   mein jo ABOS-main/abos-chat use karte hain.
3. `abi_admins` table mein apne existing admins insert karo (SQL file
   mein commented examples diye hain).
4. Deploy: `vercel --prod` ya GitHub se auto-deploy.
5. `/api/health` hit karke confirm karo deployment live hai.

## Naye project ko connect karna

1. Us project ke domain ko `ALLOWED_ORIGINS` env var mein add karo
   (comma se separate).
2. Us project mein `client-adapter/abiClient.ts` copy karo.
3. Us project ke `.env` mein `VITE_ABI_API_URL=https://abi-core.vercel.app`
   add karo.
4. Bas — koi core code nahi chhona parta.

## Naya tool/capability add karna

1. `tools/<domain>.tools.ts` banao — `inventory.tools.ts` jaisa shape
   follow karo (`{ definition, execute }`).
2. `lib/toolRegistry.ts` mein import + `ALL_TOOLS` array mein add karo.
3. Done — Groq automatically naya tool "dekh" lega, use kar sakta hai.

## Phase Status

- ✅ Phase A (Read-only): inventory, orders — starter tools yahan diye
  gaye hain, baaki domains (customers, messaging) isi pattern se add
  karne hain.
- ⏳ Phase B onward: writes + confirm-flow — `ABI_ARCHITECTURE_BLUEPRINT.md`
  §7 dekho.
