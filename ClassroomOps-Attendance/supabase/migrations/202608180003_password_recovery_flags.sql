-- Track temporary-password accounts so first login must change password.

alter table public.profiles
add column if not exists must_change_password boolean not null default false;
