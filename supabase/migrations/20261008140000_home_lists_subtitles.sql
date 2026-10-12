-- ═══════════════════════════════════════════════════════════════════
--  ruxx stream — Phase 11 (merged, re-runnable)
--  The free tier allows only SEVEN migration files per project, so this
--  file is the catch-all: everything that landed after
--  20261006130000_paystack_billing.sql lives here in one place — home
--  trending, My List, curated categories, movie subtitles (upload +
--  generated tracks) and their detection columns, the mid-roll
--  watch-time cadence, and premium expiry for one-time payments.
--
--  ADDING SQL: do not create an eighth file. Append your statements as a
--  new commented section at the end, idempotent only (this file is pasted
--  whole on every change), and describe the section in README "Run the
--  SQL". Revert to one file per change once the project is upgraded.
--
--  Every statement below is idempotent — safe to run more than once —
--  and everything here works on the Supabase free tier: RLS, triggers
--  and SECURITY DEFINER functions are all free-tier features.
-- ═══════════════════════════════════════════════════════════════════

-- ── Home hero: most-watched titles (trending slot) ──────────────────────────
-- SECURITY DEFINER so signed-in members can read the aggregate play counts
-- without row-level access to anyone's playback_events / watch_progress.

create or replace function public.trending_movie_ids(p_limit int default 6)
returns table (movie_id uuid, plays bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.movie_id, count(*) as plays
  from public.playback_events e
  join public.movies m on m.id = e.movie_id
  where e.event in ('play', 'resume')
    and m.is_active = true
  group by e.movie_id
  order by plays desc, movie_id
  limit greatest(p_limit, 1);
$$;

revoke execute on function public.trending_movie_ids(int) from public, anon;
grant execute on function public.trending_movie_ids(int) to authenticated;

-- ── My List ─────────────────────────────────────────────────────────────────

create table if not exists public.user_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create unique index if not exists user_lists_user_name_key
  on public.user_lists (user_id, lower(btrim(name)));

create index if not exists user_lists_user_created_idx
  on public.user_lists (user_id, created_at desc);

create table if not exists public.user_list_items (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  list_id    uuid not null references public.user_lists (id) on delete cascade,
  movie_id   uuid not null references public.movies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, movie_id)
);

create index if not exists user_list_items_list_created_idx
  on public.user_list_items (list_id, created_at desc);

create index if not exists user_list_items_user_idx
  on public.user_list_items (user_id);

alter table public.user_lists enable row level security;
alter table public.user_list_items enable row level security;

drop policy if exists "user_lists_select_own" on public.user_lists;
create policy "user_lists_select_own"
  on public.user_lists for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_lists_insert_own" on public.user_lists;
create policy "user_lists_insert_own"
  on public.user_lists for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_lists_delete_own" on public.user_lists;
create policy "user_lists_delete_own"
  on public.user_lists for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_list_items_select_own" on public.user_list_items;
create policy "user_list_items_select_own"
  on public.user_list_items for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_list_items_insert_own" on public.user_list_items;
create policy "user_list_items_insert_own"
  on public.user_list_items for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_lists l
      where l.id = list_id and l.user_id = auth.uid()
    )
  );

drop policy if exists "user_list_items_delete_own" on public.user_list_items;
create policy "user_list_items_delete_own"
  on public.user_list_items for delete
  to authenticated
  using (user_id = auth.uid());

create or replace function public.enforce_user_list_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max   int;
  v_count int;
begin
  select case when p.is_premium then 15 else 5 end
    into v_max
  from public.profiles p
  where p.id = new.user_id;

  if v_max is null then
    v_max := 5;
  end if;

  select count(*) into v_count
  from public.user_lists
  where user_id = new.user_id;

  if v_count >= v_max then
    raise exception 'list limit reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists user_lists_enforce_limit on public.user_lists;
create trigger user_lists_enforce_limit
  before insert on public.user_lists
  for each row execute function public.enforce_user_list_limit();

-- ── Curated home categories ─────────────────────────────────────────────────
-- Home rows, the category page and the admin genre chip picker all pick
-- these up automatically.

insert into public.genres (name, slug, sort_order) values
  ('Western TV Shows', 'western-tv-shows', 11),
  ('Nollywood Movies', 'nollywood-movies', 12),
  ('Korean Drama',     'korean-drama',     13),
  ('Bollywood Movies', 'bollywood-movies', 14)
