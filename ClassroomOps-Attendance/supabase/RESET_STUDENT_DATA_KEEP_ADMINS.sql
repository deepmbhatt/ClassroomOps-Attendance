-- ONE-TIME DESTRUCTIVE RESET
--
-- This file permanently removes all student accounts and student-linked data.
-- It preserves every profile whose role is "admin", including the expected
-- administrator 202511015@dau.ac.in.
--
-- IMPORTANT: First empty the private "face-frames" bucket from Storage in the
-- Supabase Dashboard. Auth users that still own Storage objects cannot be deleted.
-- Then review the preview query below before running the whole file.

-- Preview the exact Auth accounts that will be removed.
select
  account.id,
  account.email,
  profile.full_name,
  profile.student_id,
  profile.role
from auth.users account
left join public.profiles profile on profile.id = account.id
where profile.role is distinct from 'admin'::public.app_role
order by account.email;

begin;

do $reset$
declare
  expected_admin_email constant text := '202511015@dau.ac.in';
  admin_count integer;
  student_account_count integer;
begin
  if exists (
    select 1 from storage.objects where bucket_id = 'face-frames'
  ) then
    raise exception 'Reset aborted: empty the face-frames Storage bucket first.';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.role = 'admin'
      and lower(account.email) = lower(expected_admin_email)
  ) then
    raise exception 'Reset aborted: expected admin % is not an admin profile/Auth account pair.',
      expected_admin_email;
  end if;

  select count(*)
  into admin_count
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.role = 'admin';

  create temporary table student_accounts_to_reset (
    id uuid primary key
  ) on commit drop;

  -- Include every student profile and every Auth account not backed by an admin.
  insert into student_accounts_to_reset (id)
  select profile.id
  from public.profiles profile
  where profile.role = 'student'
  union
  select account.id
  from auth.users account
  left join public.profiles profile on profile.id = account.id
  where profile.role is distinct from 'admin'::public.app_role;

  select count(*) into student_account_count from student_accounts_to_reset;

  -- Preserve shared courses, assessments, mark definitions, lectures, and announcements.
  update public.lecture_sessions
  set started_by = null
  where started_by in (select id from student_accounts_to_reset);

  update public.announcements
  set created_by = null
  where created_by in (select id from student_accounts_to_reset);

  update public.profiles
  set approved_by = null
  where approved_by in (select id from student_accounts_to_reset);

  -- Clear biometric and all student-linked operational/academic data.
  delete from public.face_embeddings;
  delete from public.face_enrollment_frames;
  delete from public.face_enrollments;
  delete from public.attendance_records;
  delete from public.mark_component_scores;
  delete from public.marks;
  delete from public.course_memberships;
  delete from public.student_issues;
  delete from public.imports;
  delete from public.audit_logs;

  -- Removing Auth users prevents deleted students from signing in again.
  -- The profiles FK cascades for normal Auth-backed profiles.
  delete from auth.users
  where id in (select id from student_accounts_to_reset);

  -- Remove any orphan student profiles that had no Auth row.
  delete from public.profiles
  where role = 'student'
     or id in (select id from student_accounts_to_reset);

  if exists (select 1 from public.face_embeddings) then
    raise exception 'Reset verification failed: face embeddings remain.';
  end if;

  if exists (select 1 from public.profiles where role = 'student') then
    raise exception 'Reset verification failed: student profiles remain.';
  end if;

  if exists (
    select 1
    from auth.users account
    left join public.profiles profile on profile.id = account.id
    where profile.role is distinct from 'admin'::public.app_role
  ) then
    raise exception 'Reset verification failed: non-admin Auth accounts remain.';
  end if;

  raise notice 'Reset complete: % non-admin account(s) removed; % admin account(s) preserved.',
    student_account_count,
    admin_count;
end;
$reset$;

commit;

-- Both student counts and all biometric counts must be zero.
select
  (select count(*) from public.profiles where role = 'admin') as admins_preserved,
  (select count(*) from public.profiles where role = 'student') as student_profiles_remaining,
  (
    select count(*)
    from auth.users account
    left join public.profiles profile on profile.id = account.id
    where profile.role is distinct from 'admin'::public.app_role
  ) as non_admin_auth_accounts_remaining,
  (select count(*) from public.face_embeddings) as face_embeddings_remaining,
  (select count(*) from public.face_enrollments) as face_enrollments_remaining,
  (select count(*) from public.face_enrollment_frames) as face_frame_records_remaining;

-- Never delete directly from storage.objects. Emptying the bucket through the
-- Storage UI/API removes both metadata and the underlying stored files.
