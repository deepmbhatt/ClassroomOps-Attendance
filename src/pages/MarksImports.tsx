import { FileCheck2, RotateCcw, Upload } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Card, IconButton, PageHeader, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'
import { previewImport } from '../lib/importValidation'

const sampleCsv = `Student ID,Marks
CSE001,36
CSE002,31
CSE003,absent`

export function MarksImports() {
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [csv, setCsv] = useState(sampleCsv)
  const students = useMemo(
    () => data?.profiles.filter((profile) => profile.role === 'student').map((profile) => ({
      student_id: profile.student_id ?? '',
      full_name: profile.full_name,
    })) ?? [],
    [data],
  )
  const preview = useMemo(() => previewImport(csv, students, 'marks'), [csv, students])
  return (
    <>
      <PageHeader eyebrow="Academic records" title="Marks and imports">
        Marks stay in draft until published. Bulk imports always preview before execution and can be rolled back by import ID.
      </PageHeader>
      <div className="two-column">
        <Card>
          <div className="section-title"><div><p className="eyebrow">Draft marks</p><h2>Assessments</h2></div><IconButton className="primary"><FileCheck2 size={16} />Publish selected</IconButton></div>
          <table>
            <thead><tr><th>Course</th><th>Assessment</th><th>Max</th><th>State</th></tr></thead>
            <tbody>
              {data?.assessments.map((assessment) => (
                <tr key={assessment.id}>
                  <td>{assessment.course_code}</td>
                  <td>{assessment.title}</td>
                  <td>{assessment.max_marks}</td>
                  <td><StatusPill tone={assessment.published ? 'good' : 'warn'}>{assessment.published ? 'published' : 'draft'}</StatusPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <div className="section-title"><div><p className="eyebrow">Import preview</p><h2>CSV validator</h2></div><StatusPill tone={preview.errorCount ? 'danger' : 'good'}>{preview.importId.slice(0, 8)}</StatusPill></div>
          <textarea value={csv} onChange={(event) => setCsv(event.target.value)} aria-label="CSV import input" />
          <div className="import-actions">
            <StatusPill tone={preview.errorCount ? 'danger' : 'good'}>{preview.validCount} valid / {preview.errorCount} errors</StatusPill>
            <IconButton disabled={preview.errorCount > 0}><Upload size={16} />Confirm import</IconButton>
            <IconButton><RotateCcw size={16} />Rollback import</IconButton>
          </div>
          <table>
            <thead><tr><th>Row</th><th>Student</th><th>Value</th><th>Messages</th></tr></thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  <td>{row.studentName ?? row.studentId}</td>
                  <td>{row.value}</td>
                  <td><StatusPill tone={row.status === 'valid' ? 'good' : 'danger'}>{row.messages.join(', ') || 'valid'}</StatusPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  )
}
