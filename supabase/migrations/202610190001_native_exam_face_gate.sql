-- Optional four-digit checks are additional controls, never a substitute for
-- the authenticated student account and a face-sourced attendance record.
alter table public.native_exams
  add column attendance_session_id uuid references public.lecture_sessions(id),
  add column code_mode text not null default 'none' check (code_mode in ('none', 'entry', 'entry_exit')),
  add column exit_transform text not null default 'reverse' check (exit_transform in ('reverse', 'add', 'subtract')),
  add column exit_operand integer not null default 0 check (exit_operand between 0 and 9999);
alter table public.native_exams
  add constraint native_exam_code_requires_face_session check (code_mode = 'none' or attendance_session_id is not null);

alter table public.native_exam_attempts
  add column exit_code_verified boolean not null default false;

create function public.native_exam_validate_face_session() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.attendance_session_id is not null and not exists (
    select 1 from public.lecture_sessions
    where id = new.attendance_session_id and course_id = new.course_id
  ) then raise exception 'Attendance session must belong to the exam course'; end if;
  if tg_op = 'UPDATE' then
    if exists (select 1 from public.native_exam_attempts where exam_id = old.id)
      and (new.attendance_session_id is distinct from old.attendance_session_id
        or new.course_id is distinct from old.course_id or new.code_mode is distinct from old.code_mode) then
      raise exception 'Course, attendance session and code mode are locked after the first attempt';
    end if;
  end if;
  return new;
end;
$$;
create trigger native_exam_face_session_check before insert or update on public.native_exams
for each row execute function public.native_exam_validate_face_session();

create table public.native_exam_face_codes (
  lecture_id uuid not null references public.lecture_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{4}$'),
  entry_failures integer not null default 0,
  entry_locked_until timestamptz,
  exit_failures integer not null default 0,
  exit_locked_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (lecture_id, student_id)
);
alter table public.native_exam_face_codes enable row level security;
create policy "staff read face exam codes" on public.native_exam_face_codes
  for select to authenticated using (public.is_admin());

-- Use PostgreSQL's built-in random UUID rather than pgcrypto's
-- schema-dependent gen_random_bytes(). The first two UUID bytes are random.
create function public.native_random_face_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
begin
  return lpad(((get_byte(bytes, 0) * 256 + get_byte(bytes, 1)) % 10000)::text, 4, '0');
end;
$$;

