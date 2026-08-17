import { AlertTriangle, FileDown, Search, Trash2, Upload, UsersRound } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChangeEvent, useMemo, useState } from 'react'
import { Card, IconButton, PageHeader, StatusPill } from '../components/Layout'
import { bulkCreateStudents, loadAppData } from '../lib/api'
import { previewStudentImport } from '../lib/importValidation'

const studentCsvFormat = `Student ID,Full Name,Email,Phone,Course Codes,Temporary Password
CSE001,Ananya Rao,ananya@college.edu,+91 90000 00001,CS601;CS642,Welcome@123
CSE002,Rohan Mehta,rohan@college.edu,+91 90000 00002,CS601,Welcome@123
CSE003,Sara Khan,sara@college.edu,+91 90000 00003,CS642,Welcome@123`

export function AdminStudents() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [csv, setCsv] = useState(studentCsvFormat)
  const [query, setQuery] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const students = data?.profiles.filter((profile) => profile.role === 'student') ?? []
  const filteredStudents = students.filter((student) => {
    const term = query.toLowerCase()
    return [student.full_name, student.student_id, student.email].some((value) => value?.toLowerCase().includes(term))
  })
  const preview = useMemo(() => previewStudentImport(csv, students.map((student) => ({
    student_id: student.student_id ?? '',
    full_name: student.full_name,
    email: student.email,
  }))), [csv, students])
  const validRows = preview.rows.filter((row) => row.status === 'valid')
  const createStudents = useMutation({
    mutationFn: () => bulkCreateStudents(validRows),
    onSuccess: async (result) => {
      setCommitMessage(`${result.created} students created, ${result.failed} failed`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    },
    onError: (error) => {
      setCommitMessage(error instanceof Error ? error.message : 'Bulk student import failed')
    },
  })

  async function readCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setCsv(await file.text())
  }

  function downloadFormat() {
    const blob = new Blob([studentCsvFormat], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'student-bulk-import-format.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader
        eyebrow="Course roster"
        title="Students and courses"
        action={<IconButton className="primary" onClick={downloadFormat}><FileDown size={16} />CSV format</IconButton>}
      >
        Upload one student roster file, preview errors, and keep student accounts locked to the student role by default.
      </PageHeader>

      <div className="two-column import-layout">
        <Card>
          <div className="section-title"><div><p className="eyebrow">Bulk add format</p><h2>Excel / CSV columns</h2></div><UsersRound size={20} /></div>
          <div className="format-box">
            <code>Student ID</code>
            <code>Full Name</code>
            <code>Email</code>
            <code>Phone</code>
            <code>Course Codes</code>
            <code>Temporary Password</code>
          </div>
          <p className="muted-copy">Save Excel as CSV. Separate multiple courses with semicolons, like <b>CS601;CS642</b>. Temporary passwords must be at least 8 characters; ask students to reset after first login.</p>
          <label className="file-picker">
            <Upload size={17} />Upload student CSV
            <input type="file" accept=".csv,text/csv" onChange={(event) => void readCsvFile(event)} />
          </label>
          <textarea value={csv} onChange={(event) => setCsv(event.target.value)} aria-label="Student CSV import input" />
          <div className="import-actions">
            <StatusPill tone={preview.errorCount ? 'danger' : 'good'}>{preview.validCount} valid / {preview.errorCount} errors</StatusPill>
            <IconButton disabled={preview.errorCount > 0 || !validRows.length || createStudents.isPending} onClick={() => createStudents.mutate()}><Upload size={16} />Create students</IconButton>
          </div>
          {commitMessage ? <p className="muted-copy"><b>Import result:</b> {commitMessage}</p> : null}
        </Card>

        <Card>
          <div className="section-title"><div><p className="eyebrow">Preview</p><h2>Rows to add</h2></div><StatusPill tone="neutral">{preview.importId.slice(0, 8)}</StatusPill></div>
          {preview.errorCount ? <p className="notice"><AlertTriangle size={16} />Fix highlighted rows before staging the roster.</p> : null}
          <div className="table-scroll">
            <table>
              <thead><tr><th>Row</th><th>Student</th><th>Email</th><th>Courses</th><th>Password</th><th>Status</th></tr></thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber} className={row.status === 'error' ? 'error-row' : undefined}>
                    <td>{row.rowNumber}</td>
                    <td><b>{row.studentId}</b><br /><small>{row.fullName}</small></td>
                    <td>{row.email}</td>
                    <td>{row.courseCodes.join(', ') || '-'}</td>
                    <td>{row.temporaryPassword ? 'set' : '-'}</td>
                    <td><StatusPill tone={row.status === 'valid' ? 'good' : 'danger'}>{row.messages.join(', ') || 'ready'}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="import-preview-card">
        <div className="table-toolbar">
          <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, student ID, or email" /></label>
          <IconButton><Trash2 size={16} />Preview bulk remove</IconButton>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Student ID</th><th>Email</th><th>Courses</th><th>Face</th></tr></thead>
          <tbody>
            {filteredStudents.map((student) => {
              const enrollment = data?.enrollments.find((item) => item.student_id === student.id)
              return (
                <tr key={student.id}>
                  <td>{student.full_name}</td>
                  <td>{student.student_id}</td>
                  <td>{student.email}</td>
                  <td>{enrollment?.course_codes.join(', ') || 'Unassigned'}</td>
                  <td><StatusPill tone={enrollment?.state === 'ready' ? 'good' : 'warn'}>{enrollment?.state ?? 'not started'}</StatusPill></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </>
  )
}
