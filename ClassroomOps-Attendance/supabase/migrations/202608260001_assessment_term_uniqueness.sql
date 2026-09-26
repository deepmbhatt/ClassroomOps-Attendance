-- Assessments repeat naturally across academic years and semesters.
alter table public.assessments
  drop constraint if exists assessments_course_id_title_key;

alter table public.assessments
  drop constraint if exists assessments_course_term_title_key;

alter table public.assessments
  add constraint assessments_course_term_title_key
  unique (course_id, academic_year, semester, title);
