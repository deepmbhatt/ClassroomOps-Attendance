export function cameraErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access is blocked. Allow camera permission for this site in the browser address bar, then press Retry camera.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No webcam was found. Connect or enable a camera, then press Retry camera.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'The webcam is busy or unavailable. Close Zoom, Meet, Teams, or other camera apps, then press Retry camera.'
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'This webcam does not support the requested video mode. Select another camera or retry with the compatibility mode.'
  }
  return error instanceof Error && error.message
    ? `Camera could not start: ${error.message}`
    : 'Camera could not start. Check browser permission and try again.'
}

export async function requestCamera(deviceId?: string) {
  if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    throw new Error('Camera access requires HTTPS. Open the deployed HTTPS address or use localhost.')
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not provide webcam access. Use a current version of Chrome, Edge, Firefox, or Safari.')
  }

  const preferred: MediaStreamConstraints = {
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'user' } }),
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 24, max: 30 },
    },
    audio: false,
  }

  try {
    return await navigator.mediaDevices.getUserMedia(preferred)
  } catch (error) {
    const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : ''
    if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError') {
      throw new Error(cameraErrorMessage(error))
    }
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    } catch (fallbackError) {
      throw new Error(cameraErrorMessage(fallbackError))
    }
  }
}

export async function attachCameraStream(video: HTMLVideoElement, stream: MediaStream) {
  video.srcObject = stream
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('The webcam opened but did not provide video.')), 8000)
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout)
        resolve()
      }
    })
  }
  await video.play()
}

export async function listVideoInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === 'videoinput')
  } catch {
    return []
  }
}

export function stopCameraStream(stream?: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}
