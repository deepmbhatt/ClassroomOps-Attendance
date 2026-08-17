import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth'

function renderApp(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('App', () => {
  it('renders the admin dashboard in dev bypass mode', async () => {
    renderApp('/')
    expect(await screen.findByText(/Classroom operations/i)).toBeInTheDocument()
    expect(screen.getByText(/Queued jobs/i)).toBeInTheDocument()
  })

  it('renders the biometric processing page', async () => {
    renderApp('/admin/biometrics')
    expect(await screen.findByText(/Biometric processing/i)).toBeInTheDocument()
    expect(screen.getByText(/Claim next job/i)).toBeInTheDocument()
  })
})
