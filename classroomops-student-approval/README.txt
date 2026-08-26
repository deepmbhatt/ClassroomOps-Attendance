ClassroomOps student registration approval update

From inside classroom-attendance-platform:

  tar -xzf classroomops-student-approval-update.tar.gz
  bash classroomops-student-approval/APPLY_STUDENT_APPROVAL_UPDATE.sh .
  npm run test -- --run
  npm run build

Database:
1. Open your Supabase project.
2. Open SQL Editor.
3. Paste and run classroomops-student-approval/RUN_THIS_IN_SUPABASE.sql.
4. Refresh the admin website.
5. Open Courses & students > Pending approvals.

Existing students with an active course membership remain approved.
Existing self-registrations without a course become pending for review.
