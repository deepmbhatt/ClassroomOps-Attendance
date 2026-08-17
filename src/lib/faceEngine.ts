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
  backend: 'wasm' | 'webgpu' | 'mock'
}

const modelPath = import.meta.env.VITE_FACE_EMBEDDING_MODEL as string | undefined
const pipelineVersion = 'browser-face-v1'
const modelVersion = modelPath ? `onnx:${modelPath.split('/').pop()}` : 'demo-deterministic-v1'

export async function getAvailableComputeModes() {
  return {
    cpu: true,
    gpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
  }
}

export function scoreFrame(width: number, height: number, faceCount = 1): FaceQuality {
  const messages: string[] = []
  if (faceCount !== 1) messages.push('Exactly one face must be visible')
  if (width < 240 || height < 240) messages.push('Move closer to the camera')
  const score = Math.min(1, Math.min(width, height) / 420) - Math.max(0, faceCount - 1) * 0.25
  return { ok: messages.length === 0 && score >= 0.55, score: Math.max(0, score), messages }
}

export async function createEmbeddingFromCanvas(canvas: HTMLCanvasElement, mode: ComputeMode): Promise<EmbeddingResult> {
  const quality = scoreFrame(canvas.width, canvas.height)
  const modes = await getAvailableComputeModes()
  const backend = mode === 'gpu' || (mode === 'auto' && modes.gpu) ? 'webgpu' : 'wasm'

  if (modelPath) {
    const ort = await import('onnxruntime-web')
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    })
    const inputName = session.inputNames[0]
    const tensor = await canvasToTensor(canvas)
    const output = await session.run({ [inputName]: tensor })
    const first = output[session.outputNames[0]]
    const vector = Array.from(first.data as Float32Array)
    return { vector: normalize(vector), modelVersion, pipelineVersion, quality, backend }
  }

  return {
    vector: deterministicCanvasEmbedding(canvas),
    modelVersion,
    pipelineVersion,
    quality,
    backend: 'mock',
  }
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length)
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }
  if (!leftNorm || !rightNorm) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

async function canvasToTensor(canvas: HTMLCanvasElement) {
  const ort = await import('onnxruntime-web')
  const size = 112
  const work = document.createElement('canvas')
  work.width = size
  work.height = size
  const context = work.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(canvas, 0, 0, size, size)
  const pixels = context.getImageData(0, 0, size, size).data
  const data = new Float32Array(1 * 3 * size * size)
  for (let index = 0; index < size * size; index += 1) {
    data[index] = pixels[index * 4] / 255
    data[size * size + index] = pixels[index * 4 + 1] / 255
    data[size * size * 2 + index] = pixels[index * 4 + 2] / 255
  }
  return new ort.Tensor('float32', data, [1, 3, size, size])
}

function deterministicCanvasEmbedding(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return normalize(Array.from({ length: 64 }, (_, index) => Math.sin(index)))
  const { data } = context.getImageData(0, 0, Math.min(canvas.width, 64), Math.min(canvas.height, 64))
  const vector = Array.from({ length: 64 }, (_, index) => {
    let acc = 0
    for (let offset = index * 4; offset < data.length; offset += 64 * 4) {
      acc += data[offset] ?? 0
    }
    return acc / 255
  })
  return normalize(vector)
}

function normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => value / norm)
}
