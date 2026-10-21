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
http://localhost:5174/reset-password
https://YOUR_VERCEL_DOMAIN.vercel.app
https://YOUR_VERCEL_DOMAIN.vercel.app/reset-password
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
VITE_FACE_EMBEDDING_MODEL=/models/face-recognition-sface-2021dec-int8.onnx
VITE_FACE_MODEL_VERSION=opencv-sface-2021dec-int8-v1
VITE_FACE_MODEL_FAMILY=sface
VITE_FACE_LANDMARKER_MODEL=https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
VITE_FACE_MATCH_THRESHOLD=0.363
VITE_FACE_MATCH_MARGIN=0.04
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
VITE_FACE_EMBEDDING_MODEL=/models/face-recognition-sface-2021dec-int8.onnx
VITE_FACE_MODEL_VERSION=opencv-sface-2021dec-int8-v1
VITE_FACE_MODEL_FAMILY=sface
VITE_FACE_LANDMARKER_MODEL=https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
VITE_FACE_MATCH_THRESHOLD=0.363
VITE_FACE_MATCH_MARGIN=0.04
```

6. Deploy.
7. Copy the deployed Vercel URL.
8. Add that URL in Supabase `Authentication > URL Configuration`.
9. Test signup/login on the deployed URL.

`vercel.json` is included so browser refreshes on routes like `/admin/marks` and `/student/face` work correctly.

## 7. Excel / CSV Import Formats

Student bulk-add format:

```text
Student ID,Full Name,Email,Phone,Course Codes,Temporary Password
CSE001,Ananya Rao,ananya@college.edu,+91 90000 00001,CS601;CS642,Welcome@123
```

Bulk student creation uses the Supabase Edge Function in `supabase/functions/bulk-create-students`. Deploy it after setting Supabase CLI auth:

```bash
supabase functions deploy bulk-create-students
```

The function uses `SUPABASE_SERVICE_ROLE_KEY` on the Supabase backend only. Never put the service-role key in Vercel frontend variables.

Marks are assessment-based. Create/select academic year, semester, course, and assessment first, then upload one file per assessment:

```text
Student ID,Marks,Remarks
CSE001,17,Submitted on time
CSE002,15,
```

Examples: create `Semester 1 / INSEM 1` and upload its file; later create `Semester 1 / INSEM 2` and upload another file. Previous assessment marks stay untouched.

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

1. Run `supabase db push` from the linked project folder so only pending migrations are applied.
2. Confirm these tables exist: `profiles`, `courses`, `lecture_sessions`, `mark_components`, `mark_component_scores`.
3. Confirm Vercel env vars are correct and redeploy after changing them.
4. In browser DevTools, open `Network`, click the failed `rest/v1/...` request, and read the JSON error message.
5. Make sure `VITE_DEV_AUTH_BYPASS=false` only when Supabase is fully configured.

The frontend now avoids nested Supabase relationship selects, which removes the most common PostgREST 400 cause.


## Password Reset And First Login

Bulk-created students receive the temporary password from the CSV. On first login, the app redirects them to `Change your temporary password` before they can use the portal.

Run this migration for existing Supabase projects:

```text
supabase/migrations/202608180003_password_recovery_flags.sql
```

For forgotten passwords, students use `Forgot password?` on the login page. Add `/reset-password` to Supabase Authentication redirect URLs for local and Vercel domains.


## Face Enrollment Upload Flow

Student face capture now uploads selected frames to the private `face-frames` bucket and sets `face_enrollments.state = 'queued'`. Admin biometric processing claims queued jobs through the database RPC.

Run this migration for existing Supabase projects:

```text
supabase/migrations/202608180004_face_enrollment_upload_flow.sql
```


## ONNX Face Model

The recommended recognition model is the mobile-safe quantized OpenCV SFace at `public/models/face-recognition-sface-2021dec-int8.onnx`. The app sets `VITE_FACE_MODEL_FAMILY=sface`, uses SFace's exact raw-RGB 112x112 input contract, and refines each captured face to the canonical five-point eye/nose/mouth alignment. The lightweight detector remains active for idle camera polling; detailed landmarks run only when creating an embedding. Each enrollment and live frame keeps both the canonical five-point view and a detector-box fallback, so unstable landmarks from low-quality cameras do not erase an otherwise valid match.

Download the official model if it is missing:

```bash
mkdir -p public/models
curl -L --fail -o public/models/face-recognition-sface-2021dec-int8.onnx \\
  https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
