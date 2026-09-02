-- Store optional information supplied during student registration and roster imports.

alter table public.profiles
  add column if not exists additional_info text;

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

  insert into public.profiles (
    id,
    role,
    full_name,
    student_id,
    email,
    phone,
    additional_info,
    approval_status
  )
  values (
    new.id,
    'student',
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    requested_student_id,
    new.email,
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    nullif(trim(new.raw_user_meta_data->>'additional_info'), ''),
    'pending'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

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

  insert into public.profiles (
    id,
    role,
    full_name,
    student_id,
    email,
    phone,
    additional_info,
    approval_status
  )
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
    nullif(trim(account.raw_user_meta_data->>'additional_info'), ''),
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
