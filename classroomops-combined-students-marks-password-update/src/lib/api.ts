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
