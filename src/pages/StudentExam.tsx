import { ExternalLink, KeyRound, ShieldCheck, TimerReset } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FormEvent, useState } from 'react'
import { useAuth } from '../auth'
import { Card, EmptyState, IconButton, PageHeader, Spinner, StatusPill } from '../components/Layout'
import { loadAppData, recordExamLinkOpened, verifyExamAccessCode } from '../lib/api'

export function StudentExam() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData, refetchInterval: 15_000 })
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [checking, setChecking] = useState('')

  if (isLoading) return <Spinner />
  if (!data) return null

  const studentId = auth.session?.user.id
  const accesses = data.examAccess.filter((access) => access.student_id === studentId && access.approved_at)

  async function verify(event: FormEvent, accessId: string) {
    event.preventDefault()
    setChecking(accessId)
    setMessage('')
    try {
      const valid = await verifyExamAccessCode(accessId, codes[accessId] ?? '')
      if (!valid) throw new Error('The verification code is incorrect or the exam window is not open.')
      setMessage('Identity code verified. Your individual Unstop link is now enabled.')
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Code verification failed.')
    } finally {
      setChecking('')
    }
  }

  async function openExam(accessId: string) {
    const popup = window.open('about:blank', '_blank')
    if (popup) popup.opener = null
    try {
      const url = await recordExamLinkOpened(accessId)
      if (popup) popup.location.href = url
      else window.location.assign(url)
      await queryClient.invalidateQueries({ queryKey: ['app-data'] })
    } catch (error) {
      popup?.close()
      setMessage(error instanceof Error ? error.message : 'The exam link could not be opened.')
    }
  }

  return <>
    <PageHeader eyebrow="Secure assessment" title="My exam access">
      Exam links appear only after face attendance and staff approval. Your link is individual and must not be shared.
    </PageHeader>
    {message ? <p className="notice">{message}</p> : null}
    {!accesses.length ? <EmptyState title="No approved exam access" body="Complete face attendance first. Your exam will appear after an administrator approves you." icon={<ShieldCheck size={22} />} /> : <div className="exam-access-list">
      {accesses.map((access) => {
        const exam = data.exams.find((item) => item.id === access.exam_id)
        if (!exam) return null
        const now = Date.now()
        const windowOpen = exam.status === 'open' && (!exam.starts_at || now >= new Date(exam.starts_at).getTime()) && (!exam.ends_at || now <= new Date(exam.ends_at).getTime())
        const exitReleased = Boolean(exam.exit_release_at && now >= new Date(exam.exit_release_at).getTime())
        return <Card key={access.id} className="student-exam-card">
          <div className="section-title"><div><p className="eyebrow">{exam.course_code}</p><h2>{exam.title}</h2></div><StatusPill tone={windowOpen ? 'good' : 'warn'}>{windowOpen ? 'Exam window open' : exam.status}</StatusPill></div>
          {exam.instructions ? <p>{exam.instructions}</p> : null}
          <div className="exam-chain">
            <span className="complete"><ShieldCheck size={16} />Face attendance verified</span>
            <span className="complete"><ShieldCheck size={16} />Staff approved</span>
            <span className={access.code_verified_at ? 'complete' : ''}><KeyRound size={16} />Code {access.code_verified_at ? 'verified' : 'required'}</span>
            <span className={access.link_opened_at ? 'complete' : ''}><ExternalLink size={16} />Link {access.link_opened_at ? 'opened' : 'locked'}</span>
          </div>
          {!access.code_verified_at ? <form className="exam-code-form" onSubmit={(event) => void verify(event, access.id)}>
            <label>Student verification code <small>Hint: ends in {access.verification_code_hint}</small><input value={codes[access.id] ?? ''} onChange={(event) => setCodes({ ...codes, [access.id]: event.target.value.toUpperCase() })} required autoComplete="one-time-code" /></label>
            <IconButton className="primary" type="submit" disabled={!windowOpen || checking === access.id}><KeyRound size={16} />{checking === access.id ? 'Checking...' : 'Verify code'}</IconButton>
          </form> : <IconButton className="primary exam-link-button" disabled={!windowOpen} onClick={() => void openExam(access.id)}><ExternalLink size={17} />Go to my Unstop assessment</IconButton>}
          <div className={`exit-instruction ${exitReleased ? 'released' : ''}`}>
            <TimerReset size={18} />
            <div><strong>Final exit verification</strong><p>{exitReleased ? (exam.exit_instruction || 'Follow the announced exit-code instruction and enter your code in the mandatory final assessment question.') : `The exit-code instruction will appear at ${exam.exit_release_at ? new Date(exam.exit_release_at).toLocaleTimeString('en-IN') : 'the announced time'}.`}</p></div>
          </div>
        </Card>
      })}
    </div>}
  </>
}
