-- ═══════════════════════════════════════════════════════════════════
--  ruxx stream — Paystack billing (replaces Stripe)
--  Run in the Supabase SQL editor (or `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════

-- Generic billing identity: stores the Paystack customer code today, and
-- leaves room for store-billing identities later. Index predicates track
-- the column by OID, so the partial index survives the rename.
alter table public.profiles
  rename column stripe_customer_id to billing_customer_id;

alter index public.profiles_stripe_customer_id_idx
  rename to profiles_billing_customer_id_idx;

-- Generic webhook event id: the paystack-webhook function stores a SHA-256
-- of the raw payload so redeliveries are acknowledged without reprocessing.
alter table public.billing_events
  rename column stripe_event_id to event_id;

-- The privilege guard resolved the old column name at runtime, so it must
-- be recreated against billing_customer_id in the same migration. Behaviour
-- is otherwise unchanged: only admins, the service role and migration paths
-- may write billing identity, roles or premium status.
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
  if new.billing_customer_id is distinct from old.billing_customer_id then
    raise exception 'only admins can change billing identity';
  end if;
  if new.id is distinct from old.id then
    raise exception 'profile id is immutable';
  end if;
  return new;
end;
$$;
