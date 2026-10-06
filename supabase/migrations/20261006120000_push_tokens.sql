-- Phase 7d: push notification tokens.
--
-- One Expo push token per device account (the client deletes any other
-- row holding the same token first, so a device that switches accounts
-- never leaves a stale registration behind). The send-push edge function
-- reads tokens as an authenticated admin; the service role (background
-- senders) bypasses RLS.

create table if not exists public.push_tokens (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text not null unique,
  platform   text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  primary key (user_id)
);

create trigger push_tokens_set_updated_at
  before update on public.push_tokens
  for each row execute function public.set_updated_at();

alter table public.push_tokens enable row level security;

create policy "push_tokens_own_all"
  on public.push_tokens for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "push_tokens_admin_select"
  on public.push_tokens for select
  to authenticated
  using (public.is_admin());
