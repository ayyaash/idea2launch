import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import type { Priority, ProjectStatus, Role, TaskStatus } from "./types";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  coordinator: "Project Coordinator",
  member: "Member",
  viewer: "Viewer",
};
export const ROLE_HELP: Record<Role, string> = {
  admin: "Everything, including people and settings",
  manager: "Full control over every project",
  coordinator: "Creates projects and runs the ones they lead",
  member: "Works on tasks in projects they're assigned to",
  viewer: "Can see everything, can't change anything",
};
export const ROLES: Role[] = ["admin", "manager", "coordinator", "member", "viewer"];

export const PROJECT_STATUSES: ProjectStatus[] = ["planning", "active", "on_hold", "completed", "cancelled"];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const PROJECT_STATUS_STYLE: Record<ProjectStatus, string> = {
  planning: "bg-sky-50 text-sky-700 ring-sky-200",
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  on_hold: "bg-amber-50 text-amber-800 ring-amber-200",
  completed: "bg-navy-50 text-navy-700 ring-navy-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
};
export const PROJECT_STATUS_BAR: Record<ProjectStatus, string> = {
  planning: "#38BDF8",
  active: "#10B981",
  on_hold: "#F59E0B",
  completed: "#1E3A8A",
  cancelled: "#94A3B8",
};

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "review", "done"];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};
export const TASK_STATUS_STYLE: Record<TaskStatus, string> = {
  todo: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-blue-50 text-blue-700 ring-blue-200",
  review: "bg-violet-50 text-violet-700 ring-violet-200",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};
export const TASK_STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-slate-400",
  in_progress: "bg-blue-500",
  review: "bg-violet-500",
  done: "bg-emerald-500",
};

export const PRIORITIES: Priority[] = ["high", "medium", "low"];
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
export const PRIORITY_STYLE: Record<Priority, string> = {
  high: "bg-red-50 text-red-700 ring-red-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-200",
  low: "bg-slate-50 text-slate-600 ring-slate-200",
};

export const SWATCHES = [
  "#072A62", "#1D4ED8", "#0EA5E9", "#14B8A6", "#10B981", "#84CC16",
  "#FAAC04", "#F26A10", "#EF4444", "#EC4899", "#8B5CF6", "#64748B",
];

export function toDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const v = parseISO(d);
  return isValid(v) ? v : null;
}

export function fmtDate(d: string | null | undefined, pattern = "d MMM yyyy") {
  const v = toDate(d);
  return v ? format(v, pattern) : "";
}

export function fmtShort(d: string | null | undefined) {
  const v = toDate(d);
  if (!v) return "";
  return format(v, v.getFullYear() === new Date().getFullYear() ? "d MMM" : "d MMM yy");
}

export function isoDay(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function dueLabel(due: string | null, done: boolean): { text: string; tone: "late" | "soon" | "normal" } | null {
  const v = toDate(due);
  if (!v) return null;
  const days = differenceInCalendarDays(v, new Date());
  if (done) return { text: fmtShort(due), tone: "normal" };
  if (days < 0) return { text: days === -1 ? "Yesterday" : `${-days} days late`, tone: "late" };
  if (days === 0) return { text: "Today", tone: "soon" };
  if (days === 1) return { text: "Tomorrow", tone: "soon" };
  if (days < 7) return { text: format(v, "EEEE"), tone: "soon" };
  return { text: fmtShort(due), tone: "normal" };
}

export function fmtRange(start: string | null, end: string | null) {
  const s = toDate(start), e = toDate(end);
  if (!s || !e) return "";
  if (s.getTime() === e.getTime()) return fmtShort(end);
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) return `${format(s, "d")} – ${format(e, "d MMM")}`;
  return `${fmtShort(start)} – ${fmtShort(end)}`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function timeAgo(iso: string) {
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 7) return `${Math.floor(secs / 86400)}d ago`;
  return format(new Date(iso), "d MMM");
}
