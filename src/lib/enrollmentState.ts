import type { EnrollmentState } from '../types'

const transitions: Record<EnrollmentState, EnrollmentState[]> = {
  not_started: ['capturing'],
  capturing: ['uploading', 'upload_failed'],
  uploading: ['queued', 'upload_failed'],
  queued: ['processing', 'quality_failed'],
  processing: ['ready', 'quality_failed', 'processing_failed'],
  ready: [],
  upload_failed: ['capturing'],
  quality_failed: ['capturing', 'queued'],
  processing_failed: ['queued'],
}

export function canTransitionEnrollment(from: EnrollmentState, to: EnrollmentState) {
  return transitions[from].includes(to)
}

export function assertEnrollmentTransition(from: EnrollmentState, to: EnrollmentState) {
  if (!canTransitionEnrollment(from, to)) {
    throw new Error(`Invalid enrollment transition: ${from} -> ${to}`)
  }
}

export function isEnrollmentLocked(state: EnrollmentState) {
  return state === 'uploading' || state === 'queued' || state === 'processing' || state === 'ready'
}
