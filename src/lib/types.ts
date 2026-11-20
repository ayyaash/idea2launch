export type Role = "admin" | "manager" | "coordinator" | "member" | "viewer";
export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type Priority = "high" | "medium" | "low";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  job_title: string;
  role: Role;
  is_active: boolean;
  color: string;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string;
  category_id: string | null;
  status: ProjectStatus;
  lead_id: string | null;
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Section {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
}

export interface Task {
  id: string;
  project_id: string;
  parent_id: string | null;
  section_id: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  owner_id: string | null;
  start_date: string | null;
  due_date: string | null;
  sort_order: number;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Collaborator {
  task_id: string;
  user_id: string;
}

export interface Dependency {
  task_id: string;
  depends_on_id: string;
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  task_id: string;
  file_name: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  actor_id: string | null;
  kind: string;
  title: string;
  project_id: string | null;
  task_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Settings {
  overload_threshold: number;
  max_upload_mb: number;
  company_name: string;
  week_starts_on: 0 | 1;
  default_phases: string[];
}
