import { useMemo, useState } from "react";
import { addMonths, endOfMonth, format, getDay, isSameDay, startOfMonth } from "date-fns";
import { Cake, ChevronLeft, ChevronRight, PartyPopper } from "lucide-react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { isAdmin } from "../lib/perms";
import { birthdayIn, fmtBirthday, inBirthdayWeek, nextBirthday } from "../lib/birthdays";
import type { Profile } from "../lib/types";
import { Avatar, Button, Card, PageHeader, Spinner, cx } from "../components/ui";
import { BirthdayOverlay } from "../components/Birthday";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Birthdays() {
  const store = useStore();
  const { me } = useAuth();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [replay, setReplay] = useState(false);
  const today = new Date();

  const people = useMemo(() => store.profiles.filter((p) => p.is_active && p.birth_month && p.birth_day), [store.profiles]);
  const byDay = useMemo(() => {
    const m = new Map<number, Profile[]>();
    for (const p of people) {
      const b = birthdayIn(p, month.getFullYear());
      if (b && b.getMonth() === month.getMonth()) m.set(b.getDate(), [...(m.get(b.getDate()) ?? []), p]);
    }
    return m;
  }, [people, month]);
  const upcoming = useMemo(() => people
    .map((p) => ({ p, d: nextBirthday(p, today)! }))
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .slice(0, 8), [people]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = store.profiles.filter((p) => p.is_active && !p.birth_month).length;

  if (!store.ready) return <Spinner />;
  const first = startOfMonth(month);
  const lead = (getDay(first) + 6) % 7; // Monday first
  const total = endOfMonth(month).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const thisMonth = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  const celebrating = people.filter((p) => inBirthdayWeek(p, today));

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title="Birthdays" subtitle="Everyone's birthday on one calendar. Only the day and month are kept."
        actions={<>
          <div className="flex items-center rounded-lg bg-white shadow-card ring-1 ring-line">
            <button aria-label="Previous month" className="p-2 text-slate-500 hover:text-ink" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="size-4" /></button>
            <span className="w-36 text-center text-sm font-semibold text-ink">{format(month, "MMMM yyyy")}</span>
            <button aria-label="Next month" className="p-2 text-slate-500 hover:text-ink" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="size-4" /></button>
          </div>
          {format(month, "yyyy-MM") !== format(today, "yyyy-MM") && <Button onClick={() => setMonth(startOfMonth(today))}>Today</Button>}
        </>} />

      {celebrating.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-pink-50 px-4 py-3 ring-1 ring-pink-200">
          <PartyPopper className="size-5 text-pink-600" />
          <p className="text-sm text-ink">
            <span className="font-semibold">Birthday week: </span>
            {celebrating.map((p) => `${p.full_name} (${fmtBirthday(p)})`).join(", ")}
          </p>
          {me && celebrating.some((p) => p.id === me.id) && <Button size="sm" className="ml-auto" onClick={() => setReplay(true)}>Celebrate again</Button>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line-soft bg-slate-50/80 text-center text-[11px] font-bold tracking-wider text-slate-500 uppercase">
            {WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const list = d ? byDay.get(d) ?? [] : [];
              const isToday = !!d && isSameDay(new Date(month.getFullYear(), month.getMonth(), d), today);
              return (
                <div key={i} className={cx("min-h-24 border-r border-b border-line-soft p-1.5 sm:min-h-28 sm:p-2 [&:nth-child(7n)]:border-r-0",
                  !d && "bg-slate-50/50", list.length > 0 && "bg-pink-50/70")}>
                  {d && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className={cx("grid size-7 place-items-center rounded-full text-sm",
                          isToday ? "bg-cta font-bold text-on-accent" : list.length ? "font-bold text-pink-700" : "text-slate-500")}>{d}</span>
                        {list.length > 0 && <Cake className="size-4 text-pink-500" aria-label="Birthday" />}
                      </div>
                      <div className="mt-1 space-y-1">
                        {list.map((p) => (
                          <div key={p.id} title={p.full_name} className="flex min-w-0 items-center gap-1.5 rounded-md bg-white px-1 py-0.5 shadow-sm ring-1 ring-pink-200">
                            <Avatar person={p} size={20} />
                            <span className="hidden truncate text-xs font-medium text-ink sm:inline">{p.full_name.split(" ")[0]}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-bold text-ink">In {format(month, "MMMM")}</h2>
            {thisMonth.length === 0 ? <p className="text-sm text-slate-500">No birthdays this month.</p> : (
              <ul className="space-y-2.5">
                {thisMonth.flatMap(([d, list]) => list.map((p) => (
                  <li key={p.id} className="flex items-center gap-2.5">
                    <Avatar person={p} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{p.full_name}</p>
                      <p className="truncate text-xs text-slate-500">{p.job_title || " "}</p>
                    </div>
                    <span className="rounded-full bg-pink-50 px-2 py-0.5 text-xs font-semibold text-pink-700 ring-1 ring-pink-200">{d} {format(month, "MMM")}</span>
                  </li>
                )))}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-bold text-ink">Coming up</h2>
            {upcoming.length === 0 ? <p className="text-sm text-slate-500">No birthdays added yet.</p> : (
              <ul className="space-y-2">
                {upcoming.map(({ p, d }) => {
                  const days = Math.round((d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
                  return (
                    <li key={p.id} className="flex items-center gap-2.5 text-sm">
                      <Avatar person={p} size={24} />
                      <span className="min-w-0 flex-1 truncate text-ink">{p.full_name}</span>
                      <span className="text-xs text-slate-500">{days === 0 ? "Today 🎉" : days === 1 ? "Tomorrow" : `${format(d, "d MMM")} · in ${days} days`}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {missing > 0 && (
            <p className="px-1 text-xs text-slate-500">
              {missing} {missing === 1 ? "person hasn't" : "people haven't"} added a birthday yet.{" "}
              {isAdmin(me) ? <>Add them in <Link to="/admin" className="font-medium text-brand-600 hover:underline">Admin panel</Link>.</> : <>Add yours in <Link to="/account" className="font-medium text-brand-600 hover:underline">My account</Link>.</>}
            </p>
          )}
        </div>
      </div>
      {replay && <BirthdayOverlay force onDone={() => setReplay(false)} />}
    </div>
  );
}
