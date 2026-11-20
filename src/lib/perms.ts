import type { Profile, Project } from "./types";

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
/** Everyone except Viewers can add projects; a Member's project waits for approval. */
export function canCreateProject(me: Profile | null) {
  return canContribute(me);
}
/** Admin, Manager or Project Coordinator: approves projects and deletes tasks. */
export function canApprove(me: Profile | null) {
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
/** Anyone except Viewers can add tasks to an approved project, or to a project they work on. */
export function canAddTask(me: Profile | null, project: Project | undefined, memberIds: Set<string>) {
  if (!me || !project) return false;
  return canEditProject(me, project, memberIds) || (canContribute(me) && project.approval === "approved");
}
export function canDeleteTask(me: Profile | null) {
  return canApprove(me);
}
