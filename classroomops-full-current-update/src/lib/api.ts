import type {
  Announcement,
  Assessment,
  AttendanceRecord,
  AuditLog,
  Course,
  FaceEmbedding,
  FaceEnrollment,
  LectureSession,
  Mark,
  MarkBreakdown,
  MarkComponent,
  Profile,
  StudentIssue,
  StudentImportPreviewRow,
} from '../types'
import {
  demoAnnouncements,
  demoAssessments,
  demoAttendance,
  demoAuditLogs,
  demoCourses,
  demoEmbeddings,
  demoEnrollments,
  demoLectures,
  demoMarks,
  demoMarkBreakdowns,
  demoMarkComponents,
  demoProfiles,
  demoIssues,
} from './demoData'
import { devBypass, requireSupabase } from './supabase'

export interface AppData {
  profiles: Profile[]
  courses: Course[]
  enrollments: FaceEnrollment[]
  embeddings: FaceEmbedding[]
  lectures: LectureSession[]
  attendance: AttendanceRecord[]
  assessments: Assessment[]
  marks: Mark[]
  markComponents: MarkComponent[]
  markBreakdowns: MarkBreakdown[]
  issues: StudentIssue[]
  announcements: Announcement[]
  auditLogs: AuditLog[]
}

export async function loadAppData(): Promise<AppData> {
  if (devBypass) return loadDemoData()

  const supabase = requireSupabase()
  const [
    profiles,
    courses,
    enrollments,
    embeddings,
    lectures,
    attendance,
    assessments,
    marks,
    markComponents,
    markComponentScores,
    issues,
    announcements,
    auditLogs,
  ] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('courses').select('*'),
    supabase.from('face_enrollments').select('*'),
    supabase.from('face_embeddings').select('*'),
    supabase.from('lecture_sessions').select('*'),
    supabase.from('attendance_records').select('*'),
    supabase.from('assessments').select('*'),
    supabase.from('marks').select('*'),
    supabase.from('mark_components').select('*').order('position'),
    supabase.from('mark_component_scores').select('*'),
    supabase.from('student_issues').select('*'),
    supabase.from('announcements').select('*'),
    supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
  ])

  for (const result of [profiles, courses, enrollments, embeddings, lectures, attendance, assessments, marks, markComponents, markComponentScores, issues, announcements, auditLogs]) {
    if (result.error) throw result.error
  }

  const profileById = new Map((profiles.data ?? []).map((profile: any) => [profile.id, profile]))
  const courseById = new Map((courses.data ?? []).map((course: any) => [course.id, course]))
  const componentById = new Map((markComponents.data ?? []).map((component: any) => [component.id, component]))
  const membershipCountByCourse = new Map<string, number>()

  const componentScoresByStudentCourse = new Map<string, any>()
  for (const score of markComponentScores.data ?? []) {
    const component = componentById.get(score.component_id)
    const course = courseById.get(component?.course_id)
    const key = score.student_id + ':' + (component?.course_id ?? 'course')
    const existing = componentScoresByStudentCourse.get(key) ?? {
      id: key,
      student_id: score.student_id,
      student_name: profileById.get(score.student_id)?.full_name ?? 'Student',
      course_id: component?.course_id ?? 'course',
      course_code: course?.code ?? 'Course',
      published: Boolean(score.published),
      scores: {},
    }
    existing.published = existing.published || Boolean(score.published)
    existing.scores[component?.key ?? score.component_id] = Number(score.value)
    componentScoresByStudentCourse.set(key, existing)
  }

  return {
    profiles: profiles.data as Profile[],
    courses: (courses.data ?? []).map((course: any) => ({ ...course, enrolled_count: membershipCountByCourse.get(course.id) ?? 0 })),
    enrollments: (enrollments.data ?? []).map((enrollment: any) => ({
      ...enrollment,
      student_name: profileById.get(enrollment.student_id)?.full_name ?? 'Student',
      course_codes: [],
    })),
    embeddings: (embeddings.data ?? []).map((embedding: any) => ({ ...embedding, vector: embedding.embedding })),
    lectures: (lectures.data ?? []).map((lecture: any) => ({ ...lecture, course_code: courseById.get(lecture.course_id)?.code ?? 'Course' })),
    attendance: (attendance.data ?? []).map((record: any) => ({ ...record, student_name: profileById.get(record.student_id)?.full_name ?? 'Student' })),
    assessments: (assessments.data ?? []).map((assessment: any) => ({ ...assessment, course_code: courseById.get(assessment.course_id)?.code ?? 'Course' })),
    marks: (marks.data ?? []).map((mark: any) => ({ ...mark, student_name: profileById.get(mark.student_id)?.full_name ?? 'Student' })),
    markComponents: (markComponents.data ?? []).map((column: any) => ({ ...column, course_code: courseById.get(column.course_id)?.code ?? 'Course' })),
    markBreakdowns: Array.from(componentScoresByStudentCourse.values()),
    issues: (issues.data ?? []).map((issue: any) => ({ ...issue, student_name: profileById.get(issue.student_id)?.full_name ?? 'Student' })),
    announcements: (announcements.data ?? []).map((announcement: any) => ({ ...announcement, course_code: announcement.course_id ? courseById.get(announcement.course_id)?.code ?? 'Course' : 'All courses' })),
    auditLogs: (auditLogs.data ?? []).map((log: any) => ({ ...log, actor_name: profileById.get(log.actor_id)?.full_name ?? 'System' })),
  }
}

