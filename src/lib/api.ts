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
  Profile,
  StudentIssue,
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
    issues,
    announcements,
    auditLogs,
  ] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('courses').select('*, course_memberships(count)'),
    supabase.from('face_enrollments').select('*, profiles(full_name), course_memberships(courses(code))'),
    supabase.from('face_embeddings').select('*'),
    supabase.from('lecture_sessions').select('*, courses(code)'),
    supabase.from('attendance_records').select('*, profiles(full_name)'),
    supabase.from('assessments').select('*, courses(code)'),
    supabase.from('marks').select('*, profiles(full_name)'),
    supabase.from('student_issues').select('*, profiles(full_name)'),
    supabase.from('announcements').select('*, courses(code)'),
    supabase.from('audit_logs').select('*, profiles(full_name)').order('created_at', { ascending: false }).limit(100),
  ])

  for (const result of [profiles, courses, enrollments, embeddings, lectures, attendance, assessments, marks, issues, announcements, auditLogs]) {
    if (result.error) throw result.error
  }

  return {
    profiles: profiles.data as Profile[],
    courses: (courses.data ?? []).map((course: any) => ({ ...course, enrolled_count: course.course_memberships?.[0]?.count ?? 0 })),
    enrollments: (enrollments.data ?? []).map((enrollment: any) => ({
      ...enrollment,
      student_name: enrollment.profiles?.full_name ?? 'Student',
      course_codes: [],
    })),
    embeddings: (embeddings.data ?? []).map((embedding: any) => ({ ...embedding, vector: embedding.embedding })),
    lectures: (lectures.data ?? []).map((lecture: any) => ({ ...lecture, course_code: lecture.courses?.code ?? 'Course' })),
    attendance: (attendance.data ?? []).map((record: any) => ({ ...record, student_name: record.profiles?.full_name ?? 'Student' })),
    assessments: (assessments.data ?? []).map((assessment: any) => ({ ...assessment, course_code: assessment.courses?.code ?? 'Course' })),
    marks: (marks.data ?? []).map((mark: any) => ({ ...mark, student_name: mark.profiles?.full_name ?? 'Student' })),
    issues: (issues.data ?? []).map((issue: any) => ({ ...issue, student_name: issue.profiles?.full_name ?? 'Student' })),
    announcements: (announcements.data ?? []).map((announcement: any) => ({ ...announcement, course_code: announcement.courses?.code ?? 'All courses' })),
    auditLogs: (auditLogs.data ?? []).map((log: any) => ({ ...log, actor_name: log.profiles?.full_name ?? 'System' })),
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
    issues: demoIssues,
    announcements: demoAnnouncements,
    auditLogs: demoAuditLogs,
  }
}
