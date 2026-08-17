# Classroom Attendance Platform

Responsive classroom management and facial-attendance web app.

## Quick Start

```bash
cd classroom-attendance-platform
npm install
cp .env.example .env
npm run dev
```

With `VITE_DEV_AUTH_BYPASS=true`, the app runs with seeded demo data and role switching. For production, create a fresh Supabase project, run the SQL in `supabase/migrations`, create the private `face-frames` bucket, and set `VITE_DEV_AUTH_BYPASS=false`.

## Architecture

- Supabase Auth and Postgres are the source of truth.
- Students upload selected face frames only after explicit consent.
- Admin pages perform biometric enrollment and attendance recognition locally in the browser.
- Browser ML uses MediaPipe for face detection and ONNX Runtime Web for embeddings, defaulting to CPU/WASM with optional WebGPU on admin devices.
- V1 is online-only. The attendance terminal blocks marking when offline.
