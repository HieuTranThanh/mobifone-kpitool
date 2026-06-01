/**
 * @file Layout.jsx
 * @description Shell giao diện chính — sidebar navigation + sync Supabase khi app khởi động.
 *
 * CHỨC NĂNG:
 * - Render sidebar navigation với các menu theo role (filtered).
 * - Khi app mount: gọi getAll() kéo toàn bộ data từ Supabase về localStorage.
 * - Hiển thị thông tin user, role badge, nút đăng xuất.
 * - Nút ⚙️ Cài đặt chỉ hiện với admin.
 *
 * PHÂN QUYỀN:
 * - admin: tất cả menu
 * - department_editor: nhanvien, kpi, trongso, nhaplieu (bỏ cauhinh_xeploai), baocao
 * - company_viewer: chỉ dashboard + baocao
 * - department_viewer: chỉ dashboard + baocao
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { checkNavGuard } from '../utils/navGuard';
import { isConnected, getAll, setPhongId, getPhongList } from '../services/supabaseService';
import { saveKpiLibrary, saveNhomLibrary, saveNvLibrary, saveNhomCvLibrary, saveKvLibrary, saveOutputDiem, trimInputCNCache } from '../services/store';
import { useAuth, canAdmin, canViewAll, ROLE_LABELS } from '../contexts/AuthContext';
import SettingsModal from './SettingsModal';

// Màu dot theo vị trí submenu (1st=blue, 2nd=teal, 3rd=purple, 4th=orange)
const SUBMENU_DOT = ['bg-blue-400', 'bg-teal-400', 'bg-purple-400', 'bg-orange-400'];

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  {
    label: 'Danh sách nhân viên', icon: '👥', base: '/nhanvien',
    children: [
      { to: '/nhanvien/thuvienNV', label: 'Thư viện nhân viên' },
      { to: '/nhanvien/nvthang',   label: 'Nhân viên theo tháng' },
    ],
  },
  {
    label: 'Quản lý KPI', icon: '📋', base: '/kpi',
    children: [
      { to: '/kpi/thuvien',  label: 'Thư viện KPI' },
      { to: '/kpi/template', label: 'Tạo template KPI' },
      { to: '/kpi/thang',    label: 'KPI theo tháng' },
    ],
  },
  {
    label: 'Quản lý trọng số', icon: '⚖️', base: '/trongso',
    children: [
      { to: '/trongso/cauhinh', label: 'Cấu hình trọng số' },
      { to: '/trongso/canhan',  label: 'Trọng số cá nhân' },
    ],
  },
  {
    label: 'Nhập liệu KPI', icon: '📝', base: '/nhaplieu',
    children: [
      { to: '/nhaplieu/nhaplieu',        label: 'Nhập liệu KPI cá nhân' },
      { to: '/nhaplieu/nhaplieuphong',   label: 'Nhập liệu KPI phòng' },
      { to: '/nhaplieu/cauhinh_xeploai', label: 'Cấu hình xếp loại' },
    ],
  },
  {
    label: 'Báo cáo KPI', icon: '📄', base: '/baocao',
    children: [
      { to: '/baocao/phong',  label: 'Báo cáo KPI Phòng' },
      { to: '/baocao/canhan', label: 'Báo cáo KPI Cá nhân' },
    ],
  },
];

// Bases được phép truy cập theo role
const ROLE_ALLOWED = {
  admin:             ['/', '/nhanvien', '/kpi', '/trongso', '/nhaplieu', '/baocao'],
  department_editor: ['/', '/nhanvien', '/kpi', '/trongso', '/nhaplieu', '/baocao'],
  company_viewer:    ['/', '/baocao'],
  department_viewer: ['/', '/baocao'],
};

export function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
      <span className="text-5xl">🔒</span>
      <p className="font-medium text-slate-500">Bạn không có quyền truy cập trang này</p>
    </div>
  );
}

// Switcher phòng cho admin/company_viewer — phải chọn đúng 1 phòng, không có "Tất cả"
function PhongSwitcher({ selectedId, onChange, phongList }) {
  return (
    <select
      value={selectedId}
      onChange={e => onChange(e.target.value)}
      className="w-full mt-1.5 text-xs bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500 cursor-pointer transition-colors"
    >
      <option value="" disabled>— Chọn phòng —</option>
      {phongList.map(p => (
        <option key={p.id} value={p.id}>{p.ten_phong}</option>
      ))}
    </select>
  );
}

export default function Layout() {
  const { user, logout }                = useAuth();
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected]       = useState(isConnected);
  const [refreshKey, setRefreshKey]     = useState(0);
  const [pulling, setPulling]           = useState(false);
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [phongList, setPhongList]       = useState([]);
  // Admin/company_viewer: phải chọn phòng trước khi xem data; '' = chưa chọn
  const [selectedPhongId, setSelectedPhongId] = useState('');
  const location  = useLocation();
  const navigate  = useNavigate();
  const [expandedBase, setExpandedBase] = useState(() => {
    const match = NAV.find(item => item.children && location.pathname.startsWith(item.base));
    return match?.base || null;
  });

  useEffect(() => {
    getPhongList().then(setPhongList).catch(() => {});
  }, []);

  // Sync phong_id từ user.phong_id khi login
  useEffect(() => {
    if (user?.phong_id) setPhongId(user.phong_id);
  }, [user?.phong_id]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const toggleMenu = (base, firstChildTo) => {
    if (expandedBase === base) {
      setExpandedBase(null);
    } else {
      if (!checkNavGuard()) return;
      setExpandedBase(base);
      navigate(firstChildTo);
    }
  };

  // Filter nav theo role; nếu role chưa được gán thì chỉ hiện Dashboard
  const visibleNav = useMemo(() => {
    const role = user?.role;
    if (!role) return NAV.filter(item => !item.children); // chỉ Dashboard
    const allowed = ROLE_ALLOWED[role] || [];
    return NAV
      .filter(item => allowed.some(a => (item.base ?? item.to) === a))
      .map(item => {
        if (!item.children) return item;
        const children = role === 'department_editor'
          ? item.children.filter(c => !c.to.includes('cauhinh_xeploai'))
          : item.children;
        return { ...item, children };
      });
  }, [user?.role]);

  // loadData: fetch toàn bộ data từ Supabase về localStorage rồi re-mount Outlet.
  // Gọi khi app mount VÀ khi user switch phòng.
  function loadData() {
    if (!isConnected()) return;
    // Xóa TOÀN BỘ cache phong-specific để tránh data phòng cũ rò rỉ sang phòng mới.
    // Chỉ giữ lại các key hệ thống (kết nối Supabase, auth session).
    const KEEP_KEYS = new Set(['supabase_url', 'supabase_anon_key', 'phong_id', 'sb-kpi-auth']);
    const PHONG_PREFIXES = [
      'kpi_snapshot_', 'nv_snapshot_', 'trong_so_thang_', 'input_phong_',
      'locked_cn_', 'locked_phong_', 'trong_so_weights_', 'output_meta_', 'month_note_',
    ];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || KEEP_KEYS.has(k)) continue;
      if (PHONG_PREFIXES.some(p => k.startsWith(p))) { localStorage.removeItem(k); continue; }
      // Các key phong-specific còn lại (library, cache output/input, config)
      const PHONG_EXACT = ['kpi_library', 'nhom_library', 'nv_library', 'nv_list',
        'nhom_cv_library', 'kv_library', 'kpi_list', 'nhom_list',
        'nhom_cv_list', 'khu_vuc_list', 'trong_so', 'xep_loai_config',
        'output_diem', 'output_chitiet', 'input_cn'];
      if (PHONG_EXACT.includes(k)) localStorage.removeItem(k);
    }
    setPulling(true);
    getAll()
      .then(res => {
        if (Array.isArray(res.kpiLibrary))    saveKpiLibrary(res.kpiLibrary);
        if (Array.isArray(res.nhomLibrary))   saveNhomLibrary(res.nhomLibrary);
        if (Array.isArray(res.nvLibrary))     saveNvLibrary(res.nvLibrary);
        if (Array.isArray(res.nhomCvLibrary)) saveNhomCvLibrary(res.nhomCvLibrary);
        if (Array.isArray(res.kvLibrary))     saveKvLibrary(res.kvLibrary);
        const DEDICATED = new Set(['kpi_library', 'nhom_library', 'nv_list', 'nv_library', 'nhom_cv_library', 'kv_library']);
        const store = res.store || {};
        localStorage.setItem('kpi_list',  JSON.stringify(store.kpi_list  ?? []));
        localStorage.setItem('nhom_list', JSON.stringify(store.nhom_list ?? []));
        Object.entries(store).forEach(([key, val]) => {
          if (key === 'kpi_list' || key === 'nhom_list') return;
          if (key.startsWith('output_diem_')) return;
          if (!DEDICATED.has(key)) {
            localStorage.setItem(key, JSON.stringify(val));
          }
        });
        if (Array.isArray(res.outputDiem) && res.outputDiem.length > 0) {
          saveOutputDiem(res.outputDiem);
        }
        trimInputCNCache(6);
        setRefreshKey(k => k + 1);
      })
      .catch(() => {})
      .finally(() => setPulling(false));
  }

  useEffect(() => {
    // Global viewers (admin/company_viewer): chờ chọn phòng trước khi load
    if (canViewAll(user) && !selectedPhongId) return;
    loadData();
  // Chạy lại khi user.phong_id thay đổi (dept user resolve sau auth có thể khác DEFAULT_PHONG_ID)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.phong_id]);

  function handlePhongChange(phongId) {
    setSelectedPhongId(phongId);
    setPhongId(phongId);
    loadData();
  }

  const handleSettingsClose = () => {
    setShowSettings(false);
    setConnected(isConnected());
  };

  const sidebarContent = (
    <>
      {/* Sidebar Header */}
      <div className="px-4 py-5 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">MobiFone Đắk Lắk</p>
            <h1 className="text-sm font-bold leading-tight text-white mt-0.5">KPI Tool</h1>
          </div>
          <button
            onClick={closeSidebar}
            className="md:hidden text-slate-400 hover:text-white p-1 rounded transition-colors"
            aria-label="Đóng menu"
          >✕</button>
        </div>
        {canViewAll(user)
          ? <PhongSwitcher selectedId={selectedPhongId} onChange={handlePhongChange} phongList={phongList} />
          : <p className="text-xs text-slate-400 mt-1">
              {phongList.find(p => p.id === user?.phong_id)?.ten_phong || '—'}
            </p>
        }
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 space-y-0.5 px-3 overflow-y-auto">
        {!user?.role && (
          <div className="mb-3 px-3 py-2.5 bg-amber-900/30 border border-amber-600/40 rounded-lg text-xs text-amber-300">
            ⚠️ Tài khoản chưa được gán role. Liên hệ admin hoặc vào <strong>Cài đặt → Người dùng</strong>.
          </div>
        )}
        {visibleNav.map(item => {
          if (!item.children) {
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={(e) => { if (!checkNavGuard()) { e.preventDefault(); return; } closeSidebar(); }}
                className={({ isActive }) =>
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ' +
                  (isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white')
                }
              >
                <span className="text-base shrink-0">{item.icon}</span>
                {item.label}
              </NavLink>
            );
          }

          const isOpen = expandedBase === item.base;

          return (
            <div key={item.base}>
              <button
                onClick={() => toggleMenu(item.base, item.children[0].to)}
                className={
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ' +
                  (isOpen
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white')
                }
              >
                <span className="text-base shrink-0">{item.icon}</span>
                <span className="flex-1 text-left">{item.label}</span>
                <span className="text-slate-500 text-xs">{isOpen ? '▾' : '▸'}</span>
              </button>

              {isOpen && (
                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-700/60 pl-2">
                  {item.children.map((child, childIdx) => (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      onClick={(e) => { if (!checkNavGuard()) { e.preventDefault(); return; } closeSidebar(); }}
                      className={({ isActive }) =>
                        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ' +
                        (isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200')
                      }
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SUBMENU_DOT[childIdx] ?? 'bg-slate-400'}`} />
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Sidebar Footer */}
      <div className="px-2 py-3 border-t border-slate-700/50 space-y-0.5 shrink-0">
        <div className="px-3 py-2 space-y-0.5">
          <p className="text-xs font-semibold text-slate-200 truncate">{user?.display_name || user?.email}</p>
          <p className="text-xs text-slate-500">{ROLE_LABELS[user?.role] || user?.role}</p>
        </div>

        {(canAdmin(user) || !user?.role) && (
          <button
            onClick={() => { setShowSettings(true); closeSidebar(); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <span>⚙️</span>
            <span>Cài đặt</span>
            {connected
              ? <span className="ml-auto w-2 h-2 rounded-full bg-green-400 shrink-0" title="Đã kết nối Supabase" />
              : <span className="ml-auto w-2 h-2 rounded-full bg-yellow-400 shrink-0" title="Chưa cấu hình Supabase" />
            }
          </button>
        )}

        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <span>🚪</span>
          <span>Đăng xuất</span>
        </button>

        <p className="text-xs text-slate-600 px-3">v1.0 · {new Date().getFullYear()}</p>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar — desktop: luôn hiện; mobile: slide overlay */}
      <aside className={
        'fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-white flex flex-col shrink-0 no-print transition-transform duration-200 ' +
        'md:static md:w-60 md:translate-x-0 ' +
        (sidebarOpen ? 'translate-x-0' : '-translate-x-full')
      }>
        {sidebarContent}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto min-w-0">
        {/* Topbar mobile */}
        <div className="md:hidden flex items-center gap-3 px-3 py-2.5 bg-slate-900 text-white no-print">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-400 hover:text-white p-1 rounded text-xl leading-none transition-colors"
            aria-label="Mở menu"
          >☰</button>
          <span className="text-sm font-semibold">KPI Tool</span>
          {pulling && <span className="ml-auto text-xs text-slate-400 animate-pulse">Đang đồng bộ...</span>}
        </div>

        {pulling && (
          <div className="bg-blue-600 text-white text-xs text-center py-1.5 no-print hidden md:block">
            ☁️ Đang đồng bộ dữ liệu từ Supabase...
          </div>
        )}
        {canViewAll(user) && !selectedPhongId
          ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 p-6">
              <span className="text-5xl">🏢</span>
              <p className="font-medium text-slate-500">Chọn phòng để xem dữ liệu</p>
              <p className="text-sm text-slate-400 text-center">Dùng menu bên trái để chọn phòng</p>
            </div>
          )
          : <Outlet key={refreshKey} />
        }
      </main>

      {showSettings && <SettingsModal onClose={handleSettingsClose} />}
    </div>
  );
}
