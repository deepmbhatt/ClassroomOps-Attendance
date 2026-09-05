import type { AttendanceRecord, AttendanceStatus } from '../types'

export function ensureOnlineForAttendance(isOnline = navigator.onLine) {
  if (!isOnline) {
    throw new Error('Attendance is online-only in v1. Reconnect before marking students.')
  }
}

export function canInsertAttendance(
  records: Pick<AttendanceRecord, 'lecture_id' | 'student_id'>[],
  lectureId: string,
  studentId: string,
) {
  return !records.some((record) => record.lecture_id === lectureId && record.student_id === studentId)
}

export function normalizeAttendanceStatus(value: string): AttendanceStatus {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_')
  if (['present', 'absent', 'late', 'excused', 'manual_review'].includes(normalized)) {
    return normalized as AttendanceStatus
  }
  throw new Error(`Unsupported attendance status: ${value}`)
}

export function recognitionThresholdForAttempt(baseThreshold: number, attempt: number) {
  const boundedAttempt = Math.min(3, Math.max(1, Math.trunc(attempt)))
  return Math.max(0.54, baseThreshold - (boundedAttempt - 1) * 0.01)
}

export function confidenceLabel(confidence?: number) {
  if (confidence == null) return 'Manual'
  if (confidence >= 0.86) return 'High'
  if (confidence >= 0.72) return 'Review'
  return 'Low'
}
