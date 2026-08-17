import { Plus, Search, Trash2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card, IconButton, PageHeader, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'

export function AdminStudents() {
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const students = data?.profiles.filter((profile) => profile.role === 'student') ?? []
  return (
    <>
      <PageHeader eyebrow="Course roster" title="Students and courses" action={<IconButton className="primary"><Plus size={16} />Add student</IconButton>}>
        Add/remove students, manage course membership, and review biometric readiness.
      </PageHeader>
      <Card>
        <div className="table-toolbar">
          <label className="search-box"><Search size={16} /><input placeholder="Search by name, student ID, or email" /></label>
          <IconButton><Trash2 size={16} />Preview bulk remove</IconButton>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Student ID</th><th>Email</th><th>Courses</th><th>Face</th></tr></thead>
          <tbody>
            {students.map((student) => {
              const enrollment = data?.enrollments.find((item) => item.student_id === student.id)
              return (
                <tr key={student.id}>
                  <td>{student.full_name}</td>
                  <td>{student.student_id}</td>
                  <td>{student.email}</td>
                  <td>{enrollment?.course_codes.join(', ') || 'Unassigned'}</td>
                  <td><StatusPill tone={enrollment?.state === 'ready' ? 'good' : 'warn'}>{enrollment?.state ?? 'not started'}</StatusPill></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </>
  )
}
