import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  X, Copy, Trash2, CheckCircle2, Circle, Paperclip, Download, Link2, MessageSquare, ListTree, Lock, ArrowRight, Plus, MoreHorizontal, Search, AlertTriangle,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase, errorText } from "../lib/supabase";
import {
  PRIORITIES, PRIORITY_LABEL, PRIORITY_MARK, TASK_STATUSES, TASK_STATUS_LABEL, TASK_STATUS_DOT, fmtBytes, fmtDate, timeAgo, dueLabel,
} from "../lib/format";
import { canApprove, canDeleteTask, canEditProject, canContribute, internOnTask, isManager } from "../lib/perms";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Attachment, Comment, Task, TaskStatus } from "../lib/types";
import { Avatar, Button, IconButton, Input, Select, Textarea, cx, useConfirm } from "./ui";
import { OwnerQuickPick, PeoplePicker, PersonChip } from "./pickers";
import { useToast } from "./Toast";
import { CopyTaskModal } from "./CopyTaskModal";

/** Renders the task side panel whenever the URL has ?task=<id>. */
export function TaskPanelHost() {
  const [params, setParams] = useSearchParams();
  const taskId = params.get("task");
  const close = useCallback(() => {
    const p = new URLSearchParams(params);
    p.delete("task");
    setParams(p, { replace: true });
  }, [params, setParams]);
  if (!taskId) return null;
  return <TaskPanel key={taskId} taskId={taskId} onClose={close} />;
}

export function useOpenTask() {
  const [params, setParams] = useSearchParams();
  return useCallback((id: string) => {
    const p = new URLSearchParams(params);
    p.set("task", id);
    setParams(p);
  }, [params, setParams]);
}

/**
 * A task is locked until its predecessors are Done: it can't be started, sent for review or
 * completed. Project Coordinators, Managers and Admins can unlock it after confirming.
 */
