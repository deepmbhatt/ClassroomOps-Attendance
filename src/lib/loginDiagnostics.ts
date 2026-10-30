export type LoginDiagnostic = { message: string; code: string; retrySeconds: number }

export function loginDiagnostic(error: unknown): LoginDiagnostic {
  const detail = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (status === 429 || /rate limit|too many requests|over_request_rate_limit/.test(detail)) return {
    message: 'The sign-in service is rate limited. On college Wi-Fi, many students may share one public IP, so a correct password can still fail. Wait a minute, then retry once; ask staff to check Supabase Auth rate limits if it continues.', code: 'AUTH-RATE', retrySeconds: 60,
  }
  if (/invalid login|invalid credentials|incorrect password|student id or password/.test(detail)) return {
    message: 'Student ID or password is incorrect. Check both fields or use Forgot password.', code: 'AUTH-CREDENTIALS', retrySeconds: 0,
  }
  if (/failed to fetch|network|timeout|fetch failed|load failed/.test(detail) || (typeof navigator !== 'undefined' && !navigator.onLine)) return {
    message: 'The college network could not reach the sign-in service. Complete any Wi-Fi sign-in page, then retry. If it continues, try another network or ask staff to allow the service.', code: 'AUTH-NETWORK', retrySeconds: 0,
  }
  if (/storage|device|session|quota|securityerror/.test(detail)) return {
    message: 'This browser could not keep a secure device session. Allow site storage, then retry or contact staff.', code: 'AUTH-DEVICE', retrySeconds: 0,
  }
  if (['PGRST202', 'PGRST205', '42P01', '42703'].includes(code)) return {
    message: 'The database needs an update. Ask staff to apply the latest Supabase migration.', code: 'AUTH-DATABASE', retrySeconds: 0,
  }
  return { message: 'Sign-in could not be completed. Retry once; if it continues, share the diagnostic code with staff.', code: 'AUTH-OTHER', retrySeconds: 0 }
}
