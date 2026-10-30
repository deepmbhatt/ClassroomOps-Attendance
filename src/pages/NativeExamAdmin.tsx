import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { Card, IconButton, PageHeader, Spinner } from '../components/Layout'
import { ExamReviewManager } from '../components/ExamReviewManager'
import { loadAppData } from '../lib/api'
import { readTabularFile } from '../lib/importValidation'
import { importExamQuestions } from '../lib/examQuestionImport'
import { pastQuestionHeadings } from '../lib/pastQuestionHeadings'
import { serviceErrorMessage } from '../lib/serviceError'
import { deleteNativeExam, getNativeFaceCode, loadNativeExamReviewAdmin, loadNativeExams, saveNativeExam, saveNativeQuestions, setNativeAccess, type NativeExam, type NativeQuestion } from '../lib/nativeExams'

type QuestionEdit = { id?: string; prompt: string; question_type: NativeQuestion['question_type']; options: string[] }
type ExamEdit = Omit<NativeExam, 'id' | 'instructions'> & { instructions: string }

const emptyExam: ExamEdit = { title: '', course_id: '', instructions: '', starts_at: '', ends_at: '', duration_minutes: 60, warning_limit: 1, attendance_session_id: null, allow_without_attendance: false, code_mode: 'none', exit_transform: 'reverse', exit_operand: 0, status: 'draft', review_only: false, held_on: null }
const emptyQuestion = (): QuestionEdit => ({ prompt: '', question_type: 'descriptive', options: [] })

