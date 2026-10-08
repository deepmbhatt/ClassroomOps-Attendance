import { CheckCircle2, ExternalLink, FileDown, KeyRound, Link2, Save, ShieldCheck, Trash2, Upload, XCircle } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { Card, EmptyState, IconButton, PageHeader, SectionTabs, StatusPill } from '../components/Layout'
import { approveExamAccess, deleteExam, loadAppData, reviewExamExitCode, revokeExamAccess, upsertExam, upsertExamAccess } from '../lib/api'
import { parseCsv, readTabularFile } from '../lib/importValidation'
import { buildMasterRosterCsv, downloadTextFile } from '../lib/masterRoster'
import type { Exam } from '../types'

type AccessRow = {
  rowNumber: number
  studentId: string
  url: string
  verificationCode: string
  expectedExitCode: string
  submittedExitCode: string
  errors: string[]
}

type ExamEdit = {
  title: string
  courseId: string
  attendanceSessionId: string
  startsAt: string
  endsAt: string
  exitReleaseAt: string
  status: 'draft' | 'open' | 'closed'
  instructions: string
  exitInstruction: string
}

function toLocalInput(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : undefined
}

function randomCode(length = 6) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('')
}

function headerKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function cell(row: string[], headers: Map<string, number>, aliases: string[]) {
  const index = aliases.map((alias) => headers.get(alias)).find((value) => value !== undefined)
  return index === undefined ? '' : (row[index] ?? '').trim()
}

function parseAccessRows(text: string): AccessRow[] {
  const [header = [], ...body] = parseCsv(text)
  const headers = new Map(header.map((value, index) => [headerKey(value), index]))
  return body.filter((row) => row.some((value) => value.trim())).map((row, index) => {
    const studentId = cell(row, headers, ['student_id', 'roll_no', 'enrollment_no'])
    const url = cell(row, headers, ['individual_exam_link', 'exam_link', 'unstop_link', 'link'])
    const verificationCode = cell(row, headers, ['verification_code', 'exam_code']) || randomCode()
    const expectedExitCode = cell(row, headers, ['expected_exit_code', 'exit_code']) || randomCode()
    const submittedExitCode = cell(row, headers, ['submitted_exit_code', 'submitted_code'])
    const errors: string[] = []
    if (!studentId) errors.push('Student ID is required')
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || !(parsed.hostname === 'unstop.com' || parsed.hostname.endsWith('.unstop.com'))) errors.push('Use an HTTPS unstop.com link')
    } catch {
      errors.push('Individual Exam Link is required')
    }
    return { rowNumber: index + 2, studentId, url, verificationCode, expectedExitCode, submittedExitCode, errors }
  })
}

