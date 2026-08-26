import {
  ArrowRight,
  Bell,
  BookOpenCheck,
  CalendarDays,
  Camera,
  ClipboardCheck,
  FileSpreadsheet,
  FlaskConical,
  GraduationCap,
  MessageSquareWarning,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { Card, EmptyState, Kpi, PageHeader, Spinner, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'
import { confidenceLabel } from '../lib/attendance'

export function Dashboard() {
  const auth = useAuth()
  const query = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  if (query.isLoading) return <Spinner />
  if (query.isError) return <EmptyState title="Could not load the portal" body={query.error instanceof Error ? query.error.message : 'Refresh the page and try again.'} />
  if (!query.data) return null
  return auth.role === 'admin'
    ? <AdminDashboard data={query.data} />
    : <StudentDashboard data={query.data} studentId={auth.session?.user.id} />
}

function AdminDashboard({ data }: { data: Awaited<ReturnType<typeof loadAppData>> }) {
  const students = data.profiles.filter((profile) => profile.role === 'student' && profile.approval_status !== 'pending' && profile.approval_status !== 'rejected' && !profile.deleted_at)
  const pendingRegistrations = data.profiles.filter((profile) => profile.role === 'student' && profile.approval_status === 'pending' && !profile.deleted_at).length
  const pending = data.enrollments.filter((item) => item.state === 'queued' || item.state === 'processing').length
  const unresolved = data.issues.filter((issue) => issue.status !== 'resolved').length
  const ready = data.enrollments.filter((item) => item.state === 'ready').length
  const lowConfidence = data.attendance.filter((record) => confidenceLabel(record.confidence) !== 'High' && record.source === 'face').length
  const today = new Date().toDateString()
  const todaySessions = data.lectures.filter((session) => new Date(session.started_at).toDateString() === today)

  const shortcuts = [
    { to: '/admin/attendance', label: 'Start attendance', detail: 'Open the live recognition terminal', icon: <Camera size={18} /> },
    { to: '/admin/students', label: 'Review students', detail: pendingRegistrations ? `${pendingRegistrations} registrations waiting` : 'Add courses, import or edit students', icon: <Users size={18} /> },
    { to: '/admin/marks', label: 'Update marks', detail: 'Create assessments and publish results', icon: <FileSpreadsheet size={18} /> },
    { to: '/admin/biometrics', label: 'Process faces', detail: pending ? `${pending} enrollment jobs are waiting` : 'All enrollment jobs are clear', icon: <ShieldCheck size={18} /> },
  ]

  return (
    <>
      <PageHeader eyebrow="Administration" title="Good day, Administrator">
        Live status across students, academics, enrollment processing, and attendance.
      </PageHeader>
      <div className="kpi-grid">
        <Kpi label="Active students" value={students.length} icon={<Users size={19} />} detail="Across active course rosters" />
        <Kpi label="Today's sessions" value={todaySessions.length} icon={<CalendarDays size={19} />} detail="Lectures and labs scheduled" />
        <Kpi label="Faces ready" value={ready} icon={<ShieldCheck size={19} />} detail={`${pending} waiting for processing`} />
        <Kpi label="Items to review" value={unresolved + lowConfidence + pendingRegistrations} icon={<MessageSquareWarning size={19} />} detail="Registrations, issues, and uncertain matches" />
      </div>

      <div className="dashboard-grid">
        <Card>
          <div className="section-title"><div><p className="eyebrow">Recent attendance</p><h2>Recognition and manual marks</h2></div><StatusPill tone={lowConfidence ? 'warn' : 'good'}>{lowConfidence} need review</StatusPill></div>
          {data.attendance.length ? <div className="table-scroll">
            <table>
              <thead><tr><th>Session</th><th>Student</th><th>Status</th><th>Source</th><th>Confidence</th></tr></thead>
              <tbody>
                {data.attendance.slice(0, 10).map((record) => (
                  <tr key={record.id}>
                    <td>{data.lectures.find((lecture) => lecture.id === record.lecture_id)?.title ?? 'Session'}</td>
                    <td><strong>{record.student_name}</strong></td>
                    <td><StatusPill tone={record.status === 'present' ? 'good' : record.status === 'absent' ? 'danger' : 'warn'}>{record.status.replace('_', ' ')}</StatusPill></td>
                    <td>{record.source}</td>
                    <td>{confidenceLabel(record.confidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div> : <EmptyState title="No attendance recorded yet" body="Start a session from the live terminal to begin marking attendance." icon={<ClipboardCheck size={22} />} />}
        </Card>

        <Card>
          <div className="section-title"><div><p className="eyebrow">Quick actions</p><h2>Continue working</h2></div></div>
          <div className="quick-actions">
            {shortcuts.map((item) => (
              <Link className="quick-action" to={item.to} key={item.to}>
                <span>{item.icon}</span>
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                <ArrowRight size={16} />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}

function StudentDashboard({ data, studentId }: { data: Awaited<ReturnType<typeof loadAppData>>; studentId?: string }) {
  const student = data.profiles.find((profile) => profile.id === studentId)
  if (!student) {
    return <EmptyState title="Your student profile is being prepared" body="Your login worked, but the linked profile is not visible yet. Refresh once or ask the administrator to confirm your profile." icon={<Users size={22} />} />
  }

  const enrollment = data.enrollments.find((item) => item.student_id === student.id)
  const myAttendance = data.attendance.filter((record) => record.student_id === student.id)
  const present = myAttendance.filter((record) => record.status === 'present' || record.status === 'late').length
  const percent = myAttendance.length ? Math.round((present / myAttendance.length) * 100) : 0
  const availableSessions = data.lectures
    .filter((lecture) => lecture.status === 'active')
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
  const groupedSessions = availableSessions.reduce<Record<string, typeof availableSessions>>((groups, session) => {
    const day = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(session.started_at))
    groups[day] = [...(groups[day] ?? []), session]
    return groups
  }, {})
  const myMarks = data.marks.filter((mark) => mark.student_id === student.id && mark.published)
  const myAssessments = data.assessments
    .filter((assessment) => myMarks.some((mark) => mark.assessment_id === assessment.id))
    .sort((a, b) => (a.semester ?? '').localeCompare(b.semester ?? '') || a.title.localeCompare(b.title))
  const faceState = enrollment?.state ?? 'not_started'

  return (
    <>
      <PageHeader eyebrow="Student home" title={`Welcome, ${student.full_name}`}>
        Your current classes, attendance standing, published results, and account actions.
      </PageHeader>
      {faceState !== 'ready' ? <Link className="student-welcome" to="/student/face">
        <span><h2>Complete face registration</h2><p>Your attendance profile is currently {faceState.replace('_', ' ')}.</p></span>
        <StatusPill tone={faceState.includes('failed') ? 'danger' : 'warn'}>{faceState.replace('_', ' ')}</StatusPill>
      </Link> : null}
      <div className="kpi-grid">
        <Kpi label="Available sessions" value={availableSessions.length} icon={<CalendarDays size={19} />} detail="Active lectures and labs" />
        <Kpi label="Attendance" value={`${percent}%`} icon={<ClipboardCheck size={19} />} detail={`${present} of ${myAttendance.length} counted`} />
        <Kpi label="Face registration" value={faceState === 'ready' ? 'Ready' : 'Pending'} icon={<ShieldCheck size={19} />} detail={faceState.replace('_', ' ')} />
        <Kpi label="Published results" value={myMarks.length} icon={<GraduationCap size={19} />} detail="Assessment scores available" />
      </div>

      <div className="student-main-grid">
        <Card className="student-primary-card">
          <div className="section-title"><div><p className="eyebrow">Schedule</p><h2>Lectures and labs</h2></div><BookOpenCheck size={20} /></div>
          {Object.keys(groupedSessions).length ? <div className="day-session-list">
            {Object.entries(groupedSessions).map(([day, sessions]) => (
              <details key={day} open>
                <summary>{day}<span>{sessions.length} sessions</span></summary>
                <div className="session-list">
                  {sessions.map((session) => {
                    const record = myAttendance.find((item) => item.lecture_id === session.id)
                    return <article key={session.id} className="session-item">
                      <span className={`session-icon ${session.session_type ?? 'lecture'}`}>{session.session_type === 'lab' ? <FlaskConical size={18} /> : <GraduationCap size={18} />}</span>
                      <div><strong>{session.title}</strong><small>{session.course_code} - {new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(session.started_at))}</small></div>
                      <StatusPill tone={record?.status === 'present' ? 'good' : record ? 'warn' : 'neutral'}>{record?.status.replace('_', ' ') ?? 'available'}</StatusPill>
                    </article>
                  })}
                </div>
              </details>
            ))}
          </div> : <EmptyState title="No active sessions" body="New lectures and labs will appear here when your administrator opens them." icon={<CalendarDays size={22} />} />}
        </Card>

        <Card>
          <div className="section-title"><div><p className="eyebrow">Results</p><h2>Published marks</h2></div><GraduationCap size={20} /></div>
          {myAssessments.length ? <div className="table-scroll">
            <table className="marks-table">
              <thead><tr><th>Assessment</th><th>Course</th><th>Term</th><th>Marks</th></tr></thead>
              <tbody>{myAssessments.map((assessment) => {
                const mark = myMarks.find((item) => item.assessment_id === assessment.id)
                return <tr key={assessment.id}><td>{assessment.title}</td><td>{assessment.course_code}</td><td>{[assessment.academic_year, assessment.semester].filter(Boolean).join(' - ') || '-'}</td><td>{mark?.value ?? '-'} / {assessment.max_marks}</td></tr>
              })}</tbody>
            </table>
          </div> : <EmptyState title="No published marks" body="Results will appear here when an assessment is published." icon={<FileSpreadsheet size={22} />} />}
        </Card>
      </div>

      {data.announcements.length ? <Card className="import-preview-card">
        <div className="section-title"><div><p className="eyebrow">Updates</p><h2>Announcements</h2></div><Bell size={20} /></div>
        <div className="announcement-list">{data.announcements.slice(0, 4).map((item) => <article key={item.id}><strong>{item.title}</strong><small>{item.course_code} - {new Date(item.published_at).toLocaleDateString('en-IN')}</small><p>{item.body}</p></article>)}</div>
      </Card> : null}
    </>
  )
}
