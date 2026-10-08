import type { Course, CourseMembership, Profile } from '../types'

export const masterRosterHeaders = [
  'Student ID', 'Full Name', 'Email', 'Phone', 'Course Codes', 'Temporary Password',
  'Course Code', 'Session Date', 'Session Time', 'Session Title', 'Attendance Status', 'Marked At', 'Reason',
  'Academic Year', 'Semester', 'Assessment', 'Assessment Type', 'Maximum Marks', 'Marks', 'Remarks',
  'Exam Title', 'Individual Exam Link', 'Verification Code', 'Expected Exit Code', 'Submitted Exit Code',
]

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function buildMasterRosterCsv(profiles: Profile[], memberships: CourseMembership[], courses: Course[]) {
  const courseById = new Map(courses.map((course) => [course.id, course.code]))
  const rows = profiles
    .filter((profile) => profile.role === 'student' && !profile.deleted_at)
    .sort((left, right) => (left.student_id ?? '').localeCompare(right.student_id ?? ''))
    .map((profile) => {
      const courseCodes = memberships
        .filter((membership) => membership.student_id === profile.id && !membership.deleted_at)
        .map((membership) => courseById.get(membership.course_id))
        .filter(Boolean)
        .join(';')
      return [profile.student_id, profile.full_name, profile.email, profile.phone, courseCodes, ...Array(masterRosterHeaders.length - 5).fill('')]
    })
  return [masterRosterHeaders, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

export function downloadTextFile(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
