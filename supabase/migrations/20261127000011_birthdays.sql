-- Birthdays: day and month only (no year is stored, so nobody's age is shown).
alter table public.profiles add column if not exists birth_month smallint check (birth_month between 1 and 12);
alter table public.profiles add column if not exists birth_day smallint check (birth_day between 1 and 31);
-- set once the person has answered (or skipped) the "when's your birthday?" question
alter table public.profiles add column if not exists birthday_asked boolean not null default false;
alter table public.profiles drop constraint if exists profiles_birthday_pair;
alter table public.profiles add constraint profiles_birthday_pair
  check ((birth_month is null) = (birth_day is null)
    and (birth_day is null or birth_day <= case when birth_month = 2 then 29 when birth_month in (4, 6, 9, 11) then 30 else 31 end));
