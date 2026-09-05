import { describe, expect, it, vi } from 'vitest'
import { canInsertAttendance, ensureOnlineForAttendance, normalizeAttendanceStatus, recognitionThresholdForAttempt } from '../lib/attendance'
import { attendanceTone, effectiveAttendanceStatus, localDateKey } from '../lib/attendanceView'
import { cameraErrorMessage } from '../lib/camera'
import { canTransitionEnrollment, isEnrollmentLocked } from '../lib/enrollmentState'
import { previewImport } from '../lib/importValidation'
import { averageEmbeddings, cosineSimilarity, faceQualityLimits } from '../lib/faceEngine'

describe('enrollment state machine', () => {
  it('allows the intended happy path and rejects unsafe duplicate processing paths', () => {
    expect(canTransitionEnrollment('not_started', 'capturing')).toBe(true)
    expect(canTransitionEnrollment('capturing', 'uploading')).toBe(true)
    expect(canTransitionEnrollment('uploading', 'queued')).toBe(true)
    expect(canTransitionEnrollment('queued', 'processing')).toBe(true)
    expect(canTransitionEnrollment('processing', 'ready')).toBe(true)
    expect(canTransitionEnrollment('ready', 'queued')).toBe(false)
    expect(isEnrollmentLocked('queued')).toBe(true)
  })
})

describe('attendance guards', () => {
  it('blocks offline attendance in v1', () => {
    expect(() => ensureOnlineForAttendance(false)).toThrow(/online-only/i)
  })

  it('prevents duplicate attendance records per lecture and student', () => {
    expect(canInsertAttendance([{ lecture_id: 'l1', student_id: 's1' }], 'l1', 's1')).toBe(false)
    expect(canInsertAttendance([{ lecture_id: 'l1', student_id: 's1' }], 'l1', 's2')).toBe(true)
  })

  it('normalizes supported manual attendance statuses', () => {
    expect(normalizeAttendanceStatus('Manual Review')).toBe('manual_review')
    expect(() => normalizeAttendanceStatus('maybe')).toThrow(/unsupported/i)
  })
})

describe('import preview', () => {
  it('validates student IDs, duplicates, and numeric marks before commit', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000')
    const preview = previewImport(
      `Student ID,Marks
CSE001,38
CSE001,39
CSE404,hello`,
      [{ student_id: 'CSE001', full_name: 'Ananya Rao' }],
      'marks',
    )
    expect(preview.importId).toBe('00000000-0000-4000-8000-000000000000')
    expect(preview.validCount).toBe(1)
    expect(preview.errorCount).toBe(2)
    expect(preview.rows[1].messages).toContain('Duplicate student in import')
    expect(preview.rows[2].messages).toContain('Student ID was not found')
  })
})

describe('face embedding decisions', () => {
  it('normalizes averaged vectors and rejects incompatible dimensions', () => {
    const averaged = averageEmbeddings([[1, 0], [0.8, 0.2]])
    expect(Math.hypot(...averaged)).toBeCloseTo(1, 6)
    expect(cosineSimilarity(averaged, averaged)).toBeCloseTo(1, 6)
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
  })
})


describe('attendance views', () => {
  it('keeps missing attendance unmarked after a record is removed', () => {
    const closed = { id: 'l1', course_id: 'c1', course_code: 'CS601', title: 'Lecture', started_at: '2026-09-02T09:00:00+05:30', status: 'closed' as const }
    const active = { ...closed, id: 'l2', status: 'active' as const }
    expect(effectiveAttendanceStatus(closed)).toBeUndefined()
    expect(effectiveAttendanceStatus(active)).toBeUndefined()
    expect(attendanceTone('present')).toBe('good')
    expect(attendanceTone('absent')).toBe('danger')
  })

  it('creates stable local date keys for date filters', () => {
    expect(localDateKey(new Date(2026, 8, 2, 9, 30))).toBe('2026-09-02')
  })
})


describe('camera diagnostics', () => {
  it('provides an actionable message when permission is denied', () => {
    const error = new Error('Permission denied')
    error.name = 'NotAllowedError'
    expect(cameraErrorMessage(error)).toMatch(/allow camera permission/i)
  })

  it('explains when another application is using the webcam', () => {
    const error = new Error('Could not start video source')
    error.name = 'NotReadableError'
    expect(cameraErrorMessage(error)).toMatch(/close Zoom, Meet, Teams/i)
  })
})


describe('low-quality attendance tolerance', () => {
  it('keeps enrollment strict while allowing a moderate attendance profile', () => {
    expect(faceQualityLimits.attendance.minimumSharpness).toBeLessThan(faceQualityLimits.strict.minimumSharpness)
    expect(faceQualityLimits.attendance.minimumBrightness).toBeLessThan(faceQualityLimits.strict.minimumBrightness)
    expect(faceQualityLimits.attendance.minimumScore).toBeLessThan(faceQualityLimits.strict.minimumScore)
  })

  it('relaxes matching only slightly across three attempts and never below the floor', () => {
    expect(recognitionThresholdForAttempt(0.58, 1)).toBeCloseTo(0.58)
    expect(recognitionThresholdForAttempt(0.58, 2)).toBeCloseTo(0.57)
    expect(recognitionThresholdForAttempt(0.58, 3)).toBeCloseTo(0.56)
    expect(recognitionThresholdForAttempt(0.50, 3)).toBeCloseTo(0.54)
  })
})
