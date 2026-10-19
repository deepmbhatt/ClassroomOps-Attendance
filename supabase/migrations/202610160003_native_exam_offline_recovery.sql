-- Keep one attempt resumable through a network outage or browser restart. The
-- original server-issued deadline is never extended. A late final upload is
-- accepted so locally saved answers are not discarded when connectivity returns.
create or replace function public.native_start_exam(p_exam_id uuid) returns public.native_exam_attempts
language plpgsql security definer set search_path = public as $$
declare
  exam_row public.native_exams%rowtype;
  result public.native_exam_attempts%rowtype;
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
    select 1 from public.native_exam_access a
    join public.profiles p on p.id = a.student_id
    join public.course_memberships m on m.student_id = p.id and m.course_id = exam_row.course_id and m.deleted_at is null
    where a.exam_id = p_exam_id and a.student_id = auth.uid()
      and p.role = 'student' and p.approval_status = 'approved' and p.deleted_at is null
  ) then raise exception 'Your exam access has not been approved'; end if;
  if not exists (select 1 from public.native_exam_questions where exam_id = p_exam_id) then
    raise exception 'This exam has no questions';
  end if;
  insert into public.native_exam_attempts (exam_id, student_id, deadline_at)
  values (p_exam_id, auth.uid(), least(now() + make_interval(mins => exam_row.duration_minutes), exam_row.ends_at))
  returning * into result;
  return result;
end;
$$;

create or replace function public.native_save_exam(p_attempt_id uuid, p_answers jsonb, p_revision integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare result public.native_exam_attempts%rowtype;
begin
  if not public.is_current_app_session_request() then return false; end if;
  select * into result from public.native_exam_attempts
    where id = p_attempt_id and student_id = auth.uid() for update;
  if result.id is null or result.status <> 'in_progress' then return false; end if;
  if now() >= result.deadline_at then return false; end if;
  perform public.native_validate_answers(result.exam_id, p_answers);
  update public.native_exam_attempts set
    answers = case when p_revision >= result.revision then p_answers else result.answers end,
    revision = greatest(p_revision, result.revision), last_seen_at = now()
  where id = result.id;
  return true;
end;
$$;

create or replace function public.native_submit_exam(p_attempt_id uuid, p_answers jsonb, p_revision integer, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare result public.native_exam_attempts%rowtype;
begin
  if not public.is_current_app_session_request() then return false; end if;
  if p_reason not in ('student', 'browser_left', 'offline_timeout') then
    raise exception 'Invalid submission reason';
  end if;
  select * into result from public.native_exam_attempts
    where id = p_attempt_id and student_id = auth.uid() for update;
  if result.id is null or result.status <> 'in_progress' then return false; end if;
  perform public.native_validate_answers(result.exam_id, p_answers);
  update public.native_exam_attempts set
    answers = case when p_revision >= result.revision then p_answers else result.answers end,
    revision = greatest(p_revision, result.revision),
    status = case when p_reason = 'student' and now() < result.deadline_at then 'submitted' else 'auto_submitted' end,
    submission_reason = case when p_reason = 'offline_timeout' or now() >= result.deadline_at then 'time_expired'
      else p_reason end,
    submitted_at = now(), last_seen_at = now()
  where id = result.id;
  return true;
end;
$$;

create or replace function public.native_report_exam_violation(
  p_attempt_id uuid, p_answers jsonb, p_revision integer, p_event text, p_event_id uuid
) returns public.native_exam_attempts
language plpgsql security definer set search_path = public as $$
declare
  result public.native_exam_attempts%rowtype;
  limit_count integer;
begin
  if not public.is_current_app_session_request() then
    raise exception 'This device session is no longer active';
  end if;
  if p_event not in ('tab_hidden', 'fullscreen_exit', 'page_exit') then
    raise exception 'Invalid exam event';
  end if;
  select * into result from public.native_exam_attempts
    where id = p_attempt_id and student_id = auth.uid() for update;
  if result.id is null then raise exception 'Attempt not found'; end if;
  if exists (select 1 from public.native_exam_violation_events
    where attempt_id = p_attempt_id and event_id = p_event_id) then return result; end if;
  if result.status <> 'in_progress' then return result; end if;
  perform public.native_validate_answers(result.exam_id, p_answers);
  insert into public.native_exam_violation_events (attempt_id, event_id, event_type)
  values (p_attempt_id, p_event_id, p_event);
  select warning_limit into limit_count from public.native_exams where id = result.exam_id;
  update public.native_exam_attempts set
    answers = case when p_revision >= result.revision then p_answers else result.answers end,
    revision = greatest(p_revision, result.revision),
    warning_count = result.warning_count + 1,
    last_seen_at = now(),
    status = case when result.warning_count + 1 >= limit_count then 'auto_submitted' else 'in_progress' end,
    submission_reason = case when result.warning_count + 1 >= limit_count then 'warning_limit' else null end,
    submitted_at = case when result.warning_count + 1 >= limit_count then now() else null end
  where id = result.id returning * into result;
  return result;
end;
$$;
