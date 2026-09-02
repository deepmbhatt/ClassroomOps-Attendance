import { BookOpen, CheckCircle2, FileDown, FileSpreadsheet, Plus, Save, Search, Trash2, Upload, UserRoundCheck, Users, UsersRound, XCircle } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChangeEvent, useMemo, useState } from 'react'
import { Card, EmptyState, IconButton, PageHeader, SectionTabs, StatusPill } from '../components/Layout'
import { approveStudentRegistration, bulkCreateStudents, loadAppData, rejectStudentRegistration, setStudentCourseCodes, syncMissingAuthProfiles, softDeleteCourse, softDeleteStudent, updateExistingStudents, updateStudentProfile, upsertCourse } from '../lib/api'
import { previewStudentImport, readTabularFile } from '../lib/importValidation'
import type { Course, Profile, StudentImportPreviewRow } from '../types'

const studentCsvFormat = `Student ID,Full Name,Email,Phone,Course Codes,Temporary Password
CSE001,Ananya Rao,ananya@college.edu,+91 90000 00001,CS601;CS642,Welcome@123
CSE002,Rohan Mehta,rohan@college.edu,+91 90000 00002,CS601,Welcome@123`

const courseCsvFormat = `Code,Title,Term,Active
CS601,Machine Learning,2026-27 Semester 1,true
CS642,Data Science Lab,2026-27 Semester 1,true`

type EditableStudent = { fullName: string; studentId: string; email: string; phone: string; courseCodes: string; mustChangePassword: boolean }
type EditableCourse = { id?: string; code: string; title: string; term: string; active: boolean }

