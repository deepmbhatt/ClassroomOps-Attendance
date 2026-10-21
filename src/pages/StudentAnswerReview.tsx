import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { Card, PageHeader, Spinner } from '../components/Layout'
import { loadMyNativeExamReviews } from '../lib/nativeExams'

export function StudentAnswerReview() {
  const auth = useAuth()
  const { data, isLoading, error } = useQuery({ queryKey: ['my-native-exam-reviews'], queryFn: loadMyNativeExamReviews })
  const [examId, setExamId] = useState('')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [visible, setVisible] = useState(!document.hidden)

  useEffect(() => {
    const update = () => setVisible(!document.hidden && document.hasFocus())
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); window.removeEventListener('blur', update) }
  }, [])

  if (isLoading) return <Spinner />
  if (error) return <Card><p className="form-error">Could not load answer reviews. Ask staff to apply the latest Supabase migration.</p></Card>
  const available = data?.reviews ?? []
  const selected = available.find((row) => row.exam_id === examId) ?? available[0]
  const questions = (data?.questions ?? []).filter((question) => question.exam_id === selected?.exam_id).sort((a, b) => a.position - b.position)
  const question = questions[Math.min(questionIndex, Math.max(0, questions.length - 1))]
  const answer = question ? selected?.answers[question.id] ?? '' : ''
  const mark = question ? selected?.marks[question.id] : null
  const exam = data?.exams.find((item) => item.id === selected?.exam_id)

  return <>
    <PageHeader eyebrow="Private exam review" title="My answers and marks">Review one question at a time. Empty answers and ungraded marks are shown as blank.</PageHeader>
    {!selected ? <Card><h2>No reviews published yet</h2><p>Your answers and marks appear here only after an administrator publishes them.</p></Card> : <>
      {available.length > 1 ? <label className="answer-review-exam-picker">Exam<select value={selected.exam_id} onChange={(event) => { setExamId(event.target.value); setQuestionIndex(0) }}>{available.map((row) => <option key={row.exam_id} value={row.exam_id}>{data?.exams.find((item) => item.id === row.exam_id)?.title ?? 'Exam'}</option>)}</select></label> : null}
      <section className="answer-review-card" tabIndex={0} aria-label="Answer review" onCopy={(event) => event.preventDefault()} onCut={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()} onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'p', 's'].includes(event.key.toLowerCase())) event.preventDefault()
        if (event.key === 'ArrowLeft' && questionIndex > 0) setQuestionIndex(questionIndex - 1)
        if (event.key === 'ArrowRight' && questionIndex < questions.length - 1) setQuestionIndex(questionIndex + 1)
      }}>
        <div className="answer-review-head"><span>{exam?.title ?? 'Exam review'}</span><strong>Question {question ? questionIndex + 1 : 0} of {questions.length}</strong></div>
        {!visible ? <div className="answer-review-hidden">Return to this tab to continue reviewing.</div> : question ? <div className="answer-review-content">
          <div className="answer-review-watermark" aria-hidden="true">{auth.session?.user.email ?? 'Private review'}</div>
          <h2>{question.prompt}</h2>
          <div className="answer-review-pair"><div><span className="eyebrow">Your answer</span><p>{answer || '\u00a0'}</p></div><div><span className="eyebrow">Marks</span><p>{mark === null || mark === undefined ? '\u00a0' : mark}</p></div></div>
        </div> : <p>No saved questions were found for this review.</p>}
        <div className="answer-review-nav"><button type="button" disabled={questionIndex <= 0} onClick={() => setQuestionIndex((index) => index - 1)}>← Previous</button><span>{question ? `${questionIndex + 1} / ${questions.length}` : '0 / 0'}</span><button type="button" disabled={questionIndex >= questions.length - 1} onClick={() => setQuestionIndex((index) => index + 1)}>Next →</button></div>
      </section>
      <p className="muted-copy">This view discourages copying and printing, but no website can block screenshots or photos taken outside the browser.</p>
    </>}
  </>
}
