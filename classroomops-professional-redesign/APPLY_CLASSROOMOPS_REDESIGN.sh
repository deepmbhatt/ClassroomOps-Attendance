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
  echo "Could not find classroom-attendance-platform."
  echo "Run: bash APPLY_CLASSROOMOPS_REDESIGN.sh /full/path/to/classroom-attendance-platform"
  exit 1
fi

if [ ! -f "$TARGET/package.json" ] || [ ! -d "$TARGET/src" ]; then
  echo "Target is not the ClassroomOps project: $TARGET"
  exit 1
fi

cp -R "$SCRIPT_DIR/files/." "$TARGET/"
echo "ClassroomOps professional redesign applied to: $TARGET"
echo "Next: cd \"$TARGET\" && npm install && npm run test -- --run && npm run build"
echo "Also apply the new Supabase migration with: supabase db push"
