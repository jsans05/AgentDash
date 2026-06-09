create table if not exists public.user_feedback (
  feedback_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  feedback_text text not null check (char_length(trim(feedback_text)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_user_feedback_user_id on public.user_feedback(user_id);
create index if not exists idx_user_feedback_created_at on public.user_feedback(created_at desc);

alter table public.user_feedback enable row level security;

drop policy if exists "user_feedback_insert_own" on public.user_feedback;
drop policy if exists "user_feedback_select_own" on public.user_feedback;
drop policy if exists "user_feedback_select_admin" on public.user_feedback;

create policy "user_feedback_insert_own" on public.user_feedback
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "user_feedback_select_own" on public.user_feedback
  for select to authenticated
  using (auth.uid() = user_id);

create policy "user_feedback_select_admin" on public.user_feedback
  for select to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.role = 'admin'
    )
  );
