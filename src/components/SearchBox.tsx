import { useMemo, useRef, useState, useEffect } from "react";
import { Search, FolderKanban, CheckSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../lib/store";

export function SearchBox() {
  const { projects, tasks, projectById } = useStore();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const f = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, []);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return { p: [], t: [] };
    return {
      p: projects.filter((p) => p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s)).slice(0, 5),
      t: tasks.filter((t) => t.title.toLowerCase().includes(s)).slice(0, 8),
    };
  }, [q, projects, tasks]);

  const go = (path: string) => { setOpen(false); setQ(""); nav(path); };

  return (
    <div className="relative max-w-md" ref={box}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Search projects and tasks" aria-label="Search"
        className="h-9 w-full rounded-lg bg-slate-100 pr-3 pl-9 text-sm placeholder:text-slate-500 focus:bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none" />
      {open && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl bg-white py-1 shadow-xl ring-1 ring-slate-200">
          {results.p.length + results.t.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">No matches</p>}
          {results.p.map((p) => (
            <button key={p.id} onClick={() => go(`/projects/${p.id}`)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50">
              <FolderKanban className="size-4 text-navy-500" /><span className="font-mono text-xs text-slate-500">{p.code}</span>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {results.t.map((t) => (
            <button key={t.id} onClick={() => go(`/projects/${t.project_id}?task=${t.id}`)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50">
              <CheckSquare className="size-4 text-brand-500" /><span className="truncate">{t.title}</span>
              <span className="ml-auto shrink-0 text-xs text-slate-400">{projectById.get(t.project_id)?.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
