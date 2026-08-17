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

export const demoProfiles: Profile[] = [
  { id: 'admin-1', role: 'admin', full_name: 'Admin User', email: 'admin@classroom.local' },
  {
    id: 'student-1',
    role: 'student',
    full_name: 'Ananya Rao',
    student_id: 'CSE001',
    email: 'ananya@classroom.local',
    phone: '+91 90000 00001',
  },
  { id: 'student-2', role: 'student', full_name: 'Rohan Mehta', student_id: 'CSE002', email: 'rohan@classroom.local' },
  { id: 'student-3', role: 'student', full_name: 'Sara Khan', student_id: 'CSE003', email: 'sara@classroom.local' },
]

export const demoCourses: Course[] = [
  { id: 'course-1', code: 'CS601', title: 'Computer Vision Systems', term: 'Aug-Dec 2026', active: true, enrolled_count: 3 },
  { id: 'course-2', code: 'CS642', title: 'Distributed Databases', term: 'Aug-Dec 2026', active: true, enrolled_count: 2 },
]

export const demoEnrollments: FaceEnrollment[] = [
  {
    id: 'enroll-1',
    student_id: 'student-1',
    student_name: 'Ananya Rao',
    course_codes: ['CS601'],
    state: 'not_started',
    frame_count: 0,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'enroll-2',
    student_id: 'student-2',
    student_name: 'Rohan Mehta',
    course_codes: ['CS601', 'CS642'],
    state: 'queued',
    frame_count: 3,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'enroll-3',
    student_id: 'student-3',
    student_name: 'Sara Khan',
    course_codes: ['CS601'],
    state: 'quality_failed',
    frame_count: 1,
    failure_reason: 'Face was too small in two frames.',
    updated_at: new Date().toISOString(),
  },
]

export const demoEmbeddings: FaceEmbedding[] = [
  {
    id: 'embed-1',
    student_id: 'student-1',
    model_version: 'demo-deterministic-v1',
    pipeline_version: 'browser-face-v1',
    vector: Array.from({ length: 64 }, (_, index) => Math.sin(index + 1)),
    source_frame_ids: ['frame-1', 'frame-2', 'frame-3'],
    created_by: 'admin-1',
    created_at: new Date().toISOString(),
  },
]

export const demoLectures: LectureSession[] = [
  {
    id: 'lecture-1',
    course_id: 'course-1',
    course_code: 'CS601',
    title: 'Lecture 12: Face embeddings',
    started_at: new Date().toISOString(),
    status: 'active',
  },
]

export const demoAttendance: AttendanceRecord[] = [
  {
    id: 'att-1',
    lecture_id: 'lecture-1',
    student_id: 'student-1',
    student_name: 'Ananya Rao',
    status: 'present',
    confidence: 0.91,
    source: 'face',
    marked_by: 'admin-1',
    marked_at: new Date().toISOString(),
  },
  {
    id: 'att-2',
    lecture_id: 'lecture-1',
    student_id: 'student-2',
    student_name: 'Rohan Mehta',
    status: 'manual_review',
    confidence: 0.71,
    source: 'face',
    marked_by: 'admin-1',
    marked_at: new Date().toISOString(),
  },
]

export const demoAssessments: Assessment[] = [
  { id: 'assessment-1', course_id: 'course-1', course_code: 'CS601', title: 'Midterm', max_marks: 40, published: true },
  { id: 'assessment-2', course_id: 'course-1', course_code: 'CS601', title: 'Lab Internal', max_marks: 20, published: false },
]

export const demoMarks: Mark[] = [
  { id: 'mark-1', assessment_id: 'assessment-1', student_id: 'student-1', student_name: 'Ananya Rao', value: 35, published: true },
  { id: 'mark-2', assessment_id: 'assessment-1', student_id: 'student-2', student_name: 'Rohan Mehta', value: 31, published: true },
]

export const demoIssues: StudentIssue[] = [
  {
    id: 'issue-1',
    student_id: 'student-2',
    student_name: 'Rohan Mehta',
    target_type: 'attendance',
    target_id: 'att-2',
    status: 'open',
    message: 'I was present but the system put my record into review.',
    created_at: new Date().toISOString(),
  },
]

export const demoAnnouncements: Announcement[] = [
  {
    id: 'ann-1',
    course_code: 'CS601',
    title: 'Enrollment processing window',
    body: 'Face enrollment jobs will be processed from the admin console before tomorrow morning.',
    published_at: new Date().toISOString(),
  },
]

export const demoAuditLogs: AuditLog[] = [
  {
    id: 'audit-1',
    actor_name: 'Admin User',
    action: 'UPDATE',
    entity_type: 'attendance_records',
    entity_id: 'att-2',
    reason: 'Low confidence moved to manual review.',
    created_at: new Date().toISOString(),
  },
]
