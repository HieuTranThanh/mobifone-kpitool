/**
 * @file SettingsModal.jsx
 * @description Modal cài đặt — chỉ dành cho admin.
 *
 * CHỨC NĂNG:
 * - Tab "Kết nối": Cấu hình Supabase URL, Anon Key, Phòng ID; kiểm tra kết nối; đồng bộ thư viện.
 * - Tab "Người dùng": Xem/sửa role + display_name của user; thêm user mới vào app_users.
 */
import { useState, useEffect } from 'react';
import {
  getSupabaseUrl, setSupabaseUrl, getAnonKey, setAnonKey,
  getPhongId, setPhongId, ping,
  getAppUsers, updateAppUser, deleteAppUser, insertAppUser, getPhongList,
} from '../services/supabaseService';
import { getNvLibrary, getKpiLibrary, getNhomLibrary, getNhomCvLibrary, getKvLibrary, getKpiRefs, getNhomRefs } from '../services/store';
import { useAuth, ROLE_LABELS } from '../contexts/AuthContext';

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

// ── Tab Kết nối ────────────────────────────────────────────────────
function ConnectionTab() {
  const [supabaseUrl, setSupabaseUrlState] = useState(getSupabaseUrl);
  const [anonKey, setAnonKeyState]         = useState(getAnonKey);
  const [phongId, setPhongIdState]         = useState(getPhongId);
  const [status, setStatus]               = useState('');
  const [testing, setTesting]             = useState(false);
  const [syncStatus, setSyncStatus]       = useState('');

  const handleTest = async () => {
    setTesting(true); setStatus('');
    try {
      setSupabaseUrl(supabaseUrl);
      setAnonKey(anonKey);
      const res = await ping();
      setStatus(`✅ Kết nối Supabase thành công! (${res.time})`);
    } catch (e) {
      setStatus(`❌ Lỗi: ${e.message}`);
    }
    setTesting(false);
  };

  const handleSyncLibraries = async () => {
    if (!import.meta.env.DEV) {
      setSyncStatus('⚠️ Chức năng này chỉ dùng trong môi trường DEV.');
      return;
    }
    const data = {
      kpiLibrary:    getKpiLibrary(),
      nhomLibrary:   getNhomLibrary(),
      nvLibrary:     getNvLibrary(),
      nhomCvLibrary: getNhomCvLibrary(),
      kvLibrary:     getKvLibrary(),
      kpiListRefs:   getKpiRefs(),
      nhomListRefs:  getNhomRefs(),
    };
    const hasAnyData = data.kpiLibrary?.length || data.nhomLibrary?.length || data.nvLibrary?.length
      || data.nhomCvLibrary?.length || data.kvLibrary?.length;
    if (!hasAnyData) {
      setSyncStatus('⚠️ Chưa có dữ liệu cục bộ. Reload app sau khi kết nối để tải về.');
      return;
    }
    try {
      const res = await fetch('/__initial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) { setSyncStatus('❌ Lỗi ghi initialData.js: ' + (await res.json()).error); return; }
      setSyncStatus('✅ Đã ghi dữ liệu thư viện vào initialData.js!');
    } catch (e) { setSyncStatus('❌ ' + e.message); }
  };

  const handleSave = async () => {
    setSupabaseUrl(supabaseUrl);
    setAnonKey(anonKey);
    setPhongId(phongId);
    if (import.meta.env.DEV) {
      try {
        await fetch('/__config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supabaseUrl, supabaseAnonKey: anonKey, phongId }),
        });
      } catch (e) { console.warn('Không thể ghi config.js:', e); }
    }
  };

  return (
    <div className="space-y-5">
      {/* Supabase URL */}
      <div>
        <label className="block font-medium text-sm text-gray-800 mb-1">Supabase Project URL</label>
        <input className="input font-mono text-xs" placeholder="https://xxxxxxxxxxxx.supabase.co"
          value={supabaseUrl} onChange={e => setSupabaseUrlState(e.target.value)} />
      </div>

      {/* Anon Key */}
      <div>
        <label className="block font-medium text-sm text-gray-800 mb-1">Supabase Anon Key (public)</label>
        <input className="input font-mono text-xs" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          value={anonKey} onChange={e => setAnonKeyState(e.target.value)} type="password" />
      </div>

      {/* Phong ID */}
      <div>
        <label className="block font-medium text-sm text-gray-800 mb-1">
          Phòng ID (mặc định) <span className="text-gray-400 font-normal">(UUID từ bảng phong)</span>
        </label>
        <input className="input font-mono text-xs" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={phongId} onChange={e => setPhongIdState(e.target.value)} />
      </div>

      {/* Test kết nối */}
      {supabaseUrl && anonKey && (
        <div>
          <button className="btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? '⏳ Đang kiểm tra...' : '🔌 Kiểm tra kết nối'}
          </button>
          {status && (
            <p className={`mt-2 text-sm ${status.startsWith('✅') ? 'text-green-700' : 'text-red-600'}`}>
              {status}
            </p>
          )}
        </div>
      )}

      {/* Ghi initialData.js — chỉ DEV */}
      {import.meta.env.DEV && (
        <div className="border border-orange-200 rounded-xl p-4 space-y-3">
          <p className="font-semibold text-sm text-gray-800">📄 Ghi thư viện vào initialData.js</p>
          <p className="text-xs text-gray-600 leading-relaxed">
            Lưu dữ liệu thư viện hiện tại từ localStorage vào file <code>initialData.js</code> (dùng khi dev, không ghi đè Supabase).
          </p>
          <button className="btn-secondary text-sm" onClick={handleSyncLibraries}>
            📄 Ghi vào initialData.js
          </button>
          {syncStatus && (
            <p className={`text-xs ${syncStatus.startsWith('✅') ? 'text-green-700' : 'text-orange-600'}`}>
              {syncStatus}
            </p>
          )}
        </div>
      )}

      {/* Hướng dẫn */}
      <details className="bg-gray-50 rounded-xl p-4 text-xs text-gray-700">
        <summary className="font-semibold cursor-pointer text-sm text-gray-800">📖 Hướng dẫn thiết lập Supabase lần đầu</summary>
        <ol className="mt-3 space-y-2 list-decimal list-inside">
          <li>Truy cập <strong>supabase.com</strong> → New project</li>
          <li>Vào <strong>SQL Editor</strong> → paste nội dung file <code>supabase/schema.sql</code> → Run</li>
          <li>Chạy lệnh tạo phòng và copy UUID vào ô "Phòng ID" ở trên</li>
          <li>Vào <strong>Settings → API</strong> → copy "Project URL" và "anon public key"</li>
          <li>Dán vào các ô trên → bấm "Kiểm tra kết nối" → "Lưu cài đặt"</li>
          <li>Bấm "☁️ Đồng bộ thư viện" để đẩy dữ liệu lên Supabase</li>
        </ol>
      </details>

      <button className="btn-primary w-full" onClick={handleSave}>💾 Lưu cài đặt</button>
    </div>
  );
}

