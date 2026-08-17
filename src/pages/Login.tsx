import { BookOpen, LogIn, UserPlus } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export function Login() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    try {
      if (mode === 'signup') {
        await auth.signUp({
          email: String(form.get('email')),
          password: String(form.get('password')),
          fullName: String(form.get('fullName')),
          studentId: String(form.get('studentId')),
          phone: String(form.get('phone')),
        })
        auth.setRole('student')
      } else {
        await auth.signIn(String(form.get('email')), String(form.get('password')))
      }
      navigate('/')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Authentication failed')
    }
  }

  return (
    <div className="login-page">
      <section className="login-visual">
        <div className="brand big">
          <span className="brand-mark"><BookOpen size={28} /></span>
          <div>
            <strong>ClassroomOps</strong>
            <small>Web-based facial attendance and academics</small>
          </div>
        </div>
        <h1>Strong attendance without installing classroom software.</h1>
        <p>Supabase keeps records permanent. The admin browser performs temporary biometric work on its own hardware.</p>
      </section>
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">{mode === 'login' ? 'Secure access' : 'Student registration'}</p>
        <h2>{mode === 'login' ? 'Sign in' : 'Create student account'}</h2>
        {mode === 'signup' ? (
          <>
            <label>Full name<input name="fullName" required placeholder="Student full name" /></label>
            <label>Student ID<input name="studentId" required placeholder="CSE001" /></label>
            <label>Phone<input name="phone" required placeholder="+91 ..." /></label>
          </>
        ) : null}
        <label>Email<input name="email" type="email" required placeholder="name@example.com" /></label>
        <label>Password<input name="password" type="password" required minLength={8} placeholder="At least 8 characters" /></label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="icon-text primary" type="submit">
          {mode === 'login' ? <LogIn size={17} /> : <UserPlus size={17} />}
          {mode === 'login' ? 'Sign in' : 'Register'}
        </button>
        <button className="text-button" type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          {mode === 'login' ? 'New student? Create an account' : 'Already registered? Sign in'}
        </button>
      </form>
    </div>
  )
}
