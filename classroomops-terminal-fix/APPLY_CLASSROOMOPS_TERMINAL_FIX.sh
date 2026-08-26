#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-.}"
cd "$TARGET"
mkdir -p src/pages
cp "${OLDPWD}/classroomops-terminal-fix/src/pages/AttendanceTerminal.tsx" src/pages/AttendanceTerminal.tsx
echo "Applied terminal camera/button fix to $PWD"
echo "Now run: npm run test -- --run && npm run build"
