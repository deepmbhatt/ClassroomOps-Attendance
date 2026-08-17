import { Lock, ShieldCheck } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { CameraCapture, type CapturedFrame } from '../components/CameraCapture'
import { Card, PageHeader, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'
import { isEnrollmentLocked } from '../lib/enrollmentState'

export function FaceRegistration() {
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [consented, setConsented] = useState(false)
  const [submitted, setSubmitted] = useState<CapturedFrame[]>([])
  const student = data?.profiles.find((profile) => profile.role === 'student')
  const enrollment = data?.enrollments.find((item) => item.student_id === student?.id)
  const locked = Boolean(enrollment && isEnrollmentLocked(enrollment.state)) || submitted.length > 0

  return (
    <>
      <PageHeader eyebrow="Biometric enrollment" title="Guided face registration">
        Capture three representative frames after explicit consent. Repeated clicks and refreshes are locked by UI state and database uniqueness.
      </PageHeader>
      <div className="two-column">
        <Card>
          <div className="section-title"><div><p className="eyebrow">State machine</p><h2>Current status</h2></div><StatusPill tone={enrollment?.state === 'ready' ? 'good' : 'warn'}>{submitted.length ? 'queued' : enrollment?.state ?? 'not started'}</StatusPill></div>
          <ol className="timeline">
            {['Not Started', 'Capturing', 'Uploading', 'Queued', 'Processing', 'Ready'].map((item, index) => (
              <li key={item} className={index <= (submitted.length ? 3 : 0) ? 'done' : ''}>{item}</li>
            ))}
          </ol>
          <label className="consent-box">
            <input type="checkbox" checked={consented} disabled={locked} onChange={(event) => setConsented(event.target.checked)} />
            <span>I consent to private storage of selected face frames for attendance enrollment and future model reprocessing.</span>
          </label>
          {locked ? <p className="notice"><Lock size={16} /> Face registration is locked once upload is queued or ready.</p> : null}
        </Card>
        {consented || locked ? (
          <CameraCapture locked={locked} onComplete={(frames) => setSubmitted(frames)} />
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
