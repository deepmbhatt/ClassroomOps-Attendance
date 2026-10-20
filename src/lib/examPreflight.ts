export const minimumExamKbps = 500

export function isMobileExamDevice(userAgent = navigator.userAgent, touchPoints = navigator.maxTouchPoints) {
  return /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && touchPoints > 1)
}

export async function measureExamDownloadKbps() {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12000)
  const started = performance.now()
  try {
    // Range caps transfer size; the stream is also cancelled if the host ignores Range.
    const response = await fetch(`/exam-speed-probe.txt?exam-speed=${Date.now()}`, {
      cache: 'no-store', headers: { Range: 'bytes=0-131071' }, signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error('Could not measure the connection. Check your internet and retry.')
    const reader = response.body.getReader()
    let bytes = 0
    try {
      while (bytes < 131072) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
      }
    } finally { void reader.cancel().catch(() => {}) }
    if (bytes < 32768) throw new Error('The speed test received too little data. Retry on a stable connection.')
    return Math.round((bytes * 8) / Math.max(1, performance.now() - started))
  } finally { window.clearTimeout(timeout); controller.abort() }
}
