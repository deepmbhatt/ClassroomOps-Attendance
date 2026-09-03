import { CheckCircle2, Play, ScanFace, Square, Video } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card, IconButton, OnlineGate, PageHeader, StatusPill } from '../components/Layout'
import { closeLectureSession, createLectureSession, loadAppData, markAttendanceRecord } from '../lib/api'
import { canInsertAttendance, confidenceLabel } from '../lib/attendance'
import { attachCameraStream, listVideoInputs, requestCamera, stopCameraStream } from '../lib/camera'
import { detectFaceRegions, preloadFaceDetector } from '../lib/faceDetection'
import { averageEmbeddings, cosineSimilarity, createEmbeddingFromCanvas, isEmbeddingCompatible, preloadFaceEngine } from '../lib/faceEngine'
import type { AppData } from '../lib/api'

const configuredThreshold = Number(import.meta.env.VITE_FACE_MATCH_THRESHOLD ?? 0.58)
const configuredMargin = Number(import.meta.env.VITE_FACE_MATCH_MARGIN ?? 0.06)
const recognitionThreshold = Number.isFinite(configuredThreshold) ? configuredThreshold : 0.58
const recognitionMargin = Number.isFinite(configuredMargin) ? configuredMargin : 0.06

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
  const [courseId, setCourseId] = useState('')
  const [lectureId, setLectureId] = useState('')
  const [sessionTitle, setSessionTitle] = useState('Lecture attendance')
  const [status, setStatus] = useState('Ready to start')
  const [error, setError] = useState('')
  const [cameraRunning, setCameraRunning] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')

  const course = data?.courses.find((item) => item.id === courseId) ?? data?.courses.find((item) => item.active) ?? data?.courses[0]
  const activeLecture = data?.lectures.find((lecture) => lecture.id === lectureId)
    ?? data?.lectures.find((lecture) => lecture.course_id === course?.id && lecture.status === 'active')
  const effectiveLectureId = activeLecture?.id ?? lectureId
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
    return () => {
      scanningRef.current = false
      stopCameraStream(streamRef.current)
    }
  }, [])

  async function ensureSession() {
    if (activeLecture?.id) {
      currentLectureIdRef.current = activeLecture.id
      return activeLecture.id
    }
    if (!course?.id) throw new Error('Create or select a course before starting attendance.')
    const lecture = await createLectureSession({
      courseId: course.id,
      title: sessionTitle.trim() || 'Lecture attendance',
      startedAt: new Date().toISOString(),
    })
    setLectureId(lecture.id)
    currentLectureIdRef.current = lecture.id
    recentlyMarkedRef.current.clear()
    await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    return lecture.id as string
  }

  async function startCamera() {
    if (cameraRunning) return
    setError('')
    try {
      if (!students.length) throw new Error('No approved students are assigned to this course.')
      if (!readyEmbeddings.length) throw new Error('No compatible face embeddings are ready for students in this course.')
      setStatus('Opening webcam...')
      const stream = await requestCamera(selectedDeviceId || undefined)
      streamRef.current = stream
      if (!videoRef.current) throw new Error('The camera preview is not ready. Press Start scanning again.')
      await attachCameraStream(videoRef.current, stream)
      setCameraRunning(true)
      const inputs = await listVideoInputs()
      setDevices(inputs)
      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId
      if (activeDeviceId) setSelectedDeviceId(activeDeviceId)

      setStatus('Camera ready. Loading face recognition...')
      await ensureSession()
      await Promise.all([preloadFaceDetector(), preloadFaceEngine('cpu')])
      scanningRef.current = true
      setStatus('Scanning for faces')
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
      await new Promise((resolve) => window.setTimeout(resolve, 650))
      if (busyRef.current || !currentLectureIdRef.current) continue
      const probe = captureCanvas(0.28)
      if (!probe) continue
      try {
        const faces = await detectFaceRegions(probe)
        if (faces.length === 1) await recognizeBurst()
        else if (faces.length > 1) setStatus('Only one person should stand in the face zone')
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Recognition failed.')
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
    setStatus('Face detected. Verifying...')

    const vectors: number[][] = []
    const votes = new Map<string, number>()
    let qualityMessage = ''

    try {
      for (let index = 0; index < 3; index += 1) {
        const canvas = captureCanvas(0.8)
        if (!canvas) continue
        const regions = await detectFaceRegions(canvas)
        if (regions.length !== 1) {
          qualityMessage = regions.length ? 'Only one person can be in the face zone.' : 'Keep your face centered.'
          await new Promise((resolve) => window.setTimeout(resolve, 120))
          continue
        }
        const result = await createEmbeddingFromCanvas(canvas, 'cpu', regions[0], regions.length)
        if (!result.quality.ok) {
          qualityMessage = result.quality.messages.join('. ')
          await new Promise((resolve) => window.setTimeout(resolve, 120))
          continue
        }
        vectors.push(result.vector)
        const bestFrame = embeddings
          .map((embedding) => ({ studentId: embedding.student_id, score: cosineSimilarity(result.vector, embedding.vector) }))
          .sort((left, right) => right.score - left.score)[0]
        if (bestFrame) votes.set(bestFrame.studentId, (votes.get(bestFrame.studentId) ?? 0) + 1)
        await new Promise((resolve) => window.setTimeout(resolve, 120))
      }

      if (vectors.length < 2) {
        setStatus(qualityMessage || 'Hold still inside the face zone')
        return
      }

      const queryVector = averageEmbeddings(vectors)
      const ranked = embeddings
        .map((embedding) => ({ embedding, score: cosineSimilarity(queryVector, embedding.vector) }))
        .sort((left, right) => right.score - left.score)
      const best = ranked[0]
      const second = ranked.find((candidate) => candidate.embedding.student_id !== best?.embedding.student_id)
      const voteCount = best ? votes.get(best.embedding.student_id) ?? 0 : 0
      const margin = best ? best.score - (second?.score ?? 0) : 0
      const verified = Boolean(best && best.score >= recognitionThreshold && voteCount >= 2 && margin >= recognitionMargin)

      if (!verified || !best) {
        setStatus('Face not recognized. Move closer and look directly at the camera')
        return
      }

      const lecture = currentLectureIdRef.current
      const alreadyStored = !canInsertAttendance(latestData?.attendance ?? [], lecture, best.embedding.student_id)
      if (alreadyStored || recentlyMarkedRef.current.has(best.embedding.student_id)) {
        const profile = latestStudents.find((student) => student.id === best.embedding.student_id)
        setStatus(`${profile?.full_name ?? 'Student'} is already marked present`)
        return
      }

      recentlyMarkedRef.current.add(best.embedding.student_id)
      await markAttendanceRecord({
        lectureId: lecture,
        studentId: best.embedding.student_id,
        status: 'present',
        confidence: Number(best.score.toFixed(4)),
        source: 'face',
        reason: `3-frame consensus (${voteCount}/${vectors.length}), margin ${margin.toFixed(3)}`,
      })
      const profile = latestStudents.find((student) => student.id === best.embedding.student_id)
      setStatus(`Marked ${profile?.full_name ?? 'student'} present (${Math.round(best.score * 100)}%)`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Recognition failed.')
    } finally {
      window.setTimeout(() => { busyRef.current = false }, 450)
    }
  }

  async function finishSession() {
    const lecture = currentLectureIdRef.current || activeLecture?.id
    if (!lecture) {
      setError('Start a session before finalizing it.')
      return
    }
    if (!window.confirm('Finish this scan? Students not recognized will be marked absent for review.')) return
    setError('')
    try {
      stopCamera('Finalizing attendance...')
      const absentCount = await closeLectureSession(lecture)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
      setStatus(`Session finalized. ${absentCount} unmarked students set absent.`)
      currentLectureIdRef.current = ''
      setLectureId('')
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
            <div className="attendance-controls compact-controls">
              <label>Course<select value={course?.id ?? ''} disabled={cameraRunning} onChange={(event) => setCourseId(event.target.value)}>{data?.courses.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.code} - {item.title}</option>)}</select></label>
              <label>Session title<input value={sessionTitle} disabled={cameraRunning} onChange={(event) => setSessionTitle(event.target.value)} /></label>
              {devices.length > 1 ? <label>Camera<select value={selectedDeviceId} disabled={cameraRunning} onChange={(event) => setSelectedDeviceId(event.target.value)}>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label> : null}
            </div>
            <div className="live-camera-stage">
              <video ref={videoRef} autoPlay playsInline muted />
              <div className="face-zone" />
              {!cameraRunning ? <div className="camera-placeholder"><ScanFace size={42} /><strong>Camera is off</strong><span>Start scanning when the class is ready.</span></div> : null}
            </div>
            <div className="terminal-status">
              <StatusPill tone={cameraRunning ? 'good' : 'neutral'}>{cameraRunning ? 'continuous scan' : 'camera off'}</StatusPill>
              <span>{readyEmbeddings.length} faces ready / {students.length} enrolled</span>
              {error ? <span className="form-error">{error}</span> : null}
            </div>
            <div className="toolbar-actions">
              <IconButton className="success" title="Start the camera and automatic recognition" disabled={cameraRunning} onClick={() => void startCamera()}><Play size={16} />Start scanning</IconButton>
              <IconButton title="Pause face scanning without finalizing attendance" disabled={!cameraRunning} onClick={() => stopCamera()}><Square size={16} />Pause</IconButton>
              <IconButton className="primary" title="Finish scanning, mark remaining students absent, and open review" disabled={!effectiveLectureId} onClick={() => void finishSession()}><CheckCircle2 size={16} />Finish and review</IconButton>
            </div>
          </Card>

          <aside className="attendance-side-panel">
            <Card>
              <div className="section-title"><div><p className="eyebrow">Recognized</p><h2>{records.filter((record) => record.status === 'present').length} / {students.length}</h2></div><ScanFace size={20} /></div>
              <div className="marked-list">
                {records.filter((record) => record.status === 'present').map((record) => (
                  <article key={record.id}>
                    <strong>{record.student_name}</strong>
                    <StatusPill tone="good">present</StatusPill>
                    <small>{confidenceLabel(record.confidence)} confidence</small>
                  </article>
                ))}
                {!records.some((record) => record.status === 'present') ? <p className="muted-copy">Recognized students will appear here immediately.</p> : null}
              </div>
              <Link className="icon-text review-link" title="Open the full date-based attendance register" to="/admin/attendance-review">Open attendance review</Link>
            </Card>
          </aside>
        </div>
      </OnlineGate>
    </>
  )
}
