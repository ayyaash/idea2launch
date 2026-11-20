import { useMemo, useState } from "react";
import {
  endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subMonths, subWeeks, eachWeekOfInterval, parseISO, min as minDate, max as maxDate,
} from "date-fns";
import { AlertTriangle, Download } from "lucide-react";
import { useStore } from "../lib/store";
import { fmtMinutes, loggedByTask, entryMinutes, setTotals, taskTotals, totals, toHours } from "../lib/time";
import type { Project, Task, TimeEntry } from "../lib/types";
import { Avatar, Button, Card, Input, Select, cx } from "./ui";
import { TimeBar, useNow } from "./TimeTracking";
import { useOpenTask } from "./TaskPanel";

export type Period = "all" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";
export const PERIOD_LABEL: Record<Period, string> = {
  all: "All time", this_week: "This week", last_week: "Last week", this_month: "This month", last_month: "Last month", custom: "Custom dates",
};

/** Period picker + the date range it stands for (null = no limit). */
export function usePeriod() {
  const store = useStore();
  const ws = store.settings.week_starts_on;
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = useMemo<[string, string] | null>(() => {
    const d = new Date();
    const f = (x: Date) => format(x, "yyyy-MM-dd");
    switch (period) {
      case "this_week": return [f(startOfWeek(d, { weekStartsOn: ws })), f(endOfWeek(d, { weekStartsOn: ws }))];
      case "last_week": { const w = subWeeks(d, 1); return [f(startOfWeek(w, { weekStartsOn: ws })), f(endOfWeek(w, { weekStartsOn: ws }))]; }
      case "this_month": return [f(startOfMonth(d)), f(endOfMonth(d))];
      case "last_month": { const m = subMonths(d, 1); return [f(startOfMonth(m)), f(endOfMonth(m))]; }
      case "custom": return from || to ? [from || "0000-01-01", to || "9999-12-31"] : null;
      default: return null;
    }
  }, [period, from, to, ws]);
  const inRange = (e: TimeEntry) => !range || (e.entry_date >= range[0] && e.entry_date <= range[1]);
  const picker = (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="h-8 w-auto py-1 text-[13px]">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
      </Select>
      {period === "custom" && (
        <>
          <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto py-1 text-[13px]" />
          <span className="text-sm text-slate-500">to</span>
          <Input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto py-1 text-[13px]" />
        </>
      )}
    </div>
  );
  return { period, range, inRange, picker };
}

export function SummaryCards({ estimate, logged, extra }: { estimate: number; logged: number; extra?: React.ReactNode }) {
  const t = totals(estimate, logged);
  const pct = estimate ? Math.round(t.used * 100) : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card className="p-4"><div className="text-xl font-semibold tabular-nums sm:text-2xl">{fmtMinutes(estimate, "–")}</div><div className="text-sm text-slate-500">Estimated</div></Card>
      <Card className="p-4"><div className="text-xl font-semibold tabular-nums sm:text-2xl">{fmtMinutes(logged)}</div><div className="text-sm text-slate-500">Logged</div></Card>
      <Card className="p-4">
        <div className={cx("text-xl font-semibold tabular-nums sm:text-2xl", t.over > 0 && "text-red-600")}>{t.over ? fmtMinutes(t.over) : fmtMinutes(t.remaining, "–")}</div>
        <div className="text-sm text-slate-500">{t.over ? "Over estimate" : "Remaining"}</div>
      </Card>
      <Card className="p-4">
        <div className={cx("text-xl font-semibold tabular-nums sm:text-2xl", pct != null && pct > 100 && "text-red-600")}>{pct == null ? "–" : `${pct}%`}</div>
        <div className="text-sm text-slate-500">Of estimate used</div>
        {extra}
      </Card>
    </div>
  );
}

