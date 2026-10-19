-- Configurable fullscreen/tab warnings and single-choice questions.
alter table public.native_exams
  add column warning_limit integer not null default 1
  check (warning_limit between 1 and 10);

alter table public.native_exam_questions
  add column question_type text not null default 'descriptive'
    check (question_type in ('descriptive', 'mcq')),
  add column options text[] not null default '{}';

alter table public.native_exam_questions
  add constraint native_question_options_valid check (
    case when question_type = 'mcq'
      then cardinality(options) between 2 and 8 and array_position(options, '') is null
      else cardinality(options) = 0
    end
  );

alter table public.native_exam_attempts
  add column warning_count integer not null default 0 check (warning_count >= 0);

create table public.native_exam_violation_events (
  attempt_id uuid not null references public.native_exam_attempts(id) on delete cascade,
  event_id uuid not null,
  event_type text not null check (event_type in ('tab_hidden', 'fullscreen_exit', 'page_exit')),
  occurred_at timestamptz not null default now(),
  primary key (attempt_id, event_id)
);
alter table public.native_exam_violation_events enable row level security;
create policy "staff read native exam violations" on public.native_exam_violation_events
for select to authenticated using (public.is_admin());

create or replace function public.native_validate_answers(p_exam_id uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be an object';
  end if;
  if exists (
    select 1
    from jsonb_each(p_answers) answer
    left join public.native_exam_questions q
      on q.exam_id = p_exam_id and q.id::text = answer.key
    where q.id is null
       or jsonb_typeof(answer.value) <> 'string'
       or length(answer.value #>> '{}') > 50000
       or (
         q.question_type = 'mcq' and (answer.value #>> '{}') <> ''
         and not exists (
           select 1 from unnest(q.options) with ordinality option(value, position)
           where (option.position - 1)::text = (answer.value #>> '{}')
         )
       )
  ) then
    raise exception 'An answer is invalid or exceeds 50,000 characters';
  end if;
end;
$$;

create function public.native_report_exam_violation(
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

  if now() >= result.deadline_at or now() - result.last_seen_at > interval '45 seconds' then
    update public.native_exam_attempts set status = 'auto_submitted',
      submission_reason = case when now() >= result.deadline_at then 'time_expired' else 'browser_left' end,
      submitted_at = now() where id = result.id returning * into result;
    return result;
  end if;

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

revoke all on function public.native_report_exam_violation(uuid, jsonb, integer, text, uuid) from public;
grant execute on function public.native_report_exam_violation(uuid, jsonb, integer, text, uuid) to authenticated;
