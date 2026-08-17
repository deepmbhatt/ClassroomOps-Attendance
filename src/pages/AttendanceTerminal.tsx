import { CheckCircle2, Monitor, UserCheck } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { CameraCapture } from '../components/CameraCapture'
import { Card, IconButton, OnlineGate, PageHeader, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'
import { canInsertAttendance, confidenceLabel } from '../lib/attendance'

export function AttendanceTerminal() {
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [courseId, setCourseId] = useState('course-1')
  const activeLecture = data?.lectures.find((lecture) => lecture.course_id === courseId && lecture.status === 'active')
  const records = data?.attendance ?? []
  return (
    <>
      <PageHeader eyebrow="Classroom terminal" title="Facial attendance">
        Select a course, start a lecture session, and let the classroom machine recognize the intentional active-zone face.
      </PageHeader>
      <OnlineGate>
        <div className="terminal-grid">
          <Card>
            <div className="section-title"><div><p className="eyebrow">Session</p><h2>Lecture control</h2></div><Monitor size={20} /></div>
            <label>Course<select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{data?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.title}</option>)}</select></label>
            <div className="terminal-status">
              <StatusPill tone="good">{activeLecture ? 'active session' : 'ready'}</StatusPill>
              <span>{data?.embeddings.length ?? 0} local embeddings loaded</span>
            </div>
            <CameraCapture locked={false} onComplete={() => undefined} />
          </Card>
          <Card>
            <div className="section-title"><div><p className="eyebrow">Recognition queue</p><h2>Marked students</h2></div><IconButton className="primary"><UserCheck size={16} />Manual mark</IconButton></div>
            <table>
              <thead><tr><th>Student</th><th>Status</th><th>Confidence</th><th>Duplicate guard</th></tr></thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{record.student_name}</td>
                    <td><StatusPill tone={record.status === 'present' ? 'good' : 'warn'}>{record.status.replace('_', ' ')}</StatusPill></td>
                    <td>{confidenceLabel(record.confidence)}</td>
                    <td>{canInsertAttendance(records, record.lecture_id, record.student_id) ? 'open' : <CheckCircle2 size={17} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </OnlineGate>
    </>
  )
}
