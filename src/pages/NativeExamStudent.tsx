import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { Card, PageHeader, Spinner } from '../components/Layout'
import { isMobileExamDevice, measureExamDownloadKbps, minimumExamKbps } from '../lib/examPreflight'
import { loadNativeExams, reportNativeViolation, saveNativeAnswers, startNativeExam, submitNativeAnswers, type NativeAttempt, type NativeExam, type NativeQuestion, type NativeViolationEvent } from '../lib/nativeExams'

type PendingEvent = { id: string; event: NativeViolationEvent }
type LocalDraft = { attemptId: string; studentId: string; attempt: NativeAttempt; exam: NativeExam; questions: NativeQuestion[]; revision: number; answers: Record<string, string>; flags?: string[]; pendingEvents: PendingEvent[]; pendingSubmit: 'student' | 'offline_timeout' | null }

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
  const [flags, setFlags] = useState<string[]>([])
  const [preflightExamId, setPreflightExamId] = useState('')
  const [preflightStage, setPreflightStage] = useState<'idle' | 'speed' | 'device' | 'ready'>('idle')
  const [speedKbps, setSpeedKbps] = useState<number | null>(null)
  const [entryCode, setEntryCode] = useState('')
  const [exitCode, setExitCode] = useState('')
  const screenRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<NativeAttempt | null>(null)
  const examRef = useRef<NativeExam | null>(null)
  const questionsRef = useRef<NativeQuestion[]>([])
  const answersRef = useRef<Record<string, string>>({})
  const revisionRef = useRef(0)
  const flagsRef = useRef<string[]>([])
  const exitCodeRef = useRef('')
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
    const draft: LocalDraft = { attemptId: attempt.id, studentId, attempt, exam, questions: questionsRef.current, answers: answersRef.current, revision: revisionRef.current, flags: flagsRef.current, pendingEvents: pendingEventsRef.current, pendingSubmit: pendingSubmitRef.current }
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
    flagsRef.current = draft.flags ?? []
    pendingEventsRef.current = draft.pendingEvents ?? []
    pendingSubmitRef.current = draft.pendingSubmit ?? null
    leavingRef.current = false
    warningRef.current = pendingEventsRef.current.length > 0
    setActive(draft.attempt)
    setQuestions(draft.questions)
    setAnswers(draft.answers)
    setRevision(draft.revision)
    setFlags(flagsRef.current)
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
        if (examRef.current?.code_mode === 'entry_exit' && !/^[0-9]{4}$/.test(exitCodeRef.current)) {
          setSaveState('Enter the four-digit exit code to finish')
          return
        }
        const accepted = await submitNativeAnswers(attempt.id, answersRef.current, revisionRef.current, reason, exitCodeRef.current)
        if (!accepted) {
          const latest = await startNativeExam(attempt.exam_id)
          if (latest.status === 'in_progress') {
            exitCodeRef.current = ''
            setExitCode('')
            setMessage('Exit code was incorrect or temporarily locked. Your answers remain saved; ask staff and retry.')
            return
          }
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
    setSaveState(examRef.current?.code_mode === 'entry_exit' ? 'Enter your exit code to finish' : navigator.onLine ? 'Submitting…' : 'Submission queued in this browser; it will send when internet returns')
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

  async function beginPreflight(examId: string) {
    setPreflightExamId(examId)
    setPreflightStage('speed')
    setSpeedKbps(null)
    setEntryCode('')
    setMessage('Checking connection speed…')
    setBusy(true)
    try {
      const measured = await measureExamDownloadKbps()
      setSpeedKbps(measured)
      if (measured < minimumExamKbps) throw new Error(`Connection measured ${measured} kbps. At least ${minimumExamKbps} kbps is required to start; retry on a stronger connection.`)
      setPreflightStage('device')
      if (isMobileExamDevice()) throw new Error('Phones and tablets are not permitted. Use a laptop or desktop computer.')
      setPreflightStage('ready')
      setMessage('Connection and computer checks passed. Enter your attendance code if requested, then begin.')
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : 'Preflight failed. Retry.')
    } finally { setBusy(false) }
  }

  function toggleFlag(questionId: string) {
    const next = flagsRef.current.includes(questionId) ? flagsRef.current.filter((id) => id !== questionId) : [...flagsRef.current, questionId]
    flagsRef.current = next
    setFlags(next)
    persist()
  }

  async function start(examId: string, code?: string) {
    if (!screenRef.current) return
    if (isMobileExamDevice()) { setMessage('Phones and tablets are not permitted for this exam.'); return }
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
      const attempt = await startNativeExam(examId, code)
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
      flagsRef.current = []
      setFlags([])
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
      setPreflightExamId('')
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
  const answeredCount = questions.filter((question) => (answers[question.id] ?? '').trim() !== '').length
  const remaining = active ? Math.max(0, Math.ceil((new Date(active.deadline_at).getTime() - clock) / 1000)) : 0
  return <div ref={screenRef} className={`native-exam-screen ${active ? 'taking-exam' : ''}`}>
    {active ? <>
      <header className="native-exam-top"><strong>{activeExam?.title ?? 'Exam'}</strong><span className="native-exam-timer">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} left</span><span>{answeredCount}/{questions.length} answered</span><span>Warnings {warningCount}/{activeExam?.warning_limit ?? 1}</span><span>{saveState}</span><button disabled={busy || Boolean(pendingSubmitRef.current)} onClick={() => setFinishConfirm(true)}>Finish exam</button></header>
      {message ? <p className="form-error">{message}</p> : null}
      {pendingSubmitRef.current ? <div className="native-exam-confirm"><h2>Exam finished</h2><p>Your answers are locked and saved in this browser. The original deadline still applies. Keep this browser data until submission is confirmed.</p>{activeExam?.code_mode === 'entry_exit' ? <label>Four-digit exit code<input inputMode="numeric" maxLength={4} autoComplete="off" value={exitCode} onChange={(event) => { const next = event.target.value.replace(/\D/g, '').slice(0, 4); exitCodeRef.current = next; setExitCode(next) }} placeholder="Enter the code given by staff" /></label> : null}<button onClick={() => void syncPending()} disabled={!online || (activeExam?.code_mode === 'entry_exit' && exitCode.length !== 4)}>{online ? 'Submit saved answers' : 'Waiting for internet'}</button></div> : finishConfirm ? <div className="native-exam-confirm"><h2>Finish and submit?</h2><p>{answeredCount} of {questions.length} questions answered. You cannot edit answers or start this exam again after finishing.{activeExam?.code_mode === 'entry_exit' ? ' You will be asked for an exit code.' : ''}</p><button onClick={() => setFinishConfirm(false)}>Keep writing</button><button className="icon-text primary" disabled={busy} onClick={() => queueSubmit('student')}>Yes, finish exam</button></div> : warningPrompt ? <div className="native-exam-confirm"><h2>Warning {warningCount} of {activeExam?.warning_limit ?? 1}</h2><p>You left the exam tab or fullscreen. Re-enter fullscreen to continue. Reaching the configured limit submits your attempt automatically.</p><button className="icon-text primary" disabled={busy} onClick={() => void resumeFullscreen()}>Return to fullscreen</button></div> : <div className="native-exam-workspace">
        <aside className="native-exam-questions"><h2>Questions</h2><p>{answeredCount} answered · {flags.length} flagged</p><div className="native-question-grid">{questions.map((question, index) => <button key={question.id} title={`Question ${index + 1}: ${flags.includes(question.id) ? 'flagged' : answers[question.id]?.trim() ? 'answered' : 'unanswered'}`} className={`${index === selectedQuestion ? 'selected ' : ''}${flags.includes(question.id) ? 'flagged' : answers[question.id]?.trim() ? 'answered' : 'unanswered'}`} onClick={() => { setSelectedQuestion(index); void save() }}>{index + 1}</button>)}</div><p className="native-question-legend"><span>● Answered</span><span>● Not answered</span><span>● Flagged</span></p></aside>
        <section className="native-exam-answer"><p>Question {selectedQuestion + 1} of {questions.length} · {currentQuestion?.question_type === 'mcq' ? 'MCQ' : 'Descriptive'}</p><h2>{currentQuestion?.prompt}</h2>{currentQuestion?.question_type === 'mcq' ? <div className="native-answer-options">{currentQuestion.options.map((option, index) => <label key={index}><input type="radio" name={`answer-${currentQuestion.id}`} checked={currentAnswer === String(index)} onChange={() => changeAnswer(currentQuestion.id, String(index))} />{option}</label>)}</div> : <label>Your answer<textarea value={currentAnswer} maxLength={50000} onChange={(event) => currentQuestion && changeAnswer(currentQuestion.id, event.target.value)} placeholder="Write your answer here…" /></label>}<footer className="native-exam-wordcount">{currentQuestion?.question_type === 'descriptive' ? `This answer: ${wordCount(currentAnswer)} words · ` : ''}Total written: {totalWords} words</footer><div className="native-exam-actions"><button disabled={selectedQuestion === 0} onClick={() => setSelectedQuestion(selectedQuestion - 1)}>← Previous</button><button onClick={() => currentQuestion && toggleFlag(currentQuestion.id)}>{currentQuestion && flags.includes(currentQuestion.id) ? 'Remove flag' : 'Flag for review'}</button><button disabled={selectedQuestion >= questions.length - 1} onClick={() => setSelectedQuestion(selectedQuestion + 1)}>Next →</button></div><p className="muted-copy">Answers are saved in this browser during an outage and sync when internet returns. Keep this device and browser data until submission is confirmed.</p></section>
      </div>}
    </> : <>
      <PageHeader eyebrow="Student assessment" title="My exams">Face-verified attendance is required for this exam. The timer starts only after entry and does not pause if your computer shuts down.</PageHeader>
      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="form-error">{error instanceof Error ? error.message : 'Could not load exams.'} Apply the new Supabase migration first.</p> : null}
      {recovery ? <Card><h2>Recover your exam</h2><p>{recovery.exam.title} · original deadline: {new Date(recovery.attempt.deadline_at).toLocaleString('en-IN')}</p><p>{recovery.pendingSubmit ? 'Final submission is waiting for internet or exit code.' : 'Answers and questions are saved on this device. Time lost during shutdown is not restored.'}</p><button className="icon-text primary" disabled={busy} onClick={() => void start(recovery.exam.id)}>Resume saved attempt</button></Card> : null}
      {isLoading && !recovery ? <Spinner /> : exams.length ? <div className="exam-access-list">{exams.map((exam) => {
        const attempt = data?.attempts.find((item) => item.exam_id === exam.id)
        const open = exam.status === 'open' && Date.now() >= new Date(exam.starts_at).getTime() && Date.now() < new Date(exam.ends_at).getTime()
        return <Card key={exam.id} className="native-student-exam-card"><h2>{exam.title}</h2><p>{exam.instructions}</p><p>{exam.duration_minutes} minutes · {exam.warning_limit} warning{exam.warning_limit === 1 ? '' : 's'} allowed · {new Date(exam.starts_at).toLocaleString('en-IN')} to {new Date(exam.ends_at).toLocaleString('en-IN')}</p><p>{attempt?.status === 'in_progress' ? 'Attempt in progress' : attempt?.status ? 'Already submitted' : open ? 'Ready to start' : 'Not open'}</p>{preflightExamId === exam.id ? <div className="native-preflight"><h3>Before you begin</h3><p>{speedKbps !== null && speedKbps >= minimumExamKbps ? '✓' : '○'} Internet speed {speedKbps === null ? `(minimum ${minimumExamKbps} kbps)` : `${speedKbps} kbps`}</p><p>{preflightStage === 'ready' ? '✓' : '○'} Laptop or desktop computer</p><p>{exam.code_mode === 'none' ? '✓ No entry code required' : `${entryCode.length === 4 ? '✓' : '○'} Four-digit attendance code`}</p>{preflightStage === 'ready' ? <>{exam.code_mode !== 'none' ? <label>Attendance code<input inputMode="numeric" maxLength={4} autoComplete="off" value={entryCode} onChange={(event) => setEntryCode(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4-digit code" /></label> : null}<button className="icon-text primary" disabled={busy || (exam.code_mode !== 'none' && entryCode.length !== 4)} onClick={() => void start(exam.id, entryCode)}>Enter fullscreen and begin</button></> : <button disabled={busy} onClick={() => void beginPreflight(exam.id)}>Retry checks</button>}</div> : <button className="icon-text primary" disabled={(!open && attempt?.status !== 'in_progress') || busy || Boolean(attempt && attempt.status !== 'in_progress')} onClick={() => void beginPreflight(exam.id)}>{attempt?.status === 'in_progress' ? 'Check device and resume' : 'Start exam checks'}</button>}</Card>
      })}</div> : !recovery ? <Card>No exams have been approved for you yet.</Card> : null}
    </>}
  </div>
}
