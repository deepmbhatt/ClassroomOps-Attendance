#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

rm -rf .openai

for path in \
  README.md \
  src/auth.tsx \
  src/components/Layout.tsx \
  src/lib/supabase.ts \
  src/pages/Login.tsx \
  src/styles.css \
  supabase/migrations/202608170001_initial_platform.sql \
  supabase/migrations/202608180001_lock_student_signup_roles.sql \
  vitest.config.ts
do
  mkdir -p "$(dirname "$path")"
  cp "classroomops-role-fix-direct-update/$path" "$path"
done

echo "ClassroomOps role fix applied. Now run: npm run test -- --run && npm run build"
