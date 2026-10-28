export type LoginDiagnostic = { message: string; code: string; retrySeconds: number }

export function loginDiagnostic(error: unknown): LoginDiagnostic {
  const detail = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
  if (status === 429 || /rate limit|too many requests|over_request_rate_limit/.test(detail)) return {
    message: 'Too many sign-in attempts were received. Wait about a minute before trying again. Repeated retries can extend the wait.', code: 'AUTH-RATE', retrySeconds: 60,
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
  return { message: 'Sign-in could not be completed. Retry once; if it continues, share the diagnostic code with staff.', code: 'AUTH-OTHER', retrySeconds: 0 }
}
