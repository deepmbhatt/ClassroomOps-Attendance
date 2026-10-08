-- Single-device application sessions and secure, attendance-gated exam access.
create table if not exists public.active_app_sessions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  session_key text not null,
  device_label text,
  claimed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.active_app_sessions enable row level security;
create policy "users read own active app session"
on public.active_app_sessions for select
using (user_id = auth.uid());

create or replace function public.claim_app_session(p_session_key text, p_device_label text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or nullif(btrim(p_session_key), '') is null then
    raise exception 'Authenticated session key is required';
  end if;

  insert into public.active_app_sessions(user_id, session_key, device_label, claimed_at, last_seen_at)
  values (auth.uid(), p_session_key, nullif(btrim(p_device_label), ''), now(), now())
  on conflict (user_id) do update
  set session_key = excluded.session_key,
      device_label = excluded.device_label,
      claimed_at = now(),
      last_seen_at = now();
end;
$$;

create or replace function public.check_or_register_app_session(p_session_key text, p_device_label text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_key text;
begin
  if auth.uid() is null then return false; end if;

  select session_key into current_key
  from public.active_app_sessions
  where user_id = auth.uid();

  if current_key is null then
    perform public.claim_app_session(p_session_key, p_device_label);
    return true;
  end if;

  if current_key = p_session_key then
    update public.active_app_sessions set last_seen_at = now() where user_id = auth.uid();
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.release_app_session(p_session_key text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.active_app_sessions
  where user_id = auth.uid() and session_key = p_session_key;
$$;

create or replace function public.is_current_app_session_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.active_app_sessions
    where user_id = auth.uid()
      and session_key = coalesce(
        (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-app-session-key'),
        ''
      )
  );
$$;

revoke all on function public.claim_app_session(text, text) from public;
revoke all on function public.check_or_register_app_session(text, text) from public;
revoke all on function public.release_app_session(text) from public;
grant execute on function public.claim_app_session(text, text) to authenticated;
grant execute on function public.check_or_register_app_session(text, text) to authenticated;
grant execute on function public.release_app_session(text) to authenticated;

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  attendance_session_id uuid references public.lecture_sessions(id) on delete set null,
  title text not null,
  instructions text,
  exit_instruction text,
  starts_at timestamptz,
  ends_at timestamptz,
  exit_release_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_window_valid check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.exam_access (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  verification_code_hint text,
  exit_code_hint text,
  attendance_record_id uuid references public.attendance_records(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  code_verified_at timestamptz,
  link_opened_at timestamptz,
  exit_review_status text not null default 'pending' check (exit_review_status in ('pending', 'matched', 'manual_review')),
  exit_checked_at timestamptz,
  exit_checked_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id)
);

create table if not exists public.exam_access_secrets (
  access_id uuid primary key references public.exam_access(id) on delete cascade,
  individual_url text not null,
  verification_code_hash text not null,
  expected_exit_code_hash text,
  updated_at timestamptz not null default now(),
  constraint secret_unstop_https_link check (lower(individual_url) ~ '^https://([a-z0-9-]+\.)*unstop\.com(/|$)')
);

create trigger exams_touch before update on public.exams
for each row execute function public.touch_updated_at();
create trigger exam_access_touch before update on public.exam_access
for each row execute function public.touch_updated_at();

alter table public.exams enable row level security;
alter table public.exam_access enable row level security;
alter table public.exam_access_secrets enable row level security;

create policy "staff manage exams" on public.exams
for all using (public.is_admin()) with check (public.is_admin());
create policy "approved students read exams" on public.exams
for select using (
  exists (
    select 1 from public.exam_access ea
    where ea.exam_id = exams.id
      and ea.student_id = auth.uid()
      and ea.approved_at is not null
  )
);

create policy "staff manage exam access" on public.exam_access
for all using (public.is_admin()) with check (public.is_admin());
create policy "students read approved own exam access" on public.exam_access
for select using (student_id = auth.uid() and approved_at is not null);
create policy "staff manage exam secrets" on public.exam_access_secrets
for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.upsert_exam_access(
  p_exam_id uuid,
  p_student_identifier text,
  p_individual_url text,
  p_verification_code text,
  p_expected_exit_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_student uuid;
  target_access uuid;
  normalized_verification text := nullif(btrim(p_verification_code), '');
  normalized_exit text := nullif(btrim(p_expected_exit_code), '');
begin
  if not public.is_admin() then raise exception 'Staff access is required'; end if;
  if lower(btrim(p_individual_url)) !~ '^https://([a-z0-9-]+\.)*unstop\.com(/|$)' then
    raise exception 'A valid HTTPS Unstop link is required';
  end if;

  select id into target_student
  from public.profiles
  where role = 'student' and deleted_at is null
    and lower(btrim(student_id)) = lower(btrim(p_student_identifier));
  if target_student is null then raise exception 'Student ID was not found: %', p_student_identifier; end if;

  select id into target_access from public.exam_access
  where exam_id = p_exam_id and student_id = target_student;

  if target_access is null and normalized_verification is null then
    raise exception 'Verification Code is required for new access rows';
  end if;

  insert into public.exam_access(
    exam_id, student_id, verification_code_hint, exit_code_hint
  ) values (
    p_exam_id, target_student,
    case when normalized_verification is null then null else right(normalized_verification, 2) end,
    case when normalized_exit is null then null else right(normalized_exit, 2) end
  )
  on conflict (exam_id, student_id) do update
  set verification_code_hint = coalesce(excluded.verification_code_hint, exam_access.verification_code_hint),
      exit_code_hint = coalesce(excluded.exit_code_hint, exam_access.exit_code_hint),
      code_verified_at = case when normalized_verification is null then exam_access.code_verified_at else null end,
      link_opened_at = case when normalized_verification is null then exam_access.link_opened_at else null end,
      exit_review_status = case when normalized_exit is null then exam_access.exit_review_status else 'pending' end,
      exit_checked_at = case when normalized_exit is null then exam_access.exit_checked_at else null end,
      exit_checked_by = case when normalized_exit is null then exam_access.exit_checked_by else null end
  returning id into target_access;

  insert into public.exam_access_secrets(access_id, individual_url, verification_code_hash, expected_exit_code_hash)
  values (
    target_access,
    btrim(p_individual_url),
    coalesce(crypt(normalized_verification, gen_salt('bf')), ''),
    case when normalized_exit is null then null else crypt(normalized_exit, gen_salt('bf')) end
  )
  on conflict (access_id) do update
  set individual_url = excluded.individual_url,
      verification_code_hash = case
        when normalized_verification is null then exam_access_secrets.verification_code_hash
        else crypt(normalized_verification, gen_salt('bf'))
      end,
      expected_exit_code_hash = case
        when normalized_exit is null then exam_access_secrets.expected_exit_code_hash
        else crypt(normalized_exit, gen_salt('bf'))
      end,
      updated_at = now();

  return target_access;
end;
$$;

create or replace function public.approve_exam_access(p_access_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  verified_attendance uuid;
begin
  if not public.is_admin() then raise exception 'Staff access is required'; end if;

  select ar.id into verified_attendance
  from public.exam_access ea
  join public.exams e on e.id = ea.exam_id
  join public.attendance_records ar
    on ar.lecture_id = e.attendance_session_id
   and ar.student_id = ea.student_id
  where ea.id = p_access_id
    and ar.status in ('present', 'late')
    and ar.source = 'face';

  if verified_attendance is null then
    raise exception 'Face-verified attendance is required before exam approval';
  end if;

  update public.exam_access
  set attendance_record_id = verified_attendance,
      approved_at = now(),
      approved_by = auth.uid()
  where id = p_access_id;
end;
$$;

create or replace function public.revoke_exam_access(p_access_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Staff access is required'; end if;
  update public.exam_access
  set approved_at = null, approved_by = null, attendance_record_id = null,
      code_verified_at = null, link_opened_at = null
  where id = p_access_id;
end;
$$;

create or replace function public.verify_exam_access_code(p_access_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_hash text;
  allowed boolean;
begin
  if not public.is_current_app_session_request() then return false; end if;

  select s.verification_code_hash,
         ea.student_id = auth.uid()
         and ea.approved_at is not null
         and e.status = 'open'
         and (e.starts_at is null or now() >= e.starts_at)
         and (e.ends_at is null or now() <= e.ends_at)
  into expected_hash, allowed
  from public.exam_access ea
  join public.exam_access_secrets s on s.access_id = ea.id
  join public.exams e on e.id = ea.exam_id
  where ea.id = p_access_id;

  if not coalesce(allowed, false) then return false; end if;
  if expected_hash is null or crypt(btrim(p_code), expected_hash) <> expected_hash then return false; end if;

  update public.exam_access set code_verified_at = now() where id = p_access_id;
  return true;
end;
$$;

create or replace function public.record_exam_link_opened(p_access_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_url text;
begin
  if not public.is_current_app_session_request() then raise exception 'This session was replaced by another login'; end if;

  update public.exam_access ea
  set link_opened_at = coalesce(link_opened_at, now())
  from public.exams e, public.exam_access_secrets s
  where ea.id = p_access_id
    and e.id = ea.exam_id
    and s.access_id = ea.id
    and ea.student_id = auth.uid()
    and ea.approved_at is not null
    and ea.code_verified_at is not null
    and e.status = 'open'
    and (e.starts_at is null or now() >= e.starts_at)
    and (e.ends_at is null or now() <= e.ends_at)
  returning s.individual_url into target_url;
  if target_url is null then raise exception 'Exam link is not available'; end if;
  return target_url;
end;
$$;

create or replace function public.review_exam_exit_code(p_access_id uuid, p_submitted_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_hash text;
  review_result text;
begin
  if not public.is_admin() then raise exception 'Staff access is required'; end if;
  select expected_exit_code_hash into expected_hash
  from public.exam_access_secrets where access_id = p_access_id;

  review_result := case
    when expected_hash is not null and crypt(btrim(p_submitted_code), expected_hash) = expected_hash then 'matched'
    else 'manual_review'
  end;

  update public.exam_access
  set exit_review_status = review_result,
      exit_checked_at = now(),
      exit_checked_by = auth.uid()
  where id = p_access_id;
  return review_result;
end;
$$;

revoke all on function public.upsert_exam_access(uuid, text, text, text, text) from public;
revoke all on function public.approve_exam_access(uuid) from public;
revoke all on function public.revoke_exam_access(uuid) from public;
revoke all on function public.verify_exam_access_code(uuid, text) from public;
revoke all on function public.record_exam_link_opened(uuid) from public;
revoke all on function public.review_exam_exit_code(uuid, text) from public;
grant execute on function public.upsert_exam_access(uuid, text, text, text, text) to authenticated;
grant execute on function public.approve_exam_access(uuid) to authenticated;
grant execute on function public.revoke_exam_access(uuid) to authenticated;
grant execute on function public.verify_exam_access_code(uuid, text) to authenticated;
grant execute on function public.record_exam_link_opened(uuid) to authenticated;
grant execute on function public.review_exam_exit_code(uuid, text) to authenticated;
