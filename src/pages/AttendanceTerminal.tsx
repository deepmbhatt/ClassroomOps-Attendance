import { CheckCircle2, Play, ScanFace, Square, Video } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card, IconButton, OnlineGate, PageHeader, StatusPill } from '../components/Layout'
import { closeLectureSession, createLectureSession, loadAppData, markAttendanceRecord } from '../lib/api'
import { canAcceptFaceConsensus, canAcceptFastFaceMatch, confidenceLabel } from '../lib/attendance'
import { attachCameraStream, listVideoInputs, requestCamera, stopCameraStream } from '../lib/camera'
import { detectFaceRegions, preloadFaceDetector, refineFaceRegionLandmarks, selectPrimaryFace } from '../lib/faceDetection'
import { createEmbeddingCandidatesFromCanvas, isEmbeddingCompatible, preloadFaceEngine, recommendedFaceMatchThreshold, templateSimilarity } from '../lib/faceEngine'
import { localDateKey } from '../lib/attendanceView'
import { NEW_SESSION_VALUE, recognitionAttendanceStatus, sessionStartForDate, sessionsForCourseDate } from '../lib/sessionSelection'
import type { AppData } from '../lib/api'

const configuredThreshold = Number(import.meta.env.VITE_FACE_MATCH_THRESHOLD ?? recommendedFaceMatchThreshold)
const configuredMargin = Number(import.meta.env.VITE_FACE_MATCH_MARGIN ?? 0.04)
const recognitionThreshold = Number.isFinite(configuredThreshold) ? Math.min(0.7, Math.max(0.25, configuredThreshold)) : recommendedFaceMatchThreshold
const recognitionMargin = Number.isFinite(configuredMargin) ? Math.min(0.15, Math.max(0.02, configuredMargin)) : 0.04

type ScanFeedback = {
  tone: 'idle' | 'checking' | 'success' | 'retry'
  title: string
  detail: string
}

let recognitionWarmupPromise: Promise<void> | null = null

function warmRecognition() {
  recognitionWarmupPromise ??= Promise.all([preloadFaceDetector(), preloadFaceEngine('auto')])
    .then(() => undefined)
    .catch((error) => {
      recognitionWarmupPromise = null
      throw error
    })
  return recognitionWarmupPromise
}

