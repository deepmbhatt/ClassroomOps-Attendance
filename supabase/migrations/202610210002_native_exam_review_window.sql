-- A published review is readable only inside its optional server-time window.
-- Existing published reviews remain available until staff set a window.
alter table public.native_exam_review_publications
  add column available_from timestamptz,
  add column available_until timestamptz,
  add constraint native_exam_review_window_order
    check (available_from is null or available_until is null or available_until > available_from);

create or replace function public.native_exam_review_is_published(p_exam_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.native_exam_review_publications
    where exam_id = p_exam_id and published
      and (available_from is null or now() >= available_from)
      and (available_until is null or now() < available_until)
  );
$$;

create policy "students read active review window" on public.native_exam_review_publications
  for select to authenticated using (
    public.native_exam_review_is_published(exam_id)
    and exists (
      select 1 from public.native_exam_reviews r
      where r.exam_id = native_exam_review_publications.exam_id and r.student_id = auth.uid()
    )
  );
