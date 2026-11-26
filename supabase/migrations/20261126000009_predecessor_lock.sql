-- Predecessors lock a task: it can't be started, sent for review or completed until every
-- predecessor is Done. Project Coordinators, Managers and Admins can override the lock.
-- (Changes made outside the app, such as in the SQL Editor, are not checked.)

create or replace function public.task_check_predecessors()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_waiting text;
begin
  if new.status = old.status or new.status = 'todo' then
    return new;
  end if;
  if auth.uid() is null or public.can_approve() then
    return new;
  end if;
  select string_agg('"' || p.title || '"', ', ' order by p.title) into v_waiting
  from public.task_dependencies d
  join public.tasks p on p.id = d.depends_on_id
  where d.task_id = new.id and p.status <> 'done';
  if v_waiting is not null then
    raise exception 'This task is locked until its predecessors are done: %. A Project Coordinator, Manager or Admin can unlock it.', v_waiting;
  end if;
  return new;
end $$;

drop trigger if exists tasks_predecessor_lock on public.tasks;
create trigger tasks_predecessor_lock before update of status on public.tasks
  for each row execute function public.task_check_predecessors();

-- A predecessor must be in the same project.
create or replace function public.dependency_same_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select project_id from public.tasks where id = new.task_id)
     is distinct from (select project_id from public.tasks where id = new.depends_on_id) then
    raise exception 'A predecessor must be a task in the same project';
  end if;
  return new;
end $$;

drop trigger if exists dependencies_same_project on public.task_dependencies;
create trigger dependencies_same_project before insert or update on public.task_dependencies
  for each row execute function public.dependency_same_project();
