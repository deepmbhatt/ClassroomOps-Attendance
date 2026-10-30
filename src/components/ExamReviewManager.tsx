import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Card, IconButton } from './Layout'
import { previewExamReviewImport, type ReviewKind } from '../lib/examReviewImport'
import { readTabularFile } from '../lib/importValidation'
import { reviewFlagsCsv } from '../lib/reviewFlagsCsv'
import { serviceErrorMessage } from '../lib/serviceError'
import { importNativeExamReviews, loadNativeExamReviewAdmin, publishNativeExamReviews, resolveNativeExamReviewFlag, type NativeQuestion } from '../lib/nativeExams'

function toLocalDateTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function ExamReviewManager({ examId, examTitle, questions, students }: { examId: string; examTitle: string; questions: NativeQuestion[]; students: Array<{ id: string; student_id?: string; full_name?: string }> }) {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['native-exam-review-admin', examId], queryFn: () => loadNativeExamReviewAdmin(examId), refetchInterval: 15_000 })
  const [answerCsv, setAnswerCsv] = useState('')
  const [marksCsv, setMarksCsv] = useState('')
  const [answerFile, setAnswerFile] = useState('')
  const [marksFile, setMarksFile] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [editingFlag, setEditingFlag] = useState('')
  const [flagOutcome, setFlagOutcome] = useState<'reviewed' | 'marks_changed'>('reviewed')
  const [flagResponse, setFlagResponse] = useState('')
  const [revisedMark, setRevisedMark] = useState('')
  const [availableFrom, setAvailableFrom] = useState('')
  const [availableUntil, setAvailableUntil] = useState('')
  const [clock, setClock] = useState(Date.now())
  const loadedWindow = useRef(false)
  const answerPreview = useMemo(() => answerCsv ? previewExamReviewImport(answerCsv, 'answers', questions, students) : null, [answerCsv, questions, students])
  const marksPreview = useMemo(() => marksCsv ? previewExamReviewImport(marksCsv, 'marks', questions, students) : null, [marksCsv, questions, students])
  const readyCount = (data?.rows ?? []).filter((row) => Object.keys(row.answers).length === questions.length && Object.keys(row.marks).length === questions.length).length
  const incompleteCount = (data?.rows.length ?? 0) - readyCount
  const status = !data?.published ? 'Private draft'
    : data.availableFrom && clock < new Date(data.availableFrom).getTime() ? 'Scheduled'
      : data.availableUntil && clock >= new Date(data.availableUntil).getTime() ? 'Closed'
        : 'Live now'

  useEffect(() => {
    if (!data || loadedWindow.current) return
    loadedWindow.current = true
    setAvailableFrom(toLocalDateTime(data.availableFrom))
    setAvailableUntil(toLocalDateTime(data.availableUntil))
  }, [data])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  async function readFile(event: ChangeEvent<HTMLInputElement>, kind: ReviewKind) {
    const file = event.target.files?.[0]
    if (!file) return
    setMessage('')
    try {
      const csv = await readTabularFile(file)
      if (kind === 'answers') { setAnswerCsv(csv); setAnswerFile(file.name) }
      else { setMarksCsv(csv); setMarksFile(file.name) }
    } catch (nextError) { setMessage(nextError instanceof Error ? nextError.message : 'Could not read the file.') }
  }

  async function importFile(kind: ReviewKind) {
    const preview = kind === 'answers' ? answerPreview : marksPreview
    if (!preview?.rows.length || preview.errors.length) return
    setBusy(true)
    try {
      const count = await importNativeExamReviews(examId, kind, preview.rows)
      await queryClient.invalidateQueries({ queryKey: ['native-exam-review-admin', examId] })
      if (kind === 'answers') { setAnswerCsv(''); setAnswerFile('') }
      else { setMarksCsv(''); setMarksFile('') }
      setMessage(`${count} student ${kind} rows saved. Nothing is visible to students until you publish.`)
    } catch (nextError) { setMessage(nextError instanceof Error ? nextError.message : 'Import failed.') }
    finally { setBusy(false) }
  }

  async function togglePublished() {
    if (!data) return
    const next = !data.published
    const from = availableFrom ? new Date(availableFrom).toISOString() : null
    const until = availableUntil ? new Date(availableUntil).toISOString() : null
    if (next && from && until && new Date(until).getTime() <= new Date(from).getTime()) { setMessage('Review closing time must be after opening time.'); return }
    if (next && until && new Date(until).getTime() <= Date.now()) { setMessage('Review closing time must be in the future.'); return }
    const windowText = from || until ? ` Access ${from ? `starts ${new Date(from).toLocaleString('en-IN')}` : 'starts immediately'}${until ? ` and ends ${new Date(until).toLocaleString('en-IN')}` : ' with no closing time'}.` : ' Access stays open until you unpublish.'
    if (next && !window.confirm(`Release answers and marks for ${readyCount} student${readyCount === 1 ? '' : 's'}?${windowText}`)) return
    setBusy(true)
    try {
      await publishNativeExamReviews(examId, next, from, until)
      await queryClient.invalidateQueries({ queryKey: ['native-exam-review-admin', examId] })
      setMessage(next ? from && new Date(from).getTime() > Date.now() ? 'Review access scheduled.' : 'Reviews released to students.' : 'Reviews hidden. You can edit the uploads now.')
    } catch (nextError) { setMessage(nextError instanceof Error ? nextError.message : 'Could not change publication.') }
    finally { setBusy(false) }
  }

  async function downloadFlags() {
    setBusy(true)
    try {
      const latest = await loadNativeExamReviewAdmin(examId)
      await queryClient.invalidateQueries({ queryKey: ['native-exam-review-admin', examId] })
      if (!latest.flags.length) { setMessage('No student responses have been flagged for this exam.'); return }
      const csv = reviewFlagsCsv(latest.flags, questions, latest.rows, students)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${examTitle.replace(/[^a-z0-9-_]+/gi, '-')}-flagged-reviews.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setMessage(`${latest.flags.length} flagged response${latest.flags.length === 1 ? '' : 's'} exported.`)
    } catch (nextError) { setMessage(nextError instanceof Error ? nextError.message : 'Could not download flagged reviews.') }
    finally { setBusy(false) }
  }

  async function saveFlagDecision(examStudentId: string, questionId: string) {
    if (!flagResponse.trim() || (flagOutcome === 'marks_changed' && (revisedMark.trim() === '' || !Number.isFinite(Number(revisedMark)) || Number(revisedMark) < 0))) {
      setMessage('Write a response and, when changing marks, enter a non-negative mark.')
      return
    }
    setBusy(true)
    try {
      await resolveNativeExamReviewFlag({ examId, studentId: examStudentId, questionId, status: flagOutcome, response: flagResponse.trim(), mark: flagOutcome === 'marks_changed' ? Number(revisedMark) : null })
      await queryClient.invalidateQueries({ queryKey: ['native-exam-review-admin', examId] })
      setEditingFlag('')
      setMessage('Recheck outcome saved for the student.')
    } catch (nextError) { setMessage(nextError instanceof Error ? nextError.message : 'Could not save the recheck outcome.') }
    finally { setBusy(false) }
  }

  return <Card className="exam-review-manager">
    <div className="section-title"><div><p className="eyebrow">After the exam</p><h2>Publish answer reviews</h2></div><span className={`status-pill ${status === 'Live now' ? 'good' : status === 'Scheduled' ? 'warn' : 'neutral'}`}>{status}</span></div>
    <p className="muted-copy">Upload two files for this exam: one with each student's answers, one with marks. The first column must be <strong>Enrollment Number</strong>; use each question as a column heading, or simply Q1, Q2, and so on. Blank cells stay blank. CSV and Excel are supported. Keep enrollment numbers formatted as text in Excel.</p>
    {error ? <p className="form-error">{serviceErrorMessage(error, 'Review loading')}</p> : null}
    {message ? <p className="notice">{message}</p> : null}
    <div className="exam-review-upload-grid">
      {(['answers', 'marks'] as const).map((kind) => {
        const preview = kind === 'answers' ? answerPreview : marksPreview
        const name = kind === 'answers' ? answerFile : marksFile
        return <div className="exam-review-upload" key={kind}>
          <h3>{kind === 'answers' ? '1. Student answers' : '2. Question marks'}</h3>
          <input aria-label={`Upload ${kind} file`} type="file" accept=".csv,.xlsx,.xls,text/csv" disabled={busy || data?.published} onChange={(event) => void readFile(event, kind)} />
          {name ? <p>{name} · {preview?.rows.length ?? 0} matched students</p> : null}
          {preview?.errors.length ? <div className="form-error"><strong>Fix before importing:</strong><ul>{preview.errors.slice(0, 8).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>{preview.errors.length > 8 ? <p>{preview.errors.length - 8} more errors</p> : null}</div> : null}
          <IconButton onClick={() => void importFile(kind)} disabled={busy || data?.published || !preview?.rows.length || Boolean(preview.errors.length)}>Import {kind}</IconButton>
        </div>
      })}
    </div>
    <div className="exam-review-window"><label>Access opens<input type="datetime-local" value={availableFrom} disabled={busy || data?.published} onChange={(event) => setAvailableFrom(event.target.value)} /></label><label>Access closes<input type="datetime-local" value={availableUntil} disabled={busy || data?.published} onChange={(event) => setAvailableUntil(event.target.value)} /></label></div>
    <p className="muted-copy">Leave either time blank for no bound on that side. Times use this computer's local timezone; access is enforced using server time.</p>
    <div className="exam-review-publish"><p>{isLoading ? 'Checking uploads…' : `${readyCount} ready to view${incompleteCount ? ` · ${incompleteCount} missing an answers or marks file` : ''}`}</p><IconButton className={data?.published ? '' : 'primary'} disabled={busy || isLoading || Boolean(error) || (!data?.published && (!readyCount || incompleteCount > 0))} onClick={() => void togglePublished()}>{data?.published ? 'Unpublish reviews' : availableFrom ? 'Schedule review access' : 'Publish to students'}</IconButton></div>
    <div className="exam-review-publish"><p>Recheck requests: {data?.flags.length ?? 0}. The CSV includes only flagged questions, with each student's answer, mark, and reason.</p><IconButton disabled={busy || isLoading || Boolean(error)} onClick={() => void downloadFlags()}>Download flagged reviews CSV</IconButton></div>
    {data?.flags.length ? <div className="review-flag-list"><h3>Student recheck requests</h3>{data.flags.map((flag) => {
      const key = `${flag.student_id}:${flag.question_id}`
      const question = questions.find((item) => item.id === flag.question_id)
      const student = students.find((item) => item.id === flag.student_id)
      const review = data.rows.find((item) => item.student_id === flag.student_id)
      return <article className="review-flag-item" key={key}>
        <div><strong>{student?.full_name ?? student?.student_id ?? 'Student'} · Question {question?.position ?? '?'}</strong><span className="status-pill neutral">{flag.status.replace('_', ' ')}</span></div>
        <p><b>Question:</b> {question?.prompt ?? 'Question unavailable'}</p><p><b>Answer:</b> {review?.answers[flag.question_id] || '—'}</p><p><b>Current mark:</b> {review?.marks[flag.question_id] ?? '—'}</p><p><b>Student reason:</b> {flag.reason}</p>
        {flag.admin_response ? <p><b>Examiner response:</b> {flag.admin_response}</p> : null}
        {editingFlag === key ? <div className="review-flag-decision"><label>Outcome<select value={flagOutcome} onChange={(event) => setFlagOutcome(event.target.value as 'reviewed' | 'marks_changed')}><option value="reviewed">Reviewed, no mark change</option><option value="marks_changed">Marks changed</option></select></label>{flagOutcome === 'marks_changed' ? <label>Revised mark<input type="number" min="0" step="any" value={revisedMark} onChange={(event) => setRevisedMark(event.target.value)} /></label> : null}<label>Response to student<textarea maxLength={1000} value={flagResponse} onChange={(event) => setFlagResponse(event.target.value)} placeholder="Explain the outcome" /></label><div><IconButton className="primary" disabled={busy} onClick={() => void saveFlagDecision(flag.student_id, flag.question_id)}>Save outcome</IconButton><IconButton disabled={busy} onClick={() => setEditingFlag('')}>Cancel</IconButton></div></div> : <IconButton disabled={busy} onClick={() => { setEditingFlag(key); setFlagOutcome(flag.status === 'marks_changed' ? 'marks_changed' : 'reviewed'); setFlagResponse(flag.admin_response ?? ''); setRevisedMark(String(review?.marks[flag.question_id] ?? '')) }}>{flag.status === 'pending' ? 'Review request' : 'Edit outcome'}</IconButton>}
      </article>
    })}</div> : null}
  </Card>
}
