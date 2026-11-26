import { useCallback, useEffect, useMemo, useState } from "react";
import { addMonths, format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FlaskConical, Plus, Search, Trash2, X } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase, errorText } from "../lib/supabase";
import { canApprove, canContribute } from "../lib/perms";
import { fmtDate } from "../lib/format";
import type { Profile } from "../lib/types";
import { Avatar, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, cx, useConfirm } from "../components/ui";
import { PersonSelect } from "../components/pickers";
import { useToast } from "../components/Toast";

export type TrialStatus = "planned" | "done" | "postponed" | "cancelled";
export interface Trial {
  id: string;
  planned_date: string;
  actual_date: string | null;
  mould: string;
  purpose: string;
  project_id: string | null;
  owner_id: string | null;
  status: TrialStatus;
  doc_url: string;
  feedback: string;
  created_by: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<TrialStatus, string> = { planned: "Planned", done: "Done", postponed: "Postponed", cancelled: "Cancelled" };
const STATUS_STYLE: Record<TrialStatus, string> = {
  planned: "bg-sky-50 text-sky-700 ring-sky-200",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  postponed: "bg-amber-50 text-amber-800 ring-amber-200",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-200",
};

const isLate = (t: Trial) => !!t.actual_date && t.actual_date > t.planned_date;
const isOverdue = (t: Trial) => t.status === "planned" && t.planned_date < format(new Date(), "yyyy-MM-dd");

function canEditTrial(me: Profile | null, t: Trial) {
  return !!me && canContribute(me) && (t.created_by === me.id || t.owner_id === me.id || canApprove(me));
}

export default function Trials() {
  const store = useStore();
  const { me } = useAuth();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [rows, setRows] = useState<Trial[] | null>(null);
  const [moulds, setMoulds] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState<"" | TrialStatus>("");
  const [editing, setEditing] = useState<Trial | "new" | null>(null);

  const load = useCallback(async () => {
    const from = format(startOfMonth(month), "yyyy-MM-dd");
    const to = format(endOfMonth(month), "yyyy-MM-dd");
    const [{ data }, { data: m }] = await Promise.all([
      supabase.from("trials").select("*").gte("planned_date", from).lte("planned_date", to).order("planned_date").order("created_at"),
      supabase.from("trials").select("mould").neq("mould", "").limit(1000),
    ]);
    setRows((data ?? []) as Trial[]);
    setMoulds([...new Set((m ?? []).map((r) => r.mould as string))].sort((a, b) => a.localeCompare(b)));
  }, [month]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((t) => {
    if (project && (project === "none" ? t.project_id : t.project_id !== project)) return false;
    if (status && t.status !== status) return false;
    if (q) {
      const s = q.toLowerCase();
      const p = t.project_id ? store.projectById.get(t.project_id) : undefined;
      if (![t.mould, t.purpose, t.feedback, p?.code ?? "", p?.name ?? ""].some((x) => x.toLowerCase().includes(s))) return false;
    }
    return true;
  }), [rows, project, status, q, store.projectById]);

  const counts = useMemo(() => {
    const r = rows ?? [];
    return {
      total: r.length,
      planned: r.filter((t) => t.status === "planned").length,
      done: r.filter((t) => t.status === "done").length,
      late: r.filter((t) => isLate(t) || isOverdue(t)).length,
      other: r.filter((t) => t.status === "postponed" || t.status === "cancelled").length,
    };
  }, [rows]);

  async function exportMonth() {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    const h = (v: string) => ({ value: v, fontWeight: "bold" as const });
    const s = (v: string | null | undefined) => (v ? { value: v, type: String } : null);
    const d = (v: string | null) => (v ? { value: parseISO(v), type: Date, format: "yyyy-mm-dd" } : null);
    const data = [
      ["Planned date", "Actual date", "Mould", "Purpose", "Project", "Responsible", "Status", "Late (days)", "Document link", "Feedback"].map(h),
      ...shown.map((t) => {
        const p = t.project_id ? store.projectById.get(t.project_id) : undefined;
        const late = isLate(t) ? Math.round((parseISO(t.actual_date!).getTime() - parseISO(t.planned_date).getTime()) / 86400000) : 0;
        return [
          d(t.planned_date), d(t.actual_date), s(t.mould), s(t.purpose), s(p ? `${p.code} · ${p.name}` : ""),
          s(t.owner_id ? store.profileById.get(t.owner_id)?.full_name : ""), s(STATUS_LABEL[t.status]),
          late ? { value: late, type: Number } : null,
          s(t.doc_url), s(t.feedback),
        ];
      }),
    ];
    await writeExcelFile([{ data, sheet: format(month, "MMM yyyy"), columns: [12, 12, 20, 36, 30, 20, 11, 10, 40, 50].map((width) => ({ width })) }] as never)
      .toFile(`R&D trials ${format(month, "yyyy-MM")}.xlsx`);
  }

  if (!store.ready) return <Spinner />;
  const projects = [...store.projects].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="R&D Trials" subtitle="Mould trials by month: when they were planned, when they ran, and what came out of them."
        actions={<>
          <div className="flex items-center rounded-lg bg-white ring-1 ring-line shadow-card">
            <button aria-label="Previous month" className="p-2 text-slate-500 hover:text-ink" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="size-4" /></button>
            <input type="month" aria-label="Month" value={format(month, "yyyy-MM")}
              onChange={(e) => e.target.value && setMonth(startOfMonth(parseISO(`${e.target.value}-01`)))}
              className="w-[8.5rem] bg-transparent text-center text-sm font-semibold text-ink outline-none" />
            <button aria-label="Next month" className="p-2 text-slate-500 hover:text-ink" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="size-4" /></button>
          </div>
          <Button icon={<Download className="size-4" />} onClick={exportMonth} disabled={!shown.length}>Excel</Button>
          {canContribute(me) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>New trial</Button>}
        </>} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Trials this month" value={counts.total} />
        <Stat label="Planned" value={counts.planned} tone="text-sky-700" onClick={() => setStatus(status === "planned" ? "" : "planned")} active={status === "planned"} />
        <Stat label="Done" value={counts.done} tone="text-emerald-700" onClick={() => setStatus(status === "done" ? "" : "done")} active={status === "done"} />
        <Stat label="Late or overdue" value={counts.late} tone={counts.late ? "text-red-600" : undefined} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="relative min-w-48 flex-1 sm:max-w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <Input aria-label="Search trials" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mould, purpose, feedback…" className="pl-8" />
          </div>
          <Select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className="w-auto">
            <option value="">All projects</option>
            <option value="none">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as "" | TrialStatus)} className="w-auto">
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABEL) as TrialStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          {(q || project || status) && <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => { setQ(""); setProject(""); setStatus(""); }}>Clear</Button>}
        </div>

        {rows === null ? <Spinner /> : shown.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={<FlaskConical className="size-8" />}
              title={rows.length ? "No trials match these filters" : `No trials planned for ${format(month, "MMMM yyyy")}`}
              text={rows.length ? undefined : "Log a trial with its planned date. Fill in the actual date, document and feedback after it runs."}
              action={!rows.length && canContribute(me) ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>New trial</Button> : undefined} />
          </div>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Planned</th>
                  <th className="px-2 py-2 font-medium">Actual</th>
                  <th className="px-2 py-2 font-medium">Mould</th>
                  <th className="px-2 py-2 font-medium">Purpose</th>
                  <th className="px-2 py-2 font-medium">Project</th>
                  <th className="px-2 py-2 font-medium">Responsible</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Document</th>
                  <th className="px-2 py-2 font-medium">Feedback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {shown.map((t) => <TrialRow key={t.id} t={t} onOpen={() => setEditing(t)} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <TrialForm trial={editing === "new" ? null : editing} month={month} moulds={moulds}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function Stat({ label, value, tone, onClick, active }: { label: string; value: number; tone?: string; onClick?: () => void; active?: boolean }) {
  const C = onClick ? "button" : "div";
  return (
    <C onClick={onClick} className={cx("rounded-2xl bg-white px-4 py-3 text-left shadow-card ring-1 ring-line", onClick && "hover:ring-slate-300", active && "ring-2 ring-brand-500")}>
      <p className={cx("text-2xl font-bold tabular-nums text-ink", tone)}>{value}</p>
      <p className="text-xs font-medium text-slate-500">{label}</p>
    </C>
  );
}

function TrialRow({ t, onOpen }: { t: Trial; onOpen: () => void }) {
  const store = useStore();
  const p = t.project_id ? store.projectById.get(t.project_id) : undefined;
  const owner = t.owner_id ? store.profileById.get(t.owner_id) : undefined;
  const late = isLate(t);
  const overdue = isOverdue(t);
  return (
    <tr className="cursor-pointer align-top hover:bg-slate-50" onClick={onOpen}>
      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink">{fmtDate(t.planned_date, "d MMM")}
        {overdue && <span className="block text-[11px] font-semibold text-red-600">Not run yet</span>}</td>
      <td className="whitespace-nowrap px-2 py-2.5 text-slate-700">{t.actual_date ? fmtDate(t.actual_date, "d MMM") : <span className="text-slate-300">–</span>}
        {late && <span className="block text-[11px] font-semibold text-amber-700">{Math.round((parseISO(t.actual_date!).getTime() - parseISO(t.planned_date).getTime()) / 86400000)} days late</span>}</td>
      <td className="max-w-44 px-2 py-2.5 font-medium text-ink"><span className="line-clamp-2">{t.mould || <span className="text-slate-300">–</span>}</span></td>
      <td className="max-w-64 px-2 py-2.5 text-slate-700"><span className="line-clamp-2">{t.purpose}</span></td>
      <td className="max-w-44 px-2 py-2.5 text-slate-600">{p ? <span className="line-clamp-2"><span className="font-mono text-xs">{p.code}</span> {p.name}</span> : <span className="text-slate-300">–</span>}</td>
      <td className="px-2 py-2.5">{owner ? <span className="flex items-center gap-1.5 whitespace-nowrap text-slate-700"><Avatar person={owner} size={20} />{owner.full_name.split(" ")[0]}</span> : <span className="text-slate-300">–</span>}</td>
      <td className="whitespace-nowrap px-2 py-2.5">
        <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1", STATUS_STYLE[t.status])}>{STATUS_LABEL[t.status]}</span>
      </td>
      <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}><DocLinks t={t} /></td>
      <td className="max-w-72 px-2 py-2.5 text-slate-600"><span className="line-clamp-2 whitespace-pre-wrap">{t.feedback}</span></td>
    </tr>
  );
}

function DocLinks({ t }: { t: Trial }) {
  if (!t.doc_url) return <span className="text-slate-300">–</span>;
  return (
    <a href={t.doc_url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-40 items-center gap-1 text-brand-600 hover:underline">
      <ExternalLink className="size-3.5 shrink-0" /><span className="truncate">{linkLabel(t.doc_url)}</span>
    </a>
  );
}

function linkLabel(url: string) {
  try { const u = new URL(url); return u.hostname.replace(/^www\./, ""); } catch { return url; }
}

function TrialForm({ trial, month, moulds, onClose, onSaved }: { trial: Trial | null; month: Date; moulds: string[]; onClose: () => void; onSaved: () => void }) {
  const store = useStore();
  const { me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const editable = trial ? canEditTrial(me, trial) : canContribute(me);
  const today = format(new Date(), "yyyy-MM-dd");
  const defaultPlanned = format(startOfMonth(month), "yyyy-MM") === today.slice(0, 7) ? today : format(startOfMonth(month), "yyyy-MM-dd");
  const [d, setD] = useState({
    planned_date: trial?.planned_date ?? defaultPlanned,
    actual_date: trial?.actual_date ?? "",
    mould: trial?.mould ?? "",
    purpose: trial?.purpose ?? "",
    project_id: trial?.project_id ?? "",
    owner_id: trial?.owner_id ?? (me && canContribute(me) ? me.id : ""),
    status: trial?.status ?? ("planned" as TrialStatus),
    doc_url: trial?.doc_url ?? "",
    feedback: trial?.feedback ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((o) => {
    const n = { ...o, [k]: v };
    // the status follows the actual date
    if (k === "actual_date") n.status = v ? (o.status === "planned" ? "done" : o.status) : (o.status === "done" ? "planned" : o.status);
    return n;
  });

  async function save() {
    setErr("");
    if (!d.planned_date) { setErr("The planned date is required."); return; }
    if (!d.mould.trim() && !d.purpose.trim()) { setErr("Fill in the mould or the purpose."); return; }
    if (d.doc_url && !/^https?:\/\//i.test(d.doc_url.trim())) { setErr("The document link should start with http:// or https://"); return; }
    if (d.status === "done" && !d.actual_date) { setErr("A done trial needs its actual date."); return; }
    setBusy(true);
    try {
      const row = {
        planned_date: d.planned_date, actual_date: d.actual_date || null, mould: d.mould.trim(), purpose: d.purpose.trim(),
        project_id: d.project_id || null, owner_id: d.owner_id || null, status: d.status,
        doc_url: d.doc_url.trim(), feedback: d.feedback.trim(),
      };
      const r = trial
        ? await supabase.from("trials").update(row).eq("id", trial.id).select("id")
        : await supabase.from("trials").insert(row).select("id");
      if (r.error) throw r.error;
      if (!r.data?.length) throw new Error("You don't have permission to change this trial.");
      toast.success(trial ? "Trial saved" : "Trial added");
      if (format(parseISO(d.planned_date), "yyyy-MM") !== format(month, "yyyy-MM")) toast.success(`It's listed under ${format(parseISO(d.planned_date), "MMMM yyyy")}.`);
      onSaved();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!trial) return;
    const ok = await confirm({ title: "Delete this trial?", text: "This can't be undone.", confirm: "Delete", danger: true });
    if (!ok) return;
    const r = await supabase.from("trials").delete().eq("id", trial.id).select("id");
    if (r.error || !r.data?.length) { toast.error(r.error ? errorText(r.error) : "You don't have permission to delete this trial."); return; }
    toast.success("Trial deleted");
    onSaved();
  }

  const canDelete = !!trial && !!me && (trial.created_by === me.id || canApprove(me));
  const projects = [...store.projects].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <Modal open onClose={onClose} title={trial ? (editable ? "Edit trial" : "Trial") : "New trial"} wide
      footer={<>
        {canDelete && <Button variant="ghost" className="mr-auto text-red-600 hover:bg-red-50" icon={<Trash2 className="size-4" />} onClick={del}>Delete</Button>}
        <Button onClick={onClose}>{editable ? "Cancel" : "Close"}</Button>
        {editable && <Button variant="primary" loading={busy} onClick={save}>{trial ? "Save" : "Add trial"}</Button>}
      </>}>
      <fieldset disabled={!editable} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Planned date"><Input type="date" value={d.planned_date} onChange={(e) => set("planned_date", e.target.value)} /></Field>
          <Field label="Actual trial date" hint={d.actual_date ? undefined : "Fill in after the trial runs"}><Input type="date" value={d.actual_date} onChange={(e) => set("actual_date", e.target.value)} /></Field>
          <Field label="Status">
            <Select value={d.status} onChange={(e) => set("status", e.target.value as TrialStatus)}>
              {(Object.keys(STATUS_LABEL) as TrialStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mould">
            <Input list="trial-moulds" value={d.mould} onChange={(e) => set("mould", e.target.value)} placeholder="e.g. Pump housing M-12" />
            <datalist id="trial-moulds">{moulds.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
          <Field label="Project (optional)">
            <Select value={d.project_id} onChange={(e) => set("project_id", e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Trial purpose"><Textarea value={d.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="What is this trial checking?" className="min-h-16" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Responsible"><PersonSelect value={d.owner_id || null} onChange={(v) => set("owner_id", v ?? "")} placeholder="No one yet" /></Field>
          <Field label="Trial document link">
            <Input type="url" value={d.doc_url} onChange={(e) => set("doc_url", e.target.value)} placeholder="Paste a SharePoint, OneDrive or Drive link" />
          </Field>
        </div>
        <Field label="Trial feedback"><Textarea value={d.feedback} onChange={(e) => set("feedback", e.target.value)} placeholder="What happened, issues found, next steps…" className="min-h-24" /></Field>
      </fieldset>
      {!editable && trial && <p className="mt-3 text-xs text-slate-500">Only the person who added this trial, the person responsible, and Project Coordinators, Managers and Admins can change it.</p>}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </Modal>
  );
}
