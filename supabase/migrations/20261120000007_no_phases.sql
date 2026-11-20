-- Projects are just tasks and subtasks: no phases.
-- New projects no longer get default phases, and existing phases are removed
-- (their tasks stay in the project; only the phase grouping goes).
drop trigger if exists projects_default_phases on public.projects;
update public.app_settings set value = '[]'::jsonb where key = 'default_phases';
delete from public.project_sections;
