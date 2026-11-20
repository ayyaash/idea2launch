import type { Task, TimeEntry } from "./types";

/** Length of a working day; set from the admin settings (default 8 hours). */
let minutesPerDay = 8 * 60;
export function setHoursPerDay(h: number) {
  if (isFinite(h) && h > 0 && h <= 24) minutesPerDay = Math.round(h * 60);
}
export const hoursPerDay = () => minutesPerDay / 60;

/** Minutes as working days: 480 -> "1d", 720 -> "1.5d", 30 -> "0.06d" (8-hour day). */
export function fmtMinutes(min: number | null | undefined, empty = "0d") {
  if (min == null || !isFinite(min)) return empty;
  const d = Math.round((min / minutesPerDay) * 100) / 100;
  if (d === 0) return min > 0 ? "<0.01d" : empty;
  return `${d}d`;
}

/** A running clock: 135 -> "2h 15m", 20 -> "20m". */
export function fmtClock(min: number) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h ${String(r).padStart(2, "0")}m` : `${r}m`;
}

/** Days with two decimals, for charts and Excel. */
export const toDays = (min: number) => Math.round((min / minutesPerDay) * 100) / 100;

/**
 * Reads what people type for a duration. Plain numbers are working days.
 * "2" "0.5" "2d" "4h" "2h 30m" "90m" "1:30" (h:mm) all work. Returns minutes, or null if unreadable.
 */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^\d+(\.\d+)?$/))) return Math.round(Number(s) * minutesPerDay);
  const re = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)?/g;
  let total = 0;
  let matched = "";
  let lastUnit = "";
  for (const part of s.matchAll(re)) {
    const n = Number(part[1]);
    const unit = part[2] ?? (lastUnit.startsWith("h") ? "m" : lastUnit.startsWith("d") ? "h" : "d");
    lastUnit = unit;
    total += unit.startsWith("d") ? n * minutesPerDay : unit.startsWith("h") ? n * 60 : n;
    matched += part[0];
  }
  if (!matched || matched.replace(/\s/g, "") !== s.replace(/\s/g, "")) return null;
  return Math.round(total);
}

/** Minutes of a log; a running timer counts up to now. */
export function entryMinutes(e: TimeEntry, now = Date.now()) {
  if (e.minutes != null) return e.minutes;
  if (!e.started_at) return 0;
  return Math.max(0, Math.min(1440, Math.floor((now - new Date(e.started_at).getTime()) / 60000)));
}

export interface TimeTotals {
  estimate: number;
  logged: number;
  /** estimate - logged, never below 0 */
  remaining: number;
  /** logged - estimate when over, else 0 */
  over: number;
  /** logged / estimate, 0..∞ (0 when there's no estimate) */
  used: number;
}

export function totals(estimate: number, logged: number): TimeTotals {
  return {
    estimate, logged,
    remaining: Math.max(0, estimate - logged),
    over: Math.max(0, logged - estimate),
    used: estimate > 0 ? logged / estimate : 0,
  };
}

/** Sum of logged minutes per task id (own entries only). */
export function loggedByTask(entries: TimeEntry[], now = Date.now()) {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.task_id, (m.get(e.task_id) ?? 0) + entryMinutes(e, now));
  return m;
}

/** A task's totals including its subtasks (estimates and logs roll up to the parent). */
export function taskTotals(task: Task, allTasks: Task[], logged: Map<string, number>): TimeTotals {
  const subs = allTasks.filter((t) => t.parent_id === task.id);
  const est = (task.estimate_minutes ?? 0) + subs.reduce((a, s) => a + (s.estimate_minutes ?? 0), 0);
  const log = (logged.get(task.id) ?? 0) + subs.reduce((a, s) => a + (logged.get(s.id) ?? 0), 0);
  return totals(est, log);
}

/** Totals for a set of tasks (e.g. a whole project or a phase); every task counted once. */
export function setTotals(tasks: Task[], logged: Map<string, number>): TimeTotals {
  let est = 0;
  let log = 0;
  for (const t of tasks) {
    est += t.estimate_minutes ?? 0;
    log += logged.get(t.id) ?? 0;
  }
  return totals(est, log);
}
