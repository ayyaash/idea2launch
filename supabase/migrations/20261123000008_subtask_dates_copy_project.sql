-- 1) A subtask's dates must stay inside its main task's dates.
--    Setting a subtask outside them is refused; moving a main task's dates moves
--    its subtasks' dates in to fit.
-- 2) copy_project(): copy an existing project (tasks, subtasks, dependencies) as a template.

-- Clamp a date into [lo, hi] (either end may be open).
create or replace function public.clamp_date(d date, lo date, hi date)
returns date language sql immutable as $$
  select case
    when d is null then null
    when lo is not null and d < lo then lo
    when hi is not null and d > hi then hi
    else d
  end
$$;

-- Subtasks: refuse dates outside the main task's dates.
create or replace function public.task_check_parent_dates()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select start_date, due_date into p from public.tasks where id = new.parent_id;
  if (p.start_date is not null and (new.start_date < p.start_date or new.due_date < p.start_date))
     or (p.due_date is not null and (new.due_date > p.due_date or new.start_date > p.due_date)) then
    raise exception 'A subtask''s dates must be within its main task''s dates (% to %)',
      coalesce(to_char(p.start_date, 'DD Mon YYYY'), 'any start'), coalesce(to_char(p.due_date, 'DD Mon YYYY'), 'no due date');
  end if;
  return new;
end $$;

drop trigger if exists tasks_parent_dates on public.tasks;
create trigger tasks_parent_dates before insert or update of start_date, due_date, parent_id on public.tasks
  for each row execute function public.task_check_parent_dates();

-- Main tasks: when their dates change, pull the subtasks' dates inside.
create or replace function public.task_fit_subtask_dates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.start_date is distinct from old.start_date or new.due_date is distinct from old.due_date then
    update public.tasks
       set start_date = public.clamp_date(start_date, new.start_date, new.due_date),
           due_date = public.clamp_date(due_date, new.start_date, new.due_date)
     where parent_id = new.id
       and (start_date is distinct from public.clamp_date(start_date, new.start_date, new.due_date)
            or due_date is distinct from public.clamp_date(due_date, new.start_date, new.due_date));
  end if;
  return new;
end $$;

drop trigger if exists tasks_fit_subtask_dates on public.tasks;
create trigger tasks_fit_subtask_dates after update of start_date, due_date on public.tasks
  for each row execute function public.task_fit_subtask_dates();

-- Fix subtasks that are already outside their main task's dates.
update public.tasks s
   set start_date = public.clamp_date(s.start_date, p.start_date, p.due_date),
       due_date = public.clamp_date(s.due_date, p.start_date, p.due_date)
  from public.tasks p
 where s.parent_id = p.id
   and (s.start_date is distinct from public.clamp_date(s.start_date, p.start_date, p.due_date)
        or s.due_date is distinct from public.clamp_date(s.due_date, p.start_date, p.due_date));

-- While a project is being copied, don't send an "assigned you" notification for every task.
create or replace function public.notify_task_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if coalesce(current_setting('i2l.copying_project', true), 'off') = 'on' then
    return new;
  end if;
  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    perform public.notify(new.owner_id, 'assigned', 'assigned you: ' || new.title, new.project_id, new.id);
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.created_by is not null and new.created_by <> coalesce(new.owner_id, '00000000-0000-0000-0000-000000000000') then
      perform public.notify(new.created_by, 'status', 'moved "' || new.title || '" to ' || replace(new.status::text, '_', ' '), new.project_id, new.id);
    end if;
    if new.status = 'done' then
      for r in
        select t.id, t.title, t.owner_id, t.project_id
        from public.task_dependencies d join public.tasks t on t.id = d.task_id
        where d.depends_on_id = new.id and t.status <> 'done'
      loop
        perform public.notify(r.owner_id, 'unblocked', 'finished "' || new.title || '", so "' || r.title || '" can start', r.project_id, r.id);
      end loop;
    end if;
  end if;
  return new;
