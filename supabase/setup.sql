-- Idea2Launch database setup (generated from supabase/migrations by scripts/build-setup-sql.mjs).
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run. Run it once on a new project.

-- ===== 20261120000000_init.sql =====
-- Idea2Launch: initial schema
-- Paste this whole file into Supabase > SQL Editor and run it once.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'manager', 'coordinator', 'member', 'viewer');
create type public.project_status as enum ('planning', 'active', 'on_hold', 'completed', 'cancelled');
create type public.task_status as enum ('todo', 'in_progress', 'review', 'done');
create type public.task_priority as enum ('high', 'medium', 'low');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name text not null default '',
  job_title text not null default '',
  role public.app_role not null default 'member',
  is_active boolean not null default true,
  color text not null default '#0B2A5B',
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  color text not null default '#F26A10',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(trim(code)) > 0),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  category_id uuid references public.categories (id) on delete set null,
  status public.project_status not null default 'planning',
  lead_id uuid references public.profiles (id) on delete set null,
  start_date date,
  end_date date,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_dates check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_id uuid references public.tasks (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  owner_id uuid references public.profiles (id) on delete set null,
  start_date date,
  due_date date,
  sort_order double precision not null default extract(epoch from now()),
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_dates check (due_date is null or start_date is null or due_date >= start_date),
  constraint task_not_own_parent check (parent_id is null or parent_id <> id)
);
create index tasks_project_idx on public.tasks (project_id);
create index tasks_parent_idx on public.tasks (parent_id);
create index tasks_owner_idx on public.tasks (owner_id);

create table public.task_collaborators (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (task_id, user_id)
);

-- "task_id cannot start until depends_on_id is done"
create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_id uuid not null references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  constraint dependency_not_self check (task_id <> depends_on_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_task_idx on public.comments (task_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint not null default 0,
  mime_type text not null default '',
  uploaded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index attachments_task_idx on public.attachments (task_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null,
  title text not null,
  project_id uuid references public.projects (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('overload_threshold', '25'),
  ('max_upload_mb', '10'),
  ('company_name', '"Idea2Launch"'),
  ('week_starts_on', '1');

-- ---------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- Admin and Manager have full control over all projects.
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'manager'), false)
$$;

-- Anyone active who is not a viewer.
create or replace function public.can_contribute()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'manager', 'coordinator', 'member'), false)
$$;

create or replace function public.is_project_lead(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects where id = p_project and lead_id = auth.uid())
$$;

-- Admin/Manager, or a non-viewer who leads or is assigned to the project.
create or replace function public.can_edit_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_manager()
      or (public.can_contribute() and (
            public.is_project_lead(p_project)
         or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid())
      ))
$$;

-- Project settings (name, dates, members): Admin/Manager or the project's lead.
create or replace function public.can_manage_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_manager() or (public.can_contribute() and public.is_project_lead(p_project))
$$;

create or replace function public.task_project(p_task uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.tasks where id = p_task
$$;

create or replace function public.is_service_call()
returns boolean language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
      or auth.uid() is null
$$;

-- ---------------------------------------------------------------------------
-- Triggers: bookkeeping
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
create trigger comments_touch before update on public.comments for each row execute function public.touch_updated_at();

-- New auth user -> profile. The very first user becomes Admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_role public.app_role;
begin
  v_username := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  v_username := regexp_replace(v_username, '[^a-z0-9._-]', '', 'g');
  if length(v_username) < 3 then
    v_username := v_username || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    v_username := left(v_username, 25) || '-' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  if not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
  else
    v_role := coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'member');
  end if;

  insert into public.profiles (id, username, full_name, job_title, role)
  values (
    new.id,
    v_username,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), v_username),
    coalesce(new.raw_user_meta_data ->> 'job_title', ''),
    v_role
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins (or the server) may change role / active flag / username.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_service_call() or public.is_admin() then
    -- never leave the system without an active admin
    if (old.role = 'admin' and (new.role <> 'admin' or not new.is_active))
       and not exists (select 1 from public.profiles where role = 'admin' and is_active and id <> old.id) then
      raise exception 'At least one active admin is required';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.username is distinct from old.username then
    raise exception 'Only an admin can change role, status or username';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- The project lead is always a project member.
create or replace function public.project_lead_is_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is not null then
    insert into public.project_members (project_id, user_id) values (new.id, new.lead_id)
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger projects_lead_member after insert or update of lead_id on public.projects
  for each row execute function public.project_lead_is_member();

