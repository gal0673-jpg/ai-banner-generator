import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AdminCatalog from './AdminCatalog.jsx'
import AvatarStudio from './AvatarStudio.jsx'
import BannerWorkspace from './BannerWorkspace.jsx'
import { useAuth } from './AuthContext.jsx'
import Login from './Login.jsx'

function ProtectedRoute({ children }) {
  const { user, ready } = useAuth()
  const location = useLocation()

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 text-sm" dir="rtl" lang="he">
        טוען…
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}

export default function App() {
  return (
    <div className="min-h-screen" dir="rtl" lang="he">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <BannerWorkspace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/avatar-studio"
          element={
            <ProtectedRoute>
              <AvatarStudio />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/catalog"
          element={
            <ProtectedRoute>
              <AdminCatalog />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
