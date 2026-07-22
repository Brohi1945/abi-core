-- ABI core ke liye zaroori shared tables. Yeh usi Supabase project mein
-- run karo jo ABOS-main aur abos-chat dono already use karte hain.

-- Admin identity table — ABI is se check karta hai ke caller admin hai
-- ya nahi, chahay wo ABOS-main se aaye ya abos-chat se.
create table if not exists abi_admins (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'agent')),
  source_app text, -- jahan se yeh admin originally register hua
  created_at timestamptz default now()
);

-- Existing abos-chat owners/agents ko backfill karne ke liye (agar
-- abos_chat_profiles table already maujood hai is project mein):
-- insert into abi_admins (id, role, source_app)
--   select id, role, 'abos-chat' from abos_chat_profiles
--   where role in ('owner', 'agent')
--   on conflict (id) do nothing;

-- ABOS-main ke current admin users ke liye (koi role-table nahi hai
-- abhi, is liye manually insert karna hoga — user_id supabase auth
-- dashboard se copy karo):
-- insert into abi_admins (id, role, source_app) values
--   ('<user-uuid-from-supabase-auth>', 'owner', 'abos-main');

-- Audit log — har ABI tool-call ka record.
create table if not exists abi_action_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_role text,
  source_app text,
  command_text text,
  tool_name text,
  tool_args jsonb,
  tool_result jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_abi_action_log_actor on abi_action_log(actor_id);
create index if not exists idx_abi_action_log_created on abi_action_log(created_at desc);
