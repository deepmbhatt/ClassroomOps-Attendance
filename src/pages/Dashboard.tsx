import { Bell, ClipboardCheck, GraduationCap, MessageSquareWarning, ShieldCheck, Users } from 'lucide-react'
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
  return auth.role === 'admin' ? <AdminDashboard data={query.data} /> : <StudentDashboard data={query.data} />
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

function StudentDashboard({ data }: { data: Awaited<ReturnType<typeof loadAppData>> }) {
  const student = data.profiles.find((profile) => profile.role === 'student')!
  const enrollment = data.enrollments.find((item) => item.student_id === student.id)
  const myAttendance = data.attendance.filter((record) => record.student_id === student.id)
  const present = myAttendance.filter((record) => record.status === 'present' || record.status === 'late').length
  const percent = myAttendance.length ? Math.round((present / myAttendance.length) * 100) : 0
  return (
    <>
      <PageHeader eyebrow="Student portal" title={`Welcome, ${student.full_name}`}>
        Track attendance, published marks, announcements, face-registration status, and issues.
      </PageHeader>
      <div className="kpi-grid">
        <Kpi label="Attendance" value={`${percent}%`} icon={<ClipboardCheck size={20} />} />
        <Kpi label="Published marks" value={data.marks.filter((mark) => mark.student_id === student.id && mark.published).length} icon={<GraduationCap size={20} />} />
        <Kpi label="Face status" value={enrollment?.state.replace('_', ' ') ?? 'not started'} icon={<ShieldCheck size={20} />} />
        <Kpi label="Open queries" value={data.issues.filter((issue) => issue.student_id === student.id && issue.status !== 'resolved').length} icon={<MessageSquareWarning size={20} />} />
      </div>
      <div className="dashboard-grid">
        <Card>
          <div className="section-title"><div><p className="eyebrow">Lecture history</p><h2>Attendance records</h2></div></div>
          <table>
            <thead><tr><th>Lecture</th><th>Status</th><th>Marked by</th></tr></thead>
            <tbody>
              {myAttendance.map((record) => (
                <tr key={record.id}>
                  <td>{data.lectures.find((lecture) => lecture.id === record.lecture_id)?.title}</td>
                  <td><StatusPill tone={record.status === 'present' ? 'good' : 'warn'}>{record.status.replace('_', ' ')}</StatusPill></td>
                  <td>{record.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <div className="section-title"><div><p className="eyebrow">Announcements</p><h2>Latest</h2></div></div>
          <div className="announcement-list">
            {data.announcements.map((announcement) => (
              <article key={announcement.id}>
                <strong>{announcement.title}</strong>
                <small>{announcement.course_code}</small>
                <p>{announcement.body}</p>
              </article>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}
