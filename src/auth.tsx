import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { Role } from './types'
import { devBypass, supabase } from './lib/supabase'

interface AuthValue {
  ready: boolean
  session: Session | null
  role: Role
  signedIn: boolean
  signIn(email: string, password: string): Promise<void>
  signUp(input: { email: string; password: string; fullName: string; studentId: string; phone: string }): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role>(devBypass ? 'admin' : 'student')
  const [ready, setReady] = useState(devBypass)

  async function loadRoleForUser(user: User | null) {
    if (devBypass || !supabase || !user) {
      setRole(devBypass ? 'admin' : 'student')
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (error) throw error
    setRole(data?.role === 'admin' ? 'admin' : 'student')
  }

  useEffect(() => {
    if (devBypass || !supabase) return

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session)
        return loadRoleForUser(data.session?.user ?? null)
      })
      .finally(() => setReady(true))

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(false)
      void loadRoleForUser(next?.user ?? null).finally(() => setReady(true))
    })

    return () => data.subscription.unsubscribe()
  }, [])

  const value: AuthValue = {
    ready,
    session,
    role,
    signedIn: devBypass || Boolean(session),
    async signIn(email, password) {
      if (devBypass) return
      if (!supabase) throw new Error('Supabase is not configured')
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      setSession(data.session)
      await loadRoleForUser(data.session?.user ?? null)
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
      setRole('student')
    },
    async signOut() {
      if (supabase && !devBypass) await supabase.auth.signOut()
      setSession(null)
      setRole(devBypass ? 'admin' : 'student')
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
