import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Offline: ManualWeightGrid lưu localStorage, không sync Supabase
vi.mock('../services/supabaseService', () => ({
  isConnected: () => false,
  syncStore: vi.fn(),
  syncWeightConfig: vi.fn(() => Promise.resolve({ ok: true })),
  getInputCN: vi.fn(() => Promise.resolve({ data: [] })),
}));

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

import WeightManagement from '../components/WeightManagement';

const THANG = '2026-06';

// Seed snapshot KPI + NV (định dạng full-object, không cần resolve refs từ library cho KPI;
// NV dùng nvRefs nên cần nv_library tương ứng).
function seedMonth() {
  localStorage.setItem(`kpi_snapshot_${THANG}`, JSON.stringify({
    thang: THANG,
    kpiList: [
      { kpi_id: 'KPI_CN_000001', ten_kpi: 'KPI Một', kpi_cap: 'ca_nhan', stt: 1 },
      { kpi_id: 'KPI_CN_000002', ten_kpi: 'KPI Hai', kpi_cap: 'ca_nhan', stt: 2 },
    ],
    nhomList: [],
  }));
  localStorage.setItem('nv_library', JSON.stringify([
    { nv_id: 'NhanVien_000001', ho_ten: 'Nhân Viên A', archived_at: null },
    { nv_id: 'NhanVien_000002', ho_ten: 'Nhân Viên B', archived_at: null },
  ]));
  localStorage.setItem(`nv_snapshot_${THANG}`, JSON.stringify({
    thang: THANG,
    nvRefs: [
      { nv_id: 'NhanVien_000001', nhom_cv: 'VHKT', khu_vuc: 'KV1', stt: 1 },
      { nv_id: 'NhanVien_000002', nhom_cv: 'VHKT', khu_vuc: 'KV1', stt: 2 },
    ],
    nhomCvList: ['VHKT'],
    khuVucList: ['KV1'],
  }));
  // mode manual, mục tiêu cá nhân = 70đ
  localStorage.setItem(`trong_so_thang_${THANG}`, JSON.stringify({
    thang: THANG, mode: 'manual',
    ty_le: { phong: { chinhanh: 50, phong: 50 }, ca_nhan: { phong: 30, ca_nhan: 70 } },
    nhom_kpi: [], cv_config: {}, cv_priorities: {}, kpi_pct: {}, nv_override: {},
  }));
}

const renderCanhan = () =>
  render(
    <MemoryRouter initialEntries={['/trongso/canhan']}>
      <Routes>
        <Route path="/trongso/:tab" element={<WeightManagement />} />
      </Routes>
    </MemoryRouter>
  );

