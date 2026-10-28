-- Recheck decisions are visible with the student's answer review.
alter table public.native_exam_review_flags
  add column status text not null default 'pending' check (status in ('pending', 'reviewed', 'marks_changed')),
  add column admin_response text,
  add column resolved_at timestamptz,
  add column resolved_by uuid references public.profiles(id);

create or replace function public.native_flag_exam_review(
  p_exam_id uuid, p_question_id uuid, p_reason text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare clean_reason text := btrim(p_reason);
begin
  if auth.uid() is null or not public.is_current_app_session_request() then
    raise exception 'An active student session is required';
  end if;
  if clean_reason is null or length(clean_reason) not between 1 and 500 then
    raise exception 'Enter a reason of 1 to 500 characters';
  end if;
  if not public.native_exam_review_is_published(p_exam_id) then
    raise exception 'The answer review is not open';
  end if;
  if not exists (select 1 from public.native_exam_reviews r join public.profiles p on p.id = r.student_id
    where r.exam_id = p_exam_id and r.student_id = auth.uid() and p.role = 'student' and p.deleted_at is null) then
    raise exception 'Your answer review was not found';
  end if;
  if not exists (select 1 from public.native_exam_questions where id = p_question_id and exam_id = p_exam_id) then
    raise exception 'Question does not belong to this exam';
  end if;
  insert into public.native_exam_review_flags(exam_id, student_id, question_id, reason)
  values (p_exam_id, auth.uid(), p_question_id, clean_reason)
  on conflict (exam_id, student_id, question_id) do update set
    reason = excluded.reason, status = 'pending', admin_response = null,
    resolved_at = null, resolved_by = null, updated_at = now();
  return true;
end;
$$;

create function public.native_resolve_exam_review_flag(
  p_exam_id uuid, p_student_id uuid, p_question_id uuid,
  p_status text, p_response text, p_mark numeric default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare current_marks jsonb;
begin
  if not public.is_admin() or not public.is_current_app_session_request() then raise exception 'Administrator session required'; end if;
  if p_status not in ('reviewed', 'marks_changed') then raise exception 'Choose a review outcome'; end if;
  if length(btrim(coalesce(p_response, ''))) not between 1 and 1000 then
    raise exception 'Write a response of 1 to 1000 characters';
  end if;
  if not exists (select 1 from public.native_exam_review_flags
    where exam_id = p_exam_id and student_id = p_student_id and question_id = p_question_id) then
    raise exception 'Recheck request not found';
  end if;
  if p_status = 'marks_changed' then
    if p_mark is null or p_mark < 0 or p_mark::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'Enter a non-negative revised mark'; end if;
    select marks into current_marks from public.native_exam_reviews
      where exam_id = p_exam_id and student_id = p_student_id for update;
    if current_marks is null then raise exception 'Student review not found'; end if;
    update public.native_exam_reviews set marks = jsonb_set(current_marks, array[p_question_id::text], to_jsonb(p_mark), true), updated_at = now()
      where exam_id = p_exam_id and student_id = p_student_id;
  end if;
  update public.native_exam_review_flags set status = p_status, admin_response = btrim(p_response),
    resolved_at = now(), resolved_by = auth.uid(), updated_at = now()
    where exam_id = p_exam_id and student_id = p_student_id and question_id = p_question_id;
  return true;
end;
$$;
revoke all on function public.native_resolve_exam_review_flag(uuid, uuid, uuid, text, text, numeric) from public;
grant execute on function public.native_resolve_exam_review_flag(uuid, uuid, uuid, text, text, numeric) to authenticated;

-- Students can track a decision after the answer viewing window closes, without
-- exposing the answer or marks outside that window.
create function public.my_exam_recheck_outcomes()
returns table (exam_title text, question_number integer, reason text, status text, admin_response text, resolved_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_current_app_session_request() then raise exception 'Sign in again'; end if;
  return query select e.title, q.position, f.reason, f.status, f.admin_response, f.resolved_at
    from public.native_exam_review_flags f
    join public.native_exams e on e.id = f.exam_id
    join public.native_exam_questions q on q.id = f.question_id and q.exam_id = f.exam_id
    where f.student_id = auth.uid() order by f.updated_at desc;
end;
$$;
revoke all on function public.my_exam_recheck_outcomes() from public;
grant execute on function public.my_exam_recheck_outcomes() to authenticated;

-- A correction can target a session even when no attendance record exists.
alter table public.student_issues
  add column session_id uuid references public.lecture_sessions(id) on delete set null,
  add column decision text check (decision in ('approved_present', 'approved_late', 'rejected'));

create function public.request_attendance_correction(p_session_id uuid, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare result uuid;
begin
  if auth.uid() is null or not public.is_current_app_session_request() then raise exception 'Sign in again'; end if;
  if length(btrim(coalesce(p_message, ''))) not between 10 and 1000 then raise exception 'Explain the correction in 10 to 1000 characters'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'student' and deleted_at is null) then
    raise exception 'Student account required';
  end if;
  if not exists (select 1 from public.lecture_sessions l join public.course_memberships m
    on m.course_id = l.course_id and m.student_id = auth.uid() and m.deleted_at is null
    where l.id = p_session_id) then raise exception 'Session not found in your courses'; end if;
  if exists (select 1 from public.student_issues where student_id = auth.uid()
    and session_id = p_session_id and status <> 'resolved') then raise exception 'You already have an open request for this session'; end if;
  insert into public.student_issues(student_id, target_type, target_id, session_id, message)
    values (auth.uid(), 'attendance', p_session_id, p_session_id, btrim(p_message)) returning id into result;
  return result;
end;
$$;
revoke all on function public.request_attendance_correction(uuid, text) from public;
grant execute on function public.request_attendance_correction(uuid, text) to authenticated;

create function public.resolve_attendance_correction(p_issue_id uuid, p_decision text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare item public.student_issues%rowtype;
begin
  if not public.is_admin() or not public.is_current_app_session_request() then raise exception 'Administrator session required'; end if;
  if p_decision not in ('approved_present', 'approved_late', 'rejected') then raise exception 'Choose an attendance decision'; end if;
  if length(btrim(coalesce(p_note, ''))) not between 1 and 1000 then raise exception 'Write a reason for the student'; end if;
  select * into item from public.student_issues where id = p_issue_id for update;
  if item.id is null or item.session_id is null or item.target_type <> 'attendance' then raise exception 'Session correction not found'; end if;
  if item.status = 'resolved' then raise exception 'This request is already resolved'; end if;
  if not exists (select 1 from public.lecture_sessions l join public.course_memberships m
    on m.course_id = l.course_id and m.student_id = item.student_id and m.deleted_at is null
    where l.id = item.session_id) then raise exception 'Student is not enrolled in this session'; end if;
  if p_decision <> 'rejected' then
    insert into public.attendance_records(lecture_id, student_id, status, source, reason, marked_by)
      values (item.session_id, item.student_id,
        case when p_decision = 'approved_late' then 'late'::public.attendance_status else 'present'::public.attendance_status end,
        'manual', 'Approved attendance correction: ' || btrim(p_note), auth.uid())
      on conflict (lecture_id, student_id) do update set
        status = excluded.status, source = 'manual', confidence = null,
        reason = excluded.reason, marked_by = auth.uid(), marked_at = now();
  end if;
  update public.student_issues set status = 'resolved', decision = p_decision,
    admin_note = btrim(p_note), resolved_by = auth.uid() where id = p_issue_id;
  return true;
end;
$$;
revoke all on function public.resolve_attendance_correction(uuid, text, text) from public;
grant execute on function public.resolve_attendance_correction(uuid, text, text) to authenticated;

-- Birthdates are private to each student and administrators via profile RLS.
alter table public.profiles add column birth_date date;

create table public.portal_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 1000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  show_popup boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index portal_notices_active_idx on public.portal_notices(starts_at desc, ends_at);
alter table public.portal_notices enable row level security;
create policy "students read active notices" on public.portal_notices for select to authenticated
  using (public.is_admin() or (starts_at <= now() and (ends_at is null or ends_at > now())));
create policy "admins manage notices" on public.portal_notices for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
