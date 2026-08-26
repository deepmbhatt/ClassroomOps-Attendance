#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-.}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$TARGET"
mkdir -p src/lib src/pages
cp "$SCRIPT_DIR/package.json" package.json
cp "$SCRIPT_DIR/package-lock.json" package-lock.json
cp "$SCRIPT_DIR/src/lib/api.ts" src/lib/api.ts
cp "$SCRIPT_DIR/src/lib/importValidation.ts" src/lib/importValidation.ts
cp "$SCRIPT_DIR/src/pages/AdminStudents.tsx" src/pages/AdminStudents.tsx
cp "$SCRIPT_DIR/src/pages/MarksImports.tsx" src/pages/MarksImports.tsx
cp "$SCRIPT_DIR/src/styles.css" src/styles.css
cp "$SCRIPT_DIR/src/types.ts" src/types.ts
echo "Applied admin data management update to $PWD"
echo "Now run: npm install && npm run test -- --run && npm run build"