-- Task owner / collaborators become project members automatically.
create or replace function public.task_owner_is_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into public.project_members (project_id, user_id) values (new.project_id, new.owner_id)
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger tasks_owner_member after insert or update of owner_id, project_id on public.tasks
  for each row execute function public.task_owner_is_member();

create or replace function public.collaborator_is_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_members (project_id, user_id)
  select t.project_id, new.user_id from public.tasks t where t.id = new.task_id
  on conflict do nothing;
  return new;
end $$;

create trigger collaborators_member after insert on public.task_collaborators
  for each row execute function public.collaborator_is_member();

-- Subtasks live in the same project as their parent; completed_at bookkeeping.
create or replace function public.task_before_write()
returns trigger language plpgsql as $$
declare
  v_parent_project uuid;
begin
  if new.parent_id is not null then
    select project_id into v_parent_project from public.tasks where id = new.parent_id;
    if v_parent_project is null then
      raise exception 'Parent task not found';
    end if;
    new.project_id := v_parent_project;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.task_before_write();

-- Keep subtasks in the same project when a parent moves.
create or replace function public.task_move_children()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id then
    update public.tasks set project_id = new.project_id where parent_id = new.id;
  end if;
  return new;
end $$;

create trigger tasks_move_children after update of project_id on public.tasks
  for each row execute function public.task_move_children();

-- Block circular dependencies (A waits on B waits on A).
create or replace function public.dependency_no_cycle()
returns trigger language plpgsql as $$
begin
  if exists (
    with recursive chain(id) as (
      select new.depends_on_id
      union
      select d.depends_on_id from public.task_dependencies d join chain c on d.task_id = c.id
    )
    select 1 from chain where id = new.task_id
  ) then
    raise exception 'This dependency would create a loop';
  end if;
  return new;
end $$;

create trigger dependencies_no_cycle before insert or update on public.task_dependencies
  for each row execute function public.dependency_no_cycle();

-- ---------------------------------------------------------------------------
-- Triggers: in-app notifications
-- ---------------------------------------------------------------------------
create or replace function public.notify(
  p_user uuid, p_kind text, p_title text, p_project uuid, p_task uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, kind, title, project_id, task_id)
  values (p_user, auth.uid(), p_kind, p_title, p_project, p_task);
end $$;

create or replace function public.notify_task_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
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

create trigger tasks_notify after insert or update on public.tasks
  for each row execute function public.notify_task_changes();

create or replace function public.notify_collaborator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
begin
  select id, title, project_id into t from public.tasks where id = new.task_id;
  perform public.notify(new.user_id, 'collaborator', 'added you to: ' || t.title, t.project_id, t.id);
  return new;
end $$;

create trigger collaborators_notify after insert on public.task_collaborators
  for each row execute function public.notify_collaborator();

create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_user uuid;
begin
  -- copied comments (from task copy) carry an explicit older timestamp; skip those
  if new.created_at < now() - interval '1 minute' then
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

create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_comment();

create or replace function public.notify_project_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p record;
begin
  select id, code, name into p from public.projects where id = new.project_id;
  perform public.notify(new.user_id, 'project', 'added you to project ' || p.code || ' · ' || p.name, p.id, null);
  return new;
end $$;

create trigger project_members_notify after insert on public.project_members
  for each row execute function public.notify_project_member();

-- ---------------------------------------------------------------------------
-- RPC: copy a task (with subtasks and comments) into the same or another project
-- ---------------------------------------------------------------------------
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
  v_new uuid;
  sub public.tasks;
  v_new_sub uuid;
