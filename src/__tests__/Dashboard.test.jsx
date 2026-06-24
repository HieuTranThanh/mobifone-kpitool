import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Chạy offline: isConnected()=false → Dashboard chỉ đọc localStorage, không gọi Supabase
vi.mock('../services/supabaseService', () => ({
  isConnected: () => false,
  getDiemThang: vi.fn(),
}));

// Cô lập khỏi AuthContext thật (tránh async Supabase khi mount)
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' } }),
  canEditDept: (u) => u?.role === 'admin' || u?.role === 'department_editor',
}));

import Dashboard from '../components/Dashboard';

const renderDashboard = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Dashboard />
    </MemoryRouter>
  );

describe('Dashboard (offline)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hiển thị empty state khi chưa có dữ liệu tháng nào', async () => {
    renderDashboard();
    expect(await screen.findByText(/Chưa có dữ liệu KPI nào/)).toBeInTheDocument();
  });

  it('render bảng kết quả + thống kê xếp loại từ output_diem trong localStorage', async () => {
    localStorage.setItem('output_diem', JSON.stringify([
      {
        thang: '2026-06', nv_id: 'NhanVien_000001', ho_ten: 'Nguyễn Văn A',
        nhom_cv: 'VHKT', khu_vuc: 'Toàn tỉnh Đắk Lắk',
        diem_phong_dong_gop: 30, diem_ca_nhan: 72, tong_diem: 102, xep_loai: 'A',
      },
      {
        thang: '2026-06', nv_id: 'NhanVien_000002', ho_ten: 'Trần Thị B',
        nhom_cv: 'Tối ưu', khu_vuc: 'Tây Đắk Lắk',
        diem_phong_dong_gop: 30, diem_ca_nhan: 65, tong_diem: 95, xep_loai: 'C',
      },
    ]));

    renderDashboard();

    // Tên NV xuất hiện (cả ở biểu đồ điểm lẫn bảng kết quả → dùng getAllByText)
    expect((await screen.findAllByText('Nguyễn Văn A')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Trần Thị B').length).toBeGreaterThan(0);

    // Đếm "x/y NV có điểm" — cả 2 NV đều có xep_loai
    await waitFor(() =>
      expect(screen.getByText(/2\/2 NV có điểm/)).toBeInTheDocument()
    );
  });

  it('NV chưa có điểm (xep_loai null) hiển thị là "Chưa có điểm" trong thống kê', async () => {
    localStorage.setItem('output_diem', JSON.stringify([
      {
        thang: '2026-06', nv_id: 'NhanVien_000003', ho_ten: 'Lê Văn C',
        nhom_cv: 'Hạ tầng', khu_vuc: 'Đông Đắk Lắk',
        diem_phong_dong_gop: null, diem_ca_nhan: null, tong_diem: null, xep_loai: null,
      },
    ]));

    renderDashboard();
    expect(await screen.findByText('Lê Văn C')).toBeInTheDocument();
    // 0/1 NV có điểm
    await waitFor(() =>
      expect(screen.getByText(/0\/1 NV có điểm/)).toBeInTheDocument()
    );
  });
});
