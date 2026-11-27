import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Cake, PartyPopper } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useStore } from "../lib/store";
import { supabase, errorText } from "../lib/supabase";
import { daysSinceBirthday, inBirthdayWeek } from "../lib/birthdays";
import { Button, Modal } from "./ui";
import { BirthdayField, birthdayError } from "./BirthdayField";
import { useToast } from "./Toast";

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** Asks people who signed up before birthdays existed for theirs, once. */
export function BirthdayPrompt() {
  const { me, reloadMe } = useAuth();
  const store = useStore();
  const toast = useToast();
  const [bm, setBm] = useState<number | null>(null);
  const [bd, setBd] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (!me || me.birthday_asked || me.must_change_password || hidden) return null;

  async function save(skip: boolean) {
    const be = skip ? "" : birthdayError(bm, bd);
    if (be) return toast.error(be);
    setBusy(true);
    const { error } = await supabase.from("profiles")
      .update(skip ? { birthday_asked: true } : { birth_month: bm, birth_day: bd, birthday_asked: true }).eq("id", me!.id);
    setBusy(false);
    if (error) return toast.error(errorText(error));
    setHidden(true);
    if (!skip && bm) toast.success("Thanks! It's on the Birthdays calendar.");
    reloadMe(); store.refresh();
  }
  return (
    <Modal open onClose={() => save(true)} title="When's your birthday?"
      footer={<>
        <Button onClick={() => save(true)} disabled={busy}>Skip</Button>
        <Button variant="primary" loading={busy} disabled={!bm || !bd} onClick={() => save(false)}>Save</Button>
      </>}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-pink-500/10 text-pink-500"><Cake className="size-5" /></span>
        <div className="flex-1 space-y-3">
          <p className="text-sm text-slate-600">We've added a team Birthdays calendar. Add your day and month so we can celebrate. No year needed, and you can change it later in My account.</p>
          <BirthdayField month={bm} day={bd} onChange={(m, d) => { setBm(m); setBd(d); }} />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------ celebration ------------------------------ */

const BALLOONS = ["fill-rose-400", "fill-amber-300", "fill-sky-400", "fill-emerald-400", "fill-violet-400", "fill-pink-400", "fill-orange-400"];
const CONFETTI = ["bg-rose-400", "bg-amber-300", "bg-sky-400", "bg-emerald-400", "bg-violet-400", "bg-pink-400", "bg-orange-400"];

function Balloon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 60 110" className="h-full w-full drop-shadow-lg" aria-hidden>
      <ellipse cx="30" cy="30" rx="24" ry="29" className={color} />
      <ellipse cx="21" cy="19" rx="5" ry="9" fill="white" opacity="0.35" transform="rotate(-20 21 19)" />
      <path d="M26 58 L34 58 L30 64 Z" className={color} />
      <path d="M30 64 C 24 75, 36 85, 30 96 S 26 105, 30 110" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-slate-400" />
    </svg>
  );
}

/** Full-screen "Happy birthday" on the person's birthday week (birthday + 6 days), once a day. */
export function BirthdayOverlay({ force, onDone }: { force?: boolean; onDone?: () => void }) {
  const { me } = useAuth();
  const today = format(new Date(), "yyyy-MM-dd");
  const key = me ? `i2l.bday.${me.id}.${today}` : "";
  const due = !!me && !me.must_change_password && inBirthdayWeek(me) && !read(key);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (force || due) setOpen(true); }, [force, due]);

  const pieces = useMemo(() => Array.from({ length: 60 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 4, dur: 3.5 + Math.random() * 3, color: CONFETTI[i % CONFETTI.length],
    w: 6 + Math.random() * 6, round: i % 3 === 0,
  })), []);
  const balloons = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    left: (i * 7.3 + Math.random() * 4) % 96, delay: Math.random() * 5, dur: 9 + Math.random() * 6, size: 56 + Math.random() * 40,
    color: BALLOONS[i % BALLOONS.length], sway: 2.5 + Math.random() * 2,
  })), []);

  if (!open || !me) return null;
  const close = () => { if (key) write(key, "1"); setOpen(false); onDone?.(); };
  const days = daysSinceBirthday(me) ?? 0;
  const first = me.full_name.split(" ")[0] || me.full_name;

  return (
    <div role="dialog" aria-modal="true" aria-label="Happy birthday" className="fixed inset-0 z-[90] overflow-hidden" onClick={close}>
      <div className="absolute inset-0 bg-gradient-to-b from-deep/85 via-deep/75 to-deep/90 backdrop-blur-[2px]" />
      {/* bunting */}
      <svg className="absolute inset-x-0 top-0 h-20 w-full" viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden>
        <path d="M0 6 Q 500 60 1000 6" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-200" />
        {Array.from({ length: 20 }, (_, i) => {
          const x = 25 + i * 50, y = 6 + 54 * (1 - Math.pow((x - 500) / 500, 2)) * 0.98;
          return <path key={i} d={`M${x - 16} ${y - 2} L${x + 16} ${y - 2} L${x} ${y + 26} Z`} className={BALLOONS[i % BALLOONS.length]} />;
        })}
      </svg>
      {/* confetti */}
      {pieces.map((p, i) => (
        <span key={i} className={`bday-confetti absolute top-0 ${p.color} ${p.round ? "rounded-full" : "rounded-[2px]"}`}
          style={{ left: `${p.left}%`, width: p.w, height: p.round ? p.w : p.w * 1.8, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s` }} />
      ))}
      {/* balloons */}
      {balloons.map((b, i) => (
        <div key={i} className="bday-balloon absolute bottom-0" style={{ left: `${b.left}%`, width: b.size, height: b.size * 1.8, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s, ${b.sway}s` }}>
          <Balloon color={b.color} />
        </div>
      ))}
      {/* card */}
      <div className="absolute inset-0 grid place-items-center p-4">
        <div onClick={(e) => e.stopPropagation()} className="bday-pop relative w-full max-w-md rounded-3xl bg-white px-7 pt-10 pb-7 text-center shadow-pop ring-1 ring-line">
          <div className="absolute -top-9 left-1/2 grid size-[72px] -translate-x-1/2 place-items-center rounded-full bg-gradient-to-br from-pink-400 to-orange-400 text-white shadow-lg ring-4 ring-white">
            <Cake className="size-9" />
          </div>
          <p className="text-sm font-semibold tracking-wide text-pink-500 uppercase">{days === 0 ? "Today's your day" : `${days} day${days === 1 ? "" : "s"} ago was your day`}</p>
          <h2 className="mt-1 text-3xl font-extrabold text-ink">Happy birthday, {first}!</h2>
          <p className="mt-3 text-[15px] text-slate-600">Wishing you a wonderful year ahead, full of good ideas and great launches. From all of us on the team.</p>
          <Button variant="primary" className="mt-6" icon={<PartyPopper className="size-4" />} onClick={close}>Thank you!</Button>
        </div>
      </div>
    </div>
  );
}
