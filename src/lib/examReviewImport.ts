import { parseCsv } from './importValidation'
import type { NativeQuestion } from './nativeExams'

export type ReviewKind = 'answers' | 'marks'
export type ReviewImportRow = { student_id: string; values: Record<string, string | number | null> }
export type ReviewImportPreview = { rows: ReviewImportRow[]; errors: string[] }

const normalize = (value: string) => value.replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ').toLowerCase()
const enrollmentHeaders = new Set(['enrollment number', 'enrollment no', 'enrollment no.', 'student id', 'student_id', 'roll number', 'roll no'])
const ignoredHeaders = new Set(['name', 'student name', 'email', 'attempt status', 'warnings', 'started at', 'submitted at', 'submission reason', 'exit code verified'])

export function previewExamReviewImport(
  csv: string,
  kind: ReviewKind,
  questions: NativeQuestion[],
  students: Array<{ id: string; student_id?: string }>,
): ReviewImportPreview {
  const errors: string[] = []
  let table: string[][]
  try { table = parseCsv(csv) } catch (error) { return { rows: [], errors: [error instanceof Error ? error.message : 'Could not read CSV.'] } }
  const [headers = [], ...body] = table
  const enrollmentIndex = headers.findIndex((header) => enrollmentHeaders.has(normalize(header)))
  if (enrollmentIndex < 0) errors.push('Add an Enrollment Number column.')
  if (!questions.length) errors.push('Select an exam with saved questions first.')
  if (!body.length) errors.push('The file has no student rows.')
  if (body.length > 1000) errors.push('Import up to 1,000 students per file. Split larger groups into separate files.')
  const columns = new Map<string, number>()
  const used = new Set<number>()
  for (const question of questions) {
    const labels = [question.prompt, `Q${question.position}`, `Question ${question.position}`, `Q${question.position}: ${question.prompt}`, `Q${question.position} (${question.question_type}): ${question.prompt}`].map(normalize)
    const matches = headers.map((header, index) => labels.includes(normalize(header)) ? index : -1).filter((index) => index >= 0)
    if (matches.length !== 1 || used.has(matches[0])) errors.push(`Question ${question.position} needs one unique column (use Q${question.position}).`)
    else { columns.set(question.id, matches[0]); used.add(matches[0]) }
  }
  for (const [index, header] of headers.entries()) {
    if (index !== enrollmentIndex && !used.has(index) && !ignoredHeaders.has(normalize(header))) errors.push(`Unrecognized column: ${header || '(blank header)'}.`)
  }
  const studentByEnrollment = new Map(students.filter((student) => student.student_id).map((student) => [normalize(student.student_id!), student.id]))
  const seen = new Set<string>()
  const rows: ReviewImportRow[] = []
  for (const [rowIndex, cells] of body.entries()) {
    const enrollment = cells[enrollmentIndex]?.trim() ?? ''
    const studentId = studentByEnrollment.get(normalize(enrollment))
    if (!enrollment) { errors.push(`Row ${rowIndex + 2}: enrollment number is blank.`); continue }
    if (!studentId) { errors.push(`Row ${rowIndex + 2}: ${enrollment} is not enrolled in this course.`); continue }
    if (seen.has(studentId)) { errors.push(`Row ${rowIndex + 2}: duplicate enrollment number ${enrollment}.`); continue }
    seen.add(studentId)
    const values: ReviewImportRow['values'] = {}
    for (const question of questions) {
      const index = columns.get(question.id)
      const value = index === undefined ? '' : cells[index] ?? ''
      if (kind === 'marks') {
        if (value && !/^\d+(?:\.\d{1,2})?$/.test(value)) errors.push(`Row ${rowIndex + 2}, Q${question.position}: mark must be a non-negative number with up to 2 decimals or blank.`)
        values[question.id] = value === '' ? null : Number(value)
      } else {
        if (value.length > 50000) errors.push(`Row ${rowIndex + 2}, Q${question.position}: answer exceeds 50,000 characters.`)
        values[question.id] = value
      }
    }
    rows.push({ student_id: studentId, values })
  }
  return { rows, errors }
}
