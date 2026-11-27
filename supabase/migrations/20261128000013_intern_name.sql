-- Shared intern logins: a task assigned to an intern account records which intern it is for.
alter table public.tasks add column if not exists intern_name text not null default '';

-- interns still change only the status (intern_name included)
create or replace function public.intern_status_only()
returns trigger language plpgsql as $$
begin
  if public.is_intern() and (
       new.title is distinct from old.title or new.description is distinct from old.description
    or new.owner_id is distinct from old.owner_id or new.priority is distinct from old.priority
    or new.start_date is distinct from old.start_date or new.due_date is distinct from old.due_date
    or new.project_id is distinct from old.project_id or new.parent_id is distinct from old.parent_id
    or new.sort_order is distinct from old.sort_order or new.intern_name is distinct from old.intern_name) then
    raise exception 'Interns can only change the status of their tasks';
  end if;
  return new;
end $$;
