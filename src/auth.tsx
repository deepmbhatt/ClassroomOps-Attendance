import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Role } from './types'
import { devBypass, supabase } from './lib/supabase'

interface AuthValue {
  ready: boolean
  session: Session | null
  role: Role
  setRole(role: Role): void
  signedIn: boolean
  signIn(email: string, password: string): Promise<void>
  signUp(input: { email: string; password: string; fullName: string; studentId: string; phone: string }): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role>('admin')
  const [ready, setReady] = useState(devBypass)

  useEffect(() => {
    if (devBypass || !supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const value: AuthValue = {
    ready,
    session,
    role,
    setRole,
    signedIn: devBypass || Boolean(session),
    async signIn(email, password) {
      if (devBypass) return
      if (!supabase) throw new Error('Supabase is not configured')
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      setSession(data.session)
    },
    async signUp(input) {
      if (devBypass) {
        setRole('student')
        return
      }
      if (!supabase) throw new Error('Supabase is not configured')
      const { error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: {
            full_name: input.fullName,
            student_id: input.studentId,
            phone: input.phone,
          },
        },
      })
      if (error) throw error
    },
    async signOut() {
      if (supabase && !devBypass) await supabase.auth.signOut()
      setSession(null)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
