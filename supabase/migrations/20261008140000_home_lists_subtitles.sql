-- ═══════════════════════════════════════════════════════════════════
--  ruxx stream — Phase 11 (merged, re-runnable)
--  The free tier is kept to a seven-file migration set, so everything
--  that landed after 20261006130000_paystack_billing.sql lives here in
--  one place: home trending, My List, curated categories, movie
--  subtitles (upload + generated tracks) and their detection columns.
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
