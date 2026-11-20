import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { eachWeekOfInterval, format, parseISO, startOfWeek, subWeeks } from "date-fns";
import { Download } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { fmtMinutes, loggedByTask, entryMinutes, setTotals } from "../lib/time";
import { exportTimeToExcel } from "../lib/excel";
import { Avatar, Button, Card, PageHeader, Select, Spinner, Tabs, cx } from "../components/ui";
import { TimeBar, useNow } from "../components/TimeTracking";
import { PeopleBreakdown, SummaryCards, WeeklyChart, usePeriod } from "../components/TimeReports";

type View = "projects" | "timesheet";

/** Time across all projects: estimate vs logged per project, who logged it, and a weekly timesheet. */
export default function TimePage() {
  const store = useStore();
  const { me } = useAuth();
  const now = useNow(30_000);
  const { range, inRange, picker } = usePeriod();
  const [view, setView] = useState<View>("projects");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState<"open" | "all">("open");
  const [person, setPerson] = useState("");

  const projects = useMemo(() => store.projects
    .filter((p) => p.approval !== "pending" && p.approval !== "rejected")
    .filter((p) => scope === "all" || (p.status !== "completed" && p.status !== "cancelled"))
    .filter((p) => !category || p.category_id === category)
    .sort((a, b) => a.code.localeCompare(b.code)), [store.projects, scope, category]);
  const ids = new Set(projects.map((p) => p.id));
  const tasks = store.tasks.filter((t) => ids.has(t.project_id));
  const entries = store.timeEntries.filter((e) => ids.has(e.project_id) && inRange(e) && (!person || e.user_id === person));
  const logged = loggedByTask(entries, now);
  const all = setTotals(tasks, logged);

  if (!store.ready) return <Spinner />;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Time" subtitle="Estimated and logged hours across projects"
        actions={<Button icon={<Download className="size-4" />}
          onClick={() => exportTimeToExcel(`Idea2Launch-time${range ? `-${range[0]}-to-${range[1]}` : ""}.xlsx`, projects, tasks, entries, store)}>Excel</Button>} />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm text-slate-600">Logged time for</span>{picker}
        <Select aria-label="Projects" value={scope} onChange={(e) => setScope(e.target.value as "open" | "all")} className="h-8 w-auto py-1 text-[13px]">
          <option value="open">Open projects</option>
          <option value="all">All projects</option>
        </Select>
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-auto py-1 text-[13px]">
          <option value="">All categories</option>
          {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)} className="h-8 w-auto py-1 text-[13px]">
          <option value="">Everyone</option>
          {me && <option value={me.id}>Only me</option>}
          {store.profiles.filter((p) => p.id !== me?.id && p.is_active).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </Select>
      </Card>

      <SummaryCards estimate={all.estimate} logged={all.logged}
        extra={(range || person) && <div className="mt-1 text-xs text-slate-400">Estimates are for the whole projects.</div>} />

      <div className="mt-4">
        <Tabs value={view} onChange={setView} tabs={[{ id: "projects", label: "By project" }, { id: "timesheet", label: "Timesheet" }]} />
      </div>

      {view === "projects" ? (
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_70px_70px_80px] gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium tracking-wide text-slate-500 uppercase sm:grid-cols-[minmax(0,1fr)_80px_80px_90px_140px]">
              <span>Project</span><span className="text-right">Estimate</span><span className="text-right">Logged</span><span className="text-right">Left</span><span className="hidden sm:block" />
            </div>
            {projects.map((p) => {
              const t = setTotals(tasks.filter((x) => x.project_id === p.id), logged);
              return (
                <Link key={p.id} to={`/projects/${p.id}?view=time`}
                  className="grid grid-cols-[minmax(0,1fr)_70px_70px_80px] items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_80px_80px_90px_140px]">
                  <span className="min-w-0 truncate"><span className="mr-2 font-mono text-xs text-slate-500">{p.code}</span>{p.name}</span>
                  <span className="text-right tabular-nums">{fmtMinutes(t.estimate, "–")}</span>
                  <span className="text-right tabular-nums">{fmtMinutes(t.logged, "–")}</span>
                  <span className={cx("text-right tabular-nums", t.over > 0 && "text-red-600")}>{t.over ? `+${fmtMinutes(t.over)}` : t.estimate ? fmtMinutes(t.remaining) : "–"}</span>
                  <span className="hidden sm:block"><TimeBar estimate={t.estimate} logged={t.logged} /></span>
                </Link>
              );
            })}
            {!projects.length && <p className="p-6 text-center text-sm text-slate-500">No projects match.</p>}
            {projects.length > 0 && (
              <div className="grid grid-cols-[minmax(0,1fr)_70px_70px_80px] items-center gap-2 border-t-2 border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold sm:grid-cols-[minmax(0,1fr)_80px_80px_90px_140px]">
                <span>Total ({projects.length} projects)</span>
                <span className="text-right tabular-nums">{fmtMinutes(all.estimate, "–")}</span>
                <span className="text-right tabular-nums">{fmtMinutes(all.logged, "–")}</span>
                <span className={cx("text-right tabular-nums", all.over > 0 && "text-red-600")}>{all.over ? `+${fmtMinutes(all.over)}` : fmtMinutes(all.remaining, "–")}</span>
                <span className="hidden sm:block"><TimeBar estimate={all.estimate} logged={all.logged} /></span>
              </div>
            )}
          </Card>
          <div className="space-y-4">
            <Card className="p-4"><h3 className="mb-3 font-semibold text-slate-900">Who logged time</h3><PeopleBreakdown entries={entries} now={now} /></Card>
            <Card className="p-4"><h3 className="font-semibold text-slate-900">Hours per week</h3><WeeklyChart entries={entries} now={now} /></Card>
          </div>
        </div>
      ) : (
        <Timesheet entries={entries} now={now} range={range} />
      )}
    </div>
  );
}

