import { LogIn, Mail, ShieldCheck, UserPlus } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export function Login() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    setMessage('')
    try {
      if (mode === 'forgot') {
        await auth.sendPasswordReset(String(form.get('email')))
        setMessage('Password reset email sent. Open the link from your email to set a new password.')
        return
      }

      if (mode === 'signup') {
        await auth.signUp({
          email: String(form.get('email')),
          password: String(form.get('password')),
          fullName: String(form.get('fullName')),
          studentId: String(form.get('studentId')),
          phone: String(form.get('phone')),
        })
      } else {
        await auth.signIn(String(form.get('email')), String(form.get('password')))
      }
      navigate('/')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Authentication failed')
    }
  }

  return (
    <div className="login-page institutional-login">
      <section className="login-visual">
        <div className="brand big">
          <span className="brand-mark"><img src="/classroomops-logo.svg" alt="" /></span>
          <div>
            <strong>ClassroomOps</strong>
            <small>Academic attendance and records portal</small>
          </div>
        </div>
        <div className="login-copy-block">
          <p className="eyebrow">Institutional access</p>
          <h1>Classroom attendance, biometric enrollment, and academic records in one secure portal.</h1>
          <p>Students can view active lectures, labs, marks, and registration status. Administrators manage rosters, assessments, attendance sessions, and review workflows from a controlled console.</p>
          <div className="login-assurance"><ShieldCheck size={18} />Role-based access with Supabase security policies</div>
        </div>
      </section>
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">{mode === 'forgot' ? 'Password recovery' : mode === 'login' ? 'Account sign in' : 'Student registration'}</p>
        <h2>{mode === 'forgot' ? 'Reset password' : mode === 'login' ? 'Welcome back' : 'Create student account'}</h2>
        {mode === 'signup' ? (
          <>
            <label>Full name<input name="fullName" required placeholder="Student full name" /></label>
            <label>Student ID<input name="studentId" required placeholder="CSE001" /></label>
            <label>Phone<input name="phone" required placeholder="+91 ..." /></label>
          </>
        ) : null}
        <label>Email<input name="email" type="email" required placeholder="name@example.com" /></label>
        {mode !== 'forgot' ? <label>Password<input name="password" type="password" required minLength={8} placeholder="At least 8 characters" /></label> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="notice"><Mail size={16} />{message}</p> : null}
        <button className="icon-text primary" type="submit">
          {mode === 'forgot' ? <Mail size={17} /> : mode === 'login' ? <LogIn size={17} /> : <UserPlus size={17} />}
          {mode === 'forgot' ? 'Send reset email' : mode === 'login' ? 'Sign in' : 'Register'}
        </button>
        <button className="text-button" type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          {mode === 'login' ? 'New student? Create an account' : 'Already registered? Sign in'}
        </button>
        {mode !== 'forgot' ? (
          <button className="text-button" type="button" onClick={() => setMode('forgot')}>Forgot password?</button>
        ) : null}
      </form>
    </div>
  )
}
