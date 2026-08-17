# ClassroomOps Attendance Platform

Responsive classroom management and facial-attendance web app with Supabase-ready auth, database, storage, RLS, biometric enrollment, attendance, marks, imports, issues, and audit workflows.

## 1. Check Locally First

```bash
cd classroom-attendance-platform
npm install
npm run test
npm run build
npm run dev
```

Open:

```text
http://localhost:5174/
```

For local demo mode without Supabase, set this in `.env`:

```bash
VITE_DEV_AUTH_BYPASS=true
```

Production must keep `VITE_DEV_AUTH_BYPASS=false` or omit it. Demo mode is opt-in only.

## 2. Push To GitHub

Create a new GitHub repository, then run:

```bash
cd classroom-attendance-platform
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Confirm GitHub contains:

- `package.json`
- `src/`
- `public/classroomops-logo.svg`
- `supabase/migrations/202608170001_initial_platform.sql`
- `vercel.json`
- `.env.example`

## 3. Supabase Backend Setup

1. Create a new Supabase project.
2. Open `SQL Editor`.
3. Copy and run the full SQL from:

```text
supabase/migrations/202608170001_initial_platform.sql
```

4. Go to `Authentication > Providers` and enable `Email`.
5. Go to `Authentication > URL Configuration` and add redirect URLs:

```text
http://localhost:5174
https://YOUR_VERCEL_DOMAIN.vercel.app
```

6. Go to `Storage` and confirm bucket `face-frames` exists and is private.
7. Keep Row Level Security enabled. The migration creates the required policies.

## 4. First Admin User

1. Sign up once through the app using your real admin email.
2. In Supabase SQL Editor, run:

```sql
update public.profiles
set role = 'admin'
where email = 'your-admin-email@example.com';
```

All app signups are forced to `student`. Only promote admins from Supabase SQL after you have verified the user.

If no profile row exists yet, get the user id from `Authentication > Users`, then insert:

```sql
insert into public.profiles (id, role, full_name, email)
values ('AUTH_USER_UUID_HERE', 'admin', 'Admin User', 'your-admin-email@example.com');
```

## 5. Frontend Environment Variables

For local Supabase mode, create `.env`:

```bash
cp .env.example .env
```

Set:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DEV_AUTH_BYPASS=false
VITE_FACE_EMBEDDING_MODEL=/models/face-embedding.onnx
```

Find values in Supabase:

- `Project Settings > API > Project URL`
- `Project Settings > API > anon public key`

Restart after changing env vars:

```bash
npm run dev
```

## 6. Vercel Frontend Deployment

1. Go to Vercel.
2. Click `Add New > Project`.
3. Import your GitHub repo.
4. Configure:

```text
Framework Preset: Vite
Root Directory: classroom-attendance-platform
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

If your GitHub repo root is already `classroom-attendance-platform`, leave Root Directory as project root.

5. Add Environment Variables in Vercel:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DEV_AUTH_BYPASS=false
VITE_FACE_EMBEDDING_MODEL=/models/face-embedding.onnx
```

6. Deploy.
7. Copy the deployed Vercel URL.
8. Add that URL in Supabase `Authentication > URL Configuration`.
9. Test signup/login on the deployed URL.

`vercel.json` is included so browser refreshes on routes like `/admin/marks` and `/student/face` work correctly.

## 7. Marks Excel Format

Recommended CSV/Excel headers:

```text
Student ID,Insem 1,Insem 2,End Sem,Total,Lab Marks,Challenges,Project
```

The admin marks page lets you edit the visible table columns. The backend supports configurable columns through:

- `mark_components`
- `mark_component_scores`

## 8. Logo

The logo is here:

```text
public/classroomops-logo.svg
```

Use it for Vercel/project branding, favicon conversion, README previews, or college submission documents.

## 9. Production Notes

- Student pages show available lectures/labs first, grouped by day, then published marks.
- Admin pages handle CPU/WebGPU biometric processing.
- Students do not generate embeddings or run attendance recognition.
- Attendance is online-only in v1.
- Supabase is the persistent source of truth.

## 10. Troubleshooting: 400 While Loading

If the browser console says `Failed to load resource: the server responded with a status of 400`, it is usually a Supabase REST query problem.

Check these first:

1. Run the latest full migration SQL again in Supabase SQL Editor.
2. Confirm these tables exist: `profiles`, `courses`, `lecture_sessions`, `mark_components`, `mark_component_scores`.
3. Confirm Vercel env vars are correct and redeploy after changing them.
4. In browser DevTools, open `Network`, click the failed `rest/v1/...` request, and read the JSON error message.
5. Make sure `VITE_DEV_AUTH_BYPASS=false` only when Supabase is fully configured.

The frontend now avoids nested Supabase relationship selects, which removes the most common PostgREST 400 cause.
