-- PostgreSQL requires a commit after adding an enum value before policies/functions use it.
alter type public.app_role add value if not exists 'pseudo_admin';
