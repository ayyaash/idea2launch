import { useMemo, useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Link2, Upload } from "lucide-react";
import { useStore } from "../lib/store";
import { supabase, errorText } from "../lib/supabase";
import { buildPlan, readTaskFile, type Plan, type SourceRow } from "../lib/importTasks";
import { PRIORITY_LABEL, TASK_STATUS_LABEL, fmtDate } from "../lib/format";
import type { Project } from "../lib/types";
import { Button, Modal, cx } from "./ui";
import { useToast } from "./Toast";

/** Upload an Excel/CSV sheet or a Microsoft Project XML file and add its tasks to this project. */
export function ImportTasksModal({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const store = useStore();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; rows: SourceRow[]; source: string } | null>(null);
  const [err, setErr] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);

  const existing = useMemo(() => store.tasks.filter((t) => t.project_id === project.id), [store.tasks, project.id]);
  const plan: Plan | null = useMemo(() => (file ? buildPlan(file.rows, file.source, {
    projectCode: project.code, profiles: store.profiles, existing, skipExisting,
  }) : null), [file, project.code, store.profiles, existing, skipExisting]);

  function reset() { setFile(null); setErr(""); if (input.current) input.current.value = ""; }
  function close() { reset(); onClose(); }

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(""); setFile(null); setReading(true);
    try {
      const r = await readTaskFile(f);
      if (!r.rows.length) throw new Error("No tasks were found in this file.");
      setFile({ name: f.name, ...r });
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setReading(false);
    }
  }

  async function run() {
    if (!plan?.tasks.length) return;
    setBusy(true);
    try {
      const base = Math.max(0, ...existing.map((t) => t.sort_order)) + 1024;
      const idOf = new Map<string, string>();
      const row = (t: Plan["tasks"][number], i: number, parentId: string | null) => ({
        project_id: project.id, parent_id: parentId, title: t.title, description: t.description,
        status: t.status, priority: t.priority, owner_id: t.ownerId, start_date: t.start, due_date: t.due,
        sort_order: base + i * 1024,
      });
      const parentIdOf = (ref: string | null) => (!ref ? null : ref.startsWith("existing:") ? ref.slice(9) : idOf.get(ref) ?? null);
      // main tasks first, then subtasks (in batches, keeping the file's order)
      const mains = plan.tasks.filter((t) => !t.parentRef);
      const subs = plan.tasks.filter((t) => t.parentRef);
      const order = new Map(plan.tasks.map((t, i) => [t.ref, i]));
      for (const [list, withParent] of [[mains, false], [subs, true]] as const) {
        for (let i = 0; i < list.length; i += 200) {
          const chunk = list.slice(i, i + 200);
          const { data, error } = await supabase.from("tasks")
            .insert(chunk.map((t) => row(t, order.get(t.ref)!, withParent ? parentIdOf(t.parentRef) : null)))
            .select("id,title,sort_order");
          if (error) throw error;
          // match the new rows back by their (unique) sort order
          const bySort = new Map((data ?? []).map((d) => [d.sort_order, d.id]));
          for (const t of chunk) { const id = bySort.get(base + order.get(t.ref)! * 1024); if (id) idOf.set(t.ref, id); }
        }
      }
      const collabs = plan.tasks.flatMap((t) => t.collaboratorIds.map((u) => ({ task_id: idOf.get(t.ref)!, user_id: u }))).filter((c) => c.task_id);
      if (collabs.length) await supabase.from("task_collaborators").insert(collabs);
      const deps = plan.tasks.flatMap((t) => [
        ...t.predecessorRefs.map((p) => ({ task_id: idOf.get(t.ref)!, depends_on_id: idOf.get(p)! })),
        ...t.existingPredecessorIds.map((p) => ({ task_id: idOf.get(t.ref)!, depends_on_id: p })),
      ]).filter((d) => d.task_id && d.depends_on_id);
      let depFailed = 0;
      if (deps.length) {
        const { error } = await supabase.from("task_dependencies").insert(deps);
        if (error) { // e.g. a loop in the file: add them one by one and count the ones refused
          for (const d of deps) { const r = await supabase.from("task_dependencies").insert(d); if (r.error) depFailed++; }
        }
      }
      await store.refresh();
      toast.success(`Imported ${idOf.size} task${idOf.size === 1 ? "" : "s"}${deps.length - depFailed ? ` and ${deps.length - depFailed} predecessor link${deps.length - depFailed === 1 ? "" : "s"}` : ""}.`);
      if (depFailed) toast.error(`${depFailed} predecessor link(s) were left out because they would make a loop.`);
      close();
    } catch (e) {
      toast.error(`Import stopped: ${errorText(e)}`);
      await store.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function sample() {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    const h = (v: string) => ({ value: v, fontWeight: "bold" as const });
    const t = (v: string) => (v ? { value: v, type: String } : null);
    const rows = [
      ["ID", "Task", "Main task", "Owner", "Collaborators", "Start date", "Due date", "Priority", "Status", "Predecessors", "Description"].map(h),
      ["1", "Market study", "", "mia", "", "2026-12-01", "2026-12-12", "Medium", "To do", "", "Compare 3 competitors"].map(t),
      ["2", "Schematic", "", "nimal", "dilan", "2026-12-15", "2027-01-15", "High", "To do", "1", ""].map(t),
      ["3", "Power stage", "Schematic", "nimal", "", "2026-12-15", "2026-12-31", "High", "To do", "", ""].map(t),
      ["4", "MCU and sensing", "Schematic", "dilan", "", "2027-01-02", "2027-01-15", "Medium", "To do", "3", ""].map(t),
      ["5", "Prototype build", "", "ravi", "", "2027-01-18", "2027-02-05", "High", "To do", "2, 4", ""].map(t),
    ];
    await writeExcelFile([
      { data: rows, sheet: "Tasks", columns: [6, 28, 20, 14, 18, 12, 12, 10, 12, 14, 30].map((width) => ({ width })) },
    ] as never).toFile("Idea2Launch-task-import.xlsx");
  }

  const nameOf = (ref: string) => plan?.tasks.find((t) => t.ref === ref)?.title ?? "";
  const subCount = plan?.tasks.filter((t) => t.parentRef).length ?? 0;
  const linkCount = plan?.tasks.reduce((n, t) => n + t.predecessorRefs.length + t.existingPredecessorIds.length, 0) ?? 0;

  return (
    <Modal open={open} onClose={close} title={`Import tasks into ${project.code}`} wide="xl"
      footer={<>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!plan?.tasks.length} onClick={run}>
          {plan ? `Import ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"}` : "Import"}
        </Button>
      </>}>
      {!file && (
        <>
          <button onClick={() => input.current?.click()} disabled={reading}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-brand-400 hover:bg-brand-50/40">
            <Upload className="size-7 text-slate-400" />
            <span className="text-sm font-medium text-slate-800">{reading ? "Reading the file…" : "Choose a file or drop it here"}</span>
            <span className="text-xs text-slate-500">Excel (.xlsx), CSV, or Microsoft Project saved as XML (.xml)</span>
          </button>
          <input ref={input} type="file" hidden accept=".xlsx,.xlsm,.csv,.xml,.mpp,.xls" onChange={(e) => pick(e.target.files?.[0])} />
          {err && <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{err}</p>}
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <p><b>Excel or CSV:</b> one row per task. Columns are found by their headings: Task, Main task (for subtasks), Owner, Collaborators, Start date, Due date, Priority, Status, Predecessors, Description. Only Task is required.</p>
            <p><b>Microsoft Project:</b> choose File › Save As › "XML Format (*.xml)", then upload it. Summary tasks become main tasks, the tasks under them become subtasks, and links become predecessors. A Project export to Excel also works.</p>
            <p>Owners are matched by username or full name. Predecessors can be the ID numbers from the file (like "2, 4" or "3FS+2d") or task names.</p>
            <button onClick={sample} className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:text-brand-700"><FileSpreadsheet className="size-4" /> Download a sample Excel file</button>
          </div>
        </>
      )}

      {file && plan && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-slate-600"><b className="text-slate-900">{file.name}</b> · {plan.source}</span>
            <button className="text-brand-600 hover:text-brand-700" onClick={reset}>Choose another file</button>
          </div>
          <p className="mt-2 text-sm text-slate-700">
            {plan.tasks.length - subCount} main task{plan.tasks.length - subCount === 1 ? "" : "s"}, {subCount} subtask{subCount === 1 ? "" : "s"} and {linkCount} predecessor link{linkCount === 1 ? "" : "s"} will be added.
            {plan.skipped > 0 && ` ${plan.skipped} task${plan.skipped === 1 ? " is" : "s are"} already in this project and will be skipped.`}
          </p>
          {existing.length > 0 && (
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="size-4 accent-brand-500" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
              Skip tasks whose name is already in this project
            </label>
          )}
          {plan.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
              {plan.warnings.map((w) => <li key={w} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</li>)}
            </ul>
          )}
          <div className="mt-3 max-h-[46vh] overflow-auto rounded-lg ring-1 ring-slate-200 scroll-thin">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-3 py-2 font-medium">Task</th><th className="px-2 py-2 font-medium">Owner</th><th className="px-2 py-2 font-medium">Dates</th><th className="px-2 py-2 font-medium">Priority</th><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">Waits on</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plan.tasks.slice(0, 400).map((t) => (
                  <tr key={t.ref}>
                    <td className={cx("max-w-64 truncate px-3 py-1.5", t.parentRef ? "pl-8 text-slate-600" : "font-medium text-slate-900")} title={t.title}>{t.title}</td>
                    <td className="truncate px-2 py-1.5 text-slate-600">{t.ownerId ? store.profileById.get(t.ownerId)?.full_name : <span className="text-slate-300">–</span>}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{t.start || t.due ? `${fmtDate(t.start) || "?"} – ${fmtDate(t.due) || "?"}` : <span className="text-slate-300">–</span>}</td>
                    <td className="px-2 py-1.5 text-slate-600">{PRIORITY_LABEL[t.priority]}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{TASK_STATUS_LABEL[t.status]}</td>
                    <td className="max-w-48 truncate px-2 py-1.5 text-slate-600">
                      {[...t.predecessorRefs.map(nameOf), ...t.existingPredecessorIds.map((id) => store.taskById.get(id)?.title ?? "")].filter(Boolean).length > 0 &&
                        <span className="inline-flex items-center gap-1"><Link2 className="size-3.5 text-slate-400" />{[...t.predecessorRefs.map(nameOf), ...t.existingPredecessorIds.map((id) => store.taskById.get(id)?.title ?? "")].join(", ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.tasks.length > 400 && <p className="px-3 py-2 text-xs text-slate-500">Showing the first 400 of {plan.tasks.length}. All of them will be imported.</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
