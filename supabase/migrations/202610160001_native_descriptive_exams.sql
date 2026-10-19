-- In-app descriptive exams. The existing Unstop gateway remains separate.
create table public.native_exams (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  title text not null,
  instructions text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 1 and 360),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.native_exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.native_exams(id) on delete cascade,
  position integer not null check (position > 0),
  prompt text not null check (length(btrim(prompt)) > 0),
  unique (exam_id, position)
);

create table public.native_exam_access (
  exam_id uuid not null references public.native_exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  approved_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  primary key (exam_id, student_id)
);

create table public.native_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.native_exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  revision integer not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'auto_submitted')),
  submission_reason text,
  submitted_at timestamptz,
  unique (exam_id, student_id)
);

create index native_exam_attempts_exam_idx on public.native_exam_attempts (exam_id);

alter table public.native_exams enable row level security;
alter table public.native_exam_questions enable row level security;
alter table public.native_exam_access enable row level security;
alter table public.native_exam_attempts enable row level security;

create policy "staff manage native exams" on public.native_exams
for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "students read approved native exams" on public.native_exams
for select to authenticated using (
  exists (select 1 from public.native_exam_access a where a.exam_id = id and a.student_id = auth.uid())
);
create policy "staff manage native questions" on public.native_exam_questions
for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "students read started native questions" on public.native_exam_questions
for select to authenticated using (
  exists (select 1 from public.native_exam_attempts a where a.exam_id = native_exam_questions.exam_id and a.student_id = auth.uid())
);
create policy "staff manage native access" on public.native_exam_access
for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "students read own native access" on public.native_exam_access
for select to authenticated using (student_id = auth.uid());
create policy "staff read native attempts" on public.native_exam_attempts
for select to authenticated using (public.is_admin());
create policy "students read own native attempts" on public.native_exam_attempts
for select to authenticated using (student_id = auth.uid());

-- Once any student starts, freeze the question sheet so CSV columns stay stable.
create function public.native_lock_questions() returns trigger
language plpgsql security definer set search_path = public as $$
declare target_exam uuid;
begin
  target_exam := case when tg_op = 'INSERT' then new.exam_id else old.exam_id end;
  if exists (select 1 from public.native_exam_attempts where exam_id = target_exam) then
    raise exception 'Questions cannot change after an attempt has started';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger native_questions_lock before insert or update or delete on public.native_exam_questions
for each row execute function public.native_lock_questions();

create function public.native_validate_answers(p_exam_id uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be an object';
  end if;
  if exists (
    select 1 from jsonb_each(p_answers) answer
    where jsonb_typeof(answer.value) <> 'string'
       or length(answer.value #>> '{}') > 50000
       or not exists (
         select 1 from public.native_exam_questions q
         where q.exam_id = p_exam_id and q.id::text = answer.key
       )
  ) then
    raise exception 'An answer is invalid or exceeds 50,000 characters';
  end if;
end;
$$;

create function public.native_start_exam(p_exam_id uuid) returns public.native_exam_attempts
language plpgsql security definer set search_path = public as $$
declare
  exam_row public.native_exams%rowtype;
  result public.native_exam_attempts%rowtype;
begin
  if not public.is_current_app_session_request() then raise exception 'This device session is no longer active'; end if;
  select * into exam_row from public.native_exams where id = p_exam_id;
  if exam_row.id is null or exam_row.status <> 'open' or now() < exam_row.starts_at or now() >= exam_row.ends_at then
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
  on conflict (exam_id, student_id) do nothing;
  select * into result from public.native_exam_attempts
  where exam_id = p_exam_id and student_id = auth.uid() for update;
  if result.status = 'in_progress' and (now() >= result.deadline_at or now() - result.last_seen_at > interval '45 seconds') then
    update public.native_exam_attempts set status = 'auto_submitted',
      submission_reason = case when now() >= result.deadline_at then 'time_expired' else 'browser_left' end,
      submitted_at = now() where id = result.id returning * into result;
  end if;
  return result;
end;
$$;

create function public.native_save_exam(p_attempt_id uuid, p_answers jsonb, p_revision integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare result public.native_exam_attempts%rowtype;
begin
  if not public.is_current_app_session_request() then return false; end if;
  select * into result from public.native_exam_attempts
  where id = p_attempt_id and student_id = auth.uid() for update;
  if result.id is null or result.status <> 'in_progress' then return false; end if;
  if now() >= result.deadline_at or now() - result.last_seen_at > interval '45 seconds' then
    update public.native_exam_attempts set status = 'auto_submitted',
      submission_reason = case when now() >= result.deadline_at then 'time_expired' else 'browser_left' end,
      submitted_at = now() where id = result.id;
    return false;
  end if;
  perform public.native_validate_answers(result.exam_id, p_answers);
  if p_revision >= result.revision then
    update public.native_exam_attempts set answers = p_answers, revision = p_revision,
      last_seen_at = now() where id = result.id;
  else
    update public.native_exam_attempts set last_seen_at = now() where id = result.id;
  end if;
  return true;
end;
$$;

create function public.native_submit_exam(p_attempt_id uuid, p_answers jsonb, p_revision integer, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare result public.native_exam_attempts%rowtype;
begin
  if not public.is_current_app_session_request() then return false; end if;
  select * into result from public.native_exam_attempts
  where id = p_attempt_id and student_id = auth.uid() for update;
  if result.id is null or result.status <> 'in_progress' then return false; end if;
  if now() >= result.deadline_at or now() - result.last_seen_at > interval '45 seconds' then
    update public.native_exam_attempts set status = 'auto_submitted',
      submission_reason = case when now() >= result.deadline_at then 'time_expired' else 'browser_left' end,
      submitted_at = now() where id = result.id;
    return false;
  end if;
  perform public.native_validate_answers(result.exam_id, p_answers);
  update public.native_exam_attempts set
    answers = case when p_revision >= result.revision then p_answers else result.answers end,
    revision = greatest(p_revision, result.revision),
    status = case when p_reason = 'student' and now() < result.deadline_at then 'submitted' else 'auto_submitted' end,
    submission_reason = case when now() >= result.deadline_at then 'time_expired'
      when p_reason = 'student' then 'student' else 'browser_left' end,
    submitted_at = now(), last_seen_at = now()
  where id = result.id;
  return true;
end;
$$;

revoke all on function public.native_lock_questions() from public;
revoke all on function public.native_validate_answers(uuid, jsonb) from public;
revoke all on function public.native_start_exam(uuid) from public;
revoke all on function public.native_save_exam(uuid, jsonb, integer) from public;
revoke all on function public.native_submit_exam(uuid, jsonb, integer, text) from public;
grant execute on function public.native_start_exam(uuid) to authenticated;
grant execute on function public.native_save_exam(uuid, jsonb, integer) to authenticated;
grant execute on function public.native_submit_exam(uuid, jsonb, integer, text) to authenticated;
