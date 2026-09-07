-- Reprocessing replaces old embeddings and serializes concurrent writes per enrollment.
-- This avoids 409 conflicts from the legacy four-column active-state constraint.

alter table public.face_embeddings
  drop constraint if exists face_embeddings_student_id_model_version_pipeline_version_active_key;

drop index if exists public.face_embeddings_one_active_per_pipeline;

create unique index face_embeddings_one_active_per_pipeline
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
declare
  enrollment_student_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  -- The row lock ensures two browser requests cannot write an active embedding
  -- for the same enrollment at the same time.
  select student_id
  into enrollment_student_id
  from public.face_enrollments
  where id = p_enrollment_id
  for update;

  if enrollment_student_id is null or enrollment_student_id <> p_student_id then
    raise exception 'Enrollment does not belong to this student';
  end if;

  if coalesce(array_length(p_embedding, 1), 0) = 0 then
    raise exception 'Embedding vector cannot be empty';
  end if;

  -- Reprocessing is replacement, not history accumulation. Removing every old
  -- vector also works safely on databases that previously retained inactive rows.
  delete from public.face_embeddings
  where student_id = p_student_id;

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
  set state = 'ready',
      lock_owner = null,
      locked_at = null,
      failure_reason = null,
      updated_at = now()
  where id = p_enrollment_id;
end;
$$;

revoke all on function public.complete_face_enrollment_processing(uuid, uuid, real[], text, text, uuid[]) from public;
grant execute on function public.complete_face_enrollment_processing(uuid, uuid, real[], text, text, uuid[]) to authenticated;
