import { describe, expect, it } from 'vitest'
import { importExamQuestions } from '../lib/examQuestionImport'

describe('new exam question import', () => {
  it('loads and orders descriptive and MCQ question rows', () => {
    expect(importExamQuestions('Position,Question,Type,Option 1,Option 2\n2,Choose a color,mcq,Red,Blue\n1,Explain the result,descriptive,,')).toEqual([
      { prompt: 'Explain the result', question_type: 'descriptive', options: [] },
      { prompt: 'Choose a color', question_type: 'mcq', options: ['Red', 'Blue'] },
    ])
  })

  it('also accepts an existing answer sheet with question columns', () => {
    expect(importExamQuestions('Enrollment Number,Q2,Q1\n202618019,second,first')).toEqual([
      { prompt: 'Q1', question_type: 'descriptive', options: [] },
      { prompt: 'Q2', question_type: 'descriptive', options: [] },
    ])
  })

  it('rejects incomplete MCQs and duplicate positions', () => {
    expect(() => importExamQuestions('Question,Type,Option 1\nChoose,mcq,Only one')).toThrow(/2 to 8 options/)
    expect(() => importExamQuestions('Position,Question\n1,First\n1,Second')).toThrow(/Position/)
  })
})
