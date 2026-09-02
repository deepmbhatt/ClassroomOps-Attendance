import { CheckCircle2, Download, FileUp, Monitor, Play, Square, UserCheck, Video } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Card, IconButton, OnlineGate, PageHeader, StatusPill } from '../components/Layout'
import { createLectureSession, closeLectureSession, loadAppData, markAttendanceRecord } from '../lib/api'
import { canInsertAttendance, confidenceLabel, normalizeAttendanceStatus } from '../lib/attendance'
import { detectFaceRegions, preloadFaceDetector } from '../lib/faceDetection'
import { averageEmbeddings, cosineSimilarity, createEmbeddingFromCanvas, isEmbeddingCompatible, preloadFaceEngine } from '../lib/faceEngine'
import type { AppData } from '../lib/api'
import type { AttendanceStatus } from '../types'

const attendanceCsvFormat = `Student ID,Status,Marked At,Reason
CSE001,present,2026-08-18T09:00:00+05:30,manual upload
CSE002,absent,2026-08-18T09:00:00+05:30,manual upload`
const configuredThreshold = Number(import.meta.env.VITE_FACE_MATCH_THRESHOLD ?? 0.58)
const configuredMargin = Number(import.meta.env.VITE_FACE_MATCH_MARGIN ?? 0.06)
const recognitionThreshold = Number.isFinite(configuredThreshold) ? configuredThreshold : 0.58
const recognitionMargin = Number.isFinite(configuredMargin) ? configuredMargin : 0.06

