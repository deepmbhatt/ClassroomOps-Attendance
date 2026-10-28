import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './auth'
import './styles.css'
import './makeover.css'

const queryClient = new QueryClient({ defaultOptions: { queries: {
  staleTime: 15_000,
  retry: (failureCount, error) => {
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
    return status !== 429 && failureCount < 1
  },
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
} } })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
