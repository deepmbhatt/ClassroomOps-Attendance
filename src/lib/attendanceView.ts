import type { AttendanceRecord, AttendanceStatus, LectureSession } from '../types'

export function localDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function effectiveAttendanceStatus(session: LectureSession, record?: AttendanceRecord): AttendanceStatus | undefined {
  void session
  return record?.status
}

export function attendanceTone(status?: AttendanceStatus): 'good' | 'warn' | 'danger' | 'neutral' {
  if (status === 'present') return 'good'
  if (status === 'absent') return 'danger'
  if (status === 'late' || status === 'manual_review') return 'warn'
  return 'neutral'
}