begin
  select * into src from public.tasks where id = p_task;
  if src.id is null then
    raise exception 'Task not found';
  end if;
  v_project := coalesce(p_target_project, src.project_id);
  if not public.can_edit_project(v_project) then
    raise exception 'You do not have permission to add tasks to that project';
  end if;

  insert into public.tasks (project_id, parent_id, title, description, status, priority, owner_id,
                            start_date, due_date, created_by)
  values (v_project,
          case when v_project = src.project_id then src.parent_id else null end,
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

  return v_new;
end $$;

-- Admin: keep the storage bucket size limit in sync with the setting.
create or replace function public.set_max_upload_mb(p_mb int)
returns void language plpgsql security definer set search_path = public, storage as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change this';
  end if;
  if p_mb < 1 or p_mb > 50 then
    raise exception 'Choose a size between 1 and 50 MB';
  end if;
  insert into public.app_settings (key, value, updated_at) values ('max_upload_mb', to_jsonb(p_mb), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  update storage.buckets set file_size_limit = p_mb * 1024 * 1024 where id = 'attachments';
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_collaborators enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.notifications enable row level security;
alter table public.app_settings enable row level security;

-- Everyone signed in (and active) can see everything.
create policy "read" on public.profiles for select to authenticated using (public.my_role() is not null);
create policy "read" on public.categories for select to authenticated using (public.my_role() is not null);
create policy "read" on public.projects for select to authenticated using (public.my_role() is not null);
create policy "read" on public.project_members for select to authenticated using (public.my_role() is not null);
create policy "read" on public.tasks for select to authenticated using (public.my_role() is not null);
create policy "read" on public.task_collaborators for select to authenticated using (public.my_role() is not null);
create policy "read" on public.task_dependencies for select to authenticated using (public.my_role() is not null);
create policy "read" on public.comments for select to authenticated using (public.my_role() is not null);
create policy "read" on public.attachments for select to authenticated using (public.my_role() is not null);
create policy "read" on public.app_settings for select to authenticated using (public.my_role() is not null);
create policy "read own" on public.notifications for select to authenticated using (user_id = auth.uid());

-- Profiles: you edit your own name/title/colour; admin edits anyone (role changes guarded by trigger).
create policy "update self or admin" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- Categories & settings: admin panel.
create policy "manage" on public.categories for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy "manage" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Projects: Admin, Manager and Coordinators create; manage via can_manage_project; delete Admin/Manager.
create policy "create" on public.projects for insert to authenticated
  with check (coalesce(public.my_role() in ('admin', 'manager', 'coordinator'), false));
create policy "update" on public.projects for update to authenticated
  using (public.can_manage_project(id)) with check (public.can_manage_project(id));
create policy "delete" on public.projects for delete to authenticated using (public.is_manager());

-- Project members: managed by Admin/Manager or the project lead.
create policy "manage" on public.project_members for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- Tasks: anyone assigned to the project (or Admin/Manager).
create policy "create" on public.tasks for insert to authenticated with check (public.can_edit_project(project_id));
create policy "update" on public.tasks for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy "delete" on public.tasks for delete to authenticated
  using (public.can_manage_project(project_id) or (created_by = auth.uid() and public.can_edit_project(project_id)));

create policy "manage" on public.task_collaborators for all to authenticated
  using (public.can_edit_project(public.task_project(task_id)))
  with check (public.can_edit_project(public.task_project(task_id)));
create policy "manage" on public.task_dependencies for all to authenticated
  using (public.can_edit_project(public.task_project(task_id)))
  with check (public.can_edit_project(public.task_project(task_id))
              and public.my_role() is not null);

-- Comments: any non-viewer can comment; edit your own; delete your own (Admin/Manager can delete any).
create policy "create" on public.comments for insert to authenticated
  with check (public.can_contribute() and author_id = auth.uid());
create policy "update own" on public.comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "delete" on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.is_manager());

-- Attachments: project editors upload; uploader or Admin/Manager delete.
create policy "create" on public.attachments for insert to authenticated
  with check (public.can_edit_project(public.task_project(task_id)) and uploaded_by = auth.uid());
create policy "delete" on public.attachments for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_manager());

-- Notifications: mark your own as read / clear them.
create policy "update own" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own" on public.notifications for delete to authenticated using (user_id = auth.uid());

grant execute on function public.copy_task(uuid, uuid, boolean, boolean, text) to authenticated;
grant execute on function public.set_max_upload_mb(int) to authenticated;

-- ---------------------------------------------------------------------------
-- File storage for attachments (private bucket, 10 MB per file)
-- Path layout: <project_id>/<task_id>/<random>-<file name>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10 * 1024 * 1024)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.my_role() is not null);
create policy "attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments'
              and public.can_edit_project(((storage.foldername(name))[1])::uuid));
create policy "attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (owner = auth.uid() or public.is_manager()));

-- ===== 20261120000001_phases.sql =====
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

-- ===== 20261120000002_first_login_password.sql =====
-- People must choose their own password the first time they sign in,
-- and again after an Admin resets it.

alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- Only an Admin (or the server) can switch the flag on; anyone may switch their own flag off
-- through password_changed() after setting a new password.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_service_call() or public.is_admin() then
    -- never leave the system without an active admin
    if (old.role = 'admin' and (new.role <> 'admin' or not new.is_active))
       and not exists (select 1 from public.profiles where role = 'admin' and is_active and id <> old.id) then
      raise exception 'At least one active admin is required';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.username is distinct from old.username then
    raise exception 'Only an admin can change role, status or username';
  end if;
  if new.must_change_password and not old.must_change_password then
    raise exception 'Only an admin can require a password change';
  end if;
  return new;
end $$;

create or replace function public.password_changed()
returns void language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid()
$$;

grant execute on function public.password_changed() to authenticated;
