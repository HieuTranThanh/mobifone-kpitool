import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Offline: không gọi Supabase. Cung cấp đủ tên export mà KpiInputModule import.
vi.mock('../services/supabaseService', () => ({
  isConnected: () => false,
  syncStore: vi.fn(),          // store.syncToSupabase destructure key này khi sync config
  syncInputCNRows: vi.fn(),
  syncInputPhong: vi.fn(),
  getInputCN: vi.fn(() => Promise.resolve({ data: [] })),
  calcMonth: vi.fn(),
  upsertOutputDiem: vi.fn(),
}));

// Mock AuthContext — phải re-export ROLE_LABELS vì SettingsModal (qua Layout) dùng ở module-level.
// Định nghĩa trong factory vì vi.mock được hoist lên đầu file.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' } }),
  canAdmin: (u) => u?.role === 'admin',
  canEditDept: (u) => u?.role === 'admin' || u?.role === 'department_editor',
  canViewAll: (u) => u?.role === 'admin' || u?.role === 'branch_viewer',
  ROLE_LABELS: {
    admin: 'Quản trị hệ thống',
    department_editor: 'Quản lý KPI phòng',
    branch_viewer: 'Xem KPI toàn chi nhánh',
    department_viewer: 'Xem KPI phòng',
  },
}));

import KpiInputModule from '../components/KpiInputModule';

const renderTab = (tab) =>
  render(
    <MemoryRouter initialEntries={[`/nhaplieu/${tab}`]}>
      <Routes>
        <Route path="/nhaplieu/:tab" element={<KpiInputModule />} />
      </Routes>
    </MemoryRouter>
  );

describe('CauHinhXepLoai (tab cấu hình xếp loại)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('render bảng ngưỡng mặc định (A+ 105, A 101, B 100, C 95) ở chế độ chỉ xem', () => {
    renderTab('cauhinh_xeploai');
    expect(screen.getByText('Bảng ngưỡng điểm xếp loại')).toBeInTheDocument();
    expect(screen.getByText('Xuất sắc')).toBeInTheDocument();
    expect(screen.getByText('Không đạt KPI')).toBeInTheDocument();
    expect(screen.getByDisplayValue('105')).toBeInTheDocument();
    expect(screen.getByDisplayValue('95')).toBeInTheDocument();
    // Mặc định read-only: ô nhập bị disabled
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(4);
    expect(inputs[0]).toBeDisabled();
  });

  it('vào chỉnh sửa rồi đặt ngưỡng không hợp lệ → báo lỗi + chặn Lưu', () => {
    renderTab('cauhinh_xeploai');
    fireEvent.click(screen.getByText('✏️ Chỉnh sửa'));
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).not.toBeDisabled();
    // Đặt A+ = 100 (≤ A=101) → vi phạm A+ > A
    fireEvent.change(inputs[0], { target: { value: '100' } });
    expect(screen.getByText(/Ngưỡng không hợp lệ/)).toBeInTheDocument();
    expect(screen.getByText('💾 Lưu & Sync')).toBeDisabled();
  });

  it('chỉnh sửa hợp lệ rồi Lưu → ghi xep_loai_config vào localStorage', () => {
    renderTab('cauhinh_xeploai');
    fireEvent.click(screen.getByText('✏️ Chỉnh sửa'));
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '110' } }); // A+ = 110 (vẫn > A=101)
    fireEvent.click(screen.getByText('💾 Lưu & Sync'));
    const saved = JSON.parse(localStorage.getItem('xep_loai_config'));
    expect(saved).toEqual({ A_plus: 110, A: 101, B: 100, C: 95 });
  });
});
