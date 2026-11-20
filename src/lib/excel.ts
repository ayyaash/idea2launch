import { toDays } from "./time";
import { PROJECT_STATUS_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL, toDate } from "./format";
import type { Category, Profile, Project, Task, TimeEntry } from "./types";

type Cell = { value: string | number | Date | null; type?: typeof String | typeof Number | typeof Date; format?: string; fontWeight?: "bold" } | null;

const head = (labels: string[]): Cell[] => labels.map((value) => ({ value, fontWeight: "bold" }));
const date = (d: string | null): Cell => {
  const v = toDate(d);
  return v ? { value: v, type: Date, format: "yyyy-mm-dd" } : null;
};
const text = (v: string | null | undefined): Cell => (v ? { value: v, type: String } : null);
const num = (v: number): Cell => ({ value: v, type: Number });

interface Lookups {
  sections: { id: string; name: string }[];
  profileById: Map<string, Profile>;
  categoryById: Map<string, Category>;
  projectById: Map<string, Project>;
  timeEntries?: TimeEntry[];
}

export async function exportToExcel(fileName: string, projects: Project[], tasks: Task[], lk: Lookups) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const name = (id: string | null) => (id ? lk.profileById.get(id)?.full_name ?? "" : "");
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const loggedMin = new Map<string, number>();
  for (const e of lk.timeEntries ?? []) loggedMin.set(e.task_id, (loggedMin.get(e.task_id) ?? 0) + (e.minutes ?? 0));
  const hrs = (m: number) => num(toDays(m));

  const projectRows: Cell[][] = [
    head(["Code", "Project", "Category", "Status", "Lead", "Start", "End", "Tasks", "Done", "Progress %", "Estimate (days)", "Logged (days)", "Description"]),
    ...projects.map((p) => {
      const pt = tasks.filter((t) => t.project_id === p.id);
      const done = pt.filter((t) => t.status === "done").length;
      return [
        text(p.code), text(p.name), text(p.category_id ? lk.categoryById.get(p.category_id)?.name : ""),
        text(PROJECT_STATUS_LABEL[p.status]), text(name(p.lead_id)), date(p.start_date), date(p.end_date),
        num(pt.length), num(done), num(pt.length ? Math.round((done / pt.length) * 100) : 0),
        hrs(pt.reduce((a, t) => a + (t.estimate_minutes ?? 0), 0)), hrs(pt.reduce((a, t) => a + (loggedMin.get(t.id) ?? 0), 0)), text(p.description),
      ];
    }),
  ];

  const taskRows: Cell[][] = [
    head(["Project code", "Project", "Task", "Parent task", "Status", "Priority", "Owner", "Start", "Due", "Completed", "Estimate (days)", "Logged (days)", "Description"]),
    ...[...tasks].sort((a, b) => (lk.projectById.get(a.project_id)?.code ?? "").localeCompare(lk.projectById.get(b.project_id)?.code ?? "") || a.sort_order - b.sort_order).map((t) => {
      const p = lk.projectById.get(t.project_id);
      return [
        text(p?.code), text(p?.name), text(t.title), text(t.parent_id ? taskById.get(t.parent_id)?.title ?? "" : ""),
        text(TASK_STATUS_LABEL[t.status]), text(PRIORITY_LABEL[t.priority]), text(name(t.owner_id)),
        date(t.start_date), date(t.due_date), date(t.completed_at ? t.completed_at.slice(0, 10) : null),
        hrs(t.estimate_minutes ?? 0), hrs(loggedMin.get(t.id) ?? 0), text(t.description),
      ];
    }),
  ];

  await writeExcelFile([
    { data: projectRows, sheet: "Projects", columns: [12, 32, 18, 12, 20, 12, 12, 8, 8, 10, 12, 11, 50].map((width) => ({ width })) },
    { data: taskRows, sheet: "Tasks", columns: [12, 28, 40, 28, 12, 10, 20, 12, 12, 12, 12, 11, 50].map((width) => ({ width })) },
  ] as never).toFile(fileName);
}

/** Time report: per-task estimate vs logged, every time log, and totals per person. */
export async function exportTimeToExcel(
  fileName: string, projects: Project[], tasks: Task[], entries: TimeEntry[], lk: Lookups,
) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const name = (id: string | null) => (id ? lk.profileById.get(id)?.full_name ?? "" : "");
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const projectIds = new Set(projects.map((p) => p.id));
  const logged = new Map<string, number>();
  for (const e of entries) logged.set(e.task_id, (logged.get(e.task_id) ?? 0) + (e.minutes ?? 0));
  const h = (m: number) => num(toDays(m));

  const summary: Cell[][] = [
    head(["Project code", "Project", "Task", "Parent task", "Owner", "Status", "Estimate (days)", "Logged (days)", "Remaining (days)", "Over (days)"]),
  ];
  let te = 0, tl = 0;
  for (const t of [...tasks].filter((t) => projectIds.has(t.project_id))
    .sort((a, b) => (lk.projectById.get(a.project_id)?.code ?? "").localeCompare(lk.projectById.get(b.project_id)?.code ?? "") || a.sort_order - b.sort_order)) {
    const p = lk.projectById.get(t.project_id);
    const est = t.estimate_minutes ?? 0;
    const log = logged.get(t.id) ?? 0;
    te += est; tl += log;
    summary.push([
      text(p?.code), text(p?.name), text(t.title),
      text(t.parent_id ? taskById.get(t.parent_id)?.title ?? "" : ""), text(name(t.owner_id)), text(TASK_STATUS_LABEL[t.status]),
      h(est), h(log), h(Math.max(0, est - log)), h(Math.max(0, log - est)),
    ]);
  }
  summary.push([{ value: "Total", fontWeight: "bold" }, null, null, null, null, null, null, h(te), h(tl), h(Math.max(0, te - tl)), h(Math.max(0, tl - te))]);

  const log: Cell[][] = [head(["Date", "Person", "Project code", "Project", "Task", "Days", "Minutes", "Note"])];
  for (const e of [...entries].filter((e) => e.minutes != null).sort((a, b) => a.entry_date.localeCompare(b.entry_date))) {
    const t = taskById.get(e.task_id);
    const p = lk.projectById.get(e.project_id);
    log.push([date(e.entry_date), text(name(e.user_id)), text(p?.code), text(p?.name),
      text(t?.title), h(e.minutes!), num(e.minutes!), text(e.note)]);
  }

  const per = new Map<string, number>();
  for (const e of entries) per.set(e.user_id, (per.get(e.user_id) ?? 0) + (e.minutes ?? 0));
  const people: Cell[][] = [head(["Person", "Days"]),
    ...[...per.entries()].sort((a, b) => b[1] - a[1]).map(([u, m]) => [text(name(u)), h(m)])];

  await writeExcelFile([
    { data: summary, sheet: "Estimate vs logged", columns: [12, 28, 40, 28, 20, 12, 12, 12, 13, 10].map((width) => ({ width })) },
    { data: log, sheet: "Time log", columns: [12, 20, 12, 28, 40, 8, 9, 50].map((width) => ({ width })) },
    { data: people, sheet: "By person", columns: [24, 10].map((width) => ({ width })) },
  ] as never).toFile(fileName);
}
