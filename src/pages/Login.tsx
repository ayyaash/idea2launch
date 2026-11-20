import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { isConfigured } from "../lib/supabase";
import { InstallApp } from "../components/InstallApp";

export default function Login() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const error = await signIn(username, password);
    setBusy(false);
    if (error) setErr(error);
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-navy-950 via-navy-900 to-navy-700 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-2xl">
        <img src="/logo.png" alt="Idea2Launch" className="mx-auto mb-6 h-20 w-auto" />
        {!isConfigured && (
          <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            The app isn't connected to its database yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see SETUP.md).
          </p>
        )}
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Username</span>
            <input autoFocus autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username}
              onChange={(e) => setUsername(e.target.value)} required
              className="w-full rounded-lg px-3 py-2.5 ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-500 focus:outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full rounded-lg px-3 py-2.5 ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-500 focus:outline-none" />
          </label>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
          <button type="submit" disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 py-2.5 font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" />} Sign in
          </button>
        </form>
        <p className="mt-5 text-center text-xs text-slate-500">Forgot your password? Ask your admin to reset it.</p>
        <InstallApp className="mt-3 justify-center" />
      </div>
    </div>
  );
}
