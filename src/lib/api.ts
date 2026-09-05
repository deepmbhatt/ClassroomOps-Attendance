import type {
  Announcement,
  Assessment,
  AttendanceRecord,
  AuditLog,
  Course,
  CourseMembership,
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
  demoCourses,
  demoLectures,
  demoMarkComponents,
  demoProfiles,
} from './demoData'
import { devBypass, requireSupabase } from './supabase'

export interface AppData {
  profiles: Profile[]
  courses: Course[]
  courseMemberships: CourseMembership[]
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
    courseMemberships,
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
    supabase.from('course_memberships').select('*').is('deleted_at', null),
    supabase.from('face_enrollments').select('*'),
    supabase.from('face_embeddings').select('*').eq('active', true),
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

  for (const result of [profiles, courses, courseMemberships, enrollments, embeddings, lectures, attendance, assessments, marks, markComponents, markComponentScores, issues, announcements, auditLogs]) {
    if (result.error) throw result.error
  }

  const profileById = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]))
  const courseById = new Map((courses.data ?? []).map((course) => [course.id, course]))
  const componentById = new Map((markComponents.data ?? []).map((component) => [component.id, component]))
  const membershipRows = (courseMemberships.data ?? []) as CourseMembership[]
  const membershipCountByCourse = new Map<string, number>()
  const courseCodesByStudent = new Map<string, string[]>()
  for (const membership of membershipRows) {
    const course = courseById.get(membership.course_id)
    if (!course) continue
    membershipCountByCourse.set(membership.course_id, (membershipCountByCourse.get(membership.course_id) ?? 0) + 1)
    courseCodesByStudent.set(membership.student_id, [...(courseCodesByStudent.get(membership.student_id) ?? []), course.code])
  }

  const componentScoresByStudentCourse = new Map<string, MarkBreakdown>()
  for (const score of markComponentScores.data ?? []) {
    const component = componentById.get(score.component_id)
    const course = courseById.get(component?.course_id)
    const key = score.student_id + ':' + (component?.course_id ?? 'course')
    const existing: MarkBreakdown = componentScoresByStudentCourse.get(key) ?? {
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
    courses: (courses.data ?? []).map((course) => ({ ...course, enrolled_count: membershipCountByCourse.get(course.id) ?? 0 })),
    courseMemberships: membershipRows,
    enrollments: (enrollments.data ?? []).map((enrollment) => ({
      ...enrollment,
      student_name: profileById.get(enrollment.student_id)?.full_name ?? 'Student',
      course_codes: courseCodesByStudent.get(enrollment.student_id) ?? [],
    })),
    embeddings: (embeddings.data ?? []).map((embedding) => ({ ...embedding, vector: embedding.embedding })),
    lectures: (lectures.data ?? []).map((lecture) => ({ ...lecture, course_code: courseById.get(lecture.course_id)?.code ?? 'Course' })),
    attendance: (attendance.data ?? []).map((record) => ({ ...record, student_name: profileById.get(record.student_id)?.full_name ?? 'Student' })),
    assessments: (assessments.data ?? []).map((assessment) => ({ ...assessment, course_code: courseById.get(assessment.course_id)?.code ?? 'Course' })),
    marks: (marks.data ?? []).map((mark) => ({ ...mark, student_name: profileById.get(mark.student_id)?.full_name ?? 'Student' })),
    markComponents: (markComponents.data ?? []).map((column) => ({ ...column, course_code: courseById.get(column.course_id)?.code ?? 'Course' })),
    markBreakdowns: Array.from(componentScoresByStudentCourse.values()),
    issues: (issues.data ?? []).map((issue) => ({ ...issue, student_name: profileById.get(issue.student_id)?.full_name ?? 'Student' })),
    announcements: (announcements.data ?? []).map((announcement) => ({ ...announcement, course_code: announcement.course_id ? courseById.get(announcement.course_id)?.code ?? 'Course' : 'All courses' })),
    auditLogs: (auditLogs.data ?? []).map((log) => ({ ...log, actor_name: profileById.get(log.actor_id)?.full_name ?? 'System' })),
  }
}

