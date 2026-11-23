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

-- ===== 20261120000003_grants.sql =====
-- Newer Supabase projects no longer give the API roles access to new tables automatically.
-- Row level security still decides which rows each person can see or change.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- ===== 20261120000004_project_approval.sql =====
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

-- ===== 20261120000005_time_tracking.sql =====
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

-- ===== 20261120000006_time_in_days.sql =====
-- Time is entered in working days, so one log may cover several days of work (up to 31 days).
alter table public.time_entries drop constraint if exists time_entries_minutes_check;
alter table public.time_entries add constraint time_entries_minutes_check
  check (minutes is null or (minutes > 0 and minutes <= 44640));

-- ===== 20261120000007_no_phases.sql =====
-- Projects are just tasks and subtasks: no phases.
-- New projects no longer get default phases, and existing phases are removed
-- (their tasks stay in the project; only the phase grouping goes).
drop trigger if exists projects_default_phases on public.projects;
update public.app_settings set value = '[]'::jsonb where key = 'default_phases';
delete from public.project_sections;

-- ===== 20261123000008_subtask_dates_copy_project.sql =====
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
