import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addMonths, addWeeks, endOfMonth, format, isSameMonth, isSameWeek, parseISO, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, AlertTriangle, Info, X } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { PRIORITIES, PRIORITY_LABEL, ROLES, ROLE_LABEL, TASK_STATUS_LABEL } from "../lib/format";
import { overlaps, taskWindow, today, weekRange, isOverdue } from "../lib/metrics";
import type { Priority, Role, Task, TaskStatus } from "../lib/types";
import { Avatar, Button, Card, Input, PageHeader, Select, Spinner, cx } from "../components/ui";
import { DueBadge } from "../components/TaskPanel";

type Unit = "week" | "month";
type CountAs = "both" | "owner" | "collab";
interface Filters {
  unit: Unit; count: number; from: string; category: string; project: string; role: "" | Role; person: string;
  status: "" | TaskStatus; priority: "" | Priority; countAs: CountAs; hideEmpty: boolean;
}
const OPEN_STATUSES: TaskStatus[] = ["todo", "in_progress", "review"];
const DEFAULTS: Filters = { unit: "week", count: 8, from: "", category: "", project: "", role: "", person: "", status: "", priority: "", countAs: "both", hideEmpty: false };
const STORE_KEY = "i2l.workloadFilters";
function loadFilters(): Filters {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}"), from: "" }; } catch { return DEFAULTS; }
}

