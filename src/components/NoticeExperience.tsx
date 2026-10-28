import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Gift, X } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { birthdayGreeting, indiaDateKey, loadOwnBirthDate, loadPortalNotices, loadUpcomingExamReminders, saveOwnBirthDate } from '../lib/portalNotices'

function seen(key: string) {
  try { return window.localStorage.getItem(key) === '1' } catch { return false }
}
function remember(key: string) {
  try { window.localStorage.setItem(key, '1') } catch { /* Storage can be disabled on shared devices. */ }
}

export function NoticeExperience() {
  const auth = useAuth()
  const location = useLocation()
  const client = useQueryClient()
  const studentId = auth.session?.user.id ?? ''
  const enabled = auth.role === 'student' && auth.approvalStatus === 'approved' && Boolean(studentId)
  const { data: birthDate, isSuccess: birthdayLoaded, isFetched: birthdayChecked } = useQuery({ queryKey: ['my-birth-date', studentId], queryFn: loadOwnBirthDate, enabled })
  const { data: notices = [] } = useQuery({ queryKey: ['portal-notices'], queryFn: loadPortalNotices, enabled, refetchInterval: 60_000 })
  const { data: exams = [] } = useQuery({ queryKey: ['exam-reminders'], queryFn: loadUpcomingExamReminders, enabled, refetchInterval: 60_000 })
  const [draftBirthDate, setDraftBirthDate] = useState('')
  const [dismissedPrompt, setDismissedPrompt] = useState(false)
  const [dismissedKeys, setDismissedKeys] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!enabled || !birthdayChecked || location.pathname === '/student/descriptive-exams') return null

  const askBirthDate = birthdayLoaded && !birthDate && !dismissedPrompt
  const greeting = birthDate ? birthdayGreeting(birthDate) : null
  const now = Date.now()
  const popupItems = [
    ...(greeting ? [{ key: `birthday:${studentId}:${indiaDateKey()}`, title: 'Happy birthday!', body: greeting, icon: <Gift size={24} /> }] : []),
    ...notices.filter((notice) => notice.show_popup && new Date(notice.starts_at).getTime() <= now && (!notice.ends_at || new Date(notice.ends_at).getTime() > now)).map((notice) => ({ key: `notice:${studentId}:${notice.id}`, title: notice.title, body: notice.body, icon: <Bell size={24} /> })),
    ...exams.map((exam) => ({ key: `exam:${studentId}:${exam.id}`, title: 'Exam reminder', body: `${exam.title} starts ${new Date(exam.starts_at).toLocaleString('en-IN')}.`, icon: <Bell size={24} /> })),
  ]
  const popup = popupItems.find((item) => !dismissedKeys.includes(item.key) && !seen(item.key))

  function dismissPopup(key: string) {
    remember(key)
    setDismissedKeys((current) => [...current, key])
  }

  async function saveBirthday() {
    const value = draftBirthDate
    const date = new Date(`${value}T00:00:00`)
    if (!value || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || value > indiaDateKey() || Number(indiaDateKey().slice(0, 4)) - date.getFullYear() > 120) { setError('Enter a valid birthdate.'); return }
    setBusy(true)
    try { await saveOwnBirthDate(value); await client.invalidateQueries({ queryKey: ['my-birth-date', studentId] }); setError('') }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Could not save birthdate.') }
    finally { setBusy(false) }
  }

  if (!askBirthDate && !popup) return null
  return <div className="portal-popup-backdrop"><div className="portal-popup" role="dialog" aria-modal="true" aria-label={askBirthDate ? 'Add your birthdate' : popup?.title}>
    {askBirthDate ? <><Gift size={30} /><h2>When is your birthday?</h2><p>Add your birthdate to receive an in-app birthday wish each year. It is optional and visible only to you and administrators.</p><label>Birthdate<input type="date" value={draftBirthDate} max={indiaDateKey()} onChange={(event) => setDraftBirthDate(event.target.value)} /></label>{error ? <p className="form-error">{error}</p> : null}<div className="portal-popup-actions"><button className="icon-text primary" disabled={busy} onClick={() => void saveBirthday()}>Save birthdate</button><button className="icon-text" onClick={() => setDismissedPrompt(true)}>Remind me later</button></div></> : popup ? <>{popup.icon}<button className="portal-popup-close" aria-label="Close notice" onClick={() => dismissPopup(popup.key)}><X size={18} /></button><h2>{popup.title}</h2><p>{popup.body}</p><button className="icon-text primary" onClick={() => dismissPopup(popup.key)}>Got it</button></> : null}
  </div></div>
}