export function loadDemoData(): AppData {
  return {
    profiles: demoProfiles.filter((profile) => profile.role === 'admin'),
    courses: demoCourses.map((course) => ({ ...course, enrolled_count: 0 })),
    courseMemberships: [],
    enrollments: [],
    embeddings: [],
    lectures: demoLectures,
    attendance: [],
    assessments: demoAssessments,
    marks: [],
    markComponents: demoMarkComponents,
    markBreakdowns: [],
    issues: [],
    announcements: demoAnnouncements,
    auditLogs: [],
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
        additionalInfo: row.additionalInfo,
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
  const { error } = await supabase.rpc('complete_face_enrollment_processing', {
    p_enrollment_id: input.enrollmentId,
    p_student_id: input.studentId,
    p_embedding: input.embedding,
    p_model_version: input.modelVersion,
    p_pipeline_version: input.pipelineVersion,
    p_source_frame_ids: input.sourceFrameIds,
  })
  if (error) throw error
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


export async function createLectureSession(input: { courseId: string; title: string; startedAt: string }) {
  if (devBypass) return { id: 'lecture-demo', course_id: input.courseId, title: input.title, started_at: input.startedAt, status: 'active' }
  const supabase = requireSupabase()
  const { data: userData } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('lecture_sessions')
    .insert({
      course_id: input.courseId,
      title: input.title,
      started_at: input.startedAt,
      started_by: userData.user?.id ?? null,
      status: 'active',
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function closeLectureSession(lectureId: string) {
  if (devBypass) return 0
  const supabase = requireSupabase()
  const { data, error } = await supabase.rpc('close_lecture_session_with_absences', {
    p_lecture_id: lectureId,
  })
  if (error) throw error
  return Number(data ?? 0)
}

export async function deleteAttendanceRecord(recordId: string) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { error } = await supabase.from('attendance_records').delete().eq('id', recordId)
  if (error) throw error
}

export async function markAttendanceRecords(inputs: Array<{
  lectureId: string
  studentId: string
  status: 'present' | 'absent' | 'late' | 'excused' | 'manual_review'
  reason?: string
  markedAt?: string
}>) {
  if (devBypass || !inputs.length) return
  const supabase = requireSupabase()
  const { data: userData } = await supabase.auth.getUser()
  const payload = inputs.map((input) => ({
    lecture_id: input.lectureId,
    student_id: input.studentId,
    status: input.status,
    confidence: null,
    source: 'manual',
    reason: input.reason ?? 'Updated during attendance review',
    marked_by: userData.user?.id ?? null,
    marked_at: input.markedAt ?? new Date().toISOString(),
  }))
  const { error } = await supabase.from('attendance_records').upsert(payload, { onConflict: 'lecture_id,student_id' })
  if (error) throw error
}


export async function markAttendanceRecord(input: {
  lectureId: string
  studentId: string
  status: 'present' | 'absent' | 'late' | 'excused' | 'manual_review'
  confidence?: number
  source: 'face' | 'manual' | 'import'
  reason?: string
  markedAt?: string
}) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { data: userData } = await supabase.auth.getUser()
  const { error } = await supabase.from('attendance_records').upsert({
    lecture_id: input.lectureId,
    student_id: input.studentId,
    status: input.status,
    confidence: input.confidence ?? null,
    source: input.source,
    reason: input.reason ?? null,
    marked_by: userData.user?.id ?? null,
    marked_at: input.markedAt ?? new Date().toISOString(),
  }, { onConflict: 'lecture_id,student_id' })
  if (error) throw error
}


export async function upsertCourse(input: { id?: string; code: string; title: string; term: string; active: boolean }) {
  if (devBypass) return
  const supabase = requireSupabase()
  const payload = {
    ...(input.id ? { id: input.id } : {}),
    code: input.code.trim().toUpperCase(),
    title: input.title.trim(),
    term: input.term.trim(),
    active: input.active,
    deleted_at: null,
  }
  const { error } = await supabase.from('courses').upsert(payload, { onConflict: input.id ? 'id' : 'code' })
  if (error) throw error
}

export async function softDeleteCourse(courseId: string) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { error } = await supabase.from('courses').update({ active: false, deleted_at: new Date().toISOString() }).eq('id', courseId)
  if (error) throw error
}

export async function updateStudentProfile(input: { id: string; studentId: string; fullName: string; email: string; phone?: string; additionalInfo?: string; mustChangePassword?: boolean }) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('profiles')
    .update({
      student_id: input.studentId.trim(),
      full_name: input.fullName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
      additional_info: input.additionalInfo?.trim() || null,
      must_change_password: Boolean(input.mustChangePassword),
    })
    .eq('id', input.id)
  if (error) throw error
}

export async function setStudentCourseCodes(studentId: string, courseCodes: string[]) {
  if (devBypass) return
  const supabase = requireSupabase()
  const normalizedCodes = courseCodes.map((code) => code.trim().toUpperCase()).filter(Boolean)
  const { data: courses, error: courseError } = await supabase.from('courses').select('id, code').in('code', normalizedCodes)
  if (courseError) throw courseError
  const foundCodes = new Set((courses ?? []).map((course) => String(course.code).toUpperCase()))
  const missing = normalizedCodes.filter((code) => !foundCodes.has(code))
  if (missing.length) throw new Error(`Unknown course code(s): ${missing.join(', ')}`)

  const { error: clearError } = await supabase.from('course_memberships').update({ deleted_at: new Date().toISOString() }).eq('student_id', studentId)
  if (clearError) throw clearError
  const memberships = (courses ?? []).map((course) => ({ course_id: course.id, student_id: studentId, deleted_at: null }))
  if (memberships.length) {
    const { error } = await supabase.from('course_memberships').upsert(memberships, { onConflict: 'course_id,student_id' })
    if (error) throw error
  }
}

export async function softDeleteStudent(studentId: string) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { error } = await supabase.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', studentId)
  if (error) throw error
}

