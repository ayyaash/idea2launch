import { useEffect, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { canApprove } from "../lib/perms";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL } from "../lib/format";
import type { Project, ProjectStatus } from "../lib/types";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";
import { Copy } from "lucide-react";
import { PersonSelect } from "./pickers";

type Draft = Pick<Project, "code" | "name" | "description" | "category_id" | "status" | "lead_id" | "start_date" | "end_date">;

export function suggestCode(projects: Project[]) {
  const year = new Date().getFullYear();
  const prefix = `RD-${year}-`;
  const nums = projects.map((p) => p.code.startsWith(prefix) ? parseInt(p.code.slice(prefix.length), 10) : 0).filter((n) => !isNaN(n));
  return `${prefix}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
}

export function ProjectForm({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project }) {
  const store = useStore();
  const { me } = useAuth();
  const nav = useNavigate();
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // New project only: start from another project as a template (its tasks and subtasks are copied).
  const [templateId, setTemplateId] = useState("");
  const [keepPeople, setKeepPeople] = useState(true);
  const template = templateId ? store.projectById.get(templateId) : undefined;
  const shiftEnd = (tpl: Project | undefined, start: string | null) =>
    tpl?.end_date ? (tpl.start_date && start ? addDays(parseISO(tpl.end_date), differenceInCalendarDays(parseISO(start), parseISO(tpl.start_date))).toISOString().slice(0, 10) : tpl.end_date) : null;

  // Fill the form once each time it opens. The app refreshes its data in the background
  // (every 45 seconds and when the window regains focus); that must not wipe what's being typed.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { filledFor.current = null; return; }
    const key = project?.id ?? "new";
    if (filledFor.current === key) return;
    filledFor.current = key;
    setErr("");
    setTemplateId("");
    setKeepPeople(true);
    setD(project ? { ...project } : {
      code: suggestCode(store.projects), name: "", description: "", category_id: store.categories[0]?.id ?? null,
      status: "planning", lead_id: me && me.role !== "admin" && me.role !== "manager" ? me.id : null,
      start_date: new Date().toISOString().slice(0, 10), end_date: null,
    });
  }, [open, project, store.projects, store.categories, me]);

  if (!d) return null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD({ ...d, [k]: v, ...(k === "start_date" && template ? { end_date: shiftEnd(template, v as string | null) } : {}) });

  function pickTemplate(id: string) {
    setTemplateId(id);
    const tpl = id ? store.projectById.get(id) : undefined;
    if (!tpl || !d) return;
    setD({
      ...d,
      name: d.name || `${tpl.name} (copy)`,
      description: d.description || tpl.description,
      category_id: tpl.category_id,
      lead_id: d.lead_id ?? tpl.lead_id,
      end_date: shiftEnd(tpl, d.start_date),
    });
  }
  const tplTasks = template ? store.tasks.filter((t) => t.project_id === template.id) : [];
  const tplMain = tplTasks.filter((t) => !t.parent_id).length;

  async function save() {
    if (!d) return;
    if (!d.code.trim() || !d.name.trim()) { setErr("Project code and name are required."); return; }
    if (d.start_date && d.end_date && d.end_date < d.start_date) { setErr("The end date must be on or after the start date."); return; }
    setBusy(true);
    const { approval: _a, reviewed_by: _b, reviewed_at: _c, review_note: _n, ...rest } = d as Partial<Project>;
    void _a; void _b; void _c; void _n;
    const payload = { ...rest, code: d.code.trim(), name: d.name.trim() };
    if (project) {
      const ok = await store.patchProject(project.id, payload);
      setBusy(false);
      if (ok) onClose();
    } else if (template) {
      const newId = await store.mutate<string>(() => supabase.rpc("copy_project", {
        p_project: template.id, p_code: payload.code, p_name: payload.name, p_start: d.start_date || null,
        p_lead: d.lead_id, p_keep_people: keepPeople,
      }), { success: canApprove(me) ? "Project created from the template" : "Project created from the template and sent for approval" });
      if (newId) {
        // the copy starts from the template's details; apply what was chosen in this form
        await supabase.from("projects").update({ category_id: d.category_id, status: d.status, end_date: d.end_date, description: d.description }).eq("id", newId);
        await store.refresh();
      }
      setBusy(false);
      if (newId) { onClose(); nav(`/projects/${newId}`); }
    } else {
      const created = await store.mutate(() => supabase.from("projects").insert(payload).select("id").single(), { success: canApprove(me) ? "Project created" : "Project sent for approval" });
      setBusy(false);
      if (created) { onClose(); nav(`/projects/${(created as { id: string }).id}`); }
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={project ? "Edit project" : "New project"} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{project ? "Save changes" : canApprove(me) ? "Create project" : "Send for approval"}</Button></>}>
      {!project && store.projects.length > 0 && (
        <div className="mb-4 rounded-lg bg-slate-50 p-3 ring-1 ring-line">
          <Field label="Start from">
            <Select aria-label="Start from" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
              <option value="">A blank project</option>
              {[...store.projects].sort((a, b) => a.code.localeCompare(b.code)).map((p) => (
                <option key={p.id} value={p.id}>Copy of {p.code} · {p.name}</option>
              ))}
            </Select>
          </Field>
          {template && (
            <div className="mt-2 space-y-2 text-sm text-slate-600">
              <p className="flex items-start gap-1.5"><Copy className="mt-0.5 size-4 shrink-0 text-slate-400" />
                <span>Its {tplMain} task{tplMain === 1 ? "" : "s"}{tplTasks.length > tplMain ? ` and ${tplTasks.length - tplMain} subtask${tplTasks.length - tplMain === 1 ? "" : "s"}` : ""} are copied as "To do", with dates moved to match the start date below. Comments and files are not copied.</span></p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={keepPeople} onChange={(e) => setKeepPeople(e.target.checked)} className="size-4 accent-brand-500" />
                Keep the same team, task owners and collaborators
              </label>
            </div>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <Field label="Project code"><Input value={d.code} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
        <Field label="Project name"><Input autoFocus value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Smart irrigation sensor" /></Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Category" hint={store.categories.length ? undefined : "Admins can add categories in the Admin panel."}>
          <Select value={d.category_id ?? ""} onChange={(e) => set("category_id", e.target.value || null)}>
            <option value="">No category</option>
            {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={d.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Project lead"><PersonSelect value={d.lead_id} onChange={(v) => set("lead_id", v)} placeholder="No lead yet" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><Input type="date" value={d.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} /></Field>
          <Field label="End date"><Input type="date" value={d.end_date ?? ""} min={d.start_date ?? undefined} onChange={(e) => set("end_date", e.target.value || null)} /></Field>
        </div>
      </div>
      <Field label="Description" className="mt-4">
        <Textarea value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Goal, scope, success criteria…" />
      </Field>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </Modal>
  );
}
