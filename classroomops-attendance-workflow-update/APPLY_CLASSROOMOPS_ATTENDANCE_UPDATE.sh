#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REQUESTED_TARGET="${1:-}"
TARGET=""

is_classroomops_project() {
  local candidate="$1"
  [ -f "$candidate/package.json" ] &&
    grep -q '"name"[[:space:]]*:[[:space:]]*"classroom-attendance-platform"' "$candidate/package.json"
}

if [ -n "$REQUESTED_TARGET" ] && is_classroomops_project "$REQUESTED_TARGET"; then
  TARGET="$(cd "$REQUESTED_TARGET" && pwd)"
elif is_classroomops_project "."; then
  TARGET="$(pwd)"
elif is_classroomops_project "./classroom-attendance-platform"; then
  TARGET="$(cd "./classroom-attendance-platform" && pwd)"
else
  echo "Could not find the ClassroomOps project."
  echo "Run this script from inside classroom-attendance-platform, or pass its correct path."
  echo "Example: bash $0 /Users/you/Downloads/classroom-attendance-platform"
  exit 1
fi

echo "Applying attendance workflow update to: $TARGET"
cp -R "$SCRIPT_DIR/files/." "$TARGET/"

if [ ! -f "$TARGET/supabase/migrations/202609020002_attendance_finalization.sql" ]; then
  echo "Update verification failed: attendance migration was not copied."
  exit 1
fi

echo
echo "Update applied successfully."
echo "Next commands:"
echo "  cd \"$TARGET\""
echo "  npm install"
echo "  npm run test -- --run"
echo "  npm run build"
echo "  supabase link --project-ref aeztexysqucyzxqzfiwr"
echo "  supabase db push"
