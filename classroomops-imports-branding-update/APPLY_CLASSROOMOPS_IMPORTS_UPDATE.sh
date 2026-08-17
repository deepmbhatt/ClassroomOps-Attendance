#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

for path in \
  README.md \
  public/classroomops-logo.svg \
  src/lib/demoData.ts \
  src/lib/importValidation.ts \
  src/pages/AdminStudents.tsx \
  src/pages/Dashboard.tsx \
  src/pages/Login.tsx \
  src/pages/MarksImports.tsx \
  src/styles.css \
  src/types.ts \
  supabase/migrations/202608170001_initial_platform.sql \
  supabase/migrations/202608180002_assessment_metadata_imports.sql
do
  mkdir -p "$(dirname "$path")"
  cp "classroomops-imports-branding-update/$path" "$path"
done

echo "ClassroomOps imports/branding update applied. Now run: npm run test -- --run && npm run build"
