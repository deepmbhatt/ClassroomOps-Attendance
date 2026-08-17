import { FileCheck2, Plus, RotateCcw, Save, Upload } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Card, IconButton, PageHeader, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'
import { previewImport } from '../lib/importValidation'
import type { MarkComponent } from '../types'

const sampleCsv = `Student ID,Insem 1,Insem 2,End Sem,Total,Lab Marks,Challenges,Project
CSE001,17,18,34,86,19,8,18
CSE002,15,16,31,78,17,7,16
CSE003,14,missing,29,70,16,6,15`

export function MarksImports() {
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [csv, setCsv] = useState(sampleCsv)
  const [columns, setColumns] = useState<MarkComponent[]>([])
  const activeColumns = columns.length ? columns : (data?.markComponents ?? [])
  const students = useMemo(
    () => data?.profiles.filter((profile) => profile.role === 'student').map((profile) => ({
      student_id: profile.student_id ?? '',
      full_name: profile.full_name,
    })) ?? [],
    [data],
  )
  const preview = useMemo(() => previewImport(csv, students, 'marks'), [csv, students])

  function updateColumn(id: string, key: keyof Pick<MarkComponent, 'label' | 'max_marks' | 'active'>, value: string | boolean) {
    setColumns((current) => {
      const base = current.length ? current : [...(data?.markComponents ?? [])]
      return base.map((column) => column.id === id ? {
        ...column,
        [key]: key === 'max_marks' ? Number(value) : value,
      } : column)
    })
  }

  function addColumn() {
    setColumns((current) => {
      const base = current.length ? current : [...(data?.markComponents ?? [])]
      const next = base.length + 1
      return [...base, {
        id: `local-${next}`,
        course_id: data?.courses[0]?.id ?? 'course-1',
        course_code: data?.courses[0]?.code ?? 'COURSE',
        key: `custom_${next}`,
        label: `Custom ${next}`,
        max_marks: 10,
        position: next,
        active: true,
      }]
    })
  }

  return (
    <>
      <PageHeader eyebrow="Academic records" title="Marks and imports">
        Configure the marks table, preview Excel/CSV imports, publish only when ready, and keep rollback IDs for mistakes.
      </PageHeader>
      <div className="marks-admin-grid">
        <Card>
          <div className="section-title"><div><p className="eyebrow">Editable table</p><h2>Marks columns</h2></div><IconButton className="primary" onClick={addColumn}><Plus size={16} />Add column</IconButton></div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Column</th><th>Max</th><th>Visible</th></tr></thead>
              <tbody>
                {activeColumns.sort((a, b) => a.position - b.position).map((column) => (
                  <tr key={column.id}>
                    <td><input value={column.label} onChange={(event) => updateColumn(column.id, 'label', event.target.value)} /></td>
                    <td><input type="number" min="0" value={column.max_marks} onChange={(event) => updateColumn(column.id, 'max_marks', event.target.value)} /></td>
                    <td><input className="checkbox-input" type="checkbox" checked={column.active} onChange={(event) => updateColumn(column.id, 'active', event.target.checked)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-actions">
            <IconButton><Save size={16} />Save table shape</IconButton>
            <IconButton className="primary"><FileCheck2 size={16} />Publish selected</IconButton>
          </div>
        </Card>
        <Card>
          <div className="section-title"><div><p className="eyebrow">Student table</p><h2>Current marks</h2></div></div>
          <div className="table-scroll">
            <table className="marks-table">
              <thead><tr><th>Student</th>{activeColumns.filter((column) => column.active).map((column) => <th key={column.id}>{column.label}<small>/{column.max_marks}</small></th>)}</tr></thead>
              <tbody>
                {data?.markBreakdowns.map((row) => (
                  <tr key={row.id}>
                    <td>{row.student_name}</td>
                    {activeColumns.filter((column) => column.active).map((column) => <td key={column.id}>{row.scores[column.key] ?? '-'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card className="import-preview-card">
        <div className="section-title"><div><p className="eyebrow">Import preview</p><h2>Excel/CSV validator</h2></div><StatusPill tone={preview.errorCount ? 'danger' : 'good'}>{preview.importId.slice(0, 8)}</StatusPill></div>
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
    </>
  )
}
