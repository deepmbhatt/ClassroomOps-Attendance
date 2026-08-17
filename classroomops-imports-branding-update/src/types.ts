export type Role = 'admin' | 'student'

export type EnrollmentState =
  | 'not_started'
  | 'capturing'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'upload_failed'
  | 'quality_failed'
  | 'processing_failed'

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'manual_review'
export type IssueStatus = 'open' | 'under_review' | 'resolved'
export type ImportStatus = 'preview' | 'committed' | 'rolled_back'

export interface Profile {
  id: string
  role: Role
  full_name: string
  student_id?: string
  email: string
  phone?: string
  biometric_consent_at?: string
}

export interface Course {
  id: string
  code: string
  title: string
  term: string
  active: boolean
  enrolled_count: number
}

export interface FaceEnrollment {
  id: string
  student_id: string
  student_name: string
  course_codes: string[]
  state: EnrollmentState
  frame_count: number
  lock_owner?: string
  locked_at?: string
  failure_reason?: string
  updated_at: string
}

export interface FaceEmbedding {
  id: string
  student_id: string
  model_version: string
  pipeline_version: string
  vector: number[]
  source_frame_ids: string[]
  created_by: string
  created_at: string
}

export interface LectureSession {
  id: string
  course_id: string
  course_code: string
  title: string
  session_type?: 'lecture' | 'lab'
  started_at: string
  ended_at?: string
  status: 'active' | 'closed'
}

export interface AttendanceRecord {
  id: string
  lecture_id: string
  student_id: string
  student_name: string
  status: AttendanceStatus
  confidence?: number
  source: 'face' | 'manual' | 'import'
  reason?: string
  marked_by: string
  marked_at: string
}

export interface Assessment {
  id: string
  course_id: string
  course_code: string
  title: string
  max_marks: number
  published: boolean
  academic_year?: string
  semester?: string
  assessment_type?: string
}

export interface Mark {
  id: string
  assessment_id: string
  student_id: string
  student_name: string
  value: number
  published: boolean
}

export interface MarkComponent {
  id: string
  course_id: string
  course_code: string
  key: string
  label: string
  max_marks: number
  position: number
  active: boolean
}

export interface MarkBreakdown {
  id: string
  student_id: string
  student_name: string
  course_id: string
  course_code: string
  published: boolean
  scores: Record<string, number>
  assessments?: Record<string, number>
}

export interface StudentIssue {
  id: string
  student_id: string
  student_name: string
  target_type: 'attendance' | 'mark'
  target_id: string
  status: IssueStatus
  message: string
  admin_note?: string
  created_at: string
}

export interface Announcement {
  id: string
  course_code: string
  title: string
  body: string
  published_at: string
}

export interface AuditLog {
  id: string
  actor_name: string
  action: string
  entity_type: string
  entity_id: string
  reason?: string
  created_at: string
}

export interface ImportPreview {
  importId: string
  kind: 'marks' | 'attendance'
  rows: ImportPreviewRow[]
  validCount: number
  errorCount: number
}

export interface ImportPreviewRow {
  rowNumber: number
  studentId: string
  studentName?: string
  value: string
  status: 'valid' | 'error'
  messages: string[]
}

export interface MarksImportRow {
  studentId: string
  value: number
}

export interface StudentImportPreview {
  importId: string
  rows: StudentImportPreviewRow[]
  validCount: number
  errorCount: number
}

export interface StudentImportPreviewRow {
  rowNumber: number
  studentId: string
  fullName: string
  email: string
  phone: string
  courseCodes: string[]
  status: 'valid' | 'error'
  messages: string[]
}
