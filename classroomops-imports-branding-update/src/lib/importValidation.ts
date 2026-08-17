import type { ImportPreview, ImportPreviewRow, MarksImportRow, StudentImportPreview, StudentImportPreviewRow } from '../types'

export interface KnownStudent {
  student_id: string
  full_name: string
  email?: string
}

function splitCsvLine(line: string) {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }

  cells.push(cell.trim())
  return cells
}

export function parseCsv(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(splitCsvLine)
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function getCell(row: string[], headerMap: Map<string, number>, aliases: string[]) {
  const index = aliases.map((alias) => headerMap.get(alias)).find((value) => value !== undefined)
  return index === undefined ? '' : row[index] ?? ''
}

export function previewStudentImport(text: string, existingStudents: KnownStudent[]): StudentImportPreview {
  const rows = parseCsv(text)
  const [header = [], ...body] = rows
  const headerMap = new Map(header.map((cell, index) => [normalizeHeader(cell), index]))
  const required = ['student_id', 'full_name', 'email']
  const existingByStudentId = new Set(existingStudents.map((student) => student.student_id).filter(Boolean))
  const existingByEmail = new Set(existingStudents.map((student) => student.email?.toLowerCase()).filter(Boolean))
  const seenStudentIds = new Set<string>()
  const seenEmails = new Set<string>()

  const previewRows: StudentImportPreviewRow[] = body.map((row, index) => {
    const studentId = getCell(row, headerMap, ['student_id', 'roll_no', 'roll_number', 'enrollment_no'])
    const fullName = getCell(row, headerMap, ['full_name', 'name', 'student_name'])
    const email = getCell(row, headerMap, ['email', 'email_id', 'student_email']).toLowerCase()
    const phone = getCell(row, headerMap, ['phone', 'mobile', 'phone_number'])
    const courseCodes = getCell(row, headerMap, ['course_codes', 'courses', 'subjects'])
      .split(/[;|]/)
      .map((course) => course.trim())
      .filter(Boolean)
    const messages: string[] = []

    for (const requiredColumn of required) {
      if (!headerMap.has(requiredColumn)) messages.push(`Missing ${requiredColumn.replace('_', ' ')} column`)
    }
    if (!studentId) messages.push('Student ID is required')
    if (!fullName) messages.push('Full name is required')
    if (!/^\S+@\S+\.\S+$/.test(email)) messages.push('Valid email is required')
    if (studentId && seenStudentIds.has(studentId)) messages.push('Duplicate Student ID in file')
    if (email && seenEmails.has(email)) messages.push('Duplicate email in file')
    if (studentId && existingByStudentId.has(studentId)) messages.push('Student ID already exists')
    if (email && existingByEmail.has(email)) messages.push('Email already exists')

    if (studentId) seenStudentIds.add(studentId)
    if (email) seenEmails.add(email)

    return {
      rowNumber: index + 2,
      studentId,
      fullName,
      email,
      phone,
      courseCodes,
      status: messages.length ? 'error' : 'valid',
      messages,
    }
  })

  return {
    importId: crypto.randomUUID(),
    rows: previewRows,
    validCount: previewRows.filter((row) => row.status === 'valid').length,
    errorCount: previewRows.filter((row) => row.status === 'error').length,
  }
}

export function previewAssessmentMarksImport(text: string, knownStudents: KnownStudent[], maxMarks: number): ImportPreview {
  const rows = parseCsv(text)
  const [header = [], ...body] = rows
  const headerMap = new Map(header.map((cell, index) => [normalizeHeader(cell), index]))
  const seen = new Set<string>()
  const byId = new Map(knownStudents.map((student) => [student.student_id, student]))

  const previewRows: ImportPreviewRow[] = body.map((row, index) => {
    const studentId = getCell(row, headerMap, ['student_id', 'roll_no', 'roll_number', 'enrollment_no'])
    const value = getCell(row, headerMap, ['marks', 'score', 'value', 'obtained_marks'])
    const messages: string[] = []
    const known = byId.get(studentId)
    const numeric = Number(value)

    if (!headerMap.has('student_id')) messages.push('Missing Student ID column')
    if (!headerMap.has('marks') && !headerMap.has('score') && !headerMap.has('obtained_marks')) messages.push('Missing Marks column')
    if (!studentId) messages.push('Student ID is required')
    if (!known && studentId) messages.push('Student ID was not found')
    if (studentId && seen.has(studentId)) messages.push('Duplicate student in import')
    if (!Number.isFinite(numeric) || numeric < 0) messages.push('Marks must be a non-negative number')
    if (Number.isFinite(numeric) && numeric > maxMarks) messages.push(`Marks exceed max ${maxMarks}`)

    if (studentId) seen.add(studentId)

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
    kind: 'marks',
    rows: previewRows,
    validCount: previewRows.filter((row) => row.status === 'valid').length,
    errorCount: previewRows.filter((row) => row.status === 'error').length,
  }
}

export function rowsToMarks(preview: ImportPreview): MarksImportRow[] {
  return preview.rows
    .filter((row) => row.status === 'valid')
    .map((row) => ({ studentId: row.studentId, value: Number(row.value) }))
}

export function previewImport(
  text: string,
  knownStudents: KnownStudent[],
  kind: 'marks' | 'attendance',
): ImportPreview {
  if (kind === 'marks') return previewAssessmentMarksImport(text, knownStudents, Number.POSITIVE_INFINITY)

  const rows = parseCsv(text)
  const [header = [], ...body] = rows
  const headerMap = new Map(header.map((cell, index) => [normalizeHeader(cell), index]))
  const seen = new Set<string>()
  const byId = new Map(knownStudents.map((student) => [student.student_id, student]))

  const previewRows: ImportPreviewRow[] = body.map((row, index) => {
    const studentId = getCell(row, headerMap, ['student_id', 'roll_no', 'roll_number', 'enrollment_no'])
    const value = getCell(row, headerMap, ['status', 'attendance'])
    const known = byId.get(studentId)
    const messages: string[] = []

    if (!studentId) messages.push('Student ID is required')
    if (!known && studentId) messages.push('Student ID was not found')
    if (seen.has(studentId)) messages.push('Duplicate student in import')
    if (studentId) seen.add(studentId)
    if (!/^(present|absent|late|excused|manual_review)$/i.test(value)) messages.push('Attendance status is invalid')

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
