create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'student');
create type public.enrollment_state as enum (
  'not_started',
  'capturing',
  'uploading',
  'queued',
  'processing',
  'ready',
  'upload_failed',
  'quality_failed',
  'processing_failed'
);
create type public.attendance_status as enum ('present', 'absent', 'late', 'excused', 'manual_review');
create type public.issue_status as enum ('open', 'under_review', 'resolved');
create type public.import_status as enum ('preview', 'committed', 'rolled_back');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'student',
  full_name text not null,
  student_id text unique,
  email text not null unique,
  phone text,
  biometric_consent_at timestamptz,
  must_change_password boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_id_required_for_students check (role <> 'student' or student_id is not null)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  term text not null,
  active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_memberships (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  student_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (course_id, student_id)
);

create table public.face_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  state public.enrollment_state not null default 'not_started',
  frame_count integer not null default 0,
  lock_owner text,
  locked_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id)
);

create table public.face_enrollment_frames (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.face_enrollments(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  storage_path text not null unique,
  quality_score numeric(5,4),
  pose_label text,
  created_at timestamptz not null default now()
);

create table public.face_embeddings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  enrollment_id uuid not null references public.face_enrollments(id),
  model_version text not null,
  pipeline_version text not null,
  embedding real[] not null,
  source_frame_ids uuid[] not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  active boolean not null default true,
  unique (student_id, model_version, pipeline_version, active)
);

create table public.lecture_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  title text not null,
  started_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'closed'))
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lecture_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  status public.attendance_status not null,
  confidence numeric(5,4),
  source text not null check (source in ('face', 'manual', 'import')),
  reason text,
  marked_by uuid references public.profiles(id),
  marked_at timestamptz not null default now(),
  unique (lecture_id, student_id)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  title text not null,
  max_marks numeric(8,2) not null check (max_marks > 0),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (course_id, title)
);

create table public.marks (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  value numeric(8,2) not null check (value >= 0),
  published boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('marks', 'attendance')),
  status public.import_status not null default 'preview',
  file_name text not null,
  created_by uuid references public.profiles(id),
  committed_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports(id) on delete cascade,
  row_number integer not null,
  student_identifier text,
  payload jsonb not null,
  validation_status text not null check (validation_status in ('valid', 'error')),
  messages text[] not null default '{}'
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id),
  title text not null,
  body text not null,
  created_by uuid references public.profiles(id),
  published_at timestamptz not null default now()
);

create table public.student_issues (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  target_type text not null check (target_type in ('attendance', 'mark')),
  target_id uuid not null,
  status public.issue_status not null default 'open',
  message text not null,
  admin_note text,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and deleted_at is null
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger courses_touch before update on public.courses for each row execute function public.touch_updated_at();
create trigger face_enrollments_touch before update on public.face_enrollments for each row execute function public.touch_updated_at();
create trigger student_issues_touch before update on public.student_issues for each row execute function public.touch_updated_at();

create or replace function public.audit_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    null
  );
  return coalesce(new, old);
end;
$$;

create trigger attendance_audit after insert or update or delete on public.attendance_records for each row execute function public.audit_change();
create trigger marks_audit after insert or update or delete on public.marks for each row execute function public.audit_change();
create trigger issues_audit after insert or update or delete on public.student_issues for each row execute function public.audit_change();

create or replace function public.claim_next_enrollment(p_worker text)
returns public.face_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.face_enrollments;
begin
  if not public.is_admin() then
    raise exception 'Only admins can claim enrollment jobs';
  end if;

  update public.face_enrollments
  set state = 'processing', lock_owner = p_worker, locked_at = now(), failure_reason = null
  where id = (
    select id
    from public.face_enrollments
    where state = 'queued'
      and (locked_at is null or locked_at < now() - interval '10 minutes')
    order by created_at
    for update skip locked
    limit 1
  )
  returning * into claimed;

  return claimed;
end;
$$;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_memberships enable row level security;
alter table public.face_enrollments enable row level security;
alter table public.face_enrollment_frames enable row level security;
alter table public.face_embeddings enable row level security;
alter table public.lecture_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.assessments enable row level security;
alter table public.marks enable row level security;
alter table public.imports enable row level security;
alter table public.import_rows enable row level security;
alter table public.announcements enable row level security;
alter table public.student_issues enable row level security;
alter table public.audit_logs enable row level security;

create policy "own profile or admin" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "admin writes profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy "student creates own profile" on public.profiles for insert with check (id = auth.uid() and role = 'student');
create policy "student updates own profile" on public.profiles for update using (id = auth.uid() and role = 'student') with check (id = auth.uid() and role = 'student');

create policy "course read for members and admins" on public.courses for select using (
  public.is_admin() or exists (
    select 1 from public.course_memberships cm where cm.course_id = id and cm.student_id = auth.uid() and cm.deleted_at is null
  )
);
create policy "admin manages courses" on public.courses for all using (public.is_admin()) with check (public.is_admin());

