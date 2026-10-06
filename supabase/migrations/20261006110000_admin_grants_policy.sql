-- Phase 7c: admin download grants.
--
-- download_grants_insert_premium only let a premium user grant THEMSELVES a
-- download. The admin console needs to grant (and policies already let admins
-- read/delete) to any user, so widen the insert policy to include admins.
-- Everything else the console touches (movies, movie_genres, premium sources,
-- ad settings/units, profiles) already has admin policies in the init
-- migration — no other changes required here.

drop policy if exists "download_grants_insert_premium" on public.download_grants;

create policy "download_grants_insert_premium_or_admin"
  on public.download_grants for insert
  to authenticated
  with check (
    public.is_admin()
    or (user_id = auth.uid() and public.is_premium())
  );
