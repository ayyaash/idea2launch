-- Everyone (except Viewers) can add projects and tasks.
-- A project added by a Member waits for approval from an Admin, Manager or Project Coordinator.
-- Only Admins and Managers delete projects; only Admins, Managers and Project Coordinators delete tasks.

alter table public.projects
  add column if not exists approval text not null default 'approved'
    check (approval in ('pending', 'approved', 'rejected')),
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text not null default '';

-- Admin, Manager or Project Coordinator.
create or replace function public.can_approve()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'manager', 'coordinator'), false)
$$;

create or replace function public.project_is_approved(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects where id = p_project and approval = 'approved')
$$;

-- New projects: approvers' projects are approved straight away; everyone else's wait.
-- The person who adds a project leads it unless they picked someone else.
create or replace function public.project_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_service_call() then
    return new;
  end if;
  new.created_by := auth.uid();
  if public.can_approve() then
    new.approval := 'approved';
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    new.approval := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.lead_id := coalesce(new.lead_id, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists projects_before_insert on public.projects;
create trigger projects_before_insert before insert on public.projects
  for each row execute function public.project_before_insert();

-- The approval fields only change through review_project().
create or replace function public.project_guard_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.approval is distinct from old.approval
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.review_note is distinct from old.review_note)
     and coalesce(current_setting('app.project_review', true), '') <> 'on'
     and not public.is_service_call() then
    raise exception 'Use Approve or Reject to change a project''s approval';
  end if;
  return new;
end $$;

drop trigger if exists projects_guard_approval on public.projects;
create trigger projects_guard_approval before update on public.projects
  for each row execute function public.project_guard_approval();

-- Tell the approvers when a project is waiting.
create or replace function public.notify_project_pending()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  u record;
begin
  if new.approval = 'pending' then
    for u in select id from public.profiles where is_active and role in ('admin', 'manager', 'coordinator') loop
      perform public.notify(u.id, 'approval', 'asked for approval of project ' || new.code || ' · ' || new.name, new.id, null);
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists projects_notify_pending on public.projects;
create trigger projects_notify_pending after insert on public.projects
  for each row execute function public.notify_project_pending();

-- Approve or reject a project (Admin, Manager, Project Coordinator).
create or replace function public.review_project(p_project uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  p record;
begin
  if not public.can_approve() then
    raise exception 'Only an admin, manager or project coordinator can approve projects';
  end if;
  select id, code, name, created_by into p from public.projects where id = p_project;
  if p.id is null then
    raise exception 'Project not found';
  end if;
  perform set_config('app.project_review', 'on', true);
  update public.projects
     set approval = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = coalesce(trim(p_note), '')
   where id = p_project;
  perform set_config('app.project_review', '', true);
  perform public.notify(p.created_by, 'approval',
    case when p_approve then 'approved your project ' else 'did not approve your project ' end || p.code || ' · ' || p.name
      || case when coalesce(trim(p_note), '') <> '' then ' — ' || trim(p_note) else '' end,
    p.id, null);
end $$;

grant execute on function public.review_project(uuid, boolean, text) to authenticated;
grant execute on function public.can_approve() to authenticated;
grant execute on function public.project_is_approved(uuid) to authenticated;

-- Projects waiting for approval (or not approved) are seen only by approvers, their creator and their lead.
drop policy if exists "read" on public.projects;
create policy "read" on public.projects for select to authenticated using (
  public.my_role() is not null and (
    approval = 'approved' or public.can_approve() or created_by = auth.uid() or lead_id = auth.uid()
  )
);

drop policy if exists "create" on public.projects;
create policy "create" on public.projects for insert to authenticated with check (public.can_contribute());

-- Delete projects: Admin and Manager only (unchanged).
drop policy if exists "delete" on public.projects;
create policy "delete" on public.projects for delete to authenticated using (public.is_manager());

-- Tasks: anyone (except Viewers) can add a task to an approved project, or to a project they work on.
drop policy if exists "create" on public.tasks;
create policy "create" on public.tasks for insert to authenticated with check (
  public.can_edit_project(project_id)
  or (public.can_contribute() and public.project_is_approved(project_id))
);

-- Delete tasks: Admin, Manager and Project Coordinator only.
drop policy if exists "delete" on public.tasks;
create policy "delete" on public.tasks for delete to authenticated using (public.can_approve());

-- Whoever adds a task joins the project, so they can keep working on it.
create or replace function public.task_owner_is_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into public.project_members (project_id, user_id) values (new.project_id, new.owner_id)
    on conflict do nothing;
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null and public.can_contribute() then
    insert into public.project_members (project_id, user_id) values (new.project_id, auth.uid())
    on conflict do nothing;
  end if;
  return new;
end $$;