on conflict (slug) do nothing;

-- ── Uploaded source files ───────────────────────────────────────────────────

create table if not exists public.movie_subtitles (
  id         uuid primary key default gen_random_uuid(),
  movie_id   uuid not null references public.movies(id) on delete cascade,
  language   text not null,
  label      text not null,
  source     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (movie_id, language)
);

create index if not exists movie_subtitles_movie_idx
  on public.movie_subtitles (movie_id);

-- 'upload'    — an admin uploaded the .srt / .vtt file (the default, so
--               every existing row keeps working without a backfill).
-- 'generated' — the in-app audio scanner produced the transcript on a
--               viewer's device. The save-transcript edge function
--               refuses to overwrite an 'upload' row, so an admin file
--               always wins for its language.
alter table public.movie_subtitles
  add column if not exists origin text not null default 'upload';

alter table public.movie_subtitles
  drop constraint if exists movie_subtitles_origin_check;

alter table public.movie_subtitles
  add constraint movie_subtitles_origin_check
  check (origin in ('upload', 'generated'));

-- Where the translate-subtitles edge function auto-detected the source
-- file's language (null = not detected yet — backfilled the first time
-- anyone opens the subtitle sheet for that title).
alter table public.movie_subtitles
  add column if not exists detected_language text;

-- ── Translated-cue cache ────────────────────────────────────────────────────

create table if not exists public.movie_subtitle_translations (
  subtitle_id uuid not null references public.movie_subtitles(id) on delete cascade,
  language    text not null,
  cues        jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (subtitle_id, language)
);

-- ── touch updated_at ────────────────────────────────────────────────────────

create or replace function public.touch_subtitle_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists movie_subtitles_touch on public.movie_subtitles;
create trigger movie_subtitles_touch
  before update on public.movie_subtitles
  for each row
  execute function public.touch_subtitle_updated_at();

-- Replacing a source file invalidates every cached translation of it.
create or replace function public.purge_subtitle_translations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.movie_subtitle_translations where subtitle_id = new.id;
  return new;
end;
$$;

drop trigger if exists subtitle_source_changed on public.movie_subtitles;
create trigger subtitle_source_changed
  after update of source on public.movie_subtitles
  for each row
  when (old.source is distinct from new.source)
  execute function public.purge_subtitle_translations();

-- ── Row level security ──────────────────────────────────────────────────────

alter table public.movie_subtitles enable row level security;
alter table public.movie_subtitle_translations enable row level security;

drop policy if exists "movie_subtitles_read" on public.movie_subtitles;
create policy "movie_subtitles_read"
  on public.movie_subtitles for select
  to anon, authenticated
  using (true);

drop policy if exists "movie_subtitles_admin_insert" on public.movie_subtitles;
create policy "movie_subtitles_admin_insert"
  on public.movie_subtitles for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "movie_subtitles_admin_update" on public.movie_subtitles;
create policy "movie_subtitles_admin_update"
  on public.movie_subtitles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "movie_subtitles_admin_delete" on public.movie_subtitles;
create policy "movie_subtitles_admin_delete"
  on public.movie_subtitles for delete
  to authenticated
  using (public.is_admin());

-- The translate-subtitles / save-transcript functions write the cache
-- with the service role (bypasses RLS); clients only ever read it.
drop policy if exists "subtitle_translations_read" on public.movie_subtitle_translations;
create policy "subtitle_translations_read"
  on public.movie_subtitle_translations for select
  to anon, authenticated
  using (true);


-- Mid-roll cadence: every 10 minutes of wall-clock time -------------------------
-- One ad per title every mid_roll_interval_seconds of real time since the
-- last ad was shown, persisted per title (ruxx.adclock.<movieId>) so the
-- countdown keeps running while the viewer is away. Rows still on the old
-- five-minute default follow automatically; an interval an admin
-- deliberately set is left alone.

alter table public.ad_settings
  alter column mid_roll_interval_seconds set default 600;

update public.ad_settings
   set mid_roll_interval_seconds = 600
 where mid_roll_interval_seconds = 300;


-- Premium expiry: bank transfer (one-time) payments ──────────────────────────
-- A bank transfer charges once and never renews, so checkout grants a bounded
-- window (metadata.premium_days at charge time) instead of lifetime premium.
-- Every gate below reads the window — an expired row keeps is_premium = true
-- until the next payment but behaves exactly like a free account.

