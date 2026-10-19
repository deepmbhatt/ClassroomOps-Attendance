import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { Card, PageHeader, Spinner } from '../components/Layout'
import { loadNativeExams, reportNativeViolation, saveNativeAnswers, startNativeExam, submitNativeAnswers, type NativeAttempt, type NativeExam, type NativeQuestion, type NativeViolationEvent } from '../lib/nativeExams'

type PendingEvent = { id: string; event: NativeViolationEvent }
type LocalDraft = { attemptId: string; studentId: string; attempt: NativeAttempt; exam: NativeExam; questions: NativeQuestion[]; revision: number; answers: Record<string, string>; pendingEvents: PendingEvent[]; pendingSubmit: 'student' | 'offline_timeout' | null }

const draftKey = (attemptId: string) => `native-exam-${attemptId}`
const recoveryKey = (studentId: string) => `native-exam-active-${studentId}`

function readDraft(attemptId: string): LocalDraft | null {
  try {
    const item = JSON.parse(localStorage.getItem(draftKey(attemptId)) ?? 'null') as LocalDraft | null
    return item?.attemptId === attemptId && item.attempt && item.exam && Array.isArray(item.questions) ? item : null
  } catch { return null }
}

function readRecovery(studentId: string) {
  try {
    const attemptId = localStorage.getItem(recoveryKey(studentId))
    const draft = attemptId ? readDraft(attemptId) : null
    return draft?.studentId === studentId ? draft : null
  } catch { return null }
}

function wordCount(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed.split(/\s+/u).length : 0
}

