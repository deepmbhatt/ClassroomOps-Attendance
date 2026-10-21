import { parseCsv } from './importValidation'

const ignoredHeadings = new Set(['enrollment number', 'enrollment no', 'student id', 'student_id', 'roll number', 'roll no', 'name', 'student name', 'email', 'attempt status', 'warnings', 'started at', 'submitted at', 'submission reason', 'exit code verified'])
const enrollmentHeadings = new Set(['enrollment number', 'enrollment no', 'student id', 'student_id', 'roll number', 'roll no'])

export function pastQuestionHeadings(csv: string): string[] {
  const [headers = []] = parseCsv(csv)
  const normalized = headers.map((header) => header.trim())
  if (!normalized.some((header) => enrollmentHeadings.has(header.toLowerCase()))) {
    throw new Error('The file needs an Enrollment Number column.')
  }
  const questions = normalized.filter((header) => header && !ignoredHeadings.has(header.toLowerCase()))
  if (!questions.length) throw new Error('The file needs at least one question column.')
  if (new Set(questions.map((header) => header.toLowerCase())).size !== questions.length) {
    throw new Error('Question headings must be unique.')
  }

  const numbered = questions.map((header) => /^(?:q|question)\s*(\d+)\b/i.exec(header)?.[1])
  if (numbered.some(Boolean)) {
    if (numbered.some((number) => !number)) throw new Error('Use Q1, Q2, etc. for every question column, or use question text for every column.')
    const positions = numbered.map(Number)
    if (new Set(positions).size !== positions.length || positions.some((position) => position < 1 || position > questions.length)) {
      throw new Error(`Question headings must contain each number from Q1 to Q${questions.length} once.`)
    }
    return questions.map((heading, index) => ({ heading, position: positions[index] }))
      .sort((a, b) => a.position - b.position).map(({ heading }) => heading)
  }
  return questions
}
