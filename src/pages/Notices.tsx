import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Send, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { Card, IconButton, PageHeader } from '../components/Layout'
import { birthdayGreeting, createPortalNotice, deletePortalNotice, indiaDateKey, loadOwnBirthDate, loadPortalNotices, loadUpcomingExamReminders, saveOwnBirthDate } from '../lib/portalNotices'

export function Notices() {
  const auth = useAuth()
  const client = useQueryClient()
  const { data: notices = [], error } = useQuery({ queryKey: ['portal-notices'], queryFn: loadPortalNotices, refetchInterval: 60_000 })
  const { data: reminders = [] } = useQuery({ queryKey: ['exam-reminders'], queryFn: loadUpcomingExamReminders, enabled: auth.role === 'student', refetchInterval: 60_000 })
  const { data: birthDate } = useQuery({ queryKey: ['my-birth-date', auth.session?.user.id], queryFn: loadOwnBirthDate, enabled: auth.role === 'student' })
  const birthdayMessage = birthDate ? birthdayGreeting(birthDate) : null
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const start = String(values.get('startsAt') || '')
    const end = String(values.get('endsAt') || '')
    if (end && new Date(end).getTime() <= new Date(start || Date.now()).getTime()) { setMessage('The closing time must be after the opening time.'); return }
    setBusy(true)
    try {
      await createPortalNotice({ title: String(values.get('title')), body: String(values.get('body')), startsAt: start ? new Date(start).toISOString() : new Date().toISOString(), endsAt: end ? new Date(end).toISOString() : null, showPopup: values.get('showPopup') === 'on' })
      form.reset()
      await client.invalidateQueries({ queryKey: ['portal-notices'] })
      setMessage('Notice saved. Students will see it when its opening time arrives.')
    } catch (nextError) { setMessage(nextError instanceof Error ? nextError.message : 'Could not save the notice.') }
    finally { setBusy(false) }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this notice?')) return
    setBusy(true)
    try { await deletePortalNotice(id); await client.invalidateQueries({ queryKey: ['portal-notices'] }); setMessage('Notice removed.') }
    catch (nextError) { setMessage(nextError instanceof Error ? nextError.message : 'Could not remove the notice.') }
    finally { setBusy(false) }
  }

  async function updateBirthday(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = String(new FormData(event.currentTarget).get('birthDate') || '')
    if (!value || value > indiaDateKey()) { setMessage('Enter a valid birthdate.'); return }
    setBusy(true)
    try { await saveOwnBirthDate(value); await client.invalidateQueries({ queryKey: ['my-birth-date'] }); setMessage('Birthdate updated.') }
    catch (nextError) { setMessage(nextError instanceof Error ? nextError.message : 'Could not update birthdate.') }
    finally { setBusy(false) }
  }

  return <>
    <PageHeader eyebrow="Course updates" title={auth.role === 'admin' ? 'Notices and wishes' : 'My notifications'}>{auth.role === 'admin' ? 'Post a message now or schedule it for a festival or other occasion.' : 'Course notices, exam reminders, and birthday wishes appear here.'}</PageHeader>
    {message ? <p className="notice">{message}</p> : null}
    {error ? <p className="form-error">Could not load notices. Retry after applying the latest database migration.</p> : null}
    {auth.role === 'admin' ? <Card><h2>New notice</h2><form className="stack-form" onSubmit={(event) => void publish(event)}><label>Title<input name="title" required maxLength={120} placeholder="Happy Diwali" /></label><label>Message<textarea name="body" required maxLength={1000} placeholder="Write your message to students" /></label><div className="form-grid"><label>Show from<input name="startsAt" type="datetime-local" /></label><label>Show until (optional)<input name="endsAt" type="datetime-local" /></label></div><label className="notice-checkbox"><input type="checkbox" name="showPopup" defaultChecked />Show as a popup once per student</label><IconButton className="primary" type="submit" disabled={busy}><Send size={16} />Save notice</IconButton></form></Card> : null}
    {auth.role === 'student' && reminders.length ? <Card><h2>Upcoming exams</h2>{reminders.map((exam) => <p key={exam.id}><strong>{exam.title}</strong> · {new Date(exam.starts_at).toLocaleString('en-IN')}</p>)}</Card> : null}
    {birthdayMessage ? <Card><h2>Happy birthday!</h2><p>{birthdayMessage}</p></Card> : null}
    {auth.role === 'student' && birthDate ? <Card><h2>Birthday wish settings</h2><p className="muted-copy">Your birthdate is used for your in-app birthday wish.</p><form className="notice-birthday-form" onSubmit={(event) => void updateBirthday(event)}><label>Birthdate<input key={birthDate} name="birthDate" type="date" defaultValue={birthDate} max={indiaDateKey()} required /></label><IconButton type="submit" disabled={busy}>Update birthdate</IconButton></form></Card> : null}
    <Card><div className="section-title"><div><p className="eyebrow">Messages</p><h2>{auth.role === 'admin' ? 'Scheduled and active notices' : 'Course notices'}</h2></div><Bell size={20} /></div>{notices.length ? <div className="portal-notice-list">{notices.map((notice) => <article key={notice.id}><div><strong>{notice.title}</strong><small>{new Date(notice.starts_at).toLocaleString('en-IN')}{notice.ends_at ? ` – ${new Date(notice.ends_at).toLocaleString('en-IN')}` : ''}</small></div><p>{notice.body}</p>{auth.role === 'admin' ? <IconButton disabled={busy} onClick={() => void remove(notice.id)}><Trash2 size={15} />Remove</IconButton> : null}</article>)}</div> : <p className="muted-copy">No notices right now.</p>}</Card>
  </>
}
