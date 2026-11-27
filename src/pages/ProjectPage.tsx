import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { addDays, differenceInCalendarDays, eachWeekOfInterval, format, max as maxDate, min as minDate, startOfDay } from "date-fns";
import { List, KanbanSquare, GanttChart, Users, Pencil, Trash2, Download, ArrowLeft, CalendarRange, X, Lock, ChevronRight, Copy as CopyIcon, GripVertical, Upload, Plus } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  PRIORITIES, PRIORITY_LABEL, PRIORITY_MARK, PRIORITY_STYLE, PROJECT_STATUSES, PROJECT_STATUS_LABEL, PROJECT_STATUS_STYLE, ROLE_LABEL, TASK_STATUSES, TASK_STATUS_DOT,
  TASK_STATUS_LABEL, fmtDate, toDate,
} from "../lib/format";
import { progressOf, today } from "../lib/metrics";
import { canAddTask, canContribute, canEditProject, canManageProject, isManager } from "../lib/perms";
import { ApprovalBanner, ApprovalPill } from "../components/Approval";
import { exportToExcel } from "../lib/excel";
import type { Priority, ProjectStatus, Section, Task, TaskStatus } from "../lib/types";
import { Avatar, Button, Card, EmptyState, IconButton, Pill, Select, Spinner, Tabs, cx, useConfirm } from "../components/ui";
import { ProjectForm } from "../components/ProjectForm";
import { CopyProjectModal } from "../components/CopyProjectModal";
import { ImportTasksModal } from "../components/ImportTasksModal";
import { TaskRow, TaskTableHeader } from "../components/TaskRow";
import { DueBadge, QuickAdd, useOpenTask, useStatusChange } from "../components/TaskPanel";
import { PeoplePicker } from "../components/pickers";

type View = "list" | "board" | "timeline" | "people";

/** The quick-add box the "Add task" button jumps to (list: first group, board: To do column). */
const ADD_TASK_INPUT = "add-task-input";

