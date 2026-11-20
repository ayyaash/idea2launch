import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase, fetchAll, errorText } from "./supabase";
import { useAuth } from "./auth";
import { useToast } from "../components/Toast";
import { setHoursPerDay } from "./time";
import type {
  Category, Collaborator, Dependency, Notification, Profile, Project, ProjectMember, Section, Settings, Task, TimeEntry,
} from "./types";

const DEFAULT_SETTINGS: Settings = { overload_threshold: 25, max_upload_mb: 10, company_name: "Idea2Launch", week_starts_on: 1, default_phases: [], hours_per_day: 8 };

interface Data {
  ready: boolean;
  profiles: Profile[];
  categories: Category[];
  projects: Project[];
  members: ProjectMember[];
  sections: Section[];
  tasks: Task[];
  collaborators: Collaborator[];
  dependencies: Dependency[];
  notifications: Notification[];
  timeEntries: TimeEntry[];
  settings: Settings;
}

interface Store extends Data {
  profileById: Map<string, Profile>;
  projectById: Map<string, Project>;
  categoryById: Map<string, Category>;
  taskById: Map<string, Task>;
  membersOf: (projectId: string) => Set<string>;
  sectionsOf: (projectId: string) => Section[];
  refresh: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  /** Run a write; on error show a toast and return null. Refreshes data afterwards. */
  mutate: <T>(fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>, opts?: { success?: string; silent?: boolean }) => Promise<T | null>;
  patchTask: (id: string, patch: Partial<Task>) => Promise<boolean>;
  patchProject: (id: string, patch: Partial<Project>) => Promise<boolean>;
}

const StoreContext = createContext<Store | null>(null);

const EMPTY: Data = {
  ready: false, profiles: [], categories: [], projects: [], members: [], sections: [], tasks: [], collaborators: [],
  dependencies: [], notifications: [], timeEntries: [], settings: DEFAULT_SETTINGS,
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<Data>(EMPTY);
  const loading = useRef(false);

  const refreshNotifications = useCallback(async () => {
    if (!me) return;
    const { data: rows } = await supabase.from("notifications").select("*").eq("user_id", me.id)
      .order("created_at", { ascending: false }).limit(60);
    setData((d) => ({ ...d, notifications: rows ?? [] }));
  }, [me]);

  const refresh = useCallback(async () => {
    if (!me || loading.current) return;
    loading.current = true;
    try {
      const [profiles, categories, projects, members, sections, tasks, collaborators, dependencies, settingsRows] = await Promise.all([
        fetchAll<Profile>((a, b) => supabase.from("profiles").select("*").order("full_name").range(a, b)),
        fetchAll<Category>((a, b) => supabase.from("categories").select("*").order("sort_order").order("name").range(a, b)),
        fetchAll<Project>((a, b) => supabase.from("projects").select("*").order("start_date", { nullsFirst: false }).range(a, b)),
        fetchAll<ProjectMember>((a, b) => supabase.from("project_members").select("project_id,user_id").range(a, b)),
        fetchAll<Section>((a, b) => supabase.from("project_sections").select("*").order("sort_order").order("created_at").range(a, b)),
        fetchAll<Task>((a, b) => supabase.from("tasks").select("*").order("sort_order").range(a, b)),
        fetchAll<Collaborator>((a, b) => supabase.from("task_collaborators").select("*").range(a, b)),
        fetchAll<Dependency>((a, b) => supabase.from("task_dependencies").select("task_id,depends_on_id").range(a, b)),
        fetchAll<{ key: string; value: unknown }>((a, b) => supabase.from("app_settings").select("key,value").range(a, b)),
      ]);
      // Time logs are optional: an older database without the table still loads.
      const timeEntries = await fetchAll<TimeEntry>((a, b) => supabase.from("time_entries").select("*").order("entry_date").range(a, b))
        .catch(() => [] as TimeEntry[]);
      const settings = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
      for (const r of settingsRows) settings[r.key] = r.value;
      setHoursPerDay(Number(settings.hours_per_day) || 8);
      setData((d) => ({
        ...d, ready: true, profiles, categories, projects, members, sections, tasks, collaborators, dependencies, timeEntries,
        settings: settings as unknown as Settings,
      }));
    } catch (e) {
      toast.error(`Couldn't load data: ${errorText(e)}`);
      setData((d) => ({ ...d, ready: true }));
    } finally {
      loading.current = false;
    }
  }, [me, toast]);

  useEffect(() => {
    if (!me) {
      setData(EMPTY);
      return;
    }
    refresh();
    refreshNotifications();
    const onFocus = () => { refresh(); refreshNotifications(); };
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => { refreshNotifications(); if (document.visibilityState === "visible") refresh(); }, 45_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [me, refresh, refreshNotifications]);

  const mutate = useCallback(async <T,>(
    fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
    opts: { success?: string; silent?: boolean } = {},
  ) => {
    try {
      const { data: out, error } = await fn();
      if (error) throw error;
      if (opts.success) toast.success(opts.success);
      await refresh();
      return out ?? (true as unknown as T);
    } catch (e) {
      if (!opts.silent) toast.error(errorText(e));
      await refresh();
      return null;
    }
  }, [refresh, toast]);

  const patchTask = useCallback(async (id: string, patch: Partial<Task>) => {
    // optimistic
    setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    const r = await mutate(() => supabase.from("tasks").update(patch).eq("id", id).select("id"));
    if (r && Array.isArray(r) && r.length === 0) {
      toast.error("You don't have permission to change this task.");
      return false;
    }
    return r !== null;
  }, [mutate, toast]);

  const patchProject = useCallback(async (id: string, patch: Partial<Project>) => {
    setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    const r = await mutate(() => supabase.from("projects").update(patch).eq("id", id).select("id"));
    if (r && Array.isArray(r) && r.length === 0) {
      toast.error("You don't have permission to change this project.");
      return false;
    }
    return r !== null;
  }, [mutate, toast]);

  const store = useMemo<Store>(() => {
    const profileById = new Map(data.profiles.map((p) => [p.id, p]));
    const projectById = new Map(data.projects.map((p) => [p.id, p]));
    const categoryById = new Map(data.categories.map((c) => [c.id, c]));
    const taskById = new Map(data.tasks.map((t) => [t.id, t]));
    const memberMap = new Map<string, Set<string>>();
    for (const m of data.members) {
      if (!memberMap.has(m.project_id)) memberMap.set(m.project_id, new Set());
      memberMap.get(m.project_id)!.add(m.user_id);
    }
    const empty = new Set<string>();
    const sectionsByProject = new Map<string, Section[]>();
    for (const s of data.sections) {
      if (!sectionsByProject.has(s.project_id)) sectionsByProject.set(s.project_id, []);
      sectionsByProject.get(s.project_id)!.push(s);
    }
    return {
      ...data, profileById, projectById, categoryById, taskById,
      membersOf: (id: string) => memberMap.get(id) ?? empty,
      sectionsOf: (id: string) => sectionsByProject.get(id) ?? [],
      refresh, refreshNotifications, mutate, patchTask, patchProject,
    };
  }, [data, refresh, refreshNotifications, mutate, patchTask, patchProject]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside StoreProvider");
  return ctx;
}
