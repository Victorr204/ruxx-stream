-- Drop the demo titles whose stream_url no longer resolves, and restore the
-- single-hero invariant.
--
-- The seed in 20261005090100_seed.sql points four titles at hosts that now
-- refuse every request:
--
--   Elephants Dream, For Bigger Blazes, For Bigger Escapes
--       https://commondatastorage.googleapis.com/gtv-videos-bucket/...
--   Sintel
--       https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8
--
-- Both were verified dead (HTTP 403 to a plain browser-like GET, not just a
-- blocked HEAD). Leaving them in means a fresh install ships a catalog where
-- half the tiles fail on tap, which is exactly the "broken stream" this
-- removes.
--
-- The rows are deleted here rather than edited out of the seed file because
-- that migration has already run on live projects: re-running an edited file
-- would not remove the rows it created there, so a follow-up delete is the
-- only shape that leaves fresh installs and the live project identical.
--
-- Idempotent: the delete matches nothing once the rows are gone.
--
-- Child rows are handled by the schema, not by this file: movie_genres,
-- movie_subtitles, premium_movie_sources, download_grants, user_list_items
-- and watch_progress all cascade, while playback_events and ad_events keep
-- their history with movie_id set to null. Recorded play counts therefore
-- survive the removal.
delete from public.movies
where title in (
  'Elephants Dream',
  'Sintel',
  'For Bigger Blazes',
  'For Bigger Escapes'
);

-- The seed marks several demo titles featured at once. fetchFeatured() takes
-- LIMIT 1 so only one is ever shown, but which one was left up to the
-- planner, and the admin console already enforces a single hero when it
-- toggles the flag. Rank them the way the read path orders them
-- (created_at descending, id as a deterministic tiebreak) and keep the first.
with ranked as (
  select
    id,
    row_number() over (order by created_at desc, id desc) as rn
  from public.movies
  where is_featured
)
update public.movies m
set is_featured = false
from ranked r
where m.id = r.id
  and r.rn > 1;
