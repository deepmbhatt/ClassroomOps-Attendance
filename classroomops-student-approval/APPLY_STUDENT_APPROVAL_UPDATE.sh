#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" != "" ]; then
  TARGET="$1"
elif [ -f "package.json" ] && [ -d "src" ]; then
  TARGET="."
elif [ -d "classroom-attendance-platform" ]; then
  TARGET="classroom-attendance-platform"
else
  echo "Could not find the ClassroomOps project."
  echo "If you are inside it, run: bash classroomops-student-approval/APPLY_STUDENT_APPROVAL_UPDATE.sh ."
  exit 1
fi

if [ ! -f "$TARGET/package.json" ] || [ ! -d "$TARGET/src" ]; then
  echo "Target is not the ClassroomOps project: $TARGET"
  exit 1
fi

cp -R "$SCRIPT_DIR/files/." "$TARGET/"
echo "Student approval workflow applied to: $TARGET"
echo "IMPORTANT: Run RUN_THIS_IN_SUPABASE.sql in the Supabase Dashboard SQL Editor."
