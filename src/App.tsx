import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { AppShell, Spinner } from './components/Layout'
import { AdminStudents } from './pages/AdminStudents'
import { AttendanceTerminal } from './pages/AttendanceTerminal'
import { Audit } from './pages/Audit'
import { BiometricProcessing } from './pages/BiometricProcessing'
import { Dashboard } from './pages/Dashboard'
import { FaceRegistration } from './pages/FaceRegistration'
import { Issues } from './pages/Issues'
import { Login } from './pages/Login'
import { MarksImports } from './pages/MarksImports'

function Protected() {
  const auth = useAuth()
  if (!auth.ready) return <Spinner />
  return auth.signedIn ? <AppShell /> : <Navigate to="/login" replace />
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
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="/admin/students" element={<RequireRole role="admin"><AdminStudents /></RequireRole>} />
        <Route path="/admin/biometrics" element={<RequireRole role="admin"><BiometricProcessing /></RequireRole>} />
        <Route path="/admin/attendance" element={<RequireRole role="admin"><AttendanceTerminal /></RequireRole>} />
        <Route path="/admin/marks" element={<RequireRole role="admin"><MarksImports /></RequireRole>} />
        <Route path="/admin/issues" element={<RequireRole role="admin"><Issues /></RequireRole>} />
        <Route path="/admin/audit" element={<RequireRole role="admin"><Audit /></RequireRole>} />
        <Route path="/student/face" element={<RequireRole role="student"><FaceRegistration /></RequireRole>} />
        <Route path="/student/issues" element={<RequireRole role="student"><Issues /></RequireRole>} />
      </Route>
    </Routes>
  )
}
