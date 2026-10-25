import { describe, expect, it } from 'vitest'
import { parseCsv } from '../lib/importValidation'
import { reviewFlagsCsv } from '../lib/reviewFlagsCsv'
import type { NativeExamReview, NativeExamReviewFlag, NativeQuestion } from '../lib/nativeExams'

describe('flagged review export', () => {
  it('keeps a zero mark and safely quotes multiline answers and reasons', () => {
    const questions: NativeQuestion[] = [{ id: 'question-1', exam_id: 'exam-1', position: 1, prompt: 'Explain "why"', question_type: 'descriptive', options: [] }]
    const reviews: NativeExamReview[] = [{ exam_id: 'exam-1', student_id: 'student-1', answers: { 'question-1': 'Line one\nLine two' }, marks: { 'question-1': 0 }, updated_at: '2026-10-26T09:00:00Z' }]
    const flags: NativeExamReviewFlag[] = [{ exam_id: 'exam-1', student_id: 'student-1', question_id: 'question-1', reason: '=Please recheck, I used the right method', created_at: '2026-10-26T09:00:00Z', updated_at: '2026-10-26T09:05:00Z' }]
    const csv = reviewFlagsCsv(flags, questions, reviews, [{ id: 'student-1', student_id: '202618019', full_name: 'Student One' }])
    const rows = parseCsv(csv.replace(/^\uFEFF/, ''))
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual(['202618019', 'Student One', '1', 'Explain "why"', 'Line one\nLine two', '0', "'=Please recheck, I used the right method", '2026-10-26T09:05:00Z'])
  })
})
