-- Students may request a recheck for one of their own published answers.
-- Flags remain available to administrators after the review window closes.
create table public.native_exam_review_flags (
  exam_id uuid not null,
  student_id uuid not null,
  question_id uuid not null references public.native_exam_questions(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (exam_id, student_id, question_id),
  foreign key (exam_id, student_id)
    references public.native_exam_reviews(exam_id, student_id) on delete cascade
);

create index native_exam_review_flags_exam_idx
  on public.native_exam_review_flags(exam_id, updated_at desc);

alter table public.native_exam_review_flags enable row level security;

create policy "admins read exam review flags" on public.native_exam_review_flags
  for select to authenticated using (public.is_admin());
create policy "students read own active exam review flags" on public.native_exam_review_flags
  for select to authenticated using (
    student_id = auth.uid()
    and public.is_current_app_session_request()
    and public.native_exam_review_is_published(exam_id)
  );

create function public.native_flag_exam_review(
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
  if not exists (
    select 1 from public.native_exam_reviews r
    join public.profiles p on p.id = r.student_id
    where r.exam_id = p_exam_id and r.student_id = auth.uid()
      and p.role = 'student' and p.deleted_at is null
  ) then raise exception 'Your answer review was not found'; end if;
  if not exists (
    select 1 from public.native_exam_questions
    where id = p_question_id and exam_id = p_exam_id
  ) then raise exception 'Question does not belong to this exam'; end if;

  insert into public.native_exam_review_flags(exam_id, student_id, question_id, reason)
  values (p_exam_id, auth.uid(), p_question_id, clean_reason)
  on conflict (exam_id, student_id, question_id)
    do update set reason = excluded.reason, updated_at = now();
  return true;
end;
$$;

revoke all on function public.native_flag_exam_review(uuid, uuid, text) from public;
grant execute on function public.native_flag_exam_review(uuid, uuid, text) to authenticated;
