import { appSessionKey, devBypass, requireSupabase } from './supabase'
import type { ReviewImportRow, ReviewKind } from './examReviewImport'

export type NativeExam = {
  id: string
  course_id: string
  title: string
  instructions: string | null
  starts_at: string
  ends_at: string
  duration_minutes: number
  warning_limit: number
  attendance_session_id: string | null
  allow_without_attendance: boolean
  code_mode: 'none' | 'entry' | 'entry_exit'
  exit_transform: 'reverse' | 'add' | 'subtract'
  exit_operand: number
  status: 'draft' | 'open' | 'closed'
  review_only: boolean
  held_on: string | null
}

export type NativeQuestion = {
  id: string
  exam_id: string
  position: number
  prompt: string
  question_type: 'descriptive' | 'mcq'
  options: string[]
}

export type NativeAccess = {
  exam_id: string
  student_id: string
  approved_at: string
}

export type NativeAttempt = {
  id: string
  exam_id: string
  student_id: string
  started_at: string
  deadline_at: string
  last_seen_at: string
  answers: Record<string, string>
  revision: number
  warning_count: number
  status: 'in_progress' | 'submitted' | 'auto_submitted'
  submission_reason: string | null
  submitted_at: string | null
  exit_code_verified: boolean
}

export type NativeExamReview = {
  exam_id: string
  student_id: string
  answers: Record<string, string>
  marks: Record<string, number | null>
  updated_at: string
}

export type NativeExamReviewWindow = { exam_id: string; available_until: string | null }

export async function loadNativeExamReviewAdmin(examId: string) {
  const client = requireSupabase()
  const [rows, publication] = await Promise.all([
    client.from('native_exam_reviews').select('*').eq('exam_id', examId),
    client.from('native_exam_review_publications').select('published, published_at, available_from, available_until').eq('exam_id', examId).maybeSingle(),
  ])
  if (rows.error) throw rows.error
  if (publication.error) throw publication.error
  return {
    rows: (rows.data ?? []) as NativeExamReview[],
    published: Boolean(publication.data?.published),
    availableFrom: publication.data?.available_from as string | null ?? null,
    availableUntil: publication.data?.available_until as string | null ?? null,
  }
}

export async function importNativeExamReviews(examId: string, kind: ReviewKind, rows: ReviewImportRow[]) {
  const { data, error } = await requireSupabase().rpc('native_import_exam_reviews', { p_exam_id: examId, p_kind: kind, p_rows: rows })
  if (error) throw error
  return Number(data ?? 0)
}

export async function publishNativeExamReviews(examId: string, published: boolean, availableFrom: string | null, availableUntil: string | null) {
  const { error } = await requireSupabase().from('native_exam_review_publications').upsert({
    exam_id: examId, published, published_at: published ? new Date().toISOString() : null,
    available_from: availableFrom, available_until: availableUntil,
  })
  if (error) throw error
}

export async function loadMyNativeExamReviews() {
  const client = requireSupabase()
  const { data: user, error: userError } = await client.auth.getUser()
  if (userError) throw userError
  if (!user.user) throw new Error('Sign in to view your answers.')
  const { data: reviews, error: reviewError } = await client.from('native_exam_reviews').select('*').eq('student_id', user.user.id)
  if (reviewError) throw reviewError
  const rows = (reviews ?? []) as NativeExamReview[]
  if (!rows.length) return { reviews: rows, exams: [] as NativeExam[], questions: [] as NativeQuestion[], windows: [] as NativeExamReviewWindow[] }
  const examIds = rows.map((row) => row.exam_id)
  const [exams, questions, windows] = await Promise.all([
    client.from('native_exams').select('*').in('id', examIds),
    client.from('native_exam_questions').select('*').in('exam_id', examIds).order('position'),
    client.from('native_exam_review_publications').select('exam_id, available_until').in('exam_id', examIds),
  ])
  if (exams.error) throw exams.error
  if (questions.error) throw questions.error
  if (windows.error) throw windows.error
  return { reviews: rows, exams: (exams.data ?? []) as NativeExam[], questions: (questions.data ?? []) as NativeQuestion[], windows: (windows.data ?? []) as NativeExamReviewWindow[] }
}

export async function loadNativeExams() {
  if (devBypass) return { exams: [] as NativeExam[], questions: [] as NativeQuestion[], access: [] as NativeAccess[], attempts: [] as NativeAttempt[] }
  const client = requireSupabase()
  const [exams, questions, access, attempts] = await Promise.all([
    client.from('native_exams').select('*').order('starts_at', { ascending: false }),
    client.from('native_exam_questions').select('*').order('position'),
    client.from('native_exam_access').select('*'),
    client.from('native_exam_attempts').select('*'),
  ])
  for (const result of [exams, questions, access, attempts]) if (result.error) throw result.error
  return {
    exams: (exams.data ?? []) as NativeExam[],
    questions: (questions.data ?? []) as NativeQuestion[],
    access: (access.data ?? []) as NativeAccess[],
    attempts: (attempts.data ?? []) as NativeAttempt[],
  }
}

