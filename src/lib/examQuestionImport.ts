import { parseCsv } from './importValidation'
import { pastQuestionHeadings } from './pastQuestionHeadings'

export type ImportedExamQuestion = { prompt: string; question_type: 'descriptive' | 'mcq'; options: string[] }

export function importExamQuestions(csv: string): ImportedExamQuestion[] {
  const [headers = [], ...rows] = parseCsv(csv)
  const names = headers.map((header) => header.trim().toLowerCase())
  const promptIndex = names.findIndex((header) => header === 'question' || header === 'prompt' || header === 'question text')
  const enrollmentIndex = names.findIndex((header) => ['enrollment number', 'enrollment no', 'student id', 'student_id', 'roll number', 'roll no'].includes(header))
  if (promptIndex < 0 || enrollmentIndex >= 0) {
    return pastQuestionHeadings(csv).map((prompt) => ({ prompt, question_type: 'descriptive', options: [] }))
  }
  const typeIndex = names.findIndex((header) => header === 'type' || header === 'question type')
  const positionIndex = names.findIndex((header) => header === 'position' || header === 'number')
  const optionColumns = names.map((header, index) => /^option\s*[1-8]$/.test(header) ? index : -1).filter((index) => index >= 0)
  if (!rows.length) throw new Error('The question file has no rows.')
  const questions = rows.map((cells, index) => {
    const prompt = (cells[promptIndex] ?? '').trim()
    const type = (typeIndex < 0 ? 'descriptive' : cells[typeIndex]?.trim() || 'descriptive').toLowerCase()
    const options = optionColumns.map((column) => (cells[column] ?? '').trim()).filter(Boolean)
    const position = positionIndex < 0 ? index + 1 : Number((cells[positionIndex] ?? '').trim())
    if (!prompt) throw new Error(`Row ${index + 2}: question text is blank.`)
    if (type !== 'descriptive' && type !== 'mcq') throw new Error(`Row ${index + 2}: type must be descriptive or mcq.`)
    if (type === 'mcq' && (options.length < 2 || options.length > 8)) throw new Error(`Row ${index + 2}: an MCQ needs 2 to 8 options.`)
    if (type === 'descriptive' && options.length) throw new Error(`Row ${index + 2}: descriptive questions cannot have options.`)
    return { position, prompt, question_type: type === 'mcq' ? 'mcq' as const : 'descriptive' as const, options }
  })
  if (new Set(questions.map((question) => question.position)).size !== questions.length ||
    questions.some((question) => !Number.isInteger(question.position) || question.position < 1 || question.position > questions.length)) {
    throw new Error(`Position must contain each number from 1 to ${questions.length} once.`)
  }
  return questions.sort((a, b) => a.position - b.position)
    .map(({ prompt, question_type, options }) => ({ prompt, question_type, options }))
}
