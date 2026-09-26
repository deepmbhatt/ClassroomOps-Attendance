-- Keep student face enrollment updates limited to capture/upload states.
-- Admin processing still uses admin policies and claim_next_enrollment().

drop policy if exists "student updates own capture states" on public.face_enrollments;

create policy "student updates own capture states"
on public.face_enrollments
for update
using (student_id = auth.uid() and state in ('not_started', 'capturing', 'uploading', 'upload_failed', 'quality_failed', 'processing_failed'))
with check (student_id = auth.uid() and state in ('capturing', 'uploading', 'queued', 'upload_failed'));
