import { AlertTriangle, Lock, ShieldCheck } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '../auth'
import { CameraCapture, type CapturedFrame } from '../components/CameraCapture'
import { Card, PageHeader, Spinner, StatusPill } from '../components/Layout'
import { loadAppData, submitFaceEnrollment } from '../lib/api'
import { isEnrollmentLocked } from '../lib/enrollmentState'

export function FaceRegistration() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [consented, setConsented] = useState(false)
  const student = data?.profiles.find((profile) => profile.id === auth.session?.user.id)
  const enrollment = data?.enrollments.find((item) => item.student_id === student?.id)
  const locked = Boolean(enrollment && isEnrollmentLocked(enrollment.state))
  const submitEnrollment = useMutation({
    mutationFn: (frames: CapturedFrame[]) => submitFaceEnrollment(frames),
    onSuccess: async () => {
      setConsented(false)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    },
  })

  if (isLoading) return <Spinner />

  if (!student) {
    return (
      <Card className="permission-card">
        <AlertTriangle size={42} />
        <h2>Student profile not ready</h2>
        <p>Your account is signed in, but your profile row is not visible yet. Refresh once or ask the admin to confirm your profile exists.</p>
      </Card>
    )
  }

  const currentState = submitEnrollment.isPending ? 'uploading' : enrollment?.state ?? 'not_started'
  const stepIndex = ['not_started', 'capturing', 'uploading', 'queued', 'processing', 'ready'].indexOf(currentState)

  return (
    <>
      <PageHeader eyebrow="Biometric enrollment" title="Guided face registration">
        Capture three representative frames after explicit consent. Once submitted, the enrollment remains queued even if you go back or refresh.
      </PageHeader>
      <div className="two-column">
        <Card>
          <div className="section-title">
            <div><p className="eyebrow">State machine</p><h2>Current status</h2></div>
            <StatusPill tone={currentState === 'ready' ? 'good' : currentState.includes('failed') ? 'danger' : 'warn'}>{currentState.replace('_', ' ')}</StatusPill>
          </div>
          <ol className="timeline">
            {['Not Started', 'Capturing', 'Uploading', 'Queued', 'Processing', 'Ready'].map((item, index) => (
              <li key={item} className={index <= Math.max(stepIndex, 0) ? 'done' : ''}>{item}</li>
            ))}
          </ol>
          <label className="consent-box">
            <input type="checkbox" checked={consented || locked} disabled={locked || submitEnrollment.isPending} onChange={(event) => setConsented(event.target.checked)} />
            <span>I consent to private storage of selected face frames for attendance enrollment and future model reprocessing.</span>
          </label>
          {locked ? <p className="notice"><Lock size={16} /> Face registration is locked because upload is queued, processing, or ready.</p> : null}
          {submitEnrollment.error ? <p className="form-error">{submitEnrollment.error instanceof Error ? submitEnrollment.error.message : 'Could not submit face enrollment'}</p> : null}
        </Card>
        {consented || locked || submitEnrollment.isPending ? (
          <CameraCapture locked={locked || submitEnrollment.isPending} onComplete={(frames) => submitEnrollment.mutate(frames)} />
        ) : (
          <Card className="permission-card">
            <ShieldCheck size={42} />
            <h2>Consent required</h2>
            <p>Enable the consent checkbox before the camera opens.</p>
          </Card>
        )}
      </div>
    </>
  )
}