export function NativeExamStudent() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['native-exams'], queryFn: loadNativeExams, refetchInterval: 15000 })
  const [active, setActive] = useState<NativeAttempt | null>(null)
  const [questions, setQuestions] = useState<NativeQuestion[]>([])
  const [selectedQuestion, setSelectedQuestion] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [revision, setRevision] = useState(0)
  const [saveState, setSaveState] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [warningPrompt, setWarningPrompt] = useState(false)
  const [warningCount, setWarningCount] = useState(0)
  const [finishConfirm, setFinishConfirm] = useState(false)
  const [clock, setClock] = useState(Date.now())
  const [online, setOnline] = useState(navigator.onLine)
  const [recovery, setRecovery] = useState<LocalDraft | null>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<NativeAttempt | null>(null)
  const examRef = useRef<NativeExam | null>(null)
  const questionsRef = useRef<NativeQuestion[]>([])
  const answersRef = useRef<Record<string, string>>({})
  const revisionRef = useRef(0)
  const leavingRef = useRef(false)
  const warningRef = useRef(false)
  const pendingEventsRef = useRef<PendingEvent[]>([])
  const pendingSubmitRef = useRef<'student' | 'offline_timeout' | null>(null)
  const syncingRef = useRef(false)

  function persist() {
    const attempt = activeRef.current
    const exam = examRef.current
    const studentId = auth.session?.user.id
    if (!attempt || !exam || !studentId) return true
    const draft: LocalDraft = { attemptId: attempt.id, studentId, attempt, exam, questions: questionsRef.current, answers: answersRef.current, revision: revisionRef.current, pendingEvents: pendingEventsRef.current, pendingSubmit: pendingSubmitRef.current }
    try {
      localStorage.setItem(draftKey(attempt.id), JSON.stringify(draft))
      localStorage.setItem(recoveryKey(studentId), attempt.id)
      setRecovery(draft)
      return true
    } catch {
      setSaveState('Browser storage is full or disabled. Your offline work may be lost.')
      return false
    }
  }

  function clearDraft(attemptId: string) {
    try {
      localStorage.removeItem(draftKey(attemptId))
      const studentId = auth.session?.user.id
      if (studentId && localStorage.getItem(recoveryKey(studentId)) === attemptId) localStorage.removeItem(recoveryKey(studentId))
    } catch { /* Submission is complete even if browser storage is unavailable. */ }
    setRecovery(null)
  }

  function restore(draft: LocalDraft) {
    activeRef.current = draft.attempt
    examRef.current = draft.exam
    questionsRef.current = draft.questions
    answersRef.current = draft.answers
    revisionRef.current = draft.revision
    pendingEventsRef.current = draft.pendingEvents ?? []
    pendingSubmitRef.current = draft.pendingSubmit ?? null
    leavingRef.current = false
    warningRef.current = pendingEventsRef.current.length > 0
    setActive(draft.attempt)
    setQuestions(draft.questions)
    setAnswers(draft.answers)
    setRevision(draft.revision)
    setWarningCount(draft.attempt.warning_count + pendingEventsRef.current.length)
    setWarningPrompt(warningRef.current)
    setSaveState(navigator.onLine ? 'Restored from this browser; syncing…' : 'Offline — saved in this browser')
    if (Date.now() >= new Date(draft.attempt.deadline_at).getTime() && !pendingSubmitRef.current) queueSubmit('offline_timeout')
    else if (navigator.onLine) void syncPending()
  }

  function currentDraft(nextAnswers: Record<string, string>, nextRevision: number) {
    answersRef.current = nextAnswers
    revisionRef.current = nextRevision
    persist()
  }

  function changeAnswer(questionId: string, text: string) {
    const next = { ...answersRef.current, [questionId]: text }
    const nextRevision = revisionRef.current + 1
    answersRef.current = next
    revisionRef.current = nextRevision
    setAnswers(next)
    setRevision(nextRevision)
    setSaveState('Saving…')
    currentDraft(next, nextRevision)
  }

  function closeAttempt(message: string) {
    const attempt = activeRef.current
    if (!attempt) return
    activeRef.current = null
    pendingEventsRef.current = []
    pendingSubmitRef.current = null
    setActive(null)
    setMessage(message)
    clearDraft(attempt.id)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    void queryClient.invalidateQueries({ queryKey: ['native-exams'] })
  }

  async function syncPending() {
    const attempt = activeRef.current
    if (!attempt || syncingRef.current || !navigator.onLine) return
    syncingRef.current = true
    try {
      while (pendingEventsRef.current.length) {
        const pending = pendingEventsRef.current[0]
        const result = await reportNativeViolation(attempt.id, answersRef.current, revisionRef.current, pending.event, pending.id)
        pendingEventsRef.current = pendingEventsRef.current.slice(1)
        activeRef.current = result
        setActive(result)
        setWarningCount(result.warning_count + pendingEventsRef.current.length)
        persist()
        if (result.status !== 'in_progress') {
          closeAttempt('The warning limit was reached. Your saved answers were submitted.')
          return
        }
      }
      if (pendingSubmitRef.current || Date.now() >= new Date(attempt.deadline_at).getTime()) {
        const reason = pendingSubmitRef.current ?? 'offline_timeout'
        pendingSubmitRef.current = reason
        persist()
        const accepted = await submitNativeAnswers(attempt.id, answersRef.current, revisionRef.current, reason)
        if (!accepted) {
          const latest = await startNativeExam(attempt.exam_id)
          if (latest.status === 'in_progress') throw new Error('Could not confirm submission')
        }
        closeAttempt(reason === 'student' ? 'Your answers were submitted.' : 'Time is up. Your locally saved answers were submitted.')
        return
      }
      const savedRevision = revisionRef.current
      const accepted = await saveNativeAnswers(attempt.id, answersRef.current, savedRevision)
      if (!accepted) {
        const latest = await startNativeExam(attempt.exam_id)
        if (latest.status !== 'in_progress') closeAttempt('This attempt was already submitted.')
        else if (Date.now() >= new Date(latest.deadline_at).getTime()) queueSubmit('offline_timeout')
      } else if (savedRevision === revisionRef.current) setSaveState('Saved online')
    } catch {
      setSaveState('Offline or sync failed — answers are saved in this browser and will retry')
    } finally { syncingRef.current = false }
  }

  function save() {
    if (!activeRef.current || pendingSubmitRef.current || warningRef.current) return
    persist()
    void syncPending()
  }

  function queueSubmit(reason: 'student' | 'offline_timeout') {
    if (!activeRef.current || pendingSubmitRef.current) return
    pendingSubmitRef.current = reason
    warningRef.current = true
    setFinishConfirm(false)
    setWarningPrompt(false)
    setSaveState(navigator.onLine ? 'Submitting…' : 'Submission queued in this browser; it will send when internet returns')
    persist()
    void syncPending()
  }

  function leaveExam(event: NativeViolationEvent) {
    const attempt = activeRef.current
    if (!attempt || warningRef.current || pendingSubmitRef.current) return
    warningRef.current = true
    pendingEventsRef.current = [...pendingEventsRef.current, { id: crypto.randomUUID(), event }]
    const count = attempt.warning_count + pendingEventsRef.current.length
    setWarningCount(count)
    setFinishConfirm(false)
    setWarningPrompt(true)
    setSaveState(navigator.onLine ? 'Recording warning…' : 'Warning queued offline')
    persist()
    if (count >= (examRef.current?.warning_limit ?? 1)) {
      pendingSubmitRef.current = 'offline_timeout'
      persist()
    }
    void syncPending()
  }

  useEffect(() => {
    if (!active) return
    const onVisibility = () => { if (document.hidden) leaveExam('tab_hidden'); else if (!document.fullscreenElement) leaveExam('fullscreen_exit') }
    const onFullscreen = () => { if (!document.fullscreenElement) leaveExam('fullscreen_exit') }
    const onUnload = () => leaveExam('page_exit')
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('fullscreenchange', onFullscreen)
    window.addEventListener('pagehide', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('fullscreenchange', onFullscreen)
      window.removeEventListener('pagehide', onUnload)
    }
  // The handlers use refs to send the latest answer text.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  useEffect(() => {
    const studentId = auth.session?.user.id
    if (!studentId || activeRef.current) return
    const draft = readRecovery(studentId)
    if (draft) setRecovery(draft)
  }, [auth.session?.user.id])

  useEffect(() => {
    const onOnline = () => { setOnline(true); void syncPending() }
    const onOffline = () => { setOnline(false); setSaveState('Offline — answers are saved in this browser') }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  // The event handlers use current refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!active || leavingRef.current || pendingSubmitRef.current) return
    const timer = window.setTimeout(() => { void save() }, 700)
    return () => window.clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, active?.id])

  useEffect(() => {
    if (!active) return
    const clockTimer = window.setInterval(() => setClock(Date.now()), 1000)
    const timer = window.setInterval(() => {
      if (Date.now() >= new Date(active.deadline_at).getTime() && !pendingSubmitRef.current) queueSubmit('offline_timeout')
      else if (!leavingRef.current) void syncPending()
    }, 1000)
    return () => { window.clearInterval(timer); window.clearInterval(clockTimer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  async function start(examId: string) {
    if (!screenRef.current) return
    setBusy(true)
    setMessage('')
    try {
      // Fullscreen must be requested directly from this click, before awaiting the server.
      await screenRef.current.requestFullscreen()
      const local = auth.session?.user.id ? readRecovery(auth.session.user.id) : null
      if (local?.attempt.exam_id === examId) {
        restore(local)
        return
      }
      const attempt = await startNativeExam(examId)
      if (attempt.status !== 'in_progress') {
        setMessage('You have already used your one attempt for this exam.')
        await document.exitFullscreen()
        return
      }
      const refreshed = await loadNativeExams()
      const exam = refreshed.exams.find((item) => item.id === examId)
      if (!exam) throw new Error('Could not load the exam details.')
      leavingRef.current = false
      warningRef.current = false
      pendingEventsRef.current = []
      pendingSubmitRef.current = null
      setWarningPrompt(false)
      setWarningCount(attempt.warning_count)
      activeRef.current = attempt
      examRef.current = exam
      questionsRef.current = refreshed.questions.filter((question) => question.exam_id === examId)
      answersRef.current = attempt.answers
      revisionRef.current = attempt.revision
      setAnswers(attempt.answers)
      setRevision(attempt.revision)
      setActive(attempt)
      setSaveState('Autosave on')
      setQuestions(questionsRef.current)
      setSelectedQuestion(0)
      persist()
      if (Date.now() >= new Date(attempt.deadline_at).getTime()) queueSubmit('offline_timeout')
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : 'Could not start the exam.')
      if (!activeRef.current && document.fullscreenElement) await document.exitFullscreen()
    } finally { setBusy(false) }
  }

  async function resumeFullscreen() {
    try {
      await screenRef.current?.requestFullscreen()
      warningRef.current = false
      setWarningPrompt(false)
      setMessage('')
      setSaveState(online ? 'Autosave on' : 'Offline — answers are saved in this browser')
      void save()
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : 'Fullscreen could not be started.')
    }
  }

  const exams = data?.exams ?? []
  const currentQuestion = questions[selectedQuestion]
  const activeExam = examRef.current ?? exams.find((exam) => exam.id === active?.exam_id)
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] ?? '' : ''
  const totalWords = questions.filter((question) => question.question_type === 'descriptive').reduce((total, question) => total + wordCount(answers[question.id] ?? ''), 0)
  const remaining = active ? Math.max(0, Math.ceil((new Date(active.deadline_at).getTime() - clock) / 1000)) : 0
  return <div ref={screenRef} className={`native-exam-screen ${active ? 'taking-exam' : ''}`}>
    {active ? <>
      <header className="native-exam-top"><strong>{activeExam?.title ?? 'Exam'}</strong><span>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} remaining</span><span>Warnings {warningCount}/{activeExam?.warning_limit ?? 1}</span><span>{saveState}</span><button disabled={busy || Boolean(pendingSubmitRef.current)} onClick={() => setFinishConfirm(true)}>Finish exam</button></header>
      {message ? <p className="form-error">{message}</p> : null}
      {pendingSubmitRef.current ? <div className="native-exam-confirm"><h2>Exam finished</h2><p>Your answers are saved in this browser. They will be sent automatically when the connection returns. Keep this browser data until submission is confirmed.</p><button onClick={() => void syncPending()} disabled={!online}>Retry submission</button></div> : finishConfirm ? <div className="native-exam-confirm"><h2>Finish and submit?</h2><p>You cannot edit answers or start this exam again after finishing.</p><button onClick={() => setFinishConfirm(false)}>Keep writing</button><button className="icon-text primary" disabled={busy} onClick={() => queueSubmit('student')}>Yes, finish exam</button></div> : warningPrompt ? <div className="native-exam-confirm"><h2>Warning {warningCount} of {activeExam?.warning_limit ?? 1}</h2><p>You left the exam tab or fullscreen. Re-enter fullscreen to continue. Reaching the configured limit submits your attempt automatically.</p><button className="icon-text primary" disabled={busy} onClick={() => void resumeFullscreen()}>Return to fullscreen</button></div> : <div className="native-exam-workspace">
        <aside className="native-exam-questions"><h2>Questions</h2>{questions.map((question, index) => <button key={question.id} className={index === selectedQuestion ? 'selected' : ''} onClick={() => { setSelectedQuestion(index); void save() }}>Question {index + 1}{answers[question.id]?.trim() ? ' ✓' : ''}</button>)}</aside>
        <section className="native-exam-answer"><p>Question {selectedQuestion + 1} of {questions.length} · {currentQuestion?.question_type === 'mcq' ? 'MCQ' : 'Descriptive'}</p><h2>{currentQuestion?.prompt}</h2>{currentQuestion?.question_type === 'mcq' ? <div className="native-answer-options">{currentQuestion.options.map((option, index) => <label key={index}><input type="radio" name={`answer-${currentQuestion.id}`} checked={currentAnswer === String(index)} onChange={() => changeAnswer(currentQuestion.id, String(index))} />{option}</label>)}</div> : <label>Your answer<textarea value={currentAnswer} maxLength={50000} onChange={(event) => currentQuestion && changeAnswer(currentQuestion.id, event.target.value)} placeholder="Write your answer here…" /></label>}<footer className="native-exam-wordcount">{currentQuestion?.question_type === 'descriptive' ? `This answer: ${wordCount(currentAnswer)} words · ` : ''}Total written: {totalWords} words</footer><p className="muted-copy">Answers are saved in this browser during an outage and sync when internet returns. Keep this device and browser data until submission is confirmed.</p></section>
      </div>}
    </> : <>
      <PageHeader eyebrow="In-app assessment" title="My exams">An approved exam can be attempted once. Starting requires fullscreen. Each tab switch or fullscreen exit counts as a warning; the exam submits at its configured limit.</PageHeader>
      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="form-error">{error instanceof Error ? error.message : 'Could not load exams.'} Apply the new Supabase migration first.</p> : null}
      {recovery ? <Card><h2>Recover your exam</h2><p>{recovery.exam.title} · {new Date(recovery.attempt.deadline_at).toLocaleString('en-IN')} deadline</p><p>{recovery.pendingSubmit ? 'Final submission is waiting for internet.' : 'Answers and questions are saved on this device.'}</p><button className="icon-text primary" disabled={busy} onClick={() => void start(recovery.exam.id)}>Resume saved attempt</button></Card> : null}
      {isLoading && !recovery ? <Spinner /> : exams.length ? <div className="exam-access-list">{exams.map((exam) => {
        const attempt = data?.attempts.find((item) => item.exam_id === exam.id)
        const open = exam.status === 'open' && Date.now() >= new Date(exam.starts_at).getTime() && Date.now() < new Date(exam.ends_at).getTime()
        return <Card key={exam.id}><h2>{exam.title}</h2><p>{exam.instructions}</p><p>{exam.duration_minutes} minutes · Auto-submit after {exam.warning_limit} warning{exam.warning_limit === 1 ? '' : 's'} · {new Date(exam.starts_at).toLocaleString('en-IN')} to {new Date(exam.ends_at).toLocaleString('en-IN')}</p><p>{attempt?.status === 'in_progress' ? 'Attempt in progress' : attempt?.status ? 'Already submitted' : open ? 'Ready to start' : 'Not open'}</p><button className="icon-text primary" disabled={(!open && attempt?.status !== 'in_progress') || busy || Boolean(attempt && attempt.status !== 'in_progress')} onClick={() => void start(exam.id)}>{attempt?.status === 'in_progress' ? 'Resume in fullscreen' : 'Start exam'}</button></Card>
      })}</div> : !recovery ? <Card>No exams have been approved for you yet.</Card> : null}
    </>}
  </div>
}
