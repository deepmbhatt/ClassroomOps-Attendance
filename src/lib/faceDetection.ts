export interface FaceRegion {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

type NativeDetection = { boundingBox?: { x: number; y: number; width: number; height: number } }
type NativeDetector = { detect(source: CanvasImageSource): Promise<NativeDetection[]> }
type NativeDetectorCtor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => NativeDetector

const detectorModel = (import.meta.env.VITE_FACE_DETECTOR_MODEL as string | undefined)
  ?? 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite'
const visionWasm = (import.meta.env.VITE_MEDIAPIPE_WASM_PATH as string | undefined)
  ?? 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'

const configuredDetectionConfidence = Number(import.meta.env.VITE_FACE_DETECTION_CONFIDENCE ?? 0.45)
const detectionConfidence = Number.isFinite(configuredDetectionConfidence)
  ? Math.min(0.9, Math.max(0.25, configuredDetectionConfidence))
  : 0.45

let nativeDetector: NativeDetector | null | undefined
let mediaPipeDetectorPromise: Promise<import('@mediapipe/tasks-vision').FaceDetector> | null = null

function getNativeDetector() {
  if (nativeDetector !== undefined) return nativeDetector
  const constructor = (globalThis as typeof globalThis & { FaceDetector?: NativeDetectorCtor }).FaceDetector
  nativeDetector = constructor ? new constructor({ fastMode: true, maxDetectedFaces: 2 }) : null
  return nativeDetector
}

async function getMediaPipeDetector() {
  if (!mediaPipeDetectorPromise) {
    mediaPipeDetectorPromise = import('@mediapipe/tasks-vision').then(async ({ FaceDetector, FilesetResolver }) => {
      const files = await FilesetResolver.forVisionTasks(visionWasm)
      return FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: detectorModel, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: detectionConfidence,
        minSuppressionThreshold: 0.3,
      })
    }).catch((error) => {
      mediaPipeDetectorPromise = null
      throw error
    })
  }
  return mediaPipeDetectorPromise
}

export async function preloadFaceDetector() {
  if (getNativeDetector()) return 'Browser face detector'
  await getMediaPipeDetector()
  return 'MediaPipe face detector'
}

export async function detectFaceRegions(source: HTMLCanvasElement): Promise<FaceRegion[]> {
  const native = getNativeDetector()
  if (native) {
    try {
      const results = await native.detect(source)
      return results.flatMap((result) => result.boundingBox ? [{
        x: result.boundingBox.x,
        y: result.boundingBox.y,
        width: result.boundingBox.width,
        height: result.boundingBox.height,
        confidence: 1,
      }] : [])
    } catch {
      nativeDetector = null
    }
  }

  const detector = await getMediaPipeDetector()
  return detector.detect(source).detections.flatMap((detection) => {
    const box = detection.boundingBox
    if (!box) return []
    return [{
      x: box.originX,
      y: box.originY,
      width: box.width,
      height: box.height,
      confidence: detection.categories[0]?.score ?? 0,
    }]
  })
}
