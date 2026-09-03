import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { AppShell, Spinner } from './components/Layout'
import { AdminAttendanceReview } from './pages/AdminAttendanceReview'
import { AdminStudents } from './pages/AdminStudents'
import { AttendanceTerminal } from './pages/AttendanceTerminal'
import { Audit } from './pages/Audit'
import { BiometricProcessing } from './pages/BiometricProcessing'
import { ChangePassword } from './pages/ChangePassword'
import { Dashboard } from './pages/Dashboard'
import { FaceRegistration } from './pages/FaceRegistration'
import { Issues } from './pages/Issues'
import { Login } from './pages/Login'
import { MarksImports } from './pages/MarksImports'
import { PendingApproval } from './pages/PendingApproval'
import { StudentAttendance } from './pages/StudentAttendance'

function Protected() {
  const auth = useAuth()
  const location = useLocation()
  if (!auth.ready) return <Spinner />
  if (!auth.signedIn) return <Navigate to="/login" replace />
  if (auth.mustChangePassword && location.pathname !== '/change-password' && location.pathname !== '/reset-password') {
    return <Navigate to="/change-password" replace />
  }
  if (auth.role === 'student' && auth.approvalStatus !== 'approved' && location.pathname !== '/pending-approval') {
    return <Navigate to="/pending-approval" replace />
  }
  return <AppShell />
}

function RequireRole({ role, children }: { role: 'admin' | 'student'; children: React.ReactNode }) {
  const auth = useAuth()
  if (auth.role !== role) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ChangePassword />} />
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/pending-approval" element={<PendingApproval />} />
        <Route path="/admin/students" element={<RequireRole role="admin"><AdminStudents /></RequireRole>} />
        <Route path="/admin/biometrics" element={<RequireRole role="admin"><BiometricProcessing /></RequireRole>} />
        <Route path="/admin/attendance" element={<RequireRole role="admin"><AttendanceTerminal /></RequireRole>} />
        <Route path="/admin/attendance-review" element={<RequireRole role="admin"><AdminAttendanceReview /></RequireRole>} />
        <Route path="/admin/marks" element={<RequireRole role="admin"><MarksImports /></RequireRole>} />
        <Route path="/admin/issues" element={<RequireRole role="admin"><Issues /></RequireRole>} />
        <Route path="/admin/audit" element={<RequireRole role="admin"><Audit /></RequireRole>} />
        <Route path="/student/face" element={<RequireRole role="student"><FaceRegistration /></RequireRole>} />
        <Route path="/student/attendance" element={<RequireRole role="student"><StudentAttendance /></RequireRole>} />
        <Route path="/student/issues" element={<RequireRole role="student"><Issues /></RequireRole>} />
      </Route>
    </Routes>
  )
}