export function AttendanceTerminal() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanningRef = useRef(false)
  const busyRef = useRef(false)
  const currentLectureIdRef = useRef('')
  const latestDataRef = useRef<AppData | undefined>(data)
  const recentlyMarkedRef = useRef(new Set<string>())
  const recognitionRetryAfterRef = useRef(0)
  const [courseId, setCourseId] = useState('')
  const [sessionDate, setSessionDate] = useState(() => localDateKey(new Date()))
  const [sessionSelection, setSessionSelection] = useState('')
  const [createdLectureId, setCreatedLectureId] = useState('')
  const [sessionTitle, setSessionTitle] = useState('Lecture attendance')
  const [status, setStatus] = useState('Ready to start')
  const [error, setError] = useState('')
  const [cameraRunning, setCameraRunning] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [mirrored, setMirrored] = useState(true)
  const [recognitionState, setRecognitionState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>({
    tone: 'idle',
    title: 'Ready for the next student',
    detail: 'Attendance will be confirmed here.',
  })

  const course = data?.courses.find((item) => item.id === courseId) ?? data?.courses.find((item) => item.active) ?? data?.courses[0]
  const sessionsOnSelectedDate = useMemo(
    () => sessionsForCourseDate(data?.lectures ?? [], course?.id ?? '', sessionDate),
    [course?.id, data?.lectures, sessionDate],
  )
  const selectedLecture = sessionSelection === NEW_SESSION_VALUE
    ? data?.lectures.find((lecture) => lecture.id === createdLectureId)
    : sessionsOnSelectedDate.find((lecture) => lecture.id === sessionSelection)
  const effectiveLectureId = selectedLecture?.id ?? createdLectureId
  const courseStudentIds = useMemo(() => new Set((data?.courseMemberships ?? [])
    .filter((item) => item.course_id === course?.id && !item.deleted_at)
    .map((item) => item.student_id)), [course?.id, data?.courseMemberships])
  const students = useMemo(() => (data?.profiles ?? []).filter((profile) =>
    courseStudentIds.has(profile.id)
    && profile.role === 'student'
    && profile.approval_status === 'approved'
    && !profile.deleted_at
  ), [courseStudentIds, data?.profiles])
  const records = (data?.attendance ?? []).filter((record) => record.lecture_id === effectiveLectureId)
  const readyEmbeddings = (data?.embeddings ?? []).filter((embedding) =>
    courseStudentIds.has(embedding.student_id)
    && embedding.vector?.length
    && isEmbeddingCompatible(embedding)
  )

  useEffect(() => { latestDataRef.current = data }, [data])
  useEffect(() => { currentLectureIdRef.current = effectiveLectureId }, [effectiveLectureId])
  useEffect(() => {
    if (!readyEmbeddings.length) {
      setRecognitionState('idle')
      return
    }
    let mounted = true
    setRecognitionState('loading')
    void warmRecognition().then(() => {
      if (mounted) setRecognitionState('ready')
    }).catch(() => {
      if (mounted) setRecognitionState('idle')
    })
    return () => { mounted = false }
  }, [readyEmbeddings.length])
  useEffect(() => {
    return () => {
      scanningRef.current = false
      stopCameraStream(streamRef.current)
    }
  }, [])

  async function ensureSession() {
    if (selectedLecture?.id) {
      currentLectureIdRef.current = selectedLecture.id
      return selectedLecture.id
    }
    if (createdLectureId) {
      currentLectureIdRef.current = createdLectureId
      return createdLectureId
    }
    if (!course?.id) throw new Error('Choose a course before starting attendance.')
    if (sessionSelection !== NEW_SESSION_VALUE) throw new Error('Choose an existing session or create a new session first.')
    const title = sessionTitle.trim()
    if (!title) throw new Error('Enter a title for the new session.')

    const lecture = await createLectureSession({
      courseId: course.id,
      title,
      startedAt: sessionStartForDate(sessionDate),
    })
    setCreatedLectureId(lecture.id)
    currentLectureIdRef.current = lecture.id
    recentlyMarkedRef.current.clear()
    await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    return lecture.id as string
  }

  async function startCamera() {
    if (cameraRunning) return
    setError('')
    if (!sessionSelection) {
      setError('Choose an existing session or select Create new session before starting the camera.')
      return
    }
    if (sessionSelection === NEW_SESSION_VALUE && !sessionTitle.trim()) {
      setError('Enter a title for the new session before starting the camera.')
      return
    }
    if (sessionSelection === NEW_SESSION_VALUE && !createdLectureId && sessionsOnSelectedDate.length > 0) {
      const confirmed = window.confirm(`${sessionsOnSelectedDate.length} session${sessionsOnSelectedDate.length === 1 ? '' : 's'} already exist on this date. Create a separate new session?`)
      if (!confirmed) return
    }
    try {
      setStatus('Opening webcam...')
      const stream = await requestCamera(selectedDeviceId || undefined)
      streamRef.current = stream
      if (!videoRef.current) throw new Error('The camera preview is not ready. Press Start scanning again.')
      await attachCameraStream(videoRef.current, stream)
      setCameraRunning(true)
      const inputs = await listVideoInputs()
      setDevices(inputs)
      const cameraSettings = stream.getVideoTracks()[0]?.getSettings()
      const activeDeviceId = cameraSettings?.deviceId
      setMirrored(cameraSettings?.facingMode !== 'environment')
      if (activeDeviceId) setSelectedDeviceId(activeDeviceId)

      if (!students.length) {
        setStatus('Camera ready. Course setup is required')
        setError('The webcam is working, but no approved students are assigned to this course.')
        return
      }
      if (!readyEmbeddings.length) {
        setStatus('Camera ready. Face enrollments are required')
        setError('The webcam is working, but this course has no compatible student face embeddings.')
        return
      }

      setStatus(recognitionState === 'ready' ? 'Starting scanner...' : 'Finishing recognition setup...')
      await Promise.all([ensureSession(), warmRecognition()])
      setRecognitionState('ready')
      scanningRef.current = true
      setStatus('Automatic recognition active')
      setScanFeedback({ tone: 'idle', title: 'Ready for the next student', detail: 'Stand in view and wait for approval.' })
      void scanLoop()
    } catch (nextError) {
      stopCamera('Camera could not start')
      setError(nextError instanceof Error ? nextError.message : 'Camera could not start.')
    }
  }

  function stopCamera(nextStatus = 'Camera stopped') {
    scanningRef.current = false
    stopCameraStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraRunning(false)
    setStatus(nextStatus)
    setScanFeedback({ tone: 'idle', title: 'Scanner paused', detail: 'Start scanning when ready.' })
  }

  function captureCanvas(scale: number) {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return null
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(160, Math.floor(video.videoWidth * scale))
    canvas.height = Math.max(120, Math.floor(video.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  async function scanLoop() {
    while (scanningRef.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      if (busyRef.current || !currentLectureIdRef.current || Date.now() < recognitionRetryAfterRef.current) continue
      const probe = captureCanvas(0.32)
      if (!probe) continue
      try {
        const faces = await detectFaceRegions(probe)
        const primaryFace = selectPrimaryFace(faces, probe.width, probe.height)
        if (primaryFace) await recognizeBurst()

      } catch (nextError) {
        scanningRef.current = false
        setError(nextError instanceof Error ? nextError.message : 'Recognition stopped unexpectedly.')
        setStatus('Scanner paused')
      }
    }
  }

  async function recognizeBurst() {
    const latestData = latestDataRef.current
    const latestAllowedIds = new Set((latestData?.courseMemberships ?? [])
      .filter((item) => item.course_id === course?.id && !item.deleted_at)
      .map((item) => item.student_id))
    const latestStudents = (latestData?.profiles ?? []).filter((profile) =>
      latestAllowedIds.has(profile.id)
      && profile.role === 'student'
      && profile.approval_status === 'approved'
      && !profile.deleted_at
    )
    const embeddings = (latestData?.embeddings ?? []).filter((embedding) =>
      latestAllowedIds.has(embedding.student_id)
      && embedding.vector?.length
      && isEmbeddingCompatible(embedding)
    )
    if (!embeddings.length) return

    busyRef.current = true
    setError('')
    setScanFeedback({ tone: 'checking', title: 'Verifying face', detail: 'Please wait for approval before moving.' })

    const frameCandidates: number[][][] = []
    const votes = new Map<string, number>()
    let verifiedStudentId = ''
    let verifiedScore = 0
    let verifiedMargin = 0
    let verifiedVotes = 0
    let observedScore = Number.NEGATIVE_INFINITY
    let observedMargin = 0

    try {
      for (let index = 0; index < 3; index += 1) {
        const canvas = captureCanvas(0.68)
        if (!canvas) continue
        const currentRegions = await detectFaceRegions(canvas)
        const currentRegion = selectPrimaryFace(currentRegions, canvas.width, canvas.height)
        if (!currentRegion) continue
        const refinedRegion = await refineFaceRegionLandmarks(canvas, currentRegion)
        const results = await createEmbeddingCandidatesFromCanvas(canvas, 'auto', refinedRegion, 1, 'attendance')
        const candidates = results.map((result) => result.vector)
        frameCandidates.push(candidates)

        const frameRanked = embeddings
          .map((embedding) => ({
            studentId: embedding.student_id,
            score: Math.max(...candidates.map((candidate) => templateSimilarity(candidate, embedding.vector))),
          }))
          .sort((left, right) => right.score - left.score)
        const frameBest = frameRanked[0]
        const frameSecond = frameRanked.find((candidate) => candidate.studentId !== frameBest?.studentId)
        if (frameBest) votes.set(frameBest.studentId, (votes.get(frameBest.studentId) ?? 0) + 1)
        const frameMargin = frameBest ? frameBest.score - (frameSecond?.score ?? 0) : 0
        if (frameBest && frameBest.score > observedScore) {
          observedScore = frameBest.score
          observedMargin = frameMargin
        }

        if (frameBest && frameCandidates.length === 1 && canAcceptFastFaceMatch(
          frameBest.score,
          frameMargin,
          results.some((result) => result.quality.ok),
          recognitionThreshold,
          recognitionMargin,
        )) {
          verifiedStudentId = frameBest.studentId
          verifiedScore = frameBest.score
          verifiedMargin = frameMargin
          verifiedVotes = 1
          break
        }

        if (frameCandidates.length >= 2) {
          const ranked = embeddings
            .map((embedding) => ({
              studentId: embedding.student_id,
              score: frameCandidates.reduce((sum, candidatesForFrame) => (
                sum + Math.max(...candidatesForFrame.map((candidate) => templateSimilarity(candidate, embedding.vector)))
              ), 0) / frameCandidates.length,
            }))
            .sort((left, right) => right.score - left.score)
          const best = ranked[0]
          const second = ranked.find((candidate) => candidate.studentId !== best?.studentId)
          const voteCount = best ? votes.get(best.studentId) ?? 0 : 0
          const margin = best ? best.score - (second?.score ?? 0) : 0
          if (best && best.score > observedScore) {
            observedScore = best.score
            observedMargin = margin
          }
          if (best && canAcceptFaceConsensus(best.score, margin, voteCount, frameCandidates.length, recognitionThreshold, recognitionMargin)) {
            verifiedStudentId = best.studentId
            verifiedScore = best.score
            verifiedMargin = margin
            verifiedVotes = voteCount
            break
          }
        }

        if (index < 2) await new Promise((resolve) => window.setTimeout(resolve, 70))
      }

      if (!verifiedStudentId) {
        recognitionRetryAfterRef.current = Date.now() + 1400
        const scoreDetail = Number.isFinite(observedScore)
          ? ` Best match ${Math.round(observedScore * 100)}%, separation ${Math.round(observedMargin * 100)}%.`
          : ''
        setScanFeedback({ tone: 'retry', title: 'Not verified yet', detail: `Hold position briefly.${scoreDetail} Retrying automatically.` })
        return
      }

      const lecture = currentLectureIdRef.current
      const profile = latestStudents.find((student) => student.id === verifiedStudentId)
      const studentName = profile?.full_name ?? 'Student'
      const existingRecord = (latestData?.attendance ?? []).find((record) => record.lecture_id === lecture && record.student_id === verifiedStudentId)
      const sessionStatus = latestData?.lectures.find((session) => session.id === lecture)?.status ?? selectedLecture?.status ?? 'active'
      const attendanceStatus = recognitionAttendanceStatus(sessionStatus, existingRecord?.status)
      if (!attendanceStatus || recentlyMarkedRef.current.has(verifiedStudentId)) {
        recognitionRetryAfterRef.current = Date.now() + 1800
        setScanFeedback({ tone: 'success', title: studentName, detail: 'Already approved for this session. Next student may proceed.' })
        return
      }

      recognitionRetryAfterRef.current = Date.now() + 1800
      recentlyMarkedRef.current.add(verifiedStudentId)
      await markAttendanceRecord({
        lectureId: lecture,
        studentId: verifiedStudentId,
        status: attendanceStatus,
        confidence: Number(verifiedScore.toFixed(4)),
        source: 'face',
        reason: `${attendanceStatus === 'late' ? 'Late arrival in reopened session. ' : ''}Adaptive verification (${verifiedVotes}/${frameCandidates.length} votes), margin ${verifiedMargin.toFixed(3)}`,
      })
      setScanFeedback({ tone: 'success', title: studentName, detail: `${attendanceStatus === 'late' ? 'Late attendance' : 'Attendance'} approved at ${Math.round(verifiedScore * 100)}%. Next student may proceed.` })
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Recognition failed.')
      setScanFeedback({ tone: 'retry', title: 'Scanner needs attention', detail: 'Pause and restart scanning.' })
    } finally {
      window.setTimeout(() => { busyRef.current = false }, 140)
    }
  }

  async function finishSession() {
    const lecture = currentLectureIdRef.current || effectiveLectureId
    if (!lecture) {
      setError('Start a session before finalizing it.')
      return
    }
    const sessionIsClosed = (latestDataRef.current?.lectures ?? []).find((session) => session.id === lecture)?.status === 'closed'
    if (!sessionIsClosed && !window.confirm('Finish this scan? Students not recognized will be marked absent for review.')) return
    setError('')
    try {
      if (sessionIsClosed) {
        stopCamera('Reopened session updated')
        navigate('/admin/attendance-review')
        return
      }
      stopCamera('Finalizing attendance...')
      const absentCount = await closeLectureSession(lecture)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
      setStatus(`Session finalized. ${absentCount} unmarked students set absent.`)
      currentLectureIdRef.current = ''
      setSessionSelection('')
      setCreatedLectureId('')
      navigate('/admin/attendance-review')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not finalize attendance.')
      setStatus('Finalization failed')
    }
  }

  return (
    <>
      <PageHeader eyebrow="Classroom terminal" title="Live face scan">
        Keep this page open during entry. Recognition and marking happen automatically; corrections belong in Attendance review.
      </PageHeader>
      <OnlineGate>
        <div className="attendance-terminal-layout scan-only-layout">
          <Card className="terminal-camera-card">
            <div className="section-title"><div><p className="eyebrow">Live camera</p><h2>{status}</h2></div><Video size={20} /></div>
            <div className="attendance-controls compact-controls session-setup-controls">
              <label>Course<select value={course?.id ?? ''} disabled={cameraRunning} onChange={(event) => {
                setCourseId(event.target.value)
                setSessionSelection('')
                setCreatedLectureId('')
              }}>{data?.courses.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.code} - {item.title}</option>)}</select></label>
              <label>Date<input type="date" value={sessionDate} disabled={cameraRunning} onChange={(event) => {
                setSessionDate(event.target.value)
                setSessionSelection('')
                setCreatedLectureId('')
              }} /></label>
              <label>Session<select value={sessionSelection} disabled={cameraRunning || !course?.id} onChange={(event) => {
                setSessionSelection(event.target.value)
                setCreatedLectureId('')
                recentlyMarkedRef.current.clear()
              }}>
                <option value="">Choose a session</option>
                {sessionsOnSelectedDate.map((session) => <option key={session.id} value={session.id}>{new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(session.started_at))} - {session.title} ({session.status})</option>)}
                <option value={NEW_SESSION_VALUE}>+ Create new session</option>
              </select></label>
              {sessionSelection === NEW_SESSION_VALUE ? <label>New session title<input value={sessionTitle} disabled={cameraRunning || Boolean(createdLectureId)} onChange={(event) => setSessionTitle(event.target.value)} /></label> : null}
              {devices.length > 1 ? <label>Camera<select value={selectedDeviceId} disabled={cameraRunning} onChange={(event) => setSelectedDeviceId(event.target.value)}>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label> : null}
            </div>
            {selectedLecture ? <div className="selected-session-summary">
              <span><strong>{selectedLecture.title}</strong><small>{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(selectedLecture.started_at))}</small></span>
              <StatusPill tone={selectedLecture.status === 'closed' ? 'warn' : 'good'}>{selectedLecture.status === 'closed' ? 'Reopen for late arrivals' : 'Use active session'}</StatusPill>
            </div> : sessionSelection === NEW_SESSION_VALUE ? <div className="selected-session-summary new-session-summary"><span><strong>New session</strong><small>A separate attendance register will be created for {sessionDate}.</small></span><StatusPill tone="neutral">Not created</StatusPill></div> : null}
            <div className="live-camera-stage">
              <video ref={videoRef} className={mirrored ? 'selfie-preview' : undefined} autoPlay playsInline muted />
              {cameraRunning ? <div className={`scan-feedback ${scanFeedback.tone}`} aria-live="polite">
                {scanFeedback.tone === 'success' ? <CheckCircle2 size={22} /> : <ScanFace size={22} />}
                <div><strong>{scanFeedback.title}</strong><span>{scanFeedback.detail}</span></div>
              </div> : null}
              {!cameraRunning ? <div className="camera-placeholder"><ScanFace size={42} /><strong>Camera is off</strong><span>Start scanning when the class is ready.</span></div> : null}
            </div>
            <div className="terminal-status">
              <StatusPill tone={cameraRunning ? 'good' : 'neutral'}>{cameraRunning ? 'continuous scan' : 'camera off'}</StatusPill>
              <StatusPill tone={recognitionState === 'ready' ? 'good' : 'neutral'}>{recognitionState === 'ready' ? 'recognition ready' : recognitionState === 'loading' ? 'preparing recognition' : 'recognition idle'}</StatusPill>
              <span>{readyEmbeddings.length} faces ready / {students.length} enrolled</span>
              {error ? <span className="form-error">{error}</span> : null}
            </div>
            <div className="toolbar-actions">
              <IconButton className="success" title="Start the camera for the selected session" disabled={cameraRunning || !sessionSelection || (sessionSelection === NEW_SESSION_VALUE && !sessionTitle.trim())} onClick={() => void startCamera()}><Play size={16} />Start selected session</IconButton>
              <IconButton title="Pause face scanning without finalizing attendance" disabled={!cameraRunning} onClick={() => stopCamera()}><Square size={16} />Pause</IconButton>
              <IconButton className="primary" title="Finish scanning, mark remaining students absent, and open review" disabled={!effectiveLectureId || (!cameraRunning && !currentLectureIdRef.current)} onClick={() => void finishSession()}><CheckCircle2 size={16} />Finish and review</IconButton>
            </div>
          </Card>

          <aside className="attendance-side-panel">
            <Card>
              <div className="section-title"><div><p className="eyebrow">Recognized</p><h2>{records.filter((record) => record.status === 'present' || record.status === 'late').length} / {students.length}</h2></div><ScanFace size={20} /></div>
              <div className="marked-list">
                {records.filter((record) => record.status === 'present' || record.status === 'late').map((record) => (
                  <article key={record.id}>
                    <strong>{record.student_name}</strong>
                    <StatusPill tone={record.status === 'late' ? 'warn' : 'good'}>{record.status}</StatusPill>
                    <small>{confidenceLabel(record.confidence)} confidence</small>
                  </article>
                ))}
                {!records.some((record) => record.status === 'present' || record.status === 'late') ? <p className="muted-copy">Recognized students will appear here immediately.</p> : null}
              </div>
              <Link className="icon-text review-link" title="Open the full date-based attendance register" to="/admin/attendance-review">Open attendance review</Link>
            </Card>
          </aside>
        </div>
      </OnlineGate>
    </>
  )
}
