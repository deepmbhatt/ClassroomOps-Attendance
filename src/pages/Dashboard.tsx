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
import { Card, EmptyState, Kpi, Spinner, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'
import { confidenceLabel } from '../lib/attendance'

export function Dashboard() {
  const auth = useAuth()
  const query = useQuery({ queryKey: ['app-data'], queryFn: loadAppData, refetchInterval: auth.role === 'admin' ? 15000 : false })
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
      <section className="course-hero admin-course-hero">
        <div className="course-hero-copy">
          <p className="eyebrow">DS605 / Course administration</p>
          <h1>Fundamentals of Machine Learning</h1>
          <p>Monitor today's teaching, attendance, enrollment readiness, and student requests.</p>
        </div>
        <div className="course-hero-actions">
          <Link className="icon-text primary" to="/admin/attendance" title="Open the DS605 live attendance terminal"><Camera size={18} />Start Attendance</Link>
        </div>
        <div className="ml-notation dashboard-notation" aria-hidden="true">
          <span>min<sub>&theta;</sub> L(&theta;)</span><span>&nabla;<sub>&theta;</sub>L</span><span>X &isin; R<sup>n&times;d</sup></span>
        </div>
      </section>
      <div className="kpi-grid">
        <Kpi label="Enrolled students" value={students.length} icon={<Users size={19} />} detail="Across active course rosters" />
        <Kpi label="Sessions today" value={todaySessions.length} icon={<CalendarDays size={19} />} detail="Lectures and labs scheduled" />
        <Kpi label="Faces ready" value={ready} icon={<ShieldCheck size={19} />} detail={`${pending} waiting for processing`} />
        <Kpi label="Pending approvals" value={unresolved + lowConfidence + pendingRegistrations} icon={<MessageSquareWarning size={19} />} detail="Registrations, issues, and uncertain matches" />
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
  const nextSession = availableSessions[0]
  const followingSessions = availableSessions.slice(1)
  const groupedSessions = followingSessions.reduce<Record<string, typeof followingSessions>>((groups, session) => {
    const day = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(session.started_at))
    groups[day] = [...(groups[day] ?? []), session]
    return groups
  }, {})
  const myMarks = data.marks.filter((mark) => mark.student_id === student.id && mark.published)
  const myAssessments = data.assessments
    .filter((assessment) => myMarks.some((mark) => mark.assessment_id === assessment.id))
    .sort((a, b) => (a.semester ?? '').localeCompare(b.semester ?? '') || a.title.localeCompare(b.title))
  const latestAssessment = myAssessments[myAssessments.length - 1]
  const latestMark = latestAssessment ? myMarks.find((mark) => mark.assessment_id === latestAssessment.id) : undefined
  const openIssues = data.issues.filter((issue) => issue.student_id === student.id && issue.status !== 'resolved')
  const faceState = enrollment?.state ?? 'not_started'
  const needsFaceAction = faceState !== 'ready'
  const actionLabel = needsFaceAction ? 'Face registration' : openIssues.length ? `${openIssues.length} open request${openIssues.length === 1 ? '' : 's'}` : 'No action needed'
  const actionDetail = needsFaceAction ? faceState.replace('_', ' ') : openIssues.length ? 'Review your submitted requests' : 'You are up to date'
  const actionHref = needsFaceAction ? '/student/face' : openIssues.length ? '/student/issues' : '/student/attendance'
  const firstName = student.full_name.trim().split(/\s+/)[0] || 'Student'

  return (
    <>
      <section className="course-hero student-course-hero">
        <div className="course-hero-copy">
          <p className="eyebrow">DS605 / Course portal</p>
          <h1>Fundamentals of Machine Learning</h1>
          <p>Welcome back, {firstName}. Here is what matters for your course today.</p>
        </div>
        <div className="ml-notation dashboard-notation" aria-hidden="true">
          <span>y&#770; = f<sub>&theta;</sub>(x)</span><span>w &larr; w - &eta;&nabla;L</span><span>X &isin; R<sup>n&times;d</sup></span>
        </div>
      </section>

      <section className="student-overview" aria-label="Course overview">
        <article className="overview-item" title="The next currently active DS605 lecture or lab">
          <span className="overview-icon"><CalendarDays size={19} /></span>
          <span className="overview-label">Next Session</span>
          <strong>{nextSession?.title ?? 'No session'}</strong>
          <small>{nextSession ? new Intl.DateTimeFormat('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(nextSession.started_at)) : 'Nothing active right now'}</small>
        </article>
        <article className="overview-item" title="Your recorded DS605 attendance percentage">
          <span className="overview-icon"><ClipboardCheck size={19} /></span>
          <span className="overview-label">Attendance</span>
          <strong>{percent}%</strong>
          <small>{present} of {myAttendance.length} sessions counted</small>
        </article>
        <article className="overview-item" title="Your most recently listed published assessment result">
          <span className="overview-icon"><GraduationCap size={19} /></span>
          <span className="overview-label">Latest Result</span>
          <strong>{latestAssessment && latestMark ? `${latestMark.value} / ${latestAssessment.max_marks}` : 'Not published'}</strong>
          <small>{latestAssessment?.title ?? 'No result available'}</small>
        </article>
        <Link className={`overview-item overview-action ${needsFaceAction || openIssues.length ? 'requires-action' : ''}`} to={actionHref} title="Open the item that currently needs your attention">
          <span className="overview-icon"><MessageSquareWarning size={19} /></span>
          <span className="overview-label">Action Required</span>
          <strong>{actionLabel}</strong>
          <small>{actionDetail}</small>
          <ArrowRight className="overview-arrow" size={17} />
        </Link>
      </section>

      <section className="course-progress" aria-label="Attendance progress">
        <div><span>Course attendance</span><strong>{percent}%</strong></div>
        <div className="progress-track" role="progressbar" aria-label="Course attendance" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
      </section>

      <div className="student-main-grid">
        <Card className="student-primary-card next-session-card">
          <div className="section-title"><div><p className="eyebrow">Schedule</p><h2>Next Session</h2></div><BookOpenCheck size={20} /></div>
          {nextSession ? <>
            <div className="next-session-focus">
              <span className={`session-icon ${nextSession.session_type ?? 'lecture'}`}>{nextSession.session_type === 'lab' ? <FlaskConical size={20} /> : <GraduationCap size={20} />}</span>
              <div>
                <p className="session-code">{nextSession.course_code} / {(nextSession.session_type ?? 'lecture').toUpperCase()}</p>
                <h2>{nextSession.title}</h2>
                <p>{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(nextSession.started_at))}</p>
              </div>
              <StatusPill tone="good">Active</StatusPill>
            </div>
            {Object.keys(groupedSessions).length ? <div className="following-sessions">
              <p className="subsection-label">Following sessions</p>
              <div className="day-session-list">
                {Object.entries(groupedSessions).map(([day, sessions]) => (
                  <details key={day}>
                    <summary>{day}<span>{sessions.length} sessions</span></summary>
                    <div className="session-list">
                      {sessions.map((session) => {
                        const record = myAttendance.find((item) => item.lecture_id === session.id)
                        return <article key={session.id} className="session-item">
                          <span className={`session-icon ${session.session_type ?? 'lecture'}`}>{session.session_type === 'lab' ? <FlaskConical size={18} /> : <GraduationCap size={18} />}</span>
                          <div><strong>{session.title}</strong><small>{session.course_code} - {new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(session.started_at))}</small></div>
                          <StatusPill tone={record?.status === 'present' ? 'good' : record ? 'warn' : 'neutral'}>{record?.status.replace('_', ' ') ?? 'upcoming'}</StatusPill>
                        </article>
                      })}
                    </div>
                  </details>
                ))}
              </div>
            </div> : null}
          </> : <EmptyState title="No active session" body="Your next DS605 lecture or lab will appear here when it is opened." icon={<CalendarDays size={22} />} />}
        </Card>

        <Card>
          <div className="section-title"><div><p className="eyebrow">Assessment record</p><h2>Latest Results</h2></div><GraduationCap size={20} /></div>
          {myAssessments.length ? <div className="table-scroll">
            <table className="marks-table">
              <thead><tr><th>Assessment</th><th>Term</th><th>Marks</th></tr></thead>
              <tbody>{[...myAssessments].reverse().map((assessment) => {
                const mark = myMarks.find((item) => item.assessment_id === assessment.id)
                return <tr key={assessment.id}><td><strong>{assessment.title}</strong><small className="table-course-code">{assessment.course_code}</small></td><td>{[assessment.academic_year, assessment.semester].filter(Boolean).join(' - ') || '-'}</td><td>{mark?.value ?? '-'} / {assessment.max_marks}</td></tr>
              })}</tbody>
            </table>
          </div> : <EmptyState title="No published results" body="Your DS605 assessment results will appear here after publication." icon={<FileSpreadsheet size={22} />} />}
        </Card>
      </div>

      {data.announcements.length ? <section className="course-announcements">
        <div className="section-title"><div><p className="eyebrow">Course notices</p><h2>Announcements</h2></div><Bell size={20} /></div>
        <div className="announcement-list">{data.announcements.slice(0, 4).map((item) => <article key={item.id}><strong>{item.title}</strong><small>{item.course_code} - {new Date(item.published_at).toLocaleDateString('en-IN')}</small><p>{item.body}</p></article>)}</div>
      </section> : null}
    </>
  )
}
