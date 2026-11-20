import type { Profile, Project, Task } from "./types";

// Mirrors the database rules (supabase/migrations). The database is the real gatekeeper;
// these only decide which buttons to show.
export function isAdmin(me: Profile | null) {
  return me?.role === "admin";
}
export function isManager(me: Profile | null) {
  return me?.role === "admin" || me?.role === "manager";
}
export function canContribute(me: Profile | null) {
  return !!me && me.role !== "viewer";
}
export function canCreateProject(me: Profile | null) {
  return !!me && ["admin", "manager", "coordinator"].includes(me.role);
}
export function canManageProject(me: Profile | null, project: Project | undefined) {
  if (!me || !project) return false;
  return isManager(me) || (canContribute(me) && project.lead_id === me.id);
}
export function canEditProject(me: Profile | null, project: Project | undefined, memberIds: Set<string>) {
  if (!me || !project) return false;
  return canManageProject(me, project) || (canContribute(me) && memberIds.has(me.id));
}
export function canDeleteTask(me: Profile | null, project: Project | undefined, task: Task, memberIds: Set<string>) {
  return canManageProject(me, project) || (task.created_by === me?.id && canEditProject(me, project, memberIds));
}
