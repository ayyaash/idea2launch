import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

export const supabase = createClient(url || "http://localhost:54321", key || "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "idea2launch-auth" },
});

/** People sign in with a username; Supabase Auth stores it as a private e-mail-shaped login. */
export const LOGIN_DOMAIN = "idea2launch.local";
export const usernameToLogin = (username: string) => `${username.trim().toLowerCase().replace(/@.*$/, "")}@${LOGIN_DOMAIN}`;

/** Supabase returns at most 1000 rows per request; page through everything. */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

export function errorText(e: unknown): string {
  if (!e) return "Something went wrong";
  if (typeof e === "string") return e;
  if (e instanceof Error) return friendly(e.message);
  if (typeof e === "object" && "message" in e) return friendly(String((e as { message: unknown }).message));
  return "Something went wrong";
}

function friendly(msg: string) {
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (/duplicate key.*projects_code/i.test(msg)) return "That project code is already used.";
  if (/duplicate key.*categories_name/i.test(msg)) return "A category with that name already exists.";
  if (/Invalid login credentials/i.test(msg)) return "Wrong username or password.";
  if (/task_dates|project_dates/i.test(msg)) return "The end date must be on or after the start date.";
  if (/exceeded the maximum allowed size|Payload too large/i.test(msg)) return "That file is too big.";
  return msg;
}
