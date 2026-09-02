import type { InferenceSession, Tensor as OrtTensor } from 'onnxruntime-web'
import type { FaceEmbedding } from '../types'
import type { FaceRegion } from './faceDetection'

export type ComputeMode = 'auto' | 'cpu' | 'gpu'

export interface FaceQuality {
  ok: boolean
  score: number
  messages: string[]
}

export interface EmbeddingResult {
  vector: number[]
  modelVersion: string
  pipelineVersion: string
  quality: FaceQuality
  backend: 'wasm' | 'webgpu'
}

const modelPath = import.meta.env.VITE_FACE_EMBEDDING_MODEL as string | undefined
const normalization = (import.meta.env.VITE_FACE_INPUT_NORMALIZATION as string | undefined) === 'zero-one' ? 'zero-one' : 'arcface'
export const currentPipelineVersion = `browser-face-v3-${normalization}-detected-crop`
export const currentModelVersion = modelPath ? `onnx:${modelPath.split('/').pop()}` : 'model-not-configured'

let modelBytesPromise: Promise<ArrayBuffer> | null = null
const sessionPromises = new Map<'wasm' | 'webgpu', Promise<InferenceSession>>()
let ortPromise: Promise<typeof import('onnxruntime-web')> | null = null

function getOrt() {
  ortPromise ??= import('onnxruntime-web')
  return ortPromise
}

export async function getAvailableComputeModes() {
  return {
    cpu: true,
    gpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
  }
}

function getModelBytes() {
  if (!modelPath) {
    throw new Error('Face model is not configured. Add an ArcFace-compatible 112x112 ONNX file and set VITE_FACE_EMBEDDING_MODEL.')
  }
  modelBytesPromise ??= fetch(modelPath).then(async (response) => {
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok) throw new Error(`Model request failed with HTTP ${response.status}`)
    if (contentType.includes('text/html')) throw new Error('Model URL returned HTML instead of an ONNX file')
    const bytes = await response.arrayBuffer()
    const prefix = String.fromCharCode(...new Uint8Array(bytes.slice(0, Math.min(24, bytes.byteLength)))).trimStart()
    if (bytes.byteLength < 1024 || prefix.startsWith('<')) {
      throw new Error('Model URL did not return a valid binary ONNX file')
    }
    return bytes
  }).catch((error) => {
    modelBytesPromise = null
    throw error
  })
  return modelBytesPromise
}

async function getSession(backend: 'wasm' | 'webgpu') {
  let pending = sessionPromises.get(backend)
  if (!pending) {
    pending = Promise.all([getOrt(), getModelBytes()]).then(([ort, bytes]) => ort.InferenceSession.create(bytes, {
      executionProviders: backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    })).catch((error) => {
      sessionPromises.delete(backend)
      throw error
    })
    sessionPromises.set(backend, pending)
  }
  return pending
}

export async function preloadFaceEngine(mode: ComputeMode = 'cpu') {
  const modes = await getAvailableComputeModes()
  const backend = mode === 'gpu' || (mode === 'auto' && modes.gpu) ? 'webgpu' : 'wasm'
  await getSession(backend)
  return { backend, modelVersion: currentModelVersion, pipelineVersion: currentPipelineVersion }
}

export function isEmbeddingCompatible(embedding: Pick<FaceEmbedding, 'model_version' | 'pipeline_version'>) {
  return embedding.model_version === currentModelVersion && embedding.pipeline_version === currentPipelineVersion
}