export function AdminStudents() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [studentCsv, setStudentCsv] = useState(studentCsvFormat)
  const [courseCsv, setCourseCsv] = useState(courseCsvFormat)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [workspace, setWorkspace] = useState<'pending' | 'courses' | 'import' | 'directory'>('pending')
  const [studentEdits, setStudentEdits] = useState<Record<string, EditableStudent>>({})
  const [approvalCsv, setApprovalCsv] = useState('Student ID,Full Name,Email,Phone,Course Codes\n')
  const [pendingCourseCodes, setPendingCourseCodes] = useState<Record<string, string>>({})
  const [approving, setApproving] = useState(false)
  const [courseDraft, setCourseDraft] = useState<EditableCourse>({ code: '', title: '', term: '2026-27 Semester 1', active: true })
  const [courseEdits, setCourseEdits] = useState<Record<string, EditableCourse>>({})

  const courses = data?.courses ?? []
  const allStudents = useMemo(() => data?.profiles.filter((profile) => profile.role === 'student') ?? [], [data])
  const pendingStudents = allStudents.filter((profile) => profile.approval_status === 'pending' && !profile.deleted_at)
  const students = allStudents.filter((profile) => profile.approval_status !== 'pending' && profile.approval_status !== 'rejected' && !profile.deleted_at)
  const memberships = data?.courseMemberships ?? []
  const courseById = new Map(courses.map((course) => [course.id, course]))

  const filteredStudents = students.filter((student) => {
    const term = query.toLowerCase()
    return [student.full_name, student.student_id, student.email].some((value) => value?.toLowerCase().includes(term))
  })

  const preview = useMemo(() => previewStudentImport(studentCsv, students.map((student) => ({
    student_id: student.student_id ?? '',
    full_name: student.full_name,
    email: student.email,
  })), { allowExisting: true }), [studentCsv, students])

  const validRows = preview.rows.filter((row) => row.status === 'valid')
  const existingRows = validRows.filter((row) => students.some((student) => student.student_id === row.studentId || student.email.toLowerCase() === row.email.toLowerCase()))
  const newRows = validRows.filter((row) => !existingRows.includes(row))
  const approvalPreview = useMemo(() => previewStudentImport(approvalCsv, allStudents.map((student) => ({
    student_id: student.student_id ?? '',
    full_name: student.full_name,
    email: student.email,
  })), { allowExisting: true }), [approvalCsv, allStudents])
  const matchedApprovalRows = approvalPreview.rows
    .filter((row) => row.status === 'valid')
    .map((row) => ({
      row,
      profile: pendingStudents.find((student) => student.student_id === row.studentId || student.email.toLowerCase() === row.email.toLowerCase()),
    }))
    .filter((match): match is { row: StudentImportPreviewRow; profile: Profile } => Boolean(match.profile))

  const importRoster = useMutation({
    mutationFn: async () => {
      let created = 0
      let failed = 0
      let failureMessage = ''
      if (newRows.length) {
        const result = await bulkCreateStudents(newRows)
        created = result.created
        failed = result.failed
        failureMessage = result.results
          .filter((row) => row.status === 'error')
          .map((row) => `${row.studentId}: ${row.message}`)
          .join('; ')
      }
      if (existingRows.length) await updateExistingStudents(existingRows, students)
      return { created, updated: existingRows.length, failed, failureMessage }
    },
    onSuccess: async (result) => {
      setMessage(
        result.failed
          ? `${result.created} created, ${result.updated} updated, ${result.failed} failed. ${result.failureMessage}`
          : `${result.created} new accounts created and ${result.updated} existing students updated.`,
      )
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
      if (!result.failed) {
        setQuery(validRows[0]?.studentId ?? '')
        setWorkspace('directory')
      }
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Roster import failed'),
  })

  const saveCourse = useMutation({
    mutationFn: upsertCourse,
    onSuccess: async () => {
      setCourseDraft({ code: '', title: '', term: courseDraft.term, active: true })
      setMessage('Course saved.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Course save failed'),
  })

  async function readStudentFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setStudentCsv(await readTabularFile(file))
  }

  async function readCourseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setCourseCsv(await readTabularFile(file))
  }

  async function readApprovalFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setApprovalCsv(await readTabularFile(file))
  }

  async function syncRegistrations() {
    setApproving(true)
    try {
      const recovered = await syncMissingAuthProfiles()
      setMessage(recovered ? 'Recovered ' + recovered + (recovered === 1 ? ' registration' : ' registrations') + ' from Supabase Auth.' : 'All Auth registrations already have profiles.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sync registrations')
    } finally {
      setApproving(false)
    }
  }

  function approvalMatch(student: Profile) {
    return matchedApprovalRows.find((match) => match.profile.id === student.id)?.row
  }

  function approvalCourses(student: Profile) {
    return pendingCourseCodes[student.id] ?? approvalMatch(student)?.courseCodes.join(';') ?? ''
  }

  async function approveOne(student: Profile) {
    const courseCodes = approvalCourses(student).split(/[;,|]/).map((code) => code.trim()).filter(Boolean)
    if (!courseCodes.length) {
      setMessage(`Assign at least one valid course code before approving ${student.full_name}.`)
      return
    }
    setApproving(true)
    try {
      await approveStudentRegistration({ studentId: student.id, courseCodes })
      setMessage(`${student.full_name} approved and assigned to ${courseCodes.join(', ')}.`)
      setPendingCourseCodes((current) => {
        const next = { ...current }
        delete next[student.id]
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not approve registration')
    } finally {
      setApproving(false)
    }
  }

  async function approveMatched() {
    const ready = matchedApprovalRows.filter((match) => match.row.courseCodes.length > 0)
    if (!ready.length) {
      setMessage('No matched rows have course codes. Add Course Codes to the approval file first.')
      return
    }
    setApproving(true)
    let approved = 0
    try {
      for (const match of ready) {
        await approveStudentRegistration({ studentId: match.profile.id, courseCodes: match.row.courseCodes })
        approved += 1
      }
      setMessage(`${approved} matched registrations approved and assigned to courses.`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(`Approved ${approved} before stopping. ${error instanceof Error ? error.message : 'Bulk approval failed'}`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } finally {
      setApproving(false)
    }
  }

  async function rejectOne(student: Profile) {
    if (!window.confirm(`Reject ${student.full_name}'s registration? The account will remain stored for audit and can be reviewed in Supabase.`)) return
    try {
      await rejectStudentRegistration(student.id)
      setMessage(`${student.full_name}'s registration was rejected.`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not reject registration')
    }
  }

  function exportPending() {
    const rows = [
      ['Student ID', 'Full Name', 'Email', 'Phone', 'Course Codes'],
      ...pendingStudents.map((student) => [student.student_id ?? '', student.full_name, student.email, student.phone ?? '', '']),
    ]
    download('pending-student-registrations.csv', rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n'))
  }

  function download(name: string, text: string) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }

  function studentCourses(studentId: string) {
    return memberships
      .filter((membership) => membership.student_id === studentId && !membership.deleted_at)
      .map((membership) => courseById.get(membership.course_id)?.code)
      .filter(Boolean)
      .join(';')
  }

  function editFor(student: Profile): EditableStudent {
    return studentEdits[student.id] ?? {
      fullName: student.full_name,
      studentId: student.student_id ?? '',
      email: student.email,
      phone: student.phone ?? '',
      courseCodes: studentCourses(student.id),
      mustChangePassword: Boolean(student.must_change_password),
    }
  }

  async function saveStudent(student: Profile) {
    const edit = editFor(student)
    try {
      await updateStudentProfile({ id: student.id, studentId: edit.studentId, fullName: edit.fullName, email: edit.email, phone: edit.phone, mustChangePassword: edit.mustChangePassword })
      await setStudentCourseCodes(student.id, edit.courseCodes.split(/[;,|]/))
      setMessage(`${edit.fullName} updated.`)
      setStudentEdits((edits) => {
        const next = { ...edits }
        delete next[student.id]
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Student update failed')
    }
  }

  async function removeStudent(student: Profile) {
    if (!window.confirm(`Remove ${student.full_name} from active student lists?`)) return
    await softDeleteStudent(student.id)
    setMessage('Student removed from active lists.')
    await queryClient.invalidateQueries({ queryKey: ['app-data'] })
  }

  async function importCourses() {
    const lines = courseCsv.trim().split(/\r?\n/).filter(Boolean)
    const [, ...rows] = lines
    let saved = 0
    try {
      for (const line of rows) {
        const [code = '', title = '', term = '', active = 'true'] = line.split(',').map((cell) => cell.trim())
        if (!code || !title || !term) continue
        await upsertCourse({ code, title, term, active: !/^false|0|no$/i.test(active) })
        saved += 1
      }
      setMessage(`${saved} courses saved from file.`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Course import failed')
    }
  }

  async function saveEditedCourse(course: Course) {
    const edit = courseEdits[course.id] ?? course
    await upsertCourse({ id: course.id, code: edit.code, title: edit.title, term: edit.term, active: edit.active })
    setCourseEdits((edits) => {
      const next = { ...edits }
      delete next[course.id]
      return next
    })
    setMessage(`${edit.code} updated.`)
    await queryClient.invalidateQueries({ queryKey: ['app-data'] })
  }

  async function removeCourse(course: Course) {
    if (!window.confirm(`Archive ${course.code}? Students and old marks remain stored.`)) return
    await softDeleteCourse(course.id)
    setMessage(`${course.code} archived.`)
    await queryClient.invalidateQueries({ queryKey: ['app-data'] })
  }

  return (
    <>
      <PageHeader eyebrow="Admin data" title="Courses, students, and rosters" action={<IconButton className="primary" onClick={() => download('student-bulk-import-format.csv', studentCsvFormat)}><FileDown size={16} />Student format</IconButton>}>
        Add courses, create or update students, assign courses, and edit table values without opening Supabase.
      </PageHeader>

      {message ? <p className="notice">{message}</p> : null}
      <SectionTabs
        value={workspace}
        onChange={(value) => setWorkspace(value as typeof workspace)}
        items={[
          { value: 'pending', label: 'Pending approvals', icon: <UserRoundCheck size={16} />, count: pendingStudents.length },
          { value: 'courses', label: 'Courses', icon: <BookOpen size={16} />, count: courses.length },
          { value: 'import', label: 'Roster import', icon: <FileSpreadsheet size={16} /> },
          { value: 'directory', label: 'Student directory', icon: <Users size={16} />, count: students.length },
        ]}
      />


      {workspace === 'pending' ? <div className="workspace-panel">
        <Card>
          <div className="section-title">
            <div><p className="eyebrow">Official roster matching</p><h2>Match registrations by Student ID or email</h2></div>
            <div className="toolbar-actions">
              <IconButton onClick={() => void syncRegistrations()} disabled={approving}><UsersRound size={16} />Sync registrations</IconButton>
              <IconButton onClick={exportPending} disabled={!pendingStudents.length}><FileDown size={16} />Export pending</IconButton>
              <label className="file-picker compact-file-picker"><Upload size={16} />Upload approval roster<input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(event) => void readApprovalFile(event)} /></label>
            </div>
          </div>
          <p className="muted-copy">Export pending registrations, fill the Course Codes column, then upload the file. Exact Student ID or email matches can be approved together.</p>
          <div className="approval-summary">
            <StatusPill tone={matchedApprovalRows.length ? 'good' : 'neutral'}>{matchedApprovalRows.length} exact matches</StatusPill>
            <StatusPill tone={approvalPreview.errorCount ? 'danger' : 'neutral'}>{approvalPreview.errorCount} file errors</StatusPill>
            <IconButton className="primary" disabled={approving || !matchedApprovalRows.some((match) => match.row.courseCodes.length)} onClick={() => void approveMatched()}><CheckCircle2 size={16} />Approve matched with courses</IconButton>
          </div>
        </Card>

        <Card>
          <div className="section-title"><div><p className="eyebrow">Self registrations</p><h2>{pendingStudents.length} awaiting review</h2></div><StatusPill tone={pendingStudents.length ? 'warn' : 'good'}>{pendingStudents.length ? 'Action needed' : 'Queue clear'}</StatusPill></div>
          {pendingStudents.length ? <div className="table-scroll"><table className="editable-table">
            <thead><tr><th>Registered student</th><th>Student ID</th><th>Email / phone</th><th>Roster comparison</th><th>Assign course codes</th><th>Actions</th></tr></thead>
            <tbody>{pendingStudents.map((student) => {
              const match = approvalMatch(student)
              const idMatch = match?.studentId === student.student_id
              const emailMatch = match?.email.toLowerCase() === student.email.toLowerCase()
              return <tr key={student.id}>
                <td><strong>{student.full_name}</strong><br /><small>{student.created_at ? new Date(student.created_at).toLocaleString('en-IN') : 'Self registered'}</small></td>
                <td><strong>{student.student_id}</strong></td>
                <td>{student.email}<br /><small>{student.phone ?? 'No phone'}</small></td>
                <td><StatusPill tone={match ? 'good' : 'warn'}>{idMatch ? 'Student ID match' : emailMatch ? 'Email match' : 'Not in uploaded roster'}</StatusPill></td>
                <td><input value={approvalCourses(student)} onChange={(event) => setPendingCourseCodes({ ...pendingCourseCodes, [student.id]: event.target.value })} placeholder="CS601;CS642" /></td>
                <td><div className="row-actions"><button title="Approve and assign courses" disabled={approving} onClick={() => void approveOne(student)}><CheckCircle2 size={15} /></button><button title="Reject registration" disabled={approving} onClick={() => void rejectOne(student)}><XCircle size={15} /></button></div></td>
              </tr>
            })}</tbody>
          </table></div> : <EmptyState title="No pending registrations" body="New self-registered students will appear here automatically." icon={<UserRoundCheck size={22} />} />}
        </Card>
      </div> : null}

      {workspace === 'courses' ? <div className="admin-data-grid">
        <Card>
          <div className="section-title"><div><p className="eyebrow">Courses</p><h2>Add or update courses</h2></div><UsersRound size={20} /></div>
          <div className="form-grid">
            <label>Code<input value={courseDraft.code} onChange={(event) => setCourseDraft({ ...courseDraft, code: event.target.value })} placeholder="CS601" /></label>
            <label>Title<input value={courseDraft.title} onChange={(event) => setCourseDraft({ ...courseDraft, title: event.target.value })} placeholder="Machine Learning" /></label>
            <label>Term<input value={courseDraft.term} onChange={(event) => setCourseDraft({ ...courseDraft, term: event.target.value })} /></label>
            <label className="inline-check"><input type="checkbox" checked={courseDraft.active} onChange={(event) => setCourseDraft({ ...courseDraft, active: event.target.checked })} /> Active</label>
          </div>
          <div className="toolbar-actions"><IconButton className="primary" onClick={() => saveCourse.mutate(courseDraft)} disabled={!courseDraft.code || !courseDraft.title || !courseDraft.term}><Plus size={16} />Save course</IconButton></div>
          <div className="format-box compact"><code>Code</code><code>Title</code><code>Term</code><code>Active</code></div>
          <label className="file-picker"><Upload size={17} />Upload courses Excel/CSV<input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(event) => void readCourseFile(event)} /></label>
          <textarea value={courseCsv} onChange={(event) => setCourseCsv(event.target.value)} aria-label="Course import input" />
          <IconButton onClick={() => void importCourses()}><Upload size={16} />Import/update courses</IconButton>
        </Card>

        <Card>
          <div className="section-title"><div><p className="eyebrow">Course sheet</p><h2>{courses.length} courses</h2></div><IconButton onClick={() => download('course-import-format.csv', courseCsvFormat)}><FileDown size={16} />Format</IconButton></div>
          <div className="table-scroll">
            <table className="editable-table">
              <thead><tr><th>Code</th><th>Title</th><th>Term</th><th>Active</th><th>Actions</th></tr></thead>
              <tbody>{courses.map((course) => {
                const edit = courseEdits[course.id] ?? course
                return <tr key={course.id}>
                  <td><input value={edit.code} onChange={(event) => setCourseEdits({ ...courseEdits, [course.id]: { ...edit, code: event.target.value } })} /></td>
                  <td><input value={edit.title} onChange={(event) => setCourseEdits({ ...courseEdits, [course.id]: { ...edit, title: event.target.value } })} /></td>
                  <td><input value={edit.term} onChange={(event) => setCourseEdits({ ...courseEdits, [course.id]: { ...edit, term: event.target.value } })} /></td>
                  <td><input className="checkbox-input" type="checkbox" checked={edit.active} onChange={(event) => setCourseEdits({ ...courseEdits, [course.id]: { ...edit, active: event.target.checked } })} /></td>
                  <td><div className="row-actions"><button title="Save" onClick={() => void saveEditedCourse(course)}><Save size={15} /></button><button title="Archive" onClick={() => void removeCourse(course)}><Trash2 size={15} /></button></div></td>
                </tr>
              })}</tbody>
            </table>
          </div>
        </Card>
      </div> : null}

      {workspace === 'import' ? <div className="two-column import-layout">
        <Card>
          <div className="section-title"><div><p className="eyebrow">Roster upload</p><h2>Create new and update existing</h2></div><Upload size={20} /></div>
          <div className="format-box"><code>Student ID</code><code>Full Name</code><code>Email</code><code>Phone</code><code>Course Codes</code><code>Temporary Password</code></div>
          <p className="muted-copy">Upload `.xlsx`, `.xls`, or `.csv`. Existing students are updated in place. New students are created with the temporary password and must change it at first login.</p>
          <p className="import-guidance"><strong>Preview only:</strong> Editing the CSV below does not save anything until you press the create/update button.</p>
          <label className="file-picker"><Upload size={17} />Upload students Excel/CSV<input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(event) => void readStudentFile(event)} /></label>
          <textarea value={studentCsv} onChange={(event) => setStudentCsv(event.target.value)} aria-label="Student import input" />
          <div className="import-actions">
            <StatusPill tone={preview.errorCount ? 'danger' : 'neutral'}>Preview: {newRows.length} new / {existingRows.length} updates / {preview.errorCount} errors</StatusPill>
            <IconButton className="primary" disabled={preview.errorCount > 0 || !validRows.length || importRoster.isPending} onClick={() => importRoster.mutate()}><Upload size={16} />{importRoster.isPending ? 'Saving students...' : `Create/update ${validRows.length} student${validRows.length === 1 ? '' : 's'}`}</IconButton>
          </div>
        </Card>

        <Card>
          <div className="section-title"><div><p className="eyebrow">Preview</p><h2>Rows from file</h2></div><StatusPill tone="neutral">{preview.importId.slice(0, 8)}</StatusPill></div>
          <div className="table-scroll"><table><thead><tr><th>Row</th><th>Student</th><th>Email</th><th>Courses</th><th>Mode</th><th>Status</th></tr></thead><tbody>{preview.rows.map((row: StudentImportPreviewRow) => {
            const exists = students.some((student) => student.student_id === row.studentId || student.email.toLowerCase() === row.email.toLowerCase())
            return <tr key={row.rowNumber} className={row.status === 'error' ? 'error-row' : undefined}><td>{row.rowNumber}</td><td><b>{row.studentId}</b><br /><small>{row.fullName}</small></td><td>{row.email}</td><td>{row.courseCodes.join(', ') || '-'}</td><td>{exists ? 'update' : 'create'}</td><td><StatusPill tone={row.status === 'valid' ? 'good' : 'danger'}>{row.messages.join(', ') || 'ready'}</StatusPill></td></tr>
          })}</tbody></table></div>
        </Card>
      </div> : null}

      {workspace === 'directory' ? <Card className="import-preview-card">
        <div className="table-toolbar">
          <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, student ID, or email" /></label>
          <StatusPill tone="neutral">{filteredStudents.length} students</StatusPill>
        </div>
        <div className="table-scroll">
          <table className="editable-table">
            <thead><tr><th>Name</th><th>Student ID</th><th>Email</th><th>Phone</th><th>Courses</th><th>Force password change</th><th>Face</th><th>Actions</th></tr></thead>
            <tbody>{filteredStudents.map((student) => {
              const edit = editFor(student)
              const enrollment = data?.enrollments.find((item) => item.student_id === student.id)
              return <tr key={student.id}>
                <td><input value={edit.fullName} onChange={(event) => setStudentEdits({ ...studentEdits, [student.id]: { ...edit, fullName: event.target.value } })} /></td>
                <td><input value={edit.studentId} onChange={(event) => setStudentEdits({ ...studentEdits, [student.id]: { ...edit, studentId: event.target.value } })} /></td>
                <td><input value={edit.email} onChange={(event) => setStudentEdits({ ...studentEdits, [student.id]: { ...edit, email: event.target.value } })} /></td>
                <td><input value={edit.phone} onChange={(event) => setStudentEdits({ ...studentEdits, [student.id]: { ...edit, phone: event.target.value } })} /></td>
                <td><input value={edit.courseCodes} onChange={(event) => setStudentEdits({ ...studentEdits, [student.id]: { ...edit, courseCodes: event.target.value } })} placeholder="CS601;CS642" /></td>
                <td><input className="checkbox-input" type="checkbox" checked={edit.mustChangePassword} onChange={(event) => setStudentEdits({ ...studentEdits, [student.id]: { ...edit, mustChangePassword: event.target.checked } })} /></td>
                <td><StatusPill tone={enrollment?.state === 'ready' ? 'good' : 'warn'}>{enrollment?.state ?? 'not started'}</StatusPill></td>
                <td><div className="row-actions"><button title="Save" onClick={() => void saveStudent(student)}><Save size={15} /></button><button title="Remove" onClick={() => void removeStudent(student)}><Trash2 size={15} /></button></div></td>
              </tr>
            })}</tbody>
          </table>
        </div>
        {!filteredStudents.length ? <EmptyState title="No students found" body={query ? 'Try a different name, ID, or email.' : 'Import a roster to create the first student accounts.'} icon={<Users size={22} />} /> : null}
      </Card> : null}
    </>
  )
}
