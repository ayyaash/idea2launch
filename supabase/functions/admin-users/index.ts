// Idea2Launch admin user management.
// Only active Admins can call this. It creates people with a username + password,
// resets passwords, changes roles, and activates / deactivates accounts.
// No external imports: it talks to Supabase's REST endpoints directly, so it
// can be pasted straight into the Supabase dashboard's function editor.

const LOGIN_DOMAIN = "idea2launch.local";
const ROLES = ["admin", "manager", "coordinator", "member", "intern", "viewer"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

type Json = Record<string, unknown>;

function serviceApi() {
  const base = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.split(".").length === 3) headers.Authorization = `Bearer ${key}`;

  async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = data?.msg ?? data?.message ?? data?.error_description ?? data?.error ?? `HTTP ${res.status}`;
      throw new Error(String(msg));
    }
    return { data, res };
  }

  return {
    async userFromToken(token: string) {
      const res = await fetch(base + "/auth/v1/user", { headers: { apikey: key, Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return (await res.json()) as { id: string };
    },
    async profile(id: string) {
      const { data } = await call("GET", `/rest/v1/profiles?id=eq.${id}&select=id,role,is_active,username`);
      return (data as Json[])[0] ?? null;
    },
    async usernameTaken(username: string) {
      const { data } = await call("GET", `/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id`);
      return (data as Json[]).length > 0;
    },
    async activeAdminCount() {
      const { res } = await call("HEAD", `/rest/v1/profiles?role=eq.admin&is_active=eq.true&select=id`, undefined,
        { Prefer: "count=exact" });
      return Number((res.headers.get("content-range") ?? "*/0").split("/")[1]);
    },
    async updateProfile(id: string, patch: Json) {
      await call("PATCH", `/rest/v1/profiles?id=eq.${id}`, patch, { Prefer: "return=minimal" });
    },
    async createUser(body: Json) {
      const { data } = await call("POST", "/auth/v1/admin/users", body);
      return data as { id: string };
    },
    async updateUser(id: string, body: Json) {
      await call("PUT", `/auth/v1/admin/users/${id}`, body);
    },
    async deleteUser(id: string) {
      await call("DELETE", `/auth/v1/admin/users/${id}`);
    },
  };
}

function cleanUsername(raw: unknown) {
  return String(raw ?? "").trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);

  const api = serviceApi();

  // Who is calling?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return reply({ error: "Not signed in" }, 401);
  const caller = await api.userFromToken(token);
  if (!caller?.id) return reply({ error: "Not signed in" }, 401);
  const me = await api.profile(caller.id);
  if (!me || me.role !== "admin" || !me.is_active) {
    return reply({ error: "Only an admin can manage users" }, 403);
  }

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid request" }, 400);
  }
  const action = String(body.action ?? "");

  try {
    if (action === "create") {
      const username = cleanUsername(body.username);
      const password = String(body.password ?? "");
      const role = String(body.role ?? "member");
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        return reply({ error: "Username must be 3–32 characters: letters, numbers, dot, dash or underscore" }, 400);
      }
      if (password.length < 8) return reply({ error: "Password must be at least 8 characters" }, 400);
      if (!ROLES.includes(role)) return reply({ error: "Unknown role" }, 400);
      if (await api.usernameTaken(username)) {
        return reply({ error: `The username "${username}" is already taken` }, 409);
      }
      const user = await api.createUser({
        email: `${username}@${LOGIN_DOMAIN}`,
        password,
        email_confirm: true,
        user_metadata: {
          username,
          full_name: String(body.full_name ?? "").trim() || username,
          job_title: String(body.job_title ?? "").trim(),
        },
      });
      // set role explicitly (new accounts default to member); they choose their own password at first sign-in
      await api.updateProfile(user.id, { role, must_change_password: true });
      return reply({ ok: true, id: user.id });
    }

    const userId = String(body.user_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return reply({ error: "user_id is required" }, 400);

    if (action === "reset_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return reply({ error: "Password must be at least 8 characters" }, 400);
      await api.updateUser(userId, { password });
      // the person must choose a new password the next time they sign in
      if (userId !== caller.id) await api.updateProfile(userId, { must_change_password: true });
      return reply({ ok: true });
    }

    if (action === "update") {
      const patch: Json = {};
      if (typeof body.full_name === "string") patch.full_name = body.full_name.trim();
      if (typeof body.job_title === "string") patch.job_title = body.job_title.trim();
      if (typeof body.role === "string") {
        if (!ROLES.includes(body.role)) return reply({ error: "Unknown role" }, 400);
        patch.role = body.role;
      }
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      if (userId === caller.id && ((patch.role && patch.role !== "admin") || patch.is_active === false)) {
        return reply({ error: "You can't remove your own admin access" }, 400);
      }
      if (Object.keys(patch).length) await api.updateProfile(userId, patch);
      if (typeof body.is_active === "boolean") {
        // A deactivated person can no longer sign in.
        await api.updateUser(userId, { ban_duration: body.is_active ? "none" : "876000h" });
      }
      return reply({ ok: true });
    }

    if (action === "delete") {
      if (userId === caller.id) return reply({ error: "You can't delete yourself" }, 400);
      const target = await api.profile(userId);
      if (target?.role === "admin" && (await api.activeAdminCount()) <= 1) {
        return reply({ error: "At least one active admin is required" }, 400);
      }
      await api.deleteUser(userId);
      return reply({ ok: true });
    }

    return reply({ error: "Unknown action" }, 400);
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
