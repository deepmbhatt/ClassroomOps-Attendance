import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChangeEvent, useEffect, useState } from 'react'
import { Card, IconButton, PageHeader, Spinner } from '../components/Layout'
import { loadAppData } from '../lib/api'
import { loadNativeExams, saveNativeExam, saveNativeQuestions, setNativeAccess, type NativeExam, type NativeQuestion } from '../lib/nativeExams'

type QuestionEdit = { id?: string; prompt: string; question_type: NativeQuestion['question_type']; options: string[] }
type ExamEdit = Omit<NativeExam, 'id' | 'instructions'> & { instructions: string }

const emptyExam: ExamEdit = { title: '', course_id: '', instructions: '', starts_at: '', ends_at: '', duration_minutes: 60, warning_limit: 1, status: 'draft' }
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
  const queryClient = useQueryClient()
  const { data: app, isLoading: appLoading } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const { data, isLoading, error } = useQuery({ queryKey: ['native-exams'], queryFn: loadNativeExams })
  const [selectedId, setSelectedId] = useState('new')
  const [edit, setEdit] = useState(emptyExam)
  const [questions, setQuestions] = useState<QuestionEdit[]>([emptyQuestion()])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [studentSearch, setStudentSearch] = useState('')

  const selected = data?.exams.find((exam) => exam.id === selectedId)
  const savedQuestions = (data?.questions ?? []).filter((question) => question.exam_id === selectedId)
  const access = (data?.access ?? []).filter((row) => row.exam_id === selectedId)
  const attempts = (data?.attempts ?? []).filter((row) => row.exam_id === selectedId)
  const eligibleStudents = (app?.profiles ?? []).filter((profile) =>
    profile.role === 'student' && profile.approval_status === 'approved' && !profile.deleted_at &&
    app?.courseMemberships.some((membership) => membership.course_id === edit.course_id && membership.student_id === profile.id),
  )
  const visibleStudents = eligibleStudents.filter((profile) =>
    `${profile.full_name} ${profile.student_id ?? ''} ${profile.email}`.toLowerCase().includes(studentSearch.toLowerCase()),
  )

  useEffect(() => {
    if (!selected) return
    setEdit({
      title: selected.title, course_id: selected.course_id, instructions: selected.instructions ?? '',
      starts_at: localDate(selected.starts_at), ends_at: localDate(selected.ends_at),
      duration_minutes: selected.duration_minutes, warning_limit: selected.warning_limit, status: selected.status,
    })
    setQuestions((data?.questions ?? []).filter((question) => question.exam_id === selected.id)
      .map((question) => ({ id: question.id, prompt: question.prompt, question_type: question.question_type, options: question.options })))
  }, [selectedId, data, selected])

  function choose(event: ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value
    setSelectedId(id)
    setMessage('')
    if (id === 'new') {
      setEdit({ ...emptyExam, course_id: app?.courses[0]?.id ?? '' })
      setQuestions([emptyQuestion()])
    }
  }

  async function save() {
    const cleanQuestions = questions.map((question) => ({
      ...question, prompt: question.prompt.trim(),
      options: question.question_type === 'mcq' ? question.options.map((option) => option.trim()) : [],
    }))
    if (!edit.title.trim() || !edit.course_id || !edit.starts_at || !edit.ends_at || !cleanQuestions.length) {
      setMessage('Title, course, opening and closing times, and at least one question are required.')
      return
    }
    if (cleanQuestions.some((question) => !question.prompt || (question.question_type === 'mcq' &&
      (question.options.length < 2 || question.options.length > 8 || question.options.some((option) => !option))))) {
      setMessage('Each question needs text. MCQs need 2 to 8 non-empty options.')
      return
    }
    if (!Number.isInteger(edit.warning_limit) || edit.warning_limit < 1 || edit.warning_limit > 10) {
      setMessage('Choose a warning limit between 1 and 10.')
      return
    }
    const questionsChanged = cleanQuestions.length !== savedQuestions.length || cleanQuestions.some((question, index) =>
      question.id !== savedQuestions[index]?.id || question.prompt !== savedQuestions[index]?.prompt ||
      question.question_type !== savedQuestions[index]?.question_type ||
      JSON.stringify(question.options) !== JSON.stringify(savedQuestions[index]?.options),
    )
    if (attempts.length && questionsChanged) {
      setMessage('Questions are locked after the first student starts. Exam settings can still be edited.')
      return
    }
    setBusy(true)
    try {
      const id = await saveNativeExam({
        ...(selected ? { id: selected.id } : {}),
        title: edit.title.trim(), course_id: edit.course_id, instructions: edit.instructions.trim(),
        starts_at: new Date(edit.starts_at).toISOString(), ends_at: new Date(edit.ends_at).toISOString(),
        duration_minutes: Number(edit.duration_minutes), warning_limit: edit.warning_limit, status: edit.status,
      })
      if (questionsChanged) await saveNativeQuestions(id, cleanQuestions, savedQuestions)
      setSelectedId(id)
      setMessage('Exam and questions saved.')
      await queryClient.invalidateQueries({ queryKey: ['native-exams'] })
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : 'Could not save exam.')
    } finally { setBusy(false) }
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
      const header = ['Student ID', 'Name', 'Email', 'Attempt status', 'Warnings', 'Started at', 'Submitted at', 'Submission reason', ...ordered.map((question) => `Q${question.position} (${question.question_type === 'mcq' ? 'MCQ' : 'descriptive'}): ${question.prompt}`)]
      const studentIds = [...new Set([...freshAccess.map((row) => row.student_id), ...freshAttempts.map((row) => row.student_id)])]
      const rows = studentIds.map((studentId) => {
        const student = app?.profiles.find((profile) => profile.id === studentId)
        const attempt = freshAttempts.find((item) => item.student_id === studentId)
        const timedOut = attempt?.status === 'in_progress' && Date.now() >= new Date(attempt.deadline_at).getTime()
        const left = attempt?.status === 'in_progress' && Date.now() - new Date(attempt.last_seen_at).getTime() > 45_000
        const status = timedOut || left ? 'auto_submitted' : attempt?.status ?? 'not_started'
        const submittedAt = attempt?.submitted_at ?? (timedOut ? attempt?.deadline_at : left ? new Date(new Date(attempt.last_seen_at).getTime() + 45_000).toISOString() : '')
        return [student?.student_id, student?.full_name, student?.email, status, attempt?.warning_count ?? 0, attempt?.started_at, submittedAt,
          timedOut ? 'time_expired' : left ? 'browser_left' : attempt?.submission_reason,
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
  if (error) return <p className="form-error">{error instanceof Error ? error.message : 'Could not load descriptive exams.'} Apply the new Supabase migration first.</p>

  return <>
    <PageHeader eyebrow="In-app assessment" title="In-app exams">Add descriptive and MCQ questions, approve students, and download all answers as one CSV.</PageHeader>
    {message ? <p className="notice">{message}</p> : null}
    <Card>
      <label>Exam<select value={selectedId} onChange={choose}><option value="new">New exam</option>{data?.exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></label>
      <div className="form-grid">
        <label>Title<input value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} /></label>
        <label>Course<select value={edit.course_id} disabled={attempts.length > 0} onChange={(event) => setEdit({ ...edit, course_id: event.target.value })}><option value="">Select course</option>{app?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></label>
        <label>Opens<input type="datetime-local" value={edit.starts_at} onChange={(event) => setEdit({ ...edit, starts_at: event.target.value })} /></label>
        <label>Closes<input type="datetime-local" value={edit.ends_at} onChange={(event) => setEdit({ ...edit, ends_at: event.target.value })} /></label>
        <label>Duration (minutes)<input type="number" min="1" max="360" value={edit.duration_minutes} onChange={(event) => setEdit({ ...edit, duration_minutes: Number(event.target.value) })} /></label>
        <label>Auto-submit after warnings<input type="number" min="1" max="10" disabled={attempts.length > 0} value={edit.warning_limit} onChange={(event) => setEdit({ ...edit, warning_limit: Number(event.target.value) })} /></label>
        <label>Status<select value={edit.status} onChange={(event) => setEdit({ ...edit, status: event.target.value as NativeExam['status'] })}><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
      </div>
      <label>Instructions<textarea value={edit.instructions} onChange={(event) => setEdit({ ...edit, instructions: event.target.value })} /></label>
      <h2>Questions ({questions.length})</h2>
      <p className="muted-copy">Add each question, choose its type, then save the exam. An MCQ records one selected option; no answer key is needed for the CSV.</p>
      {questions.map((question, index) => <div className="native-question-edit" key={question.id ?? `new-${index}`}>
        <div className="native-question-fields">
          <label>Question {index + 1}<textarea value={question.prompt} disabled={attempts.length > 0} onChange={(event) => setQuestions(questions.map((item, position) => position === index ? { ...item, prompt: event.target.value } : item))} /></label>
          <label>Type<select value={question.question_type} disabled={attempts.length > 0} onChange={(event) => setQuestions(questions.map((item, position) => position === index ? { ...item, question_type: event.target.value as QuestionEdit['question_type'], options: event.target.value === 'mcq' ? (item.options.length ? item.options : ['', '', '', '']) : [] } : item))}><option value="descriptive">Descriptive</option><option value="mcq">MCQ — one choice</option></select></label>
          {question.question_type === 'mcq' ? <div className="native-mcq-options">{question.options.map((option, optionIndex) => <label key={optionIndex}>Option {optionIndex + 1}<input value={option} disabled={attempts.length > 0} onChange={(event) => setQuestions(questions.map((item, position) => position === index ? { ...item, options: item.options.map((value, valueIndex) => valueIndex === optionIndex ? event.target.value : value) } : item))} /><button type="button" disabled={question.options.length <= 2 || attempts.length > 0} onClick={() => setQuestions(questions.map((item, position) => position === index ? { ...item, options: item.options.filter((_, valueIndex) => valueIndex !== optionIndex) } : item))}>Remove option</button></label>)}<button type="button" disabled={question.options.length >= 8 || attempts.length > 0} onClick={() => setQuestions(questions.map((item, position) => position === index ? { ...item, options: [...item.options, ''] } : item))}>Add option</button></div> : null}
        </div>
        <button type="button" onClick={() => setQuestions(questions.filter((_, position) => position !== index))} disabled={questions.length === 1 || attempts.length > 0}>Remove</button>
      </div>)}
      <div className="sheet-actions"><IconButton onClick={() => setQuestions([...questions, emptyQuestion()])} disabled={attempts.length > 0}>Add next question</IconButton><IconButton className="primary" onClick={() => void save()} disabled={busy}>Save exam and questions</IconButton></div>
      {attempts.length ? <p className="muted-copy">Questions are locked because a student has started this exam.</p> : null}
    </Card>
    {selected ? <Card>
      <div className="section-title"><div><p className="eyebrow">Access and responses</p><h2>Approve students</h2></div><IconButton onClick={() => void exportCsv()} disabled={busy}>Download combined CSV</IconButton></div>
      <p className="muted-copy">Only approved accounts enrolled in this course appear below. Each student can start once.</p>
      <label>Find student<input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Name or student ID" /></label>
      <div className="table-scroll"><table><thead><tr><th>Student</th><th>Access</th><th>Attempt</th><th>Action</th></tr></thead><tbody>{visibleStudents.map((student) => {
        const granted = access.some((item) => item.student_id === student.id)
        const attempt = attempts.find((item) => item.student_id === student.id)
        return <tr key={student.id}><td>{student.full_name}<small>{student.student_id}</small></td><td>{granted ? 'Approved' : 'Waiting'}</td><td>{attempt?.status ?? 'Not started'}</td><td><button disabled={busy} onClick={() => void approve(student.id, !granted)}>{granted ? 'Remove access' : 'Approve'}</button></td></tr>
      })}</tbody></table></div>
    </Card> : null}
  </>
}
