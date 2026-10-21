export function isReviewWindowOpen(from: string | null, until: string | null, now: number) {
  const opening = from ? Date.parse(from) : -Infinity
  const closing = until ? Date.parse(until) : Infinity
  if (Number.isNaN(opening) || Number.isNaN(closing)) return false
  return now >= opening && now < closing
}
