import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { canEditProject } from "../lib/perms";
import type { Task } from "../lib/types";
import { Button, Field, Input, Modal, Select } from "./ui";

export function CopyTaskModal({ open, task, onClose, onCopied }: {
  open: boolean; task: Task; onClose: () => void; onCopied: (newId: string) => void;
}) {
  const store = useStore();
  const { me } = useAuth();
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState(task.project_id);
  const [subs, setSubs] = useState(true);
  const [comments, setComments] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setTitle(`${task.title} (copy)`); setTarget(task.project_id); setSubs(true); setComments(true); }
  }, [open, task]);

  const targets = store.projects.filter((p) => canEditProject(me, p, store.membersOf(p.id)));
  const subCount = store.tasks.filter((t) => t.parent_id === task.id).length;

  async function copy() {
    setBusy(true);
    const id = await store.mutate<string>(() => supabase.rpc("copy_task", {
      p_task: task.id, p_target_project: target, p_include_subtasks: subs, p_include_comments: comments, p_new_title: title,
    }), { success: "Task copied" });
    setBusy(false);
    if (id) onCopied(id);
  }

  return (
    <Modal open={open} onClose={onClose} title="Copy task"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={copy} disabled={!title.trim()}>Copy task</Button></>}>
      <div className="space-y-4">
        <Field label="New task name"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Copy into project" hint="You can copy into any project you're assigned to.">
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
        </Field>
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 text-[13px] font-medium text-slate-700">Also copy</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} className="size-4 accent-brand-500" />
            Subtasks {subCount ? `(${subCount})` : ""}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={comments} onChange={(e) => setComments(e.target.checked)} className="size-4 accent-brand-500" />
            Comments</label>
        </fieldset>
        <p className="text-xs text-slate-500">The copy starts as "To do" with the same owner, collaborators, priority and dates. Files and dependencies are not copied.</p>
      </div>
    </Modal>
  );
}
