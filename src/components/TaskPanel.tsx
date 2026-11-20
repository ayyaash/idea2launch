import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  X, Copy, Trash2, CheckCircle2, Circle, Paperclip, Download, Link2, MessageSquare, ListTree, Lock, ArrowRight, Plus, MoreHorizontal,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase, errorText } from "../lib/supabase";
import {
  PRIORITIES, PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL, TASK_STATUS_DOT, fmtBytes, timeAgo, dueLabel,
} from "../lib/format";
import { canDeleteTask, canEditProject, canContribute, isManager } from "../lib/perms";
import type { Attachment, Comment, Task, TaskStatus } from "../lib/types";
import { Avatar, Button, IconButton, Input, Select, Textarea, cx, useConfirm } from "./ui";
import { PeoplePicker, PersonChip, PersonSelect } from "./pickers";
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

/** Ask before starting a task whose dependencies are not done yet. */
export function useStatusChange() {
  const store = useStore();
  const confirm = useConfirm();
  return useCallback(async (task: Task, status: TaskStatus) => {
    if (task.status === "todo" && status !== "todo") {
      const blockers = store.dependencies
        .filter((d) => d.task_id === task.id)
        .map((d) => store.taskById.get(d.depends_on_id))
        .filter((t): t is Task => !!t && t.status !== "done");
      if (blockers.length) {
        const ok = await confirm({
          title: "This task is waiting on other work",
          text: `${blockers.map((b) => `"${b.title}"`).join(", ")} ${blockers.length > 1 ? "are" : "is"} not done yet. Start this task anyway?`,
          confirm: "Start anyway",
        });
        if (!ok) return false;
      }
    }
    return store.patchTask(task.id, { status });
  }, [store, confirm]);
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
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <Button size="sm" variant={done ? "secondary" : "primary"} disabled={!canEdit}
          icon={done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4" />}
          onClick={() => changeStatus(task, done ? "todo" : "done")}>
          {done ? "Completed" : "Mark complete"}
        </Button>
        <div className="flex-1" />
        {canContribute(me) && (
          <IconButton label="Copy task" onClick={() => setCopyOpen(true)}><Copy className="size-4" /></IconButton>
        )}
        {canDeleteTask(me, project, task, members) && (
          <div className="relative">
            <IconButton label="More actions" onClick={() => setMoreOpen((o) => !o)}><MoreHorizontal className="size-4" /></IconButton>
            {moreOpen && (
              <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200" onMouseLeave={() => setMoreOpen(false)}>
                <button onClick={() => { setMoreOpen(false); remove(); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                  <Trash2 className="size-4" /> Delete task
                </button>
              </div>
            )}
          </div>
        )}
        <IconButton label="Close panel" onClick={onClose}><X className="size-5" /></IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-8 scroll-thin">
        <div className="mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
          <Link to={`/projects/${project.id}`} className="font-medium hover:text-brand-600" onClick={() => nav(`/projects/${project.id}?task=${task.id}`)}>
            {project.code} · {project.name}
          </Link>
          {parent && (<><ArrowRight className="size-3" /><button className="hover:text-brand-600" onClick={() => openTask(parent.id)}>{parent.title}</button></>)}
        </div>

        <EditableTitle value={task.title} disabled={!canEdit} onSave={(title) => patch({ title })} done={done} />

        {blocked && !done && (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
            <Lock className="mt-0.5 size-4 shrink-0" />
            <span>Waiting on {waitingOn.filter((t) => t.status !== "done").map((t) => `"${t.title}"`).join(", ")} before this can start.</span>
          </div>
        )}
        {!canEdit && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
            You can view this task. Only people assigned to this project can change it.
          </p>
        )}

        {/* fields */}
        <dl className="mt-4 grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-slate-500">Status</dt>
          <dd>
            <Select aria-label="Status" value={task.status} disabled={!canEdit} className="max-w-52"
              onChange={(e) => changeStatus(task, e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
            </Select>
          </dd>
          {!task.parent_id && (
            <>
              <dt className="text-slate-500">Phase</dt>
              <dd>
                <Select aria-label="Phase" value={task.section_id ?? ""} disabled={!canEdit} className="max-w-52"
                  onChange={(e) => patch({ section_id: e.target.value || null })}>
                  <option value="">No phase</option>
                  {store.sectionsOf(project.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </dd>
            </>
          )}
          <dt className="text-slate-500">Priority</dt>
          <dd>
            <Select aria-label="Priority" value={task.priority} disabled={!canEdit} className="max-w-52"
              onChange={(e) => patch({ priority: e.target.value as Task["priority"] })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </dd>
          <dt className="text-slate-500">Owner</dt>
          <dd><PersonSelect label="Owner" value={task.owner_id} projectId={project.id} disabled={!canEdit} className="max-w-64" onChange={(owner_id) => patch({ owner_id })} /></dd>
          <dt className="self-start pt-1 text-slate-500">Collaborators</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
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
          <dd><Input type="date" aria-label="Start date" value={task.start_date ?? ""} disabled={!canEdit} className="max-w-44"
            onChange={(e) => patch({ start_date: e.target.value || null })} /></dd>
          <dt className="text-slate-500">Due date</dt>
          <dd className="flex items-center gap-2">
            <Input type="date" aria-label="Due date" value={task.due_date ?? ""} disabled={!canEdit} className="max-w-44"
              min={task.start_date ?? undefined} onChange={(e) => patch({ due_date: e.target.value || null })} />
            <DueBadge task={task} />
          </dd>
        </dl>

        {/* description */}
        <Section title="Description">
          <AutoSaveTextarea value={task.description} disabled={!canEdit} placeholder="Add details, goals, test notes…"
            onSave={(description) => patch({ description })} />
        </Section>

        {/* subtasks */}
        <Section title={`Subtasks${subtasks.length ? ` · ${subtasks.filter((s) => s.status === "done").length}/${subtasks.length}` : ""}`} icon={<ListTree className="size-4" />}>
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <button aria-label={s.status === "done" ? "Mark not done" : "Mark done"} disabled={!canEdit}
                  onClick={() => store.patchTask(s.id, { status: s.status === "done" ? "todo" : "done" })}>
                  {s.status === "done" ? <CheckCircle2 className="size-[18px] text-emerald-600" /> : <Circle className="size-[18px] text-slate-400 hover:text-emerald-600" />}
                </button>
                <button className={cx("flex-1 truncate text-left text-sm hover:text-brand-600", s.status === "done" && "text-slate-400 line-through")}
                  onClick={() => openTask(s.id)}>{s.title}</button>
                <DueBadge task={s} />
                {s.owner_id && <Avatar person={store.profileById.get(s.owner_id)} size={22} />}
              </li>
            ))}
            {canEdit && !task.parent_id && (
              <li className="px-2.5 py-1.5">
                <QuickAdd placeholder="Add a subtask and press Enter"
                  onAdd={(title) => store.mutate(() => supabase.from("tasks").insert({ project_id: project.id, parent_id: task.id, title }))} />
              </li>
            )}
          </ul>
          {task.parent_id && <p className="mt-1 text-xs text-slate-500">Subtasks can't have their own subtasks.</p>}
        </Section>

        {/* dependencies */}
        <Section title="Dependencies" icon={<Link2 className="size-4" />}>
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
          {canContribute(me) ? (
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
  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20 md:hidden" onClick={onClose} />
      <section aria-label="Task details"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl ring-1 ring-slate-200 md:w-[560px]">
        {children}
      </section>
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold tracking-wide text-slate-500 uppercase">{icon}{title}</h3>
      {children}
    </section>
  );
}

export function DueBadge({ task }: { task: Task }) {
  const d = dueLabel(task.due_date, task.status === "done");
  if (!d) return null;
  return (
    <span className={cx("text-xs whitespace-nowrap", d.tone === "late" ? "font-medium text-red-600" : d.tone === "soon" ? "text-amber-700" : "text-slate-500")}>
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
      className={cx("w-full resize-none rounded-md border-0 bg-transparent px-1 py-0.5 -mx-1 text-xl font-semibold text-slate-900 focus:bg-slate-50 focus:ring-2 focus:ring-brand-500 focus:outline-none disabled:text-slate-900 field-sizing-content",
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

export function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => unknown }) {
  const [v, setV] = useState("");
  return (
    <div className="flex items-center gap-2">
      <Plus className="size-4 text-slate-400" />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        onKeyDown={async (e) => { if (e.key === "Enter" && v.trim()) { const t = v.trim(); setV(""); await onAdd(t); } }}
        className="h-7 flex-1 bg-transparent text-sm placeholder:text-slate-400 focus:outline-none" />
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
  const candidates = useMemo(() => store.tasks.filter((t) => t.project_id === task.project_id && t.id !== task.id
    && !waitingOn.some((w) => w.id === t.id) && t.parent_id !== task.id), [store.tasks, task, waitingOn]);
  const Row = ({ t, onRemove }: { t: Task; onRemove?: () => void }) => (
    <li className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
      <span className={cx("size-2 rounded-full", TASK_STATUS_DOT[t.status])} title={TASK_STATUS_LABEL[t.status]} />
      <button className={cx("flex-1 truncate text-left hover:text-brand-600", t.status === "done" && "text-slate-400 line-through")} onClick={() => openTask(t.id)}>{t.title}</button>
      <span className="text-xs text-slate-500">{TASK_STATUS_LABEL[t.status]}</span>
      {onRemove && <button aria-label="Remove dependency" className="text-slate-400 hover:text-red-600" onClick={onRemove}><X className="size-3.5" /></button>}
    </li>
  );
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">Waiting on (must finish first)</p>
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {waitingOn.map((t) => (
            <Row key={t.id} t={t} onRemove={canEdit ? () => store.mutate(() => supabase.from("task_dependencies").delete().match({ task_id: task.id, depends_on_id: t.id })) : undefined} />
          ))}
          {waitingOn.length === 0 && !adding && <li className="px-2.5 py-1.5 text-sm text-slate-400">Nothing</li>}
          {canEdit && (
            <li className="px-2.5 py-1.5">
              {adding ? (
                <Select autoFocus aria-label="Choose a task this one waits on" defaultValue="" onBlur={() => setAdding(false)}
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    await store.mutate(() => supabase.from("task_dependencies").insert({ task_id: task.id, depends_on_id: e.target.value }));
                    setAdding(false);
                  }}>
                  <option value="">Choose a task in this project…</option>
                  {candidates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </Select>
              ) : (
                <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
                  <Plus className="size-4" /> Add a task this one waits on
                </button>
              )}
            </li>
          )}
        </ul>
      </div>
      {blocking.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Blocking (waiting on this task)</p>
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">{blocking.map((t) => <Row key={t.id} t={t} />)}</ul>
        </div>
      )}
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
        <ul className="mb-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
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
