-- Intern role: interns see everything, can't create tasks or projects, but can move tasks
-- they own (or help on) through To do / In progress / Review / Done and comment on them.
alter type public.app_role add value if not exists 'intern' after 'member';

-- (text comparisons below, so this file also runs in one go in the SQL Editor)
create or replace function public.is_intern()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role()::text = 'intern', false)
$$;

create or replace function public.intern_on_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_intern() and exists (
    select 1 from public.tasks t where t.id = p_task
      and (t.owner_id = auth.uid() or exists (select 1 from public.task_collaborators c where c.task_id = t.id and c.user_id = auth.uid())))
$$;

-- interns update their own tasks...
drop policy if exists "intern status" on public.tasks;
create policy "intern status" on public.tasks for update to authenticated
  using (public.intern_on_task(id)) with check (public.intern_on_task(id));

-- ...but only the status: everything else stays as the assigner set it.
create or replace function public.intern_status_only()
returns trigger language plpgsql as $$
begin
  if public.is_intern() and (
       new.title is distinct from old.title or new.description is distinct from old.description
    or new.owner_id is distinct from old.owner_id or new.priority is distinct from old.priority
    or new.start_date is distinct from old.start_date or new.due_date is distinct from old.due_date
    or new.project_id is distinct from old.project_id or new.parent_id is distinct from old.parent_id
    or new.sort_order is distinct from old.sort_order) then
    raise exception 'Interns can only change the status of their tasks';
  end if;
  return new;
end $$;
drop trigger if exists tasks_intern_status_only on public.tasks;
create trigger tasks_intern_status_only before update on public.tasks
  for each row execute function public.intern_status_only();

-- interns comment on their own tasks
drop policy if exists "intern comment" on public.comments;
create policy "intern comment" on public.comments for insert to authenticated
  with check (author_id = auth.uid() and public.intern_on_task(task_id));
