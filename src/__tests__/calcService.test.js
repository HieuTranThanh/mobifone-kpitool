import { describe, it, expect, beforeEach } from 'vitest';
import { calcMonth } from '../services/calcService';
import {
  saveKpiLibrary, saveNvLibrary, saveKpiSnapshot,
  upsertInputPhong, upsertInputCN,
  saveNhomLibrary, saveTrongSoConfig,
  getOutputDiem, getOutputCT, saveOutputDiem,
  saveXepLoaiConfig,
  saveNhomCvLibrary, saveKvLibrary,
} from '../services/store';

beforeEach(() => {
  localStorage.clear();
});

function setupBasicData(thang = '2026-01') {
  const kpis = [
    { kpi_id: 'KPI_CN_000001', ten_kpi: 'Doanh thu', kpi_cap: 'ca_nhan', upper_gt_lower: true, archived_at: null },
    { kpi_id: 'KPI_PH_000001', ten_kpi: 'KPI Phong', kpi_cap: 'phong', upper_gt_lower: true, archived_at: null },
  ];
  const nhoms = [
    { nhom_id: 'NhomKPI_CN_000001', ten_nhom: 'CN Group', kpi_cap: 'ca_nhan' },
    { nhom_id: 'NhomKPI_PH_000001', ten_nhom: 'PH Group', kpi_cap: 'phong' },
  ];
  saveKpiLibrary(kpis);
  saveNhomLibrary(nhoms);
  saveNhomCvLibrary([{ nhom_cv_id: 'NC1', ten_nhom_cv: 'IT', archived_at: null }]);
  saveKvLibrary([{ kv_id: 'KV1', ten_kv: 'HN', archived_at: null }]);
  saveNvLibrary([{ nv_id: 'NV001', ho_ten: 'Nguyen A', archived_at: null }]);

  saveKpiSnapshot(thang,
    [
      { kpi_id: 'KPI_CN_000001', nhom_id: 'NhomKPI_CN_000001', stt: 1 },
      { kpi_id: 'KPI_PH_000001', nhom_id: 'NhomKPI_PH_000001', stt: 1 },
    ],
    [
      { nhom_id: 'NhomKPI_CN_000001', thu_tu: 'I', kpi_cap: 'ca_nhan' },
      { nhom_id: 'NhomKPI_PH_000001', thu_tu: 'I', kpi_cap: 'phong' },
    ]
  );

  // NV snapshot
  localStorage.setItem(`nv_snapshot_${thang}`, JSON.stringify({
    thang,
    nvRefs: [{ nv_id: 'NV001', nhom_cv: 'IT', khu_vuc: 'HN', stt: 1 }],
    nhomCvList: ['IT'],
    khuVucList: ['HN'],
  }));

  // Phong input
  upsertInputPhong({
    thang,
    diem_kpi_chinhanh: '15',
    diem_kpi_chinhanh_kq: '80',
    KPI_PH_000001_value: 80,
    KPI_PH_000001_lower: 0,
    KPI_PH_000001_upper: 100,
    KPI_PH_000001_trong_so: 20,
    KPI_PH_000001_max_pct: 100,
  });

  // CN input (manual mode with weights)
  upsertInputCN({
    thang,
    nv_id: 'NV001',
    KPI_CN_000001_value: 80,
    KPI_CN_000001_lower: 0,
    KPI_CN_000001_upper: 100,
    KPI_CN_000001_trong_so: 70,
    KPI_CN_000001_max_pct: 100,
    KPI_CN_000001_giam_tru: 100,
  });

  saveXepLoaiConfig({ A_plus: 105, A: 101, B: 100, C: 95 });
}

describe('calcMonth', () => {
  it('calculates scores for manual mode', () => {
    setupBasicData('2026-01');
    const result = calcMonth('2026-01');

    expect(result.success).toBe(true);
    expect(result.so_nv).toBe(1);
    expect(result.diem_phong).toBeGreaterThan(0);

    const diem = getOutputDiem();
    expect(diem).toHaveLength(1);
    expect(diem[0].nv_id).toBe('NV001');
    expect(diem[0].tong_diem).toBeGreaterThan(0);
    expect(['A+', 'A', 'B', 'C', 'D']).toContain(diem[0].xep_loai);

    const ct = getOutputCT();
    expect(ct.length).toBeGreaterThan(0);
    expect(ct[0].kpi_id).toBe('KPI_CN_000001');
  });

  it('calculates scores for auto mode', () => {
    setupBasicData('2026-02');
    saveTrongSoConfig('2026-02', {
      mode: 'auto',
      ty_le: { ca_nhan: { phong: 30, ca_nhan: 70, chinhanh: 50 } },
      cv_config: { IT: { nhom1: ['KPI_CN_000001'] } },
      cv_priorities: { IT: { KPI_CN_000001: 1 } },
      kpi_pct: { IT: { KPI_CN_000001: { pct: 70, custom: false } } },
    });

    const result = calcMonth('2026-02');
    expect(result.success).toBe(true);
    expect(result.so_nv).toBe(1);
  });

  it('merges with existing output (replaces same month)', () => {
    setupBasicData('2026-01');
    saveOutputDiem([{ thang: '2025-12', nv_id: 'NV_OLD', tong_diem: 50 }]);

    calcMonth('2026-01');
    const diem = getOutputDiem();
    expect(diem.some(r => r.thang === '2025-12')).toBe(true);
    expect(diem.some(r => r.thang === '2026-01')).toBe(true);
  });

  it('returns 0 NV when no input', () => {
    const kpis = [{ kpi_id: 'KPI_CN_000001', ten_kpi: 'Test', kpi_cap: 'ca_nhan', archived_at: null }];
    saveKpiLibrary(kpis);
    saveNvLibrary([{ nv_id: 'NV001', ho_ten: 'A', archived_at: null }]);
    localStorage.setItem('nv_snapshot_2026-03', JSON.stringify({
      thang: '2026-03',
      nvRefs: [{ nv_id: 'NV001', nhom_cv: 'IT', khu_vuc: 'HN', stt: 1 }],
    }));

    const result = calcMonth('2026-03');
    expect(result.so_nv).toBe(0);
  });
});
