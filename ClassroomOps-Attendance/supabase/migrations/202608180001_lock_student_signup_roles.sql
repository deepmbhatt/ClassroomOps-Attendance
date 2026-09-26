-- Lock down signup/profile role behavior for existing Supabase projects.
-- New app signups are always students; admins must be promoted explicitly from SQL.

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, student_id, email, phone)
  values (
    new.id,
    'student',
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'student_id', 'STU-' || left(new.id::text, 8)),
    new.email,
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop policy if exists "student creates own profile" on public.profiles;
drop policy if exists "student updates own consent" on public.profiles;
drop policy if exists "student updates own profile" on public.profiles;

create policy "student creates own profile"
on public.profiles
for insert
with check (id = auth.uid() and role = 'student');

create policy "student updates own profile"
on public.profiles
for update
using (id = auth.uid() and role = 'student')
with check (id = auth.uid() and role = 'student');
