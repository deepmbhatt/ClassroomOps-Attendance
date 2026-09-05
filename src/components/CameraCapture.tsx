import { Camera, Check, RefreshCw, RotateCcw, ShieldAlert, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { attachCameraStream, listVideoInputs, requestCamera, stopCameraStream } from '../lib/camera'
import { detectFaceRegions, preloadFaceDetector } from '../lib/faceDetection'
import { cropFaceCanvas } from '../lib/faceEngine'
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
  const streamRef = useRef<MediaStream | null>(null)
  const attemptRef = useRef(0)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [frames, setFrames] = useState<CapturedFrame[]>([])
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [mirrored, setMirrored] = useState(true)
  const [captureMessage, setCaptureMessage] = useState('')

  useEffect(() => {
    if (!locked) void startCamera()
    return () => stopCamera()
    // Camera startup is intentionally tied to the locked state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked])

  async function startCamera(deviceId = selectedDeviceId) {
    if (locked || starting) return
    const attempt = ++attemptRef.current
    stopCameraStream(streamRef.current)
    streamRef.current = null
    setStream(null)
    setStarting(true)
    setError('')

    try {
      const next = await requestCamera(deviceId || undefined)
      if (attempt !== attemptRef.current) {
        stopCameraStream(next)
        return
      }
      if (!videoRef.current) throw new Error('The camera preview is not ready. Press Retry camera.')
      await attachCameraStream(videoRef.current, next)
      streamRef.current = next
      setStream(next)
      const inputs = await listVideoInputs()
      setDevices(inputs)
      const settings = next.getVideoTracks()[0]?.getSettings()
      const activeDeviceId = settings?.deviceId
      setMirrored(settings?.facingMode !== 'environment')
      if (activeDeviceId) setSelectedDeviceId(activeDeviceId)
      void preloadFaceDetector().catch(() => undefined)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Camera could not start.')
    } finally {
      if (attempt === attemptRef.current) setStarting(false)
    }
  }

  function stopCamera() {
    attemptRef.current += 1
    stopCameraStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStream(null)
    setStarting(false)
  }

  async function changeCamera(deviceId: string) {
    setSelectedDeviceId(deviceId)
    await startCamera(deviceId)
  }

  const nextPrompt = prompts[frames.length] ?? 'Complete'
  const complete = frames.length >= prompts.length

  async function capture() {
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || locked || complete || analyzing) return
    setAnalyzing(true)
    setCaptureMessage('Checking and cropping face...')
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const context = canvas.getContext('2d')
    if (!context) {
      setAnalyzing(false)
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    try {
      const regions = await detectFaceRegions(canvas)
      if (regions.length !== 1) {
        setCaptureMessage(regions.length > 1 ? 'Only one face can be captured.' : 'Face not found yet. Hold steady and capture again.')
        return
      }
      const cropped = cropFaceCanvas(canvas, regions[0])
      setFrames((current) => [...current, {
        id: crypto.randomUUID(),
        dataUrl: cropped.toDataURL('image/jpeg', 0.88),
        label: prompts[current.length],
        width: cropped.width,
        height: cropped.height,
      }])
      setCaptureMessage('Face cropped automatically.')
    } catch {
      setCaptureMessage('Face check is still loading. Hold steady and try capture again.')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <Card className="camera-card">
      <div className="camera-stage">
        <video ref={videoRef} className={mirrored ? 'selfie-preview' : undefined} autoPlay playsInline muted />
        {!stream || error ? (
          <div className="camera-error">
            {error ? <ShieldAlert size={38} /> : <Video size={38} />}
            <p>{error || (starting ? 'Starting webcam...' : 'Camera is off.')}</p>
            {!locked ? <IconButton title="Ask the browser for camera access again" disabled={starting} onClick={() => void startCamera()}><RefreshCw size={16} />{starting ? 'Starting...' : 'Retry camera'}</IconButton> : null}
          </div>
        ) : null}
        {stream ? <div className="face-zone" /> : null}
      </div>

      {devices.length > 1 ? (
        <label className="camera-device-picker">Camera
          <select value={selectedDeviceId} disabled={locked || starting} onChange={(event) => void changeCamera(event.target.value)}>
            {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
          </select>
        </label>
      ) : null}

      <div className="capture-toolbar">
        <div>
          <StatusPill tone={complete ? 'good' : stream ? 'warn' : 'neutral'}>
            {complete ? 'Frames ready' : nextPrompt}
          </StatusPill>
          <small>{frames.length}/3 representative frames</small>
          {captureMessage ? <small className="capture-message" aria-live="polite">{captureMessage}</small> : null}
        </div>
        <div className="toolbar-actions">
          <IconButton disabled={locked || frames.length === 0} onClick={() => setFrames([])}>
            <RotateCcw size={16} />
            Reset
          </IconButton>
          <IconButton className="primary" disabled={locked || !stream || complete || analyzing} onClick={() => void capture()}>
            <Camera size={16} />
            {analyzing ? 'Checking...' : 'Capture'}
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
            <img className={mirrored ? 'selfie-preview' : undefined} src={frame.dataUrl} alt={frame.label} />
            <figcaption>{frame.label}</figcaption>
          </figure>
        ))}
      </div>
    </Card>
  )
}
