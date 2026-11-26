import type { ReactNode } from "react";
import { CheckCircle2, Circle, ChevronRight, Lock, ListTree } from "lucide-react";
import { useStore } from "../lib/store";
import { PRIORITY_LABEL, PRIORITY_STYLE, TASK_STATUS_LABEL, TASK_STATUS_STYLE, dueLabel, fmtRange, fmtShort } from "../lib/format";
import type { Task } from "../lib/types";
import { Avatar, Pill, cx } from "./ui";
import { DueBadge, useOpenTask, useStatusChange } from "./TaskPanel";

/** One task line used in project lists and "My tasks". */
export function TaskRow({ task, canEdit, showProject, depth = 0, expanded, onToggleExpand, dragHandle }: {
  task: Task; canEdit: boolean; showProject?: boolean; depth?: number; expanded?: boolean; onToggleExpand?: () => void;
  /** Grip shown at the start of the row, for drag-to-reorder lists. */
  dragHandle?: ReactNode;
}) {
  const store = useStore();
  const openTask = useOpenTask();
  const changeStatus = useStatusChange();
  const owner = task.owner_id ? store.profileById.get(task.owner_id) : undefined;
  const project = store.projectById.get(task.project_id);
  const subs = store.tasks.filter((t) => t.parent_id === task.id);
  const blocked = task.status !== "done" && store.dependencies.some((d) => d.task_id === task.id && store.taskById.get(d.depends_on_id)?.status !== "done");
  const done = task.status === "done";
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
        <button aria-label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`} disabled={!canEdit}
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
        <Avatar person={owner} size={22} />
      </div>
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <Avatar person={owner} size={22} />
        <span className="truncate text-sm text-slate-600">{owner?.full_name ?? <span className="text-slate-400">Unassigned</span>}</span>
      </div>
      <div className="hidden text-sm md:block">
        {task.due_date && task.start_date && dueLabel(task.due_date, done)?.tone !== "late"
          ? <span className="text-xs whitespace-nowrap text-slate-600">{fmtRange(task.start_date, task.due_date)}</span>
          : task.due_date ? <DueBadge task={task} /> : task.start_date ? <span className="text-xs text-slate-400">from {fmtShort(task.start_date)}</span> : <span className="text-xs text-slate-300">–</span>}
      </div>
      <div className="hidden md:block"><Pill className={PRIORITY_STYLE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Pill></div>
      <div className="hidden md:block"><Pill className={TASK_STATUS_STYLE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Pill></div>
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
