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

export interface Window { start: Date; end: Date; months: Date[] }

/**
 * The months the dashboard timeline shows: from the earliest project start to the latest end
 * among the year's projects (kept inside that year), at least 3 months wide.
 * Open-ended projects count up to their latest task due date, or today.
 */
export function timelineWindow(projects: Project[], tasks: Task[], year: number): Window {
  const ys = new Date(year, 0, 1), ye = new Date(year + 1, 0, 1);
  let lo: Date | null = null, hi: Date | null = null;
  for (const p of projects) {
    const s = toDate(p.start_date) ?? toDate(p.created_at.slice(0, 10)) ?? ys;
    let e = toDate(p.end_date);
    if (!e) {
      const due = tasks.filter((t) => t.project_id === p.id && t.due_date).map((t) => t.due_date!).sort().pop();
      e = toDate(due ?? null) ?? today();
      if (e < s) e = s;
    }
    if (!lo || s < lo) lo = s;
    if (!hi || e > hi) hi = e;
  }
  let start = startOfMonth(lo && lo > ys ? lo : ys);
  const last = hi && hi < ye ? hi : addDays(ye, -1);
  let end = new Date(last.getFullYear(), last.getMonth() + 1, 1);
  if (!lo) { start = ys; end = ye; }
  // at least 3 months: grow forward, then backward, inside the year
  const monthsBetween = () => (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  while (monthsBetween() < 3 && end < ye) end = new Date(end.getFullYear(), end.getMonth() + 1, 1);
  while (monthsBetween() < 3 && start > ys) start = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  return monthWindow(start, end);
}

/**
 * The whole scrollable timeline: at least the selected year, stretched back to the earliest
 * project start and forward to the latest end (open-ended projects: latest task due date or today),
 * kept within 3 years before and 4 years after.
 */
export function scrollWindow(projects: Project[], tasks: Task[], year: number): Window {
  let start = new Date(year, 0, 1), end = new Date(year + 1, 0, 1);
  for (const p of projects) {
    const s = toDate(p.start_date) ?? toDate(p.created_at.slice(0, 10));
    let e = toDate(p.end_date);
    if (!e) {
      const due = tasks.filter((t) => t.project_id === p.id && t.due_date).map((t) => t.due_date!).sort().pop();
      e = toDate(due ?? null) ?? today();
    }
    if (s && s < start) start = s;
    if (e && e >= end) end = new Date(e.getFullYear(), e.getMonth() + 1, 1);
  }
  const lo = new Date(year - 3, 0, 1), hi = new Date(year + 5, 0, 1);
  return monthWindow(start < lo ? lo : start, end > hi ? hi : end);
}

/** A timeline window covering whole months, from `start`'s month up to (not including) `end`'s month. */
export function monthWindow(start: Date, end: Date): Window {
  const s = startOfMonth(start);
  let e = startOfMonth(end);
  if (e <= s) e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
  const months: Date[] = [];
  for (let m = new Date(s); m < e; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months.push(m);
  return { start: s, end: e, months };
}

/** Fraction (0..1) positions of a project's bar inside the timeline window. */
export function windowBar(p: Project, w: Window) {
  const ws = w.start.getTime(), span = w.end.getTime() - ws;
  const s = toDate(p.start_date)?.getTime() ?? ws;
  const eRaw = toDate(p.end_date);
  const e = eRaw ? addDays(eRaw, 1).getTime() : w.end.getTime();
  const left = Math.max(0, (s - ws) / span);
  const right = Math.min(1, (e - ws) / span);
  // "before" / "after": the project lies wholly outside the months shown
  const outside: "before" | "after" | null = e <= ws ? "before" : s >= w.end.getTime() ? "after" : null;
  return { left, width: Math.max(0.01, right - left), openStart: s < ws, openEnd: !eRaw || e > w.end.getTime(), outside };
}
