#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

rm -rf .openai

for path in \
  README.md \
  public/classroomops-logo.svg \
  src/App.tsx \
  src/auth.tsx \
  src/components/Layout.tsx \
  src/lib/api.ts \
  src/lib/demoData.ts \
  src/lib/importValidation.ts \
  src/lib/supabase.ts \
  src/pages/AdminStudents.tsx \
  src/pages/ChangePassword.tsx \
  src/pages/Dashboard.tsx \
  src/pages/Login.tsx \
  src/pages/MarksImports.tsx \
  src/styles.css \
  src/types.ts \
  supabase/functions/bulk-create-students/index.ts \
  supabase/migrations/202608170001_initial_platform.sql \
  supabase/migrations/202608180001_lock_student_signup_roles.sql \
  supabase/migrations/202608180002_assessment_metadata_imports.sql \
  supabase/migrations/202608180003_password_recovery_flags.sql \
  vitest.config.ts
do
  mkdir -p "$(dirname "$path")"
  cp "classroomops-combined-students-marks-password-update/$path" "$path"
done

echo "Combined ClassroomOps update applied. Now run: npm run test -- --run && npm run build"