alter table public.profiles
  add column if not exists premium_until timestamptz;

create or replace function public.is_premium()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_premium = true
      and (premium_until is null or premium_until > now())
  );
$$;

create or replace function public.enforce_user_list_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max   int;
  v_count int;
begin
  select case when p.is_premium and (p.premium_until is null or p.premium_until > now())
              then 15 else 5 end
    into v_max
  from public.profiles p
  where p.id = new.user_id;

  if v_max is null then
    v_max := 5;
  end if;

  select count(*) into v_count
  from public.user_lists
  where user_id = new.user_id;

  if v_count >= v_max then
    raise exception 'list limit reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.admin_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
                        where created_at > now() - interval '30 days')
  )
  where public.is_admin();
$$;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  display_name text,
  email text,
  role text,
  is_premium boolean,
  created_at timestamptz,
  last_sign_in timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.display_name,
         u.email::text,
         p.role,
         (p.is_premium and (p.premium_until is null or p.premium_until > now()))::boolean,
         p.created_at,
         u.last_sign_in_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.is_admin()
  order by p.created_at desc;
$$;

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
  if new.premium_until is distinct from old.premium_until then
    raise exception 'only admins can change premium expiry';
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


-- ══════════════════════════════════════════════════════════════════════════
-- Security hardening pass (P0 audit fixes). Idempotent — safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════

-- 1) Subtitles of hidden titles must not leak. The old read policies were a
--    bare `using (true)`, so anon could pull the full dialogue text of any
--    is_active=false movie (and every cached translation of it). Mirror the
--    is_active gate the sibling policies already use; admins keep access for
--    the editor.
drop policy if exists movie_subtitles_read on public.movie_subtitles;
create policy movie_subtitles_read on public.movie_subtitles
  for select to anon, authenticated
  using (
    exists (select 1 from public.movies m where m.id = movie_id and m.is_active)
    or public.is_admin()
  );

drop policy if exists subtitle_translations_read on public.movie_subtitle_translations;
create policy subtitle_translations_read on public.movie_subtitle_translations
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.movie_subtitles s
      join public.movies m on m.id = s.movie_id
      where s.id = subtitle_id
        and m.is_active
    )
    or public.is_admin()
  );

-- 2) profiles INSERT hardening. guard_profile_privileges is a BEFORE UPDATE
--    trigger only, so the insert policy was the entire defence: a user whose
--    row was missing could insert (id=auth.uid(), role='admin', is_premium=true)
--    themselves. Close it — clients may only create a plain, free row.
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (
    id = auth.uid()
    and role = 'user'
    and is_premium = false
    and premium_until is null
    and billing_customer_id is null
  );

-- 3) movies.stream_url lockdown. stream_url is the raw, unsigned, permanent
--    URL (demo/dev fallback only — real uploads store B2 keys). Column grants
--    keep it out of PostgREST entirely for anon/authenticated: the signed URL
--    path (sign-stream-url) reads it via the service role instead. Admin code
--    no longer selects or writes it. NOTE: clients must list columns
--    explicitly — `select=*` / a bare from() now fails, which is intended.
revoke select, insert, update, delete, truncate on public.movies from anon, authenticated;
grant select (
  id, title, description, release_year, maturity_rating, runtime_seconds,
  poster_url, backdrop_url, trailer_url, r2_key_free, is_active, is_featured,
  created_by, created_at, updated_at
) on public.movies to anon, authenticated;
-- insert/update/delete stay table-level (column list would be brittle) —
-- the movies_write_admin RLS policy means only admins actually succeed.
grant insert, update, delete on public.movies to authenticated;

-- 4) download_grants: the admin console merges duplicate grants with an
--    upsert, which needs an UPDATE policy (the table only had select/insert).
drop policy if exists download_grants_update_admin on public.download_grants;
create policy download_grants_update_admin on public.download_grants
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5) Generic fixed-window rate limiter. security definer so unauthenticated
--    callers (subtitle detect, error reports) can be throttled too; the table
--    has RLS with no policies, so only definer code ever touches it.
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);
alter table public.rate_limits enable row level security;

