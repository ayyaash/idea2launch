-- Project phases (sections) such as "Planning" or "Testing" that group a project's tasks.

create table public.project_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index project_sections_project_idx on public.project_sections (project_id, sort_order);

alter table public.tasks add column section_id uuid references public.project_sections (id) on delete set null;

insert into public.app_settings (key, value) values
  ('default_phases', '["Planning", "Research", "Development", "Testing", "Launch"]')
on conflict (key) do nothing;

-- New projects start with the default phases from the admin settings.
create or replace function public.project_default_phases()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_list jsonb;
begin
  select value into v_list from public.app_settings where key = 'default_phases';
  if v_list is not null and jsonb_typeof(v_list) = 'array' then
    insert into public.project_sections (project_id, name, sort_order)
    select new.id, trim(x.name), x.ord::int
    from jsonb_array_elements_text(v_list) with ordinality as x(name, ord)
    where length(trim(x.name)) > 0;
  end if;
  return new;
end $$;

create trigger projects_default_phases after insert on public.projects
  for each row execute function public.project_default_phases();

-- A task's phase must belong to the task's project; subtasks follow their parent's phase.
create or replace function public.task_section_check()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null then
    select section_id into new.section_id from public.tasks where id = new.parent_id;
  end if;
  if new.section_id is not null
     and not exists (select 1 from public.project_sections s where s.id = new.section_id and s.project_id = new.project_id) then
    new.section_id := null;
  end if;
  return new;
end $$;

-- runs after tasks_before_write (alphabetical order of trigger names), which fixes project_id first
create trigger tasks_section_check before insert or update on public.tasks
  for each row execute function public.task_section_check();

create or replace function public.task_section_children()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.section_id is distinct from old.section_id then
    update public.tasks set section_id = new.section_id where parent_id = new.id;
  end if;
  return new;
end $$;

create trigger tasks_section_children after update of section_id on public.tasks
  for each row execute function public.task_section_children();

alter table public.project_sections enable row level security;
create policy "read" on public.project_sections for select to authenticated using (public.my_role() is not null);
create policy "manage" on public.project_sections for all to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

-- copy_task: keep the phase when copying inside the same project.
create or replace function public.copy_task(
  p_task uuid,
  p_target_project uuid default null,
  p_include_subtasks boolean default true,
  p_include_comments boolean default true,
  p_new_title text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  src public.tasks;
  v_project uuid;
  v_same boolean;
  v_new uuid;
  sub public.tasks;
  v_new_sub uuid;
begin
  select * into src from public.tasks where id = p_task;
  if src.id is null then
    raise exception 'Task not found';
  end if;
  v_project := coalesce(p_target_project, src.project_id);
  v_same := v_project = src.project_id;
  if not public.can_edit_project(v_project) then
    raise exception 'You do not have permission to add tasks to that project';
  end if;
  -- copied comments and collaborators should not notify people again
  perform set_config('i2l.copying', 'on', true);

  insert into public.tasks (project_id, parent_id, section_id, title, description, status, priority, owner_id,
                            start_date, due_date, created_by)
  values (v_project,
          case when v_same then src.parent_id else null end,
          case when v_same then src.section_id else null end,
          coalesce(nullif(trim(p_new_title), ''), src.title || ' (copy)'),
          src.description, 'todo', src.priority, src.owner_id, src.start_date, src.due_date, auth.uid())
  returning id into v_new;

  insert into public.task_collaborators (task_id, user_id)
  select v_new, user_id from public.task_collaborators where task_id = src.id;

  if p_include_comments then
    insert into public.comments (task_id, author_id, body, created_at)
    select v_new, author_id, body, created_at from public.comments where task_id = src.id;
  end if;

  if p_include_subtasks then
    for sub in select * from public.tasks where parent_id = src.id order by sort_order loop
      insert into public.tasks (project_id, parent_id, title, description, status, priority, owner_id,
                                start_date, due_date, sort_order, created_by)
      values (v_project, v_new, sub.title, sub.description, 'todo', sub.priority, sub.owner_id,
              sub.start_date, sub.due_date, sub.sort_order, auth.uid())
      returning id into v_new_sub;
      insert into public.task_collaborators (task_id, user_id)
      select v_new_sub, user_id from public.task_collaborators where task_id = sub.id;
      if p_include_comments then
        insert into public.comments (task_id, author_id, body, created_at)
        select v_new_sub, author_id, body, created_at from public.comments where task_id = sub.id;
      end if;
    end loop;
  end if;

  perform set_config('i2l.copying', 'off', true);
  return v_new;
end $$;

create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_user uuid;
begin
  if coalesce(current_setting('i2l.copying', true), 'off') = 'on' then
    return new;
  end if;
  select id, title, project_id, owner_id, created_by into t from public.tasks where id = new.task_id;
  for v_user in
    select distinct u from (
      select t.owner_id as u
      union select t.created_by
      union select user_id from public.task_collaborators where task_id = new.task_id
      union select author_id from public.comments where task_id = new.task_id
    ) s where u is not null
  loop
    perform public.notify(v_user, 'comment', 'commented on: ' || t.title, t.project_id, t.id);
  end loop;
  return new;
end $$;

create or replace function public.notify_collaborator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
begin
  if coalesce(current_setting('i2l.copying', true), 'off') = 'on' then
    return new;
  end if;
  select id, title, project_id into t from public.tasks where id = new.task_id;
  perform public.notify(new.user_id, 'collaborator', 'added you to: ' || t.title, t.project_id, t.id);
  return new;
end $$;
