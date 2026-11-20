# Putting Idea2Launch online

This takes about 15 minutes and uses only free plans. You need three accounts: **GitHub** (the code is already there), **Supabase** (database, logins and files) and **Vercel** (the website).

You never need to paste a password or secret key into a chat. Everything goes straight into Supabase or Vercel.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> and click **New project**.
2. Name it `idea2launch`, choose a strong database password (save it in your password manager) and pick the region closest to your team (for Sri Lanka or India, choose **Mumbai** or **Singapore**).
3. Wait about two minutes until the project is ready.

## 2. Create the database

1. In the left menu open **SQL Editor** and click **New query**.
2. Open [`supabase/setup.sql`](supabase/setup.sql) on GitHub, click **Copy raw file**, and paste everything into the editor.
3. Click **Run**. You should see "Success. No rows returned".

This creates all tables, the permission rules for the five roles, and a private file store for attachments (10 MB per file).

## 3. Turn off public sign-up

People should only get in when an Admin creates their account.

1. Open **Authentication → Sign In / Providers**.
2. Turn **off** "Allow new users to sign up" and click **Save**.
3. Leave the **Email** provider turned on. Usernames are stored as `username@idea2launch.local`; nobody needs a real e-mail address.

## 4. Create your own Admin account

1. Open **Authentication → Users → Add user → Create new user**.
2. E-mail: `yash@idea2launch.local` (your username, then `@idea2launch.local`).
3. Password: choose one (at least 8 characters).
4. Tick **Auto Confirm User** and click **Create user**.

The first account ever created automatically becomes **Admin**. You will sign in with the username `yash`.

## 5. Add the user-management function

The Admin panel uses a small server function to create people and reset passwords.

1. Open **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `admin-users`.
3. Delete the sample code, then paste everything from [`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts).
4. Click **Deploy function**.
5. Open the function's **Details** (or **Settings**) tab, turn **off** "Verify JWT with legacy secret" / "Enforce JWT verification", and save. The function checks that the caller is an active Admin itself.

## 6. Copy two values for the website

Open **Project Settings → Data API / API Keys** and copy:

- **Project URL**, for example `https://abcdefgh.supabase.co`
- The **anon / publishable** key (never the `service_role` or secret key)

## 7. Put the website on Vercel

1. Go to <https://vercel.com/new> and import the GitHub repository **ayyaash/idea2launch**.
2. Vercel detects **Vite** automatically. Leave the build settings as they are.
3. Open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = the Project URL from step 6
   - `VITE_SUPABASE_ANON_KEY` = the anon / publishable key from step 6
4. Click **Deploy**. After about a minute you get a link like `https://idea2launch.vercel.app`.

Every time new code is pushed to the `main` branch, Vercel updates the site by itself.

## 8. First sign-in

1. Open your Vercel link and sign in with username `yash` and your password.
2. Go to **Admin panel → Categories** and add your project categories.
3. Go to **Admin panel → People → Add person** for each team member. After each one, the app shows the sign-in details to send them privately.
4. Check **Admin panel → Settings**: the overload limit (25), the largest attachment (10 MB), the week start day and the default phases for new projects.

On phones, people can open the link and use **Add to Home Screen** so it opens like an app.

---

## Good to know about the free plans

- **Supabase free projects pause after 7 days with no activity.** With a team using it daily this won't happen. If it does, open the Supabase dashboard and click **Restore**; no data is lost.
- Free limits: 500 MB of database (plenty for many years of tasks) and 1 GB of file storage for attachments.
- Supabase makes daily backups only on paid plans. Use **Excel** on the dashboard now and then to keep your own copy.

## Updating the database later

When a new feature needs database changes, a new file appears in `supabase/migrations/`. Run only that new file in the **SQL Editor**, the same way as in step 2.

## Running it on a computer (developers)

```bash
npm install
npx supabase start                # local database, needs Docker
npx supabase functions serve      # in a second terminal
cp .env.example .env.local        # fill in the local URL and anon key from `npx supabase status`
npm run seed:demo                 # optional demo people, projects and tasks (password Passw0rd!)
npm run dev
```

Tests for the database permission rules: `SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:backend`.
