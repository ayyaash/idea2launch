import type { ReactNode } from "react";
import { CheckCircle2, Circle, ChevronRight, Lock, ListTree } from "lucide-react";
import { useStore } from "../lib/store";
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_MARK, PRIORITY_STYLE, TASK_STATUSES, TASK_STATUS_LABEL, TASK_STATUS_STYLE, dueLabel, fmtDate, fmtRange, fmtShort } from "../lib/format";
import type { Task } from "../lib/types";
import { Input, Pill, cx } from "./ui";
import { DueBadge, useOpenTask, useStatusChange } from "./TaskPanel";
import { OwnerQuickPick, QuickOption, QuickPopover } from "./pickers";
import { useToast } from "./Toast";
import { useAuth } from "../lib/auth";
import { internOnTask } from "../lib/perms";

/** One task line used in project lists and "My tasks". */
export function TaskRow({ task, canEdit, showProject, depth = 0, expanded, onToggleExpand, dragHandle }: {
  task: Task; canEdit: boolean; showProject?: boolean; depth?: number; expanded?: boolean; onToggleExpand?: () => void;
  /** Grip shown at the start of the row, for drag-to-reorder lists. */
  dragHandle?: ReactNode;
}) {
  const store = useStore();
  const openTask = useOpenTask();
  const changeStatus = useStatusChange();
  const project = store.projectById.get(task.project_id);
  const subs = store.tasks.filter((t) => t.parent_id === task.id);
  const blocked = task.status !== "done" && store.dependencies.some((d) => d.task_id === task.id && store.taskById.get(d.depends_on_id)?.status !== "done");
  const done = task.status === "done";
  const setOwner = (owner_id: string | null, intern_name: string) => store.patchTask(task.id, { owner_id, intern_name });
  const toast = useToast();
  const { me } = useAuth();
  const canStatus = canEdit || internOnTask(me, task, store.collaborators.filter((c) => c.task_id === task.id).map((c) => c.user_id));
  const mainTask = task.parent_id ? store.taskById.get(task.parent_id) : undefined;
  function setDate(key: "start_date" | "due_date", v: string | null) {
    if (v && mainTask) {
      if (mainTask.start_date && v < mainTask.start_date) { toast.error(`A subtask can't start before its main task (${fmtDate(mainTask.start_date, "d MMM yyyy")}).`); return; }
      if (mainTask.due_date && v > mainTask.due_date) { toast.error(`A subtask can't end after its main task (${fmtDate(mainTask.due_date, "d MMM yyyy")}).`); return; }
    }
    const start = key === "start_date" ? v : task.start_date;
    const due = key === "due_date" ? v : task.due_date;
    if (start && due && due < start) { toast.error("The due date can't be before the start date."); return; }
    store.patchTask(task.id, { [key]: v });
  }
  const parent = task.parent_id && showProject ? store.taskById.get(task.parent_id) : undefined;

  return (
    <div role="row" className="group grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line-soft px-3 py-2.5 hover:bg-slate-50/80 md:grid-cols-[minmax(0,1fr)_150px_110px_88px_110px]">
      <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 26 }}>
        {dragHandle}
        {onToggleExpand ? (
          <button aria-label={expanded ? "Hide subtasks" : "Show subtasks"} onClick={onToggleExpand} className="text-slate-400 hover:text-slate-700">
            <ChevronRight className={cx("size-4 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : <span className="w-4" />}
        <button aria-label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`} disabled={!canStatus}
          onClick={() => changeStatus(task, done ? "todo" : "done")} className="shrink-0 disabled:cursor-default">
          {done ? <CheckCircle2 className="size-[18px] text-emerald-600" /> : <Circle className="size-[18px] text-slate-400 hover:text-emerald-600" />}
        </button>
        <button onClick={() => openTask(task.id)} className="min-w-0 flex-1 text-left">
          <span className={cx("block truncate text-[13.5px]", done ? "text-slate-400 line-through" : "font-medium text-ink")}>
            {task.title}
          </span>
          {(showProject || parent) && (
            <span className="block truncate text-xs text-slate-500">
              {project?.code} · {project?.name}{parent ? ` › ${parent.title}` : ""}
            </span>
          )}
        </button>
        {blocked && <Lock className="size-3.5 shrink-0 text-amber-600" aria-label="Waiting on another task" />}
        {subs.length > 0 && (
          <span className="flex shrink-0 items-center gap-0.5 text-xs text-slate-500" title="Subtasks">
            <ListTree className="size-3.5" />{subs.filter((s) => s.status === "done").length}/{subs.length}
          </span>
        )}
      </div>
      {/* compact meta for phones */}
      <div className="flex items-center gap-2 md:hidden">
        <DueBadge task={task} />
        <OwnerQuickPick compact value={task.owner_id} internName={task.intern_name} projectId={task.project_id} disabled={!canEdit} onChange={setOwner} />
      </div>
      <div className="hidden min-w-0 md:block">
        <OwnerQuickPick value={task.owner_id} internName={task.intern_name} projectId={task.project_id} disabled={!canEdit} onChange={setOwner} />
      </div>
      <div className="hidden min-w-0 text-sm md:block">
        <QuickPopover label={`Dates for "${task.title}"`} disabled={!canEdit} width={240} trigger={
          task.due_date && task.start_date && dueLabel(task.due_date, done)?.tone !== "late"
            ? <span className="text-xs whitespace-nowrap text-slate-600">{fmtRange(task.start_date, task.due_date)}</span>
            : task.due_date ? <DueBadge task={task} /> : task.start_date ? <span className="text-xs text-slate-400">from {fmtShort(task.start_date)}</span> : <span className="text-xs text-slate-400">{canEdit ? "Set dates" : "–"}</span>
        }>
          {() => (
            <div className="space-y-2 p-1.5">
              <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">Start date</span>
                <Input type="date" value={task.start_date ?? ""} onChange={(e) => setDate("start_date", e.target.value || null)} /></label>
              <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">Due date</span>
                <Input type="date" value={task.due_date ?? ""} onChange={(e) => setDate("due_date", e.target.value || null)} /></label>
              {mainTask && (mainTask.start_date || mainTask.due_date) && (
                <p className="text-[11px] text-slate-500">Must stay inside the main task: {fmtRange(mainTask.start_date, mainTask.due_date) || (mainTask.start_date ? `from ${fmtShort(mainTask.start_date)}` : `until ${fmtShort(mainTask.due_date!)}`)}</p>
              )}
            </div>
          )}
        </QuickPopover>
      </div>
      <div className="hidden md:block">
        <QuickPopover label={`Priority: ${PRIORITY_LABEL[task.priority]}. Change priority`} disabled={!canEdit} width={170} trigger={
          <Pill className={PRIORITY_STYLE[task.priority]}><span className="mr-1 font-extrabold tracking-tight">{PRIORITY_MARK[task.priority]}</span>{PRIORITY_LABEL[task.priority]}</Pill>
        }>
          {(close) => PRIORITIES.map((p) => (
            <QuickOption key={p} selected={p === task.priority} onClick={() => { close(); if (p !== task.priority) store.patchTask(task.id, { priority: p }); }}>
              <Pill className={PRIORITY_STYLE[p]}><span className="mr-1 font-extrabold tracking-tight">{PRIORITY_MARK[p]}</span>{PRIORITY_LABEL[p]}</Pill>
            </QuickOption>
          ))}
        </QuickPopover>
      </div>
      <div className="hidden md:block">
        <QuickPopover label={`Status: ${TASK_STATUS_LABEL[task.status]}. Change status`} disabled={!canStatus} width={170} trigger={
          <Pill className={TASK_STATUS_STYLE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Pill>
        }>
          {(close) => TASK_STATUSES.map((st) => (
            <QuickOption key={st} selected={st === task.status} onClick={() => { close(); if (st !== task.status) changeStatus(task, st); }}>
              <Pill className={TASK_STATUS_STYLE[st]}>{TASK_STATUS_LABEL[st]}</Pill>
            </QuickOption>
          ))}
        </QuickPopover>
      </div>
    </div>
  );
}

export function TaskTableHeader() {
  return (
    <div className="hidden grid-cols-[minmax(0,1fr)_150px_110px_88px_110px] gap-2 border-b border-line-soft bg-slate-50/80 px-3 py-2 text-[11px] font-bold tracking-wider text-slate-500 uppercase md:grid">
      <span className="pl-12">Task</span><span>Owner</span><span>Dates</span><span>Priority</span><span>Status</span>
    </div>
  );
}
