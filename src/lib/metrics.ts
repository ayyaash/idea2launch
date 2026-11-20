import { addDays, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { toDate } from "./format";
import type { Project, Task } from "./types";

export function progressOf(projectId: string, tasks: Task[]) {
  const pt = tasks.filter((t) => t.project_id === projectId);
  const done = pt.filter((t) => t.status === "done").length;
  return { total: pt.length, done, open: pt.length - done, pct: pt.length ? Math.round((done / pt.length) * 100) : 0 };
}

/** A project belongs to a year when its date range overlaps that year (multi-year projects show in every year). */
export function inYear(p: Project, year: number) {
  const ys = `${year}-01-01`, ye = `${year}-12-31`;
  const start = p.start_date ?? p.end_date ?? p.created_at.slice(0, 10);
  const end = p.end_date ?? (p.status === "completed" || p.status === "cancelled" ? start : "9999-12-31");
  return start <= ye && end >= ys;
}

/** Fraction (0..1) positions of a project's bar inside the year. */
export function yearBar(p: Project, year: number) {
  const ys = new Date(year, 0, 1).getTime();
  const ye = new Date(year + 1, 0, 1).getTime();
  const span = ye - ys;
  const s = toDate(p.start_date)?.getTime() ?? ys;
  const eRaw = toDate(p.end_date);
  const e = eRaw ? addDays(eRaw, 1).getTime() : ye;
  const left = Math.max(0, (s - ys) / span);
  const right = Math.min(1, (e - ys) / span);
  return { left, width: Math.max(0.006, right - left), openStart: s < ys, openEnd: !eRaw || e > ye };
}

export function today() {
  return startOfDay(new Date());
}

export function isOverdue(t: Task) {
  return t.status !== "done" && !!t.due_date && t.due_date < isoToday();
}
export function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function weekRange(d: Date, weekStartsOn: 0 | 1) {
  return { start: startOfWeek(d, { weekStartsOn }), end: endOfWeek(d, { weekStartsOn }) };
}
export function monthRange(d: Date) {
  return { start: startOfMonth(d), end: endOfMonth(d) };
}

/**
 * The working window of an open task. Overdue work still counts against this week,
 * so the window is stretched to today. Tasks with no dates return null.
 */
export function taskWindow(t: Task, now = today()): { start: Date; end: Date } | null {
  const s = toDate(t.start_date);
  const d = toDate(t.due_date);
  if (!s && !d) return null;
  const start = s ?? d!;
  let end = d ?? s!;
  if (t.status !== "done" && end < now) end = now;
  return { start: startOfDay(start), end: startOfDay(end) };
}

export function overlaps(w: { start: Date; end: Date }, r: { start: Date; end: Date }) {
  return w.start <= r.end && w.end >= r.start;
}
