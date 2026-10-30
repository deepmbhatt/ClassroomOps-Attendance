import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { Card, PageHeader, Spinner } from '../components/Layout'
import { flagNativeExamReview, loadMyNativeExamReviews, loadMyRecheckOutcomes, type NativeExamReviewFlag } from '../lib/nativeExams'
import { orderReviewQuestions } from '../lib/reviewQuestionOrder'
import { isReviewWindowOpen } from '../lib/reviewWindow'
import { serviceErrorMessage } from '../lib/serviceError'

function ReviewFlagForm({ examId, questionId, existing }: { examId: string; questionId: string; existing?: NativeExamReviewFlag }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(existing?.reason ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function saveFlag() {
    const clean = reason.trim()
    if (!clean || clean.length > 500) { setError('Enter a reason of 1 to 500 characters.'); return }
    setBusy(true)
    setError('')
    try {
      await flagNativeExamReview(examId, questionId, clean)
      await queryClient.invalidateQueries({ queryKey: ['my-native-exam-reviews'] })
      await queryClient.invalidateQueries({ queryKey: ['my-recheck-outcomes'] })
      setOpen(false)
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Could not save your recheck request.') }
    finally { setBusy(false) }
  }

  return <div className="answer-review-flag">
    <div className="answer-review-flag-summary">
      <div className="answer-review-flag-copy"><span className="answer-review-flag-icon"><Flag size={17} aria-hidden="true" /></span><div><strong>{existing ? existing.status === 'marks_changed' ? 'Marks changed after recheck' : existing.status === 'reviewed' ? 'Recheck completed' : 'Recheck pending' : 'Want this answer rechecked?'}</strong><p>{existing ? existing.status === 'pending' ? 'Your request is waiting for an examiner.' : 'The examiner has responded to your request.' : 'Flag this response and tell the examiner why.'}</p></div></div>
      {!open ? <button className="answer-review-flag-trigger" type="button" onClick={() => { setReason(existing?.reason ?? ''); setError(''); setOpen(true) }} disabled={busy}><Flag size={16} aria-hidden="true" />{existing ? 'Edit reason' : 'Flag response'}</button> : null}
    </div>
    {existing && !open ? <p className="answer-review-flag-reason"><span>Your reason</span>{existing.reason}</p> : null}
    {existing?.admin_response ? <p className="answer-review-flag-reason"><span>Examiner response</span>{existing.admin_response}</p> : null}
    {open ? <div className="answer-review-flag-form"><label>Why should this answer be rechecked?<textarea autoFocus value={reason} maxLength={500} rows={3} onChange={(event) => setReason(event.target.value)} placeholder="Briefly explain the marking concern" /></label><small>{reason.length}/500 characters</small>{error ? <p className="form-error">{error}</p> : null}<div><button className="answer-review-flag-save" type="button" disabled={busy || !reason.trim()} onClick={() => void saveFlag()}>{busy ? 'Saving…' : existing ? 'Save reason' : 'Send recheck request'}</button><button className="answer-review-flag-cancel" type="button" disabled={busy} onClick={() => { setOpen(false); setError('') }}>Cancel</button></div></div> : null}
  </div>
}

export function StudentAnswerReview() {
  const auth = useAuth()
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['my-native-exam-reviews', auth.session?.user.id], queryFn: loadMyNativeExamReviews, refetchInterval: 30_000 })
  const { data: outcomes = [] } = useQuery({ queryKey: ['my-recheck-outcomes', auth.session?.user.id], queryFn: loadMyRecheckOutcomes, refetchInterval: 30_000 })
  const [examId, setExamId] = useState('')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [visible, setVisible] = useState(!document.hidden)
  const [clock, setClock] = useState(Date.now())

  useEffect(() => {
    const update = () => setVisible(!document.hidden && document.hasFocus())
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); window.removeEventListener('blur', update) }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (isLoading) return <Spinner />
  if (error) return <Card><p className="form-error" role="alert">{serviceErrorMessage(error, 'Answer review loading')}</p><button type="button" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? 'Retrying…' : 'Retry loading reviews'}</button></Card>
  const available = (data?.reviews ?? []).filter((row) => {
    const accessWindow = data?.windows.find((item) => item.exam_id === row.exam_id)
    return accessWindow && isReviewWindowOpen(null, accessWindow.available_until, clock)
  })
  const selected = available.find((row) => row.exam_id === examId) ?? available[0]
  const questions = orderReviewQuestions((data?.questions ?? []).filter((question) => question.exam_id === selected?.exam_id))
  const question = questions[Math.min(questionIndex, Math.max(0, questions.length - 1))]
  const answer = question ? selected?.answers[question.id] ?? '' : ''
  const mark = question ? selected?.marks[question.id] : null
  const flag = question ? data?.flags.find((item) => item.exam_id === selected?.exam_id && item.question_id === question.id) : undefined
  const exam = data?.exams.find((item) => item.id === selected?.exam_id)

  return <div className="answer-review-page">
    <PageHeader eyebrow="Private exam review" title="My answers and marks">Review one question at a time. Flag any answer you want rechecked and add a short reason. Empty answers and ungraded marks are shown as blank.</PageHeader>
    {!selected ? <Card><h2>No review available right now</h2><p>Your answers and marks appear here only during the access period set by an administrator.</p></Card> : <>
      {available.length > 1 ? <label className="answer-review-exam-picker">Exam<select value={selected.exam_id} onChange={(event) => { setExamId(event.target.value); setQuestionIndex(0) }}>{available.map((row) => <option key={row.exam_id} value={row.exam_id}>{data?.exams.find((item) => item.id === row.exam_id)?.title ?? 'Exam'}</option>)}</select></label> : null}
      <section className="answer-review-card" tabIndex={0} aria-label="Answer review" onCopy={(event) => event.preventDefault()} onCut={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()} onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'p', 's'].includes(event.key.toLowerCase())) event.preventDefault()
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement) return
        if (event.key === 'ArrowLeft' && questionIndex > 0) setQuestionIndex(questionIndex - 1)
        if (event.key === 'ArrowRight' && questionIndex < questions.length - 1) setQuestionIndex(questionIndex + 1)
      }}>
        <div className="answer-review-head"><span>{exam?.title ?? 'Exam review'}</span><strong>Question {question ? questionIndex + 1 : 0} of {questions.length}</strong></div>
        <div className="answer-review-progress" role="progressbar" aria-label="Questions reviewed" aria-valuenow={question ? questionIndex + 1 : 0} aria-valuemin={0} aria-valuemax={questions.length || 1}><span style={{ width: `${questions.length ? ((Math.min(questionIndex, questions.length - 1) + 1) / questions.length) * 100 : 0}%` }} /></div>
        {!visible ? <div className="answer-review-hidden">Return to this tab to continue reviewing.</div> : question ? <div className="answer-review-content" key={question.id}>
          <div className="answer-review-watermark" aria-hidden="true">{auth.session?.user.email ?? 'Private review'}</div>
          <h2>{question.prompt}</h2>
          <div className="answer-review-pair"><div><span className="eyebrow">Your answer</span><p>{answer || '\u00a0'}</p></div><div><span className="eyebrow">Marks</span><p>{mark === null || mark === undefined ? '\u00a0' : mark}</p></div></div>
          <ReviewFlagForm key={`${selected?.exam_id ?? ''}:${question.id}`} examId={selected?.exam_id ?? ''} questionId={question.id} existing={flag} />
        </div> : <p>No saved questions were found for this review.</p>}
        <div className="answer-review-nav"><button type="button" disabled={questionIndex <= 0} onClick={() => setQuestionIndex((index) => index - 1)}><ChevronLeft size={17} aria-hidden="true" />Previous</button><span aria-live="polite">{question ? `${questionIndex + 1} of ${questions.length}` : '0 of 0'}</span><button type="button" disabled={questionIndex >= questions.length - 1} onClick={() => setQuestionIndex((index) => index + 1)}>Next<ChevronRight size={17} aria-hidden="true" /></button></div>
      </section>
    </>}
    {outcomes.length ? <section className="recheck-outcomes"><h2>My recheck requests</h2><div>{outcomes.map((item, index) => <article key={`${item.exam_title}:${item.question_number}:${index}`}><strong>{item.exam_title} · Question {item.question_number}</strong><span className="status-pill neutral">{item.status.replace('_', ' ')}</span><p><b>Your reason:</b> {item.reason}</p>{item.admin_response ? <p><b>Examiner response:</b> {item.admin_response}</p> : <p>Waiting for examiner review.</p>}</article>)}</div></section> : null}
  </div>
}
