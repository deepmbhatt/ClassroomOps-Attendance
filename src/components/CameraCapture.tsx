import { Camera, Check, RotateCcw, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Card, IconButton, StatusPill } from './Layout'

export interface CapturedFrame {
  id: string
  dataUrl: string
  label: string
  width: number
  height: number
}

const prompts = ['Look forward', 'Turn slightly left', 'Turn slightly right']

export function CameraCapture({
  onComplete,
  locked,
}: {
  onComplete(frames: CapturedFrame[]): void
  locked?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [frames, setFrames] = useState<CapturedFrame[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (locked) return
    let active: MediaStream | null = null
    void navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false })
      .then((next) => {
        active = next
        setStream(next)
        if (videoRef.current) videoRef.current.srcObject = next
      })
      .catch(() => setError('Camera permission is required for guided capture.'))
    return () => active?.getTracks().forEach((track) => track.stop())
  }, [locked])

  const nextPrompt = prompts[frames.length] ?? 'Complete'
  const complete = frames.length >= prompts.length

  function capture() {
    const video = videoRef.current
    if (!video || locked || complete) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    setFrames((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        dataUrl: canvas.toDataURL('image/jpeg', 0.84),
        label: prompts[current.length],
        width: canvas.width,
        height: canvas.height,
      },
    ])
  }

  return (
    <Card className="camera-card">
      <div className="camera-stage">
        {error ? (
          <div className="camera-error">
            <ShieldAlert size={38} />
            <p>{error}</p>
          </div>
        ) : (
          <video ref={videoRef} autoPlay playsInline muted />
        )}
        <div className="face-zone" />
      </div>
      <div className="capture-toolbar">
        <div>
          <StatusPill tone={complete ? 'good' : stream ? 'warn' : 'neutral'}>
            {complete ? 'Frames ready' : nextPrompt}
          </StatusPill>
          <small>{frames.length}/3 representative frames</small>
        </div>
        <div className="toolbar-actions">
          <IconButton disabled={locked || frames.length === 0} onClick={() => setFrames([])}>
            <RotateCcw size={16} />
            Reset
          </IconButton>
          <IconButton className="primary" disabled={locked || !stream || complete} onClick={capture}>
            <Camera size={16} />
            Capture
          </IconButton>
          <IconButton className="success" disabled={!complete || locked} onClick={() => onComplete(frames)}>
            <Check size={16} />
            Submit
          </IconButton>
        </div>
      </div>
      <div className="frame-strip">
        {frames.map((frame) => (
          <figure key={frame.id}>
            <img src={frame.dataUrl} alt={frame.label} />
            <figcaption>{frame.label}</figcaption>
          </figure>
        ))}
      </div>
    </Card>
  )
}
