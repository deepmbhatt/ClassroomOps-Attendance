-- Finalize a lecture atomically so every enrolled student has one attendance row.
create or replace function public.close_lecture_session_with_absences(p_lecture_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can finalize attendance.';
  end if;

  if not exists (select 1 from public.lecture_sessions where id = p_lecture_id) then
    raise exception 'Lecture session was not found.';
  end if;

  insert into public.attendance_records (
    lecture_id, student_id, status, source, reason, marked_by, marked_at
  )
  select
    session.id,
    membership.student_id,
    'absent'::public.attendance_status,
    'manual',
    'Automatically marked absent when the session was finalized.',
    auth.uid(),
    now()
  from public.lecture_sessions session
  join public.course_memberships membership
    on membership.course_id = session.course_id
   and membership.deleted_at is null
  join public.profiles profile
    on profile.id = membership.student_id
   and profile.role = 'student'::public.app_role
   and profile.deleted_at is null
   and profile.approval_status = 'approved'
  where session.id = p_lecture_id
  on conflict (lecture_id, student_id) do nothing;

  get diagnostics inserted_count = row_count;

  update public.lecture_sessions
  set status = 'closed', ended_at = now()
  where id = p_lecture_id;

  return inserted_count;
end;
$$;

revoke all on function public.close_lecture_session_with_absences(uuid) from public;
grant execute on function public.close_lecture_session_with_absences(uuid) to authenticated;
