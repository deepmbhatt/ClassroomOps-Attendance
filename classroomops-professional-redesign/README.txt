ClassroomOps professional redesign direct update

From the folder containing both this extracted update and your project:

  bash classroomops-professional-redesign/APPLY_CLASSROOMOPS_REDESIGN.sh classroom-attendance-platform

If you are already inside classroom-attendance-platform:

  bash ../classroomops-professional-redesign/APPLY_CLASSROOMOPS_REDESIGN.sh .

Then run:

  npm install
  npm run test -- --run
  npm run build
  supabase db push

The Supabase migration changes assessment uniqueness so the same assessment name can be used in different academic years and semesters.
