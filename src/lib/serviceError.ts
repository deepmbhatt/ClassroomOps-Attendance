export function serviceErrorMessage(error: unknown, action: string) {
  const detail = error instanceof Error ? error.message : String(error ?? '')
  const lower = detail.toLowerCase()
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (status === 429 || /rate limit|too many requests/.test(lower)) return `${action} is temporarily busy. Wait a minute, then retry once. Ask staff to check service rate limits if many students are affected.`
  if (/failed to fetch|fetch failed|network|timeout|load failed/.test(lower) || (typeof navigator !== 'undefined' && !navigator.onLine)) return `${action} could not reach the server. Check the college Wi-Fi sign-in page or try another network, then retry.`
  if (['42P01', '42703', 'PGRST202', 'PGRST205'].includes(code) || /schema cache|relation .* does not exist|function .* does not exist/.test(lower)) return `${action} needs a database update. Ask staff to apply the latest Supabase migration.`
  return `${action} failed. Retry once; if it continues, contact staff${code ? ` with error code ${code}` : ''}.`
}