// ── Tab Người dùng ─────────────────────────────────────────────────
function UsersTab() {
  const { user: currentUser, refreshUser } = useAuth();
  const [users, setUsers]       = useState([]);
  const [phongs, setPhongs]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [editId, setEditId]     = useState(null);
  const [editData, setEditData] = useState({});
  const [status, setStatus]     = useState('');
  const [showAdd, setShowAdd]   = useState(false);
  const [newUser, setNewUser]   = useState({ id: '', role: 'department_editor', phong_id: '', display_name: '' });

  useEffect(() => {
    Promise.all([getAppUsers(), getPhongList()])
      .then(([us, ps]) => { setUsers(us); setPhongs(ps); })
      .catch(e => setStatus('❌ ' + e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleEdit = (u) => { setEditId(u.id); setEditData({ role: u.role, phong_id: u.phong_id || '', display_name: u.display_name || '' }); };

  const handleSave = async () => {
    setStatus('');
    const roleNoPhong = editData.role === 'admin' || editData.role === 'company_viewer';
    const dataToSave = roleNoPhong ? { ...editData, phong_id: null } : editData;
    try {
      await updateAppUser(editId, dataToSave);
      setUsers(us => us.map(u => u.id === editId ? { ...u, ...dataToSave } : u));
      setEditId(null);
      setStatus('✅ Đã cập nhật.');
      if (editId === currentUser?.id) refreshUser();
    } catch (e) { setStatus('❌ ' + e.message); }
  };

  const handleDelete = async (u) => {
    if (!confirm(`Xóa user "${u.display_name || u.email || u.id}"?\nUser này sẽ không đăng nhập được nữa.`)) return;
    try {
      await deleteAppUser(u.id);
      setUsers(us => us.filter(x => x.id !== u.id));
      setStatus('✅ Đã xóa user.');
    } catch (e) { setStatus('❌ ' + e.message); }
  };

  const handleAddUser = async () => {
    if (!newUser.id.trim()) { setStatus('❌ Vui lòng nhập User ID (UUID từ Supabase Auth).'); return; }
    const roleNoPhong = newUser.role === 'admin' || newUser.role === 'company_viewer';
    const phongIdToSave = roleNoPhong ? null : (newUser.phong_id || null);
    try {
      await insertAppUser({ id: newUser.id.trim(), role: newUser.role, phong_id: phongIdToSave, display_name: newUser.display_name || null });
      const us = await getAppUsers();
      setUsers(us);
      setShowAdd(false);
      setNewUser({ id: '', role: 'department_editor', phong_id: '', display_name: '' });
      setStatus('✅ Đã thêm user.');
    } catch (e) { setStatus('❌ ' + e.message); }
  };

  if (loading) return <p className="text-sm text-gray-400 text-center py-8">⏳ Đang tải...</p>;

  return (
    <div className="space-y-4">
      {status && (
        <p className={`text-xs px-3 py-2 rounded-lg border ${status.startsWith('✅') ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
          {status}
        </p>
      )}

      {/* Bảng user */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-blue-50 border-b border-blue-100">
            <tr>
              <th className="th text-left">Tên hiển thị</th>
              <th className="th text-left hidden sm:table-cell">User ID</th>
              <th className="th text-left">Role</th>
              <th className="th text-left hidden md:table-cell">Phòng ID</th>
              <th className="th text-center w-24">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                {editId === u.id ? (
                  <>
                    <td className="td">
                      <input className="input text-xs py-1" value={editData.display_name}
                        onChange={e => setEditData(d => ({ ...d, display_name: e.target.value }))} />
                    </td>
                    <td className="td text-xs text-gray-400 font-mono hidden sm:table-cell">{u.id.slice(0, 8)}…</td>
                    <td className="td">
                      <select className="input text-xs py-1" value={editData.role}
                        onChange={e => setEditData(d => ({ ...d, role: e.target.value }))}>
                        {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                    <td className="td hidden md:table-cell">
                      {(editData.role === 'admin' || editData.role === 'company_viewer') ? (
                        <span className="text-xs text-gray-400 italic">Dùng PhongSwitcher</span>
                      ) : (
                        <select className="input text-xs py-1" value={editData.phong_id}
                          onChange={e => setEditData(d => ({ ...d, phong_id: e.target.value }))}>
                          <option value="">— Không gán —</option>
                          {phongs.map(p => <option key={p.id} value={p.id}>{p.ten_phong || p.ma_phong}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="td text-center space-x-1">
                      <button onClick={handleSave} className="text-xs text-green-600 hover:text-green-800 font-medium">Lưu</button>
                      <button onClick={() => setEditId(null)} className="text-xs text-gray-400 hover:text-gray-600">Hủy</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="td font-medium text-gray-900">{u.display_name || <span className="text-gray-400">—</span>}</td>
                    <td className="td text-xs text-gray-400 font-mono hidden sm:table-cell">{u.id.slice(0, 8)}…</td>
                    <td className="td">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {ROLE_OPTIONS.find(r => r.value === u.role)?.label || u.role}
                      </span>
                    </td>
                    <td className="td text-xs text-gray-500 font-mono hidden md:table-cell">{u.phong_id ? u.phong_id.slice(0, 8) + '…' : '—'}</td>
                    <td className="td text-center space-x-2">
                      <button onClick={() => handleEdit(u)} className="text-xs text-blue-600 hover:text-blue-800">✏️</button>
                      <button onClick={() => handleDelete(u)} className="text-xs text-red-400 hover:text-red-600">🗑️</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="td text-center text-gray-400 py-8">Chưa có user nào.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Thêm user */}
      {showAdd ? (
        <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
          <p className="font-semibold text-sm text-blue-800">➕ Thêm user vào hệ thống</p>
          <p className="text-xs text-blue-600">
            Tạo user trong Supabase Dashboard → Authentication → Users trước, sau đó copy UUID vào đây.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">User ID (UUID)</label>
              <input className="input text-xs font-mono" placeholder="xxxxxxxx-xxxx-..." value={newUser.id}
                onChange={e => setNewUser(u => ({ ...u, id: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tên hiển thị</label>
              <input className="input text-xs" placeholder="Nguyễn Văn A" value={newUser.display_name}
                onChange={e => setNewUser(u => ({ ...u, display_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
              <select className="input text-xs" value={newUser.role}
                onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Phòng {(newUser.role === 'department_editor' || newUser.role === 'department_viewer') && <span className="text-red-500">*</span>}
              </label>
              {(newUser.role === 'admin' || newUser.role === 'company_viewer') ? (
                <p className="text-xs text-gray-400 italic mt-1">Không cần — dùng PhongSwitcher để chọn phòng xem</p>
              ) : (
                <select className="input text-xs" value={newUser.phong_id}
                  onChange={e => setNewUser(u => ({ ...u, phong_id: e.target.value }))}>
                  <option value="">— Chọn phòng —</option>
                  {phongs.map(p => <option key={p.id} value={p.id}>{p.ten_phong || p.ma_phong}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={handleAddUser}>Thêm user</button>
            <button className="btn-secondary text-sm" onClick={() => setShowAdd(false)}>Hủy</button>
          </div>
        </div>
      ) : (
        <button className="btn-secondary text-sm" onClick={() => setShowAdd(true)}>➕ Thêm user mới</button>
      )}
    </div>
  );
}

// ── Modal chính ────────────────────────────────────────────────────
export default function SettingsModal({ onClose }) {
  const [tab, setTab] = useState('connection');

  const TABS = [
    { id: 'connection', label: '🔌 Kết nối' },
    { id: 'users',      label: '👥 Người dùng' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl sm:mx-4 max-h-[92vh] sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b shrink-0">
          <h3 className="font-bold text-lg">⚙️ Cài đặt hệ thống</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-4 sm:px-6 shrink-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {tab === 'connection' && <ConnectionTab />}
          {tab === 'users'      && <UsersTab />}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-4 border-t flex justify-end shrink-0">
          <button className="btn-secondary" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
