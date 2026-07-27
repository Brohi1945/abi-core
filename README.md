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

- ✅ Phase A (Read-only): inventory, orders.
- ✅ Phase B (Writes): inventory/orders writes hain.
- ✅ Phase 2 (yeh update):
  - **Customer persona**: `/api/customer-command` — alag auth
    (`verifyCustomer`), alag (chota, safe) tool set
    (`tools/customer.tools.ts`), alag system prompt. Admin
    (`/api/command`) bilkul waisa hi kaam karta hai jaisa pehle karta
    tha — koi breaking change nahi.
  - **Server-enforced confirm-flow**: `delete_product` ab seedha
    delete nahi karta — pehle "propose" karta hai
    (`abi_pending_actions` row + preview), asal execution sirf
    `confirm_pending_action` tool se hoti hai
    (`lib/pendingActions.ts`). Ab yeh model ke "maan lo confirm ho
    gaya" par depend nahi karta.
  - **Sales intelligence**: `suggest_related_products`
    (`tools/sales.tools.ts`) — real order history se co-purchase
    analysis, dono personas (admin + customer) use kar sakte hain.
  - **Proactive daily digest**: `api/cron/daily-digest.ts`, Vercel
    Cron se roz 8 AM PKT chalta hai (`vercel.json`), revenue/low-stock/
    pending-orders/stale-conversations compile kar ke `abi_digests`
    table mein save karta hai — koi Groq call nahi (deterministic,
    free). Yeh sirf DATA compile karta hai; WhatsApp/email se owner ko
    push karna agla qadam hai (niche dekho).

### Customer-side setup (naya)

1. `client-adapter/abiClient.ts` mein ab `askABICustomer()` bhi hai —
   abos-chat ke customer widget mein use karo (`askABI` sirf admin ke
   liye hai).
2. Koi naya env var nahi chahiye — customer auth wohi Supabase session
   token use karta hai jo abos-chat pehle se customers ko deta hai.
3. `place_order` se bananay wale orders `customer_profile_id` column
   se us customer ke account se link hotay hain (purane orders is
   column ke bina rahenge — `get_my_orders` isi liye note deta hai
   agar kuch na mile).

### Daily digest ko live alert banane ke liye (agla qadam)

Abhi digest sirf DB mein save hota hai. Owner ko WhatsApp/email par
khud push karne ke liye `api/cron/daily-digest.ts` ke end mein Twilio/
WhatsApp Cloud API ya Resend call add karni hogi — us ke liye woh keys
abi-core ke apne Vercel env vars mein add karni parengi (ABOS-main ke
keys yahan automatically nahi aatin).

### Optional env var

- `CRON_SECRET` — set karo to Vercel apne aap cron requests ko
  authenticate karta hai. Na set kiya to endpoint bina auth ke chalta
  hai (kaam karega, bas thoda kam secure).