export async function saveNativeExam(input: Omit<NativeExam, 'id'> & { id?: string }) {
  const client = requireSupabase()
  const { data, error } = await client.from('native_exams').upsert(input).select('id').single()
  if (error) throw error
  return data.id as string
}

export async function deleteNativeExam(examId: string, confirmationTitle: string) {
  const { data, error } = await requireSupabase().rpc('native_delete_exam', {
    p_exam_id: examId,
    p_confirm_title: confirmationTitle,
  })
  if (error) throw error
  if (!data) throw new Error('Exam could not be deleted.')
}

export async function saveNativeQuestions(examId: string, prompts: Array<{ id?: string; prompt: string; question_type: NativeQuestion['question_type']; options: string[] }>, existing: NativeQuestion[]) {
  const client = requireSupabase()
  for (const question of existing) {
    if (prompts.some((item) => item.id === question.id)) continue
    const { error } = await client.from('native_exam_questions').delete().eq('id', question.id)
    if (error) throw error
  }
  for (const [index, item] of prompts.entries()) {
    const { error } = await client.from('native_exam_questions').upsert({
      ...(item.id ? { id: item.id } : {}), exam_id: examId, position: index + 1,
      prompt: item.prompt.trim(), question_type: item.question_type,
      options: item.question_type === 'mcq' ? item.options.map((option) => option.trim()) : [],
    })
    if (error) throw error
  }
}

export async function setNativeAccess(examId: string, studentId: string, approved: boolean) {
  const client = requireSupabase()
  if (approved) {
    const { data: user } = await client.auth.getUser()
    const { error } = await client.from('native_exam_access').upsert({ exam_id: examId, student_id: studentId, approved_by: user.user?.id })
    if (error) throw error
  } else {
    const { error } = await client.from('native_exam_access').delete().eq('exam_id', examId).eq('student_id', studentId)
    if (error) throw error
  }
}

export async function startNativeExam(examId: string, entryCode?: string) {
  const { data, error } = await requireSupabase().rpc('native_start_exam', { p_exam_id: examId, p_entry_code: entryCode ?? null })
  if (error) throw error
  if (!data) throw new Error('Incorrect attendance code or too many attempts. Ask staff if your code is locked.')
  return data as NativeAttempt
}

export async function saveNativeAnswers(attemptId: string, answers: Record<string, string>, revision: number) {
  const { data, error } = await requireSupabase().rpc('native_save_exam', {
    p_attempt_id: attemptId, p_answers: answers, p_revision: revision,
  })
  if (error) throw error
  return Boolean(data)
}

export async function submitNativeAnswers(attemptId: string, answers: Record<string, string>, revision: number, reason: 'student' | 'browser_left' | 'offline_timeout', exitCode?: string) {
  const { data, error } = await requireSupabase().rpc('native_submit_exam', {
    p_attempt_id: attemptId, p_answers: answers, p_revision: revision, p_reason: reason, p_exit_code: exitCode ?? null,
  })
  if (error) throw error
  return Boolean(data)
}

export async function getNativeFaceCode(lectureId: string, studentId: string) {
  const { data, error } = await requireSupabase().rpc('native_face_code', {
    p_lecture_id: lectureId, p_student_id: studentId,
  })
  if (error) throw error
  return data as string | null
}

export type NativeViolationEvent = 'tab_hidden' | 'fullscreen_exit' | 'page_exit'

export async function reportNativeViolation(attemptId: string, answers: Record<string, string>, revision: number, event: NativeViolationEvent, eventId: string) {
  const { data, error } = await requireSupabase().rpc('native_report_exam_violation', {
    p_attempt_id: attemptId, p_answers: answers, p_revision: revision, p_event: event, p_event_id: eventId,
  })
  if (error) throw error
  return data as NativeAttempt
}

// Started synchronously by visibility/fullscreen events so the browser can finish it in the background.
export function reportNativeViolationOnLeave(accessToken: string, attemptId: string, answers: Record<string, string>, revision: number, event: NativeViolationEvent, eventId: string) {
  requireSupabase()
  const url = import.meta.env.VITE_SUPABASE_URL as string
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const body = JSON.stringify({ p_attempt_id: attemptId, p_answers: answers, p_revision: revision, p_event: event, p_event_id: eventId })
  return fetch(`${url}/rest/v1/rpc/native_report_exam_violation`, {
    method: 'POST', keepalive: body.length < 60000,
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-app-session-key': appSessionKey(),
    },
    body,
  }).then((response) => {
    if (!response.ok) throw new Error(`Submission failed (${response.status})`)
    return response.json() as Promise<NativeAttempt>
  })
}
