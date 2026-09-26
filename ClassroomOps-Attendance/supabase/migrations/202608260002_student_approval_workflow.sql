-- Add an explicit approval lifecycle for self-registered student accounts.
alter table public.profiles
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_approval_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end
$$;

-- Preserve administrators and students already assigned to a course.
update public.profiles p
set
  approval_status = 'approved',
  approved_at = coalesce(p.approved_at, now())
where p.role = 'admin'
   or exists (
     select 1
     from public.course_memberships cm
     where cm.student_id = p.id
       and cm.deleted_at is null
   );

-- Existing self-registrations without a course become reviewable.
update public.profiles p
set approval_status = 'pending', approved_at = null, approved_by = null
where p.role = 'student'
  and not exists (
    select 1
    from public.course_memberships cm
    where cm.student_id = p.id
      and cm.deleted_at is null
  );

create or replace function public.protect_profile_approval_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.approval_status := old.approval_status;
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
    new.deleted_at := old.deleted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_approval_fields on public.profiles;
create trigger profiles_protect_approval_fields
before update on public.profiles
for each row execute function public.protect_profile_approval_fields();


create or replace function public.approve_student_on_active_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is null then
    update public.profiles
    set
      approval_status = 'approved',
      approved_at = coalesce(approved_at, now()),
      approved_by = coalesce(approved_by, auth.uid()),
      deleted_at = null
    where id = new.student_id
      and role = 'student';
  end if;
  return new;
end;
$$;

drop trigger if exists course_membership_approves_student on public.course_memberships;
create trigger course_membership_approves_student
after insert or update of deleted_at on public.course_memberships
for each row execute function public.approve_student_on_active_membership();
