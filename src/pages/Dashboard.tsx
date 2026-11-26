import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays } from "date-fns";
import { ChevronLeft, ChevronRight, ChevronDown, FolderKanban, AlertTriangle, CalendarClock, CheckCircle2, Download, Plus, Filter } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { PROJECT_STATUSES, PROJECT_STATUS_BAR, PROJECT_STATUS_LABEL, PROJECT_STATUS_STYLE, fmtShort, isoDay } from "../lib/format";
import { inYear, isOverdue, isoToday, monthRange, progressOf, today, weekRange, timelineWindow, scrollWindow, windowBar, type Window } from "../lib/metrics";
import { canCreateProject } from "../lib/perms";
import { PendingApprovals } from "../components/Approval";
import { exportToExcel } from "../lib/excel";
import type { Project, ProjectStatus, Task } from "../lib/types";
import { Avatar, Button, Card, EmptyState, PageHeader, Pill, Select, Spinner, cx } from "../components/ui";
import { ProjectForm } from "../components/ProjectForm";
import { DueBadge } from "../components/TaskPanel";

/** How many months fit in the visible part of the timeline (the rest scrolls). */
type Span = 3 | 6 | 12;
const PROJECT_COL = typeof window !== "undefined" && window.innerWidth < 640 ? 150 : 200;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function Dashboard() {
  const store = useStore();
  const { me } = useAuth();
  const nav = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [category, setCategory] = useState("");
  // categories folded away on the timeline (remembered on this device)
  const [folded, setFolded] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem("i2l.foldedCategories") ?? "[]")); } catch { return new Set(); } });
  const toggleFold = (id: string) => setFolded((f) => {
    const n = new Set(f);
    if (n.has(id)) n.delete(id); else n.add(id);
    try { localStorage.setItem("i2l.foldedCategories", JSON.stringify([...n])); } catch { /* ignore */ }
    return n;
  });
  const [status, setStatus] = useState<"" | ProjectStatus>("");
  const [lead, setLead] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [span, setSpan] = useState<Span>(() => { try { return (Number(localStorage.getItem("i2l.timelineSpan")) || 6) as Span; } catch { return 6; } });
  const scroller = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const changeYear = (y: number) => setYear(y);

  const yearProjects = useMemo(() => store.projects
    .filter((p) => p.approval !== "pending" && p.approval !== "rejected")
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

  const fit = timelineWindow(yearProjects, store.tasks, year);
  const [more, setMore] = useState(0);
  useEffect(() => setMore(0), [year]);
  const win = scrollWindow(yearProjects, store.tasks, year, more);
  // Near the right edge, add another year so the timeline keeps going.
  const onTimelineScroll = () => {
    const el = scroller.current; if (!el) return;
    if (el.scrollLeft + el.clientWidth > el.scrollWidth - monthPx() * span && more < 120) setMore((m) => m + 12);
  };
  const monthPx = () => { const el = scroller.current; return el ? (el.clientWidth - PROJECT_COL) / span : 0; };
  const scrollToMonth = (d: Date, smooth = true) => {
    const el = scroller.current; if (!el) return;
    const i = (d.getFullYear() - win.start.getFullYear()) * 12 + d.getMonth() - win.start.getMonth();
    el.scrollTo({ left: Math.max(0, i * monthPx()), behavior: smooth ? "smooth" : "auto" });
  };
  const scrollBy = (months: number) => scroller.current?.scrollBy({ left: months * monthPx(), behavior: "smooth" });
  // Start where the year's projects are (or this month, in the current year).
  const firstKey = `${year}|${span}|${win.start.getTime()}|${fit.start.getTime()}`;
  useEffect(() => {
    const now0 = new Date();
    const target = year === now0.getFullYear() && now0 >= fit.start ? new Date(now0.getFullYear(), now0.getMonth() - 1, 1) : fit.start;
    requestAnimationFrame(() => scrollToMonth(target < fit.start ? fit.start : target, false));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-place only when the year, zoom or span changes
  }, [firstKey, yearProjects.length > 0]);
  // A mouse wheel over the month header scrolls through time.
  useEffect(() => {
    const h = headerRef.current, el = scroller.current;
    if (!h || !el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    h.addEventListener("wheel", onWheel, { passive: false });
    return () => h.removeEventListener("wheel", onWheel);
  });
  if (!store.ready) return <Spinner />;

  const now = new Date();
  const todayPos = now >= win.start && now < win.end ? (now.getTime() - win.start.getTime()) / (win.end.getTime() - win.start.getTime()) : null;
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
          <div className="flex h-9 items-center rounded-lg bg-white shadow-card ring-1 ring-line">
            <button aria-label="Previous year" className="p-2 text-slate-500 hover:text-ink" onClick={() => changeYear(year - 1)}><ChevronLeft className="size-4" /></button>
            <span className="min-w-12 text-center text-sm font-semibold" aria-live="polite">{year}</span>
            <button aria-label="Next year" className="p-2 text-slate-500 hover:text-ink" onClick={() => changeYear(year + 1)}><ChevronRight className="size-4" /></button>
          </div>
          <Button icon={<Filter className="size-4" />} onClick={() => setShowFilters((s) => !s)} className={cx((category || status || lead) && "ring-brand-400 text-brand-700")}>Filters</Button>
          <Button icon={<Download className="size-4" />} onClick={exportYear}>Excel</Button>
          {canCreateProject(me) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>New project</Button>}
        </>}
      />

      <PendingApprovals />

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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Kpi icon={<FolderKanban className="size-4" />} tone="green" label="Active projects" value={kpis.active} onClick={() => setStatus(status === "active" ? "" : "active")} />
        <Kpi icon={<AlertTriangle className="size-4" />} tone="red" label="Overdue tasks" value={kpis.overdue.length} onClick={() => setListMode("overdue")} active={listMode === "overdue"} />
        <Kpi icon={<CalendarClock className="size-4" />} tone="amber" label="Due this week" value={kpis.dueWeek.length} onClick={() => setListMode("week")} active={listMode === "week"} />
        <Kpi icon={<CheckCircle2 className="size-4" />} tone="indigo" label="Done this month" value={kpis.doneMonth.length} />
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Year timeline */}
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
            <h2 className="flex items-center gap-2 text-[15px] font-bold">Projects in {year} <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{yearProjects.length}</span></h2>
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Months shown" value={span} className="h-8 w-auto py-1 text-[13px]"
                onChange={(e) => { const v = Number(e.target.value) as Span; setSpan(v); try { localStorage.setItem("i2l.timelineSpan", String(v)); } catch { /* ignore */ } }}>
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
              </Select>
              <div className="flex h-8 items-center rounded-lg bg-white shadow-card ring-1 ring-line">
                <button aria-label="Earlier months" className="p-1.5 text-slate-500 hover:text-ink" onClick={() => scrollBy(-Math.max(1, span / 2))}><ChevronLeft className="size-4" /></button>
                <button className="px-1.5 text-[12.5px] font-semibold" onClick={() => scrollToMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1))}>Today</button>
                <button aria-label="Later months" className="p-1.5 text-slate-500 hover:text-ink" onClick={() => scrollBy(Math.max(1, span / 2))}><ChevronRight className="size-4" /></button>
              </div>
            </div>
          </div>
          <div className="hidden justify-end gap-3 border-b border-line-soft px-4 py-1.5 text-xs text-slate-500 md:flex">
              {PROJECT_STATUSES.map((s) => (
                <span key={s} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: PROJECT_STATUS_BAR[s] }} />{PROJECT_STATUS_LABEL[s]}</span>
              ))}
          </div>
          {yearProjects.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<FolderKanban className="size-8" />} title={`No projects in ${year} yet`}
                text={canCreateProject(me) ? "Create the first project to see it on the timeline." : "Projects will appear here once a manager creates them."}
                action={canCreateProject(me) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>New project</Button>} />
            </div>
          ) : (
            <div ref={scroller} onScroll={onTimelineScroll} className="overflow-x-auto scroll-thin" style={{ scrollPaddingLeft: PROJECT_COL }}>
              <div style={{ width: `calc(${PROJECT_COL}px + (100% - ${PROJECT_COL}px) * ${win.months.length / span})`, minWidth: PROJECT_COL + win.months.length * 48 }}>
                <div ref={headerRef} className="sticky top-0 grid border-b border-line-soft bg-slate-50/80 text-xs font-semibold text-slate-500" style={{ gridTemplateColumns: `${PROJECT_COL}px 1fr` }}>
                  <div className="sticky left-0 z-20 bg-slate-50 px-4 py-2.5">Project</div>
                  <div className="relative grid" style={{ gridTemplateColumns: `repeat(${win.months.length}, minmax(0, 1fr))` }}>
                    {win.months.map((m) => (
                      <div key={m.toISOString()} className={cx("truncate border-l py-2.5 text-center whitespace-nowrap", m.getMonth() === 0 ? "border-slate-400" : "border-line",
                        m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth() && "font-bold text-cta")}>
                        {MONTHS[m.getMonth()]}{m.getMonth() === 0 || m === win.months[0] ? ` '${String(m.getFullYear()).slice(2)}` : ""}
                      </div>
                    ))}
                  </div>
                </div>
                {groups.map((g) => (
                  <div key={g.id}>
                    <div className="border-b border-line-soft bg-slate-50/70">
                    <button onClick={() => toggleFold(g.id)} aria-expanded={!folded.has(g.id)}
                      title={folded.has(g.id) ? "Show these projects" : "Hide these projects"}
                      className="sticky left-0 flex w-fit items-center gap-2 rounded-md px-4 py-2 text-[12.5px] font-bold text-slate-700 hover:text-ink">
                      <ChevronDown className={cx("size-4 text-slate-400 transition-transform", folded.has(g.id) && "-rotate-90")} />
                      <span className="size-2.5 rounded-[3px]" style={{ background: g.color }} />{g.name}
                      <span className="font-semibold text-slate-400">{g.projects.length}</span>
                    </button>
                    </div>
                    {!folded.has(g.id) && g.projects.map((p) => <TimelineRow key={p.id} p={p} win={win} todayPos={todayPos} tasks={store.tasks} onOpen={() => nav(`/projects/${p.id}`)} />)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* right column */}
        <div className="space-y-5">
          <Card>
            <div className="flex items-center gap-1 border-b border-line-soft p-1.5">
              {(["overdue", "week"] as const).map((m) => (
                <button key={m} onClick={() => setListMode(m)} aria-pressed={listMode === m}
                  className={cx("flex-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold", listMode === m ? "bg-navy-50 text-navy-900" : "text-slate-500 hover:bg-slate-50 hover:text-ink")}>
                  {m === "overdue" ? `Overdue · ${kpis.overdue.length}` : `Due this week · ${kpis.dueWeek.length}`}
                </button>
              ))}
            </div>
            <MiniTaskList tasks={listMode === "overdue" ? kpis.overdue : kpis.dueWeek} empty={listMode === "overdue" ? "Nothing overdue. Nice." : "Nothing else due this week."} />
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-[14.5px] font-bold">Projects by status</h3>
            <div className="mb-3 flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100">
              {statusCounts.filter((x) => x.n).map(({ s, n }) => (
                <div key={s} style={{ width: `${(n / Math.max(1, yearProjects.length)) * 100}%`, background: PROJECT_STATUS_BAR[s] }} title={`${PROJECT_STATUS_LABEL[s]}: ${n}`} />
              ))}
            </div>
            <ul className="space-y-1.5">
              {statusCounts.map(({ s, n }) => (
                <li key={s}>
                  <button onClick={() => setStatus(status === s ? "" : s)} className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-[13px] text-slate-700 hover:bg-slate-50 hover:text-ink">
                    <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: PROJECT_STATUS_BAR[s] }} />{PROJECT_STATUS_LABEL[s]}</span>
                    <span className="font-medium tabular-nums">{n}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h3 className="flex items-baseline gap-2 border-b border-line-soft px-4 py-3 text-[14.5px] font-bold">Coming up <span className="text-xs font-medium text-slate-500">next 14 days</span></h3>
            <MiniTaskList tasks={upcoming} empty="No deadlines in the next two weeks." />
          </Card>
        </div>
      </div>

      <ProjectForm open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function Kpi({ icon, label, value, tone, onClick, active }: { icon: React.ReactNode; label: string; value: number; tone: "indigo" | "red" | "amber" | "green"; onClick?: () => void; active?: boolean }) {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-600",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-600",
  };
  const alert = tone === "red" && value > 0;
  return (
    <button onClick={onClick} disabled={!onClick}
      className={cx("flex flex-col gap-2 rounded-2xl p-3.5 text-left shadow-card ring-1 transition sm:p-4",
        alert ? "bg-gradient-to-b from-white to-red-50/60 ring-red-200 enabled:hover:ring-red-300" : "bg-white ring-line enabled:hover:ring-slate-300",
        active && "ring-2 ring-navy-400 enabled:hover:ring-navy-400")}>
      <span className="flex items-center gap-2 text-[12.5px] font-medium text-slate-500 sm:text-[13px]">
        <span className={cx("flex size-6 items-center justify-center rounded-md", tones[tone])}>{icon}</span>{label}
      </span>
      <span className={cx("text-[26px] leading-none font-bold tracking-tight tabular-nums sm:text-[28px]", alert && "text-red-600")}>{value}</span>
    </button>
  );
}

function TimelineRow({ p, win, todayPos, tasks, onOpen }: { p: Project; win: Window; todayPos: number | null; tasks: Task[]; onOpen: () => void }) {
  const store = useStore();
  const bar = windowBar(p, win);
  const prog = progressOf(p.id, tasks);
  const lead = p.lead_id ? store.profileById.get(p.lead_id) : undefined;
  const color = PROJECT_STATUS_BAR[p.status];
  return (
    <div className="group grid border-b border-line-soft hover:bg-slate-50/70" style={{ gridTemplateColumns: `${PROJECT_COL}px 1fr` }}>
      <button onClick={onOpen} className="sticky left-0 z-10 flex min-w-0 items-center gap-2.5 bg-white px-4 py-2.5 text-left group-hover:bg-slate-50">
        <span className="hidden sm:block"><Avatar person={lead} size={26} /></span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold text-ink group-hover:text-navy-700">{p.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-mono text-[11px]">{p.code}</span>·<span>{prog.pct}%</span>
          </span>
        </span>
      </button>
      <div className="relative">
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${win.months.length}, minmax(0, 1fr))` }}>{win.months.map((m) => <div key={m.toISOString()} className={cx("border-l", m.getMonth() === 0 ? "border-slate-300" : "border-line-soft")} />)}</div>
        {todayPos !== null && <div className="absolute inset-y-0 w-0.5 bg-brand-500" style={{ left: `${todayPos * 100}%` }} aria-hidden />}
        {bar.outside ? (
          <button onClick={onOpen} className={cx("absolute inset-y-0 flex items-center px-2 text-[11px] text-slate-400 hover:text-brand-600", bar.outside === "before" ? "left-0" : "right-0")}>
            {bar.outside === "before" ? `← ${p.code} ended ${fmtShort(p.end_date)}` : `${p.code} starts ${fmtShort(p.start_date)} →`}
          </button>
        ) : (
        <button onClick={onOpen} title={`${p.name}: ${fmtShort(p.start_date) || "?"} – ${fmtShort(p.end_date) || "open"} · ${PROJECT_STATUS_LABEL[p.status]} · ${prog.done}/${prog.total} tasks done`}
          className={cx("absolute top-1/2 h-7 -translate-y-1/2 overflow-hidden text-left transition-[filter] hover:brightness-95", bar.openStart ? "rounded-l-none" : "rounded-l-lg", bar.openEnd ? "rounded-r-none" : "rounded-r-lg")}
          style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%`, background: `${color}24` }}>
          <span className="absolute inset-y-0 left-0" style={{ width: `${prog.pct}%`, background: `${color}55` }} />
          <span className="relative block truncate px-2.5 text-[11.5px] leading-7 font-semibold" style={{ color: `color-mix(in srgb, ${color} 70%, var(--color-ink))` }}>{PROJECT_STATUS_LABEL[p.status]} · {prog.pct}%</span>
        </button>
        )}
      </div>
    </div>
  );
}

function MiniTaskList({ tasks, empty }: { tasks: Task[]; empty: string }) {
  const store = useStore();
  if (!tasks.length) return <p className="px-4 py-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="max-h-80 divide-y divide-line-soft overflow-y-auto scroll-thin">
      {tasks.slice(0, 40).map((t) => {
        const p = store.projectById.get(t.project_id);
        return (
          <li key={t.id}>
            <Link to={`/projects/${t.project_id}?task=${t.id}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50">
              <Avatar person={t.owner_id ? store.profileById.get(t.owner_id) : undefined} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{t.title}</span>
                <span className="block truncate text-xs text-slate-500"><span className="font-mono text-[11px]">{p?.code}</span> · {p?.name}</span>
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
