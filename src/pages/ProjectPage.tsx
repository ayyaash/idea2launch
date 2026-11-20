import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { addDays, differenceInCalendarDays, eachWeekOfInterval, format, max as maxDate, min as minDate, startOfDay } from "date-fns";
import { List, KanbanSquare, GanttChart, Users, Pencil, Trash2, Download, ArrowLeft, CalendarRange, Plus, X, Lock, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  PRIORITIES, PRIORITY_LABEL, PRIORITY_STYLE, PROJECT_STATUSES, PROJECT_STATUS_LABEL, ROLE_LABEL, TASK_STATUSES, TASK_STATUS_DOT,
  TASK_STATUS_LABEL, fmtDate, toDate,
} from "../lib/format";
import { progressOf, today } from "../lib/metrics";
import { canAddTask, canEditProject, canManageProject, isManager } from "../lib/perms";
import { ApprovalBanner, ApprovalPill } from "../components/Approval";
import { exportToExcel } from "../lib/excel";
import type { Priority, ProjectStatus, Section, Task, TaskStatus } from "../lib/types";
import { Avatar, Button, Card, EmptyState, IconButton, Pill, Select, Spinner, Tabs, cx, useConfirm } from "../components/ui";
import { ProjectForm } from "../components/ProjectForm";
import { TaskRow, TaskTableHeader } from "../components/TaskRow";
import { DueBadge, QuickAdd, useOpenTask, useStatusChange } from "../components/TaskPanel";
import { PeoplePicker } from "../components/pickers";

type View = "list" | "board" | "timeline" | "people";

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
    return <EmptyState title="Project not found" text="It may have been deleted." action={<Link to="/projects" className="text-brand-600">Back to projects</Link>} />;
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
      <Link to="/projects" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />Projects</Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-mono">{project.code}</span>
            {cat && <span className="flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: cat.color }} />{cat.name}</span>}
            <ApprovalPill project={project} />
          </div>
          <h1 className="mt-0.5 text-xl font-semibold text-slate-900 sm:text-2xl">{project.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
            {canManage ? (
              <Select aria-label="Project status" value={project.status} className="h-8 w-auto py-1 text-[13px]"
                onChange={(e) => store.patchProject(project.id, { status: e.target.value as ProjectStatus })}>
                {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
              </Select>
            ) : <StatusText s={project.status} />}
            <span className="flex items-center gap-1.5"><Avatar person={lead} size={22} />{lead ? `Lead: ${lead.full_name}` : "No lead"}</span>
            <span className="flex items-center gap-1.5"><CalendarRange className="size-4 text-slate-400" />{fmtDate(project.start_date) || "?"} – {fmtDate(project.end_date) || "open"}</span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-emerald-500" style={{ width: `${prog.pct}%` }} /></span>
              {prog.done}/{prog.total} done
            </span>
          </div>
          {project.description && <p className="mt-3 max-w-3xl text-sm whitespace-pre-wrap text-slate-600">{project.description}</p>}
        </div>
        <div className="flex gap-2">
          <Button icon={<Download className="size-4" />} onClick={() => exportToExcel(`${project.code}.xlsx`, [project], allTasks, store)}>Excel</Button>
          {canManage && <Button icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>Edit</Button>}
          {isManager(me) && <IconButton label="Delete project" onClick={del} className="ring-1 ring-slate-300"><Trash2 className="size-4" /></IconButton>}
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
          {!canEdit && <span className="ml-auto text-xs text-slate-500">{canAdd ? "You can add tasks here. Adding one makes you part of this project." : "View only."}</span>}
        </div>
      )}

      {view === "list" && <ListView projectId={project.id} tasks={filtered} canEdit={canEdit} canAdd={canAdd} />}
      {view === "board" && <BoardView projectId={project.id} tasks={filtered} canEdit={canEdit} canAdd={canAdd} />}
      {view === "timeline" && <TimelineView tasks={filtered} />}
      {view === "people" && <PeopleView projectId={project.id} canManage={canManage} />}

      <ProjectForm open={editOpen} onClose={() => setEditOpen(false)} project={project} />
    </div>
  );
}

