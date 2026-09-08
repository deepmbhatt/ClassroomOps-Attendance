import { Cpu, Gauge, Play, RotateCcw, ShieldCheck, Wand2 } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Card, EmptyState, IconButton, PageHeader, StatusPill } from '../components/Layout'
import {
  claimNextEnrollment,
  completeEnrollmentProcessing,
  downloadFaceFrame,
  failEnrollmentProcessing,
  loadAppData,
  loadEnrollmentFrames,
} from '../lib/api'
import { detectFaceRegions, refineFaceRegionLandmarks, selectPrimaryFace } from '../lib/faceDetection'
import type { ComputeMode } from '../lib/faceEngine'
import { buildEmbeddingTemplate, createEmbeddingCandidatesFromCanvas, currentModelVersion, currentPipelineVersion, getAvailableComputeModes, isEmbeddingCompatible, preloadFaceEngine } from '../lib/faceEngine'

type ClaimedJob = Awaited<ReturnType<typeof claimNextEnrollment>>

function processingErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

export function BiometricProcessing() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [mode, setMode] = useState<ComputeMode>('cpu')
  const [claimed, setClaimed] = useState('')
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')
  const queued = data?.enrollments.filter((item) => item.state === 'queued') ?? []
  const processingJobs = data?.enrollments.filter((item) => item.state === 'processing') ?? []
  const actionableJobs = queued.length + processingJobs.length
  const readyJobs = data?.enrollments.filter((item) => item.state === 'ready') ?? []
  const compatibleStudents = new Set((data?.embeddings ?? []).filter(isEmbeddingCompatible).map((item) => item.student_id))
  const ready = readyJobs.filter((item) => compatibleStudents.has(item.student_id)).length
  const needsReprocessing = readyJobs.length - ready
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

  async function processClaimedJob(job: ClaimedJob) {
    if (!job?.id || !job.student_id) return false
    setClaimed(job.id)
    const frames = await loadEnrollmentFrames(job.id)
    if (frames.length < 2) {
      await failEnrollmentProcessing(job.id, 'At least two submitted frames are required.')
      return false
    }

    await preloadFaceEngine(mode)

    const embeddings = []
    const qualityMessages = []
    let modelVersion = currentModelVersion
    let pipelineVersion = currentPipelineVersion

    for (const frame of frames) {
      const canvas = await blobToCanvas(await downloadFaceFrame(frame.storage_path))
      const regions = await detectFaceRegions(canvas)
      const primaryFace = selectPrimaryFace(regions, canvas.width, canvas.height)
      if (!primaryFace) {
        qualityMessages.push('A face could not be located in a submitted frame')
        continue
      }
      const refinedFace = await refineFaceRegionLandmarks(canvas, primaryFace)
      const results = await createEmbeddingCandidatesFromCanvas(canvas, mode, refinedFace, 1, 'strict')
      const result = results[0]
      modelVersion = result.modelVersion
      pipelineVersion = result.pipelineVersion
      if (result.quality.ok) embeddings.push(...results.map((candidate) => candidate.vector))
      else qualityMessages.push(...result.quality.messages)
    }

    if (embeddings.length < 2) {
      const details = Array.from(new Set(qualityMessages)).join(', ')
      await failEnrollmentProcessing(job.id, `At least two usable face frames are required.${details ? ` ${details}` : ''}`)
      return false
    }

    await completeEnrollmentProcessing({
      enrollmentId: job.id,
      studentId: job.student_id,
      embedding: buildEmbeddingTemplate(embeddings),
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
      setMessage(processingErrorMessage(error, 'Could not process enrollment'))
    } finally {
      setProcessing(false)
    }
  }

  async function reprocessOne(job: ClaimedJob) {
    setProcessing(true)
    try {
      const ok = await processClaimedJob(job)
      setMessage(ok ? 'Reprocessed this enrollment with the latest face pipeline.' : 'Enrollment moved to quality failed. Check validation message.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(processingErrorMessage(error, 'Could not reprocess enrollment'))
    } finally {
      setProcessing(false)
    }
  }

  async function reprocessIncompatible() {
    const incompatible = readyJobs.filter((item) => !compatibleStudents.has(item.student_id))
    if (!incompatible.length) return
    setProcessing(true)
    let processed = 0
    let failed = 0
    try {
      for (const job of incompatible) {
        setMessage(`Reprocessing ${processed + failed + 1} of ${incompatible.length} enrollments...`)
        const ok = await processClaimedJob(job)
        if (ok) processed += 1
        else failed += 1
      }
      setMessage(`Reprocessing finished. ${processed} ready, ${failed} failed.`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(processingErrorMessage(error, 'Could not reprocess incompatible enrollments'))
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
      setMessage(processingErrorMessage(error, 'Could not process enrollment queue'))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <>
      <PageHeader eyebrow="Face enrollment operations" title="Biometric processing queue">
        Validate student captures and generate recognition embeddings on this administrator computer.
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
          <IconButton disabled={!needsReprocessing || processing} title="Regenerate every older embedding with the current model and alignment pipeline" onClick={() => void reprocessIncompatible()}>
            <RotateCcw size={16} />
            Reprocess incompatible
          </IconButton>
        </div>
        {message ? <p className="notice">{message}</p> : null}
        {needsReprocessing ? <p className="notice warning"><b>{needsReprocessing}</b> ready enrollment{needsReprocessing === 1 ? '' : 's'} use an older face pipeline. Use Reprocess incompatible before live recognition.</p> : null}
        {(data?.enrollments ?? []).length ? <div className="table-scroll"><table>
          <thead><tr><th>Student</th><th>Frames</th><th>State</th><th>Lock</th><th>Validation</th><th>Action</th></tr></thead>
          <tbody>
            {(data?.enrollments ?? []).map((job) => (
              <tr key={job.id} className={claimed === job.id ? 'highlight-row' : ''}>
                <td>{job.student_name}</td>
                <td>{job.frame_count}</td>
                <td><StatusPill tone={job.state === 'ready' ? 'good' : job.state.includes('failed') ? 'danger' : 'warn'}>{claimed === job.id && processing ? 'processing' : job.state}</StatusPill></td>
                <td>{claimed === job.id && processing ? workerId : job.lock_owner ?? 'unlocked'}</td>
                <td>{job.failure_reason ?? (job.state === 'ready' && !compatibleStudents.has(job.student_id) ? 'Older embedding pipeline - reprocess required' : 'Face count, lighting, sharpness, pose consistency, embedding write')}</td>
                <td>{job.state === 'ready' ? <IconButton disabled={processing} onClick={() => void reprocessOne(job)}><RotateCcw size={16} />Reprocess</IconButton> : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table></div> : <EmptyState title="Enrollment queue is empty" body="Submitted student face registrations will appear here for processing." icon={<ShieldCheck size={22} />} />}
      </Card>
    </>
  )
}
