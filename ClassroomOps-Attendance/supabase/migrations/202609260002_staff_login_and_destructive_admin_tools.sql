create or replace function public.is_full_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and deleted_at is null
  );
$$;

-- Existing operational RLS policies and biometric RPCs call is_admin().
-- Treat pseudo admins as staff for attendance, marks, issues, audit and biometrics.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'pseudo_admin') and deleted_at is null
  );
$$;

-- Keep identity, approval, roster and course mutation exclusive to full admins.
drop policy if exists "admin writes profiles" on public.profiles;
create policy "full admin writes profiles" on public.profiles
for all using (public.is_full_admin()) with check (public.is_full_admin());

drop policy if exists "admin manages memberships" on public.course_memberships;
create policy "full admin manages memberships" on public.course_memberships
for all using (public.is_full_admin()) with check (public.is_full_admin());

drop policy if exists "admin manages courses" on public.courses;
create policy "full admin manages courses" on public.courses
for all using (public.is_full_admin()) with check (public.is_full_admin());

-- Supabase password auth requires an email, so resolve a submitted student ID first.
create or replace function public.resolve_login_email(p_identifier text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email
  from public.profiles
  where deleted_at is null
    and (
      lower(btrim(email)) = lower(btrim(p_identifier))
      or lower(btrim(student_id)) = lower(btrim(p_identifier))
    )
  limit 1;
$$;
revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

create or replace function public.set_delegated_role(p_profile_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_full_admin() then
    raise exception 'Full administrator access is required';
  end if;
  if p_role not in ('student', 'pseudo_admin') then
    raise exception 'Role must be student or pseudo_admin';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'You cannot change your own administrator role here';
  end if;

  update public.profiles
  set role = p_role::public.app_role,
      approval_status = case when p_role = 'pseudo_admin' then 'approved' else approval_status end,
      approved_at = case when p_role = 'pseudo_admin' then coalesce(approved_at, now()) else approved_at end,
      approved_by = case when p_role = 'pseudo_admin' then auth.uid() else approved_by end
  where id = p_profile_id and role <> 'admin';

  if not found then
    raise exception 'Eligible profile was not found';
  end if;
end;
$$;
revoke all on function public.set_delegated_role(uuid, text) from public;
grant execute on function public.set_delegated_role(uuid, text) to authenticated;

-- Remove FK-linked application data before auth.admin.deleteUser removes auth + profile.
create or replace function public.prepare_student_permanent_deletion(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_full_admin() then
    raise exception 'Full administrator access is required';
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'student') then
    raise exception 'Only student accounts can be permanently deleted';
  end if;

  delete from public.student_issues where student_id = p_student_id;
  delete from public.mark_component_scores where student_id = p_student_id;
  delete from public.marks where student_id = p_student_id;
  delete from public.attendance_records where student_id = p_student_id;
  delete from public.face_embeddings where student_id = p_student_id;
  delete from public.face_enrollment_frames where student_id = p_student_id;
  delete from public.face_enrollments where student_id = p_student_id;
  delete from public.course_memberships where student_id = p_student_id;

  update public.profiles set approved_by = null where approved_by = p_student_id;
  update public.lecture_sessions set started_by = null where started_by = p_student_id;
  update public.marks set updated_by = null where updated_by = p_student_id;
  update public.mark_component_scores set updated_by = null where updated_by = p_student_id;
  update public.student_issues set resolved_by = null where resolved_by = p_student_id;
  update public.face_embeddings set created_by = null where created_by = p_student_id;
  update public.announcements set created_by = null where created_by = p_student_id;
  update public.imports set created_by = null where created_by = p_student_id;
  -- Audit triggers fire for attendance/mark/issue deletion. Remove those generated
  -- entries too, so no database JSON snapshot retains the student's UUID or data.
  delete from public.audit_logs
  where actor_id = p_student_id
     or entity_id = p_student_id
     or coalesce(old_value::text, '') like '%' || p_student_id::text || '%'
     or coalesce(new_value::text, '') like '%' || p_student_id::text || '%';
end;
$$;
revoke all on function public.prepare_student_permanent_deletion(uuid) from public;
grant execute on function public.prepare_student_permanent_deletion(uuid) to authenticated;

-- Required fields for every newly joining student. This replaces the trigger that
-- previously surfaced an opaque "Database error saving new user" response.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_student_id text := nullif(btrim(new.raw_user_meta_data->>'student_id'), '');
  requested_name text := nullif(btrim(new.raw_user_meta_data->>'full_name'), '');
  requested_phone text := nullif(btrim(new.raw_user_meta_data->>'phone'), '');
begin
  if requested_student_id is null or requested_name is null or requested_phone is null or new.email is null then
    raise exception 'Name, student ID, phone and institutional email are required';
  end if;
  if exists (select 1 from public.profiles where lower(btrim(student_id)) = lower(requested_student_id)) then
    raise exception 'Student ID is already registered';
  end if;

  insert into public.profiles (id, role, full_name, student_id, email, phone, approval_status)
  values (new.id, 'student', requested_name, requested_student_id, lower(btrim(new.email)), requested_phone, 'pending');
  return new;
exception
  when unique_violation then
    raise exception 'Student ID or email is already registered';
end;
$$;
