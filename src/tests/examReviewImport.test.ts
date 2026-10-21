import { describe, expect, it } from 'vitest'
import { previewExamReviewImport } from '../lib/examReviewImport'
import { parseCsv } from '../lib/importValidation'
import { pastQuestionHeadings } from '../lib/pastQuestionHeadings'
import { orderReviewQuestions } from '../lib/reviewQuestionOrder'
import type { NativeQuestion } from '../lib/nativeExams'

const questions: NativeQuestion[] = [
  { id: 'q1', exam_id: 'exam', position: 1, prompt: 'Explain the algorithm', question_type: 'descriptive', options: [] },
  { id: 'q2', exam_id: 'exam', position: 2, prompt: 'Choose an option', question_type: 'mcq', options: ['A', 'B'] },
]
const students = [{ id: 'student-1', student_id: '202618019' }]

describe('exam answer review import', () => {
  it('orders numbered question headings by Q number even when CSV columns are rearranged', () => {
    expect(pastQuestionHeadings('Enrollment Number,Q3,Q1,Q2\n202618019,c,a,b')).toEqual(['Q1', 'Q2', 'Q3'])
    expect(() => pastQuestionHeadings('Enrollment Number,Q1,Q3\n202618019,a,c')).toThrow(/each number/)
  })

  it('orders existing student reviews by their Q labels while retaining answer IDs', () => {
    const saved = [
      { ...questions[0], id: 'q3', position: 1, prompt: 'Q3: Last question' },
      { ...questions[0], id: 'q1', position: 2, prompt: 'Q1: First question' },
      { ...questions[0], id: 'q2', position: 3, prompt: 'Q2: Second question' },
    ]
    expect(orderReviewQuestions(saved).map(({ id, prompt }) => [id, prompt])).toEqual([
      ['q1', 'Q1: First question'], ['q2', 'Q2: Second question'], ['q3', 'Q3: Last question'],
    ])
    expect(orderReviewQuestions(saved.slice(0, 2)).map(({ id }) => id)).toEqual(['q3', 'q1'])
  })

  it('keeps multiline answers and empty cells when reading exported CSV', () => {
    const csv = 'Student ID,Q1 (descriptive): Explain the algorithm,Q2 (mcq): Choose an option\r\n202618019,"First line\nSecond line",\r\n'
    expect(parseCsv(csv)[1]).toEqual(['202618019', 'First line\nSecond line', ''])
    const preview = previewExamReviewImport(csv, 'answers', questions, students)
    expect(preview.errors).toEqual([])
    expect(preview.rows[0].values).toEqual({ q1: 'First line\nSecond line', q2: '' })
  })

  it('matches enrollment number and simple question headers for marks', () => {
    const preview = previewExamReviewImport('Enrollment Number,Q1,Q2\n202618019,5,', 'marks', questions, students)
    expect(preview.errors).toEqual([])
    expect(preview.rows[0].values).toEqual({ q1: 5, q2: null })
  })

  it('rejects unknown or duplicate enrollment rows and invalid marks', () => {
    const preview = previewExamReviewImport('Enrollment Number,Q1,Q2\n202618019,5,abc\n202618019,4,2\n000000000,1,1', 'marks', questions, students)
    expect(preview.errors.join(' ')).toMatch(/mark must be|duplicate enrollment|not enrolled/i)
  })
})
