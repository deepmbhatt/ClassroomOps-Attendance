import { devBypass, requireSupabase } from './supabase'

export type PortalNotice = {
  id: string
  title: string
  body: string
  starts_at: string
  ends_at: string | null
  show_popup: boolean
  created_at: string
}

export type ExamReminder = { id: string; title: string; starts_at: string }

export async function loadPortalNotices(): Promise<PortalNotice[]> {
  if (devBypass) return []
  const { data, error } = await requireSupabase().from('portal_notices').select('*').order('starts_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PortalNotice[]
}

export async function createPortalNotice(input: { title: string; body: string; startsAt: string; endsAt: string | null; showPopup: boolean }) {
  if (devBypass) return
  const { error } = await requireSupabase().from('portal_notices').insert({
    title: input.title.trim(), body: input.body.trim(), starts_at: input.startsAt,
    ends_at: input.endsAt, show_popup: input.showPopup,
  })
  if (error) throw error
}

export async function deletePortalNotice(id: string) {
  if (devBypass) return
  const { error } = await requireSupabase().from('portal_notices').delete().eq('id', id)
  if (error) throw error
}

export async function loadOwnBirthDate(): Promise<string | null> {
  if (devBypass) return null
  const client = requireSupabase()
  const { data: auth } = await client.auth.getUser()
  if (!auth.user) return null
  const { data, error } = await client.from('profiles').select('birth_date').eq('id', auth.user.id).single()
  if (error) throw error
  return data?.birth_date ?? null
}

export async function saveOwnBirthDate(value: string) {
  if (devBypass) return
  const client = requireSupabase()
  const { data: auth } = await client.auth.getUser()
  if (!auth.user) throw new Error('Sign in again to save your birthdate.')
  const { error } = await client.from('profiles').update({ birth_date: value }).eq('id', auth.user.id)
  if (error) throw error
}

export async function loadUpcomingExamReminders(): Promise<ExamReminder[]> {
  if (devBypass) return []
  const now = new Date()
  const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const { data, error } = await requireSupabase().from('native_exams').select('id, title, starts_at')
    .eq('status', 'open').eq('review_only', false)
    .gte('starts_at', now.toISOString()).lte('starts_at', nextDay.toISOString())
    .order('starts_at')
  if (error) throw error
  return (data ?? []) as ExamReminder[]
}

export function indiaDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${year}-${month}-${day}`
}

export function normalizeBirthDate(input: string, now = new Date()): string | null {
  const value = input.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const dayFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
  if (!iso && !dayFirst) return null
  const year = Number(iso?.[1] ?? dayFirst?.[3])
  const month = Number(iso?.[2] ?? dayFirst?.[2])
  const day = Number(iso?.[3] ?? dayFirst?.[1])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null
  const normalized = `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const today = indiaDateKey(now)
  if (normalized > today || Number(today.slice(0, 4)) - year > 120) return null
  return normalized
}

export function birthdayGreeting(birthDate: string, now = new Date()): string | null {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)
  const [bornYear, bornMonth, bornDay] = birthDate.split('-').map(Number)
  if (bornMonth !== month || bornDay !== day || !bornYear || bornYear > year) return null
  const age = year - bornYear
  const suffix = age % 100 >= 11 && age % 100 <= 13 ? 'th' : age % 10 === 1 ? 'st' : age % 10 === 2 ? 'nd' : age % 10 === 3 ? 'rd' : 'th'
  return `Happy ${age}${suffix} birthday! Have a great day.`
}
