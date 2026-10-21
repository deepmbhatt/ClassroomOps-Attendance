import type { NativeQuestion } from './nativeExams'

function questionNumber(prompt: string): number | null {
  const match = /^(?:q(?:uestion)?\s*(\d+)\b|(\d+)[.)]\s)/i.exec(prompt.trim())
  return match ? Number(match[1] ?? match[2]) : null
}

export function orderReviewQuestions(questions: NativeQuestion[]): NativeQuestion[] {
  const bySavedPosition = [...questions].sort((a, b) => a.position - b.position)
  const numbers = bySavedPosition.map((question) => questionNumber(question.prompt))
  const completeNumbering = numbers.every((number) => number !== null && number >= 1 && number <= questions.length)
    && new Set(numbers).size === questions.length
  if (!completeNumbering) return bySavedPosition
  return bySavedPosition.sort((a, b) => questionNumber(a.prompt)! - questionNumber(b.prompt)!)
}
