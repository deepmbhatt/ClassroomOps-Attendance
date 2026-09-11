-- Normalize account identifiers so capitalization cannot create duplicate identities.
do $$
begin
  if exists (
    select 1 from public.profiles
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'Duplicate profile emails exist after case normalization. Resolve them before applying this migration.';
  end if;

  if exists (
    select 1 from public.profiles
    where student_id is not null
    group by lower(btrim(student_id))
    having count(*) > 1
  ) then
    raise exception 'Duplicate student IDs exist after case normalization. Resolve them before applying this migration.';
  end if;
end;
$$;

create unique index if not exists profiles_email_unique_ci
  on public.profiles (lower(btrim(email)));

create unique index if not exists profiles_student_id_unique_ci
  on public.profiles (lower(btrim(student_id)))
  where student_id is not null;

alter table public.profiles
  drop constraint if exists student_id_not_blank_for_students;

alter table public.profiles
  add constraint student_id_not_blank_for_students
  check (role <> 'student'::public.app_role or nullif(btrim(student_id), '') is not null);

-- Every public registration remains a student account and must supply a unique ID.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_student_id text;
begin
  requested_student_id := nullif(btrim(new.raw_user_meta_data->>'student_id'), '');

  if requested_student_id is null then
    raise exception 'Student ID is required.';
  end if;

  if exists (
    select 1 from public.profiles
    where lower(btrim(student_id)) = lower(requested_student_id)
  ) then
    raise exception 'Student ID is already registered.';
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
    coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    requested_student_id,
    lower(btrim(new.email)),
    nullif(btrim(new.raw_user_meta_data->>'phone'), ''),
    nullif(btrim(new.raw_user_meta_data->>'additional_info'), ''),
    'pending'
  );

  return new;
end;
$$;
