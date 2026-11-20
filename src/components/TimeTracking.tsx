import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Play, Square, Timer, Trash2 } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { fmtDate } from "../lib/format";
import { isManager } from "../lib/perms";
import { entryMinutes, fmtMinutes, loggedByTask, parseDuration, taskTotals } from "../lib/time";
import type { Task } from "../lib/types";
import { Avatar, Button, Input, cx } from "./ui";
import { useToast } from "./Toast";
import { useOpenTask } from "./TaskPanel";

/** Re-renders every `ms` so running timers count up. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function useMyTimer() {
  const store = useStore();
  const { me } = useAuth();
  return store.timeEntries.find((e) => e.user_id === me?.id && e.minutes == null) ?? null;
}

export function TimeBar({ estimate, logged, className }: { estimate: number; logged: number; className?: string }) {
  const max = Math.max(estimate, logged, 1);
  const over = estimate > 0 && logged > estimate;
  return (
    <span className={cx("relative block h-2 overflow-hidden rounded-full bg-slate-100", className)}
      title={`${fmtMinutes(logged)} logged of ${fmtMinutes(estimate, "no estimate")}`}>
      {estimate > 0 && <span className="absolute inset-y-0 left-0 bg-slate-200" style={{ width: `${(estimate / max) * 100}%` }} />}
      <span className={cx("absolute inset-y-0 left-0 rounded-full", over ? "bg-red-500" : "bg-brand-500")}
        style={{ width: `${(Math.min(logged, max) / max) * 100}%` }} />
      {over && <span className="absolute inset-y-0 w-0.5 bg-slate-700" style={{ left: `${(estimate / max) * 100}%` }} />}
    </span>
  );
}

/** "Time" section in the task panel: estimate, timer, log time, and the list of logs. */
export function TaskTime({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const store = useStore();
  const { me } = useAuth();
  const toast = useToast();
  const now = useNow(15_000);
  const myTimer = useMyTimer();
  const [est, setEst] = useState(task.estimate_minutes ? fmtMinutes(task.estimate_minutes) : "");
  const [dur, setDur] = useState("");
  const [day, setDay] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [note, setNote] = useState("");
  useEffect(() => { setEst(task.estimate_minutes ? fmtMinutes(task.estimate_minutes) : ""); }, [task.estimate_minutes]);

  const subs = store.tasks.filter((t) => t.parent_id === task.id);
  const logged = loggedByTask(store.timeEntries, now);
  const tot = taskTotals(task, store.tasks, logged);
  const entries = store.timeEntries
    .filter((e) => e.task_id === task.id)
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
  const runningHere = myTimer?.task_id === task.id;

  async function saveEstimate() {
    const v = est.trim() ? parseDuration(est) : null;
    if (est.trim() && v == null) { toast.error("Type the estimate like 4h, 2h 30m, 90m or 1.5"); return; }
    if (v === (task.estimate_minutes ?? null)) return;
    await store.patchTask(task.id, { estimate_minutes: v });
  }

  async function logTime() {
    const m = parseDuration(dur);
    if (!m || m <= 0) { toast.error("Type the time like 2h, 1h 30m, 45m or 1.5"); return; }
    if (m > 1440) { toast.error("One log can be at most 24 hours. Add one per day."); return; }
    const r = await store.mutate(() => supabase.from("time_entries").insert({ task_id: task.id, minutes: m, entry_date: day, note: note.trim() }),
      { success: `${fmtMinutes(m)} logged` });
    if (r) { setDur(""); setNote(""); }
  }

  return (
    <div className="space-y-3">
      {/* summary */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label={subs.length ? "Estimate (with subtasks)" : "Estimate"} value={fmtMinutes(tot.estimate, "–")} />
        <Stat label="Logged" value={fmtMinutes(tot.logged)} />
        <Stat label={tot.over ? "Over estimate" : "Remaining"} value={tot.over ? fmtMinutes(tot.over) : fmtMinutes(tot.remaining, "–")} danger={tot.over > 0} />
      </div>
      <TimeBar estimate={tot.estimate} logged={tot.logged} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          My estimate for this task
          <Input aria-label="Estimate" value={est} disabled={!canEdit} placeholder="e.g. 4h" className="h-8 w-28 py-1"
            onChange={(e) => setEst(e.target.value)} onBlur={saveEstimate}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </label>
        {canEdit && (runningHere ? (
          <Button size="sm" variant="danger" icon={<Square className="size-3.5" />}
            onClick={() => store.mutate(() => supabase.rpc("stop_timer", {}), { success: "Timer stopped and time logged" })}>
            Stop · {fmtMinutes(entryMinutes(myTimer!, now), "0m")}
          </Button>
        ) : (
          <Button size="sm" icon={<Play className="size-3.5" />}
            onClick={() => store.mutate(() => supabase.rpc("start_timer", { p_task: task.id }), { success: myTimer ? "Timer moved to this task" : "Timer started" })}>
            Start timer
          </Button>
        ))}
      </div>

      {canEdit && (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-200 sm:grid-cols-[120px_140px_1fr_auto]">
          <Input aria-label="Time spent" value={dur} onChange={(e) => setDur(e.target.value)} placeholder="e.g. 1h 30m"
            onKeyDown={(e) => { if (e.key === "Enter") logTime(); }} />
          <Input type="date" aria-label="Date" value={day} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setDay(e.target.value)} />
          <Input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
            onKeyDown={(e) => { if (e.key === "Enter") logTime(); }} />
          <Button variant="primary" onClick={logTime}>Log time</Button>
        </div>
      )}

      {entries.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {entries.map((e) => {
            const who = store.profileById.get(e.user_id);
            const running = e.minutes == null;
            return (
              <li key={e.id} className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm">
                <Avatar person={who} size={22} />
                <span className="w-24 shrink-0 text-xs text-slate-500">{fmtDate(e.entry_date, "d MMM")}</span>
                <span className={cx("w-16 shrink-0 font-medium tabular-nums", running && "text-brand-600")}>
                  {running && <Timer className="mr-0.5 inline size-3.5 animate-pulse" />}{fmtMinutes(entryMinutes(e, now), "0m")}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-600" title={e.note}>{running ? "Timer running…" : e.note || <span className="text-slate-400">{who?.full_name}</span>}</span>
                {!running && (e.user_id === me?.id || isManager(me)) && (
                  <button aria-label="Delete time log" className="text-slate-400 hover:text-red-600"
                    onClick={() => store.mutate(() => supabase.from("time_entries").delete().eq("id", e.id).select("id"), { success: "Time log deleted" })}>
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {subs.length > 0 && <p className="text-xs text-slate-500">Totals include the time on this task's {subs.length} subtask(s).</p>}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2 ring-1 ring-slate-200">
      <div className={cx("text-base font-semibold tabular-nums", danger ? "text-red-600" : "text-slate-900")}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

/** Header chip showing your running timer, from any page. */
export function RunningTimer() {
  const store = useStore();
  const timer = useMyTimer();
  const now = useNow(15_000);
  const openTask = useOpenTask();
  if (!timer) return null;
  const task = store.taskById.get(timer.task_id);
  return (
    <div className="flex items-center gap-1 rounded-full bg-brand-50 py-1 pr-1 pl-3 text-sm text-brand-800 ring-1 ring-brand-200">
      <button className="flex max-w-56 items-center gap-1.5 truncate" onClick={() => openTask(timer.task_id)} title={task?.title}>
        <Timer className="size-4 shrink-0 animate-pulse" />
        <span className="font-semibold tabular-nums">{fmtMinutes(entryMinutes(timer, now), "0m")}</span>
        <span className="hidden truncate sm:inline">{task?.title}</span>
      </button>
      <button aria-label="Stop timer" className="rounded-full bg-brand-500 p-1 text-white hover:bg-brand-600"
        onClick={() => store.mutate(() => supabase.rpc("stop_timer", {}), { success: "Timer stopped and time logged" })}>
        <Square className="size-3" />
      </button>
    </div>
  );
}