export function scoreFrame(canvas: HTMLCanvasElement, region?: FaceRegion, faceCount = 1): FaceQuality {
  const messages: string[] = []
  if (faceCount !== 1) messages.push('Exactly one face must be visible')
  if (!region) messages.push('A face could not be located')
  if (region && Math.min(region.width, region.height) < 90) messages.push('Move closer to the camera')

  const crop = region ? paddedSquare(region, canvas.width, canvas.height) : {
    x: 0,
    y: 0,
    size: Math.min(canvas.width, canvas.height),
  }
  const sample = document.createElement('canvas')
  sample.width = 64
  sample.height = 64
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return { ok: false, score: 0, messages: ['Canvas is unavailable'] }
  context.drawImage(canvas, crop.x, crop.y, crop.size, crop.size, 0, 0, 64, 64)
  const pixels = context.getImageData(0, 0, 64, 64).data
  let brightness = 0
  const gray = new Float32Array(64 * 64)
  for (let index = 0; index < gray.length; index += 1) {
    gray[index] = pixels[index * 4] * 0.299 + pixels[index * 4 + 1] * 0.587 + pixels[index * 4 + 2] * 0.114
    brightness += gray[index]
  }
  brightness /= gray.length
  let sharpness = 0
  for (let y = 1; y < 63; y += 1) {
    for (let x = 1; x < 63; x += 1) {
      const index = y * 64 + x
      sharpness += Math.abs(gray[index] - gray[index - 1]) + Math.abs(gray[index] - gray[index - 64])
    }
  }
  sharpness /= 62 * 62 * 2

  if (brightness < 38) messages.push('Lighting is too dark')
  if (brightness > 225) messages.push('Lighting is too bright')
  if (sharpness < 5) messages.push('Hold still; the face image is blurred')

  const sizeScore = region ? Math.min(1, Math.min(region.width, region.height) / 180) : 0
  const lightScore = Math.max(0, 1 - Math.abs(brightness - 130) / 130)
  const sharpScore = Math.min(1, sharpness / 15)
  const score = sizeScore * 0.45 + lightScore * 0.2 + sharpScore * 0.35
  return { ok: messages.length === 0 && score >= 0.48, score, messages }
}

export async function createEmbeddingFromCanvas(
  canvas: HTMLCanvasElement,
  mode: ComputeMode,
  region?: FaceRegion,
  faceCount = region ? 1 : 0,
): Promise<EmbeddingResult> {
  const quality = scoreFrame(canvas, region, faceCount)
  const modes = await getAvailableComputeModes()
  const backend = mode === 'gpu' || (mode === 'auto' && modes.gpu) ? 'webgpu' : 'wasm'

  try {
    const session = await getSession(backend)
    const tensor = await canvasToTensor(canvas, region)
    const output = await session.run({ [session.inputNames[0]]: tensor })
    const first = output[session.outputNames[0]]
    const vector = Array.from(first.data as Float32Array)
    if (!vector.length || vector.some((value) => !Number.isFinite(value))) {
      throw new Error('Model returned an invalid embedding')
    }
    return {
      vector: normalize(vector),
      modelVersion: currentModelVersion,
      pipelineVersion: currentPipelineVersion,
      quality,
      backend,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown model loading error'
    throw new Error(`Could not initialize or run the ONNX face model: ${message}`)
  }
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }
  if (!leftNorm || !rightNorm) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function paddedSquare(region: FaceRegion, maxWidth: number, maxHeight: number) {
  const requested = Math.max(region.width, region.height) * 1.42
  const size = Math.min(requested, maxWidth, maxHeight)
  const centerX = region.x + region.width / 2
  const centerY = region.y + region.height / 2 - region.height * 0.04
  return {
    x: Math.max(0, Math.min(maxWidth - size, centerX - size / 2)),
    y: Math.max(0, Math.min(maxHeight - size, centerY - size / 2)),
    size,
  }
}

async function canvasToTensor(canvas: HTMLCanvasElement, region?: FaceRegion): Promise<OrtTensor> {
  const ort = await getOrt()
  const size = 112
  const work = document.createElement('canvas')
  work.width = size
  work.height = size
  const context = work.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is unavailable')
  const crop = region ? paddedSquare(region, canvas.width, canvas.height) : {
    x: Math.max(0, (canvas.width - Math.min(canvas.width, canvas.height)) / 2),
    y: Math.max(0, (canvas.height - Math.min(canvas.width, canvas.height)) / 2),
    size: Math.min(canvas.width, canvas.height),
  }
  context.drawImage(canvas, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size)
  const pixels = context.getImageData(0, 0, size, size).data
  const data = new Float32Array(3 * size * size)
  for (let index = 0; index < size * size; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = pixels[index * 4 + channel]
      data[channel * size * size + index] = normalization === 'arcface'
        ? (value - 127.5) / 128
        : value / 255
    }
  }
  return new ort.Tensor('float32', data, [1, 3, size, size])
}

export function averageEmbeddings(vectors: number[][]) {
  if (!vectors.length) return []
  const length = Math.min(...vectors.map((vector) => vector.length))
  const averaged = Array.from({ length }, (_, index) => vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length)
  return normalize(averaged)
}

function normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => value / norm)
}
