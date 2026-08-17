import { FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth'
import { Card, IconButton, PageHeader, Spinner } from '../components/Layout'

export function ChangePassword() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  if (!auth.ready) return <Spinner />
  if (!auth.signedIn) return <Navigate to="/login" replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    const confirm = String(form.get('confirm'))
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    try {
      await auth.updatePassword(password)
      setDone(true)
      window.setTimeout(() => navigate('/'), 700)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not update password')
    }
  }

  return (
    <div className="account-page">
      <PageHeader eyebrow="Account security" title={auth.mustChangePassword ? 'Change your temporary password' : 'Update password'}>
        {auth.mustChangePassword
          ? 'Before opening the portal, set a private password that only you know.'
          : 'Use this page whenever you need to replace your current account password.'}
      </PageHeader>
      <Card className="account-card">
        <div className="section-title"><div><p className="eyebrow">Password</p><h2>Set new password</h2></div><ShieldCheck size={20} /></div>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <label>New password<input name="password" type="password" minLength={8} required placeholder="At least 8 characters" /></label>
          <label>Confirm password<input name="confirm" type="password" minLength={8} required placeholder="Repeat new password" /></label>
          {error ? <p className="form-error">{error}</p> : null}
          {done ? <p className="notice"><KeyRound size={16} />Password updated. Opening your portal...</p> : null}
          <IconButton className="primary" type="submit"><KeyRound size={16} />Save password</IconButton>
        </form>
      </Card>
    </div>
  )
}
