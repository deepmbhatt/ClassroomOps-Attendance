import { describe, expect, it } from 'vitest'
import { serviceErrorMessage } from '../lib/serviceError'

describe('service error messages', () => {
  it('does not call network or rate failures migration errors', () => {
    expect(serviceErrorMessage(new Error('Failed to fetch'), 'Exam loading')).toContain('could not reach the server')
    expect(serviceErrorMessage({ status: 429, message: 'Too Many Requests' }, 'Exam loading')).toContain('temporarily busy')
    expect(serviceErrorMessage({ code: '42P01', message: 'relation missing' }, 'Exam loading')).toContain('database update')
  })
})