end $$;

create or replace function public.notify_collaborator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
begin
  if coalesce(current_setting('i2l.copying', true), 'off') = 'on'
     or coalesce(current_setting('i2l.copying_project', true), 'off') = 'on' then
    return new;
  end if;
  select id, title, project_id into t from public.tasks where id = new.task_id;
  perform public.notify(new.user_id, 'collaborator', 'added you to: ' || t.title, t.project_id, t.id);
  return new;
end $$;

-- Copy a project as a template: its details, team, tasks and subtasks (as To do), task
-- collaborators and dependencies. Task dates move by the same number of days as the start date.
-- Comments, files and time logs are not copied. A copy made by a Member waits for approval,
-- like any new project.
create or replace function public.copy_project(
  p_project uuid,
  p_code text,
  p_name text,
  p_start date default null,
  p_lead uuid default null,
  p_keep_people boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  src public.projects;
  v_new uuid;
  v_shift integer := 0;
  t public.tasks;
  v_map jsonb := '{}'::jsonb;
  v_id uuid;
begin
  if not public.can_contribute() then
    raise exception 'You do not have permission to add projects';
  end if;
  select * into src from public.projects where id = p_project;
  if src.id is null or not (src.approval = 'approved' or public.can_approve()
                            or src.created_by = auth.uid() or src.lead_id = auth.uid()) then
    raise exception 'Project not found';
  end if;
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'Project code and name are required';
  end if;
  if exists (select 1 from public.projects where lower(code) = lower(trim(p_code))) then
    raise exception 'Project code % is already used', trim(p_code);
  end if;
  if p_start is not null and src.start_date is not null then
    v_shift := p_start - src.start_date;
  end if;

  perform set_config('i2l.copying_project', 'on', true);

  insert into public.projects (code, name, description, category_id, status, lead_id, start_date, end_date)
  values (upper(trim(p_code)), trim(p_name), src.description, src.category_id, 'planning',
          coalesce(p_lead, case when p_keep_people then src.lead_id end),
          coalesce(p_start, src.start_date), src.end_date + v_shift)
  returning id into v_new;

  if p_keep_people then
    insert into public.project_members (project_id, user_id)
    select v_new, user_id from public.project_members where project_id = src.id
    on conflict do nothing;
  end if;

  -- main tasks first, then subtasks (so each subtask's parent exists)
  for t in
    select * from public.tasks where project_id = src.id
    order by (parent_id is not null), sort_order
  loop
    insert into public.tasks (project_id, parent_id, title, description, status, priority, owner_id,
                              start_date, due_date, sort_order, estimate_minutes)
    values (v_new,
            case when t.parent_id is null then null else (v_map ->> t.parent_id::text)::uuid end,
            t.title, t.description, 'todo', t.priority,
            case when p_keep_people then t.owner_id end,
            t.start_date + v_shift, t.due_date + v_shift, t.sort_order, t.estimate_minutes)
    returning id into v_id;
    v_map := v_map || jsonb_build_object(t.id::text, v_id);
    if p_keep_people then
      insert into public.task_collaborators (task_id, user_id)
      select v_id, user_id from public.task_collaborators where task_id = t.id
      on conflict do nothing;
    end if;
  end loop;

  insert into public.task_dependencies (task_id, depends_on_id)
  select (v_map ->> d.task_id::text)::uuid, (v_map ->> d.depends_on_id::text)::uuid
  from public.task_dependencies d
  join public.tasks x on x.id = d.task_id
  where x.project_id = src.id
    and v_map ? d.task_id::text and v_map ? d.depends_on_id::text
  on conflict do nothing;

  perform set_config('i2l.copying_project', 'off', true);
  return v_new;
end $$;

grant execute on function public.copy_project(uuid, text, text, date, uuid, boolean) to authenticated;
grant execute on function public.clamp_date(date, date, date) to authenticated;
