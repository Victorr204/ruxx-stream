-- ═══════════════════════════════════════════════════════════════════
--  ruxx stream — initial schema, indexes and Row Level Security
--  Run in the Supabase SQL editor (or `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm with schema public;

-- ───────────────────────────────────────────── helpers

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ───────────────────────────────────────────── profiles

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  role         text not null default 'user' check (role in ('user', 'admin')),
  is_premium   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-provision a profile for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, 'viewer'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may edit their own row, but never escalate role / premium status.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'only admins can change roles';
    end if;
    if new.is_premium is distinct from old.is_premium then
      raise exception 'only admins can change premium status';
    end if;
    if new.id is distinct from old.id then
      raise exception 'profile id is immutable';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- Admin / premium gates used by RLS policies and RPCs (security definer so
-- they can read profiles without recursing into RLS). They live below the
-- table because a LANGUAGE sql body is parsed — relations included — at
-- creation time.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_premium()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_premium = true
  );
$$;

-- ───────────────────────────────────────────── catalogue

create table public.genres (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  slug       text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.movies (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  release_year    int,
  maturity_rating text not null default 'NR',
  runtime_seconds int check (runtime_seconds is null or runtime_seconds > 0),
  poster_url      text,
  backdrop_url    text,
  trailer_url     text,
  -- Direct URL (external host / Drive-style link) OR an R2 object key.
  stream_url      text,
  r2_key_free     text,
  is_active       boolean not null default true,
  is_featured     boolean not null default false,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint movies_has_source check (stream_url is not null or r2_key_free is not null)
);

create index movies_active_recent_idx on public.movies (is_active, created_at desc);
create index movies_active_featured_idx on public.movies (is_active, is_featured) where is_featured;
create index movies_title_lower_idx on public.movies (lower(title));
create index movies_title_trgm_idx on public.movies using gin (title gin_trgm_ops);

create trigger movies_set_updated_at
  before update on public.movies
  for each row execute function public.set_updated_at();

create table public.movie_genres (
  movie_id uuid not null references public.movies (id) on delete cascade,
  genre_id uuid not null references public.genres (id) on delete cascade,
  primary key (movie_id, genre_id)
);

create index movie_genres_genre_movie_idx on public.movie_genres (genre_id, movie_id);

-- High quality rendition keys live here so RLS can gate them behind
-- profiles.is_premium = true (never exposed to free accounts).
create table public.premium_movie_sources (
  movie_id   uuid primary key references public.movies (id) on delete cascade,
  r2_key     text,
  stream_url text,
  created_at timestamptz not null default now(),
  constraint premium_source_has_key check (r2_key is not null or stream_url is not null)
);

-- Manual mid-roll cue points (HH:MM:SS typed by the owner in the admin).
create table public.ad_markers (
  id         uuid primary key default gen_random_uuid(),
  movie_id   uuid not null references public.movies (id) on delete cascade,
  at_seconds int not null check (at_seconds >= 0),
  kind       text not null default 'mid_roll' check (kind in ('pre_roll', 'mid_roll')),
  created_at timestamptz not null default now(),
  unique (movie_id, at_seconds, kind)
);

create index ad_markers_movie_time_idx on public.ad_markers (movie_id, at_seconds);

-- ───────────────────────────────────────────── ads

create table public.ad_settings (
  id                     boolean primary key default true check (id),
  pre_roll_enabled       boolean not null default true,
  mid_roll_enabled       boolean not null default true,
  banner_enabled         boolean not null default true,
  mid_roll_interval_seconds int not null default 300
                           check (mid_roll_interval_seconds >= 30),
  fail_open              boolean not null default true,
  updated_at             timestamptz not null default now()
);

create trigger ad_settings_set_updated_at
  before update on public.ad_settings
  for each row execute function public.set_updated_at();

create table public.ad_units (
  placement    text primary key
               check (placement in ('pre_roll', 'mid_roll', 'banner', 'rewarded')),
  android_unit_id text,
  ios_unit_id     text,
  web_unit_id     text,
  tv_unit_id      text,
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now()
);

create trigger ad_units_set_updated_at
  before update on public.ad_units
  for each row execute function public.set_updated_at();

create table public.ad_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete set null,
  movie_id   uuid references public.movies (id) on delete set null,
  placement  text not null,
  status     text not null check (status in ('impression', 'completed', 'skipped', 'failed')),
  created_at timestamptz not null default now()
);

create index ad_events_user_time_idx on public.ad_events (user_id, created_at desc);
create index ad_events_time_idx on public.ad_events (created_at desc);

-- ───────────────────────────────────────────── viewing state

create table public.watchlist (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  movie_id   uuid not null references public.movies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);

create index watchlist_user_idx on public.watchlist (user_id, created_at desc);

create table public.watch_progress (
  user_id          uuid not null references public.profiles (id) on delete cascade,
  movie_id         uuid not null references public.movies (id) on delete cascade,
  position_seconds int not null default 0 check (position_seconds >= 0),
  duration_seconds int not null default 0 check (duration_seconds >= 0),
  completed        boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (user_id, movie_id)
);

create index watch_progress_user_recent_idx on public.watch_progress (user_id, updated_at desc);

create table public.download_grants (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  movie_id   uuid not null references public.movies (id) on delete cascade,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (user_id, movie_id)
);

create table public.playback_events (
  id              bigint generated always as identity primary key,
  user_id         uuid references public.profiles (id) on delete set null,
  movie_id        uuid references public.movies (id) on delete set null,
  event           text not null check (event in ('play', 'resume', 'complete')),
  position_seconds int not null default 0,
  created_at      timestamptz not null default now()
);

create index playback_events_time_idx on public.playback_events (created_at desc);
create index playback_events_movie_idx on public.playback_events (movie_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════
--  Row Level Security
-- ═══════════════════════════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.genres enable row level security;
alter table public.movies enable row level security;
alter table public.movie_genres enable row level security;
alter table public.premium_movie_sources enable row level security;
alter table public.ad_markers enable row level security;
alter table public.ad_settings enable row level security;
alter table public.ad_units enable row level security;
alter table public.ad_events enable row level security;
alter table public.watchlist enable row level security;
alter table public.watch_progress enable row level security;
alter table public.download_grants enable row level security;
alter table public.playback_events enable row level security;

-- profiles ────────────────────────────────────────
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_admin_update"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "profiles_admin_delete"
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- genres ──────────────────────────────────────────
create policy "genres_read"
  on public.genres for select
  to anon, authenticated
  using (true);

create policy "genres_write_admin"
  on public.genres for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- movies ──────────────────────────────────────────
create policy "movies_read_active"
  on public.movies for select
  to authenticated
  using (is_active = true or public.is_admin());

create policy "movies_write_admin"
  on public.movies for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- movie_genres ────────────────────────────────────
create policy "movie_genres_read"
  on public.movie_genres for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.movies m
      where m.id = movie_id and m.is_active = true
    )
  );

create policy "movie_genres_write_admin"
  on public.movie_genres for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- premium sources ─────────────────────────────────
-- The whole point of this table: premium keys are unreadable unless the
-- caller's profile has is_premium = true (or the caller is an admin).
create policy "premium_sources_read_premium"
  on public.premium_movie_sources for select
  to authenticated
  using (
    public.is_admin()
    or (
      public.is_premium()
      and exists (
        select 1 from public.movies m
        where m.id = movie_id and m.is_active = true
      )
    )
  );

create policy "premium_sources_admin_write"
  on public.premium_movie_sources for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ad markers ──────────────────────────────────────
create policy "ad_markers_read"
  on public.ad_markers for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.movies m
      where m.id = movie_id and m.is_active = true
    )
  );

create policy "ad_markers_admin_write"
  on public.ad_markers for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ad config ───────────────────────────────────────
create policy "ad_settings_read"
  on public.ad_settings for select
  to anon, authenticated
  using (true);

create policy "ad_settings_admin_write"
  on public.ad_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "ad_units_read"
  on public.ad_units for select
  to anon, authenticated
  using (true);

create policy "ad_units_admin_write"
  on public.ad_units for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- analytics ───────────────────────────────────────
create policy "ad_events_insert_own"
  on public.ad_events for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_admin());

create policy "ad_events_read_own_or_admin"
  on public.ad_events for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "playback_events_insert_own"
  on public.playback_events for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_admin());

create policy "playback_events_read_own_or_admin"
  on public.playback_events for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- watchlist ───────────────────────────────────────
create policy "watchlist_read_own"
  on public.watchlist for select
  to authenticated
  using (user_id = auth.uid());

create policy "watchlist_insert_own"
  on public.watchlist for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "watchlist_delete_own"
  on public.watchlist for delete
  to authenticated
  using (user_id = auth.uid());

-- watch progress ──────────────────────────────────
create policy "watch_progress_read_own"
  on public.watch_progress for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "watch_progress_upsert_own"
  on public.watch_progress for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "watch_progress_update_own"
  on public.watch_progress for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "watch_progress_delete_own"
  on public.watch_progress for delete
  to authenticated
  using (user_id = auth.uid());

-- downloads: premium accounts only ────────────────
create policy "download_grants_read_own"
  on public.download_grants for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "download_grants_insert_premium"
  on public.download_grants for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_premium());

create policy "download_grants_delete_own"
  on public.download_grants for delete
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ═══════════════════════════════════════════════════════════════════
--  Storage: public artwork bucket (posters / backdrops / avatars)
-- ═══════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('artwork', 'artwork', true)
on conflict (id) do nothing;

create policy "artwork_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'artwork');

create policy "artwork_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'artwork' and public.is_admin());

create policy "artwork_admin_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'artwork' and public.is_admin());

create policy "artwork_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'artwork' and public.is_admin());

-- ═══════════════════════════════════════════════════════════════════
--  Admin RPCs (dashboard numbers)
-- ═══════════════════════════════════════════════════════════════════

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
    'premium_users',  (select count(*) from public.profiles where is_premium),
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
         p.is_premium,
         p.created_at,
         u.last_sign_in_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.is_admin()
  order by p.created_at desc;
$$;
