import { orderReviewQuestions } from './reviewQuestionOrder'
import type { NativeExamReview, NativeExamReviewFlag, NativeQuestion } from './nativeExams'

type Student = { id: string; student_id?: string; full_name?: string }

function csvCell(value: unknown) {
  const raw = String(value ?? '')
  const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

export function reviewFlagsCsv(
  flags: NativeExamReviewFlag[],
  questions: NativeQuestion[],
  reviews: NativeExamReview[],
  students: Student[],
) {
  const ordered = orderReviewQuestions(questions)
  const questionNumber = new Map(ordered.map((question, index) => [question.id, index + 1]))
  const questionById = new Map(ordered.map((question) => [question.id, question]))
  const reviewByStudent = new Map(reviews.map((review) => [review.student_id, review]))
  const studentById = new Map(students.map((student) => [student.id, student]))
  const header = ['Enrollment Number', 'Student Name', 'Question Number', 'Question', 'Student Answer', 'Obtained Marks', 'Flag Reason', 'Status', 'Examiner Response', 'Updated At']
  const rows = flags.map((flag) => {
    const student = studentById.get(flag.student_id)
    const question = questionById.get(flag.question_id)
    const review = reviewByStudent.get(flag.student_id)
    return [student?.student_id ?? '', student?.full_name ?? '', questionNumber.get(flag.question_id) ?? '',
      question?.prompt ?? '', review?.answers[flag.question_id] ?? '', review?.marks[flag.question_id] ?? '',
      flag.reason, flag.status, flag.admin_response ?? '', flag.updated_at]
  })
  return '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
