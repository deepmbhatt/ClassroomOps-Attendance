import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraCapture } from '../components/CameraCapture'

const stop = vi.fn()
const stream = {
  getTracks: () => [{ stop }],
  getVideoTracks: () => [{ getSettings: () => ({ deviceId: 'camera-1' }) }],
} as unknown as MediaStream

describe('CameraCapture', () => {
  beforeEach(() => {
    stop.mockClear()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(HTMLMediaElement.HAVE_METADATA)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens and explicitly plays a compatible webcam stream', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'camera-1', label: 'Built-in Camera' },
        ]),
      },
    })

    render(<CameraCapture onComplete={vi.fn()} />)

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: /capture/i })).toBeEnabled())
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('shows a retry action with permission recovery instructions', async () => {
    const denied = new Error('Permission denied')
    denied.name = 'NotAllowedError'
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(denied),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    })

    render(<CameraCapture onComplete={vi.fn()} />)

    expect(await screen.findByText(/allow camera permission/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry camera/i })).toBeEnabled()
  })
})
