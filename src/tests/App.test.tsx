import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(await screen.findByRole('heading', { name: /Fundamentals of Machine Learning/i })).toBeInTheDocument()
    expect(screen.getByText(/Faces ready/i)).toBeInTheDocument()
  })

  it('renders the secure exam administration page', async () => {
    renderApp('/admin/exams')
    expect(await screen.findByRole('heading', { name: /Exam access control/i })).toBeInTheDocument()
    expect(screen.getByText(/face-verified attendance/i)).toBeInTheDocument()
  })

  it('lets staff configure warnings and add mixed exam questions', async () => {
    renderApp('/admin/descriptive-exams')
    expect(await screen.findByRole('heading', { name: /Exams and answer reviews/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Auto-submit after warnings/i)).toHaveValue(1)
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'mcq' } })
    expect(screen.getByLabelText('Option 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add next question/i }))
    expect(screen.getByText(/Questions \(2\)/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Allow enrolled students to take this exam regardless of attendance/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Load questions from CSV\/Excel/i)).toBeInTheDocument()
  })

  it('offers review-only setup for an exam held outside the app', async () => {
    renderApp('/admin/descriptive-exams')
    expect(await screen.findByRole('heading', { name: /Exams and answer reviews/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'review' } })
    expect(screen.getByLabelText('Past exam date')).toBeInTheDocument()
    expect(screen.getByText(/Students will not see them in the exam-taking screen/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Auto-submit after warnings')).not.toBeInTheDocument()
  })

  it('renders the biometric processing page', async () => {
    renderApp('/admin/biometrics')
    expect(await screen.findByText(/Biometric processing/i)).toBeInTheDocument()
    expect(screen.getByText(/Process next job/i)).toBeInTheDocument()
  })
})
