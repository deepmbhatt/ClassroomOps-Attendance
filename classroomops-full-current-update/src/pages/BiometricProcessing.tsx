import { Cpu, Gauge, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Card, IconButton, PageHeader, StatusPill } from '../components/Layout'
import { claimNextEnrollment, loadAppData } from '../lib/api'
import type { ComputeMode } from '../lib/faceEngine'
import { getAvailableComputeModes } from '../lib/faceEngine'

export function BiometricProcessing() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [mode, setMode] = useState<ComputeMode>('auto')
  const [claimed, setClaimed] = useState('')
  const queued = data?.enrollments.filter((item) => item.state === 'queued') ?? []
  const ready = data?.enrollments.filter((item) => item.state === 'ready').length ?? 0
  const workerId = useMemo(() => `browser-${crypto.randomUUID().slice(0, 8)}`, [])
  const [gpuLabel, setGpuLabel] = useState('Checking GPU')
  const claimJob = useMutation({
    mutationFn: () => claimNextEnrollment(workerId),
    onSuccess: async (job) => {
      if (job?.id) setClaimed(job.id)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    },
  })

  useEffect(() => {
    let mounted = true
    void getAvailableComputeModes().then((modes) => {
      if (mounted) setGpuLabel(modes.gpu ? 'WebGPU available' : 'CPU/WASM only')
    })
    return () => {
      mounted = false
    }
  }, [])

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
              <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>{item.toUpperCase()}</button>
            ))}
          </div>
          <IconButton className="primary" disabled={!queued.length || claimJob.isPending} onClick={() => claimJob.mutate()}>
            <Play size={16} />
            Claim next job
          </IconButton>
          <IconButton><RotateCcw size={16} />Reprocess all v1</IconButton>
        </div>
        {claimJob.error ? <p className="form-error">{claimJob.error instanceof Error ? claimJob.error.message : 'Could not claim enrollment job'}</p> : null}
        <table>
          <thead><tr><th>Student</th><th>Frames</th><th>State</th><th>Lock</th><th>Validation</th></tr></thead>
          <tbody>
            {(data?.enrollments ?? []).map((job) => (
              <tr key={job.id} className={claimed === job.id ? 'highlight-row' : ''}>
                <td>{job.student_name}</td>
                <td>{job.frame_count}</td>
                <td><StatusPill tone={job.state === 'ready' ? 'good' : job.state.includes('failed') ? 'danger' : 'warn'}>{claimed === job.id ? 'processing' : job.state}</StatusPill></td>
                <td>{claimed === job.id ? workerId : job.lock_owner ?? 'unlocked'}</td>
                <td>{job.failure_reason ?? 'Face count, size, pose consistency, embedding write'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}