```

The expected file size is `9896933` bytes. Set `VITE_FACE_MODEL_VERSION` to a unique revision whenever model bytes or preprocessing change. ArcFace embeddings are incompatible with SFace: after deployment, students should make a fresh three-view registration, then the administrator processes the queued captures. Do not compare or retain older embeddings across the model-family change.

## Live Attendance Terminal

The admin attendance terminal uses the classroom/admin camera only. It selects the largest central face when background faces are visible, reuses its aligned crop, and runs adaptive verification: exceptionally strong matches can finish after one frame, normal matches require two agreeing frames, and a third frame is used only for borderline cases. Matching compares the live embedding against every stored enrollment template and still requires both an identity threshold and separation from the second-best student.

Manual controls are available beside the camera: select a student and click `Present`, `Absent`, `Late`, or `Excused`. Keyboard shortcuts work after selecting a student: `P` marks present and `A` marks absent. CSV import supports past/manual corrections with:

```text
Student ID,Status,Marked At,Reason
CSE001,present,2026-08-18T09:00:00+05:30,manual upload
```

Use `Download` at the end to export the final attendance sheet for the selected session.

## Production Upgrade: Recover Hidden Registrations

For an existing deployment, run these commands from the project folder:

```bash
npm install
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
npm run test -- --run
npm run build
```

Do not rerun the initial migration manually on an existing database; `supabase db push` applies only migrations that are still pending. Migration `202608270001_recover_auth_profiles.sql` creates missing `public.profiles` rows for existing Supabase Auth users and marks them pending for approval.

In Vercel, keep only the real `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and face model settings. Delete `VITE_DEV_AUTH_BYPASS` or set it to `false`, then redeploy. Production builds now ignore the demo bypass even if it is accidentally set.

After deployment, sign in as admin and open `Students > Pending approvals`. Click `Sync registrations`, assign course codes, and approve matched students. Older face embeddings are intentionally shown as needing reprocessing because the new detected-crop pipeline cannot safely be mixed with the previous center-crop vectors.

## Reset All Students And Biometrics

This repository includes `supabase/RESET_STUDENT_DATA_KEEP_ADMINS.sql` for a guarded one-time reset. It preserves admin profiles and shared course setup while permanently removing student Auth accounts, profiles, enrollments, embeddings, attendance, marks, memberships, issues, imports, and audit history.

Before running it, empty the private `face-frames` bucket from the Supabase Storage dashboard. Then open the SQL file, verify the expected admin email, and run the whole file in the Supabase SQL Editor.

Student registration now stores phone and optional additional information. Migration `202609020001_add_student_additional_info.sql` adds the profile field and updates signup/profile-recovery triggers. Administrators can view and search these values in Pending Approvals and Student Directory.

## 11. September 2026 Administration Upgrade

For an existing Supabase project, apply all pending migrations in order:

```bash
supabase db push
```

Then deploy both account-management Edge Functions:

```bash
supabase functions deploy bulk-create-students
supabase functions deploy delete-student
```

The `delete-student` function uses `SUPABASE_SERVICE_ROLE_KEY` only inside Supabase. It permanently removes a student's private face objects, linked application records, profile, and Auth user so the same email and student ID can register again.

Administrators can grant or revoke the **Pseudo admin** role from **Courses & students → Student directory**. Pseudo admins can run attendance, process queued face enrollments, manage marks, handle requests, and read audit history. Database policies prevent them from approving, deleting, importing, or editing students and courses.

Historical attendance is available from **Attendance review**: choose the old date and course, create a historical session, upload CSV/Excel by Student ID, review the staged rows, and save. Only a full administrator sees the destructive whole-session delete control.

## 12. Single-Session Security And Secure Exam Gateway

### In-app exams

Apply `202610160001_native_descriptive_exams.sql`, `202610160002_native_exam_warnings_mcq.sql`, `202610160003_native_exam_offline_recovery.sql`, and `202610190001_native_exam_face_gate.sql` through `supabase db push` in migration order, then deploy the updated frontend. Staff use **In-app exams** to create a timed exam, add each descriptive or single-choice MCQ question, choose the number of tab/fullscreen warnings, select a face-attendance session, and set it to Open. Only approved students with a present/late record whose source is `face` for that session can start. The student-side **My exam access** link has been removed; `/student/exams` redirects to the in-app exam page.

The optional four-digit attendance code is generated per face-verified student/session and shown on the staff attendance terminal or in the exam's staff eligibility list. Staff can require no code, an entry code, or both entry and exit codes. The exit code is derived from the attendance code by reversing it, adding a configured number, or subtracting a configured number (four-digit modulo 10000). Staff communicate the currently selected rule to students; it is not revealed on the student screen. Entry and exit checks run server-side with five failed attempts causing a 15-minute lockout. A warning-limit auto-submission cannot ask for an exit code; the CSV explicitly records whether the exit code was verified.

Before a new attempt, the student page measures a 128 KiB download and requires at least 500 kilobits/second, then checks for a laptop/desktop browser, then requests the optional entry code. The exam starts only after the student clicks to enter fullscreen. The screen has Previous/Next, Finish, flag-for-review, green answered / blue unanswered / red flagged question buttons, a word count, and live autosave. Every tab switch, page exit, or fullscreen exit records one warning; reaching the configured limit automatically submits the attempt. Duplicate reports of the same browser event count only once.

