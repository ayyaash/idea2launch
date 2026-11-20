import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays } from "date-fns";
import { ChevronLeft, ChevronRight, FolderKanban, AlertTriangle, CalendarClock, CheckCircle2, Download, Plus, Filter } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { PROJECT_STATUSES, PROJECT_STATUS_BAR, PROJECT_STATUS_LABEL, PROJECT_STATUS_STYLE, fmtShort, isoDay } from "../lib/format";
import { inYear, isOverdue, isoToday, monthRange, progressOf, today, weekRange, yearBar } from "../lib/metrics";
import { canCreateProject } from "../lib/perms";
import { exportToExcel } from "../lib/excel";
import type { Project, ProjectStatus, Task } from "../lib/types";
import { Avatar, Button, Card, EmptyState, PageHeader, Pill, Select, Spinner, cx } from "../components/ui";
import { ProjectForm } from "../components/ProjectForm";
import { DueBadge } from "../components/TaskPanel";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function Dashboard() {
  const store = useStore();
  const { me } = useAuth();
  const nav = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"" | ProjectStatus>("");
  const [lead, setLead] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const yearProjects = useMemo(() => store.projects
    .filter((p) => inYear(p, year))
    .filter((p) => !category || (category === "none" ? !p.category_id : p.category_id === category))
    .filter((p) => !status || p.status === status)
    .filter((p) => !lead || p.lead_id === lead)
    .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? "") || a.code.localeCompare(b.code)),
  [store.projects, year, category, status, lead]);

  const kpis = useMemo(() => {
    const ids = new Set(yearProjects.map((p) => p.id));
    const tasks = store.tasks.filter((t) => ids.has(t.project_id));
    const wk = weekRange(today(), store.settings.week_starts_on);
    const mo = monthRange(today());
    const ws = isoDay(wk.start), we = isoDay(wk.end);
    return {
      active: yearProjects.filter((p) => p.status === "active").length,
      overdue: tasks.filter(isOverdue),
      dueWeek: tasks.filter((t) => t.status !== "done" && t.due_date && t.due_date >= isoToday() && t.due_date >= ws && t.due_date <= we),
      doneMonth: tasks.filter((t) => t.completed_at && new Date(t.completed_at) >= mo.start && new Date(t.completed_at) <= mo.end),
    };
  }, [yearProjects, store.tasks, store.settings.week_starts_on]);

  const [listMode, setListMode] = useState<"overdue" | "week">("overdue");

  const groups = useMemo(() => {
    const byCat = new Map<string, Project[]>();
    for (const p of yearProjects) {
      const k = p.category_id ?? "none";
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k)!.push(p);
    }
    const order = [...store.categories.map((c) => c.id), "none"];
    return order.filter((k) => byCat.has(k)).map((k) => ({
      id: k, name: k === "none" ? "No category" : store.categoryById.get(k)?.name ?? "", color: k === "none" ? "#94A3B8" : store.categoryById.get(k)?.color ?? "#94A3B8",
      projects: byCat.get(k)!,
    }));
  }, [yearProjects, store.categories, store.categoryById]);

  if (!store.ready) return <Spinner />;

  const now = new Date();
  const todayPos = now.getFullYear() === year ? (now.getTime() - new Date(year, 0, 1).getTime()) / (new Date(year + 1, 0, 1).getTime() - new Date(year, 0, 1).getTime()) : null;
  const statusCounts = PROJECT_STATUSES.map((s) => ({ s, n: yearProjects.filter((p) => p.status === s).length }));
  const leads = store.profiles.filter((p) => store.projects.some((x) => x.lead_id === p.id));
  const upcoming = store.tasks
    .filter((t) => t.status !== "done" && t.due_date && t.due_date >= isoToday() && t.due_date <= isoDay(addDays(today(), 14)))
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!)).slice(0, 8);

  async function exportYear() {
    const ids = new Set(yearProjects.map((p) => p.id));
    await exportToExcel(`Idea2Launch-${year}.xlsx`, yearProjects, store.tasks.filter((t) => ids.has(t.project_id)), store);
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Dashboard"
        subtitle={`Hello ${me?.full_name.split(" ")[0] ?? ""}. Here's every R&D project running in ${year}.`}
        actions={<>
          <div className="flex items-center rounded-lg bg-white ring-1 ring-slate-300">
            <button aria-label="Previous year" className="p-2 text-slate-500 hover:text-slate-900" onClick={() => setYear(year - 1)}><ChevronLeft className="size-4" /></button>
            <span className="min-w-12 text-center text-sm font-semibold" aria-live="polite">{year}</span>
            <button aria-label="Next year" className="p-2 text-slate-500 hover:text-slate-900" onClick={() => setYear(year + 1)}><ChevronRight className="size-4" /></button>
          </div>
          <Button icon={<Filter className="size-4" />} onClick={() => setShowFilters((s) => !s)} className={cx((category || status || lead) && "ring-brand-400 text-brand-700")}>Filters</Button>
          <Button icon={<Download className="size-4" />} onClick={exportYear}>Excel</Button>
          {canCreateProject(me) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>New project</Button>}
        </>}
      />

      {showFilters && (
        <Card className="mb-4 grid gap-3 p-3 sm:grid-cols-4">
          <Select aria-label="Category filter" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="none">No category</option>
          </Select>
          <Select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | "")}>
            <option value="">All statuses</option>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
          </Select>
          <Select aria-label="Lead filter" value={lead} onChange={(e) => setLead(e.target.value)}>
            <option value="">All leads</option>
            {leads.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
          <Button variant="ghost" onClick={() => { setCategory(""); setStatus(""); setLead(""); }}>Clear filters</Button>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<FolderKanban className="size-5" />} tone="navy" label="Active projects" value={kpis.active} onClick={() => setStatus(status === "active" ? "" : "active")} />
        <Kpi icon={<AlertTriangle className="size-5" />} tone="red" label="Overdue tasks" value={kpis.overdue.length} onClick={() => setListMode("overdue")} active={listMode === "overdue"} />
        <Kpi icon={<CalendarClock className="size-5" />} tone="amber" label="Due this week" value={kpis.dueWeek.length} onClick={() => setListMode("week")} active={listMode === "week"} />
        <Kpi icon={<CheckCircle2 className="size-5" />} tone="green" label="Done this month" value={kpis.doneMonth.length} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Year timeline */}
        <Card className="min-w-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold">Projects in {year} <span className="ml-1 text-sm font-normal text-slate-500">({yearProjects.length})</span></h2>
            <div className="hidden gap-3 text-xs text-slate-500 md:flex">
              {PROJECT_STATUSES.map((s) => (
                <span key={s} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: PROJECT_STATUS_BAR[s] }} />{PROJECT_STATUS_LABEL[s]}</span>
              ))}
            </div>
          </div>
          {yearProjects.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<FolderKanban className="size-8" />} title={`No projects in ${year} yet`}
                text={canCreateProject(me) ? "Create the first project to see it on the timeline." : "Projects will appear here once a manager creates them."}
                action={canCreateProject(me) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>New project</Button>} />
            </div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <div className="min-w-[640px] sm:min-w-[720px]">
                <div className="grid grid-cols-[170px_1fr] sm:grid-cols-[220px_1fr] border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <div className="px-4 py-2">Project</div>
                  <div className="relative grid grid-cols-12">
                    {MONTHS.map((m, i) => (
                      <div key={m} className={cx("border-l border-slate-200 py-2 text-center", now.getFullYear() === year && now.getMonth() === i && "font-semibold text-brand-600")}>{m}</div>
                    ))}
                  </div>
                </div>
                {groups.map((g) => (
                  <div key={g.id}>
                    <div className="flex items-center gap-2 bg-slate-50/60 px-4 py-1.5 text-xs font-semibold text-slate-600">
                      <span className="size-2.5 rounded-full" style={{ background: g.color }} />{g.name}
                      <span className="font-normal text-slate-400">{g.projects.length}</span>
                    </div>
                    {g.projects.map((p) => <TimelineRow key={p.id} p={p} year={year} todayPos={todayPos} tasks={store.tasks} onOpen={() => nav(`/projects/${p.id}`)} />)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* right column */}
        <div className="space-y-5">
          <Card>
            <div className="flex items-center gap-1 border-b border-slate-200 px-2 pt-2">
              {(["overdue", "week"] as const).map((m) => (
                <button key={m} onClick={() => setListMode(m)}
                  className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", listMode === m ? "border-brand-500 text-slate-900" : "border-transparent text-slate-500")}>
                  {m === "overdue" ? `Overdue (${kpis.overdue.length})` : `Due this week (${kpis.dueWeek.length})`}
                </button>
              ))}
            </div>
            <MiniTaskList tasks={listMode === "overdue" ? kpis.overdue : kpis.dueWeek} empty={listMode === "overdue" ? "Nothing overdue. Nice." : "Nothing else due this week."} />
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Projects by status</h3>
            <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
              {statusCounts.filter((x) => x.n).map(({ s, n }) => (
                <div key={s} style={{ width: `${(n / Math.max(1, yearProjects.length)) * 100}%`, background: PROJECT_STATUS_BAR[s] }} title={`${PROJECT_STATUS_LABEL[s]}: ${n}`} />
              ))}
            </div>
            <ul className="space-y-1.5">
              {statusCounts.map(({ s, n }) => (
                <li key={s}>
                  <button onClick={() => setStatus(status === s ? "" : s)} className="flex w-full items-center justify-between text-sm hover:text-brand-600">
                    <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: PROJECT_STATUS_BAR[s] }} />{PROJECT_STATUS_LABEL[s]}</span>
                    <span className="font-medium tabular-nums">{n}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h3 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Coming up (next 14 days)</h3>
            <MiniTaskList tasks={upcoming} empty="No deadlines in the next two weeks." />
          </Card>
        </div>
      </div>

      <ProjectForm open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function Kpi({ icon, label, value, tone, onClick, active }: { icon: React.ReactNode; label: string; value: number; tone: "navy" | "red" | "amber" | "green"; onClick?: () => void; active?: boolean }) {
  const tones = {
    navy: "bg-navy-50 text-navy-700",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-700",
  };
  return (
    <button onClick={onClick} disabled={!onClick}
      className={cx("flex items-center gap-3 rounded-xl bg-white p-4 text-left ring-1 ring-slate-200 transition enabled:hover:ring-slate-300", active && "ring-2 ring-brand-400 enabled:hover:ring-brand-400")}>
      <span className={cx("flex size-10 items-center justify-center rounded-lg", tones[tone])}>{icon}</span>
      <span>
        <span className="block text-2xl leading-tight font-semibold tabular-nums">{value}</span>
        <span className="block text-xs text-slate-500 sm:text-sm">{label}</span>
      </span>
    </button>
  );
}

function TimelineRow({ p, year, todayPos, tasks, onOpen }: { p: Project; year: number; todayPos: number | null; tasks: Task[]; onOpen: () => void }) {
  const store = useStore();
  const bar = yearBar(p, year);
  const prog = progressOf(p.id, tasks);
  const lead = p.lead_id ? store.profileById.get(p.lead_id) : undefined;
  const color = PROJECT_STATUS_BAR[p.status];
  return (
    <div className="group grid grid-cols-[170px_1fr] sm:grid-cols-[220px_1fr] border-b border-slate-100 hover:bg-slate-50">
      <button onClick={onOpen} className="flex min-w-0 items-center gap-2.5 px-4 py-2 text-left">
        <span className="hidden sm:block"><Avatar person={lead} size={26} /></span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-800 group-hover:text-brand-600">{p.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-mono">{p.code}</span>·<span>{prog.pct}%</span>
          </span>
        </span>
      </button>
      <div className="relative">
        <div className="absolute inset-0 grid grid-cols-12">{MONTHS.map((m) => <div key={m} className="border-l border-slate-100" />)}</div>
        {todayPos !== null && <div className="absolute inset-y-0 w-px bg-brand-500/70" style={{ left: `${todayPos * 100}%` }} aria-hidden />}
        <button onClick={onOpen} title={`${p.name}: ${fmtShort(p.start_date) || "?"} – ${fmtShort(p.end_date) || "open"} · ${PROJECT_STATUS_LABEL[p.status]} · ${prog.done}/${prog.total} tasks done`}
          className={cx("absolute top-1/2 h-6 -translate-y-1/2 overflow-hidden text-left shadow-sm", bar.openStart ? "rounded-l-none" : "rounded-l-md", bar.openEnd ? "rounded-r-none" : "rounded-r-md")}
          style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%`, background: `${color}33`, boxShadow: `inset 0 0 0 1px ${color}` }}>
          <span className="absolute inset-y-0 left-0" style={{ width: `${prog.pct}%`, background: color, opacity: 0.85 }} />
          <span className="relative truncate px-2 text-[11px] leading-6 font-medium text-slate-900">{p.code}</span>
        </button>
      </div>
    </div>
  );
}

function MiniTaskList({ tasks, empty }: { tasks: Task[]; empty: string }) {
  const store = useStore();
  if (!tasks.length) return <p className="px-4 py-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto scroll-thin">
      {tasks.slice(0, 40).map((t) => {
        const p = store.projectById.get(t.project_id);
        return (
          <li key={t.id}>
            <Link to={`/projects/${t.project_id}?task=${t.id}`} className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-50">
              <Avatar person={t.owner_id ? store.profileById.get(t.owner_id) : undefined} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{t.title}</span>
                <span className="block truncate text-xs text-slate-500">{p?.code} · {p?.name}</span>
              </span>
              <DueBadge task={t} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectStatusPill({ status }: { status: ProjectStatus }) {
  return <Pill className={PROJECT_STATUS_STYLE[status]}>{PROJECT_STATUS_LABEL[status]}</Pill>;
}
