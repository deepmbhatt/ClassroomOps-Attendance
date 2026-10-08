import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined


const deviceSessionStorageKey = 'classroomops-device-session-key'

export function appSessionKey() {
  if (typeof window === 'undefined') return 'server-render'
  const existing = window.localStorage.getItem(deviceSessionStorageKey)
  if (existing) return existing
  const created = crypto.randomUUID()
  window.localStorage.setItem(deviceSessionStorageKey, created)
  return created
}

export function appDeviceLabel() {
  if (typeof navigator === 'undefined') return 'Unknown device'
  return [navigator.platform, navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Browser'].filter(Boolean).join(' / ')
}

// Demo data must never replace Supabase data in a production build.
export const devBypass = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === 'true'
export const supabaseConfigured = Boolean(url && key)

export const supabase: SupabaseClient | null =
  !devBypass && url && key ? createClient(url, key, { global: { headers: { 'x-app-session-key': appSessionKey() } } }) : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return supabase
}