export function AdminExams() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [workspace, setWorkspace] = useState<'setup' | 'access' | 'review'>('setup')
  const [selectedExamId, setSelectedExamId] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [fileName, setFileName] = useState('')
  const [accessRows, setAccessRows] = useState<AccessRow[]>([])
  const [edit, setEdit] = useState<ExamEdit>({
    title: '', courseId: '', attendanceSessionId: '', startsAt: '', endsAt: '', exitReleaseAt: '', status: 'draft',
    instructions: 'Complete the verification code step before opening your individual assessment link.',
    exitInstruction: 'Use the announced rule to calculate your individual exit code and enter it in the mandatory final question.',
  })

  const exams = useMemo(() => data?.exams ?? [], [data?.exams])
  const selectedExam = exams.find((exam) => exam.id === selectedExamId) ?? (selectedExamId === '' ? exams[0] : undefined)
  const selectedAccess = (data?.examAccess ?? []).filter((access) => access.exam_id === selectedExam?.id)
  const sessions = (data?.lectures ?? []).filter((session) => !edit.courseId || session.course_id === edit.courseId)
  const validRows = accessRows.filter((row) => !row.errors.length)
  const faceAttendanceByStudent = useMemo(() => new Map((data?.attendance ?? [])
    .filter((record) => record.lecture_id === selectedExam?.attendance_session_id && record.source === 'face' && ['present', 'late'].includes(record.status))
    .map((record) => [record.student_id, record])), [data?.attendance, selectedExam?.attendance_session_id])

  useEffect(() => {
    const exam = exams[0]
    if (!selectedExamId && exam) {
      setSelectedExamId(exam.id)
      setEdit({
        title: exam.title, courseId: exam.course_id, attendanceSessionId: exam.attendance_session_id ?? '',
        startsAt: toLocalInput(exam.starts_at), endsAt: toLocalInput(exam.ends_at), exitReleaseAt: toLocalInput(exam.exit_release_at),
        status: exam.status, instructions: exam.instructions ?? '', exitInstruction: exam.exit_instruction ?? '',
      })
    }
  }, [exams, selectedExamId])

  function selectExam(exam?: Exam) {
    if (!exam) return
    setSelectedExamId(exam.id)
    setEdit({
      title: exam.title,
      courseId: exam.course_id,
      attendanceSessionId: exam.attendance_session_id ?? '',
      startsAt: toLocalInput(exam.starts_at),
      endsAt: toLocalInput(exam.ends_at),
      exitReleaseAt: toLocalInput(exam.exit_release_at),
      status: exam.status,
      instructions: exam.instructions ?? '',
      exitInstruction: exam.exit_instruction ?? '',
    })
  }

  function newExam() {
    setSelectedExamId('new')
    setEdit({ title: '', courseId: data?.courses[0]?.id ?? '', attendanceSessionId: '', startsAt: '', endsAt: '', exitReleaseAt: '', status: 'draft', instructions: '', exitInstruction: '' })
  }

  async function saveExam() {
    if (!edit.title.trim() || !edit.courseId || !edit.attendanceSessionId) {
      setMessage('Title, course, and face-attendance session are required.')
      return
    }
    setSaving(true)
    try {
      const saved = await upsertExam({
        id: selectedExamId && selectedExamId !== 'new' ? selectedExamId : undefined,
        courseId: edit.courseId,
        attendanceSessionId: edit.attendanceSessionId,
        title: edit.title,
        instructions: edit.instructions,
        exitInstruction: edit.exitInstruction,
        startsAt: toIso(edit.startsAt),
        endsAt: toIso(edit.endsAt),
        exitReleaseAt: toIso(edit.exitReleaseAt),
        status: edit.status,
      })
      setSelectedExamId(saved.id)
      setMessage('Exam settings saved.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Exam could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function removeExam() {
    if (!selectedExam || auth.role !== 'admin' || !window.confirm(`Delete ${selectedExam.title} and all access assignments?`)) return
    await deleteExam(selectedExam.id)
    setSelectedExamId('')
    setMessage('Exam deleted.')
    await queryClient.invalidateQueries({ queryKey: ['app-data'] })
  }

  async function readAccessFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setAccessRows(parseAccessRows(await readTabularFile(file)))
    setMessage('Missing verification and exit codes were generated. Download the prepared file before importing and keep it securely.')
  }

  function downloadMasterRoster() {
    if (!data) return
    downloadTextFile('classroomops-master-roster.csv', buildMasterRosterCsv(data.profiles, data.courseMemberships, data.courses))
  }

  function downloadPrepared() {
    const rows = [['Student ID', 'Individual Exam Link', 'Verification Code', 'Expected Exit Code', 'Submitted Exit Code'], ...accessRows.map((row) => [row.studentId, row.url, row.verificationCode, row.expectedExitCode, row.submittedExitCode])]
    downloadTextFile(`${selectedExam?.title ?? 'exam'}-secure-access.csv`, rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\n'))
  }

  async function importAccess() {
    if (!selectedExam) return
    setSaving(true)
    let saved = 0
    try {
      for (const row of validRows) {
        await upsertExamAccess({ examId: selectedExam.id, studentId: row.studentId, url: row.url, verificationCode: row.verificationCode, expectedExitCode: row.expectedExitCode })
        saved += 1
      }
      setMessage(`${saved} student-specific links and codes saved.`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(`Saved ${saved} rows before stopping. ${error instanceof Error ? error.message : 'Import failed.'}`)
    } finally {
      setSaving(false)
    }
  }

  async function setApproval(accessId: string, approved: boolean) {
    setSaving(true)
    try {
      if (approved) await approveExamAccess(accessId)
      else await revokeExamAccess(accessId)
      setMessage(approved ? 'Exam access approved.' : 'Exam access revoked.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Approval could not be changed.')
    } finally {
      setSaving(false)
    }
  }

  async function reviewExitCodes() {
    if (!selectedExam) return
    const submitted = accessRows.filter((row) => row.submittedExitCode)
    if (!submitted.length) {
      setMessage('Add Submitted Exit Code values to the prepared CSV and upload it again.')
      return
    }
    setSaving(true)
    let matched = 0
    let review = 0
    try {
      for (const row of submitted) {
        const access = selectedAccess.find((item) => item.student_identifier === row.studentId)
        if (!access) continue
        const result = await reviewExamExitCode(access.id, row.submittedExitCode)
        if (result === 'matched') matched += 1
        else review += 1
      }
      setMessage(`${matched} exit codes matched; ${review} flagged for manual review. No result was automatically invalidated.`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Exit-code review failed.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <PageHeader eyebrow="Secure assessment gateway" title="Exam access control" action={<IconButton onClick={downloadMasterRoster}><FileDown size={16} />Master roster CSV</IconButton>}>
      Gate each individual Unstop link behind face-verified attendance, staff approval, and a student-specific verification code.
    </PageHeader>
    {message ? <p className="notice">{message}</p> : null}
    <SectionTabs value={workspace} onChange={(value) => setWorkspace(value as typeof workspace)} items={[
      { value: 'setup', label: 'Exam setup', icon: <ShieldCheck size={16} />, count: exams.length },
      { value: 'access', label: 'Links & approvals', icon: <Link2 size={16} />, count: selectedAccess.length },
      { value: 'review', label: 'Exit review', icon: <KeyRound size={16} /> },
    ]} />

    <Card className="exam-selector-card">
      <label>Exam<select value={selectedExam?.id ?? 'new'} onChange={(event) => event.target.value === 'new' ? newExam() : selectExam(exams.find((exam) => exam.id === event.target.value))}><option value="new">New exam</option>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.course_code} — {exam.title}</option>)}</select></label>
      <IconButton onClick={newExam}>New exam</IconButton>
    </Card>

    {workspace === 'setup' ? <Card>
      <div className="section-title"><div><p className="eyebrow">Configuration</p><h2>{selectedExamId && selectedExamId !== 'new' ? 'Edit exam gateway' : 'Create exam gateway'}</h2></div></div>
      <div className="form-grid exam-form-grid">
        <label>Exam title<input value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} placeholder="End Semester Assessment" /></label>
        <label>Course<select value={edit.courseId} onChange={(event) => setEdit({ ...edit, courseId: event.target.value, attendanceSessionId: '' })}><option value="">Select course</option>{data?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></label>
        <label>Face-attendance session<select value={edit.attendanceSessionId} onChange={(event) => setEdit({ ...edit, attendanceSessionId: event.target.value })}><option value="">Select verified session</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.course_code} — {session.title} — {new Date(session.started_at).toLocaleString('en-IN')}</option>)}</select></label>
        <label>Status<select value={edit.status} onChange={(event) => setEdit({ ...edit, status: event.target.value as ExamEdit['status'] })}><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
        <label>Opens at<input type="datetime-local" value={edit.startsAt} onChange={(event) => setEdit({ ...edit, startsAt: event.target.value })} /></label>
        <label>Closes at<input type="datetime-local" value={edit.endsAt} onChange={(event) => setEdit({ ...edit, endsAt: event.target.value })} /></label>
        <label>Exit instruction release<input type="datetime-local" value={edit.exitReleaseAt} onChange={(event) => setEdit({ ...edit, exitReleaseAt: event.target.value })} /></label>
      </div>
      <label>Student instructions<textarea value={edit.instructions} onChange={(event) => setEdit({ ...edit, instructions: event.target.value })} /></label>
      <label>Final five-minute exit instruction<textarea value={edit.exitInstruction} onChange={(event) => setEdit({ ...edit, exitInstruction: event.target.value })} /></label>
      <div className="sheet-actions"><IconButton className="primary" onClick={() => void saveExam()} disabled={saving}><Save size={16} />Save exam</IconButton>{auth.role === 'admin' && selectedExam ? <IconButton className="danger-button" onClick={() => void removeExam()}><Trash2 size={16} />Delete exam</IconButton> : null}</div>
    </Card> : null}

    {workspace === 'access' ? <>
      {!selectedExam ? <EmptyState title="Select an exam" body="Create or select an exam before importing individual links." /> : <>
        <Card>
          <div className="section-title"><div><p className="eyebrow">One reusable spreadsheet</p><h2>Import individual links and codes</h2></div><StatusPill tone={accessRows.some((row) => row.errors.length) ? 'danger' : 'good'}>{validRows.length} ready</StatusPill></div>
          <p className="muted-copy">Use the Master roster CSV everywhere. For this page, fill Individual Exam Link; codes may be blank and will be generated. Download the prepared file before saving.</p>
          <div className="upload-row"><label className="file-picker"><Upload size={16} />Upload master CSV/Excel<input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void readAccessFile(event)} /></label>{fileName ? <span>{fileName}</span> : null}<IconButton disabled={!accessRows.length} onClick={downloadPrepared}><FileDown size={16} />Download prepared codes</IconButton><IconButton className="primary" disabled={!validRows.length || accessRows.some((row) => row.errors.length) || saving} onClick={() => void importAccess()}><Upload size={16} />Save links & codes</IconButton></div>
          {accessRows.length ? <div className="table-scroll"><table><thead><tr><th>Student ID</th><th>Unstop link</th><th>Verification code</th><th>Exit code</th><th>Status</th></tr></thead><tbody>{accessRows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? 'error-row' : undefined}><td>{row.studentId}</td><td className="truncate-cell">{row.url}</td><td><code>{row.verificationCode}</code></td><td><code>{row.expectedExitCode}</code></td><td>{row.errors.join(', ') || 'ready'}</td></tr>)}</tbody></table></div> : null}
        </Card>
        <Card>
          <div className="section-title"><div><p className="eyebrow">Face attendance → approval</p><h2>{selectedExam.title}</h2></div></div>
          <div className="table-scroll"><table><thead><tr><th>Student</th><th>Face attendance</th><th>Approval</th><th>Code</th><th>Link opened</th><th>Action</th></tr></thead><tbody>{selectedAccess.map((access) => {
            const faceRecord = faceAttendanceByStudent.get(access.student_id)
            return <tr key={access.id}><td><strong>{access.student_name}</strong><small>{access.student_identifier}</small></td><td><StatusPill tone={faceRecord ? 'good' : 'danger'}>{faceRecord ? faceRecord.status : 'not face verified'}</StatusPill></td><td><StatusPill tone={access.approved_at ? 'good' : 'warn'}>{access.approved_at ? 'approved' : 'waiting'}</StatusPill></td><td>{access.code_verified_at ? 'verified' : `••••${access.verification_code_hint ?? ''}`}</td><td>{access.link_opened_at ? new Date(access.link_opened_at).toLocaleTimeString('en-IN') : 'not opened'}</td><td>{access.approved_at ? <IconButton onClick={() => void setApproval(access.id, false)} disabled={saving}><XCircle size={15} />Revoke</IconButton> : <IconButton className="primary" onClick={() => void setApproval(access.id, true)} disabled={!faceRecord || saving}><CheckCircle2 size={15} />Approve exam access</IconButton>}</td></tr>
          })}</tbody></table></div>
          {!selectedAccess.length ? <EmptyState title="No individual links imported" body="Upload the master roster with an Individual Exam Link for each student." /> : null}
        </Card>
      </>}
    </> : null}

    {workspace === 'review' ? <Card>
      <div className="section-title"><div><p className="eyebrow">Post-submission check</p><h2>Exit-code review</h2></div><StatusPill tone="neutral">Incorrect codes are flagged, never auto-zeroed</StatusPill></div>
      <p className="muted-copy">Add the codes exported from Unstop to the Submitted Exit Code column of the same prepared CSV, upload it here, and compare.</p>
      <div className="upload-row"><label className="file-picker"><Upload size={16} />Upload submitted codes<input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void readAccessFile(event)} /></label><IconButton className="primary" disabled={saving || !accessRows.some((row) => row.submittedExitCode)} onClick={() => void reviewExitCodes()}>Review exit codes</IconButton></div>
      <div className="table-scroll"><table><thead><tr><th>Student</th><th>Initial code</th><th>Link</th><th>Exit result</th></tr></thead><tbody>{selectedAccess.map((access) => <tr key={access.id}><td>{access.student_name}<small>{access.student_identifier}</small></td><td>{access.code_verified_at ? 'verified' : 'not verified'}</td><td>{access.link_opened_at ? <ExternalLink size={15} /> : 'not opened'}</td><td><StatusPill tone={access.exit_review_status === 'matched' ? 'good' : access.exit_review_status === 'manual_review' ? 'warn' : 'neutral'}>{access.exit_review_status.replace('_', ' ')}</StatusPill></td></tr>)}</tbody></table></div>
    </Card> : null}
  </>
}
