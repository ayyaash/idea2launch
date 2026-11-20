# Idea2Launch

**Innovate · Develop · Launch.** A project tracker for an R&D team of about 15 people.

- **Dashboard**: every project running in a year on a Jan–Dec timeline, grouped by category, plus KPIs for active projects, overdue tasks, tasks due this week and tasks done this month. Filters by category, status and lead.
- **Projects**: code, name, category, lead, status (Planning, Active, On hold, Completed, Cancelled), start and end dates, description, and the people on the project. Projects that run across years show on every year's dashboard.
- **Tasks**: name, owner plus optional collaborators, start and due dates, priority (High, Medium, Low) and status (To do, In progress, Review, Done). Tasks have subtasks, comments, file attachments (up to 10 MB) and dependencies ("can't start until X is done"). Any task can be copied into the same or another project, with its subtasks and comments.
- **Phases**: each project is split into phases such as Planning, Research, Development, Testing and Launch. Teams can rename, reorder and add phases.
- **Views**: a list grouped by phase or by status, a drag-and-drop board, a timeline, and a "My tasks" page.
- **Workload**: open tasks per person per week, with anyone over the limit (25 by default) flagged red.
- **Admin panel**: add people with a username and password, reset passwords, turn accounts off, change roles, and manage categories and settings.
- **Roles**: Admin, Manager, Project Coordinator, Member and Viewer. Everyone can see all projects; only people assigned to a project can edit it; Admins and Managers control every project.
- In-app notifications and Excel export.

Built with React, TypeScript and Tailwind CSS on Supabase (Postgres, Auth, Storage, Edge Functions), hosted on Vercel.

**To put it online, follow [SETUP.md](SETUP.md).**

## Project layout

| Path | What it is |
|---|---|
| `src/pages` | Screens: Dashboard, Projects, Project, My tasks, Workload, Admin, Account, Login |
| `src/components` | Task panel, task rows, pickers, layout, dialogs |
| `src/lib` | Supabase client, data store, permissions, dates, Excel export |
| `supabase/migrations` | Database schema and permission rules (row-level security) |
| `supabase/setup.sql` | All migrations in one file for first-time setup (`npm run build:sql`) |
| `supabase/functions/admin-users` | Server function for Admin user management |
| `tests/backend.test.mjs` | Permission and data-rule tests against a local Supabase |
| `tests/seed-demo.mjs` | Demo data for a local Supabase |