/** Vertical bars of logged hours per week. */
export function WeeklyChart({ entries, now }: { entries: TimeEntry[]; now: number }) {
  const store = useStore();
  const ws = store.settings.week_starts_on;
  const weeks = useMemo(() => {
    if (!entries.length) return [];
    const dates = entries.map((e) => parseISO(e.entry_date));
    const end = maxDate(dates);
    const start = maxDate([minDate(dates), subWeeks(end, 25)]);
    const list = eachWeekOfInterval({ start, end }, { weekStartsOn: ws }).map((w) => ({ key: format(w, "yyyy-MM-dd"), label: format(w, "d MMM"), min: 0 }));
    const idx = new Map(list.map((w, i) => [w.key, i]));
    for (const e of entries) {
      const k = format(startOfWeek(parseISO(e.entry_date), { weekStartsOn: ws }), "yyyy-MM-dd");
      const i = idx.get(k);
      if (i != null) list[i].min += entryMinutes(e, now);
    }
    return list;
  }, [entries, ws, now]);
  if (!weeks.length) return <p className="py-6 text-center text-sm text-slate-500">No time logged yet.</p>;
  const max = Math.max(...weeks.map((w) => w.min), 60);
  return (
    <div className="flex h-44 items-end gap-1 overflow-x-auto pt-4">
      {weeks.map((w) => (
        <div key={w.key} className="flex min-w-7 flex-1 flex-col items-center gap-1" title={`Week of ${w.label}: ${fmtMinutes(w.min)}`}>
          <span className="text-[10px] text-slate-500 tabular-nums">{w.min ? toHours(w.min) : ""}</span>
          <div className="w-full rounded-t bg-brand-500/85" style={{ height: `${(w.min / max) * 110}px` }} />
          <span className="text-[10px] whitespace-nowrap text-slate-500">{w.label}</span>
        </div>
      ))}
    </div>
  );
}