export async function updateExistingStudents(rows: Array<{ studentId: string; fullName: string; email: string; phone: string; additionalInfo: string; courseCodes: string[] }>, profiles: Profile[]) {
  for (const row of rows) {
    const profile = profiles.find((item) => item.student_id === row.studentId || item.email.toLowerCase() === row.email.toLowerCase())
    if (!profile) continue
    await updateStudentProfile({ id: profile.id, studentId: row.studentId, fullName: row.fullName, email: row.email, phone: row.phone, additionalInfo: row.additionalInfo, mustChangePassword: profile.must_change_password })
    await setStudentCourseCodes(profile.id, row.courseCodes)
  }
}

export async function upsertAssessment(input: { id?: string; courseId: string; title: string; maxMarks: number; published: boolean; academicYear?: string; semester?: string; assessmentType?: string }) {
  if (devBypass) return { id: input.id ?? 'assessment-demo' }
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('assessments')
    .upsert({
      ...(input.id ? { id: input.id } : {}),
      course_id: input.courseId,
      title: input.title.trim(),
      max_marks: input.maxMarks,
      published: input.published,
      academic_year: input.academicYear?.trim() || null,
      semester: input.semester?.trim() || null,
      assessment_type: input.assessmentType?.trim() || null,
    }, { onConflict: input.id ? 'id' : 'course_id,academic_year,semester,title' })
    .select('id')
    .single()
  if (error) throw error
  return data as { id: string }
}

export async function upsertMarks(input: { assessmentId: string; rows: Array<{ studentId: string; value: number }>; published: boolean; profiles: Profile[] }) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { data: userData } = await supabase.auth.getUser()
  const payload = input.rows.map((row) => {
    const profile = input.profiles.find((item) => item.student_id === row.studentId)
    if (!profile) throw new Error(`Student not found: ${row.studentId}`)
    return {
      assessment_id: input.assessmentId,
      student_id: profile.id,
      value: row.value,
      published: input.published,
      updated_by: userData.user?.id ?? null,
    }
  })
  if (!payload.length) return
  const { error } = await supabase.from('marks').upsert(payload, { onConflict: 'assessment_id,student_id' })
  if (error) throw error
}

export async function deleteMark(markId: string) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { error } = await supabase.from('marks').delete().eq('id', markId)
  if (error) throw error
}


export async function createStudentIssue(input: { targetType: 'attendance' | 'mark'; targetId: string; message: string }) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Sign in again before submitting a request.')
  const { error } = await supabase.from('student_issues').insert({
    student_id: userData.user.id,
    target_type: input.targetType,
    target_id: input.targetId,
    message: input.message.trim(),
    status: 'open',
  })
  if (error) throw error
}

export async function updateStudentIssue(input: { issueId: string; status: 'open' | 'under_review' | 'resolved'; adminNote?: string }) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { data: userData } = await supabase.auth.getUser()
  const { error } = await supabase.from('student_issues').update({
    status: input.status,
    admin_note: input.adminNote?.trim() || null,
    resolved_by: input.status === 'resolved' ? userData.user?.id ?? null : null,
  }).eq('id', input.issueId)
  if (error) throw error
}


export async function approveStudentRegistration(input: { studentId: string; courseCodes: string[] }) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Sign in again before approving students.')

  await setStudentCourseCodes(input.studentId, input.courseCodes)

  const { error } = await supabase
    .from('profiles')
    .update({
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: userData.user.id,
      deleted_at: null,
    })
    .eq('id', input.studentId)
    .eq('role', 'student')
  if (error) throw error
}

export async function rejectStudentRegistration(studentId: string) {
  if (devBypass) return
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('profiles')
    .update({
      approval_status: 'rejected',
      approved_at: null,
      approved_by: null,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', studentId)
    .eq('role', 'student')
  if (error) throw error
}

export async function syncMissingAuthProfiles() {
  if (devBypass) return 0
  const supabase = requireSupabase()
  const { data, error } = await supabase.rpc('sync_missing_auth_profiles')
  if (error) throw error
  return Number(data ?? 0)
}
