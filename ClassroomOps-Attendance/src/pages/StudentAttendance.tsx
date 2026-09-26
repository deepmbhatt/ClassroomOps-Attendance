import { AlertCircle, CalendarDays, CheckCircle2, Clock3, MessageSquareWarning } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { Card, EmptyState, IconButton, Kpi, PageHeader, Spinner, StatusPill } from '../components/Layout'
import { createStudentIssue, loadAppData } from '../lib/api'
import { attendanceTone, effectiveAttendanceStatus, localDateKey } from '../lib/attendanceView'

export function StudentAttendance() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [date, setDate] = useState('')
  const [message, setMessage] = useState('')

  const rows = useMemo(() => {
    if (!data || !auth.session?.user.id) return []
    const studentId = auth.session.user.id
    const courseIds = new Set(data.courseMemberships.filter((item) => item.student_id === studentId && !item.deleted_at).map((item) => item.course_id))
    return data.lectures
      .filter((session) => courseIds.has(session.course_id))
      .map((session) => {
        const record = data.attendance.find((item) => item.lecture_id === session.id && item.student_id === studentId)
        return { session, record, status: effectiveAttendanceStatus(session, record) }
      })
      .filter((row) => !date || localDateKey(row.session.started_at) === date)
      .sort((left, right) => new Date(right.session.started_at).getTime() - new Date(left.session.started_at).getTime())
  }, [auth.session?.user.id, data, date])

  const finalizedRows = rows.filter((row) => row.status)
  const presentCount = finalizedRows.filter((row) => row.status === 'present' || row.status === 'late').length
  const absentCount = finalizedRows.filter((row) => row.status === 'absent').length
  const attendancePercent = finalizedRows.length ? Math.round((presentCount / finalizedRows.length) * 100) : 0

  const reportIssue = useMutation({
    mutationFn: async ({ targetId, text }: { targetId: string; text: string }) => {
      await createStudentIssue({ targetType: 'attendance', targetId, message: text })
    },
    onSuccess: async () => {
      setMessage('Attendance correction request sent to the administrator.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not send the request.'),
  })

  if (isLoading) return <Spinner />
  if (!data) return null

  function sendAbsenceIssue(row: (typeof rows)[number]) {
    const displayDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(row.session.started_at))
    const text = `Attendance correction requested: ${row.session.course_code} - ${row.session.title} on ${displayDate} currently shows absent.`
    if (!window.confirm(`Send a correction request for ${displayDate}?`)) return
    reportIssue.mutate({ targetId: row.record?.id ?? row.session.id, text })
  }

  return (
    <>
      <PageHeader eyebrow="Attendance record" title="My attendance">
        Review every lecture and lab by date. Report an incorrect absence directly from its row.
      </PageHeader>
      {message ? <p className="notice">{message}</p> : null}

      <div className="attendance-filter-bar">
        <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        {date ? <IconButton title="Show attendance from every date" onClick={() => setDate('')}><CalendarDays size={16} />Show all dates</IconButton> : null}
      </div>

      <div className="kpi-grid">
        <Kpi label="Attendance" value={`${attendancePercent}%`} icon={<CheckCircle2 size={20} />} />
        <Kpi label="Present or late" value={presentCount} icon={<Clock3 size={20} />} />
        <Kpi label="Absent" value={absentCount} icon={<AlertCircle size={20} />} />
        <Kpi label="Sessions shown" value={rows.length} icon={<CalendarDays size={20} />} />
      </div>

      <Card>
        <div className="section-title"><div><p className="eyebrow">Daily register</p><h2>{date ? 'Attendance for selected date' : 'Complete attendance history'}</h2></div></div>
        {rows.length ? <div className="table-scroll">
          <table className="attendance-history-table">
            <thead><tr><th>Date</th><th>Session</th><th>Course</th><th>Status</th><th>Marked by</th><th>Request</th></tr></thead>
            <tbody>{rows.map((row) => {
              const targetId = row.record?.id ?? row.session.id
              const issue = data.issues.find((item) => item.target_type === 'attendance' && item.target_id === targetId)
              return <tr key={row.session.id}>
                <td><strong>{new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(row.session.started_at))}</strong><small>{new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(row.session.started_at))}</small></td>
                <td>{row.session.title}<small>{row.session.session_type ?? 'lecture'}</small></td>
                <td>{row.session.course_code}</td>
                <td><StatusPill tone={attendanceTone(row.status)}>{row.status?.replace('_', ' ') ?? (row.session.status === 'active' ? 'in progress' : 'not marked')}</StatusPill></td>
                <td>{row.record?.source ?? (row.session.status === 'active' ? 'Awaiting finalization' : '-')}</td>
                <td>{row.status === 'absent'
                  ? issue
                    ? <StatusPill tone={issue.status === 'resolved' ? 'good' : 'warn'}>{issue.status.replace('_', ' ')}</StatusPill>
                    : <button className="table-action" title="Report this absence as incorrect" disabled={reportIssue.isPending} onClick={() => sendAbsenceIssue(row)}><MessageSquareWarning size={15} />Report issue</button>
                  : <span className="muted-copy">-</span>}
                </td>
              </tr>
            })}</tbody>
          </table>
        </div> : <EmptyState title="No attendance found" body={date ? 'There are no assigned sessions on this date.' : 'Attendance will appear here after your first lecture or lab.'} icon={<CalendarDays size={22} />} />}
      </Card>
    </>
  )
}