function StatusText({ s }: { s: ProjectStatus }) {
  return <span className="font-medium text-slate-800">{PROJECT_STATUS_LABEL[s]}</span>;
}

/* ------------------------------ List ------------------------------ */
type Group = { key: string; title: string; dot?: string; sectionId?: string | null; status?: TaskStatus; tasks: Task[]; section?: Section };

function ListView({ projectId, tasks, canEdit, canAdd }: { projectId: string; tasks: Task[]; canEdit: boolean; canAdd: boolean }) {
  const store = useStore();
  const confirm = useConfirm();
  const [groupBy, setGroupBy] = useState<"phase" | "status">(() => (localStorage.getItem("i2l-group") as "phase" | "status") || "phase");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newPhase, setNewPhase] = useState("");
  const sections = store.sectionsOf(projectId);
  const ids = new Set(tasks.map((t) => t.id));
  // subtasks sit under their parent; orphans (parent filtered out) show at top level
  const topLevel = tasks.filter((t) => !t.parent_id || !ids.has(t.parent_id));
  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n); };
  const setMode = (m: "phase" | "status") => { setGroupBy(m); try { localStorage.setItem("i2l-group", m); } catch { /* ignore */ } };

  const groups: Group[] = groupBy === "status"
    ? TASK_STATUSES.map((st) => ({ key: st, title: TASK_STATUS_LABEL[st], dot: TASK_STATUS_DOT[st], status: st, tasks: topLevel.filter((t) => t.status === st) }))
    : [
        ...sections.map((sec) => ({ key: sec.id, title: sec.name, sectionId: sec.id, section: sec, tasks: topLevel.filter((t) => t.section_id === sec.id) })),
        { key: "none", title: sections.length ? "No phase" : "Tasks", sectionId: null, tasks: topLevel.filter((t) => !t.section_id || !sections.some((x) => x.id === t.section_id)) },
      ].filter((g) => g.key !== "none" || g.tasks.length > 0 || sections.length === 0);

  async function moveSection(i: number, dir: -1 | 1) {
    const a = sections[i], b = sections[i + dir];
    if (!a || !b) return;
    await Promise.all([
      supabase.from("project_sections").update({ sort_order: i + dir }).eq("id", a.id),
      supabase.from("project_sections").update({ sort_order: i }).eq("id", b.id),
    ]);
    // normalise the rest so order stays stable
    await Promise.all(sections.map((s, j) => (j !== i && j !== i + dir && s.sort_order !== j) ? supabase.from("project_sections").update({ sort_order: j }).eq("id", s.id) : null));
    store.refresh();
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-sm">
        <span className="mr-1 text-slate-500">Group by</span>
        {(["phase", "status"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} aria-pressed={groupBy === m}
            className={cx("rounded-md px-2.5 py-1 font-medium", groupBy === m ? "bg-navy-900 text-white" : "text-slate-600 hover:bg-slate-200")}>
            {m === "phase" ? "Phase" : "Status"}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        <TaskTableHeader />
        {groups.map((g, gi) => {
          const isCollapsed = collapsed.has(g.key);
          return (
            <div key={g.key}>
              <div className="group/h flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-1.5">
                <button onClick={() => toggle(collapsed, g.key, setCollapsed)} aria-expanded={!isCollapsed}
                  className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-sm font-semibold text-slate-800">
                  <ChevronRight className={cx("size-4 shrink-0 text-slate-400 transition-transform", !isCollapsed && "rotate-90")} />
                  {g.dot && <span className={cx("size-2.5 rounded-full", g.dot)} />}
                  {renaming === g.key && g.section ? null : <span className="truncate">{g.title}</span>}
                  {renaming !== g.key && <span className="font-normal text-slate-400">{g.tasks.length}</span>}
                </button>
                {renaming === g.key && g.section && (
                  <input autoFocus defaultValue={g.section.name} aria-label="Phase name"
                    className="h-7 flex-1 rounded-md px-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                    onBlur={async (e) => { const v = e.target.value.trim(); setRenaming(null); if (v && v !== g.section!.name) await store.mutate(() => supabase.from("project_sections").update({ name: v }).eq("id", g.section!.id)); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }} />
                )}
                {canEdit && g.section && renaming !== g.key && (
                  <span className="flex opacity-100 md:opacity-0 md:group-hover/h:opacity-100 md:focus-within:opacity-100">
                    <IconButton label={`Rename ${g.title}`} onClick={() => setRenaming(g.key)}><Pencil className="size-3.5" /></IconButton>
                    <IconButton label={`Move ${g.title} up`} disabled={gi === 0} onClick={() => moveSection(gi, -1)}><ArrowUp className="size-3.5" /></IconButton>
                    <IconButton label={`Move ${g.title} down`} disabled={gi >= sections.length - 1} onClick={() => moveSection(gi, 1)}><ArrowDown className="size-3.5" /></IconButton>
                    <IconButton label={`Delete ${g.title}`} onClick={async () => {
                      if (!(await confirm({ title: `Delete the "${g.title}" phase?`, text: g.tasks.length ? `Its ${g.tasks.length} task(s) are kept and moved to "No phase".` : undefined, confirm: "Delete phase", danger: true }))) return;
                      store.mutate(() => supabase.from("project_sections").delete().eq("id", g.section!.id));
                    }}><Trash2 className="size-3.5" /></IconButton>
                  </span>
                )}
              </div>
              {!isCollapsed && (
                <>
                  {g.tasks.map((t) => {
                    const subs = tasks.filter((s) => s.parent_id === t.id);
                    const open = expanded.has(t.id);
                    return (
                      <div key={t.id}>
                        <TaskRow task={t} canEdit={canEdit} expanded={open}
                          onToggleExpand={subs.length ? () => toggle(expanded, t.id, setExpanded) : undefined} />
                        {open && subs.map((s) => <TaskRow key={s.id} task={s} canEdit={canEdit} depth={1} />)}
                      </div>
                    );
                  })}
                  {canAdd && (
                    <div className="border-b border-slate-100 py-1.5 pr-3 pl-9">
                      <QuickAdd placeholder={`Add a task to ${g.title}`}
                        onAdd={(title) => store.mutate(() => supabase.from("tasks").insert({
                          project_id: projectId, title, ...(g.status ? { status: g.status } : {}), ...(g.sectionId ? { section_id: g.sectionId } : {}),
                        }))} />
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        {canEdit && groupBy === "phase" && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Plus className="size-4 text-slate-400" />
            <input value={newPhase} onChange={(e) => setNewPhase(e.target.value)} placeholder="Add a phase (e.g. Prototyping) and press Enter" aria-label="New phase name"
              className="h-7 flex-1 bg-transparent text-sm font-medium placeholder:font-normal placeholder:text-slate-400 focus:outline-none"
              onKeyDown={async (e) => {
                if (e.key !== "Enter" || !newPhase.trim()) return;
                const name = newPhase.trim(); setNewPhase("");
                await store.mutate(() => supabase.from("project_sections").insert({ project_id: projectId, name, sort_order: sections.length }));
              }} />
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------ Board ------------------------------ */
function BoardView({ projectId, tasks, canEdit, canAdd }: { projectId: string; tasks: Task[]; canEdit: boolean; canAdd: boolean }) {
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
              className={cx("flex min-h-[60vh] flex-col rounded-xl bg-slate-100/80 p-2 transition", over === status && "bg-brand-50 ring-2 ring-brand-300")}>
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
                      className={cx("cursor-pointer rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200 hover:ring-slate-300", dragId === t.id && "opacity-50")}>
                      <p className={cx("text-sm font-medium", t.status === "done" && "text-slate-400 line-through")}>{t.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Pill className={PRIORITY_STYLE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill>
                        {blocked && <Pill className="bg-amber-50 text-amber-800 ring-amber-200"><Lock className="size-3" />Waiting</Pill>}
                        {subs.length > 0 && <span className="text-xs text-slate-500">{subs.filter((s) => s.status === "done").length}/{subs.length} subtasks</span>}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <DueBadge task={t} />
                        <Avatar person={owner} size={24} />
                      </div>
                    </article>
                  );
                })}
                {canAdd && (
                  <div className="rounded-lg px-2 py-1 hover:bg-white/60">
                    <QuickAdd placeholder="Add task" onAdd={(title) => store.mutate(() => supabase.from("tasks").insert({ project_id: projectId, title, status }))} />
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
function TimelineView({ tasks }: { tasks: Task[] }) {
  const store = useStore();
  const openTask = useOpenTask();
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

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto scroll-thin">
        <div style={{ minWidth: 260 + totalDays * DAY_W }}>
          <div className="grid grid-cols-[260px_1fr] border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <div className="px-4 py-2 font-medium">Task</div>
            <div className="relative h-8">
              {weeks.map((w) => (
                <div key={w.toISOString()} className="absolute inset-y-0 border-l border-slate-200 pl-1.5 leading-8" style={{ left: `${pos(w)}%` }}>{format(w, "d MMM")}</div>
              ))}
            </div>
          </div>
          {dated.map((t) => {
            const s = toDate(t.start_date ?? t.due_date)!;
            const e = toDate(t.due_date ?? t.start_date)!;
            const owner = t.owner_id ? store.profileById.get(t.owner_id) : undefined;
            const late = t.status !== "done" && e < today();
            return (
              <div key={t.id} className="grid grid-cols-[260px_1fr] border-b border-slate-100 hover:bg-slate-50">
                <button onClick={() => openTask(t.id)} className="flex min-w-0 items-center gap-2 px-4 py-1.5 text-left">
                  <span className={cx("size-2 shrink-0 rounded-full", TASK_STATUS_DOT[t.status])} />
                  <span className={cx("truncate text-sm", t.parent_id && "pl-3 text-slate-600")}>{t.title}</span>
                </button>
                <div className="relative">
                  {weeks.map((w) => <div key={w.toISOString()} className="absolute inset-y-0 border-l border-slate-100" style={{ left: `${pos(w)}%` }} />)}
                  <div className="absolute inset-y-0 w-px bg-brand-500/70" style={{ left: `${pos(today())}%` }} />
                  <button onClick={() => openTask(t.id)} title={`${t.title}: ${fmtDate(t.start_date) || "?"} → ${fmtDate(t.due_date) || "?"}`}
                    className={cx("absolute top-1/2 flex h-5 -translate-y-1/2 items-center gap-1 overflow-hidden rounded-md px-1 text-[11px] font-medium text-white",
                      t.status === "done" ? "bg-emerald-500" : late ? "bg-red-500" : t.status === "in_progress" ? "bg-blue-500" : t.status === "review" ? "bg-violet-500" : "bg-navy-400")}
                    style={{ left: `${pos(s)}%`, width: `max(${((differenceInCalendarDays(e, s) + 1) / totalDays) * 100}%, 8px)` }}>
                    {owner && <Avatar person={owner} size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {undated.length > 0 && <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">{undated.length} task(s) without dates are not shown.</p>}
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
      <Card className="divide-y divide-slate-100">
        {people.map((p) => {
          const open = tasks.filter((t) => t.owner_id === p!.id && t.status !== "done").length;
          const isLead = project.lead_id === p!.id;
          return (
            <div key={p!.id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar person={p} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p!.full_name} {isLead && <Pill className="ml-1 bg-brand-50 text-brand-700 ring-brand-200">Lead</Pill>}</p>
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
