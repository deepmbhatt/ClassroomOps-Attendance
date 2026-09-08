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
  nose?: FacePoint
  mouth?: FacePoint
  mouthLeft?: FacePoint
  mouthRight?: FacePoint
}

const detectorModel = (import.meta.env.VITE_FACE_DETECTOR_MODEL as string | undefined)
  ?? 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite'
const visionWasm = (import.meta.env.VITE_MEDIAPIPE_WASM_PATH as string | undefined)
  ?? 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'

const configuredDetectionConfidence = Number(import.meta.env.VITE_FACE_DETECTION_CONFIDENCE ?? 0.45)
const detectionConfidence = Number.isFinite(configuredDetectionConfidence)
  ? Math.min(0.9, Math.max(0.25, configuredDetectionConfidence))
  : 0.45

let mediaPipeDetectorPromise: Promise<import('@mediapipe/tasks-vision').FaceDetector> | null = null
let mediaPipeLandmarkerPromise: Promise<import('@mediapipe/tasks-vision').FaceLandmarker> | null = null

const landmarkerModel = (import.meta.env.VITE_FACE_LANDMARKER_MODEL as string | undefined)
  ?? 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'

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

async function getMediaPipeLandmarker() {
  if (!mediaPipeLandmarkerPromise) {
    mediaPipeLandmarkerPromise = import('@mediapipe/tasks-vision').then(async ({ FaceLandmarker, FilesetResolver }) => {
      const files = await FilesetResolver.forVisionTasks(visionWasm)
      return FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: landmarkerModel, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 4,
        minFaceDetectionConfidence: detectionConfidence,
        minFacePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      })
    }).catch((error) => {
      mediaPipeLandmarkerPromise = null
      throw error
    })
  }
  return mediaPipeLandmarkerPromise
}

export async function preloadFaceDetector() {
  await getMediaPipeDetector()
  return 'MediaPipe face detector'
}

function averageLandmarks(
  landmarks: Array<{ x: number; y: number }>,
  indices: number[],
  width: number,
  height: number,
) {
  const points = indices.map((index) => landmarks[index]).filter(Boolean)
  if (!points.length) return undefined
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) * width / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) * height / points.length,
  }
}

/** Adds the five stable landmarks expected by ArcFace/SFace only when an embedding is needed. */
export async function refineFaceRegionLandmarks(source: HTMLCanvasElement, region: FaceRegion) {
  try {
    const landmarker = await getMediaPipeLandmarker()
    const candidates = landmarker.detect(source).faceLandmarks
    if (!candidates.length) return region
    const targetX = region.x + region.width / 2
    const targetY = region.y + region.height / 2
    const landmarks = [...candidates].sort((left, right) => {
      const center = (points: Array<{ x: number; y: number }>) => ({
        x: points.reduce((sum, point) => sum + point.x, 0) * source.width / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) * source.height / points.length,
      })
      const leftCenter = center(left)
      const rightCenter = center(right)
      return Math.hypot(leftCenter.x - targetX, leftCenter.y - targetY)
        - Math.hypot(rightCenter.x - targetX, rightCenter.y - targetY)
    })[0]
    if (!landmarks) return region

    const eyes = [
      averageLandmarks(landmarks, [33, 133, 159, 145], source.width, source.height),
      averageLandmarks(landmarks, [362, 263, 386, 374], source.width, source.height),
    ].filter((point): point is FacePoint => Boolean(point)).sort((left, right) => left.x - right.x)
    const mouths = [
      averageLandmarks(landmarks, [61], source.width, source.height),
      averageLandmarks(landmarks, [291], source.width, source.height),
    ].filter((point): point is FacePoint => Boolean(point)).sort((left, right) => left.x - right.x)

    if (eyes.length !== 2 || mouths.length !== 2) return region
    return {
      ...region,
      leftEye: eyes[0],
      rightEye: eyes[1],
      nose: averageLandmarks(landmarks, [1, 4], source.width, source.height) ?? region.nose,
      mouthLeft: mouths[0],
      mouthRight: mouths[1],
      mouth: averageLandmarks(landmarks, [13, 14], source.width, source.height) ?? region.mouth,
    }
  } catch {
    return region
  }
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
  const detector = await getMediaPipeDetector()
  return detector.detect(source).detections.flatMap((detection) => {
    const box = detection.boundingBox
    if (!box) return []
    const rightEye = detection.keypoints[0]
    const leftEye = detection.keypoints[1]
    const nose = detection.keypoints[2]
    const mouth = detection.keypoints[3]
    return [{
      x: box.originX,
      y: box.originY,
      width: box.width,
      height: box.height,
      confidence: detection.categories[0]?.score ?? 0,
      leftEye: leftEye ? { x: leftEye.x * source.width, y: leftEye.y * source.height } : undefined,
      rightEye: rightEye ? { x: rightEye.x * source.width, y: rightEye.y * source.height } : undefined,
      nose: nose ? { x: nose.x * source.width, y: nose.y * source.height } : undefined,
      mouth: mouth ? { x: mouth.x * source.width, y: mouth.y * source.height } : undefined,
    }]
  })
}
