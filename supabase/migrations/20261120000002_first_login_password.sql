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