create or replace function public.hit_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_hits integer;
begin
  insert into public.rate_limits (key, window_start, hits)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set hits = case
                 when public.rate_limits.window_start <= v_now - make_interval(secs => p_window_seconds)
                 then 1
                 else public.rate_limits.hits + 1
               end,
        window_start = case
                 when public.rate_limits.window_start <= v_now - make_interval(secs => p_window_seconds)
                 then v_now
                 else public.rate_limits.window_start
               end
  returning hits into v_hits;

  -- Opportunistic housekeeping so the table cannot grow without bound.
  if random() < 0.02 then
    delete from public.rate_limits where window_start < v_now - interval '2 days';
  end if;

  return v_hits <= p_max;
end;
$$;

revoke execute on function public.hit_rate_limit(text, integer, integer) from public;
grant execute on function public.hit_rate_limit(text, integer, integer) to anon, authenticated, service_role;

-- 6) Throttle the analytics tables that feed Trending and the admin numbers.
--    RLS lets any signed-in user insert these rows directly through
--    PostgREST; without a cap a single account could rewrite Trending.
create or replace function public.throttle_event_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := tg_table_name;
  v_max integer := case when tg_table_name = 'ad_events' then 120 else 60 end;
begin
  if not public.hit_rate_limit(
       v_prefix || ':' || coalesce(new.user_id::text, 'anon'),
       v_max, 3600) then
    raise exception '% rate limit exceeded', tg_table_name using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists playback_events_throttle on public.playback_events;
create trigger playback_events_throttle
  before insert on public.playback_events
  for each row execute function public.throttle_event_insert();

drop trigger if exists ad_events_throttle on public.ad_events;
create trigger ad_events_throttle
  before insert on public.ad_events
  for each row execute function public.throttle_event_insert();

-- 7) Push tokens: a device switching accounts must drop the previous
--    holder's row first (token is UNIQUE), but RLS only exposes own rows.
--    The definer RPC makes that purge possible without opening writes.
create or replace function public.release_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_tokens where token = p_token;
$$;

revoke execute on function public.release_push_token(text) from public, anon;
grant execute on function public.release_push_token(text) to authenticated;

-- 8) Lazy premium expiry. There is no cron on this plan, so the client calls
--    this on every profile refresh: a user may clear only their OWN expired
--    flag, which the server already treats as free (public.is_premium).
create or replace function public.expire_my_premium()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set is_premium = false
   where id = auth.uid()
     and is_premium
     and premium_until is not null
     and premium_until <= now();
end;
$$;

revoke execute on function public.expire_my_premium() from public, anon;
grant execute on function public.expire_my_premium() to authenticated;

-- 9) Subtitle ownership. save-transcript (service role) needs to know who
--    authored a generated row so one account can't overwrite another's work.
alter table public.movie_subtitles
  add column if not exists created_by uuid;

-- 10) Client crash reports: ErrorBoundary posts here so production failures
--     are visible (previously they were console.error in __DEV__ only).
create table if not exists public.client_error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  area text,
  message text not null,
  stack text,
  created_at timestamptz not null default now()
);
alter table public.client_error_logs enable row level security;

drop policy if exists client_error_logs_insert on public.client_error_logs;
create policy client_error_logs_insert on public.client_error_logs
  for insert to anon, authenticated
  with check (length(message) > 0 and length(message) <= 4000);

drop policy if exists client_error_logs_read_admin on public.client_error_logs;
create policy client_error_logs_read_admin on public.client_error_logs
  for select to authenticated
  using (public.is_admin());

drop trigger if exists client_error_logs_throttle on public.client_error_logs;
create trigger client_error_logs_throttle
  before insert on public.client_error_logs
  for each row execute function public.throttle_event_insert();

-- 11) watchlist was the pre-My-Lists design; nothing reads it any more.
drop table if exists public.watchlist cascade;

-- 12) Rewarded ads were never a product surface (no RewardedAd component
--     anywhere); the seeded unit + admin toggle were dead weight. Remove the
--     row so it can't be re-enabled, and the client/admin ignore "rewarded".
delete from public.ad_units where placement = 'rewarded';

-- 13) Manual mid-roll cue points were replaced by the wall-clock ad cadence
--     (one ad per title every mid_roll_interval_seconds of wall-clock time,
--     persisted per title at ruxxclock.<movieId>). Nothing reads ad_markers
--     any more — drop the table, its RLS, and its seed rows.
drop table if exists public.ad_markers cascade;
