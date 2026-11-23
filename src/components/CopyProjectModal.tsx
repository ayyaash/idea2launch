import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { canApprove } from "../lib/perms";
import { fmtDate } from "../lib/format";
import type { Project } from "../lib/types";
import { Button, Field, Input, Modal } from "./ui";
import { PersonSelect } from "./pickers";
import { suggestCode } from "./ProjectForm";

/** Copy an existing project (its tasks, subtasks and dependencies) to start a new one. */
export function CopyProjectModal({ open, project, onClose }: { open: boolean; project: Project; onClose: () => void }) {
  const store = useStore();
  const { me } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [lead, setLead] = useState<string | null>(null);
  const [people, setPeople] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // fill once per opening (background refreshes must not wipe typing)
  const filled = useRef(false);
  useEffect(() => {
    if (!open) { filled.current = false; return; }
    if (filled.current) return;
    filled.current = true;
    setCode(suggestCode(store.projects));
    setName(`${project.name} (copy)`);
    setStart(new Date().toISOString().slice(0, 10));
    setLead(canApprove(me) ? project.lead_id : me?.id ?? null);
    setPeople(true);
    setErr("");
  }, [open, project, store.projects, me]);

  const tasks = store.tasks.filter((t) => t.project_id === project.id);
  const main = tasks.filter((t) => !t.parent_id).length;
  const shift = start && project.start_date ? differenceInCalendarDays(parseISO(start), parseISO(project.start_date)) : 0;
  const newEnd = project.end_date ? addDays(parseISO(project.end_date), shift).toISOString().slice(0, 10) : null;

  async function copy() {
    if (!code.trim() || !name.trim()) { setErr("Project code and name are required."); return; }
    setBusy(true);
    setErr("");
    const id = await store.mutate<string>(() => supabase.rpc("copy_project", {
      p_project: project.id, p_code: code.trim(), p_name: name.trim(), p_start: start || null, p_lead: lead, p_keep_people: people,
    }), { success: canApprove(me) ? "Project copied" : "Project copied and sent for approval" });
    setBusy(false);
    if (id) { onClose(); nav(`/projects/${id}`); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Copy project" wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={copy}>{canApprove(me) ? "Copy project" : "Copy and send for approval"}</Button></>}>
      <p className="mb-4 text-sm text-slate-600">
        Start a new project from <b>{project.code} · {project.name}</b>. Its {main} task{main === 1 ? "" : "s"}
        {tasks.length > main ? ` and ${tasks.length - main} subtask${tasks.length - main === 1 ? "" : "s"}` : ""} are copied as "To do".
      </p>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <Field label="New project code"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
        <Field label="New project name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Start date" hint={project.start_date
          ? `Task dates move by the same amount${shift ? ` (${shift > 0 ? "+" : ""}${shift} days)` : ""}.${newEnd ? ` New end date: ${fmtDate(newEnd)}.` : ""}`
          : "The original has no start date, so task dates stay the same."}>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Project lead"><PersonSelect value={lead} onChange={setLead} placeholder="No lead yet" /></Field>
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={people} onChange={(e) => setPeople(e.target.checked)} className="mt-0.5 size-4 accent-brand-500" />
        <span>Keep the same people<span className="block text-xs text-slate-500">The team, task owners and collaborators. Untick to copy the tasks without anyone assigned.</span></span>
      </label>
      <p className="mt-4 text-xs text-slate-500">Also copied: descriptions, priorities and task dependencies. Not copied: comments, files and progress.</p>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </Modal>
  );
}
