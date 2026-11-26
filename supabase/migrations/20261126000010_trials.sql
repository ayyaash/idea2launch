-- R&D Trials: a log of mould trials, viewed month by month.
create table if not exists public.trials (
  id uuid primary key default gen_random_uuid(),
  planned_date date not null,
  actual_date date,
  mould text not null default '',
  purpose text not null default '',
  project_id uuid references public.projects (id) on delete set null,
  owner_id uuid references public.profiles (id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'done', 'postponed', 'cancelled')),
  doc_url text not null default '',
  feedback text not null default '',
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trials_planned_idx on public.trials (planned_date);

-- "Done" follows the actual date: filling it in marks a planned trial done, clearing it
-- puts a done trial back to planned.
create or replace function public.trial_status_from_dates()
returns trigger language plpgsql as $$
begin
  if new.actual_date is not null and new.status = 'planned' then new.status := 'done'; end if;
  if new.actual_date is null and new.status = 'done' then new.status := 'planned'; end if;
  return new;
end $$;
drop trigger if exists trials_status on public.trials;
create trigger trials_status before insert or update on public.trials
  for each row execute function public.trial_status_from_dates();
drop trigger if exists trials_touch on public.trials;
create trigger trials_touch before update on public.trials
  for each row execute function public.touch_updated_at();

alter table public.trials enable row level security;
drop policy if exists "read" on public.trials;
drop policy if exists "create" on public.trials;
drop policy if exists "edit" on public.trials;
drop policy if exists "delete" on public.trials;
-- everyone signed in can see trials
create policy "read" on public.trials for select to authenticated using (public.my_role() is not null);
-- everyone except Viewers can add
create policy "create" on public.trials for insert to authenticated
  with check (public.can_contribute() and created_by = auth.uid());
-- people edit their own (or ones assigned to them); Coordinators, Managers and Admins edit any
create policy "edit" on public.trials for update to authenticated
  using (created_by = auth.uid() or owner_id = auth.uid() or public.can_approve())
  with check (public.can_contribute());
create policy "delete" on public.trials for delete to authenticated
  using (created_by = auth.uid() or public.can_approve());
grant select, insert, update, delete on public.trials to authenticated;
grant all on public.trials to service_role;
