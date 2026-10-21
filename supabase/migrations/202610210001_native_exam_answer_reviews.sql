-- Staff import each student's answers and marks separately, then explicitly
-- publish the paired review. Students can read only their own published row.
create table public.native_exam_review_publications (
  exam_id uuid primary key references public.native_exams(id) on delete cascade,
  published boolean not null default false,
  published_at timestamptz
);

create table public.native_exam_reviews (
  exam_id uuid not null references public.native_exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  marks jsonb not null default '{}'::jsonb check (jsonb_typeof(marks) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (exam_id, student_id)
);

alter table public.native_exam_review_publications enable row level security;
alter table public.native_exam_reviews enable row level security;

create function public.native_exam_review_is_published(p_exam_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.native_exam_review_publications where exam_id = p_exam_id and published);
$$;

create policy "admins manage exam review publications" on public.native_exam_review_publications
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage exam reviews" on public.native_exam_reviews
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "students read own published exam review" on public.native_exam_reviews
  for select to authenticated using (
    student_id = auth.uid() and public.is_current_app_session_request()
      and public.native_exam_review_is_published(exam_id)
  );
create policy "students read published review exam" on public.native_exams
  for select to authenticated using (exists (
    select 1 from public.native_exam_reviews r
    where r.exam_id = native_exams.id and r.student_id = auth.uid()
      and public.native_exam_review_is_published(r.exam_id)
  ));
create policy "students read published review questions" on public.native_exam_questions
  for select to authenticated using (exists (
    select 1 from public.native_exam_reviews r
    where r.exam_id = native_exam_questions.exam_id and r.student_id = auth.uid()
      and public.native_exam_review_is_published(r.exam_id)
  ));

create function public.native_import_exam_reviews(p_exam_id uuid, p_kind text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  target_student uuid;
  values_json jsonb;
  imported integer := 0;
begin
  if not public.is_admin() or not public.is_current_app_session_request() then
    raise exception 'An active administrator session is required';
  end if;
  if p_kind not in ('answers', 'marks') or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Invalid review import';
  end if;
  if not exists (select 1 from public.native_exams where id = p_exam_id) then raise exception 'Exam not found'; end if;
  if exists (select 1 from public.native_exam_review_publications where exam_id = p_exam_id and published) then
    raise exception 'Unpublish reviews before changing them';
  end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    target_student := (item->>'student_id')::uuid;
    values_json := item->'values';
    if target_student is null or jsonb_typeof(values_json) <> 'object' then raise exception 'Invalid review row'; end if;
    if not exists (
      select 1 from public.profiles s
      join public.native_exams e on e.id = p_exam_id
      join public.course_memberships m on m.course_id = e.course_id and m.student_id = s.id and m.deleted_at is null
      where s.id = target_student and s.role = 'student' and s.deleted_at is null
    ) then raise exception 'Student is not enrolled in this exam course'; end if;
    if exists (
      select 1 from jsonb_each(values_json) v
      where not exists (select 1 from public.native_exam_questions q where q.exam_id = p_exam_id and q.id::text = v.key)
        or (p_kind = 'answers' and jsonb_typeof(v.value) <> 'string')
        or (p_kind = 'answers' and length(v.value #>> '{}') > 50000)
        or (p_kind = 'marks' and jsonb_typeof(v.value) not in ('number', 'null'))
        or (p_kind = 'marks' and jsonb_typeof(v.value) = 'number' and (v.value #>> '{}')::numeric < 0)
    ) then raise exception 'Invalid question answer or mark'; end if;
    if p_kind = 'answers' then
      insert into public.native_exam_reviews(exam_id, student_id, answers)
      values (p_exam_id, target_student, values_json)
      on conflict (exam_id, student_id) do update set answers = excluded.answers, updated_at = now();
    else
      insert into public.native_exam_reviews(exam_id, student_id, marks)
      values (p_exam_id, target_student, values_json)
      on conflict (exam_id, student_id) do update set marks = excluded.marks, updated_at = now();
    end if;
    imported := imported + 1;
  end loop;
  return imported;
end;
$$;

revoke all on function public.native_import_exam_reviews(uuid, text, jsonb) from public;
grant execute on function public.native_import_exam_reviews(uuid, text, jsonb) to authenticated;
revoke all on function public.native_exam_review_is_published(uuid) from public;
grant execute on function public.native_exam_review_is_published(uuid) to authenticated;