describe('ManualWeightGrid (tab Trọng số cá nhân — mode manual)', () => {
  beforeEach(() => {
    localStorage.clear();
    seedMonth();
  });

  it('render lưới trọng số với KPI và nhân viên của tháng', async () => {
    renderCanhan();
    expect(await screen.findByText('KPI Một')).toBeInTheDocument();
    expect(screen.getByText('KPI Hai')).toBeInTheDocument();
    expect(screen.getAllByText('Nhân Viên A').length).toBeGreaterThan(0);
    expect(screen.getByText(/Tổng \(mục tiêu: 70đ\)/)).toBeInTheDocument();
  });

  it('Normalize chuẩn hóa tổng trọng số từng NV về đúng mục tiêu 70đ', async () => {
    renderCanhan();
    await screen.findByText('KPI Một');

    // 4 ô nhập: [K1-NVA, K1-NVB, K2-NVA, K2-NVB]
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(4);
    fireEvent.change(inputs[0], { target: { value: '30' } }); // NVA-K1
    fireEvent.change(inputs[2], { target: { value: '40' } }); // NVA-K2 → tổng 70
    fireEvent.change(inputs[1], { target: { value: '10' } }); // NVB-K1
    fireEvent.change(inputs[3], { target: { value: '10' } }); // NVB-K2 → tổng 20

    // Ô tổng từng NV là <span> (loại trừ <strong>70đ</strong> ở dòng "Mục tiêu")
    const totalCells = () => screen.getAllByText(/^\d+(\.\d+)?đ$/, { selector: 'span' });

    // Trước normalize: chỉ NVA đạt 70đ
    expect(totalCells().filter(el => el.textContent === '70đ')).toHaveLength(1);
    expect(screen.getByText('20đ')).toBeInTheDocument();

    fireEvent.click(screen.getByText('⚖️ Normalize'));

    // Sau normalize: cả 2 NV về 70đ
    await waitFor(() =>
      expect(totalCells().filter(el => el.textContent === '70đ')).toHaveLength(2)
    );
    expect(screen.queryByText('20đ')).not.toBeInTheDocument();
  });

  it('Lưu & Sync ghi cột _trong_so vào input_cn (localStorage)', async () => {
    renderCanhan();
    await screen.findByText('KPI Một');
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '35' } }); // NVA-K1
    fireEvent.change(inputs[2], { target: { value: '35' } }); // NVA-K2

    fireEvent.click(screen.getByText('💾 Lưu & Sync'));

    await waitFor(() => {
      const inputCN = JSON.parse(localStorage.getItem('input_cn') || '[]');
      const nva = inputCN.find(r => r.nv_id === 'NhanVien_000001');
      expect(nva?.['KPI_CN_000001_trong_so']).toBe(35);
      expect(nva?.['KPI_CN_000002_trong_so']).toBe(35);
    });
  });
});

// ─── Copy trọng số tự động (auto mode) từ tháng khác ──────────────────────────

const SRC = '2026-05';
const TGT = '2026-06';

function seedAutoCopyScenario() {
  // 2 KPI cá nhân dùng chung cho cả 2 tháng
  const kpiList = [
    { kpi_id: 'KPI_CN_000001', ten_kpi: 'KPI Auto Một', kpi_cap: 'ca_nhan', stt: 1 },
    { kpi_id: 'KPI_CN_000002', ten_kpi: 'KPI Auto Hai', kpi_cap: 'ca_nhan', stt: 2 },
  ];
  localStorage.setItem(`kpi_snapshot_${SRC}`, JSON.stringify({ thang: SRC, kpiList, nhomList: [] }));
  localStorage.setItem(`kpi_snapshot_${TGT}`, JSON.stringify({ thang: TGT, kpiList, nhomList: [] }));

  // Thư viện nhóm CV + NV (để recomputeAllKpiPct và nhomCvList có 'VHKT')
  localStorage.setItem('nhom_cv_library', JSON.stringify([{ nhom_cv_id: 'NC1', ten_nhom_cv: 'VHKT', archived_at: null }]));
  localStorage.setItem('nv_library', JSON.stringify([{ nv_id: 'NhanVien_000001', ho_ten: 'NV A', archived_at: null }]));
  const nvSnap = {
    nvRefs: [{ nv_id: 'NhanVien_000001', nhom_cv: 'VHKT', khu_vuc: 'KV1', stt: 1 }],
    nhomCvList: ['VHKT'], khuVucList: ['KV1'],
  };
  localStorage.setItem(`nv_snapshot_${SRC}`, JSON.stringify({ thang: SRC, ...nvSnap }));
  localStorage.setItem(`nv_snapshot_${TGT}`, JSON.stringify({ thang: TGT, ...nvSnap }));

  const baseTyLe = { phong: { chinhanh: 50, phong: 50 }, ca_nhan: { phong: 30, ca_nhan: 70 } };

  // Tháng NGUỒN: cấu hình auto đầy đủ — nhóm "Nhóm Một" + 2 KPI có ưu tiên
  localStorage.setItem(`trong_so_thang_${SRC}`, JSON.stringify({
    thang: SRC, mode: 'auto', ty_le: baseTyLe, w_max_ref: 40, w_min_ref: 10,
    nhom_kpi: [{ id: 'g1', ten: 'Nhóm Một', pct: 70 }],
    cv_config: { VHKT: { g1: ['KPI_CN_000001', 'KPI_CN_000002'] } },
    cv_priorities: { VHKT: { KPI_CN_000001: 1, KPI_CN_000002: 2 } },
    kpi_pct: {}, nv_override: {},
  }));

  // Tháng ĐÍCH: auto nhưng RỖNG (chưa cấu hình nhóm/KPI)
  localStorage.setItem(`trong_so_thang_${TGT}`, JSON.stringify({
    thang: TGT, mode: 'auto', ty_le: baseTyLe, w_max_ref: 40, w_min_ref: 10,
    nhom_kpi: [], cv_config: {}, cv_priorities: {}, kpi_pct: {}, nv_override: {},
  }));
}

