import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { canApprove } from "../lib/perms";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL } from "../lib/format";
import type { Project, ProjectStatus } from "../lib/types";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";
import { PersonSelect } from "./pickers";

type Draft = Pick<Project, "code" | "name" | "description" | "category_id" | "status" | "lead_id" | "start_date" | "end_date">;

function suggestCode(projects: Project[]) {
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

  useEffect(() => {
    if (!open) return;
    setErr("");
    setD(project ? { ...project } : {
      code: suggestCode(store.projects), name: "", description: "", category_id: store.categories[0]?.id ?? null,
      status: "planning", lead_id: me && me.role !== "admin" && me.role !== "manager" ? me.id : null,
      start_date: new Date().toISOString().slice(0, 10), end_date: null,
    });
  }, [open, project, store.projects, store.categories, me]);

  if (!d) return null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });

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
    } else {
      const created = await store.mutate(() => supabase.from("projects").insert(payload).select("id").single(), { success: canApprove(me) ? "Project created" : "Project sent for approval" });
      setBusy(false);
      if (created) { onClose(); nav(`/projects/${(created as { id: string }).id}`); }
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={project ? "Edit project" : "New project"} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{project ? "Save changes" : canApprove(me) ? "Create project" : "Send for approval"}</Button></>}>
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
