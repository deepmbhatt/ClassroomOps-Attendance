import { Cpu, Gauge, Play, RotateCcw, ShieldCheck, Wand2 } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Card, IconButton, PageHeader, StatusPill } from '../components/Layout'
import {
  claimNextEnrollment,
  completeEnrollmentProcessing,
  downloadFaceFrame,
  failEnrollmentProcessing,
  loadAppData,
  loadEnrollmentFrames,
} from '../lib/api'
import type { ComputeMode } from '../lib/faceEngine'
import { createEmbeddingFromCanvas, getAvailableComputeModes } from '../lib/faceEngine'

type ClaimedJob = Awaited<ReturnType<typeof claimNextEnrollment>>

export function BiometricProcessing() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [mode, setMode] = useState<ComputeMode>('auto')
  const [claimed, setClaimed] = useState('')
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')
  const queued = data?.enrollments.filter((item) => item.state === 'queued') ?? []
  const processingJobs = data?.enrollments.filter((item) => item.state === 'processing') ?? []
  const actionableJobs = queued.length + processingJobs.length
  const ready = data?.enrollments.filter((item) => item.state === 'ready').length ?? 0
  const workerId = useMemo(() => `browser-${crypto.randomUUID().slice(0, 8)}`, [])
  const [gpuLabel, setGpuLabel] = useState('Checking GPU')

  useEffect(() => {
    let mounted = true
    void getAvailableComputeModes().then((modes) => {
      if (mounted) setGpuLabel(modes.gpu ? 'WebGPU available' : 'CPU/WASM only')
    })
    return () => {
      mounted = false
    }
  }, [])

  async function blobToCanvas(blob: Blob) {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable in this browser')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return canvas
  }

  function averageVectors(vectors: number[][]) {
    const length = Math.min(...vectors.map((vector) => vector.length))
    const averaged = Array.from({ length }, (_, index) => vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length)
    const norm = Math.sqrt(averaged.reduce((sum, value) => sum + value * value, 0)) || 1
    return averaged.map((value) => value / norm)
  }

  async function processClaimedJob(job: ClaimedJob) {
    if (!job?.id || !job.student_id) return false
    setClaimed(job.id)
    const frames = await loadEnrollmentFrames(job.id)
    if (frames.length < 3) {
      await failEnrollmentProcessing(job.id, 'At least three submitted frames are required.')
      return false
    }

    const embeddings = []
    const qualityMessages = []
    let modelVersion = 'demo-deterministic-v1'
    let pipelineVersion = 'browser-face-v1'

    for (const frame of frames) {
      const canvas = await blobToCanvas(await downloadFaceFrame(frame.storage_path))
      const result = await createEmbeddingFromCanvas(canvas, mode)
      modelVersion = result.modelVersion
      pipelineVersion = result.pipelineVersion
      if (!result.quality.ok) qualityMessages.push(...result.quality.messages)
      embeddings.push(result.vector)
    }

    if (qualityMessages.length) {
      await failEnrollmentProcessing(job.id, Array.from(new Set(qualityMessages)).join(', '))
      return false
    }

    await completeEnrollmentProcessing({
      enrollmentId: job.id,
      studentId: job.student_id,
      embedding: averageVectors(embeddings),
      modelVersion,
      pipelineVersion,
      sourceFrameIds: frames.map((frame) => frame.id),
    })
    return true
  }

  async function processNext() {
    setProcessing(true)
    setMessage('Preparing next enrollment job...')
    try {
      const job = processingJobs[0] ?? await claimNextEnrollment(workerId)
      if (!job?.id) {
        setMessage('No queued or processing enrollment jobs are available.')
        return
      }
      const ok = await processClaimedJob(job)
      setMessage(ok ? 'Processed 1 enrollment and marked it ready.' : 'Enrollment moved to quality failed. Check validation message.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not process enrollment')
    } finally {
      setProcessing(false)
    }
  }

  async function processAll() {
    setProcessing(true)
    let processed = 0
    let failed = 0
    try {
      for (const existingJob of processingJobs) {
        setMessage(`Processed ${processed}, failed ${failed}. Finishing already-claimed job...`)
        const ok = await processClaimedJob(existingJob)
        if (ok) processed += 1
        else failed += 1
      }

      while (true) {
        setMessage(`Processed ${processed}, failed ${failed}. Claiming next queued job...`)
        const job = await claimNextEnrollment(workerId)
        if (!job?.id) break
        const ok = await processClaimedJob(job)
        if (ok) processed += 1
        else failed += 1
      }
      setMessage(`Finished queue. ${processed} ready, ${failed} failed.`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not process enrollment queue')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <>
      <PageHeader eyebrow="Admin-only compute" title="Biometric processing">
        This page temporarily uses the admin computer CPU/WebGPU. Student devices never generate embeddings.
      </PageHeader>
      <div className="kpi-grid three">
        <Card className="kpi"><span><Cpu size={20} /></span><small>Worker</small><strong>{workerId}</strong></Card>
        <Card className="kpi"><span><Gauge size={20} /></span><small>Hardware</small><strong>{gpuLabel}</strong></Card>
        <Card className="kpi"><span><ShieldCheck size={20} /></span><small>Ready embeddings</small><strong>{ready}</strong></Card>
      </div>
      <Card>
        <div className="processing-toolbar">
          <div className="segmented">
            {(['auto', 'cpu', 'gpu'] as ComputeMode[]).map((item) => (
              <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)} disabled={processing}>{item.toUpperCase()}</button>
            ))}
          </div>
          <IconButton className="primary" disabled={!actionableJobs || processing} onClick={() => void processNext()}>
            <Play size={16} />
            Process next job
          </IconButton>
          <IconButton className="success" disabled={!actionableJobs || processing} onClick={() => void processAll()}>
            <Wand2 size={16} />
            Process all queued
          </IconButton>
          <IconButton disabled={processing}><RotateCcw size={16} />Reprocess all v1</IconButton>
        </div>
        {message ? <p className="notice">{message}</p> : null}
        <table>
          <thead><tr><th>Student</th><th>Frames</th><th>State</th><th>Lock</th><th>Validation</th></tr></thead>
          <tbody>
            {(data?.enrollments ?? []).map((job) => (
              <tr key={job.id} className={claimed === job.id ? 'highlight-row' : ''}>
                <td>{job.student_name}</td>
                <td>{job.frame_count}</td>
                <td><StatusPill tone={job.state === 'ready' ? 'good' : job.state.includes('failed') ? 'danger' : 'warn'}>{claimed === job.id && processing ? 'processing' : job.state}</StatusPill></td>
                <td>{claimed === job.id && processing ? workerId : job.lock_owner ?? 'unlocked'}</td>
                <td>{job.failure_reason ?? 'Face count, size, pose consistency, embedding write'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}