export function useStatusChange() {
  const store = useStore();
  const { me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  return useCallback(async (task: Task, status: TaskStatus) => {
    if (status !== "todo" && status !== task.status) {
      const blockers = store.dependencies
        .filter((d) => d.task_id === task.id)
        .map((d) => store.taskById.get(d.depends_on_id))
        .filter((t): t is Task => !!t && t.status !== "done");
      if (blockers.length) {
        const list = blockers.map((b) => `"${b.title}"`).join(", ");
        if (!canApprove(me)) {
          toast.error(`This task is locked until ${list} ${blockers.length > 1 ? "are" : "is"} Done. A Project Coordinator, Manager or Admin can unlock it.`);
          return false;
        }
        const ok = await confirm({
          title: "Unlock this task?",
          text: `${list} ${blockers.length > 1 ? "are" : "is"} not Done yet, so this task is locked. You can unlock it and continue anyway.`,
          confirm: "Unlock and continue",
        });
        if (!ok) return false;
      }
    }
    return store.patchTask(task.id, { status });
  }, [store, me, toast, confirm]);
}

function TaskPanel({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const store = useStore();
  const { me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const openTask = useOpenTask();
  const changeStatus = useStatusChange();
  const task = store.taskById.get(taskId);
  const project = task ? store.projectById.get(task.project_id) : undefined;
  const members = project ? store.membersOf(project.id) : new Set<string>();
  const canEdit = canEditProject(me, project, members);
  const canStatus = canEdit || (!!task && internOnTask(me, task, store.collaborators.filter((c) => c.task_id === task.id).map((c) => c.user_id)));
  const [comments, setComments] = useState<Comment[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const loadExtras = useCallback(async () => {
    const [c, a] = await Promise.all([
      supabase.from("comments").select("*").eq("task_id", taskId).order("created_at"),
      supabase.from("attachments").select("*").eq("task_id", taskId).order("created_at"),
    ]);
    setComments(c.data ?? []);
    setFiles(a.data ?? []);
  }, [taskId]);
  useEffect(() => { loadExtras(); }, [loadExtras]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog][aria-modal=true]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!store.ready) return null;
  if (!task || !project) {
    return (
      <PanelShell onClose={onClose}>
        <div className="p-8 text-center text-sm text-slate-500">This task no longer exists.</div>
      </PanelShell>
    );
  }

  const parent = task.parent_id ? store.taskById.get(task.parent_id) : undefined;
  const subtasks = store.tasks.filter((t) => t.parent_id === task.id);
  const collaborators = store.collaborators.filter((c) => c.task_id === task.id).map((c) => c.user_id);
  const waitingOn = store.dependencies.filter((d) => d.task_id === task.id).map((d) => store.taskById.get(d.depends_on_id)).filter(Boolean) as Task[];
  const blocking = store.dependencies.filter((d) => d.depends_on_id === task.id).map((d) => store.taskById.get(d.task_id)).filter(Boolean) as Task[];
  const blocked = waitingOn.some((t) => t.status !== "done");
  const done = task.status === "done";

  const patch = (p: Partial<Task>) => store.patchTask(task.id, p);

  /** Subtask dates must stay inside the main task's dates. */
  function setDate(key: "start_date" | "due_date", v: string | null) {
    if (v && parent) {
      if (parent.start_date && v < parent.start_date) { toast.error(`A subtask can't start before its main task (${fmtDate(parent.start_date, "d MMM yyyy")}).`); return; }
      if (parent.due_date && v > parent.due_date) { toast.error(`A subtask can't end after its main task (${fmtDate(parent.due_date, "d MMM yyyy")}).`); return; }
    }
    patch({ [key]: v });
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this task?",
      text: subtasks.length ? `Its ${subtasks.length} subtask(s), comments and files will be deleted too.` : "Its comments and files will be deleted too.",
      confirm: "Delete", danger: true,
    });
    if (!ok) return;
    const paths = files.map((f) => f.storage_path);
    const r = await store.mutate(() => supabase.from("tasks").delete().eq("id", task!.id).select("id"), { success: "Task deleted" });
    if (r && paths.length) await supabase.storage.from("attachments").remove(paths);
    onClose();
  }

  return (
    <PanelShell onClose={onClose}>
      {/* header */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line-soft px-4">
        <Button size="sm" variant="secondary" disabled={!canStatus}
          icon={done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-slate-400" />}
          onClick={() => changeStatus(task, done ? "todo" : "done")}>
          {done ? "Completed" : "Mark complete"}
        </Button>
        <div className="flex-1" />
        {canContribute(me) && (
          <IconButton label="Copy task" onClick={() => setCopyOpen(true)}><Copy className="size-4" /></IconButton>
        )}
        {canDeleteTask(me) && (
          <div className="relative">
            <IconButton label="More actions" onClick={() => setMoreOpen((o) => !o)}><MoreHorizontal className="size-4" /></IconButton>
            {moreOpen && (
              <div className="absolute right-0 z-10 mt-1 w-40 rounded-xl bg-white py-1 shadow-pop ring-1 ring-line" onMouseLeave={() => setMoreOpen(false)}>
                <button onClick={() => { setMoreOpen(false); remove(); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                  <Trash2 className="size-4" /> Delete task
                </button>
              </div>
            )}
          </div>
        )}
        <IconButton label="Close panel" onClick={onClose}><X className="size-5" /></IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-8 scroll-thin sm:px-6">
        <div className="mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
          <Link to={`/projects/${project.id}`} className="font-medium hover:text-navy-700" onClick={() => nav(`/projects/${project.id}?task=${task.id}`)}>
            <span className="font-mono text-[11.5px]">{project.code}</span> · {project.name}
          </Link>
          {parent && (<><ArrowRight className="size-3" /><button className="hover:text-brand-600" onClick={() => openTask(parent.id)}>{parent.title}</button></>)}
        </div>

        <EditableTitle value={task.title} disabled={!canEdit} onSave={(title) => patch({ title })} done={done} />

        {blocked && !done && (() => {
          const pending = waitingOn.filter((t) => t.status !== "done");
          return (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] text-amber-950 ring-1 ring-amber-200">
              <Lock className="mt-0.5 size-4 shrink-0 text-amber-700" />
              <span><b>Waiting on {pending.length} predecessor{pending.length === 1 ? "" : "s"}.</b> {pending.map((t) => `"${t.title}"`).join(", ")} must be Done before this task can start or be completed.
                {canApprove(me) ? " You can unlock it by changing the status." : " A Project Coordinator, Manager or Admin can unlock it."}</span>
            </div>
          );
        })()}
        {!canEdit && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-line">
            {canStatus ? "This task is assigned to you. Move it along with Status or Mark complete, and leave a comment if you need anything."
              : "You can view this task. Only people assigned to this project can change it."}
          </p>
        )}

        {/* fields */}
        <dl className="mt-4 grid grid-cols-[112px_1fr] items-center gap-x-2 gap-y-1 text-sm [&>dt]:text-[13px]">
          <dt className="text-slate-500">Status</dt>
          <dd>
            <Select aria-label="Status" value={task.status} disabled={!canStatus} className="field-quiet max-w-60"
              onChange={(e) => changeStatus(task, e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
            </Select>
          </dd>
          <dt className="text-slate-500">Priority</dt>
          <dd>
            <Select aria-label="Priority" value={task.priority} disabled={!canEdit} className="field-quiet max-w-60"
              onChange={(e) => patch({ priority: e.target.value as Task["priority"] })}>
              {PRIORITIES.map((p) => <option key={p} value={p} className="text-ink">{PRIORITY_MARK[p]}  {PRIORITY_LABEL[p]}</option>)}
            </Select>
          </dd>
          <dt className="text-slate-500">Owner</dt>
          <dd className="max-w-60"><OwnerQuickPick field value={task.owner_id} projectId={project.id} disabled={!canEdit} onChange={(owner_id) => patch({ owner_id })} /></dd>
          <dt className="self-start pt-1 text-slate-500">Collaborators</dt>
          <dd className="flex min-h-9 flex-wrap items-center gap-1.5 px-2 py-1">
            {collaborators.map((id) => (
              <PersonChip key={id} person={store.profileById.get(id)}
                onRemove={canEdit ? () => store.mutate(() => supabase.from("task_collaborators").delete().match({ task_id: task.id, user_id: id })) : undefined} />
            ))}
            {canEdit && (
              <PeoplePicker selected={collaborators} exclude={task.owner_id ? [task.owner_id] : []}
                onToggle={(id, on) => store.mutate(() => on
                  ? supabase.from("task_collaborators").insert({ task_id: task.id, user_id: id })
                  : supabase.from("task_collaborators").delete().match({ task_id: task.id, user_id: id }))} />
            )}
            {!canEdit && collaborators.length === 0 && <span className="text-slate-400">None</span>}
          </dd>
          <dt className="text-slate-500">Start date</dt>
          <dd><Input type="date" aria-label="Start date" value={task.start_date ?? ""} disabled={!canEdit} className="field-quiet max-w-44"
            min={parent?.start_date ?? undefined} max={(task.due_date ?? parent?.due_date) ?? undefined}
            onChange={(e) => setDate("start_date", e.target.value || null)} /></dd>
          <dt className="text-slate-500">Due date</dt>
          <dd className="flex items-center gap-2">
            <Input type="date" aria-label="Due date" value={task.due_date ?? ""} disabled={!canEdit} className="field-quiet max-w-44"
              min={(task.start_date ?? parent?.start_date) ?? undefined} max={parent?.due_date ?? undefined}
              onChange={(e) => setDate("due_date", e.target.value || null)} />
            <DueBadge task={task} />
          </dd>
          {parent && (parent.start_date || parent.due_date) && (
            <dd className="col-start-2 px-2 text-xs text-slate-500">
              Must be within the main task's dates: {parent.start_date ? fmtDate(parent.start_date, "d MMM yyyy") : "any start"} – {parent.due_date ? fmtDate(parent.due_date, "d MMM yyyy") : "no due date"}.
            </dd>
          )}
          {!parent && subtasks.some((s) => s.start_date || s.due_date) && (
            <dd className="col-start-2 px-2 text-xs text-slate-500">Subtask dates move to stay inside these dates.</dd>
          )}
        </dl>

        {/* description */}
        <Section title="Description">
          <AutoSaveTextarea value={task.description} disabled={!canEdit} placeholder="Add details, goals, test notes…"
            onSave={(description) => patch({ description })} />
        </Section>

        {/* subtasks */}
        <Section title={`Subtasks${subtasks.length ? ` · ${subtasks.filter((s) => s.status === "done").length}/${subtasks.length}` : ""}`} icon={<ListTree className="size-4" />}>
          <ul className="divide-y divide-line-soft rounded-xl ring-1 ring-line">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                <button aria-label={s.status === "done" ? "Mark not done" : "Mark done"} disabled={!canEdit && !internOnTask(me, s, store.collaborators.filter((c) => c.task_id === s.id).map((c) => c.user_id))}
                  onClick={() => changeStatus(s, s.status === "done" ? "todo" : "done")}>
                  {s.status === "done" ? <CheckCircle2 className="size-[18px] text-emerald-600" /> : <Circle className="size-[18px] text-slate-400 hover:text-emerald-600" />}
                </button>
                <button className={cx("flex-1 truncate text-left text-sm hover:text-brand-600", s.status === "done" && "text-slate-400 line-through")}
                  onClick={() => openTask(s.id)}>{s.title}</button>
                <DueBadge task={s} />
                {s.owner_id && <Avatar person={store.profileById.get(s.owner_id)} size={22} />}
              </li>
            ))}
            {canEdit && !task.parent_id && (
              <li className="px-3 py-1.5">
                <QuickAdd placeholder="Add a subtask and press Enter"
                  onAdd={(title) => store.mutate(() => supabase.from("tasks").insert({ project_id: project.id, parent_id: task.id, title, owner_id: me?.id ?? null }))} />
              </li>
            )}
          </ul>
          {task.parent_id && <p className="mt-1 text-xs text-slate-500">Subtasks can't have their own subtasks.</p>}
        </Section>


        {/* dependencies */}
        <Section title="Predecessors" icon={<Link2 className="size-4" />}>
          <DependencyEditor task={task} waitingOn={waitingOn} blocking={blocking} canEdit={canEdit} />
        </Section>

        {/* attachments */}
        <Section title={`Files${files.length ? ` · ${files.length}` : ""}`} icon={<Paperclip className="size-4" />}>
          <Attachments task={task} files={files} canEdit={canEdit} reload={loadExtras} />
        </Section>

        {/* comments */}
        <Section title={`Comments${comments.length ? ` · ${comments.length}` : ""}`} icon={<MessageSquare className="size-4" />}>
          <ul className="space-y-3">
            {comments.map((c) => {
              const author = c.author_id ? store.profileById.get(c.author_id) : undefined;
              const mine = c.author_id === me?.id;
              return (
                <li key={c.id} className="group flex gap-2.5">
                  <Avatar person={author} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{author?.full_name ?? "Former member"}</span>
                      <span className="text-xs text-slate-400">{timeAgo(c.created_at)}</span>
                      {(mine || isManager(me)) && (
                        <button className="ml-auto text-xs text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-600"
                          onClick={async () => {
                            if (!(await confirm({ title: "Delete comment?", confirm: "Delete", danger: true }))) return;
                            const { error } = await supabase.from("comments").delete().eq("id", c.id);
                            if (error) toast.error(errorText(error)); else loadExtras();
                          }}>Delete</button>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-slate-700">{c.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          {canContribute(me) || canStatus ? (
            <CommentBox onPost={async (body) => {
              const { error } = await supabase.from("comments").insert({ task_id: task.id, author_id: me!.id, body });
              if (error) { toast.error(errorText(error)); return false; }
              loadExtras();
              return true;
            }} />
          ) : comments.length === 0 && <p className="text-sm text-slate-400">No comments yet.</p>}
        </Section>

        <p className="mt-6 text-xs text-slate-400">
          Created {timeAgo(task.created_at)}{task.created_by && store.profileById.get(task.created_by) ? ` by ${store.profileById.get(task.created_by)!.full_name}` : ""}
          {task.completed_at ? ` · completed ${timeAgo(task.completed_at)}` : ""}
        </p>
      </div>

      <CopyTaskModal open={copyOpen} task={task} onClose={() => setCopyOpen(false)} onCopied={(id) => { setCopyOpen(false); openTask(id); }} />
    </PanelShell>
  );
}

function PanelShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  // Clicking anywhere outside the panel closes it (but not clicks in dialogs or toasts, and not
  // when the click opened another task, which swaps the panel instead).
  useEffect(() => {
    const outside = (t: EventTarget | null) => t instanceof Element && !ref.current?.contains(t)
      && !t.closest('[role="dialog"], [aria-live], [data-keep-panel]') && t.isConnected;
    let downOutside = false;
    const down = (e: MouseEvent) => { downOutside = outside(e.target); };
    const click = (e: MouseEvent) => {
      if (!downOutside || !outside(e.target)) return;
      const before = new URLSearchParams(window.location.search).get("task");
      setTimeout(() => { if (new URLSearchParams(window.location.search).get("task") === before) onClose(); }, 0);
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("click", click, true);
    return () => { document.removeEventListener("mousedown", down, true); document.removeEventListener("click", click, true); };
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-scrim/40 md:hidden" onClick={onClose} />
      <section ref={ref} aria-label="Task details"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-pop ring-1 ring-line md:w-[560px]">
        {children}
      </section>
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-bold tracking-wider text-slate-500 uppercase">{icon}{title}</h3>
      {children}
    </section>
  );
}

export function DueBadge({ task }: { task: Task }) {
  const d = dueLabel(task.due_date, task.status === "done");
  if (!d) return null;
  return (
    <span className={cx("text-xs font-semibold whitespace-nowrap", d.tone === "late" ? "inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-red-700 before:size-1.5 before:rounded-full before:bg-current" : d.tone === "soon" ? "text-cta" : "text-slate-500")}>
      {d.text}
    </span>
  );
}

function EditableTitle({ value, onSave, disabled, done }: { value: string; onSave: (v: string) => void; disabled: boolean; done: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = () => { const t = v.trim(); if (t && t !== value) onSave(t); else setV(value); };
  return (
    <textarea aria-label="Task name" value={v} disabled={disabled} rows={1}
      onChange={(e) => setV(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
      className={cx("w-full resize-none rounded-md border-0 bg-transparent px-1 py-0.5 -mx-1 text-[21px] leading-snug font-bold tracking-tight text-ink focus:bg-slate-50 focus:ring-2 focus:ring-navy-400 focus:outline-none disabled:text-ink field-sizing-content",
        done && "text-slate-500")} />
  );
}

function AutoSaveTextarea({ value, onSave, disabled, placeholder }: { value: string; onSave: (v: string) => void; disabled: boolean; placeholder: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Textarea value={v} disabled={disabled} placeholder={disabled ? "No description" : placeholder} aria-label="Description"
      className="field-sizing-content min-h-24" onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />
  );
}

export function QuickAdd({ placeholder, onAdd, inputId }: { placeholder: string; onAdd: (title: string) => unknown; inputId?: string }) {
  const [v, setV] = useState("");
  const add = async () => { const t = v.trim(); if (!t) return; setV(""); await onAdd(t); };
  return (
    <div className="group/add flex items-center gap-2 rounded-lg px-1.5 ring-1 ring-transparent ring-inset focus-within:bg-white focus-within:ring-navy-400 hover:bg-slate-50 focus-within:hover:bg-white">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-cta group-focus-within/add:bg-cta group-focus-within/add:text-on-accent">
        <Plus className="size-3.5" strokeWidth={2.5} />
      </span>
      <input id={inputId} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") { setV(""); e.currentTarget.blur(); } }}
        className="h-9 min-w-0 flex-1 bg-transparent text-sm font-medium text-ink placeholder:font-medium placeholder:text-slate-500 focus:outline-none" style={{ outline: "none" }} />
      {v.trim() && (
        <button type="button" onClick={add} className="shrink-0 rounded-md bg-cta px-2.5 py-1 text-xs font-semibold text-on-accent hover:bg-cta-hover">Add</button>
      )}
    </div>
  );
}

function CommentBox({ onPost }: { onPost: (body: string) => Promise<boolean> }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const post = async () => {
    if (!v.trim()) return;
    setBusy(true);
    if (await onPost(v.trim())) setV("");
    setBusy(false);
  };
  return (
    <div className="mt-3">
      <Textarea value={v} onChange={(e) => setV(e.target.value)} placeholder="Write a comment… (Ctrl+Enter to post)" aria-label="New comment"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) post(); }} className="min-h-16" />
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="primary" loading={busy} disabled={!v.trim()} onClick={post}>Comment</Button>
      </div>
    </div>
  );
}

function DependencyEditor({ task, waitingOn, blocking, canEdit }: { task: Task; waitingOn: Task[]; blocking: Task[]; canEdit: boolean }) {
  const store = useStore();
  const openTask = useOpenTask();
  const [adding, setAdding] = useState(false);
  const Row = ({ t, onRemove }: { t: Task; onRemove?: () => void }) => {
    const proj = t.project_id !== task.project_id ? store.projectById.get(t.project_id) : undefined;
    return (
      <li className="flex items-center gap-2 px-3 py-2 text-sm">
        <span className={cx("size-2 shrink-0 rounded-full", TASK_STATUS_DOT[t.status])} title={TASK_STATUS_LABEL[t.status]} />
        <button className={cx("min-w-0 flex-1 truncate text-left hover:text-brand-600", t.status === "done" && "text-slate-400 line-through")} onClick={() => openTask(t.id)}>
          {proj && <span className="text-slate-500">{proj.code} · </span>}{t.title}
        </button>
        <span className="shrink-0 text-xs text-slate-500">{TASK_STATUS_LABEL[t.status]}{t.due_date && t.status !== "done" ? ` · due ${fmtDate(t.due_date)}` : ""}</span>
        {onRemove && <button aria-label="Remove predecessor" className="shrink-0 text-slate-400 hover:text-red-600" onClick={onRemove}><X className="size-3.5" /></button>}
      </li>
    );
  };

  // A task can't start before its predecessors are due to end.
  const latest = waitingOn.filter((t) => t.status !== "done" && t.due_date).map((t) => t.due_date!).sort().pop();
  const start = task.start_date ?? task.due_date;
  const conflict = task.status !== "done" && latest && start && start <= latest;
  async function moveAfter() {
    if (!latest || !start) return;
    const newStart = format(addDays(parseISO(latest), 1), "yyyy-MM-dd");
    const shift = differenceInCalendarDays(parseISO(newStart), parseISO(start));
    const patch: Partial<Task> = {};
    if (task.start_date) patch.start_date = newStart;
    if (task.due_date) patch.due_date = format(addDays(parseISO(task.due_date), shift), "yyyy-MM-dd");
    await store.patchTask(task.id, patch);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">Must be Done before this task can start</p>
        <ul className="rounded-xl ring-1 ring-line [&>li+li]:border-t [&>li+li]:border-line-soft">
          {waitingOn.map((t) => (
            <Row key={t.id} t={t} onRemove={canEdit ? () => store.mutate(() => supabase.from("task_dependencies").delete().match({ task_id: task.id, depends_on_id: t.id })) : undefined} />
          ))}
          {waitingOn.length === 0 && !adding && <li className="px-2.5 py-1.5 text-sm text-slate-400">No predecessors</li>}
          {canEdit && (
            <li className="px-2.5 py-1.5">
              {adding ? (
                <PredecessorPicker task={task} exclude={waitingOn.map((t) => t.id)} onClose={() => setAdding(false)}
                  onPick={async (id) => {
                    setAdding(false);
                    await store.mutate(() => supabase.from("task_dependencies").insert({ task_id: task.id, depends_on_id: id }), { success: "Predecessor added" });
                  }} />
              ) : (
                <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-sm font-semibold text-cta hover:text-cta-hover">
                  <Plus className="size-4" /> Add predecessor
                </button>
              )}
            </li>
          )}
        </ul>
        {conflict && (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>This task starts on <b>{fmtDate(start)}</b>, but a predecessor is due on <b>{fmtDate(latest)}</b>.
              {canEdit && <> <button className="font-medium underline hover:text-amber-700" onClick={moveAfter}>Move this task to start {fmtDate(format(addDays(parseISO(latest), 1), "yyyy-MM-dd"))}</button></>}</span>
          </div>
        )}
      </div>
      {blocking.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Waiting on this task</p>
          <ul className="rounded-xl ring-1 ring-line [&>li+li]:border-t [&>li+li]:border-line-soft">{blocking.map((t) => <Row key={t.id} t={t} />)}</ul>
        </div>
      )}
    </div>
  );
}

/** Search box with this project's tasks. Subtasks sit under their main task. */
function PredecessorPicker({ task, exclude, onPick, onClose }: { task: Task; exclude: string[]; onPick: (id: string) => void; onClose: () => void }) {
  const store = useStore();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [onClose]);

  const groups = useMemo(() => {
    const skip = new Set([task.id, ...exclude, ...(task.parent_id ? [task.parent_id] : [])]);
    const needle = q.trim().toLowerCase();
    const byProject = new Map<string, Task[]>();
    for (const t of store.tasks) {
      if (t.project_id !== task.project_id || skip.has(t.id) || t.parent_id === task.id) continue;
      if (!byProject.has(t.project_id)) byProject.set(t.project_id, []);
      byProject.get(t.project_id)!.push(t);
    }
    const order = [...byProject.keys()].sort((a, b) => (a === task.project_id ? -1 : b === task.project_id ? 1
      : (store.projectById.get(a)?.code ?? "").localeCompare(store.projectById.get(b)?.code ?? "")));
    const out: { project: string; label: string; rows: { t: Task; sub: boolean }[] }[] = [];
    for (const pid of order) {
      const proj = store.projectById.get(pid);
      const list = byProject.get(pid)!;
      const ordered: { t: Task; sub: boolean }[] = [];
      for (const m of list.filter((t) => !t.parent_id)) {
        ordered.push({ t: m, sub: false });
        for (const sub of list.filter((t) => t.parent_id === m.id)) ordered.push({ t: sub, sub: true });
      }
      for (const orphan of list.filter((t) => t.parent_id && !list.some((m) => m.id === t.parent_id))) ordered.push({ t: orphan, sub: true });
      const rows = needle
        ? ordered.filter(({ t }) => t.title.toLowerCase().includes(needle) || (proj?.code ?? "").toLowerCase().includes(needle) || (proj?.name ?? "").toLowerCase().includes(needle))
        : ordered;
      if (rows.length) out.push({ project: pid, label: `${proj?.code ?? ""} · ${proj?.name ?? ""}`, rows });
    }
    return out;
  }, [store.tasks, store.projectById, task, exclude, q]);
  const flat = groups.flatMap((g) => g.rows.map((r) => r.t));
  const shown = Math.min(flat.length, 200);

  const mark = (text: string) => {
    const n = q.trim();
    const i = n ? text.toLowerCase().indexOf(n.toLowerCase()) : -1;
    return i < 0 ? text : <>{text.slice(0, i)}<b className="text-ink">{text.slice(i, i + n.length)}</b>{text.slice(i + n.length)}</>;
  };
  let idx = -1;
  return (
    <div ref={box} className="rounded-xl bg-white shadow-pop ring-1 ring-line">
      <div className="flex items-center gap-2 border-b border-line px-2.5">
        <Search className="size-4 text-slate-400" />
        <input autoFocus aria-label="Search tasks" value={q} placeholder="Search this project's tasks…"
          className="h-9 flex-1 bg-transparent text-sm outline-none"
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, shown - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter" && flat[hi]) { e.preventDefault(); onPick(flat[hi].id); }
            else if (e.key === "Escape") onClose();
          }} />
        <button aria-label="Close" className="text-slate-400 hover:text-slate-700" onClick={onClose}><X className="size-4" /></button>
      </div>
      <div className="max-h-72 overflow-y-auto py-1 scroll-thin" role="listbox">
        {groups.map((g) => (
          <div key={g.project}>
            <p className="truncate px-2.5 pt-2 pb-0.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase">{g.label}</p>
            {g.rows.map(({ t, sub }) => {
              idx++;
              if (idx >= 200) return null;
              const i = idx;
              return (
                <button key={t.id} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)} onClick={() => onPick(t.id)}
                  className={cx("flex w-full items-center gap-2 py-1.5 pr-2.5 text-left text-sm", sub ? "pl-7" : "pl-2.5", i === hi && "bg-navy-50")}>
                  <span className={cx("size-2 shrink-0 rounded-full", TASK_STATUS_DOT[t.status])} />
                  <span className={cx("min-w-0 flex-1 truncate text-slate-700", t.status === "done" && "text-slate-400")}>{mark(t.title)}</span>
                  <span className="shrink-0 text-xs text-slate-400">{sub ? "subtask · " : ""}{TASK_STATUS_LABEL[t.status]}{t.due_date ? ` · ${fmtDate(t.due_date)}` : ""}</span>
                </button>
              );
            })}
          </div>
        ))}
        {flat.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">No tasks match "{q}".</p>}
      </div>
    </div>
  );
}

function Attachments({ task, files, canEdit, reload }: { task: Task; files: Attachment[]; canEdit: boolean; reload: () => void }) {
  const store = useStore();
  const { me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const maxMb = Number(store.settings.max_upload_mb) || 10;

  async function upload(list: FileList | null) {
    if (!list?.length || !me) return;
    setBusy(true);
    for (const file of Array.from(list)) {
      if (file.size > maxMb * 1024 * 1024) {
        toast.error(`"${file.name}" is ${fmtBytes(file.size)}. The limit is ${maxMb} MB.`);
        continue;
      }
      const safe = file.name.replace(/[^\w.\-() ]+/g, "_");
      const path = `${task.project_id}/${task.id}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
      const up = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type || undefined });
      if (up.error) { toast.error(`${file.name}: ${errorText(up.error)}`); continue; }
      const { error } = await supabase.from("attachments").insert({
        task_id: task.id, file_name: file.name, storage_path: path, size_bytes: file.size, mime_type: file.type, uploaded_by: me.id,
      });
      if (error) { toast.error(errorText(error)); await supabase.storage.from("attachments").remove([path]); }
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    reload();
  }

  async function download(f: Attachment) {
    const { data, error } = await supabase.storage.from("attachments").createSignedUrl(f.storage_path, 120, { download: f.file_name });
    if (error || !data) { toast.error(errorText(error)); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function remove(f: Attachment) {
    if (!(await confirm({ title: `Delete "${f.file_name}"?`, confirm: "Delete", danger: true }))) return;
    const { error } = await supabase.from("attachments").delete().eq("id", f.id);
    if (error) { toast.error(errorText(error)); return; }
    await supabase.storage.from("attachments").remove([f.storage_path]);
    reload();
  }

  return (
    <div>
      {files.length > 0 && (
        <ul className="mb-2 divide-y divide-line-soft rounded-lg ring-1 ring-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-2.5 py-2 text-sm">
              <Paperclip className="size-4 shrink-0 text-slate-400" />
              <button onClick={() => download(f)} className="min-w-0 flex-1 truncate text-left hover:text-brand-600">{f.file_name}</button>
              <span className="shrink-0 text-xs text-slate-400">{fmtBytes(f.size_bytes)}</span>
              <IconButton label={`Download ${f.file_name}`} onClick={() => download(f)}><Download className="size-4" /></IconButton>
              {(f.uploaded_by === me?.id || isManager(me)) && (
                <IconButton label={`Delete ${f.file_name}`} onClick={() => remove(f)}><Trash2 className="size-4" /></IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <>
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} aria-label="Upload files" />
          <Button size="sm" loading={busy} icon={<Paperclip className="size-4" />} onClick={() => input.current?.click()}>Attach files</Button>
          <span className="ml-2 text-xs text-slate-400">Up to {maxMb} MB each</span>
        </>
      ) : files.length === 0 && <p className="text-sm text-slate-400">No files.</p>}
    </div>
  );
}
