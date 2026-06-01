/**
 * @file LoginPage.jsx
 * @description Trang đăng nhập — hiển thị khi chưa có session hợp lệ.
 */
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Vui lòng nhập email và mật khẩu.'); return; }
    setLoading(true); setError('');
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message || 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 space-y-6 border border-slate-100">
        {/* Header */}
        <div className="text-center space-y-1.5">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-2xl mx-auto mb-3">📊</div>
          <h1 className="text-xl font-bold text-slate-900">KPI Tool</h1>
          <p className="text-sm text-slate-500">MobiFone Đắk Lắk · Phòng Viễn thông</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              className="input"
              placeholder="name@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Mật khẩu</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              ❌ {error}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={loading}
          >
            {loading ? '⏳ Đang đăng nhập...' : '🔐 Đăng nhập'}
          </button>
        </form>

        <p className="text-xs text-center text-slate-400">
          Liên hệ quản trị viên nếu quên mật khẩu
        </p>
      </div>
    </div>
  );
}
