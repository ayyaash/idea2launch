import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useStore } from "../lib/store";
import { Avatar, Select, cx } from "./ui";
import type { Profile } from "../lib/types";

/** Owner picker: people on the project first, then everyone else (assigning adds them to the project). */
export function PersonSelect({ value, onChange, projectId, disabled, placeholder = "Unassigned", id, className, label }: {
  value: string | null; onChange: (id: string | null) => void; projectId?: string; disabled?: boolean;
  placeholder?: string; id?: string; className?: string; label?: string;
}) {
  const { profiles, membersOf } = useStore();
  const active = profiles.filter((p) => p.is_active && p.role !== "viewer");
  const members = projectId ? membersOf(projectId) : new Set<string>();
  const onProject = active.filter((p) => members.has(p.id));
  const others = active.filter((p) => !members.has(p.id));
  return (
    <Select id={id} aria-label={label} className={className} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {projectId && onProject.length > 0 ? (
        <>
          <optgroup label="On this project">{onProject.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</optgroup>
          {others.length > 0 && <optgroup label="Everyone else">{others.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</optgroup>}
        </>
      ) : (
        active.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)
      )}
    </Select>
  );
}

/** Multi-select of people in a small popover. */
export function PeoplePicker({ selected, onToggle, disabled, exclude = [], label = "Add" }: {
  selected: string[]; onToggle: (id: string, on: boolean) => void; disabled?: boolean; exclude?: string[]; label?: string;
}) {
  const { profiles } = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [open]);
  const list = profiles.filter((p) => p.is_active && p.role !== "viewer" && !exclude.includes(p.id)
    && (p.full_name + p.username).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative inline-block" ref={box}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 text-xs font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600 disabled:hidden">
        <Plus className="size-3.5" /> {label}
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 w-64 rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-200">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person"
            className="mb-1 h-8 w-full rounded-md bg-slate-100 px-2 text-sm focus:outline-none" />
          <div className="max-h-60 overflow-y-auto">
            {list.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button key={p.id} type="button" onClick={() => onToggle(p.id, !on)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                  <Avatar person={p} size={22} /><span className="flex-1 truncate">{p.full_name}</span>
                  {on && <Check className="size-4 text-brand-600" />}
                </button>
              );
            })}
            {list.length === 0 && <p className="px-2 py-2 text-xs text-slate-500">Nobody found</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function PersonChip({ person, onRemove }: { person?: Profile; onRemove?: () => void }) {
  if (!person) return null;
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-slate-100 pr-2 pl-0.5 text-xs font-medium text-slate-700">
      <Avatar person={person} size={24} /> {person.full_name}
      {onRemove && (
        <button type="button" aria-label={`Remove ${person.full_name}`} onClick={onRemove} className={cx("ml-0.5 text-slate-400 hover:text-red-600")}>×</button>
      )}
    </span>
  );
}
