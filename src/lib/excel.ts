import { PROJECT_STATUS_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL, toDate } from "./format";
import type { Category, Profile, Project, Task } from "./types";

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
}

export async function exportToExcel(fileName: string, projects: Project[], tasks: Task[], lk: Lookups) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const name = (id: string | null) => (id ? lk.profileById.get(id)?.full_name ?? "" : "");
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const projectRows: Cell[][] = [
    head(["Code", "Project", "Category", "Status", "Lead", "Start", "End", "Tasks", "Done", "Progress %", "Description"]),
    ...projects.map((p) => {
      const pt = tasks.filter((t) => t.project_id === p.id);
      const done = pt.filter((t) => t.status === "done").length;
      return [
        text(p.code), text(p.name), text(p.category_id ? lk.categoryById.get(p.category_id)?.name : ""),
        text(PROJECT_STATUS_LABEL[p.status]), text(name(p.lead_id)), date(p.start_date), date(p.end_date),
        num(pt.length), num(done), num(pt.length ? Math.round((done / pt.length) * 100) : 0),
        text(p.description),
      ];
    }),
  ];

  const taskRows: Cell[][] = [
    head(["Project code", "Project", "Task", "Parent task", "Status", "Priority", "Owner", "Start", "Due", "Completed", "Description"]),
    ...[...tasks].sort((a, b) => (lk.projectById.get(a.project_id)?.code ?? "").localeCompare(lk.projectById.get(b.project_id)?.code ?? "") || a.sort_order - b.sort_order).map((t) => {
      const p = lk.projectById.get(t.project_id);
      return [
        text(p?.code), text(p?.name), text(t.title), text(t.parent_id ? taskById.get(t.parent_id)?.title ?? "" : ""),
        text(TASK_STATUS_LABEL[t.status]), text(PRIORITY_LABEL[t.priority]), text(name(t.owner_id)),
        date(t.start_date), date(t.due_date), date(t.completed_at ? t.completed_at.slice(0, 10) : null),
        text(t.description),
      ];
    }),
  ];

  await writeExcelFile([
    { data: projectRows, sheet: "Projects", columns: [12, 32, 18, 12, 20, 12, 12, 8, 8, 10, 50].map((width) => ({ width })) },
    { data: taskRows, sheet: "Tasks", columns: [12, 28, 40, 28, 12, 10, 20, 12, 12, 12, 50].map((width) => ({ width })) },
  ] as never).toFile(fileName);
}