export function AttendanceTerminal() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanningRef = useRef(false)
  const busyRef = useRef(false)
  const currentLectureIdRef = useRef('')
  const latestDataRef = useRef<AppData | undefined>(data)
  const markManualRef = useRef<(status: AttendanceStatus) => Promise<void>>(async () => undefined)
  const [courseId, setCourseId] = useState(data?.courses[0]?.id ?? 'course-1')
  const [lectureId, setLectureId] = useState('')
  const [sessionTitle, setSessionTitle] = useState('Lecture attendance')
  const [sessionDateTime, setSessionDateTime] = useState(() => new Date().toISOString().slice(0, 16))
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [status, setStatus] = useState('Camera stopped')
  const [manualCsv, setManualCsv] = useState(attendanceCsvFormat)
  const [error, setError] = useState('')
  const [cameraRunning, setCameraRunning] = useState(false)

  const course = data?.courses.find((item) => item.id === courseId) ?? data?.courses[0]
  const activeLecture = data?.lectures.find((lecture) => lecture.id === lectureId)
    ?? data?.lectures.find((lecture) => lecture.course_id === course?.id && lecture.status === 'active')
  const effectiveLectureId = activeLecture?.id ?? lectureId
  const students = useMemo(() => data?.profiles.filter((profile) => profile.role === 'student' && profile.approval_status !== 'pending' && profile.approval_status !== 'rejected' && !profile.deleted_at) ?? [], [data])
  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? students[0]
  const records = (data?.attendance ?? []).filter((record) => !effectiveLectureId || record.lecture_id === effectiveLectureId)
  const readyEmbeddings = (data?.embeddings ?? []).filter((embedding) => embedding.vector?.length && isEmbeddingCompatible(embedding))

  useEffect(() => {
    latestDataRef.current = data
  }, [data])

  useEffect(() => {
    currentLectureIdRef.current = effectiveLectureId
  }, [effectiveLectureId])

  useEffect(() => {
    if (!selectedStudentId && students[0]) setSelectedStudentId(students[0].id)
  }, [selectedStudentId, students])

  markManualRef.current = markManual

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      if (event.key.toLowerCase() === 'p') void markManualRef.current('present')
      if (event.key.toLowerCase() === 'a') void markManualRef.current('absent')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function ensureSession() {
    if (activeLecture?.id) {
      currentLectureIdRef.current = activeLecture.id
      setStatus(`Session ready: ${activeLecture.title}`)
      return activeLecture.id
    }
    if (!course?.id) throw new Error('Select a course before starting attendance.')
    setStatus('Creating attendance session...')
    const lecture = await createLectureSession({
      courseId: course.id,
      title: sessionTitle,
      startedAt: new Date(sessionDateTime).toISOString(),
    })
    setLectureId(lecture.id)
    currentLectureIdRef.current = lecture.id
    await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    setStatus(`Session ready: ${lecture.title}`)
    return lecture.id as string
  }

  async function startCamera() {
    setError('')
    try {
      await ensureSession()
      if (!readyEmbeddings.length) throw new Error('No compatible face embeddings are ready. Reprocess older enrollments from Biometrics first.')
      setStatus('Loading face detector and recognition model...')
      await Promise.all([preloadFaceDetector(), preloadFaceEngine('cpu')])
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is unavailable. Open the app on HTTPS or localhost and allow camera permission.')
      }
      setStatus('Requesting camera permission...')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }
      scanningRef.current = true
      setCameraRunning(true)
      setStatus('Live scan running')
      void scanLoop()
    } catch (nextError) {
      stopCamera()
      setError(nextError instanceof Error ? nextError.message : 'Camera could not start.')
      setStatus('Camera could not start')
    }
  }

  function stopCamera() {
    scanningRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraRunning(false)
    setStatus('Camera stopped')
  }

  function captureCanvas(scale = 0.5) {
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
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Recognition failed')
      }
    }
  }

  async function recognizeBurst() {
    const latestData = latestDataRef.current
    const latestStudents = latestData?.profiles.filter((profile) =>
      profile.role === 'student'
      && profile.approval_status !== 'pending'
      && profile.approval_status !== 'rejected'
      && !profile.deleted_at
    ) ?? []
    const allowedStudentIds = new Set(latestStudents.map((student) => student.id))
    const embeddings = (latestData?.embeddings ?? []).filter((embedding) =>
      embedding.vector?.length
      && isEmbeddingCompatible(embedding)
      && allowedStudentIds.has(embedding.student_id)
    )

    if (!embeddings.length) {
      setStatus('No compatible embeddings loaded. Reprocess enrollments in Biometrics.')
      return
    }

    busyRef.current = true
    setError('')
    setStatus('Face detected. Verifying across 3 frames...')

    const vectors: number[][] = []
    const votes = new Map<string, number>()
    let lastQualityMessage = ''

    try {
      for (let index = 0; index < 3; index += 1) {
        const canvas = captureCanvas(0.8)
        if (!canvas) continue
        const regions = await detectFaceRegions(canvas)
        if (regions.length !== 1) {
          lastQualityMessage = regions.length ? 'Only one person can be in the face zone.' : 'Keep your face centered and look at the camera.'
          await new Promise((resolve) => window.setTimeout(resolve, 120))
          continue
        }

        const result = await createEmbeddingFromCanvas(canvas, 'cpu', regions[0], regions.length)
        if (!result.quality.ok) {
          lastQualityMessage = result.quality.messages.join('. ')
          await new Promise((resolve) => window.setTimeout(resolve, 120))
          continue
        }

        vectors.push(result.vector)
        const frameBest = embeddings
          .map((embedding) => ({ studentId: embedding.student_id, score: cosineSimilarity(result.vector, embedding.vector) }))
          .sort((left, right) => right.score - left.score)[0]
        if (frameBest) votes.set(frameBest.studentId, (votes.get(frameBest.studentId) ?? 0) + 1)
        await new Promise((resolve) => window.setTimeout(resolve, 120))
      }

      if (vectors.length < 2) {
        setStatus(lastQualityMessage || 'Could not capture two clear frames. Hold still and try again.')
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
      const verified = Boolean(
        best
        && best.score >= recognitionThreshold
        && voteCount >= 2
        && margin >= recognitionMargin
      )

      if (!verified || !best) {
        const closest = latestStudents.find((student) => student.id === best?.embedding.student_id)
        const reason = voteCount < 2
          ? 'frames did not agree'
          : margin < recognitionMargin
            ? 'match is too close to another student'
            : 'confidence is below threshold'
        setStatus(`Unknown face: ${reason}. Closest ${closest?.full_name ?? 'none'} at ${Math.round((best?.score ?? 0) * 100)}%.`)
        return
      }

      const lecture = currentLectureIdRef.current || await ensureSession()
      if (!canInsertAttendance(latestData?.attendance ?? [], lecture, best.embedding.student_id)) {
        const profile = latestStudents.find((student) => student.id === best.embedding.student_id)
        setStatus(`${profile?.full_name ?? 'Student'} is already marked for this session.`)
        return
      }

      await markAttendanceRecord({
        lectureId: lecture,
        studentId: best.embedding.student_id,
        status: 'present',
        confidence: Number(best.score.toFixed(4)),
        source: 'face',
        reason: `3-frame consensus (${voteCount}/${vectors.length}), margin ${margin.toFixed(3)}`,
      })
      const profile = latestStudents.find((student) => student.id === best.embedding.student_id)
      setStatus(`Marked ${profile?.full_name ?? 'student'} present in ${vectors.length} frames (${Math.round(best.score * 100)}%).`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } finally {
      window.setTimeout(() => { busyRef.current = false }, 450)
    }
  }

  async function markManual(nextStatus: AttendanceStatus) {
    if (!selectedStudent?.id) return
    setError('')
    try {
      const lecture = await ensureSession()
      await markAttendanceRecord({
        lectureId: lecture,
        studentId: selectedStudent.id,
        status: nextStatus,
        source: 'manual',
        reason: 'Manual terminal entry',
        markedAt: new Date(sessionDateTime).toISOString(),
      })
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
      setStatus(`${selectedStudent.full_name} marked ${nextStatus}`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Manual attendance update failed.')
      setStatus('Manual mark failed')
    }
  }

  async function importAttendance() {
    setError('')
    try {
      const lecture = await ensureSession()
      const lines = manualCsv.trim().split(/\r?\n/)
      const [headerLine, ...rows] = lines
      const headers = headerLine.split(',').map((cell) => cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'))
      const studentIndex = headers.indexOf('student_id')
      const statusIndex = headers.indexOf('status')
      const markedAtIndex = headers.indexOf('marked_at')
      const reasonIndex = headers.indexOf('reason')
      if (studentIndex === -1 || statusIndex === -1) throw new Error('CSV must include Student ID and Status columns.')
      let imported = 0
      for (const rowLine of rows) {
        const row = rowLine.split(',').map((cell) => cell.trim())
        const profile = students.find((student) => student.student_id === row[studentIndex])
        if (!profile) continue
        await markAttendanceRecord({
          lectureId: lecture,
          studentId: profile.id,
          status: normalizeAttendanceStatus(row[statusIndex]),
          source: 'import',
          reason: row[reasonIndex] || 'CSV import',
          markedAt: row[markedAtIndex] || new Date(sessionDateTime).toISOString(),
        })
        imported += 1
      }
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
      setStatus(`${imported} attendance rows imported`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'CSV attendance import failed.')
      setStatus('CSV import failed')
    }
  }

  async function saveSession() {
    setError('')
    try {
      await ensureSession()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not create attendance session.')
      setStatus('Session save failed')
    }
  }

  async function closeSession() {
    setError('')
    try {
      const lecture = currentLectureIdRef.current || activeLecture?.id
      if (!lecture) throw new Error('Start or select a session before closing it.')
      await closeLectureSession(lecture)
      currentLectureIdRef.current = ''
      setLectureId('')
      stopCamera()
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
      setStatus('Session closed')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not close attendance session.')
      setStatus('Close session failed')
    }
  }

  function exportSheet() {
    const rows = [['Student ID', 'Name', 'Course', 'Lecture', 'Date Time', 'Status', 'Confidence', 'Source']]
    for (const student of students) {
      const record = records.find((item) => item.student_id === student.id)
      rows.push([
        student.student_id ?? '',
        student.full_name,
        course?.code ?? '',
        activeLecture?.title ?? sessionTitle,
        activeLecture?.started_at ?? new Date(sessionDateTime).toISOString(),
        record?.status ?? 'absent',
        record?.confidence == null ? '' : String(record.confidence),
        record?.source ?? 'final_absent',
      ])
    }
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${course?.code ?? 'course'}-${activeLecture?.title ?? sessionTitle}-attendance.csv`.replace(/[^a-z0-9.-]+/gi, '-')
    link.click()
    URL.revokeObjectURL(url)
  }

  async function readCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setManualCsv(await file.text())
  }

  return (
    <>
      <PageHeader eyebrow="Classroom terminal" title="Live attendance terminal">
        Set the session date/time, keep the camera running, mark recognized students within seconds, and correct records manually when needed.
      </PageHeader>
      <OnlineGate>
        <div className="attendance-terminal-layout">
          <Card className="terminal-camera-card">
            <div className="section-title"><div><p className="eyebrow">Live camera</p><h2>{status}</h2></div><Video size={20} /></div>
            <div className="attendance-controls">
              <label>Course<select value={course?.id ?? courseId} onChange={(event) => setCourseId(event.target.value)}>{data?.courses.map((item) => <option key={item.id} value={item.id}>{item.code} - {item.title}</option>)}</select></label>
              <label>Title<input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} /></label>
              <label>Date/time<input type="datetime-local" value={sessionDateTime} onChange={(event) => setSessionDateTime(event.target.value)} /></label>
            </div>
            <div className="live-camera-stage">
              <video ref={videoRef} autoPlay playsInline muted />
              <div className="face-zone" />
            </div>
            <div className="terminal-status">
              <StatusPill tone={cameraRunning ? 'good' : 'neutral'}>{cameraRunning ? 'continuous scan' : 'camera off'}</StatusPill>
              <span>{readyEmbeddings.length} ready embeddings loaded</span>
              {error ? <span className="form-error">{error}</span> : null}
            </div>
            <div className="toolbar-actions">
              <IconButton className="primary" onClick={() => void saveSession()}><Monitor size={16} />Start/session save</IconButton>
              <IconButton className="success" onClick={() => void startCamera()}><Play size={16} />Start camera</IconButton>
              <IconButton onClick={stopCamera}><Square size={16} />Stop</IconButton>
              <IconButton onClick={() => void closeSession()}><CheckCircle2 size={16} />Close session</IconButton>
            </div>
          </Card>

          <aside className="attendance-side-panel">
            <Card>
              <div className="section-title"><div><p className="eyebrow">Marked</p><h2>{records.length} / {students.length}</h2></div><IconButton onClick={exportSheet}><Download size={16} />Download</IconButton></div>
              <div className="marked-list">
                {records.map((record) => (
                  <article key={record.id}>
                    <strong>{record.student_name}</strong>
                    <StatusPill tone={record.status === 'present' ? 'good' : record.status === 'absent' ? 'danger' : 'warn'}>{record.status.replace('_', ' ')}</StatusPill>
                    <small>{confidenceLabel(record.confidence)} · {record.source}</small>
                  </article>
                ))}
              </div>
            </Card>

            <Card>
              <div className="section-title"><div><p className="eyebrow">Manual</p><h2>Quick mark</h2></div><UserCheck size={20} /></div>
              <label>Student<select value={selectedStudent?.id ?? ''} onChange={(event) => setSelectedStudentId(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.student_id} - {student.full_name}</option>)}</select></label>
              <div className="manual-button-grid">
                <IconButton className="success" onClick={() => void markManual('present')}>P Present</IconButton>
                <IconButton onClick={() => void markManual('absent')}>A Absent</IconButton>
                <IconButton onClick={() => void markManual('late')}>Late</IconButton>
                <IconButton onClick={() => void markManual('excused')}>Excused</IconButton>
              </div>
              <p className="muted-copy">Keyboard: select a student, press <b>P</b> for present or <b>A</b> for absent.</p>
            </Card>

            <Card>
              <div className="section-title"><div><p className="eyebrow">Past/bulk</p><h2>CSV attendance</h2></div><FileUp size={20} /></div>
              <label className="file-picker"><FileUp size={17} />Upload CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void readCsvFile(event)} /></label>
              <textarea value={manualCsv} onChange={(event) => setManualCsv(event.target.value)} aria-label="Attendance CSV import" />
              <IconButton className="primary" onClick={() => void importAttendance()}><FileUp size={16} />Import to session</IconButton>
            </Card>
          </aside>
        </div>
      </OnlineGate>
    </>
  )
}
