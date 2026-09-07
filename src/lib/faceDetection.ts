export interface FacePoint {
  x: number
  y: number
}

export interface FaceRegion {
  x: number
  y: number
  width: number
  height: number
  confidence: number
  leftEye?: FacePoint
  rightEye?: FacePoint
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

export function selectPrimaryFace(regions: FaceRegion[], width: number, height: number) {
  if (!regions.length || width <= 0 || height <= 0) return undefined
  const centerX = width / 2
  const centerY = height / 2
  return [...regions].sort((left, right) => {
    const score = (region: FaceRegion) => {
      const area = Math.max(0, region.width * region.height)
      const regionCenterX = region.x + region.width / 2
      const regionCenterY = region.y + region.height / 2
      const distance = Math.hypot((regionCenterX - centerX) / width, (regionCenterY - centerY) / height)
      const centerWeight = 1.25 - Math.min(1, distance) * 0.35
      const confidenceWeight = 0.85 + Math.max(0, Math.min(1, region.confidence)) * 0.15
      return area * centerWeight * confidenceWeight
    }
    return score(right) - score(left)
  })[0]
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
    const rightEye = detection.keypoints[0]
    const leftEye = detection.keypoints[1]
    return [{
      x: box.originX,
      y: box.originY,
      width: box.width,
      height: box.height,
      confidence: detection.categories[0]?.score ?? 0,
      leftEye: leftEye ? { x: leftEye.x * source.width, y: leftEye.y * source.height } : undefined,
      rightEye: rightEye ? { x: rightEye.x * source.width, y: rightEye.y * source.height } : undefined,
    }]
  })
}
