-- Time tracking: an estimate on each task, and time logs (manual entries or a running timer).
-- Totals roll up from subtasks to tasks, and from tasks to phases and projects (computed in the app).

alter table public.tasks
  add column if not exists estimate_minutes integer check (estimate_minutes is null or (estimate_minutes >= 0 and estimate_minutes <= 1000000));

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  entry_date date not null default current_date,
  -- null while a timer is running
  minutes integer check (minutes is null or (minutes > 0 and minutes <= 1440)),
  started_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entry_has_time check (minutes is not null or started_at is not null)
);
create index if not exists time_entries_project_idx on public.time_entries (project_id, entry_date);
create index if not exists time_entries_task_idx on public.time_entries (task_id);
create index if not exists time_entries_user_idx on public.time_entries (user_id, entry_date);
-- one running timer per person
create unique index if not exists time_entries_one_timer on public.time_entries (user_id) where minutes is null;

-- Keep project_id in step with the task, and stamp updated_at.
create or replace function public.time_entry_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.project_id := (select project_id from public.tasks where id = new.task_id);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists time_entries_before_write on public.time_entries;
create trigger time_entries_before_write before insert or update on public.time_entries
  for each row execute function public.time_entry_before_write();

-- When a task moves to another project, its time moves with it.
create or replace function public.task_move_time()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id then
    update public.time_entries set project_id = new.project_id where task_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists tasks_move_time on public.tasks;
create trigger tasks_move_time after update of project_id on public.tasks
  for each row execute function public.task_move_time();

-- Start a timer on a task (stops any timer you already have running).
create or replace function public.start_timer(p_task uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.can_edit_project(public.task_project(p_task)) then
    raise exception 'You can only track time on projects you work on';
  end if;
  perform public.stop_timer();
  insert into public.time_entries (task_id, user_id, started_at, entry_date)
  values (p_task, auth.uid(), now(), current_date)
  returning id into v_id;
  return v_id;
end $$;

-- Stop your running timer and turn it into a time log (at least 1 minute, at most 24 hours).
create or replace function public.stop_timer(p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  update public.time_entries
     set minutes = least(1440, greatest(1, ceil(extract(epoch from (now() - started_at)) / 60)::int)),
         note = coalesce(p_note, note)
   where user_id = auth.uid() and minutes is null
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.start_timer(uuid) to authenticated;
grant execute on function public.stop_timer(text) to authenticated;

alter table public.time_entries enable row level security;

-- Everyone signed in can see time (projects are open to everyone).
drop policy if exists "read" on public.time_entries;
create policy "read" on public.time_entries for select to authenticated using (public.my_role() is not null);

-- You log your own time on projects you work on. Admins and Managers can log for anyone.
drop policy if exists "create" on public.time_entries;
create policy "create" on public.time_entries for insert to authenticated with check (
  public.can_edit_project(public.task_project(task_id))
  and (user_id = auth.uid() or public.is_manager())
);

-- You edit or delete your own logs. Admins and Managers can fix anyone's.
drop policy if exists "update" on public.time_entries;
create policy "update" on public.time_entries for update to authenticated
  using (user_id = auth.uid() or public.is_manager())
  with check (user_id = auth.uid() or public.is_manager());
drop policy if exists "delete" on public.time_entries;
create policy "delete" on public.time_entries for delete to authenticated
  using (user_id = auth.uid() or public.is_manager());

grant select, insert, update, delete on public.time_entries to authenticated;
grant all on public.time_entries to service_role;
