import { describe, expect, it } from 'vitest'
import { isMobileExamDevice, minimumExamKbps } from '../lib/examPreflight'

describe('exam preflight', () => {
  it('requires at least 250 kilobits per second', () => {
    expect(minimumExamKbps).toBe(250)
  })

  it('rejects common phone and tablet signatures', () => {
    expect(isMobileExamDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true)
    expect(isMobileExamDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', 5)).toBe(true)
    expect(isMobileExamDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit', 5)).toBe(true)
  })

  it('allows common desktop signatures', () => {
    expect(isMobileExamDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 0)).toBe(false)
    expect(isMobileExamDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe(false)
  })
})
