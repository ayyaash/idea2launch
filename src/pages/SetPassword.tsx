import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase, errorText } from "../lib/supabase";

/** Shown instead of the app until the person replaces the password their admin gave them. */
export default function SetPassword() {
  const { me, reloadMe, signOut } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) return setErr("Use at least 8 characters.");
    if (pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setBusy(false);
      return setErr(/different from the old/i.test(error.message)
        ? "Choose a password that's different from the one your admin gave you."
        : errorText(error));
    }
    const { error: e2 } = await supabase.rpc("password_changed");
    setBusy(false);
    if (e2) return setErr(errorText(e2));
    await reloadMe();
  }

  const field = "w-full rounded-lg px-3 py-2.5 ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-500 focus:outline-none";
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-navy-950 via-navy-900 to-navy-700 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-2xl">
        <img src="/logo.png" alt="Idea2Launch" className="mx-auto mb-5 h-16 w-auto" />
        <h1 className="text-lg font-semibold text-navy-900">Choose your own password</h1>
        <p className="mt-1 mb-5 text-sm text-slate-600">
          Welcome{me?.full_name ? `, ${me.full_name}` : ""}. You signed in with a password from your admin. Set a new one that only you know.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">New password</span>
            <input type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required className={field} />
            <span className="mt-1 block text-xs text-slate-500">At least 8 characters.</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Type it again</span>
            <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required className={field} />
          </label>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
          <button type="submit" disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 py-2.5 font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" />} Save and continue
          </button>
        </form>
        <button onClick={signOut} className="mt-4 w-full text-center text-xs text-slate-500 hover:text-slate-700">Sign out</button>
      </div>
    </div>
  );
}
