import { Download, FileDown, Save, Trash2, Upload } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { Card, EmptyState, IconButton, PageHeader, Spinner, StatusPill } from '../components/Layout'
import { deleteAttendanceRecord, loadAppData, markAttendanceRecords } from '../lib/api'
import { attendanceTone, localDateKey } from '../lib/attendanceView'
import { parseCsv, readTabularFile } from '../lib/importValidation'
import { normalizeAttendanceStatus } from '../lib/attendance'
import type { AttendanceStatus } from '../types'

interface AttendanceEdit {
  status: AttendanceStatus | ''
  markedAt: string
  reason: string
  dirty: boolean
}

const attendanceFormat = `Student ID,Status,Marked At,Reason
202618001,present,2026-09-02T09:00:00+05:30,Verified by administrator
202618002,absent,2026-09-02T09:00:00+05:30,Absent`

function toLocalDateTime(value?: string) {
  const date = value ? new Date(value) : new Date()
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function AdminAttendanceReview() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [date, setDate] = useState(() => localDateKey(new Date()))
  const [courseId, setCourseId] = useState('')
  const [lectureId, setLectureId] = useState('')
  const [edits, setEdits] = useState<Record<string, AttendanceEdit>>({})
  const [fileName, setFileName] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const sessions = useMemo(() => (data?.lectures ?? [])
    .filter((session) => localDateKey(session.started_at) === date && (!courseId || session.course_id === courseId))
    .sort((left, right) => new Date(left.started_at).getTime() - new Date(right.started_at).getTime()), [courseId, data?.lectures, date])
  const selectedSession = sessions.find((session) => session.id === lectureId) ?? sessions[0]

  useEffect(() => {
    if (selectedSession && lectureId !== selectedSession.id) setLectureId(selectedSession.id)
    if (!selectedSession && lectureId) setLectureId('')
  }, [lectureId, selectedSession])

  const students = useMemo(() => {
    if (!data || !selectedSession) return []
    const ids = new Set(data.courseMemberships.filter((item) => item.course_id === selectedSession.course_id && !item.deleted_at).map((item) => item.student_id))
    return data.profiles
      .filter((profile) => ids.has(profile.id) && profile.role === 'student' && profile.approval_status === 'approved' && !profile.deleted_at)
      .sort((left, right) => (left.student_id ?? '').localeCompare(right.student_id ?? ''))
  }, [data, selectedSession])

  useEffect(() => setEdits({}), [selectedSession?.id])

  if (isLoading) return <Spinner />
  if (!data) return null

  function editFor(studentId: string): AttendanceEdit {
    const record = data!.attendance.find((item) => item.lecture_id === selectedSession?.id && item.student_id === studentId)
    return edits[studentId] ?? {
      status: record?.status ?? '',
      markedAt: toLocalDateTime(record?.marked_at ?? selectedSession?.started_at),
      reason: record?.reason ?? '',
      dirty: false,
    }
  }

  function updateEdit(studentId: string, patch: Partial<AttendanceEdit>) {
    setEdits((current) => ({ ...current, [studentId]: { ...editFor(studentId), ...patch, dirty: true } }))
  }

  async function saveRows(studentIds: string[]) {
    if (!selectedSession) return
    setSaving(true)
    setMessage('')
    try {
      const validStudentIds = studentIds.filter((studentId) => editFor(studentId).status)
      if (!validStudentIds.length) throw new Error('Choose an attendance status before saving.')
      await markAttendanceRecords(validStudentIds.map((studentId) => {
        const edit = editFor(studentId)
        return {
          lectureId: selectedSession.id,
          studentId,
          status: edit.status as AttendanceStatus,
          reason: edit.reason || 'Updated during attendance review',
          markedAt: new Date(edit.markedAt).toISOString(),
        }
      }))
      setEdits({})
      setMessage(validStudentIds.length + ' attendance record' + (validStudentIds.length === 1 ? '' : 's') + ' saved.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Attendance could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function removeRecord(studentId: string, recordId: string) {
    if (!window.confirm('Remove this attendance status from the selected session?')) return
    setSaving(true)
    setMessage('')
    try {
      await deleteAttendanceRecord(recordId)
      setEdits((current) => {
        const next = { ...current }
        delete next[studentId]
        return next
      })
      setMessage('Attendance status removed. The student is now not marked for this session.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Attendance status could not be removed.')
    } finally {
      setSaving(false)
    }
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setMessage('')
    try {
      const [header = [], ...rows] = parseCsv(await readTabularFile(file))
      const normalized = header.map((cell) => cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'))
      const studentIndex = normalized.indexOf('student_id')
      const statusIndex = normalized.indexOf('status')
      const markedAtIndex = normalized.indexOf('marked_at')
      const reasonIndex = normalized.indexOf('reason')
      if (studentIndex < 0 || statusIndex < 0) throw new Error('File must include Student ID and Status columns.')
      const next: Record<string, AttendanceEdit> = {}
      const errors: string[] = []
      rows.forEach((row, index) => {
        const student = students.find((item) => item.student_id === row[studentIndex]?.trim())
        if (!student) {
          errors.push(`row ${index + 2}: student not in this course`)
          return
        }
        try {
          const status = normalizeAttendanceStatus(row[statusIndex] ?? '')
          next[student.id] = {
            status,
            markedAt: toLocalDateTime(row[markedAtIndex] || selectedSession?.started_at),
            reason: row[reasonIndex] || 'Imported for administrator review',
            dirty: true,
          }
        } catch {
          errors.push(`row ${index + 2}: invalid status`)
        }
      })
      setEdits(next)
      setMessage(errors.length ? `${Object.keys(next).length} rows loaded; ${errors.length} need correction.` : `${Object.keys(next).length} rows loaded into the review sheet. Confirm and save changes.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not read attendance file.')
    }
  }

  function downloadFormat() {
    downloadCsv('attendance-import-format.csv', attendanceFormat)
  }

  function exportSession() {
    if (!selectedSession) return
    const rows = [['Student ID', 'Name', 'Course', 'Session', 'Date', 'Status', 'Marked At', 'Source', 'Reason']]
    students.forEach((student) => {
      const record = data!.attendance.find((item) => item.lecture_id === selectedSession.id && item.student_id === student.id)
      rows.push([student.student_id ?? '', student.full_name, selectedSession.course_code, selectedSession.title, localDateKey(selectedSession.started_at), record?.status ?? '', record?.marked_at ?? '', record?.source ?? 'unmarked', record?.reason ?? ''])
    })
    downloadCsv(`${selectedSession.course_code}-${localDateKey(selectedSession.started_at)}-attendance.csv`, rows.map((row) => row.map(csvCell).join(',')).join('\n'))
  }

  const dirtyIds = Object.entries(edits).filter(([, edit]) => edit.dirty).map(([id]) => id)

  return (
    <>
      <PageHeader eyebrow="Attendance register" title="Review attendance" action={<IconButton title="Download the selected session as CSV" onClick={exportSession} disabled={!selectedSession}><Download size={16} />Export</IconButton>}>
        Select a date and session, then review or correct attendance in one spreadsheet-style register.
      </PageHeader>
      {message ? <p className="notice">{message}</p> : null}

      <Card className="attendance-review-controls">
        <div className="filter-grid">
          <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>Course<select value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">All courses</option>{data.courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.title}</option>)}</select></label>
          <label>Session<select value={selectedSession?.id ?? ''} onChange={(event) => setLectureId(event.target.value)} disabled={!sessions.length}>{sessions.map((session) => <option key={session.id} value={session.id}>{new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(session.started_at))} - {session.course_code} - {session.title}</option>)}</select></label>
        </div>
        <div className="upload-row">
          <label className="file-picker" title="Load Excel or CSV values into the sheet before saving"><Upload size={17} />Load Excel/CSV<input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(event) => void readFile(event)} disabled={!selectedSession} /></label>
          <IconButton title="Download the required attendance file columns" onClick={downloadFormat}><FileDown size={16} />Format</IconButton>
          {fileName ? <span className="file-name">{fileName}</span> : null}
        </div>
      </Card>

      {selectedSession ? <Card>
        <div className="section-title"><div><p className="eyebrow">{selectedSession.course_code} / {selectedSession.status}</p><h2>{selectedSession.title}</h2></div><StatusPill tone={selectedSession.status === 'closed' ? 'good' : 'warn'}>{students.length} students</StatusPill></div>
        <div className="sheet-actions">
          <IconButton title="Set every visible student to present in the review sheet" onClick={() => students.forEach((student) => updateEdit(student.id, { status: 'present' }))}>All present</IconButton>
          <IconButton title="Set every visible student to absent in the review sheet" onClick={() => students.forEach((student) => updateEdit(student.id, { status: 'absent' }))}>All absent</IconButton>
          <IconButton className="primary" title="Save every changed row" disabled={!dirtyIds.length || saving} onClick={() => void saveRows(dirtyIds)}><Save size={16} />{saving ? 'Saving...' : `Save ${dirtyIds.length} changes`}</IconButton>
        </div>
        <div className="table-scroll">
          <table className="editable-table attendance-review-table">
            <thead><tr><th>Student</th><th>Status</th><th>Marked at</th><th>Reason</th><th>Source</th><th>Actions</th></tr></thead>
            <tbody>{students.map((student) => {
              const edit = editFor(student.id)
              const record = data.attendance.find((item) => item.lecture_id === selectedSession.id && item.student_id === student.id)
              return <tr key={student.id} className={edit.dirty ? 'edited-row' : undefined}>
                <td><strong>{student.full_name}</strong><small>{student.student_id}</small></td>
                <td><select className={`attendance-status-select ${attendanceTone(edit.status || undefined)}`} value={edit.status} onChange={(event) => updateEdit(student.id, { status: event.target.value as AttendanceStatus | "" })}><option value="">Not marked</option><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option><option value="manual_review">Manual review</option></select></td>
                <td><input type="datetime-local" value={edit.markedAt} onChange={(event) => updateEdit(student.id, { markedAt: event.target.value })} /></td>
                <td><input value={edit.reason} onChange={(event) => updateEdit(student.id, { reason: event.target.value })} placeholder="Reason for change" /></td>
                <td>{record?.source ?? 'not marked'}</td>
                <td><div className="row-action-group"><button className="icon-only-button" title="Save this attendance row" disabled={saving || !edit.status} onClick={() => void saveRows([student.id])}><Save size={15} /></button><button className="icon-only-button danger-button" title="Remove attendance status for this session" disabled={saving || !record} onClick={() => record && void removeRecord(student.id, record.id)}><Trash2 size={15} /></button></div></td>
              </tr>
            })}</tbody>
          </table>
        </div>
        {!students.length ? <EmptyState title="No students assigned" body="Assign approved students to this course from Courses & students." /> : null}
      </Card> : <EmptyState title="No session on this date" body="Choose another date, or start a live attendance session first." />}
    </>
  )
}

function csvCell(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function downloadCsv(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
