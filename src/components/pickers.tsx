import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
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
        <div className="absolute left-0 z-50 mt-1 w-64 rounded-xl bg-white p-2 shadow-xl ring-1 ring-line">
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

/** Owner shown as a button; clicking opens a searchable list to (re)assign right there. */
export function OwnerQuickPick({ value, internName = "", projectId, onChange, disabled, compact, field }: {
  value: string | null; projectId: string; disabled?: boolean; compact?: boolean;
  /** Which intern a task on a shared intern account is for. */
  internName?: string;
  /** internName is "" unless the picked account is an intern account. */
  onChange: (id: string | null, internName: string) => void;
  /** Show as a bordered field with a chevron (task panel). */
  field?: boolean;
}) {
  const { profiles, profileById, membersOf, tasks } = useStore();
  const [open, setOpen] = useState(false);
  // second step when an intern account is picked: which intern is it for?
  const [askFor, setAskFor] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const close = (e: Event) => { if (!(e.target instanceof Node && box.current?.contains(e.target))) setOpen(false); };
    document.addEventListener("mousedown", f);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", f); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  function toggle(btn: HTMLElement) {
    if (open) { setOpen(false); return; }
    // fixed position so the list isn't cut off by scrolling cards; opens upward near the bottom of the screen
    const r = btn.getBoundingClientRect();
    const left = Math.max(8, Math.min(compact ? r.right - 256 : r.left, window.innerWidth - 264));
    setPos(window.innerHeight - r.bottom < 340 && r.top > 340
      ? { position: "fixed", left, bottom: window.innerHeight - r.top + 4 }
      : { position: "fixed", left, top: r.bottom + 4 });
    setHi(0); setAskFor(null); setOpen(true);
  }
  const owner = value ? profileById.get(value) : undefined;
  const members = membersOf(projectId);
  const s = q.toLowerCase();
  const people = profiles.filter((p) => p.is_active && p.role !== "viewer" && (p.full_name + " " + p.username).toLowerCase().includes(s))
    .sort((a, b) => Number(members.has(b.id)) - Number(members.has(a.id)) || a.full_name.localeCompare(b.full_name));
  const options: (Profile | null)[] = [...(value && !q ? [null] : []), ...people];
  const pick = (id: string | null) => {
    const p = id ? profileById.get(id) : undefined;
    if (p?.role === "intern") { setAskFor(p); setName(id === value ? internName : ""); return; }
    setOpen(false); setQ(""); if (id !== value || internName) onChange(id, "");
  };
  const assignIntern = () => {
    const n = name.trim().replace(/\s+/g, " ");
    if (!askFor || !n) return;
    setOpen(false); setQ(""); setAskFor(null);
    if (askFor.id !== value || n !== internName) onChange(askFor.id, n);
  };
  const pastNames = askFor
    ? [...new Set(tasks.filter((t) => t.owner_id === askFor.id && t.intern_name).map((t) => t.intern_name))].sort()
    : [];
  const ownerLabel = owner ? (owner.role === "intern" && internName ? internName : owner.full_name) : "Unassigned";

  const face = (
    <>
      <Avatar person={owner} size={22} />
      {!compact && <span className={cx("truncate text-sm", owner ? "text-slate-600" : "text-slate-400")} title={owner?.role === "intern" && internName ? `${internName} (${owner.full_name})` : undefined}>{ownerLabel}</span>}
      {!compact && owner?.role === "intern" && <InternTag />}
    </>
  );
  if (disabled) return <div className="flex min-w-0 items-center gap-2">{face}</div>;
  let firstOther = -1;
  return (
    <div className="relative min-w-0" ref={box}>
      <button type="button" aria-label={owner ? `Owner: ${ownerLabel}. Change owner` : "Assign an owner"} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); toggle(e.currentTarget); }}
        className={cx("flex max-w-full min-w-0 items-center gap-2 rounded-lg",
          field ? "w-full bg-white px-2.5 py-[5px] ring-1 ring-slate-300 hover:ring-slate-400" : "-mx-1 px-1 py-0.5 hover:bg-slate-100 hover:ring-1 hover:ring-slate-300")}>
        {face}
        {field && <ChevronDown className="ml-auto size-4 shrink-0 text-slate-500" />}
      </button>
      {open && (
        <div style={pos} className="z-[60] w-64 rounded-xl bg-white p-2 shadow-pop ring-1 ring-line">
          {askFor ? (
            <form onSubmit={(e) => { e.preventDefault(); assignIntern(); }} className="space-y-2 p-1">
              <div className="flex items-center gap-2">
                <Avatar person={askFor} size={22} />
                <span className="flex-1 truncate text-sm font-medium text-ink">{askFor.full_name}</span>
                <InternTag />
              </div>
              <label className="block text-[13px] font-medium text-slate-600" htmlFor="intern-name">Which intern is this for?</label>
              <input id="intern-name" autoFocus list="intern-names" value={name} placeholder="Intern's name" maxLength={60}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setAskFor(null); } }}
                className="h-8 w-full rounded-md bg-white px-2 text-sm text-ink ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-500 focus:outline-none" />
              <datalist id="intern-names">{pastNames.map((n) => <option key={n} value={n} />)}</datalist>
              {pastNames.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {pastNames.slice(0, 6).map((n) => (
                    <button key={n} type="button" onClick={() => setName(n)}
                      className={cx("rounded-full px-2 py-0.5 text-xs ring-1", n === name ? "bg-sky-500/10 text-sky-600 ring-sky-500/30" : "text-slate-600 ring-slate-300 hover:bg-slate-100")}>{n}</button>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setAskFor(null)} className="rounded-md px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-100">Back</button>
                <button type="submit" disabled={!name.trim()} className="rounded-md bg-cta px-3 py-1 text-sm font-medium text-on-accent disabled:opacity-50">Assign</button>
              </div>
            </form>
          ) : (<>
          <input autoFocus aria-label="Find a person" value={q} placeholder="Find a person"
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, options.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter" && options[hi] !== undefined) { e.preventDefault(); pick(options[hi]?.id ?? null); }
              else if (e.key === "Escape") setOpen(false);
            }}
            className="mb-1 h-8 w-full rounded-md bg-slate-100 px-2 text-sm text-ink focus:outline-none" />
          <div className="max-h-64 overflow-y-auto" role="listbox">
            {options.length === 0 && <p className="px-2 py-3 text-center text-sm text-slate-500">No one matches.</p>}
            {options.map((p, i) => {
              const header = p && !members.has(p.id) && firstOther < 0 && members.size > 0 ? (firstOther = i, true) : false;
              return (
                <div key={p?.id ?? "none"}>
                  {i === (value && !q ? 1 : 0) && p && members.has(p.id) && <p className="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-slate-400 uppercase">On this project</p>}
                  {header && <p className="px-2 pt-2 pb-0.5 text-[11px] font-semibold text-slate-400 uppercase">Everyone else</p>}
                  <button type="button" role="option" aria-selected={p?.id === value} onMouseEnter={() => setHi(i)} onClick={() => pick(p?.id ?? null)}
                    className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === hi && "bg-slate-100")}>
                    {p ? <Avatar person={p} size={22} /> : <span className="size-[22px]" />}
                    <span className={cx("flex-1 truncate", p ? "text-ink" : "text-slate-500")}>{p ? p.full_name : "Remove owner"}</span>
                    {p?.role === "intern" && <InternTag />}
                    {p?.id === value && <Check className="size-4 text-brand-600" />}
                  </button>
                </div>
              );
            })}
          </div>
          </>)}
        </div>
      )}
    </div>
  );
}

