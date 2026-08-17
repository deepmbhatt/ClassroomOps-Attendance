import { FileCheck2, FileDown, Plus, RotateCcw, Upload } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { ChangeEvent, useMemo, useState } from 'react'
import { Card, IconButton, PageHeader, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'
import { previewAssessmentMarksImport } from '../lib/importValidation'

const marksCsvFormat = `Student ID,Marks,Remarks
CSE001,17,Submitted on time
CSE002,15,
CSE003,14,Recheck requested`

const assessmentNames = ['INSEM 1', 'INSEM 2', 'Practical', 'End Semester', 'Lab Work', 'Project', 'Challenge']

export function MarksImports() {
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [csv, setCsv] = useState(marksCsvFormat)
  const [academicYear, setAcademicYear] = useState('2026-27')
  const [semester, setSemester] = useState('Semester 1')
  const [courseId, setCourseId] = useState('course-1')
  const [assessmentId, setAssessmentId] = useState('new')
  const [newAssessmentTitle, setNewAssessmentTitle] = useState('INSEM 1')
  const [maxMarks, setMaxMarks] = useState(20)
  const courses = data?.courses ?? []
  const selectedCourse = courses.find((course) => course.id === courseId) ?? courses[0]
  const assessments = (data?.assessments ?? []).filter((assessment) => assessment.course_id === selectedCourse?.id)
  const selectedAssessment = assessments.find((assessment) => assessment.id === assessmentId)
  const effectiveMaxMarks = assessmentId === 'new' ? maxMarks : selectedAssessment?.max_marks ?? maxMarks
  const students = useMemo(
    () => data?.profiles.filter((profile) => profile.role === 'student').map((profile) => ({
      student_id: profile.student_id ?? '',
      full_name: profile.full_name,
      email: profile.email,
    })) ?? [],
    [data],
  )
  const preview = useMemo(() => previewAssessmentMarksImport(csv, students, effectiveMaxMarks), [csv, students, effectiveMaxMarks])
  const visibleAssessments = [...assessments].sort((a, b) => a.title.localeCompare(b.title))

  async function readCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setCsv(await file.text())
  }

  function downloadFormat() {
    const blob = new Blob([marksCsvFormat], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'assessment-marks-import-format.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader eyebrow="Academic records" title="Assessment-based marks imports" action={<IconButton className="primary" onClick={downloadFormat}><FileDown size={16} />CSV format</IconButton>}>
        Select academic year, semester, course, and assessment. Each upload is stored under that assessment without changing previous marks.
      </PageHeader>

      <div className="marks-admin-grid">
        <Card>
          <div className="section-title"><div><p className="eyebrow">Assessment setup</p><h2>Where this file belongs</h2></div><FileCheck2 size={20} /></div>
          <div className="form-grid">
            <label>Academic year<input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="2026-27" /></label>
            <label>Semester<select value={semester} onChange={(event) => setSemester(event.target.value)}><option>Semester 1</option><option>Semester 2</option><option>Semester 3</option><option>Semester 4</option></select></label>
            <label>Course<select value={selectedCourse?.id ?? ''} onChange={(event) => setCourseId(event.target.value)}>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.title}</option>)}</select></label>
            <label>Assessment<select value={assessmentId} onChange={(event) => setAssessmentId(event.target.value)}><option value="new">Create new assessment</option>{visibleAssessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.title} / {assessment.max_marks}</option>)}</select></label>
            {assessmentId === 'new' ? (
              <>
                <label>Assessment name<input list="assessment-names" value={newAssessmentTitle} onChange={(event) => setNewAssessmentTitle(event.target.value)} /></label>
                <datalist id="assessment-names">{assessmentNames.map((name) => <option key={name} value={name} />)}</datalist>
                <label>Maximum marks<input type="number" min="1" value={maxMarks} onChange={(event) => setMaxMarks(Number(event.target.value))} /></label>
              </>
            ) : null}
          </div>
          <div className="format-box compact">
            <code>Student ID</code>
            <code>Marks</code>
            <code>Remarks</code>
          </div>
          <p className="muted-copy">Use one CSV per assessment. For example, upload Semester 1 INSEM 1 now, then create Semester 1 INSEM 2 later and upload a second file. Existing assessment marks remain untouched.</p>
        </Card>

        <Card>
          <div className="section-title"><div><p className="eyebrow">Current records</p><h2>{selectedCourse?.code ?? 'Course'} marks by assessment</h2></div></div>
          <div className="table-scroll">
            <table className="marks-table">
              <thead><tr><th>Student</th>{visibleAssessments.map((assessment) => <th key={assessment.id}>{assessment.title}<small>/{assessment.max_marks}</small></th>)}</tr></thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.student_id}>
                    <td>{student.full_name}<br /><small>{student.student_id}</small></td>
                    {visibleAssessments.map((assessment) => {
                      const mark = data?.marks.find((item) => item.assessment_id === assessment.id && item.student_id === data.profiles.find((profile) => profile.student_id === student.student_id)?.id)
                      return <td key={assessment.id}>{mark?.value ?? '-'}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="import-preview-card">
        <div className="section-title">
          <div><p className="eyebrow">Import preview</p><h2>{assessmentId === 'new' ? newAssessmentTitle : selectedAssessment?.title ?? 'Assessment'} marks upload</h2></div>
          <StatusPill tone={preview.errorCount ? 'danger' : 'good'}>{preview.importId.slice(0, 8)}</StatusPill>
        </div>
        <label className="file-picker"><Upload size={17} />Upload marks CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void readCsvFile(event)} /></label>
        <textarea value={csv} onChange={(event) => setCsv(event.target.value)} aria-label="Marks CSV import input" />
        <div className="import-actions">
          <StatusPill tone={preview.errorCount ? 'danger' : 'good'}>{preview.validCount} valid / {preview.errorCount} errors</StatusPill>
          <IconButton disabled={preview.errorCount > 0}><Upload size={16} />Confirm assessment import</IconButton>
          <IconButton><RotateCcw size={16} />Rollback import</IconButton>
        </div>
        <table>
          <thead><tr><th>Row</th><th>Student</th><th>Marks</th><th>Messages</th></tr></thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.rowNumber} className={row.status === 'error' ? 'error-row' : undefined}>
                <td>{row.rowNumber}</td>
                <td>{row.studentName ?? row.studentId}</td>
                <td>{row.value}</td>
                <td><StatusPill tone={row.status === 'valid' ? 'good' : 'danger'}>{row.messages.join(', ') || 'ready'}</StatusPill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}
