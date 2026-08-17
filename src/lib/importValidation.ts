import type { ImportPreview, ImportPreviewRow } from '../types'

export interface KnownStudent {
  student_id: string
  full_name: string
}

export function parseCsv(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map((cell) => cell.trim()))
}

export function previewImport(
  text: string,
  knownStudents: KnownStudent[],
  kind: 'marks' | 'attendance',
): ImportPreview {
  const rows = parseCsv(text)
  const [header, ...body] = rows
  const studentIndex = header.findIndex((cell) => /student[_\s-]?id/i.test(cell))
  const valueIndex = header.findIndex((cell) => /^(marks?|score|status|attendance)$/i.test(cell))
  const seen = new Set<string>()
  const byId = new Map(knownStudents.map((student) => [student.student_id, student]))

  const previewRows: ImportPreviewRow[] = body.map((row, index) => {
    const messages: string[] = []
    const studentId = studentIndex >= 0 ? row[studentIndex] ?? '' : ''
    const value = valueIndex >= 0 ? row[valueIndex] ?? '' : ''
    const known = byId.get(studentId)

    if (studentIndex < 0) messages.push('Missing Student ID column')
    if (valueIndex < 0) messages.push('Missing marks/status column')
    if (!studentId) messages.push('Student ID is required')
    if (!known && studentId) messages.push('Student ID was not found')
    if (seen.has(studentId)) messages.push('Duplicate student in import')
    if (studentId) seen.add(studentId)

    if (kind === 'marks') {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric < 0) messages.push('Marks must be a non-negative number')
    } else if (!/^(present|absent|late|excused|manual_review)$/i.test(value)) {
      messages.push('Attendance status is invalid')
    }

    return {
      rowNumber: index + 2,
      studentId,
      studentName: known?.full_name,
      value,
      status: messages.length ? 'error' : 'valid',
      messages,
    }
  })

  return {
    importId: crypto.randomUUID(),
    kind,
    rows: previewRows,
    validCount: previewRows.filter((row) => row.status === 'valid').length,
    errorCount: previewRows.filter((row) => row.status === 'error').length,
  }
}
