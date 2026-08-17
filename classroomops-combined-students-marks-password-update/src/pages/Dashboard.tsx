import { Bell, BookOpenCheck, CalendarDays, ClipboardCheck, FlaskConical, GraduationCap, MessageSquareWarning, ShieldCheck, Users } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth'
import { Card, Kpi, PageHeader, Spinner, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'
import { confidenceLabel } from '../lib/attendance'

export function Dashboard() {
  const auth = useAuth()
  const query = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  if (query.isLoading) return <Spinner />
  if (!query.data) return null
  return auth.role === 'admin'
    ? <AdminDashboard data={query.data} />
    : <StudentDashboard data={query.data} studentId={auth.session?.user.id} />
}

function AdminDashboard({ data }: { data: Awaited<ReturnType<typeof loadAppData>> }) {
  const pending = data.enrollments.filter((item) => item.state === 'queued' || item.state === 'processing').length
  const unresolved = data.issues.filter((issue) => issue.status !== 'resolved').length
  const ready = data.enrollments.filter((item) => item.state === 'ready').length
  const lowConfidence = data.attendance.filter((record) => confidenceLabel(record.confidence) !== 'High' && record.source === 'face').length
  return (
    <>
      <PageHeader eyebrow="Admin command center" title="Classroom operations">
        Manage attendance, biometrics, academics, imports, and student issues from one browser.
      </PageHeader>
      <div className="kpi-grid">
        <Kpi label="Active students" value={data.profiles.filter((p) => p.role === 'student').length} icon={<Users size={20} />} />
        <Kpi label="Face enrollments ready" value={ready} icon={<ShieldCheck size={20} />} />
        <Kpi label="Queued jobs" value={pending} icon={<ClipboardCheck size={20} />} />
        <Kpi label="Open issues" value={unresolved} icon={<MessageSquareWarning size={20} />} />
      </div>
      <div className="dashboard-grid">
        <Card>
          <div className="section-title">
            <div><p className="eyebrow">Today</p><h2>Attendance health</h2></div>
            <StatusPill tone={lowConfidence ? 'warn' : 'good'}>{lowConfidence} need review</StatusPill>
          </div>
          <table>
            <thead><tr><th>Lecture</th><th>Student</th><th>Status</th><th>Confidence</th></tr></thead>
            <tbody>
              {data.attendance.map((record) => (
                <tr key={record.id}>
                  <td>{data.lectures.find((lecture) => lecture.id === record.lecture_id)?.title}</td>
                  <td>{record.student_name}</td>
                  <td><StatusPill tone={record.status === 'present' ? 'good' : 'warn'}>{record.status.replace('_', ' ')}</StatusPill></td>
                  <td>{confidenceLabel(record.confidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <div className="section-title"><div><p className="eyebrow">Signals</p><h2>Needs attention</h2></div><Bell size={20} /></div>
          <div className="task-list">
            <span><b>{pending}</b> biometric jobs are waiting for admin CPU/WebGPU processing.</span>
            <span><b>{data.assessments.filter((item) => !item.published).length}</b> assessments are still in draft.</span>
            <span><b>{unresolved}</b> student issue needs a decision.</span>
          </div>
        </Card>
      </div>
    </>
  )
}

function StudentDashboard({
  data,
  studentId,
}: {
  data: Awaited<ReturnType<typeof loadAppData>>
  studentId?: string
}) {
  const student = data.profiles.find((profile) => profile.id === studentId)

  if (!student) {
    return (
      <>
        <PageHeader eyebrow="Student portal" title="Profile is being prepared">
          Your login worked, but your student profile is not visible yet. Refresh once after signup, or ask the admin to confirm your profile row exists in Supabase.
        </PageHeader>
        <Card>
          <div className="section-title"><div><p className="eyebrow">Account setup</p><h2>Waiting for student profile</h2></div></div>
          <p className="muted-copy">New accounts are always student accounts. If this message stays, run the profile check SQL in Supabase for this email and create the missing profile row.</p>
        </Card>
      </>
    )
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
  return (
    <>
      <PageHeader eyebrow="Student portal" title={'Welcome, ' + student.full_name}>
        Your main view shows available lectures/labs first, then published marks.
      </PageHeader>
      <div className="kpi-grid">
        <Kpi label="Available lectures/labs" value={availableSessions.length} icon={<CalendarDays size={20} />} />
        <Kpi label="Attendance" value={String(percent) + '%'} icon={<ClipboardCheck size={20} />} />
        <Kpi label="Face status" value={enrollment?.state.replace('_', ' ') ?? 'not started'} icon={<ShieldCheck size={20} />} />
        <Kpi label="Open queries" value={data.issues.filter((issue) => issue.student_id === student.id && issue.status !== 'resolved').length} icon={<MessageSquareWarning size={20} />} />
      </div>
      <div className="student-main-grid">
        <Card className="student-primary-card">
          <div className="section-title"><div><p className="eyebrow">Available now</p><h2>Lectures and labs</h2></div><BookOpenCheck size={20} /></div>
          {Object.keys(groupedSessions).length ? (
            <div className="day-session-list">
              {Object.entries(groupedSessions).map(([day, sessions]) => (
                <details key={day} open>
                  <summary>{day}<span>{sessions.length} sessions</span></summary>
                  <div className="session-list">
                    {sessions.map((session) => {
                      const record = myAttendance.find((item) => item.lecture_id === session.id)
                      return (
                        <article key={session.id} className="session-item">
                          <span className={'session-icon ' + (session.session_type ?? 'lecture')}>{session.session_type === 'lab' ? <FlaskConical size={18} /> : <GraduationCap size={18} />}</span>
                          <div>
                            <strong>{session.title}</strong>
                            <small>{session.course_code} · {new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(session.started_at))}</small>
                          </div>
                          <StatusPill tone={record?.status === 'present' ? 'good' : record ? 'warn' : 'neutral'}>{record?.status.replace('_', ' ') ?? 'available'}</StatusPill>
                        </article>
                      )
                    })}
                  </div>
                </details>
              ))}
            </div>
          ) : <p className="muted-copy">No lectures or labs are available right now.</p>}
        </Card>
        <Card>
          <div className="section-title"><div><p className="eyebrow">Academic marks</p><h2>Published marks</h2></div></div>
          <div className="table-scroll">
            <table className="marks-table">
              <thead><tr><th>Assessment</th><th>Course</th><th>Term</th><th>Marks</th></tr></thead>
              <tbody>
                {myAssessments.map((assessment) => {
                  const mark = myMarks.find((item) => item.assessment_id === assessment.id)
                  return (
                    <tr key={assessment.id}>
                      <td>{assessment.title}</td>
                      <td>{assessment.course_code}</td>
                      <td>{[assessment.academic_year, assessment.semester].filter(Boolean).join(' · ') || '-'}</td>
                      <td>{mark?.value ?? '-'} / {assessment.max_marks}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  )
}
