import { Check, MessageSquarePlus, Search, Send, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormEvent, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { Card, EmptyState, IconButton, PageHeader, StatusPill } from '../components/Layout'
import { createStudentIssue, loadAppData, requestAttendanceCorrection, resolveAttendanceCorrection, updateStudentIssue } from '../lib/api'

export function Issues() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData, refetchInterval: 15000 })
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [targetType, setTargetType] = useState<'attendance' | 'mark'>('attendance')
  const [message, setMessage] = useState('')
  const [decisions, setDecisions] = useState<Record<string, 'approved_present' | 'approved_late' | 'rejected'>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})

  const studentId = auth.session?.user.id
  const issues = useMemo(() => {
    const rows = auth.role === 'admin' ? data?.issues ?? [] : data?.issues.filter((issue) => issue.student_id === studentId) ?? []
    const term = query.trim().toLowerCase()
    return term ? rows.filter((issue) => [issue.student_name, issue.message, issue.status].some((value) => value.toLowerCase().includes(term))) : rows
  }, [auth.role, data?.issues, query, studentId])

  const attendanceTargets = (data?.lectures ?? []).filter((lecture) => data?.courseMemberships.some((member) => member.course_id === lecture.course_id && member.student_id === studentId)).sort((a, b) => b.started_at.localeCompare(a.started_at))
  const markTargets = data?.marks.filter((mark) => mark.student_id === studentId) ?? []
  const targets = targetType === 'attendance' ? attendanceTargets : markTargets

  const createMutation = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      if (targetType === 'attendance') await requestAttendanceCorrection(String(form.get('targetId')), String(form.get('message')))
      else await createStudentIssue({ targetType, targetId: String(form.get('targetId')), message: String(form.get('message')) })
    },
    onSuccess: async () => {
      setShowForm(false)
      setMessage('Request submitted. You can track its status here.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not submit request.'),
  })

  async function resolve(issueId: string) {
    const note = window.prompt('Resolution note for the student:', 'Reviewed and resolved by the administrator.')
    if (note === null) return
    try {
      await updateStudentIssue({ issueId, status: 'resolved', adminNote: note })
      setMessage('Request resolved.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not resolve request.')
    }
  }

  async function decideAttendance(issueId: string) {
    const note = notes[issueId]?.trim() ?? ''
    if (!note) { setMessage('Write a reason before resolving the attendance request.'); return }
    try {
      await resolveAttendanceCorrection(issueId, decisions[issueId] ?? 'approved_present', note)
      setMessage('Attendance correction resolved and the student record updated if approved.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not resolve attendance request.') }
  }

  return (
    <>
      <PageHeader
        eyebrow={auth.role === 'admin' ? 'Student support' : 'Help & corrections'}
        title={auth.role === 'admin' ? 'Student requests' : 'My requests'}
        action={auth.role === 'student' ? <IconButton className="primary" onClick={() => setShowForm((open) => !open)}>{showForm ? <X size={16} /> : <MessageSquarePlus size={16} />}{showForm ? 'Close form' : 'New request'}</IconButton> : undefined}
      >
        {auth.role === 'admin' ? 'Review attendance and marks questions with a clear resolution trail.' : 'Raise a correction against one of your attendance or marks records and track the response.'}
      </PageHeader>

      {message ? <p className="notice">{message}</p> : null}

      {auth.role === 'student' && showForm ? <Card className="issue-form-card">
        <div className="section-title"><div><p className="eyebrow">New request</p><h2>What should be reviewed?</h2></div><MessageSquarePlus size={20} /></div>
        <form className="stack-form" onSubmit={(event) => createMutation.mutate(event)}>
          <div className="form-grid">
            <label>Record type<select value={targetType} onChange={(event) => setTargetType(event.target.value as 'attendance' | 'mark')}><option value="attendance">Attendance</option><option value="mark">Marks</option></select></label>
            <label>{targetType === 'attendance' ? 'Session' : 'Record'}<select name="targetId" required>{targetType === 'attendance' ? attendanceTargets.map((target) => <option key={target.id} value={target.id}>{target.title} · {new Date(target.started_at).toLocaleString('en-IN')} · {data?.attendance.find((record) => record.lecture_id === target.id && record.student_id === studentId)?.status ?? 'No mark'}</option>) : markTargets.map((target) => <option key={target.id} value={target.id}>Assessment mark · {target.value}</option>)}</select></label>
          </div>
          <label>Explain the correction<textarea name="message" required minLength={10} placeholder="Describe what is incorrect and what you expected." /></label>
          <IconButton className="primary" type="submit" disabled={!targets.length || createMutation.isPending}><Send size={16} />Submit request</IconButton>
          {!targets.length ? <p className="muted-copy">There are no {targetType} records available to question yet.</p> : null}
        </form>
      </Card> : null}

      <Card className={showForm ? 'import-preview-card' : ''}>
        <div className="table-toolbar">
          <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by student, message, or status" /></label>
          <StatusPill tone="neutral">{issues.length} requests</StatusPill>
        </div>
        {issues.length ? <div className="table-scroll"><table>
          <thead><tr><th>Student</th><th>Record</th><th>Submitted</th><th>Status</th><th>Message</th><th>Resolution</th><th>Action</th></tr></thead>
          <tbody>{issues.map((issue) => (
            <tr key={issue.id}>
              <td><strong>{issue.student_name}</strong></td>
              <td>{issue.session_id ? `Attendance · ${data?.lectures.find((item) => item.id === issue.session_id)?.title ?? 'Session'}` : issue.target_type}</td>
              <td>{new Date(issue.created_at).toLocaleDateString('en-IN')}</td>
              <td><StatusPill tone={issue.status === 'resolved' ? 'good' : issue.status === 'under_review' ? 'warn' : 'neutral'}>{issue.status.replace('_', ' ')}</StatusPill></td>
              <td>{issue.message}</td>
              <td>{issue.decision ? `${issue.decision.replace('_', ' ')} · ` : ''}{issue.admin_note ?? '—'}</td>
              <td>{auth.role === 'admin' && issue.status !== 'resolved' ? issue.session_id ? <div className="issue-decision"><select aria-label="Attendance decision" value={decisions[issue.id] ?? 'approved_present'} onChange={(event) => setDecisions({ ...decisions, [issue.id]: event.target.value as 'approved_present' | 'approved_late' | 'rejected' })}><option value="approved_present">Approve present</option><option value="approved_late">Approve late</option><option value="rejected">Reject</option></select><input aria-label="Reason for student" maxLength={1000} value={notes[issue.id] ?? ''} onChange={(event) => setNotes({ ...notes, [issue.id]: event.target.value })} placeholder="Reason for student" /><IconButton onClick={() => void decideAttendance(issue.id)}><Check size={16} />Save decision</IconButton></div> : <IconButton onClick={() => void resolve(issue.id)}><Check size={16} />Resolve</IconButton> : <small>{issue.status === 'resolved' ? 'Complete' : 'Waiting'}</small>}</td>
            </tr>
          ))}</tbody>
        </table></div> : <EmptyState title={query ? 'No matching requests' : 'No requests yet'} body={query ? 'Try a different search.' : auth.role === 'admin' ? 'Student questions will appear here.' : 'Use New request when you need an attendance or marks correction.'} icon={<MessageSquarePlus size={22} />} />}
      </Card>
    </>
  )
}
