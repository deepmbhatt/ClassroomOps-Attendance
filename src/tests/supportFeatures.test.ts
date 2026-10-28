import { describe, expect, it } from 'vitest'
import { birthdayGreeting } from '../lib/portalNotices'
import { loginDiagnostic } from '../lib/loginDiagnostics'

describe('student support features', () => {
  it('uses the college time zone and the correct age suffix for birthdays', () => {
    expect(birthdayGreeting('2005-10-28', new Date('2026-10-27T20:00:00Z'))).toBe('Happy 21st birthday! Have a great day.')
    expect(birthdayGreeting('2004-10-28', new Date('2026-10-27T20:00:00Z'))).toBe('Happy 22nd birthday! Have a great day.')
    expect(birthdayGreeting('2003-10-28', new Date('2026-10-27T20:00:00Z'))).toBe('Happy 23rd birthday! Have a great day.')
    expect(birthdayGreeting('2005-10-27', new Date('2026-10-27T20:00:00Z'))).toBeNull()
  })

  it('gives a cooldown for rate limits and actionable network guidance', () => {
    expect(loginDiagnostic({ status: 429, message: 'Too many requests' }).retrySeconds).toBe(60)
    expect(loginDiagnostic(new Error('Failed to fetch')).code).toBe('AUTH-NETWORK')
  })
})
