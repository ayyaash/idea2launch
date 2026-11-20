-- Time is entered in working days, so one log may cover several days of work (up to 31 days).
alter table public.time_entries drop constraint if exists time_entries_minutes_check;
alter table public.time_entries add constraint time_entries_minutes_check
  check (minutes is null or (minutes > 0 and minutes <= 44640));
