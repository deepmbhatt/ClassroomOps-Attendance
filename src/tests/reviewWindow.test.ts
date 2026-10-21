import { describe, expect, it } from 'vitest'
import { isReviewWindowOpen } from '../lib/reviewWindow'

describe('review access window', () => {
  const opening = '2026-10-21T10:00:00.000Z'
  const closing = '2026-10-21T10:10:00.000Z'

  it('opens inclusively and closes exactly at the deadline', () => {
    expect(isReviewWindowOpen(opening, closing, Date.parse(opening) - 1)).toBe(false)
    expect(isReviewWindowOpen(opening, closing, Date.parse(opening))).toBe(true)
    expect(isReviewWindowOpen(opening, closing, Date.parse(closing) - 1)).toBe(true)
    expect(isReviewWindowOpen(opening, closing, Date.parse(closing))).toBe(false)
  })

  it('supports unbounded windows and fails closed on invalid dates', () => {
    expect(isReviewWindowOpen(null, null, Date.now())).toBe(true)
    expect(isReviewWindowOpen('not a date', null, Date.now())).toBe(false)
  })
})
