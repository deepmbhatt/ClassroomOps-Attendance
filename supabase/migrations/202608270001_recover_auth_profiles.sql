-- Recover Auth registrations that do not have a public profile and keep the repair available to admins.

create or replace function public.sync_missing_auth_profiles()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  inserted_count integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  insert into public.profiles (id, role, full_name, student_id, email, phone, approval_status)
  select
    account.id,
    'student'::public.app_role,
    coalesce(nullif(trim(account.raw_user_meta_data->>'full_name'), ''), split_part(account.email, '@', 1), 'Student'),
    case
      when nullif(trim(account.raw_user_meta_data->>'student_id'), '') is not null
        and not exists (
          select 1 from public.profiles existing
          where lower(existing.student_id) = lower(trim(account.raw_user_meta_data->>'student_id'))
        )
      then trim(account.raw_user_meta_data->>'student_id')
      else 'STU-' || replace(account.id::text, '-', '')
    end,
    account.email,
    nullif(trim(account.raw_user_meta_data->>'phone'), ''),
    'pending'
  from auth.users account
  where account.email is not null
    and not exists (select 1 from public.profiles profile where profile.id = account.id)
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.sync_missing_auth_profiles() from public;
grant execute on function public.sync_missing_auth_profiles() to authenticated;

select public.sync_missing_auth_profiles();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_student_id text;
begin
  requested_student_id := nullif(trim(new.raw_user_meta_data->>'student_id'), '');

  if requested_student_id is null or exists (
    select 1 from public.profiles where lower(student_id) = lower(requested_student_id)
  ) then
    requested_student_id := 'STU-' || replace(new.id::text, '-', '');
  end if;

  insert into public.profiles (id, role, full_name, student_id, email, phone, approval_status)
  values (
    new.id,
    'student',
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    requested_student_id,
    new.email,
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    'pending'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

-- Allow embedding history while enforcing only one active vector per student and pipeline.
alter table public.face_embeddings
  drop constraint if exists face_embeddings_student_id_model_version_pipeline_version_active_key;

create unique index if not exists face_embeddings_one_active_per_pipeline
  on public.face_embeddings (student_id, model_version, pipeline_version)
  where active;

create or replace function public.complete_face_enrollment_processing(
  p_enrollment_id uuid,
  p_student_id uuid,
  p_embedding real[],
  p_model_version text,
  p_pipeline_version text,
  p_source_frame_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  if not exists (
    select 1
    from public.face_enrollments
    where id = p_enrollment_id and student_id = p_student_id
  ) then
    raise exception 'Enrollment does not belong to this student';
  end if;

  update public.face_embeddings
  set active = false
  where student_id = p_student_id and active;

  insert into public.face_embeddings (
    student_id,
    enrollment_id,
    model_version,
    pipeline_version,
    embedding,
    source_frame_ids,
    created_by,
    active
  )
  values (
    p_student_id,
    p_enrollment_id,
    p_model_version,
    p_pipeline_version,
    p_embedding,
    p_source_frame_ids,
    auth.uid(),
    true
  );

  update public.face_enrollments
  set state = 'ready', lock_owner = null, locked_at = null, failure_reason = null
  where id = p_enrollment_id;
end;
$$;

revoke all on function public.complete_face_enrollment_processing(uuid, uuid, real[], text, text, uuid[]) from public;
grant execute on function public.complete_face_enrollment_processing(uuid, uuid, real[], text, text, uuid[]) to authenticated;
