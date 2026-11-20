import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addWeeks, format, isSameWeek } from "date-fns";
import { ChevronLeft, ChevronRight, AlertTriangle, Info } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { ROLE_LABEL } from "../lib/format";
import { overlaps, taskWindow, today, weekRange, isOverdue } from "../lib/metrics";
import type { Task } from "../lib/types";
import { Avatar, Button, Card, PageHeader, Select, Spinner, cx } from "../components/ui";
import { DueBadge } from "../components/TaskPanel";

const WEEKS = 8;

export default function Workload() {
  const store = useStore();
  const { me } = useAuth();
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<{ person: string; week: number | "none" } | null>(null);
  const threshold = Number(store.settings.overload_threshold) || 25;
  const ws = store.settings.week_starts_on;

  const weeks = useMemo(() => Array.from({ length: WEEKS }, (_, i) => weekRange(addWeeks(today(), offset + i), ws)), [offset, ws]);
  const people = useMemo(() => store.profiles.filter((p) => p.is_active && p.role !== "viewer"), [store.profiles]);

  const openTasks = useMemo(() => store.tasks.filter((t) => {
    if (t.status === "done" || !t.owner_id) return false;
    if (!category) return true;
    return store.projectById.get(t.project_id)?.category_id === category;
  }), [store.tasks, store.projectById, category]);

  const grid = useMemo(() => {
    const rows = new Map<string, { weeks: Task[][]; none: Task[]; total: number; overdue: number }>();
    for (const p of people) rows.set(p.id, { weeks: weeks.map(() => []), none: [], total: 0, overdue: 0 });
    for (const t of openTasks) {
      const row = rows.get(t.owner_id!);
      if (!row) continue;
      row.total++;
      if (isOverdue(t)) row.overdue++;
      const w = taskWindow(t);
      if (!w) { row.none.push(t); continue; }
      weeks.forEach((wk, i) => { if (overlaps(w, wk)) row.weeks[i].push(t); });
    }
    return rows;
  }, [people, openTasks, weeks]);

  const sorted = useMemo(() => [...people].sort((a, b) => (grid.get(b.id)?.weeks[0].length ?? 0) - (grid.get(a.id)?.weeks[0].length ?? 0) || a.full_name.localeCompare(b.full_name)), [people, grid]);

  if (!store.ready) return <Spinner />;
  const overloaded = sorted.filter((p) => grid.get(p.id)!.weeks.some((w) => w.length > threshold));
  const selTasks = selected ? (selected.week === "none" ? grid.get(selected.person)!.none : grid.get(selected.person)!.weeks[selected.week]) : [];
  const selPerson = selected ? store.profileById.get(selected.person) : undefined;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Workload" subtitle={<>Open tasks per person per week. More than <b>{threshold}</b> in a week counts as overloaded{me?.role === "admin" ? <> (change it in <Link to="/admin?tab=settings" className="text-brand-600 hover:underline">Admin panel</Link>)</> : null}.</>}
        actions={<>
          <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
            <option value="">All categories</option>
            {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <div className="flex items-center rounded-lg bg-white ring-1 ring-slate-300">
            <button aria-label="Earlier weeks" className="p-2 text-slate-500 hover:text-slate-900" onClick={() => setOffset(offset - 4)}><ChevronLeft className="size-4" /></button>
            <button className="px-2 text-sm font-medium" onClick={() => setOffset(0)}>This week</button>
            <button aria-label="Later weeks" className="p-2 text-slate-500 hover:text-slate-900" onClick={() => setOffset(offset + 4)}><ChevronRight className="size-4" /></button>
          </div>
        </>} />

      {overloaded.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span><b>{overloaded.map((p) => p.full_name).join(", ")}</b> {overloaded.length > 1 ? "have" : "has"} more than {threshold} open tasks in at least one week shown.</span>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-left font-medium">Person</th>
                <th className="px-2 py-2 font-medium">Open</th>
                {weeks.map((w, i) => (
                  <th key={i} className={cx("px-2 py-2 font-medium", isSameWeek(w.start, today(), { weekStartsOn: ws }) && "text-brand-600")}>
                    {format(w.start, "d MMM")}
                  </th>
                ))}
                <th className="px-2 py-2 font-medium">No date</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const row = grid.get(p.id)!;
                return (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar person={p} size={28} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.full_name}</p>
                          <p className="truncate text-xs text-slate-500">{p.job_title || ROLE_LABEL[p.role]}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className="font-semibold tabular-nums">{row.total}</span>
                      {row.overdue > 0 && <span className="block text-[11px] text-red-600">{row.overdue} late</span>}
                    </td>
                    {row.weeks.map((list, i) => (
                      <td key={i} className="px-1 py-1.5 text-center">
                        <Cell n={list.length} threshold={threshold} active={selected?.person === p.id && selected.week === i}
                          onClick={() => setSelected(selected?.person === p.id && selected.week === i ? null : { person: p.id, week: i })} />
                      </td>
                    ))}
                    <td className="px-1 py-1.5 text-center">
                      <Cell n={row.none.length} threshold={Infinity} muted active={selected?.person === p.id && selected.week === "none"}
                        onClick={() => setSelected(selected?.person === p.id && selected.week === "none" ? null : { person: p.id, week: "none" })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          <Legend className="bg-emerald-100" label="Light" />
          <Legend className="bg-amber-100" label={`Busy (over ${Math.round(threshold * 0.7)})`} />
          <Legend className="bg-red-500" label={`Overloaded (over ${threshold})`} />
          <span className="flex items-center gap-1"><Info className="size-3.5" />A task counts in every week between its start and due date. Late tasks count in this week.</span>
        </div>
      </Card>

      {selected && selPerson && (
        <Card className="mt-4">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold">
              {selPerson.full_name} · {selected.week === "none" ? "tasks without dates" : `week of ${format(weeks[selected.week].start, "d MMM")}`} ({selTasks.length})
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          </div>
          <ul className="divide-y divide-slate-100">
            {selTasks.map((t) => <SelRow key={t.id} t={t} />)}
            {selTasks.length === 0 && <li className="px-4 py-4 text-sm text-slate-500">No open tasks.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Cell({ n, threshold, onClick, active, muted }: { n: number; threshold: number; onClick: () => void; active: boolean; muted?: boolean }) {
  const tone = n === 0 ? "bg-slate-50 text-slate-300" : muted ? "bg-slate-100 text-slate-600"
    : n > threshold ? "bg-red-500 text-white font-semibold" : n > threshold * 0.7 ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900";
  return (
    <button onClick={onClick} disabled={n === 0} aria-label={`${n} tasks`}
      className={cx("h-9 w-full min-w-12 rounded-md tabular-nums transition", tone, active && "ring-2 ring-navy-900", n > 0 && "hover:brightness-95")}>
      {n || "·"}
    </button>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cx("size-3 rounded", className)} />{label}</span>;
}

function SelRow({ t }: { t: Task }) {
  const store = useStore();
  const p = store.projectById.get(t.project_id);
  return (
    <li>
      <Link to={`/projects/${t.project_id}?task=${t.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{t.title}</span>
          <span className="block truncate text-xs text-slate-500">{p?.code} · {p?.name}</span>
        </span>
        <DueBadge task={t} />
      </Link>
    </li>
  );
}
