import { lazy, Suspense, Component } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import LoginPage from './components/LoginPage';

const KPIManagement    = lazy(() => import('./components/KPIManagement'));
const WeightManagement = lazy(() => import('./components/WeightManagement'));
const KpiInputModule   = lazy(() => import('./components/KpiInputModule'));
const DanhSachNVModule = lazy(() => import('./components/DanhSachNV'));
const KpiReport        = lazy(() => import('./components/KpiReport'));

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 text-center px-6">
          <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
            <span className="text-2xl">⚠️</span>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Đã xảy ra lỗi không mong muốn</p>
            <p className="text-sm text-slate-400 mt-1">Thử tải lại trang để khắc phục.</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary"
          >
            Tải lại trang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function LoadingFallback() {
  return (
    <div className="flex h-screen items-center justify-center text-slate-400 text-sm gap-2.5">
      <span className="spinner" /> Đang tải...
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingFallback />;
  if (!user) return <LoginPage />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
    <BrowserRouter>
    <ErrorBoundary>
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Dashboard />} />

          <Route path="kpi">
            <Route index element={<Navigate to="thuvien" replace />} />
            <Route path=":tab" element={<KPIManagement />} />
          </Route>

          <Route path="trongso">
            <Route index element={<Navigate to="cauhinh" replace />} />
            <Route path=":tab" element={<WeightManagement />} />
          </Route>

          <Route path="nhanvien">
            <Route index element={<Navigate to="thuvienNV" replace />} />
            <Route path=":tab" element={<DanhSachNVModule />} />
          </Route>

          <Route path="nhaplieu">
            <Route index element={<Navigate to="nhaplieu" replace />} />
            <Route path=":tab" element={<KpiInputModule />} />
          </Route>

          <Route path="baocao">
            <Route index element={<Navigate to="phong" replace />} />
            <Route path=":tab" element={<KpiReport />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
    </ErrorBoundary>
    </BrowserRouter>
    </AuthProvider>
  );
}