create function public.native_issue_face_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'face' and new.status in ('present', 'late') then
    insert into public.native_exam_face_codes(lecture_id, student_id, code)
    values (new.lecture_id, new.student_id, public.native_random_face_code())
    on conflict (lecture_id, student_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger native_face_code_after_attendance
after insert or update of source, status on public.attendance_records
for each row execute function public.native_issue_face_code();

insert into public.native_exam_face_codes(lecture_id, student_id, code)
select lecture_id, student_id, public.native_random_face_code()
from public.attendance_records where source = 'face' and status in ('present', 'late')
on conflict (lecture_id, student_id) do nothing;

create function public.native_face_code(p_lecture_id uuid, p_student_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare result text;
begin
  if not public.is_admin() or not public.is_current_app_session_request() then
    raise exception 'Active staff session required';
  end if;
  select code into result from public.native_exam_face_codes
  where lecture_id = p_lecture_id and student_id = p_student_id;
  return result;
end;
$$;

create function public.native_has_face_attendance(p_exam_id uuid, p_student_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (p_student_id = auth.uid() or public.is_admin()) and exists (
    select 1 from public.native_exams e
    join public.lecture_sessions l on l.id = e.attendance_session_id and l.course_id = e.course_id
    join public.attendance_records a on a.lecture_id = l.id and a.student_id = p_student_id
    where e.id = p_exam_id and a.source = 'face' and a.status in ('present', 'late')
  );
$$;

create policy "students read face approved native exams" on public.native_exams
  for select to authenticated using (public.native_has_face_attendance(id, auth.uid()));

create function public.native_start_exam(p_exam_id uuid, p_entry_code text) returns public.native_exam_attempts
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
  if exam_row.status <> 'open' or now() < exam_row.starts_at or now() >= exam_row.ends_at then
    raise exception 'The exam is not open';
  end if;
  if not exists (
    select 1 from public.profiles p
    join public.course_memberships m on m.student_id = p.id and m.course_id = exam_row.course_id and m.deleted_at is null
    where p.id = auth.uid() and p.role = 'student' and p.approval_status = 'approved' and p.deleted_at is null
  ) then raise exception 'Your account is not approved for this course'; end if;
  if exam_row.attendance_session_id is not null then
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

create or replace function public.native_start_exam(p_exam_id uuid) returns public.native_exam_attempts
language sql security definer set search_path = public as $$
  select public.native_start_exam(p_exam_id, null::text);
$$;

create function public.native_submit_exam(
  p_attempt_id uuid, p_answers jsonb, p_revision integer, p_reason text, p_exit_code text
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  result public.native_exam_attempts%rowtype;
  exam_row public.native_exams%rowtype;
  face_code public.native_exam_face_codes%rowtype;
  expected_code text;
begin
  if not public.is_current_app_session_request() then return false; end if;
  if p_reason not in ('student', 'browser_left', 'offline_timeout') then raise exception 'Invalid submission reason'; end if;
  select * into result from public.native_exam_attempts
    where id = p_attempt_id and student_id = auth.uid() for update;
  if result.id is null or result.status <> 'in_progress' then return false; end if;
  select * into exam_row from public.native_exams where id = result.exam_id;
  -- Preserve the latest answer text even if the final code is mistyped.
  perform public.native_validate_answers(result.exam_id, p_answers);
  update public.native_exam_attempts set
    answers = case when p_revision >= result.revision then p_answers else result.answers end,
    revision = greatest(p_revision, result.revision), last_seen_at = now()
  where id = result.id;
  if exam_row.code_mode = 'entry_exit' then
    select * into face_code from public.native_exam_face_codes
    where lecture_id = exam_row.attendance_session_id and student_id = auth.uid() for update;
    if face_code.code is null or face_code.exit_locked_until > now() then return false; end if;
    expected_code := case exam_row.exit_transform
      when 'reverse' then reverse(face_code.code)
      when 'add' then lpad(((face_code.code::integer + exam_row.exit_operand) % 10000)::text, 4, '0')
      else lpad(((face_code.code::integer - exam_row.exit_operand + 10000) % 10000)::text, 4, '0') end;
    if p_exit_code is distinct from expected_code then
      update public.native_exam_face_codes set
        exit_failures = case when exit_locked_until < now() then 1 else exit_failures + 1 end,
        exit_locked_until = case when exit_locked_until < now() then null
          when exit_failures + 1 >= 5 then now() + interval '15 minutes' else null end
      where lecture_id = face_code.lecture_id and student_id = face_code.student_id;
      return false;
    end if;
    update public.native_exam_face_codes set exit_failures = 0, exit_locked_until = null
    where lecture_id = face_code.lecture_id and student_id = face_code.student_id;
  end if;
  update public.native_exam_attempts set
    answers = case when p_revision >= result.revision then p_answers else result.answers end,
    revision = greatest(p_revision, result.revision),
    status = case when p_reason = 'student' and now() < result.deadline_at then 'submitted' else 'auto_submitted' end,
    submission_reason = case when p_reason = 'offline_timeout' or now() >= result.deadline_at then 'time_expired' else p_reason end,
    submitted_at = now(), last_seen_at = now(),
    exit_code_verified = exam_row.code_mode = 'entry_exit'
  where id = result.id;
  return true;
end;
$$;

create or replace function public.native_submit_exam(p_attempt_id uuid, p_answers jsonb, p_revision integer, p_reason text)
returns boolean language sql security definer set search_path = public as $$
  select public.native_submit_exam(p_attempt_id, p_answers, p_revision, p_reason, null::text);
$$;

revoke all on function public.native_issue_face_code() from public;
revoke all on function public.native_random_face_code() from public;
revoke all on function public.native_exam_validate_face_session() from public;
revoke all on function public.native_face_code(uuid, uuid) from public;
revoke all on function public.native_has_face_attendance(uuid, uuid) from public;
revoke all on function public.native_start_exam(uuid, text) from public;
revoke all on function public.native_submit_exam(uuid, jsonb, integer, text, text) from public;
grant execute on function public.native_face_code(uuid, uuid) to authenticated;
grant execute on function public.native_has_face_attendance(uuid, uuid) to authenticated;
grant execute on function public.native_start_exam(uuid, text) to authenticated;
grant execute on function public.native_submit_exam(uuid, jsonb, integer, text, text) to authenticated;
