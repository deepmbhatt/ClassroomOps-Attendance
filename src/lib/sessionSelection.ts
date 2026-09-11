import type { AttendanceStatus, LectureSession } from '../types'
import { localDateKey } from './attendanceView'

export const NEW_SESSION_VALUE = '__new_session__'

export function sessionsForCourseDate(sessions: LectureSession[], courseId: string, date: string) {
  if (!courseId || !date) return []
  return sessions
    .filter((session) => session.course_id === courseId && localDateKey(session.started_at) === date)
    .sort((left, right) => new Date(left.started_at).getTime() - new Date(right.started_at).getTime())
}

export function sessionStartForDate(date: string, now = new Date()) {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) throw new Error('Choose a valid session date.')
  return new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString()
}

export function recognitionAttendanceStatus(
  sessionStatus: LectureSession['status'],
  existingStatus?: AttendanceStatus,
): 'present' | 'late' | null {
  if (existingStatus === 'present' || existingStatus === 'late') return null
  return sessionStatus === 'closed' ? 'late' : 'present'
}