export function PeopleBreakdown({ entries, now }: { entries: TimeEntry[]; now: number }) {
  const store = useStore();
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.user_id, (m.get(e.user_id) ?? 0) + entryMinutes(e, now));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries, now]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-500">No time logged in this period.</p>;
  return (
    <ul className="space-y-2">
      {rows.map(([uid, min]) => {
        const p = store.profileById.get(uid);
        return (
          <li key={uid} className="flex items-center gap-2.5 text-sm">
            <Avatar person={p} size={24} />
            <span className="w-36 truncate">{p?.full_name ?? "Former member"}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-brand-500" style={{ width: `${(min / total) * 100}%` }} /></span>
            <span className="w-16 text-right font-medium tabular-nums">{fmtMinutes(min)}</span>
            <span className="w-10 text-right text-xs text-slate-500 tabular-nums">{Math.round((min / total) * 100)}%</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The project page "Time" tab. */
export function ProjectTime({ project }: { project: Project }) {
  const store = useStore();
  const now = useNow(30_000);
  const openTask = useOpenTask();
  const { range, inRange, picker } = usePeriod();
  const tasks = useMemo(() => store.tasks.filter((t) => t.project_id === project.id), [store.tasks, project.id]);
  const allEntries = useMemo(() => store.timeEntries.filter((e) => e.project_id === project.id), [store.timeEntries, project.id]);
  const entries = allEntries.filter(inRange);
  const logged = loggedByTask(entries, now);
  const whole = setTotals(tasks, logged);
  const sections = store.sectionsOf(project.id);
  const top = tasks.filter((t) => !t.parent_id);
  const noEstimate = top.filter((t) => t.status !== "done" && taskTotals(t, tasks, new Map()).estimate === 0).length;

  const groups = [
    ...sections.map((s) => ({ key: s.id, name: s.name, tasks: top.filter((t) => t.section_id === s.id) })),
    { key: "none", name: sections.length ? "No phase" : "Tasks", tasks: top.filter((t) => !t.section_id || !sections.some((s) => s.id === t.section_id)) },
  ].filter((g) => g.tasks.length);

  return (
    <div className="mt-3 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-slate-600">Logged time for {picker}</div>
        <Button icon={<Download className="size-4" />}
          onClick={async () => { const { exportTimeToExcel } = await import("../lib/excel"); exportTimeToExcel(`${project.code}-time.xlsx`, [project], tasks, entries, store); }}>
          Time report (Excel)
        </Button>
      </div>

      <SummaryCards estimate={whole.estimate} logged={whole.logged}
        extra={range && <div className="mt-1 text-xs text-slate-400">Estimates are for the whole project.</div>} />

      {noEstimate > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <AlertTriangle className="size-4" /> {noEstimate} open task{noEstimate > 1 ? "s have" : " has"} no time estimate, so the project estimate is lower than it should be.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_70px_70px_80px] gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium tracking-wide text-slate-500 uppercase sm:grid-cols-[minmax(0,1fr)_80px_80px_90px_120px]">
            <span>Task</span><span className="text-right">Estimate</span><span className="text-right">Logged</span><span className="text-right">Left</span><span className="hidden sm:block" />
          </div>
          {groups.map((g) => {
            const gt = setTotals(tasks.filter((t) => g.tasks.some((x) => x.id === t.id || x.id === t.parent_id)), logged);
            return (
              <div key={g.key}>
                <Row strong name={g.name} t={gt} />
                {g.tasks.map((t) => <Row key={t.id} name={t.title} task={t} t={taskTotals(t, tasks, logged)} onClick={() => openTask(t.id)}
                  sub={tasks.filter((s) => s.parent_id === t.id).length} />)}
              </div>
            );
          })}
          {!groups.length && <p className="p-6 text-center text-sm text-slate-500">No tasks yet.</p>}
          {groups.length > 0 && <Row strong total name="Project total" t={whole} />}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-3 font-semibold text-slate-900">Who logged time</h3>
            <PeopleBreakdown entries={entries} now={now} />
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold text-slate-900">Hours per week</h3>
            <WeeklyChart entries={entries} now={now} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ name, t, strong, total, task, onClick, sub }: {
  name: string; t: ReturnType<typeof totals>; strong?: boolean; total?: boolean; task?: Task; onClick?: () => void; sub?: number;
}) {
  const store = useStore();
  const owner = task?.owner_id ? store.profileById.get(task.owner_id) : undefined;
  return (
    <div className={cx("grid grid-cols-[minmax(0,1fr)_70px_70px_80px] items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_80px_80px_90px_120px]",
      strong && "bg-slate-50/70 font-semibold", total && "border-t-2 border-slate-200 bg-navy-50/40")}>
      {onClick ? (
        <button onClick={onClick} className="flex min-w-0 items-center gap-2 pl-3 text-left hover:text-brand-600">
          {owner && <Avatar person={owner} size={20} />}
          <span className={cx("truncate", task?.status === "done" && "text-slate-400 line-through")}>{name}</span>
          {!!sub && <span className="shrink-0 text-xs text-slate-400">+{sub} subtask{sub > 1 ? "s" : ""}</span>}
        </button>
      ) : <span className="truncate">{name}</span>}
      <span className="text-right tabular-nums">{fmtMinutes(t.estimate, "–")}</span>
      <span className="text-right tabular-nums">{fmtMinutes(t.logged, "–")}</span>
      <span className={cx("text-right tabular-nums", t.over > 0 && "text-red-600")}>{t.over ? `+${fmtMinutes(t.over)}` : t.estimate ? fmtMinutes(t.remaining) : "–"}</span>
      <span className="hidden sm:block"><TimeBar estimate={t.estimate} logged={t.logged} /></span>
    </div>
  );
}

/** Small "logged / estimate" text for lists. */
export function ProjectTimeText({ projectId, empty }: { projectId: string; empty?: boolean }) {
  const store = useStore();
  const tasks = store.tasks.filter((t) => t.project_id === projectId);
  const logged = loggedByTask(store.timeEntries.filter((e) => e.project_id === projectId));
  const t = setTotals(tasks, logged);
  if (!t.estimate && !t.logged) return empty ? <span className="text-slate-400">No time logged</span> : null;
  return (
    <span className={cx("tabular-nums", t.over ? "text-red-600" : empty ? "" : "text-xs text-slate-500")} title="Logged / estimated">
      {fmtMinutes(t.logged)} of {fmtMinutes(t.estimate, "no estimate")}{empty ? " logged" : ""}
    </span>
  );
}

