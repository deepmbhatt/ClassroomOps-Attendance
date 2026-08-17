-- Add flexible assessment metadata for year/semester-based marks imports.

alter table public.assessments
add column if not exists academic_year text,
add column if not exists semester text,
add column if not exists assessment_type text;

create index if not exists assessments_term_lookup_idx
on public.assessments (course_id, academic_year, semester, title);