export default function Workload() {
  const store = useStore();
  const { me } = useAuth();
  const [f, setF] = useState<Filters>(loadFilters);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((o) => {
    const n = { ...o, [k]: v, ...(k === "category" ? { project: "" } : {}) };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  const [selected, setSelected] = useState<{ person: string; week: number | "none" } | null>(null);
  const threshold = Number(store.settings.overload_threshold) || 25;
  const ws = store.settings.week_starts_on;
  // the overload limit is per week; a month column allows about 4.3 weeks of it
  const limit = f.unit === "month" ? Math.round(threshold * 4.3) : threshold;

  const fromDate = f.from ? parseISO(f.from) : today();
  const weeks = useMemo(() => Array.from({ length: f.count }, (_, i) => f.unit === "week"
    ? weekRange(addWeeks(fromDate, i), ws)
    : { start: startOfMonth(addMonths(fromDate, i)), end: endOfMonth(addMonths(fromDate, i)) }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [f.from, f.unit, f.count, ws]);
  const shift = (dir: number) => {
    const step = Math.max(1, Math.floor(f.count / 2)) * dir;
    const d = f.unit === "week" ? addWeeks(fromDate, step) : addMonths(fromDate, step);
    set("from", format(d, "yyyy-MM-dd"));
  };
  const people = useMemo(() => store.profiles.filter((p) => p.is_active && p.role !== "viewer"
    && (!f.role || p.role === f.role) && (!f.person || p.id === f.person)), [store.profiles, f.role, f.person]);
  const projects = useMemo(() => store.projects.filter((p) => !f.category || p.category_id === f.category)
    .sort((a, b) => a.code.localeCompare(b.code)), [store.projects, f.category]);

  const openTasks = useMemo(() => store.tasks.filter((t) => {
    if (t.status === "done") return false;
    if (f.status && t.status !== f.status) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.project && t.project_id !== f.project) return false;
    if (f.category && store.projectById.get(t.project_id)?.category_id !== f.category) return false;
    return true;
  }), [store.tasks, store.projectById, f.status, f.priority, f.project, f.category]);

  const grid = useMemo(() => {
    const rows = new Map<string, { weeks: Task[][]; none: Task[]; total: number; overdue: number }>();
    for (const p of people) rows.set(p.id, { weeks: weeks.map(() => []), none: [], total: 0, overdue: 0 });
    // A task counts for its owner and for each collaborator (unless filtered to one of them).
    const collabs = new Map<string, string[]>();
    for (const c of store.collaborators) collabs.set(c.task_id, [...(collabs.get(c.task_id) ?? []), c.user_id]);
    for (const t of openTasks) {
      const who = new Set([
        ...(f.countAs !== "collab" && t.owner_id ? [t.owner_id] : []),
        ...(f.countAs !== "owner" ? (collabs.get(t.id) ?? []).filter((id) => id !== t.owner_id) : []),
      ]);
      const w = taskWindow(t);
      for (const id of who) {
        const row = rows.get(id);
        if (!row) continue;
        row.total++;
        if (isOverdue(t)) row.overdue++;
        if (!w) { row.none.push(t); continue; }
        weeks.forEach((wk, i) => { if (overlaps(w, wk)) row.weeks[i].push(t); });
      }
    }
    return rows;
  }, [people, openTasks, weeks, store.collaborators, f.countAs]);

  const sorted = useMemo(() => [...people]
    .filter((p) => !f.hideEmpty || (grid.get(p.id)?.total ?? 0) > 0)
    .sort((a, b) => (grid.get(b.id)?.weeks[0].length ?? 0) - (grid.get(a.id)?.weeks[0].length ?? 0) || a.full_name.localeCompare(b.full_name)), [people, grid, f.hideEmpty]);
  const active = (["category", "project", "role", "person", "status", "priority"] as const).filter((k) => f[k]).length
    + (f.countAs !== "both" ? 1 : 0) + (f.hideEmpty ? 1 : 0);
  const clear = () => setF(() => { const n = { ...DEFAULTS, unit: f.unit, count: f.count, from: f.from }; try { localStorage.setItem(STORE_KEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const isCurrent = (d: Date) => f.unit === "week" ? isSameWeek(d, today(), { weekStartsOn: ws }) : isSameMonth(d, today());

  if (!store.ready) return <Spinner />;
  const overloaded = sorted.filter((p) => grid.get(p.id)!.weeks.some((w) => w.length > limit));
  const selTasks = selected ? (selected.week === "none" ? grid.get(selected.person)!.none : grid.get(selected.person)!.weeks[selected.week]) : [];
  const selPerson = selected ? store.profileById.get(selected.person) : undefined;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Workload" subtitle={<>Open tasks per person per {f.unit}. More than <b>{threshold}</b> in a week counts as overloaded{me?.role === "admin" ? <> (change it in <Link to="/admin?tab=settings" className="text-brand-600 hover:underline">Admin panel</Link>)</> : null}.</>}
        actions={
          <div className="flex items-center rounded-lg bg-white ring-1 ring-slate-300">
            <button aria-label="Earlier" className="p-2 text-slate-500 hover:text-slate-900" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></button>
            <button className="px-2 text-sm font-medium" onClick={() => set("from", "")}>{f.unit === "week" ? "This week" : "This month"}</button>
            <button aria-label="Later" className="p-2 text-slate-500 hover:text-slate-900" onClick={() => shift(1)}><ChevronRight className="size-4" /></button>
          </div>
        } />

      <Card className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Filter label="From">
            <Input type="date" aria-label="From" value={f.from || format(weeks[0].start, "yyyy-MM-dd")} onChange={(e) => set("from", e.target.value)} />
          </Filter>
          <Filter label="Show">
            <Select aria-label="Show" value={`${f.count}-${f.unit}`} onChange={(e) => { const [n, u] = e.target.value.split("-"); setF((o) => { const v = { ...o, count: Number(n), unit: u as Unit }; try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* ignore */ } return v; }); }}>
              <option value="4-week">4 weeks</option>
              <option value="8-week">8 weeks</option>
              <option value="12-week">12 weeks</option>
              <option value="26-week">26 weeks</option>
              <option value="3-month">3 months</option>
              <option value="6-month">6 months</option>
              <option value="12-month">12 months</option>
            </Select>
          </Filter>
          <Filter label="Category">
            <Select aria-label="Category" value={f.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">All categories</option>
              {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Filter>
          <Filter label="Project">
            <Select aria-label="Project" value={f.project} onChange={(e) => set("project", e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </Select>
          </Filter>
          <Filter label="Role">
            <Select aria-label="Role" value={f.role} onChange={(e) => set("role", e.target.value as "" | Role)}>
              <option value="">All roles</option>
              {ROLES.filter((r) => r !== "viewer").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Filter>
          <Filter label="Person">
            <Select aria-label="Person" value={f.person} onChange={(e) => set("person", e.target.value)}>
              <option value="">Everyone</option>
              {store.profiles.filter((p) => p.is_active && p.role !== "viewer").map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </Select>
          </Filter>
          <Filter label="Task status">
            <Select aria-label="Task status" value={f.status} onChange={(e) => set("status", e.target.value as "" | TaskStatus)}>
              <option value="">All open tasks</option>
              {OPEN_STATUSES.map((st) => <option key={st} value={st}>{TASK_STATUS_LABEL[st]}</option>)}
            </Select>
          </Filter>
          <Filter label="Priority">
            <Select aria-label="Priority" value={f.priority} onChange={(e) => set("priority", e.target.value as "" | Priority)}>
              <option value="">Any priority</option>
              {PRIORITIES.map((pr) => <option key={pr} value={pr}>{PRIORITY_LABEL[pr]}</option>)}
            </Select>
          </Filter>
          <Filter label="Count tasks where they are">
            <Select aria-label="Count tasks where they are" value={f.countAs} onChange={(e) => set("countAs", e.target.value as CountAs)}>
              <option value="both">Owner or collaborator</option>
              <option value="owner">Owner only</option>
              <option value="collab">Collaborator only</option>
            </Select>
          </Filter>
          <Filter label="People shown">
            <Select aria-label="People shown" value={f.hideEmpty ? "busy" : "all"} onChange={(e) => set("hideEmpty", e.target.value === "busy")}>
              <option value="all">Everyone</option>
              <option value="busy">With tasks only</option>
            </Select>
          </Filter>
          {active > 0 && (
            <div className="flex items-end">
              <Button variant="ghost" onClick={clear}><X className="size-4" /> Clear {active} filter{active === 1 ? "" : "s"}</Button>
            </div>
          )}
        </div>
      </Card>

      {overloaded.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span><b>{overloaded.map((p) => p.full_name).join(", ")}</b> {overloaded.length > 1 ? "have" : "has"} more than {limit} open tasks in at least one {f.unit} shown.</span>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-left font-medium">Person</th>
                <th className="px-2 py-2 font-medium">Open</th>
                {weeks.map((w, i) => (
                  <th key={i} className={cx("whitespace-nowrap px-2 py-2 font-medium", isCurrent(w.start) && "text-brand-600")}>
                    {f.unit === "week" ? format(w.start, "d MMM") : format(w.start, "MMM yy")}
                  </th>
                ))}
                <th className="px-2 py-2 font-medium">No date</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={weeks.length + 3} className="px-4 py-6 text-center text-sm text-slate-500">No one matches these filters.</td></tr>
              )}
              {sorted.map((p) => {
                const row = grid.get(p.id)!;
                return (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar person={p} size={28} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.full_name}</p>
                          <p className="truncate text-xs text-slate-500">{p.job_title || ROLE_LABEL[p.role]}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className="font-semibold tabular-nums">{row.total}</span>
                      {row.overdue > 0 && <span className="block text-[11px] text-red-600">{row.overdue} late</span>}
                    </td>
                    {row.weeks.map((list, i) => (
                      <td key={i} className="px-1 py-1.5 text-center">
                        <Cell n={list.length} threshold={limit} active={selected?.person === p.id && selected.week === i}
                          onClick={() => setSelected(selected?.person === p.id && selected.week === i ? null : { person: p.id, week: i })} />
                      </td>
                    ))}
                    <td className="px-1 py-1.5 text-center">
                      <Cell n={row.none.length} threshold={Infinity} muted active={selected?.person === p.id && selected.week === "none"}
                        onClick={() => setSelected(selected?.person === p.id && selected.week === "none" ? null : { person: p.id, week: "none" })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          <Legend className="bg-emerald-100" label="Light" />
          <Legend className="bg-amber-100" label={`Busy (over ${Math.round(limit * 0.7)})`} />
          <Legend className="bg-red-500" label={`Overloaded (over ${limit}${f.unit === "month" ? " a month" : ""})`} />
          <span className="flex items-center gap-1"><Info className="size-3.5" />A task counts in every {f.unit} between its start and due date. Late tasks count up to today.</span>
        </div>
      </Card>

      {selected && selPerson && (
        <Card className="mt-4">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold">
              {selPerson.full_name} · {selected.week === "none" ? "tasks without dates" : f.unit === "week" ? `week of ${format(weeks[selected.week].start, "d MMM")}` : format(weeks[selected.week].start, "MMMM yyyy")} ({selTasks.length})
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          </div>
          <ul className="divide-y divide-slate-100">
            {selTasks.map((t) => <SelRow key={t.id} t={t} collab={t.owner_id !== selected.person} />)}
            {selTasks.length === 0 && <li className="px-4 py-4 text-sm text-slate-500">No open tasks.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>{children}</label>;
}

function Cell({ n, threshold, onClick, active, muted }: { n: number; threshold: number; onClick: () => void; active: boolean; muted?: boolean }) {
  const tone = n === 0 ? "bg-slate-50 text-slate-300" : muted ? "bg-slate-100 text-slate-600"
    : n > threshold ? "bg-red-500 text-white font-semibold" : n > threshold * 0.7 ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900";
  return (
    <button onClick={onClick} disabled={n === 0} aria-label={`${n} tasks`}
      className={cx("h-9 w-full min-w-12 rounded-md tabular-nums transition", tone, active && "ring-2 ring-navy-900", n > 0 && "hover:brightness-95")}>
      {n || "·"}
    </button>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cx("size-3 rounded", className)} />{label}</span>;
}

function SelRow({ t, collab }: { t: Task; collab: boolean }) {
  const store = useStore();
  const p = store.projectById.get(t.project_id);
  return (
    <li>
      <Link to={`/projects/${t.project_id}?task=${t.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{t.title}</span>
          <span className="block truncate text-xs text-slate-500">{p?.code} · {p?.name}{collab ? " · collaborator" : ""}</span>
        </span>
        <DueBadge task={t} />
      </Link>
    </li>
  );
}
