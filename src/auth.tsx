import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { Role } from './types'
import { appDeviceLabel, appSessionKey, devBypass, supabase } from './lib/supabase'

interface AuthValue {
  ready: boolean
  session: Session | null
  role: Role
  mustChangePassword: boolean
  approvalStatus: 'pending' | 'approved' | 'rejected'
  signedIn: boolean
  sessionMessage: string
  signIn(identifier: string, password: string): Promise<void>
  signUp(input: { email: string; password: string; fullName: string; studentId: string; phone: string }): Promise<void>
  sendPasswordReset(email: string): Promise<void>
  updatePassword(password: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role>(devBypass ? 'admin' : 'student')
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [approvalStatus, setApprovalStatus] = useState<'pending' | 'approved' | 'rejected'>(devBypass ? 'approved' : 'pending')
  const [ready, setReady] = useState(devBypass)
  const [sessionMessage, setSessionMessage] = useState('')

  async function claimCurrentDeviceSession() {
    if (!supabase || devBypass) return
    const { error } = await supabase.rpc('claim_app_session', {
      p_session_key: appSessionKey(),
      p_device_label: appDeviceLabel(),
    })
    if (error) throw new Error('Single-session security is not ready. Apply the latest database migration.')
  }

  async function currentDeviceSessionIsValid() {
    if (!supabase || devBypass) return true
    const { data, error } = await supabase.rpc('check_or_register_app_session', {
      p_session_key: appSessionKey(),
      p_device_label: appDeviceLabel(),
    })
    if (error) throw error
    return Boolean(data)
  }

  async function loadProfileForUser(user: User | null) {
    if (devBypass || !supabase || !user) {
      setRole(devBypass ? 'admin' : 'student')
      setMustChangePassword(false)
      setApprovalStatus(devBypass ? 'approved' : 'pending')
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('role, must_change_password, approval_status')
      .eq('id', user.id)
      .maybeSingle()

    if (error) throw error
    setRole(data?.role === 'admin' ? 'admin' : data?.role === 'pseudo_admin' ? 'pseudo_admin' : 'student')
    setMustChangePassword(Boolean(data?.must_change_password))
    setApprovalStatus(data?.role === 'student' ? (data?.approval_status === 'approved' ? 'approved' : data?.approval_status === 'rejected' ? 'rejected' : 'pending') : 'approved')
  }

  useEffect(() => {
    if (devBypass) return
    if (!supabase) {
      setReady(true)
      return
    }

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session)
        if (!data.session?.user) return loadProfileForUser(null)
        return currentDeviceSessionIsValid().then(async (valid) => {
          if (!valid) {
            await supabase?.auth.signOut({ scope: 'local' })
            setSession(null)
            setSessionMessage('You were signed out because this account was opened on another device.')
            return
          }
          return loadProfileForUser(data.session?.user ?? null)
        })
      })
      .finally(() => setReady(true))

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(false)
      void loadProfileForUser(next?.user ?? null).finally(() => setReady(true))
    })

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user || !supabase || devBypass) return
    const authClient = supabase
    let stopped = false
    const check = async () => {
      try {
        const valid = await currentDeviceSessionIsValid()
        if (!valid && !stopped) {
          stopped = true
          await authClient.auth.signOut({ scope: 'local' })
          setSession(null)
          setSessionMessage('You were signed out because this account was opened on another device.')
        }
      } catch {
        // A temporary network failure must not sign a student out during an exam.
      }
    }
    const timer = window.setInterval(() => void check(), 15_000)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [session?.user])

  const value: AuthValue = {
    ready,
    session,
    role,
    mustChangePassword,
    approvalStatus,
    signedIn: devBypass || Boolean(session),
    sessionMessage,
    async signIn(identifier, password) {
      if (devBypass) {
        setRole('admin')
        return
      }
      if (!supabase) throw new Error('Supabase is not configured')
      const normalizedIdentifier = identifier.trim().toLowerCase()
      if (!normalizedIdentifier) throw new Error('Student ID or institutional email is required.')
      let loginEmail = normalizedIdentifier
      if (!normalizedIdentifier.includes('@')) {
        const { data: resolvedEmail, error: resolveError } = await supabase.rpc('resolve_login_email', { p_identifier: normalizedIdentifier })
        if (resolveError) throw new Error('Student ID login is not enabled yet. Apply the latest database migration.')
        if (!resolvedEmail) throw new Error('Student ID or password is incorrect.')
        loginEmail = String(resolvedEmail)
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password })
      if (error) throw error
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, deleted_at')
        .eq('id', data.user.id)
        .maybeSingle()
      if (profileError || !profile || profile.deleted_at) {
        await supabase.auth.signOut()
        setSession(null)
        throw new Error('This account is unavailable. Ask an administrator for help.')
      }
      await claimCurrentDeviceSession()
      await supabase.auth.signOut({ scope: 'others' })
      setSessionMessage('')
      setSession(data.session)
      await loadProfileForUser(data.session?.user ?? null)
    },
    async signUp(input) {
      if (devBypass) {
        setRole('student')
        return
      }
      if (!supabase) throw new Error('Supabase is not configured')
      const email = input.email.trim().toLowerCase()
      const studentId = input.studentId.trim()
      const fullName = input.fullName.trim()
      const phone = input.phone.trim()
      if (!studentId || !fullName || !phone || !email) throw new Error('Name, student ID, phone number, and institutional email are required.')
      const { error } = await supabase.auth.signUp({
        email,
        password: input.password,
        options: {
          data: {
            full_name: fullName,
            student_id: studentId,
            phone,
          },
        },
      })
      if (error) {
        const message = /database error/i.test(error.message)
          ? 'That student ID or email is already registered. If an old account should be removed, ask the administrator to permanently delete it first.'
          : error.message
        throw new Error(message)
      }
      setRole('student')
    },
    async sendPasswordReset(email) {
      if (devBypass) return
      if (!supabase) throw new Error('Supabase is not configured')
      const redirectTo = `${window.location.origin}/reset-password`
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      if (error) throw error
    },
    async updatePassword(password) {
      if (devBypass) {
        setMustChangePassword(false)
        return
      }
      if (!supabase) throw new Error('Supabase is not configured')
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      const userId = session?.user.id
      if (userId) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ must_change_password: false })
          .eq('id', userId)
        if (profileError) throw profileError
      }
      setMustChangePassword(false)
    },
    async signOut() {
      if (supabase && !devBypass) {
        await supabase.rpc('release_app_session', { p_session_key: appSessionKey() })
        await supabase.auth.signOut()
      }
      setSession(null)
      setRole(devBypass ? 'admin' : 'student')
      setMustChangePassword(false)
      setApprovalStatus(devBypass ? 'approved' : 'pending')
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Auth hook intentionally shares this module with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