function localDate(iso?: string) {
  if (!iso) return ''
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function csvCell(value: unknown) {
  const raw = String(value ?? '')
  const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

export function NativeExamAdmin() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const { data: app, isLoading: appLoading } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData, refetchInterval: 15_000 })
  const { data, isLoading, error } = useQuery({ queryKey: ['native-exams', auth.session?.user.id, auth.role], queryFn: loadNativeExams, refetchInterval: 10_000 })
  const [selectedId, setSelectedId] = useState('new')
  const [edit, setEdit] = useState(emptyExam)
  const [questions, setQuestions] = useState<QuestionEdit[]>([emptyQuestion()])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [studentSearch, setStudentSearch] = useState('')
  const [shownCodes, setShownCodes] = useState<Record<string, string>>({})
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const hydratedExamId = useRef('')

  const selected = data?.exams.find((exam) => exam.id === selectedId)
  const savedQuestions = (data?.questions ?? []).filter((question) => question.exam_id === selectedId)
  const access = (data?.access ?? []).filter((row) => row.exam_id === selectedId)
  const attempts = (data?.attempts ?? []).filter((row) => row.exam_id === selectedId)
  const { data: reviewData } = useQuery({ queryKey: ['native-exam-review-admin', selectedId], queryFn: () => loadNativeExamReviewAdmin(selectedId), enabled: Boolean(selected && auth.role === 'admin') })
  const questionsLocked = attempts.length > 0 || Boolean(reviewData?.rows.length)
  const faceApprovedIds = new Set((app?.attendance ?? []).filter((record) => record.lecture_id === edit.attendance_session_id && record.source === 'face' && (record.status === 'present' || record.status === 'late')).map((record) => record.student_id))
  const availableSessions = (app?.lectures ?? []).filter((lecture) => lecture.course_id === edit.course_id).sort((a, b) => b.started_at.localeCompare(a.started_at))
  const eligibleStudents = (app?.profiles ?? []).filter((profile) =>
    profile.role === 'student' && profile.approval_status === 'approved' && !profile.deleted_at &&
    app?.courseMemberships.some((membership) => membership.course_id === edit.course_id && membership.student_id === profile.id),
  )
  const visibleStudents = eligibleStudents.filter((profile) =>
    `${profile.full_name} ${profile.student_id ?? ''} ${profile.email}`.toLowerCase().includes(studentSearch.toLowerCase()),
  )
  const supportStatus = (studentId: string) => {
    const attempt = attempts.find((item) => item.student_id === studentId)
    if (attempt?.status === 'submitted' || attempt?.status === 'auto_submitted') return 'Submitted'
    if (attempt?.status === 'in_progress') return Date.now() - new Date(attempt.last_seen_at).getTime() > 60_000 ? 'Connection uncertain' : 'In progress'
    const allowed = selected?.allow_without_attendance || (selected?.attendance_session_id ? faceApprovedIds.has(studentId) : access.some((item) => item.student_id === studentId))
    return allowed ? 'Eligible' : 'Blocked by attendance'
  }
  const supportCounts = eligibleStudents.reduce((counts, student) => {
    const status = supportStatus(student.id)
    counts[status] = (counts[status] ?? 0) + 1
    return counts
  }, {} as Record<string, number>)

  useEffect(() => {
    if (!selected || hydratedExamId.current === selected.id) return
    hydratedExamId.current = selected.id
    setEdit({
      title: selected.title, course_id: selected.course_id, instructions: selected.instructions ?? '',
      starts_at: localDate(selected.starts_at), ends_at: localDate(selected.ends_at),
      duration_minutes: selected.duration_minutes, warning_limit: selected.warning_limit,
      attendance_session_id: selected.attendance_session_id, allow_without_attendance: selected.allow_without_attendance ?? false, code_mode: selected.code_mode ?? 'none',
      exit_transform: selected.exit_transform ?? 'reverse', exit_operand: selected.exit_operand ?? 0, status: selected.status,
      review_only: selected.review_only ?? false, held_on: selected.held_on ?? null,
    })
    setQuestions((data?.questions ?? []).filter((question) => question.exam_id === selected.id)
      .map((question) => ({ id: question.id, prompt: question.prompt, question_type: question.question_type, options: question.options })))
  }, [selectedId, data, selected])

  function choose(event: ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value
    setSelectedId(id)
    hydratedExamId.current = ''
    setMessage('')
    setShownCodes({})
    setDeleteConfirm('')
    if (id === 'new') {
      setEdit({ ...emptyExam, course_id: app?.courses[0]?.id ?? '' })
      setQuestions([emptyQuestion()])
    }
  }

  async function save() {
    const cleanQuestions = questions.map((question) => ({
      ...question, prompt: question.prompt.trim(),
      question_type: edit.review_only ? 'descriptive' as const : question.question_type,
      options: !edit.review_only && question.question_type === 'mcq' ? question.options.map((option) => option.trim()) : [],
    }))
    if (!edit.title.trim() || !edit.course_id || !cleanQuestions.length || (edit.review_only ? !edit.held_on : !edit.allow_without_attendance && !edit.attendance_session_id || !edit.starts_at || !edit.ends_at)) {
      setMessage(edit.review_only ? 'Title, course, past exam date, and at least one question are required.' : 'Title, course, opening and closing times, and at least one question are required. Choose an attendance session unless attendance is optional.')
      return
    }
    if (cleanQuestions.some((question) => !question.prompt || (question.question_type === 'mcq' &&
      (question.options.length < 2 || question.options.length > 8 || question.options.some((option) => !option))))) {
      setMessage('Each question needs text. MCQs need 2 to 8 non-empty options.')
      return
    }
    if (!edit.review_only && (!Number.isInteger(edit.warning_limit) || edit.warning_limit < 1 || edit.warning_limit > 10)) {
      setMessage('Choose a warning limit between 1 and 10.')
      return
    }
    const questionsChanged = cleanQuestions.length !== savedQuestions.length || cleanQuestions.some((question, index) =>
      question.id !== savedQuestions[index]?.id || question.prompt !== savedQuestions[index]?.prompt ||
      question.question_type !== savedQuestions[index]?.question_type ||
      JSON.stringify(question.options) !== JSON.stringify(savedQuestions[index]?.options),
    )
    if (questionsLocked && questionsChanged) {
      setMessage('Questions are locked after the first attempt or answer-review import.')
      return
    }
    if (selected && selected.review_only !== edit.review_only) {
      setMessage('Exam purpose cannot change after creation. Create a new exam instead.')
      return
    }
    setBusy(true)
    try {
      const heldStart = edit.review_only ? new Date(`${edit.held_on}T12:00:00`) : null
      const startsAt = heldStart ?? new Date(edit.starts_at)
      const endsAt = heldStart ? new Date(heldStart.getTime() + 60 * 60 * 1000) : new Date(edit.ends_at)
      const id = await saveNativeExam({
        ...(selected ? { id: selected.id } : {}),
        title: edit.title.trim(), course_id: edit.course_id, instructions: edit.instructions.trim(),
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        duration_minutes: edit.review_only ? 60 : Number(edit.duration_minutes), warning_limit: edit.review_only ? 1 : edit.warning_limit,
        attendance_session_id: edit.review_only ? null : edit.attendance_session_id, allow_without_attendance: !edit.review_only && edit.allow_without_attendance, code_mode: edit.review_only || edit.allow_without_attendance ? 'none' : edit.code_mode,
        exit_transform: edit.review_only ? 'reverse' : edit.exit_transform, exit_operand: edit.review_only ? 0 : edit.exit_operand,
        status: edit.review_only ? 'closed' : edit.status,
        review_only: edit.review_only, held_on: edit.review_only ? edit.held_on : null,
      })
      if (questionsChanged) await saveNativeQuestions(id, cleanQuestions, savedQuestions)
      setSelectedId(id)
      setMessage(edit.review_only ? 'Past exam saved. Upload its answers and marks below, then schedule the review.' : 'Exam and questions saved.')
      await queryClient.invalidateQueries({ queryKey: ['native-exams'] })
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : 'Could not save exam.')
    } finally { setBusy(false) }
  }

  async function removeExam() {
    if (!selected || deleteConfirm !== selected.title) return
    if (!window.confirm(`Permanently delete "${selected.title}" and all its questions, attempts, answers, marks, and review access? This cannot be undone.`)) return
    setBusy(true)
    try {
      await deleteNativeExam(selected.id, deleteConfirm)
      setSelectedId('new')
      setEdit({ ...emptyExam, course_id: app?.courses[0]?.id ?? '' })
      setQuestions([emptyQuestion()])
      setDeleteConfirm('')
      setMessage('Exam and its related records were permanently deleted.')
      await queryClient.invalidateQueries({ queryKey: ['native-exams'] })
    } catch (nextError) { setMessage(nextError instanceof Error ? nextError.message : 'Could not delete exam.') }
    finally { setBusy(false) }
  }

  async function loadQuestionHeadings(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const csv = await readTabularFile(file)
      const imported = edit.review_only
        ? pastQuestionHeadings(csv).map((prompt) => ({ prompt, question_type: 'descriptive' as const, options: [] }))
        : importExamQuestions(csv)
      setQuestions(imported)
      setMessage(`${imported.length} questions loaded. Check their text and types, then save the exam.`)
    } catch (nextError) { setMessage(nextError instanceof Error ? nextError.message : 'Could not load question headings.') }
    finally { event.target.value = '' }
  }

  async function approve(studentId: string, enabled: boolean) {
    if (!selected) return
    setBusy(true)
    try {
      await setNativeAccess(selected.id, studentId, enabled)
      await queryClient.invalidateQueries({ queryKey: ['native-exams'] })
      setMessage(enabled ? 'Student approved for this exam.' : 'Exam access removed.')
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : 'Could not change access.')
    } finally { setBusy(false) }
  }

  async function exportCsv() {
    if (!selected) return
    setBusy(true)
    try {
      const fresh = await loadNativeExams()
      const ordered = fresh.questions.filter((question) => question.exam_id === selected.id).sort((a, b) => a.position - b.position)
      const freshAccess = fresh.access.filter((row) => row.exam_id === selected.id)
      const freshAttempts = fresh.attempts.filter((row) => row.exam_id === selected.id)
      const header = ['Student ID', 'Name', 'Email', 'Attempt status', 'Warnings', 'Started at', 'Submitted at', 'Submission reason', 'Exit code verified', ...ordered.map((question) => `Q${question.position} (${question.question_type === 'mcq' ? 'MCQ' : 'descriptive'}): ${question.prompt}`)]
      const faceIds = (app?.attendance ?? []).filter((record) => record.lecture_id === selected.attendance_session_id && record.source === 'face' && (record.status === 'present' || record.status === 'late')).map((record) => record.student_id)
      const studentIds = [...new Set([...(selected.attendance_session_id ? faceIds : freshAccess.map((row) => row.student_id)), ...freshAttempts.map((row) => row.student_id)])]
      const rows = studentIds.map((studentId) => {
        const student = app?.profiles.find((profile) => profile.id === studentId)
        const attempt = freshAttempts.find((item) => item.student_id === studentId)
        const awaitingSync = attempt?.status === 'in_progress' && Date.now() >= new Date(attempt.deadline_at).getTime()
        const status = awaitingSync ? 'pending_sync' : attempt?.status ?? 'not_started'
        return [student?.student_id, student?.full_name, student?.email, status, attempt?.warning_count ?? 0, attempt?.started_at, attempt?.submitted_at,
          awaitingSync ? 'awaiting_offline_upload' : attempt?.submission_reason, attempt?.exit_code_verified ? 'yes' : 'no',
          ...ordered.map((question) => {
            const answer = attempt?.answers?.[question.id] ?? ''
            return question.question_type === 'mcq' && answer !== '' ? question.options[Number(answer)] ?? '' : answer
          })]
      })
      const csv = '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${selected.title.replace(/[^a-z0-9-_]+/gi, '-')}-responses.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : 'Could not export responses.')
    } finally { setBusy(false) }
  }

  if (isLoading || appLoading) return <Spinner />
  if (error) return <p className="form-error">{serviceErrorMessage(error, 'Exam administration')}</p>

  return <>
    <PageHeader eyebrow="Assessment workspace" title="Exams and answer reviews">Create an in-app exam or publish answers and marks from a past exam held elsewhere.</PageHeader>
    {message ? <p className="notice">{message}</p> : null}
    <Card>
      <label>Exam<select value={selectedId} onChange={choose}><option value="new">Create a new exam</option>{data?.exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.review_only ? 'Past review' : 'In-app'} · {exam.title}</option>)}</select></label>
      <div className="form-grid">
        <label>Purpose<select value={edit.review_only ? 'review' : 'in_app'} disabled={Boolean(selected)} onChange={(event) => setEdit({ ...edit, review_only: event.target.value === 'review', status: event.target.value === 'review' ? 'closed' : 'draft' })}><option value="in_app">Students take this exam in the app</option><option value="review">Publish a past exam's answers and marks</option></select></label>
        <label>Title<input value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} /></label>
        <label>Course<select value={edit.course_id} disabled={questionsLocked} onChange={(event) => setEdit({ ...edit, course_id: event.target.value, attendance_session_id: null })}><option value="">Select course</option>{app?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></label>
        {edit.review_only ? <label>Past exam date<input type="date" value={edit.held_on ?? ''} onChange={(event) => setEdit({ ...edit, held_on: event.target.value || null })} /></label> : <>
        <label>Face-attendance session<select value={edit.attendance_session_id ?? ''} disabled={attempts.length > 0 || edit.allow_without_attendance} onChange={(event) => setEdit({ ...edit, attendance_session_id: event.target.value || null })}><option value="">Select session</option>{availableSessions.map((lecture) => <option key={lecture.id} value={lecture.id}>{lecture.title} · {new Date(lecture.started_at).toLocaleString('en-IN')}</option>)}</select></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}><input type="checkbox" style={{ width: 'auto' }} checked={edit.allow_without_attendance} disabled={attempts.length > 0} onChange={(event) => setEdit({ ...edit, allow_without_attendance: event.target.checked, code_mode: event.target.checked ? 'none' : edit.code_mode })} />Allow enrolled students to take this exam regardless of attendance</label>
        <label>Opens<input type="datetime-local" value={edit.starts_at} onChange={(event) => setEdit({ ...edit, starts_at: event.target.value })} /></label>
        <label>Closes<input type="datetime-local" value={edit.ends_at} onChange={(event) => setEdit({ ...edit, ends_at: event.target.value })} /></label>
        <label>Duration (minutes)<input type="number" min="1" max="360" value={edit.duration_minutes} onChange={(event) => setEdit({ ...edit, duration_minutes: Number(event.target.value) })} /></label>
        <label>Auto-submit after warnings<input type="number" min="1" max="10" disabled={attempts.length > 0} value={edit.warning_limit} onChange={(event) => setEdit({ ...edit, warning_limit: Number(event.target.value) })} /></label>
        <label>Attendance code check<select value={edit.code_mode} disabled={attempts.length > 0 || edit.allow_without_attendance} onChange={(event) => setEdit({ ...edit, code_mode: event.target.value as NativeExam['code_mode'] })}><option value="none">No entry code</option><option value="entry">4-digit entry code</option><option value="entry_exit">Entry and transformed exit code</option></select></label>
        {edit.code_mode === 'entry_exit' ? <><label>Exit code rule<select value={edit.exit_transform} onChange={(event) => setEdit({ ...edit, exit_transform: event.target.value as NativeExam['exit_transform'] })}><option value="reverse">Reverse the four digits</option><option value="add">Add a number, modulo 10000</option><option value="subtract">Subtract a number, modulo 10000</option></select></label>{edit.exit_transform !== 'reverse' ? <label>Number to add/subtract<input type="number" min="0" max="9999" value={edit.exit_operand} onChange={(event) => setEdit({ ...edit, exit_operand: Number(event.target.value) })} /></label> : null}</> : null}
        <label>Status<select value={edit.status} onChange={(event) => setEdit({ ...edit, status: event.target.value as NativeExam['status'] })}><option value="draft">Draft</option><option value="open">Open or scheduled (uses opening time)</option><option value="closed">Closed</option></select></label>
        </>}
      </div>
      {!edit.review_only ? <label>Instructions<textarea value={edit.instructions} onChange={(event) => setEdit({ ...edit, instructions: event.target.value })} /></label> : <p className="muted-copy">Past exams are review-only. Students will not see them in the exam-taking screen.</p>}
      <h2>Questions ({questions.length})</h2>
      <p className="muted-copy">{edit.review_only ? 'Enter the question text in the same order as your Q1, Q2, etc. CSV columns. Save before uploading answers and marks.' : 'Add each question, choose its type, then save the exam. An MCQ records one selected option.'}</p>
      {!questionsLocked ? <label className="past-question-upload">Load questions from CSV/Excel<input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(event) => void loadQuestionHeadings(event)} /><small>{edit.review_only ? 'Use Enrollment Number and one column per question.' : 'Use Question, Type, Option 1, Option 2, etc. with one question per row, or an Enrollment Number sheet with question headings. Types can be edited below.'}</small></label> : null}
      {questions.map((question, index) => <div className="native-question-edit" key={question.id ?? `new-${index}`}>
        <div className="native-question-fields">
          <label>Question {index + 1}<textarea value={question.prompt} disabled={questionsLocked} onChange={(event) => setQuestions(questions.map((item, position) => position === index ? { ...item, prompt: event.target.value } : item))} /></label>
          {!edit.review_only ? <label>Type<select value={question.question_type} disabled={questionsLocked} onChange={(event) => setQuestions(questions.map((item, position) => position === index ? { ...item, question_type: event.target.value as QuestionEdit['question_type'], options: event.target.value === 'mcq' ? (item.options.length ? item.options : ['', '', '', '']) : [] } : item))}><option value="descriptive">Descriptive</option><option value="mcq">MCQ — one choice</option></select></label> : null}
          {!edit.review_only && question.question_type === 'mcq' ? <div className="native-mcq-options">{question.options.map((option, optionIndex) => <label key={optionIndex}>Option {optionIndex + 1}<input value={option} disabled={questionsLocked} onChange={(event) => setQuestions(questions.map((item, position) => position === index ? { ...item, options: item.options.map((value, valueIndex) => valueIndex === optionIndex ? event.target.value : value) } : item))} /><button type="button" disabled={question.options.length <= 2 || questionsLocked} onClick={() => setQuestions(questions.map((item, position) => position === index ? { ...item, options: item.options.filter((_, valueIndex) => valueIndex !== optionIndex) } : item))}>Remove option</button></label>)}<button type="button" disabled={question.options.length >= 8 || questionsLocked} onClick={() => setQuestions(questions.map((item, position) => position === index ? { ...item, options: [...item.options, ''] } : item))}>Add option</button></div> : null}
        </div>
        <button type="button" onClick={() => setQuestions(questions.filter((_, position) => position !== index))} disabled={questions.length === 1 || questionsLocked}>Remove</button>
      </div>)}
      <div className="sheet-actions"><IconButton onClick={() => setQuestions([...questions, emptyQuestion()])} disabled={questionsLocked}>Add next question</IconButton><IconButton className="primary" onClick={() => void save()} disabled={busy}>Save exam and questions</IconButton></div>
      {questionsLocked ? <p className="muted-copy">Questions are locked because a student started or an answer review was imported.</p> : null}
    </Card>
    {selected && !selected.review_only ? <Card>
      <div className="section-title"><div><p className="eyebrow">Access and responses</p><h2>Exam eligibility</h2></div><IconButton onClick={() => void exportCsv()} disabled={busy}>Download combined CSV</IconButton></div>
      <div className="exam-support-summary" aria-label="Live exam support dashboard">{['Eligible', 'In progress', 'Connection uncertain', 'Submitted', 'Blocked by attendance'].map((status) => <div key={status}><strong>{supportCounts[status] ?? 0}</strong><span>{status}</span></div>)}</div>
      <p className="muted-copy">Updates every 10–15 seconds. “Connection uncertain” means the server has not seen the attempt for over a minute; it does not prove the student lost internet.</p>
      <p className="muted-copy">{selected.allow_without_attendance ? 'All approved students enrolled in this course can start during the exam window, regardless of attendance.' : 'Face-verified present or late attendance in the selected session grants access automatically. A four-digit code appears at the attendance terminal when code checks are enabled.'} Each student gets one attempt.</p>
      <label>Find student<input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Name or student ID" /></label>
      <div className="table-scroll"><table><thead><tr><th>Student</th><th>Access</th><th>Live status</th><th>Last seen</th><th>Action</th></tr></thead><tbody>{visibleStudents.map((student) => {
        const granted = selected.allow_without_attendance || (selected.attendance_session_id ? faceApprovedIds.has(student.id) : access.some((item) => item.student_id === student.id))
        const attempt = attempts.find((item) => item.student_id === student.id)
        return <tr key={student.id}><td>{student.full_name}<small>{student.student_id}</small></td><td>{selected.allow_without_attendance ? 'Enrolled' : granted ? 'Face verified' : 'Waiting for face attendance'}</td><td><span className="status-pill neutral">{supportStatus(student.id)}</span></td><td>{attempt ? new Date(attempt.last_seen_at).toLocaleTimeString('en-IN') : '—'}</td><td>{selected.allow_without_attendance ? '—' : selected.attendance_session_id ? granted && selected.code_mode !== 'none' ? <button onClick={() => void getNativeFaceCode(selected.attendance_session_id!, student.id).then((code) => setShownCodes((current) => ({ ...current, [student.id]: code ?? 'Not issued' }))).catch((nextError) => setMessage(nextError instanceof Error ? nextError.message : 'Could not load code'))}>{shownCodes[student.id] ?? 'Show code'}</button> : '—' : <button disabled={busy} onClick={() => void approve(student.id, !granted)}>{granted ? 'Remove access' : 'Approve'}</button>}</td></tr>
      })}</tbody></table></div>
    </Card> : null}
    {selected && auth.role === 'admin' ? <ExamReviewManager key={selected.id} examId={selected.id} examTitle={selected.title} questions={savedQuestions} students={eligibleStudents} /> : null}
    {selected && auth.role === 'admin' ? <Card className="exam-delete-card"><details><summary>Delete this exam</summary><p className="muted-copy">This permanently removes the exam, its questions, attempts, submitted answers, imported marks, and review access. It cannot be undone. Live attempts cannot be deleted.</p><label>Type the exact exam title to confirm<input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder={selected.title} /></label><IconButton className="danger" disabled={busy || deleteConfirm !== selected.title} onClick={() => void removeExam()}>Permanently delete exam</IconButton></details></Card> : null}
  </>
}
