-- A failed registration retry must replace its previous capture completely.
-- Students may delete only objects inside their own private Storage folder.

drop policy if exists "students delete own private face frames" on storage.objects;

create policy "students delete own private face frames"
on storage.objects for delete
using (
  bucket_id = 'face-frames'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create or replace function public.prepare_face_enrollment_replacement(
  p_enrollment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  enrollment public.face_enrollments;
begin
  select *
  into enrollment
  from public.face_enrollments
  where id = p_enrollment_id
  for update;

  if enrollment.id is null then
    raise exception 'Face enrollment was not found';
  end if;

  if enrollment.student_id <> auth.uid() and not public.is_admin() then
    raise exception 'You cannot replace this face enrollment';
  end if;

  if enrollment.state in ('queued', 'processing', 'ready') then
    raise exception 'Queued, processing, or ready enrollments cannot be replaced';
  end if;

  -- Remove stale vectors before their source frame rows are removed. This also
  -- prevents attendance from using an embedding from a failed older attempt.
  delete from public.face_embeddings
  where student_id = enrollment.student_id;

  delete from public.face_enrollment_frames
  where enrollment_id = enrollment.id;

  update public.face_enrollments
  set state = 'uploading',
      frame_count = 0,
      lock_owner = null,
      locked_at = null,
      failure_reason = null,
      updated_at = now()
  where id = enrollment.id;

  return enrollment.id;
end;
$$;

revoke all on function public.prepare_face_enrollment_replacement(uuid) from public;
grant execute on function public.prepare_face_enrollment_replacement(uuid) to authenticated;
