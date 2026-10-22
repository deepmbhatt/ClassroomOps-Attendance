-- Show scheduled in-app exams to enrolled students while checking attendance
-- again at the moment an attempt starts. Staff may explicitly waive attendance.
alter table public.native_exams
  add column allow_without_attendance boolean not null default false,
  add constraint native_exam_attendance_override_no_code
    check (not allow_without_attendance or code_mode = 'none');

create function public.native_exam_attendance_override_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.allow_without_attendance is distinct from old.allow_without_attendance
    and exists (select 1 from public.native_exam_attempts where exam_id = old.id) then
    raise exception 'Attendance access is locked after the first attempt';
  end if;
  return new;
end;
$$;
create trigger native_exam_attendance_override_check
before update on public.native_exams for each row
execute function public.native_exam_attendance_override_guard();
revoke all on function public.native_exam_attendance_override_guard() from public;

create policy "enrolled students read scheduled native exams" on public.native_exams
for select to authenticated using (
  status = 'open' and not review_only
  and exists (
    select 1 from public.profiles p
    join public.course_memberships m on m.student_id = p.id
      and m.course_id = native_exams.course_id and m.deleted_at is null
    where p.id = auth.uid() and p.role = 'student'
      and p.approval_status = 'approved' and p.deleted_at is null
  )
);

create or replace function public.native_start_exam(p_exam_id uuid, p_entry_code text)
returns public.native_exam_attempts
language plpgsql security definer set search_path = public as $$
declare
  exam_row public.native_exams%rowtype;
  result public.native_exam_attempts%rowtype;
  face_code public.native_exam_face_codes%rowtype;
begin
  if not public.is_current_app_session_request() then raise exception 'This device session is no longer active'; end if;
  select * into exam_row from public.native_exams where id = p_exam_id;
  if exam_row.id is null then raise exception 'Exam not found'; end if;
  select * into result from public.native_exam_attempts
    where exam_id = p_exam_id and student_id = auth.uid() for update;
  if result.id is not null then return result; end if;
  if exam_row.review_only or exam_row.status <> 'open' or now() < exam_row.starts_at or now() >= exam_row.ends_at then
    raise exception 'The exam is not open';
  end if;
  if not exists (
    select 1 from public.profiles p
    join public.course_memberships m on m.student_id = p.id and m.course_id = exam_row.course_id and m.deleted_at is null
    where p.id = auth.uid() and p.role = 'student' and p.approval_status = 'approved' and p.deleted_at is null
  ) then raise exception 'Your account is not approved for this course'; end if;
  if exam_row.allow_without_attendance then
    -- Enrollment and exam time still apply; only attendance and its code are waived.
    null;
  elsif exam_row.attendance_session_id is not null then
    if not public.native_has_face_attendance(p_exam_id, auth.uid()) then
      raise exception 'Face-verified attendance is required for this exam';
    end if;
    if exam_row.code_mode <> 'none' then
      select * into face_code from public.native_exam_face_codes
      where lecture_id = exam_row.attendance_session_id and student_id = auth.uid() for update;
      if face_code.code is null then raise exception 'Ask staff to issue your attendance code'; end if;
      if face_code.entry_locked_until > now() then return null; end if;
      if p_entry_code is distinct from face_code.code then
        update public.native_exam_face_codes set
          entry_failures = case when entry_locked_until < now() then 1 else entry_failures + 1 end,
          entry_locked_until = case when entry_locked_until < now() then null
            when entry_failures + 1 >= 5 then now() + interval '15 minutes' else null end
        where lecture_id = face_code.lecture_id and student_id = face_code.student_id;
        return null;
      end if;
      update public.native_exam_face_codes set entry_failures = 0, entry_locked_until = null
      where lecture_id = face_code.lecture_id and student_id = face_code.student_id;
    end if;
  elsif not exists (select 1 from public.native_exam_access
    where exam_id = p_exam_id and student_id = auth.uid()) then
    raise exception 'Your exam access has not been approved';
  end if;
  if not exists (select 1 from public.native_exam_questions where exam_id = p_exam_id) then
    raise exception 'This exam has no questions';
  end if;
  insert into public.native_exam_attempts (exam_id, student_id, deadline_at)
  values (p_exam_id, auth.uid(), least(now() + make_interval(mins => exam_row.duration_minutes), exam_row.ends_at))
  on conflict (exam_id, student_id) do nothing;
  select * into result from public.native_exam_attempts
    where exam_id = p_exam_id and student_id = auth.uid();
  return result;
end;
$$;

revoke all on function public.native_start_exam(uuid, text) from public;
grant execute on function public.native_start_exam(uuid, text) to authenticated;
