import { FileCheck2, FileDown, Grid3X3, ListChecks, Save, Trash2, Upload } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChangeEvent, useMemo, useState } from 'react'
import { Card, EmptyState, IconButton, PageHeader, SectionTabs, StatusPill } from '../components/Layout'
import { deleteMark, loadAppData, upsertAssessment, upsertMarks } from '../lib/api'
import { previewAssessmentMarksImport, readTabularFile, rowsToMarks } from '../lib/importValidation'
import type { Assessment } from '../types'

const marksCsvFormat = `Student ID,Marks,Remarks
CSE001,17,Submitted on time
CSE002,15,
CSE003,14,Recheck requested`

const assessmentNames = ['INSEM 1', 'INSEM 2', 'Practical', 'End Semester', 'Lab Work', 'Project', 'Challenge']

export function MarksImports() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const [csv, setCsv] = useState(marksCsvFormat)
  const [academicYear, setAcademicYear] = useState('2026-27')
  const [semester, setSemester] = useState('Semester 1')
  const [courseId, setCourseId] = useState('')
  const [assessmentId, setAssessmentId] = useState('new')
  const [newAssessmentTitle, setNewAssessmentTitle] = useState('INSEM 1')
  const [assessmentType, setAssessmentType] = useState('internal')
  const [maxMarks, setMaxMarks] = useState(20)
  const [publishOnImport, setPublishOnImport] = useState(true)
  const [message, setMessage] = useState('')
  const [workspace, setWorkspace] = useState<'import' | 'assessments' | 'grid'>('import')
  const [assessmentEdits, setAssessmentEdits] = useState<Record<string, Assessment>>({})
  const [markEdits, setMarkEdits] = useState<Record<string, string>>({})

  const courses = data?.courses ?? []
  const selectedCourse = courses.find((course) => course.id === (courseId || courses[0]?.id)) ?? courses[0]
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
  const visibleAssessments = [...assessments].sort((a, b) => (a.academic_year ?? '').localeCompare(b.academic_year ?? '') || (a.semester ?? '').localeCompare(b.semester ?? '') || a.title.localeCompare(b.title))

  const importMarks = useMutation({
    mutationFn: async () => {
      if (!selectedCourse?.id) throw new Error('Select a course first.')
      const assessment = assessmentId === 'new'
        ? await upsertAssessment({ courseId: selectedCourse.id, title: newAssessmentTitle, maxMarks, published: publishOnImport, academicYear, semester, assessmentType })
        : { id: assessmentId }
      await upsertMarks({ assessmentId: assessment.id, rows: rowsToMarks(preview), published: publishOnImport, profiles: data?.profiles ?? [] })
      return assessment.id
    },
    onSuccess: async () => {
      setMessage(`${preview.validCount} marks saved.`)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Marks import failed'),
  })

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setCsv(await readTabularFile(file))
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

  async function saveAssessment(assessment: Assessment) {
    const edit = assessmentEdits[assessment.id] ?? assessment
    await upsertAssessment({
      id: assessment.id,
      courseId: edit.course_id,
      title: edit.title,
      maxMarks: Number(edit.max_marks),
      published: edit.published,
      academicYear: edit.academic_year,
      semester: edit.semester,
      assessmentType: edit.assessment_type,
    })
    setAssessmentEdits((edits) => {
      const next = { ...edits }
      delete next[assessment.id]
      return next
    })
    setMessage(`${edit.title} updated.`)
    await queryClient.invalidateQueries({ queryKey: ['app-data'] })
  }

  async function saveMark(assessment: Assessment, studentId: string) {
    const student = data?.profiles.find((profile) => profile.student_id === studentId)
    if (!student) return
    const key = `${assessment.id}:${student.id}`
    const value = Number(markEdits[key])
    if (!Number.isFinite(value) || value < 0 || value > Number(assessment.max_marks)) {
      setMessage(`Enter a mark between 0 and ${assessment.max_marks}.`)
      return
    }
    await upsertMarks({ assessmentId: assessment.id, rows: [{ studentId, value }], published: assessment.published, profiles: data?.profiles ?? [] })
    setMarkEdits((edits) => {
      const next = { ...edits }
      delete next[key]
      return next
    })
    setMessage('Mark saved.')
    await queryClient.invalidateQueries({ queryKey: ['app-data'] })
  }

  async function removeMark(assessment: Assessment, studentId: string) {
    const student = data?.profiles.find((profile) => profile.student_id === studentId)
    const mark = data?.marks.find((item) => item.assessment_id === assessment.id && item.student_id === student?.id)
    if (!mark) return
    if (!window.confirm('Delete this mark?')) return
    await deleteMark(mark.id)
    setMessage('Mark deleted.')
    await queryClient.invalidateQueries({ queryKey: ['app-data'] })
  }

  return (
    <>
      <PageHeader eyebrow="Academic records" title="Assessment marks manager" action={<IconButton className="primary" onClick={downloadFormat}><FileDown size={16} />Format</IconButton>}>
        Create assessments whenever needed, upload Excel/CSV marks, and edit the marks sheet directly.
      </PageHeader>

      {message ? <p className="notice">{message}</p> : null}
      <SectionTabs
        value={workspace}
        onChange={(value) => setWorkspace(value as typeof workspace)}
        items={[
          { value: 'import', label: 'Import marks', icon: <Upload size={16} /> },
          { value: 'assessments', label: 'Assessments', icon: <ListChecks size={16} />, count: visibleAssessments.length },
          { value: 'grid', label: 'Marks grid', icon: <Grid3X3 size={16} />, count: students.length },
        ]}
      />

      <div className="workspace-panel">
        {workspace === 'import' ? <Card>
          <div className="section-title"><div><p className="eyebrow">Assessment setup</p><h2>Where this file belongs</h2></div><FileCheck2 size={20} /></div>
          <div className="form-grid">
            <label>Academic year<input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="2026-27" /></label>
            <label>Semester<select value={semester} onChange={(event) => setSemester(event.target.value)}><option>Semester 1</option><option>Semester 2</option><option>Semester 3</option><option>Semester 4</option><option>Semester 5</option><option>Semester 6</option><option>Semester 7</option><option>Semester 8</option></select></label>
            <label>Course<select value={selectedCourse?.id ?? ''} onChange={(event) => setCourseId(event.target.value)}>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.title}</option>)}</select></label>
            <label>Assessment<select value={assessmentId} onChange={(event) => setAssessmentId(event.target.value)}><option value="new">Create new assessment</option>{visibleAssessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.title} / {assessment.max_marks}</option>)}</select></label>
            {assessmentId === 'new' ? <>
              <label>Assessment name<input list="assessment-names" value={newAssessmentTitle} onChange={(event) => setNewAssessmentTitle(event.target.value)} /></label>
              <datalist id="assessment-names">{assessmentNames.map((name) => <option key={name} value={name} />)}</datalist>
              <label>Assessment type<input value={assessmentType} onChange={(event) => setAssessmentType(event.target.value)} placeholder="internal / lab / project" /></label>
              <label>Maximum marks<input type="number" min="1" value={maxMarks} onChange={(event) => setMaxMarks(Number(event.target.value))} /></label>
            </> : null}
            <label className="inline-check"><input type="checkbox" checked={publishOnImport} onChange={(event) => setPublishOnImport(event.target.checked)} /> Publish saved marks</label>
          </div>
          <div className="format-box compact"><code>Student ID</code><code>Marks</code><code>Remarks</code></div>
          <label className="file-picker"><Upload size={17} />Upload marks Excel/CSV<input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(event) => void readFile(event)} /></label>
          <textarea value={csv} onChange={(event) => setCsv(event.target.value)} aria-label="Marks CSV import input" />
          <div className="import-actions"><StatusPill tone={preview.errorCount ? 'danger' : 'good'}>{preview.validCount} valid / {preview.errorCount} errors</StatusPill><IconButton disabled={preview.errorCount > 0 || !preview.validCount || importMarks.isPending} onClick={() => importMarks.mutate()}><Upload size={16} />Save all uploaded marks</IconButton></div>
        </Card> : null}

        {workspace === 'assessments' ? <Card>
          <div className="section-title"><div><p className="eyebrow">Assessment sheet</p><h2>{selectedCourse?.code ?? 'Course'} assessments</h2></div></div>
          <div className="table-scroll"><table className="editable-table"><thead><tr><th>Title</th><th>Year</th><th>Semester</th><th>Type</th><th>Max</th><th>Published</th><th>Actions</th></tr></thead><tbody>{visibleAssessments.map((assessment) => {
            const edit = assessmentEdits[assessment.id] ?? assessment
            return <tr key={assessment.id}>
              <td><input value={edit.title} onChange={(event) => setAssessmentEdits({ ...assessmentEdits, [assessment.id]: { ...edit, title: event.target.value } })} /></td>
              <td><input value={edit.academic_year ?? ''} onChange={(event) => setAssessmentEdits({ ...assessmentEdits, [assessment.id]: { ...edit, academic_year: event.target.value } })} /></td>
              <td><input value={edit.semester ?? ''} onChange={(event) => setAssessmentEdits({ ...assessmentEdits, [assessment.id]: { ...edit, semester: event.target.value } })} /></td>
              <td><input value={edit.assessment_type ?? ''} onChange={(event) => setAssessmentEdits({ ...assessmentEdits, [assessment.id]: { ...edit, assessment_type: event.target.value } })} /></td>
              <td><input type="number" value={edit.max_marks} onChange={(event) => setAssessmentEdits({ ...assessmentEdits, [assessment.id]: { ...edit, max_marks: Number(event.target.value) } })} /></td>
              <td><input className="checkbox-input" type="checkbox" checked={edit.published} onChange={(event) => setAssessmentEdits({ ...assessmentEdits, [assessment.id]: { ...edit, published: event.target.checked } })} /></td>
              <td><div className="row-actions"><button title="Save" onClick={() => void saveAssessment(assessment)}><Save size={15} /></button></div></td>
            </tr>
          })}</tbody></table></div>
        </Card> : null}
      </div>

      {workspace === 'grid' ? <Card className="import-preview-card">
        <div className="section-title"><div><p className="eyebrow">Marks grid</p><h2>Edit one cell or upload all at once</h2></div><StatusPill tone={preview.errorCount ? 'danger' : 'good'}>{preview.importId.slice(0, 8)}</StatusPill></div>
        <div className="table-scroll">
          <table className="marks-table editable-table">
            <thead><tr><th>Student</th>{visibleAssessments.map((assessment) => <th key={assessment.id}>{assessment.title}<small>/{assessment.max_marks}</small></th>)}</tr></thead>
            <tbody>{students.map((student) => (
              <tr key={student.student_id}>
                <td>{student.full_name}<br /><small>{student.student_id}</small></td>
                {visibleAssessments.map((assessment) => {
                  const profile = data?.profiles.find((item) => item.student_id === student.student_id)
                  const mark = data?.marks.find((item) => item.assessment_id === assessment.id && item.student_id === profile?.id)
                  const key = `${assessment.id}:${profile?.id}`
                  return <td key={assessment.id}><div className="mark-cell"><input value={markEdits[key] ?? mark?.value ?? ''} onChange={(event) => setMarkEdits({ ...markEdits, [key]: event.target.value })} /><button title="Save mark" onClick={() => void saveMark(assessment, student.student_id)}><Save size={14} /></button><button title="Delete mark" onClick={() => void removeMark(assessment, student.student_id)}><Trash2 size={14} /></button></div></td>
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
        {!students.length ? <EmptyState title="No students available" body="Add or import students before entering marks." icon={<Grid3X3 size={22} />} /> : null}
      </Card> : null}
    </>
  )
}
