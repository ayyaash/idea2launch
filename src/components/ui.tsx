import {
  createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { X, Loader2 } from "lucide-react";
import { initials } from "../lib/format";
import type { Profile } from "../lib/types";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-cta text-white hover:bg-cta-hover shadow-sm shadow-cta/30",
  secondary: "bg-white text-slate-700 ring-1 ring-line hover:bg-slate-50 hover:ring-slate-300 shadow-card",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode;
}>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        size === "sm" ? "h-8 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]",
        VARIANT[variant], className)}
      {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label}
      className={cx("inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40", className)}
      {...rest}>
      {children}
    </button>
  );
}

const fieldBase = "rounded-lg border-0 bg-white px-3 py-[7px] text-sm text-ink ring-1 ring-line hover:ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-navy-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";

/** "field-quiet" in className: borderless until hovered or focused (property lists such as the task panel). */
const quietBase = "rounded-lg border-0 bg-transparent px-2 py-[7px] text-sm font-medium text-ink ring-1 ring-transparent hover:bg-slate-50 hover:ring-line placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-navy-400 focus:outline-none disabled:text-slate-600 disabled:hover:bg-transparent disabled:hover:ring-transparent";
const baseOf = (c?: string) => (c?.includes("field-quiet") ? quietBase : fieldBase);

/** Full width unless the caller sets its own width. */
const widthOf = (c?: string) => (c && /(^|\s)w-/.test(c) ? "" : "w-full");

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(baseOf(className), widthOf(className), className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(fieldBase, "min-h-20", widthOf(className), className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(baseOf(className), "pr-8", widthOf(className), className)} {...rest}>{children}</select>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-[12.5px] font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", className)}>{children}</span>;
}

export function Avatar({ person, size = 28, ring }: { person?: Profile | null; size?: number; ring?: boolean }) {
  const name = person?.full_name || person?.username || "Unassigned";
  return (
    <span title={name}
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none", ring && "ring-2 ring-white",
        !person && "bg-slate-200 text-slate-400")}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: person ? person.color : undefined }}>
      {person ? initials(name) : "–"}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 24 }: { people: (Profile | undefined)[]; max?: number; size?: number }) {
  const list = people.filter(Boolean) as Profile[];
  return (
    <span className="flex -space-x-1.5">
      {list.slice(0, max).map((p) => <Avatar key={p.id} person={p} size={size} ring />)}
      {list.length > max && (
        <span className="inline-flex items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 ring-2 ring-white"
          style={{ width: size, height: size }}>+{list.length - max}</span>
      )}
    </span>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={cx("flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-2xl", wide === "xl" ? "sm:max-w-4xl" : wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <IconButton label="Close" onClick={onClose}><X className="size-4" /></IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line-soft bg-slate-50/60 px-5 py-3 sm:rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <p className="font-medium text-slate-800">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Loader2 className="size-5 animate-spin text-brand-500" /> {label}…
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl bg-white shadow-card ring-1 ring-line", className)}>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; icon?: ReactNode }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold",
            value === t.id ? "border-brand-500 text-ink" : "border-transparent text-slate-500 hover:text-slate-800")}>
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
}

export function ColorPicker({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => onChange(c)}
          className={cx("size-7 rounded-full ring-offset-2", value === c && "ring-2 ring-slate-800")} style={{ background: c }} />
      ))}
    </div>
  );
}

/* ---- confirm dialog ---- */
interface ConfirmOpts { title: string; text?: string; confirm?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => {});
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((res) => { resolver.current = res; setOpts(o); }), []);
  const close = (v: boolean) => { resolver.current(v); setOpts(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!opts} onClose={() => close(false)} title={opts?.title ?? ""}
        footer={<>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant={opts?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>{opts?.confirm ?? "OK"}</Button>
        </>}>
        <p className="text-sm text-slate-600">{opts?.text}</p>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);