create policy "membership read own or admin" on public.course_memberships for select using (student_id = auth.uid() or public.is_admin());
create policy "admin manages memberships" on public.course_memberships for all using (public.is_admin()) with check (public.is_admin());

create policy "own enrollment or admin" on public.face_enrollments for select using (student_id = auth.uid() or public.is_admin());
create policy "student inserts own enrollment" on public.face_enrollments for insert with check (student_id = auth.uid());
create policy "student updates own capture states" on public.face_enrollments for update using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy "admin manages enrollments" on public.face_enrollments for all using (public.is_admin()) with check (public.is_admin());

create policy "own frames or admin" on public.face_enrollment_frames for select using (student_id = auth.uid() or public.is_admin());
create policy "student uploads own frame metadata" on public.face_enrollment_frames for insert with check (student_id = auth.uid());
create policy "admin manages frame metadata" on public.face_enrollment_frames for all using (public.is_admin()) with check (public.is_admin());

create policy "admin reads embeddings" on public.face_embeddings for select using (public.is_admin());
create policy "admin writes embeddings" on public.face_embeddings for all using (public.is_admin()) with check (public.is_admin());

create policy "lectures read own course or admin" on public.lecture_sessions for select using (
  public.is_admin() or exists (
    select 1 from public.course_memberships cm where cm.course_id = lecture_sessions.course_id and cm.student_id = auth.uid() and cm.deleted_at is null
  )
);
create policy "admin manages lectures" on public.lecture_sessions for all using (public.is_admin()) with check (public.is_admin());

create policy "attendance read own or admin" on public.attendance_records for select using (student_id = auth.uid() or public.is_admin());
create policy "admin manages attendance" on public.attendance_records for all using (public.is_admin()) with check (public.is_admin());

create policy "published assessments read members" on public.assessments for select using (
  public.is_admin() or (published and exists (
    select 1 from public.course_memberships cm where cm.course_id = assessments.course_id and cm.student_id = auth.uid() and cm.deleted_at is null
  ))
);
create policy "admin manages assessments" on public.assessments for all using (public.is_admin()) with check (public.is_admin());

create policy "published marks read own" on public.marks for select using (
  public.is_admin() or (student_id = auth.uid() and published)
);
create policy "admin manages marks" on public.marks for all using (public.is_admin()) with check (public.is_admin());

create policy "admin manages imports" on public.imports for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manages import rows" on public.import_rows for all using (public.is_admin()) with check (public.is_admin());

create policy "announcements read members" on public.announcements for select using (
  public.is_admin() or course_id is null or exists (
    select 1 from public.course_memberships cm where cm.course_id = announcements.course_id and cm.student_id = auth.uid() and cm.deleted_at is null
  )
);
create policy "admin manages announcements" on public.announcements for all using (public.is_admin()) with check (public.is_admin());

create policy "issues read own or admin" on public.student_issues for select using (student_id = auth.uid() or public.is_admin());
create policy "student creates own issue" on public.student_issues for insert with check (student_id = auth.uid());
create policy "admin manages issues" on public.student_issues for all using (public.is_admin()) with check (public.is_admin());

create policy "admin reads audit" on public.audit_logs for select using (public.is_admin());

insert into storage.buckets (id, name, public)
values ('face-frames', 'face-frames', false)
on conflict (id) do nothing;

create policy "students upload own private face frames"
on storage.objects for insert
with check (
  bucket_id = 'face-frames'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "students read own face frames"
on storage.objects for select
using (
  bucket_id = 'face-frames'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "admins manage face frames"
on storage.objects for all
using (bucket_id = 'face-frames' and public.is_admin())
with check (bucket_id = 'face-frames' and public.is_admin());

create table if not exists public.mark_components (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  key text not null,
  label text not null,
  max_marks numeric(8,2) not null default 0 check (max_marks >= 0),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, key)
);

create table if not exists public.mark_component_scores (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.mark_components(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  value numeric(8,2) not null default 0 check (value >= 0),
  published boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (component_id, student_id)
);

alter table public.mark_components enable row level security;
alter table public.mark_component_scores enable row level security;

create trigger mark_components_touch before update on public.mark_components for each row execute function public.touch_updated_at();
create trigger mark_component_scores_audit after insert or update or delete on public.mark_component_scores for each row execute function public.audit_change();

create policy "published mark components read members" on public.mark_components for select using (
  public.is_admin() or exists (
    select 1 from public.course_memberships cm where cm.course_id = mark_components.course_id and cm.student_id = auth.uid() and cm.deleted_at is null
  )
);
create policy "admin manages mark components" on public.mark_components for all using (public.is_admin()) with check (public.is_admin());

create policy "published component scores read own" on public.mark_component_scores for select using (
  public.is_admin() or (student_id = auth.uid() and published)
);
create policy "admin manages component scores" on public.mark_component_scores for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, student_id, email, phone)
  values (
    new.id,
    'student',
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'student_id', 'STU-' || left(new.id::text, 8)),
    new.email,
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();
