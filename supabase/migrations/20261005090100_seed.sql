-- ═══════════════════════════════════════════════════════════════════
--  ruxx stream — seed data
--  Genres, ad configuration (Google test units) and a handful of
--  sample titles on public test streams so the app works before the
--  first R2 upload.
-- ═══════════════════════════════════════════════════════════════════

insert into public.genres (name, slug, sort_order) values
  ('Action',      'action',      1),
  ('Adventure',   'adventure',   2),
  ('Animation',   'animation',   3),
  ('Comedy',      'comedy',      4),
  ('Documentary', 'documentary', 5),
  ('Drama',       'drama',       6),
  ('Horror',      'horror',      7),
  ('Romance',     'romance',     8),
  ('Sci-Fi',      'sci-fi',      9),
  ('Thriller',    'thriller',    10)
on conflict (slug) do nothing;

insert into public.ad_settings (id) values (true) on conflict (id) do nothing;

-- Google *test* ad units — replace with real ones before launch.
insert into public.ad_units (placement, android_unit_id, ios_unit_id, web_unit_id, tv_unit_id, enabled) values
  (
    'pre_roll',
    'ca-app-pub-3940256099942544/1033173712',
    'ca-app-pub-3940256099942544/4411468910',
    'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&ciu_szs=300x250&impl=s&gdfp_req=1&env=vp&output=vast&unviewed_position_start=1&cust_params=deployment%3Ddevsite%26sample_sz%3Dskippable&correlator=',
    null,
    true
  ),
  (
    'mid_roll',
    'ca-app-pub-3940256099942544/1033173712',
    'ca-app-pub-3940256099942544/4411468910',
    'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&ciu_szs=300x250&impl=s&gdfp_req=1&env=vp&output=vast&unviewed_position_start=1&cust_params=deployment%3Ddevsite%26sample_sz%3Dskippable&correlator=',
    null,
    true
  ),
  (
    'banner',
    'ca-app-pub-3940256099942544/6300978111',
    'ca-app-pub-3940256099942544/2934735716',
    null,
    null,
    true
  ),
  (
    'rewarded',
    'ca-app-pub-3940256099942544/5224354917',
    'ca-app-pub-3940256099942544/1712485313',
    null,
    null,
    true
  )
on conflict (placement) do nothing;

-- ───────────────────────────────────────────── sample titles
do $$
declare
  m_id uuid;
begin
  insert into public.movies
    (title, description, release_year, maturity_rating, runtime_seconds,
     poster_url, backdrop_url, stream_url, is_featured)
  values
    ('Big Buck Bunny',
     'A giant rabbit takes gentle revenge on three bullying rodents in this open-movie classic.',
     2008, 'G', 596,
     'https://picsum.photos/seed/buckbunny/400/600',
     'https://picsum.photos/seed/buckbunnyback/1280/720',
     'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
     true)
  returning id into m_id;
  insert into public.movie_genres (movie_id, genre_id)
  select m_id, id from public.genres where slug in ('animation', 'comedy');

  insert into public.movies
    (title, description, release_year, maturity_rating, runtime_seconds,
     poster_url, backdrop_url, stream_url, is_featured)
  values
    ('Sintel',
     'A lone traveller searches a hostile world for the dragon hatchling she once rescued.',
     2010, 'PG-13', 888,
     'https://picsum.photos/seed/sintel/400/600',
     'https://picsum.photos/seed/sintelback/1280/720',
     'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
     true)
  returning id into m_id;
  insert into public.movie_genres (movie_id, genre_id)
  select m_id, id from public.genres where slug in ('animation', 'adventure', 'drama');

  insert into public.movies
    (title, description, release_year, maturity_rating, runtime_seconds,
     poster_url, backdrop_url, stream_url, is_featured)
  values
    ('Tears of Steel',
     'Scientists in a future Amsterdam try to rewrite a disaster that already happened.',
     2012, 'PG-13', 734,
     'https://picsum.photos/seed/tearssteel/400/600',
     'https://picsum.photos/seed/tearssteelback/1280/720',
     'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
     true)
  returning id into m_id;
  insert into public.movie_genres (movie_id, genre_id)
  select m_id, id from public.genres where slug in ('sci-fi', 'action');

  insert into public.movies
    (title, description, release_year, maturity_rating, runtime_seconds,
     poster_url, backdrop_url, stream_url, is_featured)
  values
    ('Elephants Dream',
     'Two characters walk through an impossible machine that keeps rebuilding itself.',
     2006, 'PG', 653,
     'https://picsum.photos/seed/elephantsdream/400/600',
     'https://picsum.photos/seed/elephantsdreamback/1280/720',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
     false)
  returning id into m_id;
  insert into public.movie_genres (movie_id, genre_id)
  select m_id, id from public.genres where slug in ('animation', 'sci-fi');

  insert into public.movies
    (title, description, release_year, maturity_rating, runtime_seconds,
     poster_url, backdrop_url, stream_url, is_featured)
  values
    ('For Bigger Blazes',
     'Short demo clip — handy for testing playback, ads and resume behaviour.',
     2024, 'G', 15,
     'https://picsum.photos/seed/blazes/400/600',
     'https://picsum.photos/seed/blazesback/1280/720',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
     false)
  returning id into m_id;
  insert into public.movie_genres (movie_id, genre_id)
  select m_id, id from public.genres where slug in ('action');

  insert into public.movies
    (title, description, release_year, maturity_rating, runtime_seconds,
     poster_url, backdrop_url, stream_url, is_featured)
  values
    ('For Bigger Escapes',
     'Short demo clip for genre rows, search and the continue-watching shelf.',
     2024, 'G', 15,
     'https://picsum.photos/seed/escapes/400/600',
     'https://picsum.photos/seed/escapesback/1280/720',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
     false)
  returning id into m_id;
  insert into public.movie_genres (movie_id, genre_id)
  select m_id, id from public.genres where slug in ('adventure', 'comedy');
end $$;

-- ───────────────────────────────────────────── sample cue points
-- Manual mid-roll markers (00:06:00 / 00:12:00 style) for the demo titles.
insert into public.ad_markers (movie_id, at_seconds, kind)
select m.id, s.at_seconds, 'mid_roll'
from public.movies m
join (values (360), (720)) as s(at_seconds)
  on m.title in ('Big Buck Bunny', 'Sintel', 'Tears of Steel', 'Elephants Dream')
where s.at_seconds < coalesce(m.runtime_seconds, 1000000)
on conflict (movie_id, at_seconds, kind) do nothing;

-- ───────────────────────────────────────────── promote yourself
-- After creating your account in the app, run:
--   update public.profiles
--     set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