During a network outage, the open exam remains usable and answers, flags, questions, deadline, and pending warning/submission events are stored in that browser. The original server-issued deadline continues to count down locally; shutdown time is not restored. At zero, editing stops and a final submission is queued; it is uploaded when connectivity returns, after the exit code is entered if that option is enabled. A student can reopen the same browser on the same device and choose **Recover your exam** after an abrupt shutdown. The 45-second inactivity finalization has been removed, so an interrupted attempt can resume while time remains and the warning limit has not been reached. A pending offline submission is shown as `pending_sync` in the administrator's CSV, not falsely marked as submitted. The CSV contains a row for each face-eligible student or started attempt and a column per question, including the selected MCQ option text.

Use a test student account to verify face attendance, entry/exit codes, online/offline work, reload, timeout, and CSV export before opening a real exam. Students must use the same browser/device and must not clear browser storage before sync confirmation. If browser storage is disabled/full, or the device is lost, unsynced work cannot be recovered. The 500 kbps download check can vary with network conditions, and browser device detection is spoofable. A web page cannot securely prove when offline text was typed, prevent system-clock changes or another device, or reliably detect a sudden power loss; tab/fullscreen warnings are best-effort. A four-digit code is an additional check, not strong two-factor authentication. For a high-stakes proctored exam, use a managed lockdown environment. The export includes the latest answer received by Supabase.

### Student answer review

Apply `202610210001_native_exam_answer_reviews.sql` with `supabase db push` before deploying this frontend. On **In-app exams**, choose a saved exam and use **Publish answer reviews**. Upload one CSV/Excel file with student answers and a second with question marks. Both need an `Enrollment Number` (or `Student ID`) column and one column per saved question. Column headings may be the complete question text or `Q1`, `Q2`, etc. The existing combined exam-response CSV is also accepted as the answers file. For example:

```csv
Enrollment Number,Q1,Q2
202618019,"A written answer",B
202618020,,A
```

In the marks file, the same columns contain non-negative numbers or blank cells. Keep enrollment numbers as text in Excel to avoid losing leading zeros or precision. Import up to 1,000 students per file; split larger cohorts into multiple uploads. Preview errors must be resolved before importing. Uploads are private until an administrator explicitly publishes; students see only their own answer and mark, one question at a time, under **My answer reviews**. Blank answers and marks display as blank. Unpublish before correcting an uploaded file. The browser view disables ordinary text selection, copy, context menu and printing and includes an identity watermark, but browser code cannot prevent screenshots, developer tools, or a camera photo. Do not promise screenshot-proof results.

Apply `202610210002_native_exam_review_window.sql` to enable optional opening and closing times. Set one or both times before publishing. Supabase checks the access window using server time; the student page also hides an already-open review when its closing time passes. A newly opened review may take up to 10 seconds to appear while the page is already open. Previously delivered content cannot be taken back from a browser, so the time limit controls new access rather than preventing a screenshot taken during the window.

### Transfer this update to another checkout

Copy `classroomops-update-20261021.tar.gz` and `apply_classroomops_update.sh` into the other device's `ClassroomOps-Attendance` folder. From that folder run:

```bash
bash ./apply_classroomops_update.sh ./classroomops-update-20261021.tar.gz
```

The script verifies the archive checksum and backs up every file it replaces into a new `classroomops-backup-*` folder. It then extracts the update and runs a build if dependencies are installed. After extraction, run `supabase db push` on the linked project and redeploy the frontend. If the other checkout has local edits to the same files, review the backup before committing or deploying.

Apply the new migration before deploying the frontend:

```bash
supabase db push
supabase functions deploy bulk-create-students
supabase functions deploy delete-student
```

### Single active device

A successful login claims the account for that browser/device and revokes other Supabase refresh sessions. Existing app sessions check ownership every 15 seconds and whenever the window regains focus. A replaced session is signed out with an explanatory message. The device key is also attached to database requests; protected exam-code verification and link release reject a replaced session server-side.

### Legacy external exam gateway

The staff-side external gateway remains for historical records. The student **My exam access** route is no longer exposed; use **In-app exams** for new exams.

1. Staff creates an exam gateway and links it to the face-attendance session.
2. Staff downloads the Master roster CSV, fills each student's `Individual Exam Link`, and uploads it under **Exam access**.
3. Missing `Verification Code` and `Expected Exit Code` values are generated in the browser. Staff must download and securely retain the prepared file before saving.
4. **Approve Exam Access** succeeds only for `present`/`late` attendance whose source is `face`.
5. The older gateway verified individual codes before releasing the protected Unstop URL.
6. The exit instruction appears at `Exit instruction release`, normally five minutes before closing.
7. After Unstop submission, add exported responses to `Submitted Exit Code` in the same prepared CSV and upload it under **Exit review**. Incorrect codes are marked `manual_review`; they never automatically assign zero marks.

The individual URL and code hashes live in the staff-only `exam_access_secrets` table. Students cannot retrieve the URL through ordinary data queries before successful verification.

### One master spreadsheet

`classroomops-master-roster.csv` is downloadable from Courses & students, Attendance review, Marks, and Exam access. Keep `Student ID` as the stable key and fill only the columns needed by the current page. Extra columns are ignored safely.

Because this file can contain passwords, exam links, and verification codes, store it securely and do not commit completed copies to Git.
