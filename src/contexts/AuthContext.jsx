/**
 * @file AuthContext.jsx
 * @description Auth state toàn cục — đăng nhập, đăng xuất, thông tin user + role.
 *
 * ROLES:
 * - admin: toàn quyền + quản lý user
 * - department_editor: full quyền mức phòng (own phong_id), không vào Settings
 * - company_viewer: chỉ Dashboard + Báo cáo, xem tất cả phòng
 * - department_viewer: chỉ Dashboard + Báo cáo, chỉ phòng mình
 *
 * PERMISSION HELPERS (export):
 * - canAdmin(user): admin
 * - canViewAll(user): admin hoặc company_viewer
 * - canEditDept(user): admin hoặc department_editor
 */
import { createContext, useContext, useState, useEffect } from 'react';
import { authSignIn, authSignOut, onAuthStateChange, getAuthSession, getAppUserProfile, setPhongId } from '../services/supabaseService';

const AuthCtx = createContext(null);

const LOGIN_DATE_KEY = 'sb-kpi-login-day';
const getTodayStr = () => new Date().toISOString().slice(0, 10);

export const ROLE_LABELS = {
  admin:             'Quản trị hệ thống',
  department_editor: 'Quản lý KPI phòng',
  company_viewer:    'Xem KPI toàn công ty',
  department_viewer: 'Xem KPI phòng',
};

export const canAdmin    = (u) => u?.role === 'admin';
export const canViewAll  = (u) => u?.role === 'admin' || u?.role === 'company_viewer';
export const canEditDept = (u) => u?.role === 'admin' || u?.role === 'department_editor';

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function _loadUser(session) {
      if (!session) {
        if (mounted) { setUser(null); setLoading(false); }
        return;
      }
      // Session chỉ hợp lệ trong ngày đăng nhập — qua ngày mới tự đăng xuất
      const loginDay = localStorage.getItem(LOGIN_DATE_KEY);
      if (!loginDay || loginDay !== getTodayStr()) {
        await authSignOut();
        localStorage.removeItem(LOGIN_DATE_KEY);
        if (mounted) { setUser(null); setLoading(false); }
        return;
      }
      try {
        const profile = await getAppUserProfile(session.user.id);
        const u = { id: session.user.id, email: session.user.email, ...(profile || {}) };
        if (mounted) { setUser(u); setLoading(false); }
        if (u.phong_id) setPhongId(u.phong_id);
      } catch {
        if (mounted) { setUser({ id: session.user.id, email: session.user.email }); setLoading(false); }
      }
    }

    // Fallback: nếu Supabase không trả về trong 5s, về màn hình đăng nhập
    const timer = setTimeout(() => { if (mounted) { setUser(null); setLoading(false); } }, 5000);

    getAuthSession()
      .then(session => { clearTimeout(timer); _loadUser(session); })
      .catch(() => { clearTimeout(timer); if (mounted) { setUser(null); setLoading(false); } });
    const unsubscribe = onAuthStateChange((_, session) => { clearTimeout(timer); _loadUser(session); });
    return () => { mounted = false; clearTimeout(timer); unsubscribe(); };
  }, []);

  async function login(email, password) {
    localStorage.setItem(LOGIN_DATE_KEY, getTodayStr());
    await authSignIn(email, password);
  }

  async function logout() {
    await authSignOut();
    localStorage.removeItem(LOGIN_DATE_KEY);
    setUser(null);
  }

  async function refreshUser() {
    try {
      const session = await getAuthSession();
      if (!session) return;
      const profile = await getAppUserProfile(session.user.id);
      setUser(u => ({ ...u, ...(profile || {}) }));
    } catch {}
  }

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
