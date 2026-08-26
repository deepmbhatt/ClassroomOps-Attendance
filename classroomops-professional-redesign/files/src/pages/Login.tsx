import { ArrowLeft, Eye, EyeOff, LogIn, Mail, ShieldCheck, UserPlus } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export function Login() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    setMessage('')
    setPending(true)
    try {
      if (mode === 'forgot') {
        await auth.sendPasswordReset(String(form.get('email')))
        setMessage('Password reset instructions have been sent to your email.')
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
    } finally {
      setPending(false)
    }
  }

  const title = mode === 'forgot' ? 'Recover your account' : mode === 'signup' ? 'Create student account' : 'Sign in to your portal'

  return (
    <div className="login-page institutional-login">
      <section className="login-visual">
        <div className="brand big">
          <span className="brand-mark"><img src="/classroomops-logo.svg" alt="" /></span>
          <div><strong>ClassroomOps</strong><small>Academic operations platform</small></div>
        </div>
        <div className="login-copy-block">
          <p className="eyebrow">Institutional portal</p>
          <h1>Attendance and academic records, managed with clarity.</h1>
          <p>A secure workspace for classroom sessions, student rosters, biometric enrollment, assessments, and record corrections.</p>
          <div className="login-assurance"><ShieldCheck size={18} />Role-based access for administrators and students</div>
        </div>
      </section>

      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div>
          <p className="eyebrow">{mode === 'forgot' ? 'Account recovery' : mode === 'signup' ? 'Student registration' : 'Welcome back'}</p>
          <h2>{title}</h2>
          <p className="muted-copy">{mode === 'login' ? 'Use your institutional email and password.' : mode === 'signup' ? 'All self-registered accounts are created as students.' : 'We will send a secure reset link to your email.'}</p>
        </div>

        {mode === 'signup' ? <>
          <label>Full name<input name="fullName" autoComplete="name" required placeholder="Your full name" /></label>
          <div className="form-grid">
            <label>Student ID<input name="studentId" required placeholder="CSE001" /></label>
            <label>Phone<input name="phone" autoComplete="tel" required placeholder="+91 90000 00000" /></label>
          </div>
        </> : null}

        <label>Institutional email<input name="email" type="email" autoComplete="email" required placeholder="name@college.edu" /></label>
        {mode !== 'forgot' ? <label>Password<span className="password-field"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} placeholder="At least 8 characters" /><button type="button" title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label> : null}

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="notice"><Mail size={16} />{message}</p> : null}

        <button className="icon-text primary" type="submit" disabled={pending}>
          {mode === 'forgot' ? <Mail size={17} /> : mode === 'login' ? <LogIn size={17} /> : <UserPlus size={17} />}
          {pending ? 'Please wait...' : mode === 'forgot' ? 'Send reset link' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        {mode === 'login' ? <div className="login-help">
          <button className="text-button" type="button" onClick={() => setMode('signup')}>Create student account</button>
          <button className="text-button" type="button" onClick={() => setMode('forgot')}>Forgot password?</button>
        </div> : <button className="text-button" type="button" onClick={() => setMode('login')}><ArrowLeft size={15} />Back to sign in</button>}
      </form>
    </div>
  )
}