export default function ProjectPage() {
  const { id = "" } = useParams();
  const store = useStore();
  const { me } = useAuth();
  const nav = useNavigate();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as View) || "list";
  const setView = (v: View) => { const p = new URLSearchParams(params); p.set("view", v); p.delete("task"); setParams(p, { replace: true }); };
  const [editOpen, setEditOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [prioFilter, setPrioFilter] = useState<"" | Priority>("");
  const [hideDone, setHideDone] = useState(false);

  const project = store.projectById.get(id);
  const members = store.membersOf(id);
  const allTasks = useMemo(() => store.tasks.filter((t) => t.project_id === id), [store.tasks, id]);
  const filtered = useMemo(() => allTasks.filter((t) =>
    (!ownerFilter || (ownerFilter === "none" ? !t.owner_id : t.owner_id === ownerFilter))
    && (!prioFilter || t.priority === prioFilter)
    && (!hideDone || t.status !== "done")), [allTasks, ownerFilter, prioFilter, hideDone]);

  if (!store.ready) return <Spinner />;
  if (!project) {
    return <EmptyState title="Project not found" text="It may have been deleted." action={<Link to="/projects" className="font-semibold text-cta">Back to projects</Link>} />;
  }

  const canEdit = canEditProject(me, project, members);
  const canAdd = canAddTask(me, project, members);
  const canManage = canManageProject(me, project);
  const cat = project.category_id ? store.categoryById.get(project.category_id) : undefined;
  const lead = project.lead_id ? store.profileById.get(project.lead_id) : undefined;
  const prog = progressOf(project.id, store.tasks);
  const owners = [...new Set(allTasks.map((t) => t.owner_id).filter(Boolean) as string[])].map((o) => store.profileById.get(o)).filter(Boolean);

  async function del() {
    const ok = await confirm({
      title: `Delete ${project!.code}?`, danger: true, confirm: "Delete project",
      text: `"${project!.name}" and all ${allTasks.length} of its tasks, comments and files will be permanently deleted. To keep the history, set the status to Cancelled instead.`,
    });
    if (!ok) return;
    const { data: files } = await supabase.from("attachments").select("storage_path, task_id").in("task_id", allTasks.map((t) => t.id));
    const r = await store.mutate(() => supabase.from("projects").delete().eq("id", project!.id).select("id"), { success: "Project deleted" });
    if (r && files?.length) await supabase.storage.from("attachments").remove(files.map((f) => f.storage_path));
    if (r) nav("/projects");
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <Link to="/projects" className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-ink"><ArrowLeft className="size-4" />Projects</Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-mono text-[12px]">{project.code}</span>
            {cat && <span className="flex items-center gap-1.5 font-medium text-slate-600"><span className="size-2.5 rounded-[3px]" style={{ background: cat.color }} />{cat.name}</span>}
            <ApprovalPill project={project} />
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-2xl">{project.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
            {canManage ? (
              <span className={cx("inline-flex items-center rounded-full pl-2.5", PROJECT_STATUS_STYLE[project.status])}>
                <Select aria-label="Project status" value={project.status} className="field-quiet h-7 w-auto rounded-full py-0 pl-1 text-[12.5px] font-semibold text-current hover:bg-transparent hover:ring-transparent focus:bg-transparent"
                  onChange={(e) => store.patchProject(project.id, { status: e.target.value as ProjectStatus })}>
                  {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
                </Select>
              </span>
            ) : <StatusText s={project.status} />}
            <span className="flex items-center gap-1.5"><Avatar person={lead} size={22} />{lead ? `Lead: ${lead.full_name}` : "No lead"}</span>
            <span className="flex items-center gap-1.5"><CalendarRange className="size-4 text-slate-400" />{fmtDate(project.start_date) || "?"} – {fmtDate(project.end_date) || "open"}</span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200/70"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${prog.pct}%` }} /></span>
              {prog.done}/{prog.total} done
            </span>
          </div>
          {project.description && <p className="mt-3 max-w-3xl text-sm whitespace-pre-wrap text-slate-600">{project.description}</p>}
        </div>
        <div className="flex gap-2">
          {canAdd && <Button icon={<Upload className="size-4" />} onClick={() => setImportOpen(true)}>Import</Button>}
          <Button icon={<Download className="size-4" />} onClick={() => exportToExcel(`${project.code}.xlsx`, [project], allTasks, store)}>Excel</Button>
          {canContribute(me) && <Button icon={<CopyIcon className="size-4" />} onClick={() => setCopyOpen(true)}>Copy</Button>}
          {canManage && <Button icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>Edit</Button>}
          {isManager(me) && <IconButton label="Delete project" onClick={del} className="size-9 bg-white shadow-card ring-1 ring-line hover:text-red-600"><Trash2 className="size-4" /></IconButton>}
        </div>
      </div>

      <ApprovalBanner project={project} />

      <Tabs value={view} onChange={setView} tabs={[
        { id: "list", label: "List", icon: <List className="size-4" /> },
        { id: "board", label: "Board", icon: <KanbanSquare className="size-4" /> },
        { id: "timeline", label: "Timeline", icon: <GanttChart className="size-4" /> },
        { id: "people", label: `People (${members.size})`, icon: <Users className="size-4" /> },
      ]} />

      {view !== "people" && (
        <div className="my-3 flex flex-wrap items-center gap-2">
          <Select aria-label="Filter by owner" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="h-8 w-auto py-1 text-[13px]">
            <option value="">Everyone</option>
            {owners.map((p) => <option key={p!.id} value={p!.id}>{p!.full_name}</option>)}
            <option value="none">Unassigned</option>
          </Select>
          <Select aria-label="Filter by priority" value={prioFilter} onChange={(e) => setPrioFilter(e.target.value as Priority | "")} className="h-8 w-auto py-1 text-[13px]">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="size-4 accent-brand-500" /> Hide done
          </label>
          {!canEdit && <span className="text-xs text-slate-500">{canAdd ? "You can add tasks here. Adding one makes you part of this project." : "View only."}</span>}
          {canAdd && (
            <Button variant="primary" icon={<Plus className="size-4" />} className="ml-auto"
              onClick={() => {
                if (view === "timeline") setView("list");
                setTimeout(() => { const el = document.getElementById(ADD_TASK_INPUT); el?.scrollIntoView({ block: "center", behavior: "smooth" }); el?.focus({ preventScroll: true }); }, 50);
              }}>Add task</Button>
          )}
        </div>
      )}

      {view === "list" && <ListView projectId={project.id} tasks={filtered} canEdit={canEdit} canAdd={canAdd} />}
      {view === "board" && <BoardView projectId={project.id} tasks={filtered} canEdit={canEdit} canAdd={canAdd} />}
      {view === "timeline" && <TimelineView tasks={filtered} />}
      {view === "people" && <PeopleView projectId={project.id} canManage={canManage} />}

      <ProjectForm open={editOpen} onClose={() => setEditOpen(false)} project={project} />
      <CopyProjectModal open={copyOpen} onClose={() => setCopyOpen(false)} project={project} />
      <ImportTasksModal open={importOpen} onClose={() => setImportOpen(false)} project={project} />
    </div>
  );
}

function StatusText({ s }: { s: ProjectStatus }) {
  return <span className="font-medium text-slate-800">{PROJECT_STATUS_LABEL[s]}</span>;
}

/* ------------------------------ List ------------------------------ */
type Group = { key: string; title: string; dot?: string; sectionId?: string | null; status?: TaskStatus; tasks: Task[]; section?: Section };

function ListView({ projectId, tasks, canEdit, canAdd }: { projectId: string; tasks: Task[]; canEdit: boolean; canAdd: boolean }) {
  const { me } = useAuth();
  const store = useStore();
  const [groupBy, setGroupBy] = useState<"none" | "status">(() => (localStorage.getItem("i2l-group") === "status" ? "status" : "none"));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ids = new Set(tasks.map((t) => t.id));
  // subtasks sit under their parent; orphans (parent filtered out) show at top level
  const topLevel = tasks.filter((t) => !t.parent_id || !ids.has(t.parent_id));
  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n); };
  const drag = useTaskReorder(projectId);
  const setMode = (m: "none" | "status") => { setGroupBy(m); try { localStorage.setItem("i2l-group", m); } catch { /* ignore */ } };

  const groups: Group[] = groupBy === "status"
    ? TASK_STATUSES.map((st) => ({ key: st, title: TASK_STATUS_LABEL[st], dot: TASK_STATUS_DOT[st], status: st, tasks: topLevel.filter((t) => t.status === st) }))
    : [{ key: "all", title: "Tasks", tasks: topLevel }];

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-sm">
        <span className="mr-1 text-slate-500">Show</span>
        {(["none", "status"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} aria-pressed={groupBy === m}
            className={cx("rounded-md px-2.5 py-1 font-medium", groupBy === m ? "bg-deep text-on-accent" : "text-slate-600 hover:bg-slate-200")}>
            {m === "none" ? "All tasks" : "By status"}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        <TaskTableHeader />
        {groups.map((g, gi) => {
          const isCollapsed = collapsed.has(g.key);
          return (
            <div key={g.key}>
              {groupBy === "status" && (
                <div className="flex items-center gap-2 border-b border-line-soft bg-slate-50/70 px-3 py-1.5">
                  <button onClick={() => toggle(collapsed, g.key, setCollapsed)} aria-expanded={!isCollapsed}
                    className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-sm font-semibold text-slate-800">
                    <ChevronRight className={cx("size-4 shrink-0 text-slate-400 transition-transform", !isCollapsed && "rotate-90")} />
                    {g.dot && <span className={cx("size-2.5 rounded-full", g.dot)} />}
                    <span className="truncate">{g.title}</span>
                    <span className="font-normal text-slate-400">{g.tasks.length}</span>
                  </button>
                </div>
              )}
              {!isCollapsed && (
                <>
                  {g.tasks.map((t) => {
                    const subs = tasks.filter((s) => s.parent_id === t.id);
                    const open = expanded.has(t.id);
                    return (
                      <div key={t.id}>
                        <div {...drag.rowProps(t)}>
                          <TaskRow task={t} canEdit={canEdit} expanded={open} dragHandle={canEdit && drag.handle(t)}
                            onToggleExpand={subs.length ? () => toggle(expanded, t.id, setExpanded) : undefined} />
                        </div>
                        {open && subs.map((s) => (
                          <div key={s.id} {...drag.rowProps(s)}>
                            <TaskRow task={s} canEdit={canEdit} depth={1} dragHandle={canEdit && drag.handle(s)} />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {groupBy === "none" && g.tasks.length === 0 && (
                    <p className="px-4 pt-6 pb-3 text-center text-sm text-slate-500">No tasks yet.{canAdd ? " Type the first task's name below and press Enter." : ""}</p>
                  )}
                  {canAdd && (
                    <div className="border-b border-line-soft py-1.5 pr-3 pl-7">
                      <QuickAdd inputId={gi === 0 ? ADD_TASK_INPUT : undefined} placeholder={groupBy === "status" ? `Add a task to ${g.title}…` : "Add a task: type a name and press Enter"}
                        onAdd={(title) => store.mutate(() => supabase.from("tasks").insert({
                          project_id: projectId, title, owner_id: me?.id ?? null, ...(g.status ? { status: g.status } : {}),
                        }))} />
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </Card>
      {canAdd && <p className="mt-2 text-xs text-slate-500">Open a task to add subtasks under it. Tasks with subtasks have an arrow to show them.{canEdit ? " Drag the dots on the left to change the order." : ""}</p>}
    </div>
  );
}

/**
 * Drag to reorder: press the grip and move up or down (mouse, pen or touch).
 * A task moves among its siblings: main tasks among main tasks, subtasks inside their main task.
 */
function useTaskReorder(projectId: string) {
  const store = useStore();
  const [drag, setDrag] = useState<{ id: string; parent: string | null; overId: string | null; before: boolean } | null>(null);
  const live = useRef(drag);
  live.current = drag;

  function finish() {
    const d = live.current;
    setDrag(null);
    if (!d || !d.overId || d.overId === d.id) return;
    const siblings = store.tasks.filter((t) => t.project_id === projectId && (t.parent_id ?? null) === d.parent && t.id !== d.id);
    const moved = store.taskById.get(d.id);
    let i = siblings.findIndex((t) => t.id === d.overId);
    if (!moved || i < 0) return;
    if (!d.before) i += 1;
    const list = [...siblings.slice(0, i), moved, ...siblings.slice(i)];
    const prev = list[i - 1]?.sort_order, next = list[i + 1]?.sort_order;
    let orders: { id: string; sort_order: number }[];
    if (prev === undefined && next !== undefined) orders = [{ id: moved.id, sort_order: next - 1024 }];
    else if (next === undefined && prev !== undefined) orders = [{ id: moved.id, sort_order: prev + 1024 }];
    else if (prev !== undefined && next !== undefined && next - prev > 1e-6) orders = [{ id: moved.id, sort_order: (prev + next) / 2 }];
    else {
      // equal neighbours: number the whole list again
      const base = list[0]?.sort_order ?? 0;
      orders = list.map((t, k) => ({ id: t.id, sort_order: base + k * 1024 })).filter((o) => o.sort_order !== store.taskById.get(o.id)?.sort_order);
    }
    store.reorderTasks(orders);
  }

  function start(e: React.PointerEvent, t: Task) {
    e.preventDefault();
    const parent = t.parent_id ?? null;
    setDrag({ id: t.id, parent, overId: null, before: true });
    const move = (ev: PointerEvent) => {
      const row = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-drag-id]");
      if (!row || (row.dataset.dragParent || null) !== parent) return;
      const r = row.getBoundingClientRect();
      const next = { id: t.id, parent, overId: row.dataset.dragId!, before: ev.clientY < r.top + r.height / 2 };
      const cur = live.current;
      if (!cur || cur.overId !== next.overId || cur.before !== next.before) setDrag(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      finish();
    };
    const cancel = () => { live.current = null; up(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  return {
    rowProps: (t: Task) => ({
      "data-drag-id": t.id,
      "data-drag-parent": t.parent_id ?? "",
      className: cx("relative", drag?.id === t.id && "opacity-50",
        drag && drag.overId === t.id && drag.id !== t.id && (drag.before
          ? "before:absolute before:inset-x-0 before:-top-px before:z-10 before:h-0.5 before:bg-brand-500"
          : "after:absolute after:inset-x-0 after:-bottom-px after:z-10 after:h-0.5 after:bg-brand-500")),
    }),
    handle: (t: Task) => (
      <span role="button" tabIndex={-1} aria-label={`Drag to move "${t.title}"`} title="Drag to change the order"
        onPointerDown={(e) => start(e, t)}
        className="-ml-1 flex shrink-0 cursor-grab touch-none items-center text-slate-300 opacity-60 group-hover:opacity-100 hover:text-slate-500 active:cursor-grabbing">
        <GripVertical className="size-4" />
      </span>
    ),
  };
}

/* ------------------------------ Board ------------------------------ */
function BoardView({ projectId, tasks, canEdit, canAdd }: { projectId: string; tasks: Task[]; canEdit: boolean; canAdd: boolean }) {
  const { me } = useAuth();
  const store = useStore();
  const openTask = useOpenTask();
  const changeStatus = useStatusChange();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const cards = tasks.filter((t) => !t.parent_id);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 scroll-thin sm:mx-0 sm:px-0">
      <div className="grid min-w-[1000px] grid-cols-4 gap-3">
        {TASK_STATUSES.map((status) => {
          const col = cards.filter((t) => t.status === status);
          return (
            <div key={status}
              onDragOver={(e) => { if (canEdit && dragId) { e.preventDefault(); setOver(status); } }}
              onDragLeave={() => setOver(null)}
              onDrop={async (e) => {
                e.preventDefault(); setOver(null);
                const t = dragId ? store.taskById.get(dragId) : undefined;
                setDragId(null);
                if (t && t.status !== status) await changeStatus(t, status);
              }}
              className={cx("flex min-h-[60vh] flex-col rounded-2xl bg-slate-100/70 p-2 ring-1 ring-line-soft transition", over === status && "bg-navy-50 ring-2 ring-navy-200")}>
              <div className="flex items-center gap-2 px-1.5 pt-1 pb-2 text-sm font-semibold text-slate-700">
                <span className={cx("size-2.5 rounded-full", TASK_STATUS_DOT[status])} />{TASK_STATUS_LABEL[status]}
                <span className="font-normal text-slate-400">{col.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {col.map((t) => {
                  const owner = t.owner_id ? store.profileById.get(t.owner_id) : undefined;
                  const subs = store.tasks.filter((s) => s.parent_id === t.id);
                  const blocked = t.status !== "done" && store.dependencies.some((d) => d.task_id === t.id && store.taskById.get(d.depends_on_id)?.status !== "done");
                  return (
                    <article key={t.id} draggable={canEdit} onDragStart={() => setDragId(t.id)} onDragEnd={() => { setDragId(null); setOver(null); }}
                      onClick={() => openTask(t.id)} aria-label={t.title}
                      className={cx("cursor-pointer rounded-xl bg-white p-3 shadow-card ring-1 ring-line hover:shadow-md hover:ring-slate-300", dragId === t.id && "opacity-50")}>
                      <p className={cx("text-sm font-medium", t.status === "done" && "text-slate-400 line-through")}>{t.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Pill className={PRIORITY_STYLE[t.priority]}><span className="mr-1 font-extrabold tracking-tight">{PRIORITY_MARK[t.priority]}</span>{PRIORITY_LABEL[t.priority]}</Pill>
                        {blocked && <Pill className="bg-amber-50 text-amber-800 ring-amber-200"><Lock className="size-3" />Waiting</Pill>}
                        {subs.length > 0 && <span className="text-xs text-slate-500">{subs.filter((s) => s.status === "done").length}/{subs.length} subtasks</span>}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <DueBadge task={t} />
                        <span className="flex min-w-0 items-center gap-1.5">
                          {t.intern_name && owner?.role === "intern" && <span className="truncate text-xs text-sky-600">{t.intern_name}</span>}
                          <Avatar person={owner} size={24} />
                        </span>
                      </div>
                    </article>
                  );
                })}
                {canAdd && (
                  <div className="pt-1">
                    <QuickAdd inputId={status === "todo" ? ADD_TASK_INPUT : undefined} placeholder="Add task" onAdd={(title) => store.mutate(() => supabase.from("tasks").insert({ project_id: projectId, title, status, owner_id: me?.id ?? null }))} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ Timeline ------------------------------ */
const ROW_H = 34;
function TimelineView({ tasks }: { tasks: Task[] }) {
  const store = useStore();
  const openTask = useOpenTask();
  const [showLinks, setShowLinks] = useState(() => { try { return localStorage.getItem("i2l.timelineLinks") !== "off"; } catch { return true; } });
  const [hover, setHover] = useState<string | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const target = useRef(0);
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth));
    ro.observe(el);
    setTrackW(el.clientWidth);
    return () => ro.disconnect();
  });
  // open the timeline at this week, not at the earliest task
  useEffect(() => {
    if (scrolled.current || !trackW || !scroller.current) return;
    scrolled.current = true;
    scroller.current.scrollLeft = Math.max(0, target.current);
  }, [trackW]);

  const dated = tasks.filter((t) => t.start_date || t.due_date)
    .sort((a, b) => ((a.start_date ?? a.due_date)!).localeCompare((b.start_date ?? b.due_date)!));
  const undated = tasks.filter((t) => !t.start_date && !t.due_date);
  if (!dated.length) {
    return <EmptyState icon={<GanttChart className="size-8" />} title="No dated tasks yet" text="Give tasks a start or due date to see them on the timeline." />;
  }
  const starts = dated.map((t) => toDate(t.start_date ?? t.due_date)!);
  const ends = dated.map((t) => toDate(t.due_date ?? t.start_date)!);
  const ws = store.settings.week_starts_on;
  const from = startOfDay(minDate([...starts, today()]));
  const to = startOfDay(maxDate([...ends, addDays(today(), 14)]));
  const weeks = eachWeekOfInterval({ start: from, end: to }, { weekStartsOn: ws });
  const first = weeks[0];
  const totalDays = differenceInCalendarDays(addDays(weeks[weeks.length - 1], 7), first);
  const pos = (d: Date) => (differenceInCalendarDays(d, first) / totalDays) * 100;
  const DAY_W = 18;

  const rowOf = new Map(dated.map((t, i) => [t.id, i]));
  const span = (t: Task) => ({ s: toDate(t.start_date ?? t.due_date)!, e: toDate(t.due_date ?? t.start_date)! });
  const preds = (id: string) => store.dependencies.filter((d) => d.task_id === id).map((d) => store.taskById.get(d.depends_on_id)).filter(Boolean) as Task[];
  const isLocked = (t: Task) => t.status !== "done" && preds(t.id).some((p) => p.status !== "done");
  // arrows between tasks shown on this timeline
  const links = store.dependencies.filter((d) => rowOf.has(d.task_id) && rowOf.has(d.depends_on_id)).map((d) => {
    const from = store.taskById.get(d.depends_on_id)!;
    const to = store.taskById.get(d.task_id)!;
    const late = from.status !== "done" && to.status !== "done" && span(to).s <= span(from).e;
    return { key: `${d.depends_on_id}-${d.task_id}`, from, to, late };
  });
  const px = (d: Date) => (pos(d) / 100) * trackW;
  target.current = px(addDays(today(), -7));
  const hoverSet = hover ? new Set([hover, ...links.filter((l) => l.from.id === hover || l.to.id === hover).flatMap((l) => [l.from.id, l.to.id])]) : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2 text-xs text-slate-500">
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" className="size-4 accent-brand-500" checked={showLinks}
            onChange={(e) => { setShowLinks(e.target.checked); try { localStorage.setItem("i2l.timelineLinks", e.target.checked ? "on" : "off"); } catch { /* ignore */ } }} />
          Show predecessor links
        </label>
        {showLinks && links.length > 0 && <>
          <span className="flex items-center gap-1"><svg width="22" height="8"><path d="M0 4h16" stroke="var(--color-slate-600)" strokeWidth="1.6" /><path d="M15 0l6 4-6 4z" fill="var(--color-slate-600)" /></svg>predecessor → task that waits</span>
          <span className="flex items-center gap-1 text-red-600"><svg width="22" height="8"><path d="M0 4h16" stroke="#ef4444" strokeWidth="1.8" strokeDasharray="4 3" /><path d="M15 0l6 4-6 4z" fill="#ef4444" /></svg>starts before its predecessor ends</span>
        </>}
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-5 rounded-sm bg-stripes" /><Lock className="size-3" /> locked until predecessors are Done</span>
      </div>
      <div ref={scroller} className="overflow-x-auto scroll-thin">
        <div style={{ minWidth: 260 + totalDays * DAY_W }}>
          <div className="grid grid-cols-[260px_1fr] border-b border-line-soft bg-slate-50 text-xs font-semibold text-slate-500">
            <div className="sticky left-0 z-[4] border-r border-line bg-slate-50 px-4 py-2.5">Task</div>
            <div className="relative h-8">
              {weeks.map((w) => (
                <div key={w.toISOString()} className="absolute inset-y-0 border-l border-line pl-1.5 leading-8" style={{ left: `${pos(w)}%` }}>{format(w, "d MMM")}</div>
              ))}
            </div>
          </div>
          <div className="relative">
            {dated.map((t) => {
              const { s, e } = span(t);
              const owner = t.owner_id ? store.profileById.get(t.owner_id) : undefined;
              const late = t.status !== "done" && e < today();
              const locked = isLocked(t);
              const waits = preds(t.id);
              const dim = hoverSet && !hoverSet.has(t.id);
              return (
                <div key={t.id} className="grid grid-cols-[260px_1fr] border-b border-line-soft hover:bg-slate-50" style={{ height: ROW_H }}
                  onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)}>
                  <button onClick={() => openTask(t.id)} className="sticky left-0 z-[4] flex min-w-0 items-center gap-2 border-r border-line bg-white px-4 text-left">
                    {locked ? <Lock className="size-3 shrink-0 text-red-500" /> : <span className={cx("size-2 shrink-0 rounded-full", TASK_STATUS_DOT[t.status])} />}
                    <span className={cx("truncate text-sm", t.parent_id && "pl-3 text-slate-600", dim && "opacity-50")}>{t.title}</span>
                  </button>
                  <div className="relative" ref={t.id === dated[0].id ? track : undefined}>
                    {weeks.map((w) => <div key={w.toISOString()} className="absolute inset-y-0 border-l border-line-soft" style={{ left: `${pos(w)}%` }} />)}
                    <div className="absolute inset-y-0 w-0.5 bg-brand-500" style={{ left: `${pos(today())}%` }} />
                    <button onClick={() => openTask(t.id)}
                      title={`${t.title}: ${fmtDate(t.start_date) || "?"} → ${fmtDate(t.due_date) || "?"}${waits.length ? `\nWaits on: ${waits.map((p) => `${p.title}${p.status === "done" ? " (done)" : p.due_date ? ` (due ${fmtDate(p.due_date)})` : ""}`).join(", ")}` : ""}`}
                      className={cx("absolute top-1/2 z-[1] flex h-5 -translate-y-1/2 items-center gap-1 overflow-hidden rounded-md px-1 text-[11px] font-medium text-on-accent transition-opacity",
                        locked ? "bg-stripes text-slate-700" : t.status === "done" ? "bg-emerald-500" : late ? "bg-red-500" : t.status === "in_progress" ? "bg-blue-500" : t.status === "review" ? "bg-violet-500" : "bg-navy-400",
                        showLinks && links.some((l) => l.late && l.to.id === t.id) && "ring-2 ring-red-500",
                        dim && "opacity-40")}
                      style={{ left: `${pos(s)}%`, width: `max(${((differenceInCalendarDays(e, s) + 1) / totalDays) * 100}%, 8px)` }}>
                      {owner && <Avatar person={owner} size={14} />}
                    </button>
                  </div>
                </div>
              );
            })}
            {showLinks && trackW > 0 && links.length > 0 && (
              <svg className="pointer-events-none absolute top-0 z-[2] overflow-visible" style={{ left: 260, width: trackW, height: dated.length * ROW_H }}>
                <defs>
                  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--color-slate-600)" /></marker>
                  <marker id="arr-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#ef4444" /></marker>
                  <marker id="arr-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#ea580c" /></marker>
                </defs>
                {links.map((l) => {
                  const r1 = rowOf.get(l.from.id)!, r2 = rowOf.get(l.to.id)!;
                  const x1 = px(addDays(span(l.from).e, 1)), y1 = r1 * ROW_H + ROW_H / 2;
                  const x2 = px(span(l.to).s), y2 = r2 * ROW_H + ROW_H / 2;
                  const down = y2 > y1 ? 1 : -1;
                  const d = x2 - 8 >= x1 + 6
                    ? `M${x1},${y1} H${x1 + 6} V${y2} H${x2}`
                    : `M${x1},${y1} H${x1 + 6} V${y2 - down * (ROW_H / 2)} H${x2 - 10} V${y2} H${x2}`;
                  const hi = hover && (l.from.id === hover || l.to.id === hover);
                  const faded = hover && !hi;
                  return <path key={l.key} d={d} fill="none" strokeLinejoin="round"
                    stroke={hi ? "#ea580c" : l.late ? "#ef4444" : "var(--color-slate-500)"} strokeWidth={hi ? 2.2 : l.late ? 1.8 : 1.5}
                    strokeDasharray={l.late && !hi ? "4 3" : undefined} opacity={faded ? 0.25 : 1}
                    markerEnd={`url(#${hi ? "arr-hi" : l.late ? "arr-red" : "arr"})`} />;
                })}
              </svg>
            )}
          </div>
        </div>
      </div>
      {undated.length > 0 && <p className="border-t border-line px-4 py-2 text-xs text-slate-500">{undated.length} task(s) without dates are not shown.</p>}
    </Card>
  );
}

/* ------------------------------ People ------------------------------ */
function PeopleView({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const store = useStore();
  const confirm = useConfirm();
  const project = store.projectById.get(projectId)!;
  const ids = [...store.membersOf(projectId)];
  const people = ids.map((id) => store.profileById.get(id)).filter(Boolean).sort((a, b) => a!.full_name.localeCompare(b!.full_name));
  const tasks = store.tasks.filter((t) => t.project_id === projectId);

  return (
    <div className="mt-3">
      <p className="mb-3 text-sm text-slate-600">
        People on this project can add and edit its tasks. Assigning a task to someone adds them automatically.
        {canManage ? "" : " Only the project lead, Managers and Admins can change this list."}
      </p>
      <Card className="divide-y divide-line-soft">
        {people.map((p) => {
          const open = tasks.filter((t) => t.owner_id === p!.id && t.status !== "done").length;
          const isLead = project.lead_id === p!.id;
          return (
            <div key={p!.id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar person={p} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p!.full_name} {isLead && <Pill className="ml-1 bg-brand-50 text-brand-700 ring-transparent">Lead</Pill>}</p>
                <p className="truncate text-xs text-slate-500">{p!.job_title || ROLE_LABEL[p!.role]}</p>
              </div>
              <span className="text-sm text-slate-500">{open} open task{open === 1 ? "" : "s"}</span>
              {canManage && !isLead && (
                <IconButton label={`Remove ${p!.full_name}`} onClick={async () => {
                  if (!(await confirm({ title: `Remove ${p!.full_name} from this project?`, text: "Their tasks stay assigned to them.", confirm: "Remove" }))) return;
                  store.mutate(() => supabase.from("project_members").delete().match({ project_id: projectId, user_id: p!.id }));
                }}><X className="size-4" /></IconButton>
              )}
            </div>
          );
        })}
        {people.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Nobody is assigned yet.</p>}
      </Card>
      {canManage && (
        <div className="mt-3">
          <PeoplePicker label="Add people" selected={ids} onToggle={(uid, on) => store.mutate(() => on
            ? supabase.from("project_members").insert({ project_id: projectId, user_id: uid })
            : supabase.from("project_members").delete().match({ project_id: projectId, user_id: uid }))} />
        </div>
      )}
    </div>
  );
}