const renderCauhinh = () =>
  render(
    <MemoryRouter initialEntries={['/trongso/cauhinh']}>
      <Routes>
        <Route path="/trongso/:tab" element={<WeightManagement />} />
      </Routes>
    </MemoryRouter>
  );

describe('copyFromMonth (copy trọng số tự động giữa các tháng)', () => {
  beforeEach(() => {
    localStorage.clear();
    seedAutoCopyScenario();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('copy cấu hình auto từ tháng nguồn → tháng đích nhận nhóm KPI + KPI đã gán', async () => {
    renderCauhinh();

    // Tháng đích (2026-06) ban đầu rỗng → chưa có "Nhóm Một"
    await screen.findByText(/Bước 1 — Cấu hình tỷ lệ/);
    expect(screen.getByText(/Chưa có nhóm KPI nào/)).toBeInTheDocument();
    expect(screen.queryByText('Nhóm Một')).not.toBeInTheDocument();

    // Mở picker "Copy từ tháng" rồi bấm Copy (nguồn auto duy nhất = 2026-05)
    fireEvent.click(screen.getByText('📋 Copy từ tháng'));
    await screen.findByText(/Chọn tháng nguồn/);
    const copyBtn = screen.getByRole('button', { name: 'Copy' });
    expect(copyBtn).not.toBeDisabled();
    fireEvent.click(copyBtn);

    // Sau copy: nhóm "Nhóm Một" (Bước 3 + Bước 4) + 2 KPI xuất hiện ở tháng đích
    expect((await screen.findAllByText('Nhóm Một')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('KPI Auto Một').length).toBeGreaterThan(0);
    expect(screen.getAllByText('KPI Auto Hai').length).toBeGreaterThan(0);

    // Vào trạng thái chỉnh sửa chưa lưu (đúng hành vi copyFromMonth)
    expect(screen.getByText(/Có thay đổi chưa lưu/)).toBeInTheDocument();
  });

  it('Lưu & Sync sau copy ghi cv_priorities + kpi_pct (auto) vào trong_so_thang đích', async () => {
    renderCauhinh();
    await screen.findByText(/Bước 1 — Cấu hình tỷ lệ/);

    fireEvent.click(screen.getByText('📋 Copy từ tháng'));
    await screen.findByText(/Chọn tháng nguồn/);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findAllByText('Nhóm Một');

    fireEvent.click(screen.getByText('💾 Lưu & Sync'));

    await waitFor(() => {
      const cfg = JSON.parse(localStorage.getItem(`trong_so_thang_${TGT}`));
      expect(cfg.cv_priorities.VHKT.KPI_CN_000001).toBe(1);
      expect(cfg.cv_priorities.VHKT.KPI_CN_000002).toBe(2);
      // KPI ưu tiên 1 nhận điểm cao nhất (w_max=40), tổng VHKT ≈ 70đ
      expect(cfg.kpi_pct.VHKT.KPI_CN_000001.pct).toBe(40);
      const sum = Object.values(cfg.kpi_pct.VHKT).reduce((s, v) => s + v.pct, 0);
      expect(sum).toBeCloseTo(70, 0);
    });
  });
});
