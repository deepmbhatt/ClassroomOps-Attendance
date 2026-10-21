-- Archived exams hold imported answer reviews only. They can never be opened
-- for an in-app attempt, and destructive deletion requires a title check.
alter table public.native_exams
  add column review_only boolean not null default false,
  add column held_on date,
  add constraint native_review_only_closed check (not review_only or status = 'closed');

create function public.native_review_exam_settings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and exists (
    select 1 from public.native_exam_reviews where exam_id = old.id
  ) and (new.course_id is distinct from old.course_id
    or new.review_only is distinct from old.review_only) then
    raise exception 'Course and exam purpose are locked after answer reviews are imported';
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from public.native_exam_attempts where exam_id = old.id
  ) and new.review_only is distinct from old.review_only then
    raise exception 'Exam purpose is locked after the first attempt';
  end if;
  return new;
end;
$$;
create trigger native_review_exam_settings_guard
before update on public.native_exams
for each row execute function public.native_review_exam_settings_guard();

create or replace function public.native_lock_questions() returns trigger
language plpgsql security definer set search_path = public as $$
declare target_exam uuid;
begin
  target_exam := case when tg_op = 'INSERT' then new.exam_id else old.exam_id end;
  if exists (select 1 from public.native_exam_attempts where exam_id = target_exam)
    or exists (select 1 from public.native_exam_reviews where exam_id = target_exam) then
    raise exception 'Questions cannot change after an attempt or answer-review import';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.native_delete_exam(p_exam_id uuid, p_confirm_title text) returns boolean
language plpgsql security definer set search_path = public as $$
declare target public.native_exams%rowtype;
begin
  if not public.is_admin() or not public.is_current_app_session_request() then
    raise exception 'An active administrator session is required';
  end if;
  select * into target from public.native_exams where id = p_exam_id for update;
  if target.id is null then raise exception 'Exam not found'; end if;
  if p_confirm_title is distinct from target.title then raise exception 'Confirmation title does not match'; end if;
  if exists (
    select 1 from public.native_exam_attempts
    where exam_id = p_exam_id and status = 'in_progress' and deadline_at > now()
  ) then raise exception 'This exam has a live attempt and cannot be deleted yet'; end if;

  delete from public.native_exam_review_publications where exam_id = p_exam_id;
  delete from public.native_exam_reviews where exam_id = p_exam_id;
  delete from public.native_exam_attempts where exam_id = p_exam_id;
  delete from public.native_exam_questions where exam_id = p_exam_id;
  delete from public.native_exam_access where exam_id = p_exam_id;
  delete from public.native_exams where id = p_exam_id;
  return true;
end;
$$;

revoke all on function public.native_review_exam_settings_guard() from public;
revoke all on function public.native_delete_exam(uuid, text) from public;
grant execute on function public.native_delete_exam(uuid, text) to authenticated;
revoke delete on public.native_exams from public, anon, authenticated;
