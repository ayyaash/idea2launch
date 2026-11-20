import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, FolderKanban, Download } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, fmtShort } from "../lib/format";
import { inYear, progressOf } from "../lib/metrics";
import { canCreateProject } from "../lib/perms";
import { ApprovalPill } from "../components/Approval";
import { exportToExcel } from "../lib/excel";
import type { ProjectStatus } from "../lib/types";
import { Avatar, AvatarStack, Button, Card, EmptyState, Input, PageHeader, Select, Spinner } from "../components/ui";
import { ProjectForm } from "../components/ProjectForm";
import { ProjectStatusPill } from "./Dashboard";

export default function Projects() {
  const store = useStore();
  const { me } = useAuth();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"" | ProjectStatus | "open">("open");
  const [year, setYear] = useState("");
  const [mine, setMine] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const years = useMemo(() => {
    const ys = new Set<number>([new Date().getFullYear()]);
    for (const p of store.projects) {
      const a = Number((p.start_date ?? p.created_at).slice(0, 4));
      const b = Number((p.end_date ?? `${new Date().getFullYear()}`).slice(0, 4));
      for (let y = a; y <= Math.min(b, a + 10); y++) ys.add(y);
    }
    return [...ys].sort((a, b) => b - a);
  }, [store.projects]);

  const list = useMemo(() => store.projects.filter((p) => {
    const s = q.trim().toLowerCase();
    if (s && !(p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s) || p.description.toLowerCase().includes(s))) return false;
    if (category && (category === "none" ? p.category_id : p.category_id !== category)) return false;
    if (status === "open" && (p.status === "completed" || p.status === "cancelled")) return false;
    if (status && status !== "open" && p.status !== status) return false;
    if (year && !inYear(p, Number(year))) return false;
    if (mine && me && !store.membersOf(p.id).has(me.id)) return false;
    return true;
  }).sort((a, b) => a.code.localeCompare(b.code)), [store, q, category, status, year, mine, me]);

  if (!store.ready) return <Spinner />;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Projects" subtitle={`${list.length} of ${store.projects.length} projects`}
        actions={<>
          <Button icon={<Download className="size-4" />} onClick={() => {
            const ids = new Set(list.map((p) => p.id));
            exportToExcel("Idea2Launch-projects.xlsx", list, store.tasks.filter((t) => ids.has(t.project_id)), store);
          }}>Excel</Button>
          {canCreateProject(me) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>New project</Button>}
        </>} />

      <Card className="mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_160px_120px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Search by name or code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        </div>
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">No category</option>
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="open">Open (not finished)</option>
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
        </Select>
        <Select aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Any year</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <label className="flex items-center gap-2 px-1 text-sm whitespace-nowrap text-slate-700">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 accent-brand-500" /> Only mine
        </label>
      </Card>

      {list.length === 0 ? (
        <EmptyState icon={<FolderKanban className="size-8" />} title="No projects match" text="Try clearing the filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[110px_minmax(0,1fr)_150px_170px_110px_150px_110px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium tracking-wide text-slate-500 uppercase lg:grid">
            <span>Code</span><span>Project</span><span>Category</span><span>Lead</span><span>Status</span><span>Dates</span><span>Progress</span>
          </div>
          <ul>
            {list.map((p) => {
              const cat = p.category_id ? store.categoryById.get(p.category_id) : undefined;
              const lead = p.lead_id ? store.profileById.get(p.lead_id) : undefined;
              const prog = progressOf(p.id, store.tasks);
              const team = [...store.membersOf(p.id)].map((id) => store.profileById.get(id));
              return (
                <li key={p.id} className="border-b border-slate-100 last:border-0">
                  <Link to={`/projects/${p.id}`} className="grid gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50 lg:grid-cols-[110px_minmax(0,1fr)_150px_170px_110px_150px_110px] lg:items-center">
                    <span className="font-mono text-xs text-slate-500">{p.code}</span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2"><span className="truncate font-medium text-slate-900">{p.name}</span><ApprovalPill project={p} /></span>
                      <span className="mt-0.5 flex items-center gap-2"><AvatarStack people={team} size={20} max={5} /></span>
                    </span>
                    <span className="flex items-center gap-1.5 text-sm text-slate-600">
                      {cat ? <><span className="size-2.5 rounded-full" style={{ background: cat.color }} />{cat.name}</> : <span className="text-slate-400">–</span>}
                    </span>
                    <span className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
                      <Avatar person={lead} size={22} /><span className="truncate">{lead?.full_name ?? "No lead"}</span>
                    </span>
                    <span><ProjectStatusPill status={p.status} /></span>
                    <span className="text-xs text-slate-500">{fmtShort(p.start_date) || "?"} – {fmtShort(p.end_date) || "open"}</span>
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-emerald-500" style={{ width: `${prog.pct}%` }} /></span>
                      <span className="text-xs text-slate-500 tabular-nums">{prog.pct}%</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <ProjectForm open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