/** People × weeks grid of logged hours. */
function Timesheet({ entries, now, range }: { entries: ReturnType<typeof useStore>["timeEntries"]; now: number; range: [string, string] | null }) {
  const store = useStore();
  const ws = store.settings.week_starts_on;
  const { weeks, rows } = useMemo(() => {
    const end = range && range[1] < "9999" ? parseISO(range[1]) : new Date();
    const start = range && range[0] > "0000-01-01" ? parseISO(range[0]) : subWeeks(end, 7);
    const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: ws }).slice(-12).map((w) => format(w, "yyyy-MM-dd"));
    const byUser = new Map<string, Map<string, number>>();
    for (const e of entries) {
      const k = format(startOfWeek(parseISO(e.entry_date), { weekStartsOn: ws }), "yyyy-MM-dd");
      if (!weeks.includes(k)) continue;
      if (!byUser.has(e.user_id)) byUser.set(e.user_id, new Map());
      const m = byUser.get(e.user_id)!;
      m.set(k, (m.get(k) ?? 0) + entryMinutes(e, now));
    }
    const rows = [...byUser.entries()].map(([uid, m]) => ({ uid, m, total: [...m.values()].reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total);
    return { weeks, rows };
  }, [entries, now, range, ws]);

  if (!rows.length) return <Card className="mt-3 p-8 text-center text-sm text-slate-500">No time logged in these weeks.</Card>;
  const colTotal = (w: string) => rows.reduce((a, r) => a + (r.m.get(w) ?? 0), 0);
  return (
    <Card className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <th className="px-4 py-2 text-left font-medium">Person</th>
            {weeks.map((w) => <th key={w} className="px-2 py-2 text-right font-medium whitespace-nowrap">Wk {format(parseISO(w), "d MMM")}</th>)}
            <th className="px-4 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = store.profileById.get(r.uid);
            return (
              <tr key={r.uid} className="border-b border-slate-100">
                <td className="px-4 py-2"><span className="flex items-center gap-2"><Avatar person={p} size={22} />{p?.full_name ?? "Former member"}</span></td>
                {weeks.map((w) => <td key={w} className="px-2 py-2 text-right tabular-nums text-slate-700">{r.m.get(w) ? fmtMinutes(r.m.get(w)!) : <span className="text-slate-300">–</span>}</td>)}
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmtMinutes(r.total)}</td>
              </tr>
            );
          })}
          <tr className="bg-slate-50 font-semibold">
            <td className="px-4 py-2">Total</td>
            {weeks.map((w) => <td key={w} className="px-2 py-2 text-right tabular-nums">{fmtMinutes(colTotal(w), "–")}</td>)}
            <td className="px-4 py-2 text-right tabular-nums">{fmtMinutes(rows.reduce((a, r) => a + r.total, 0))}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}
