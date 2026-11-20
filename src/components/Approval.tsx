import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, X } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { canApprove } from "../lib/perms";
import type { Project } from "../lib/types";
import { Button, Card, Input, Modal, Pill } from "./ui";

export function ApprovalPill({ project }: { project: Project }) {
  if (project.approval === "pending") {
    return <Pill className="bg-amber-100 text-amber-800"><Clock className="size-3" />Waiting for approval</Pill>;
  }
  if (project.approval === "rejected") return <Pill className="bg-red-100 text-red-700">Not approved</Pill>;
  return null;
}

/** Approve / Reject buttons for Admins, Managers and Project Coordinators. */
export function ReviewButtons({ project, size = "sm" }: { project: Project; size?: "sm" | "md" }) {
  const store = useStore();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const review = (approve: boolean, n = "") => store.mutate(
    () => supabase.rpc("review_project", { p_project: project.id, p_approve: approve, p_note: n }),
    { success: approve ? `${project.code} approved` : `${project.code} not approved` });
  return (
    <>
      <div className="flex gap-2">
        {project.approval !== "approved" && (
          <Button size={size} variant="primary" icon={<Check className="size-4" />} onClick={() => review(true)}>Approve</Button>
        )}
        {project.approval === "pending" && (
          <Button size={size} icon={<X className="size-4" />} onClick={() => { setNote(""); setRejecting(true); }}>Reject</Button>
        )}
      </div>
      <Modal open={rejecting} onClose={() => setRejecting(false)} title={`Don't approve ${project.code}?`}
        footer={<>
          <Button onClick={() => setRejecting(false)}>Cancel</Button>
          <Button variant="danger" onClick={async () => { setRejecting(false); await review(false, note); }}>Reject project</Button>
        </>}>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Reason <span className="font-normal text-slate-400">(optional, sent to the person who added it)</span></span>
          <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Merge this with PRJ-012" />
        </label>
      </Modal>
    </>
  );
}

/** Banner at the top of a project that isn't approved yet. */
export function ApprovalBanner({ project }: { project: Project }) {
  const { me } = useAuth();
  const store = useStore();
  if (project.approval === "approved") return null;
  const by = project.created_by ? store.profileById.get(project.created_by) : undefined;
  const pending = project.approval === "pending";
  return (
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm ring-1 ${pending ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-red-50 text-red-800 ring-red-200"}`}>
      <span>
        {pending
          ? <>This project was added by <b>{by?.full_name ?? "someone"}</b> and is waiting for approval from an admin, manager or project coordinator. Only they and the project's people can see it for now.</>
          : <>This project was not approved{project.review_note ? <>: <i>{project.review_note}</i></> : "."}</>}
      </span>
      {canApprove(me) && <ReviewButtons project={project} />}
    </div>
  );
}

/** Dashboard card: projects waiting for approval (approvers see all; others see their own). */
export function PendingApprovals() {
  const { me } = useAuth();
  const store = useStore();
  const approver = canApprove(me);
  const list = store.projects.filter((p) => p.approval !== "approved"
    && (approver ? p.approval === "pending" : p.created_by === me?.id));
  if (!list.length) return null;
  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
        <Clock className="size-4 text-amber-600" />
        {approver ? `Projects waiting for your approval (${list.length})` : "Your projects waiting for approval"}
      </h2>
      <ul className="divide-y divide-slate-100">
        {list.map((p) => {
          const by = p.created_by ? store.profileById.get(p.created_by) : undefined;
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link to={`/projects/${p.id}`} className="min-w-0 hover:underline">
                <span className="mr-2 font-mono text-xs text-slate-500">{p.code}</span>
                <span className="font-medium text-slate-900">{p.name}</span>
                {approver && <span className="ml-2 text-xs text-slate-500">added by {by?.full_name ?? "someone"}</span>}
              </Link>
              {approver ? <ReviewButtons project={p} /> : <ApprovalPill project={p} />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
