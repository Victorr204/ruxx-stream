-- ═══════════════════════════════════════════════════════════════════
--  ruxx stream — premium checkout (Stripe)
--  Run in the Supabase SQL editor (or `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════

-- Stripe identity lives on the profile; only the stripe-webhook edge
-- function (service role) and admins may write it.
alter table public.profiles
  add column if not exists stripe_customer_id text;

create index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- The privilege guard must not block server-side billing writes: the
-- stripe-webhook function runs as service_role (no end-user JWT) and the
-- documented SQL-editor admin flow has no JWT claims either. It keeps
-- enforcing for the roles that reach PostgREST as an app user.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := '';
begin
  begin
    jwt_role := coalesce(
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
      ''
    );
  exception when others then
    jwt_role := '';
  end;

  -- Only app users are gated; migrations, SQL editor sessions and the
  -- service role are trusted paths (mirrors Supabase's own role model).
  if jwt_role not in ('anon', 'authenticated') then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'only admins can change roles';
  end if;
  if new.is_premium is distinct from old.is_premium then
    raise exception 'only admins can change premium status';
  end if;
  if new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'only admins can change billing identity';
  end if;
  if new.id is distinct from old.id then
    raise exception 'profile id is immutable';
  end if;
  return new;
end;
$$;

-- Idempotency log for the webhook: one row per Stripe event, unique on
-- the event id so redeliveries can be acknowledged without reprocessing.
create table if not exists public.billing_events (
  id              uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  type            text not null,
  payload         jsonb not null,
  created_at      timestamptz not null default now()
);

alter table public.billing_events enable row level security;

drop policy if exists "billing_events_admin_select" on public.billing_events;
create policy "billing_events_admin_select"
  on public.billing_events for select
  to authenticated
  using (public.is_admin());

-- Writes come from stripe-webhook (service role bypasses RLS); no insert
-- policy exists on purpose so app users cannot forge billing history.