export function loadDemoData(): AppData {
  return {
    profiles: demoProfiles,
    courses: demoCourses,
    enrollments: demoEnrollments,
    embeddings: demoEmbeddings,
    lectures: demoLectures,
    attendance: demoAttendance,
    assessments: demoAssessments,
    marks: demoMarks,
    markComponents: demoMarkComponents,
    markBreakdowns: demoMarkBreakdowns,
    issues: demoIssues,
    announcements: demoAnnouncements,
    auditLogs: demoAuditLogs,
  }
}


export async function bulkCreateStudents(rows: StudentImportPreviewRow[]) {
  if (devBypass) {
    return {
      created: rows.length,
      failed: 0,
      results: rows.map((row) => ({
        email: row.email,
        studentId: row.studentId,
        status: 'created' as const,
        message: 'Demo student staged locally',
      })),
    }
  }

  const supabase = requireSupabase()
  const { data, error } = await supabase.functions.invoke('bulk-create-students', {
    body: {
      students: rows.map((row) => ({
        studentId: row.studentId,
        fullName: row.fullName,
        email: row.email,
        phone: row.phone,
        courseCodes: row.courseCodes,
        temporaryPassword: row.temporaryPassword,
      })),
    },
  })

  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data as {
    created: number
    failed: number
    results: Array<{ email: string; studentId: string; status: 'created' | 'error'; message: string }>
  }
}


export interface CapturedFrameInput {
  id: string
  dataUrl: string
  label: string
  width: number
  height: number
}

function dataUrlToBlob(dataUrl: string) {
  const [meta, encoded] = dataUrl.split(',')
  const mime = meta.match(/data:(.*?);base64/)?.[1] ?? 'image/jpeg'
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

export async function submitFaceEnrollment(frames: CapturedFrameInput[]) {
  if (frames.length < 3) throw new Error('Capture three frames before submitting.')

  if (devBypass) {
    return { enrollmentId: 'demo-enrollment', frameCount: frames.length, state: 'queued' as const }
  }

  const supabase = requireSupabase()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Sign in again before submitting face enrollment.')

  const studentId = userData.user.id
  const { data: existing, error: existingError } = await supabase
    .from('face_enrollments')
    .select('id, state')
    .eq('student_id', studentId)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing && ['queued', 'processing', 'ready'].includes(existing.state)) {
    throw new Error('Your face enrollment is already queued or processed.')
  }

  const { data: enrollment, error: enrollmentError } = await supabase
    .from('face_enrollments')
    .upsert({
      student_id: studentId,
      state: 'uploading',
      frame_count: 0,
      failure_reason: null,
    }, { onConflict: 'student_id' })
    .select('id')
    .single()
  if (enrollmentError) throw enrollmentError

  const uploadedRows = []
  for (const [index, frame] of frames.entries()) {
    const storagePath = `${studentId}/${enrollment.id}/${Date.now()}-${index + 1}.jpg`
    const { error: uploadError } = await supabase.storage
      .from('face-frames')
      .upload(storagePath, dataUrlToBlob(frame.dataUrl), {
        contentType: 'image/jpeg',
        upsert: false,
      })
    if (uploadError) throw uploadError
    uploadedRows.push({
      enrollment_id: enrollment.id,
      student_id: studentId,
      storage_path: storagePath,
      quality_score: null,
      pose_label: frame.label,
    })
  }

  const { error: frameError } = await supabase.from('face_enrollment_frames').insert(uploadedRows)
  if (frameError) throw frameError

  const { error: updateError } = await supabase
    .from('face_enrollments')
    .update({ state: 'queued', frame_count: frames.length, failure_reason: null })
    .eq('id', enrollment.id)
  if (updateError) throw updateError

  return { enrollmentId: enrollment.id as string, frameCount: frames.length, state: 'queued' as const }
}

export async function claimNextEnrollment(workerId: string) {
  if (devBypass) return null
  const supabase = requireSupabase()
  const { data, error } = await supabase.rpc('claim_next_enrollment', { p_worker: workerId })
  if (error) throw error
  return data
}


export interface EnrollmentFrameRecord {
  id: string
  enrollment_id: string
  student_id: string
  storage_path: string
  pose_label?: string
  width?: number
  height?: number
}

export async function loadEnrollmentFrames(enrollmentId: string) {
  if (devBypass) return [] as EnrollmentFrameRecord[]
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('face_enrollment_frames')
    .select('*')
    .eq('enrollment_id', enrollmentId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as EnrollmentFrameRecord[]
}

export async function downloadFaceFrame(storagePath: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.storage.from('face-frames').download(storagePath)
  if (error) throw error
  return data
}

export async function completeEnrollmentProcessing(input: {
  enrollmentId: string
  studentId: string
  embedding: number[]
  modelVersion: string
  pipelineVersion: string
  sourceFrameIds: string[]
}) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { data: userData } = await supabase.auth.getUser()

  await supabase
    .from('face_embeddings')
    .update({ active: false })
    .eq('student_id', input.studentId)
    .eq('active', true)

  const { error: embeddingError } = await supabase.from('face_embeddings').insert({
    student_id: input.studentId,
    enrollment_id: input.enrollmentId,
    model_version: input.modelVersion,
    pipeline_version: input.pipelineVersion,
    embedding: input.embedding,
    source_frame_ids: input.sourceFrameIds,
    created_by: userData.user?.id ?? null,
    active: true,
  })
  if (embeddingError) throw embeddingError

  const { error: enrollmentError } = await supabase
    .from('face_enrollments')
    .update({ state: 'ready', lock_owner: null, locked_at: null, failure_reason: null })
    .eq('id', input.enrollmentId)
  if (enrollmentError) throw enrollmentError
}

export async function failEnrollmentProcessing(enrollmentId: string, reason: string) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('face_enrollments')
    .update({ state: 'quality_failed', lock_owner: null, locked_at: null, failure_reason: reason })
    .eq('id', enrollmentId)
  if (error) throw error
}
