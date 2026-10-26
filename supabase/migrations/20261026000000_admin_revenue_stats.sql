-- Business metrics for the admin dashboard: subscribers and money made.
--
-- Revenue is not a column anywhere — Paystack amounts live inside
-- billing_events.payload as raw webhook JSON — so it has to be aggregated
-- here. Two correctness notes that the numbers depend on:
--
--   1. A first payment fires BOTH charge.success and subscription.create
--      (see supabase/functions/paystack-webhook). Summing both would double
--      every new subscriber's money, so only charge.success is counted: it
--      is the single event that means "money actually moved". Subscription
--      renewals also emit charge.success, so recurring revenue is included
--      without any extra handling.
--
--   2. billing_events.event_id is the SHA-256 of the raw request body and
--      unique, so Paystack redeliveries are already deduplicated at insert
--      time. No DISTINCT needed to avoid recounting retries.
--
-- Paystack reports NGN in kobo, so the *_naira fields divide by 100.
-- The regex guard on amount drops rows where the field is missing or
-- malformed rather than letting a cast abort the whole aggregate.

create or replace function public.admin_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with charged as (
    select
      (be.payload -> 'data' ->> 'amount')::numeric as amount_kobo,
      coalesce(be.payload -> 'data' ->> 'currency', 'NGN') as currency,
      be.created_at,
      coalesce(
        be.payload -> 'data' ->> 'customer_code',
        be.payload -> 'data' -> 'customer' ->> 'customer_code'
      ) as customer_code
    from public.billing_events be
    where be.type = 'charge.success'
      and (be.payload -> 'data' ->> 'status') = 'success'
      and (be.payload -> 'data' ->> 'amount') ~ '^[0-9]+(\.[0-9]+)?$'
  )
  select jsonb_build_object(
    'movies_total',   (select count(*) from public.movies),
    'movies_active',  (select count(*) from public.movies where is_active),
    'users_total',    (select count(*) from public.profiles),
    'premium_users',  (select count(*) from public.profiles
                        where is_premium
                          and (premium_until is null or premium_until > now())),
    'plays_30d',      (select count(*) from public.playback_events
                        where created_at > now() - interval '30 days'),
    'ad_impressions_30d', (select count(*) from public.ad_events
                        where created_at > now() - interval '30 days'),

    -- Money made. NGN only: a stray charge in another currency would otherwise
    -- be added at face value, mixing units in one total.
    'revenue_total_naira',
      coalesce(round(sum(amount_kobo) filter (where currency = 'NGN') / 100.0, 2), 0),
    'revenue_30d_naira',
      coalesce(round(sum(amount_kobo) filter (where currency = 'NGN'
                                              and created_at > now() - interval '30 days') / 100.0, 2), 0),
    'revenue_90d_naira',
      coalesce(round(sum(amount_kobo) filter (where currency = 'NGN'
                                              and created_at > now() - interval '90 days') / 100.0, 2), 0),
    'charges_total',    count(*),
    'charges_30d',     count(*) filter (where created_at > now() - interval '30 days'),
    'paying_customers', count(distinct customer_code) filter (where customer_code is not null),
    'avg_charge_naira',
      coalesce(round(avg(amount_kobo) filter (where currency = 'NGN') / 100.0, 2), 0),

    -- Subscriber movement.
    'new_users_30d', (select count(*) from public.profiles
                       where created_at > now() - interval '30 days'),
    'churn_events_30d', (select count(*) from public.billing_events
                          where type in ('subscription.disable', 'subscription.not_renew')
                            and created_at > now() - interval '30 days')
  )
  from charged
  where public.is_admin();
$$;