function InternTag() {
  return <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 text-[10px] font-semibold text-sky-600 ring-1 ring-sky-500/30">Intern</span>;
}

/** A clickable cell that opens a small panel next to it (fixed position, so it isn't cut off by cards). */
export function QuickPopover({ label, trigger, disabled, children, width = 224 }: {
  label: string; trigger: ReactNode; disabled?: boolean; width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const close = (e: Event) => { if (!(e.target instanceof Node && box.current?.contains(e.target))) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", f);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", f); document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close);
    };
  }, [open]);
  if (disabled) return <>{trigger}</>;
  function toggle(btn: HTMLElement) {
    if (open) { setOpen(false); return; }
    const r = btn.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(window.innerHeight - r.bottom < 260 && r.top > 260
      ? { position: "fixed", left, bottom: window.innerHeight - r.top + 4, width }
      : { position: "fixed", left, top: r.bottom + 4, width });
    setOpen(true);
  }
  return (
    <div className="relative min-w-0" ref={box}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={(e) => { e.stopPropagation(); toggle(e.currentTarget); }}
        className="-mx-1 flex max-w-full min-w-0 items-center rounded-lg px-1 py-0.5 hover:bg-slate-100 hover:ring-1 hover:ring-slate-300">
        {trigger}
      </button>
      {open && <div style={pos} className="z-[60] rounded-xl bg-white p-1.5 shadow-pop ring-1 ring-line">{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** One choice inside a QuickPopover list. */
export function QuickOption({ selected, onClick, children }: { selected?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-slate-100">
      <span className="flex-1">{children}</span>
      {selected && <Check className="size-4 text-brand-600" />}
    </button>
  );
}
