import { describe, it, expect, beforeEach } from 'vitest';
import {
  getKpiLibrary, saveKpiLibrary, addKpiToLibrary, archiveKpi, deleteKpiPermanently,
  getNhomLibrary, saveNhomLibrary, addNhomToLibrary, deleteNhomPermanently,
  getKpiList, saveKpiList,
  generateKpiId, generateNvId, generateNhomCvId, generateKvId,
  getNvLibrary, saveNvLibrary, addNvToLibrary, deleteNvFromLibrary,
  getInputCN, saveInputCN, upsertInputCN, getInputCNByThang,
  saveOutputDiem, getOutputDiemByThang,
  saveOutputCT, getOutputCTByThangNV,
  upsertInputPhong, getInputPhongByThang,
  getThangList,
  getXepLoaiConfig, saveXepLoaiConfig, DEFAULT_XEP_LOAI_CONFIG,
  getMonthNotes, saveMonthNotes,
  computePhongInputStatus,
  isInputCNLocked, lockInputCN, unlockInputCN,
  isInputPhongLocked, lockInputPhong, unlockInputPhong,
  saveKpiSnapshot, getKpiSnapshot, deleteKpiSnapshot, getSnapshotThangList,
  getNvSnapshot, saveNvSnapshot, deleteNvSnapshot, getSnapshotNvThangList,
  getNvListForThang,
  trimInputCNCache,
  recomputeKpiPctForNhom, recomputeAllKpiPct, computeNvWeights,
  saveNhomCvLibrary,
  saveKvLibrary,
} from '../services/store';

beforeEach(() => {
  localStorage.clear();
});

describe('KPI Library CRUD', () => {
  it('starts empty or with initial data', () => {
    const lib = getKpiLibrary();
    expect(Array.isArray(lib)).toBe(true);
  });

  it('save and load', () => {
    const kpis = [{ kpi_id: 'KPI_CN_000001', ten_kpi: 'Test KPI', archived_at: null }];
    saveKpiLibrary(kpis);
    expect(getKpiLibrary()).toEqual(kpis);
  });

  it('addKpiToLibrary replaces existing', () => {
    saveKpiLibrary([{ kpi_id: 'KPI_CN_000001', ten_kpi: 'Old' }]);
    addKpiToLibrary({ kpi_id: 'KPI_CN_000001', ten_kpi: 'New' });
    const lib = getKpiLibrary();
    expect(lib).toHaveLength(1);
    expect(lib[0].ten_kpi).toBe('New');
  });

  it('archiveKpi sets archived_at', () => {
    saveKpiLibrary([{ kpi_id: 'KPI_CN_000001', ten_kpi: 'Test', archived_at: null }]);
    archiveKpi({ kpi_id: 'KPI_CN_000001' });
    const lib = getKpiLibrary();
    expect(lib[0].archived_at).toBeTruthy();
  });

  it('deleteKpiPermanently removes from library and list', () => {
    saveKpiLibrary([{ kpi_id: 'KPI_CN_000001' }, { kpi_id: 'KPI_CN_000002' }]);
    saveKpiList([{ kpi_id: 'KPI_CN_000001', nhom_id: '', stt: 1 }]);
    deleteKpiPermanently('KPI_CN_000001');
    expect(getKpiLibrary()).toHaveLength(1);
    expect(getKpiLibrary()[0].kpi_id).toBe('KPI_CN_000002');
  });
});

describe('Nhom Library CRUD', () => {
  it('addNhomToLibrary and deleteNhomPermanently', () => {
    saveNhomLibrary([]);
    addNhomToLibrary({ nhom_id: 'NhomKPI_CN_000001', ten_nhom: 'Group 1' });
    expect(getNhomLibrary()).toHaveLength(1);
    deleteNhomPermanently('NhomKPI_CN_000001');
    expect(getNhomLibrary()).toHaveLength(0);
  });
});

describe('KPI List (template refs)', () => {
  it('saveKpiList extracts refs', () => {
    saveKpiLibrary([{ kpi_id: 'KPI_CN_000001', ten_kpi: 'Test', kpi_cap: 'ca_nhan', archived_at: null }]);
    saveKpiList([{ kpi_id: 'KPI_CN_000001', nhom_id: 'N1', stt: 1, ten_kpi: 'Test' }]);
    const list = getKpiList();
    expect(list[0].kpi_id).toBe('KPI_CN_000001');
  });
});

describe('ID generation', () => {
  it('generates sequential KPI IDs', () => {
    saveKpiLibrary([]);
    expect(generateKpiId('ca_nhan')).toBe('KPI_CN_000001');
    saveKpiLibrary([{ kpi_id: 'KPI_CN_000001' }]);
    expect(generateKpiId('ca_nhan')).toBe('KPI_CN_000002');
  });

  it('generates phong KPI IDs', () => {
    saveKpiLibrary([]);
    expect(generateKpiId('phong')).toBe('KPI_PH_000001');
  });

  it('generates NV IDs', () => {
    saveNvLibrary([]);
    expect(generateNvId()).toBe('NhanVien_000001');
  });

  it('generates NhomCV IDs', () => {
    saveNhomCvLibrary([]);
    expect(generateNhomCvId()).toBe('NhomCV_CN_000001');
  });

  it('generates Kv IDs', () => {
    saveKvLibrary([]);
    expect(generateKvId()).toBe('KVQL_VN_000001');
  });
});

describe('NV Library', () => {
  it('CRUD operations', () => {
    saveNvLibrary([]);
    addNvToLibrary({ nv_id: 'NV001', ho_ten: 'Nguyen A' });
    expect(getNvLibrary()).toHaveLength(1);
    deleteNvFromLibrary('NV001');
    expect(getNvLibrary()).toHaveLength(0);
  });
});

describe('Input CN', () => {
  it('upsert and query by thang', () => {
    saveInputCN([]);
    upsertInputCN({ thang: '2026-01', nv_id: 'NV001', KPI_CN_000001_value: 80 });
    upsertInputCN({ thang: '2026-02', nv_id: 'NV001', KPI_CN_000001_value: 90 });
    expect(getInputCNByThang('2026-01')).toHaveLength(1);
    expect(getInputCNByThang('2026-01')[0].KPI_CN_000001_value).toBe(80);
  });

  it('upsert replaces existing row', () => {
    saveInputCN([]);
    upsertInputCN({ thang: '2026-01', nv_id: 'NV001', v: 1 });
    upsertInputCN({ thang: '2026-01', nv_id: 'NV001', v: 2 });
    expect(getInputCN()).toHaveLength(1);
    expect(getInputCN()[0].v).toBe(2);
  });
});

describe('Input Phong', () => {
  it('upsert and query by thang', () => {
    upsertInputPhong({ thang: '2026-01', diem_kpi_chinhanh_kq: 50 });
    const r = getInputPhongByThang('2026-01');
    expect(r.diem_kpi_chinhanh_kq).toBe(50);
  });
});

describe('Output Diem', () => {
  it('save and query by thang', () => {
    saveOutputDiem([
      { thang: '2026-01', nv_id: 'NV001', tong_diem: 95 },
      { thang: '2026-02', nv_id: 'NV001', tong_diem: 100 },
    ]);
    expect(getOutputDiemByThang('2026-01')).toHaveLength(1);
  });
});

describe('Output CT', () => {
  it('save and query by thang+nv', () => {
    saveOutputCT([
      { thang: '2026-01', nv_id: 'NV001', kpi_id: 'K1', diem: 10 },
      { thang: '2026-01', nv_id: 'NV002', kpi_id: 'K1', diem: 20 },
    ]);
    expect(getOutputCTByThangNV('2026-01', 'NV001')).toHaveLength(1);
  });
});

describe('ThangList', () => {
  it('derives from output_diem and input_phong', () => {
    saveOutputDiem([{ thang: '2026-01', nv_id: 'NV001' }]);
    upsertInputPhong({ thang: '2026-02' });
    const list = getThangList();
    expect(list).toContain('2026-01');
    expect(list).toContain('2026-02');
    expect(list[0]).toBe('2026-02');
  });
});

describe('XepLoaiConfig', () => {
  it('returns defaults when nothing saved', () => {
    expect(getXepLoaiConfig()).toEqual(DEFAULT_XEP_LOAI_CONFIG);
  });

  it('saves and loads custom config', () => {
    const cfg = { A_plus: 110, A: 105, B: 100, C: 90 };
    saveXepLoaiConfig(cfg);
    expect(getXepLoaiConfig()).toEqual(cfg);
  });
});

describe('MonthNotes', () => {
  it('returns empty array when nothing saved', () => {
    expect(getMonthNotes('2026-01')).toEqual([]);
  });

  it('saves and loads notes', () => {
    saveMonthNotes('2026-01', [{ id: '1', text: 'Hello', url: '' }]);
    expect(getMonthNotes('2026-01')).toHaveLength(1);
    expect(getMonthNotes('2026-01')[0].text).toBe('Hello');
  });

  it('migrates legacy string to array', () => {
    localStorage.setItem('month_note_2026-01', JSON.stringify('Old note'));
    const notes = getMonthNotes('2026-01');
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe('legacy');
    expect(notes[0].text).toBe('Old note');
  });

  it('removes key when notes are empty', () => {
    saveMonthNotes('2026-01', [{ id: '1', text: 'Hello', url: '' }]);
    saveMonthNotes('2026-01', []);
    expect(localStorage.getItem('month_note_2026-01')).toBeNull();
  });
});

describe('computePhongInputStatus', () => {
  const kpiPhong = [
    { kpi_id: 'KPI_PH_000001' },
    { kpi_id: 'KPI_PH_000002' },
  ];

  it('returns empty when no data', () => {
    expect(computePhongInputStatus({}, kpiPhong)).toBe('empty');
    expect(computePhongInputStatus(null, kpiPhong)).toBe('empty');
  });

  it('returns partial when only some data', () => {
    expect(computePhongInputStatus({ diem_kpi_chinhanh_kq: 10 }, kpiPhong)).toBe('partial');
  });

  it('returns full when all data present', () => {
    const inp = {
      diem_kpi_chinhanh_kq: 10,
      KPI_PH_000001_value: 1, KPI_PH_000001_upper: 2, KPI_PH_000001_lower: 0, KPI_PH_000001_trong_so: 10, KPI_PH_000001_max_pct: 100,
      KPI_PH_000002_value: 1, KPI_PH_000002_upper: 2, KPI_PH_000002_lower: 0, KPI_PH_000002_trong_so: 10, KPI_PH_000002_max_pct: 100,
    };
    expect(computePhongInputStatus(inp, kpiPhong)).toBe('full');
  });
});

describe('Lock input', () => {
  it('CN lock/unlock', () => {
    expect(isInputCNLocked('2026-01')).toBe(false);
    lockInputCN('2026-01');
    expect(isInputCNLocked('2026-01')).toBe(true);
    unlockInputCN('2026-01');
    expect(isInputCNLocked('2026-01')).toBe(false);
  });

  it('Phong lock/unlock', () => {
    expect(isInputPhongLocked('2026-01')).toBe(false);
    lockInputPhong('2026-01');
    expect(isInputPhongLocked('2026-01')).toBe(true);
    unlockInputPhong('2026-01');
    expect(isInputPhongLocked('2026-01')).toBe(false);
  });

  it('groups locks by year', () => {
    lockInputCN('2026-01');
    lockInputCN('2026-02');
    const yearData = JSON.parse(localStorage.getItem('locked_cn_2026'));
    expect(yearData['2026-01']).toBe(true);
    expect(yearData['2026-02']).toBe(true);
  });
});

describe('KPI Snapshot', () => {
  it('save, get, delete', () => {
    saveKpiLibrary([{ kpi_id: 'KPI_CN_000001', ten_kpi: 'Test', kpi_cap: 'ca_nhan', archived_at: null }]);
    saveNhomLibrary([{ nhom_id: 'NhomKPI_CN_000001', ten_nhom: 'Group', kpi_cap: 'ca_nhan' }]);
    saveKpiSnapshot('2026-01',
      [{ kpi_id: 'KPI_CN_000001', nhom_id: 'NhomKPI_CN_000001', stt: 1 }],
      [{ nhom_id: 'NhomKPI_CN_000001', thu_tu: 'I', kpi_cap: 'ca_nhan' }]
    );
    const snap = getKpiSnapshot('2026-01');
    expect(snap.kpiList).toHaveLength(1);
    expect(snap.nhomList).toHaveLength(1);
    expect(getSnapshotThangList()).toContain('2026-01');

    deleteKpiSnapshot('2026-01');
    expect(getKpiSnapshot('2026-01')).toBeNull();
  });
});

describe('NV Snapshot', () => {
  it('save, get, delete', () => {
    saveNvLibrary([{ nv_id: 'NV001', ho_ten: 'Nguyen A', archived_at: null }]);
    saveNhomCvLibrary([{ nhom_cv_id: 'NC1', ten_nhom_cv: 'IT', archived_at: null }]);
    saveKvLibrary([{ kv_id: 'KV1', ten_kv: 'HN', archived_at: null }]);
    saveNvSnapshot('2026-01', [{ nv_id: 'NV001', nhom_cv: 'IT', khu_vuc: 'HN', stt: 1 }]);

    const snap = getNvSnapshot('2026-01');
    expect(snap.nvRefs).toHaveLength(1);
    expect(getSnapshotNvThangList()).toContain('2026-01');

    const nvList = getNvListForThang('2026-01');
    expect(nvList[0].ho_ten).toBe('Nguyen A');

    deleteNvSnapshot('2026-01');
    expect(getNvSnapshot('2026-01')).toBeNull();
  });
});

describe('trimInputCNCache', () => {
  it('trims to maxMonths', () => {
    saveInputCN([
      { thang: '2026-01', nv_id: 'NV1' },
      { thang: '2026-02', nv_id: 'NV1' },
      { thang: '2026-03', nv_id: 'NV1' },
    ]);
    trimInputCNCache(2);
    const months = [...new Set(getInputCN().map(r => r.thang))];
    expect(months).toHaveLength(2);
    expect(months).toContain('2026-03');
    expect(months).toContain('2026-02');
  });
});

describe('recomputeKpiPctForNhom', () => {
  const kpiList = [
    { kpi_id: 'K1', kpi_cap: 'ca_nhan' },
    { kpi_id: 'K2', kpi_cap: 'ca_nhan' },
    { kpi_id: 'K3', kpi_cap: 'ca_nhan' },
  ];

  it('allocates weights based on priority', () => {
    const config = {
      cv_config: { IT: { nhom1: ['K1', 'K2', 'K3'] } },
      cv_priorities: { IT: { K1: 1, K2: 2, K3: 3 } },
      kpi_pct: {},
      w_max_ref: 30, w_min_ref: 10,
      ty_le: { ca_nhan: { ca_nhan: 70 } },
    };
    const result = recomputeKpiPctForNhom('IT', config, kpiList);
    expect(Object.keys(result)).toHaveLength(3);
    const total = Object.values(result).reduce((s, v) => s + v.pct, 0);
    expect(total).toBeCloseTo(70, 0);
    expect(result.K1.pct).toBeGreaterThanOrEqual(result.K2.pct);
    expect(result.K2.pct).toBeGreaterThanOrEqual(result.K3.pct);
  });

  it('handles null priority as 0 points', () => {
    const config = {
      cv_config: { IT: { nhom1: ['K1', 'K2'] } },
      cv_priorities: { IT: { K1: 1 } },
      kpi_pct: {},
      ty_le: { ca_nhan: { ca_nhan: 70 } },
    };
    const result = recomputeKpiPctForNhom('IT', config, kpiList);
    expect(result.K2.pct).toBe(0);
  });

  it('handles fixed priority', () => {
    const config = {
      cv_config: { IT: { nhom1: ['K1', 'K2'] } },
      cv_priorities: { IT: { K1: 'fixed', K2: 1 } },
      kpi_pct: { IT: { K1: { pct: 30, custom: true } } },
      ty_le: { ca_nhan: { ca_nhan: 70 } },
    };
    const result = recomputeKpiPctForNhom('IT', config, kpiList);
    expect(result.K1.pct).toBe(30);
    expect(result.K1.custom).toBe(true);
  });

  it('binds w_max: KPI ưu tiên 1 nhận đúng điểm cao nhất khi ngân sách đủ', () => {
    const config = {
      cv_config: { IT: { nhom1: ['K1', 'K2'] } },
      cv_priorities: { IT: { K1: 1, K2: 2 } },
      kpi_pct: {},
      w_max_ref: 40, w_min_ref: 10,
      ty_le: { ca_nhan: { ca_nhan: 70 } },
    };
    const result = recomputeKpiPctForNhom('IT', config, [
      { kpi_id: 'K1', kpi_cap: 'ca_nhan' },
      { kpi_id: 'K2', kpi_cap: 'ca_nhan' },
    ]);
    // avg=35; b=2*(40-35)=10 → K1=40 (=w_max), K2=30; tổng=70
    expect(result.K1.pct).toBe(40);
    expect(result.K2.pct).toBe(30);
  });

  it('giữ nguyên KPI custom auto và phân bổ phần còn lại cho các KPI auto khác', () => {
    const config = {
      cv_config: { IT: { nhom1: ['K1', 'K2', 'K3'] } },
      cv_priorities: { IT: { K1: 1, K2: 2, K3: 3 } },
      kpi_pct: { IT: { K1: { pct: 30, custom: true } } }, // K1 chỉnh tay 30đ
      w_max_ref: 30, w_min_ref: 5,
      ty_le: { ca_nhan: { ca_nhan: 70 } },
    };
    const result = recomputeKpiPctForNhom('IT', config, kpiList);
    expect(result.K1.pct).toBe(30);
    expect(result.K1.custom).toBe(true);
    // Phần còn lại 70-30=40 chia cho K2,K3 (auto)
    expect(result.K2.pct + result.K3.pct).toBeCloseTo(40, 0);
    expect(result.K2.custom).toBe(false);
  });
});

describe('recomputeAllKpiPct (phân bổ tự động qua nhiều nhóm CV)', () => {
  const kpiList = [
    { kpi_id: 'K1', kpi_cap: 'ca_nhan' },
    { kpi_id: 'K2', kpi_cap: 'ca_nhan' },
  ];

  it('tính kpi_pct cho từng nhóm CV trong thư viện, mỗi nhóm tổng ≈ target', () => {
    saveNhomCvLibrary([
      { nhom_cv_id: 'NC1', ten_nhom_cv: 'IT', archived_at: null },
      { nhom_cv_id: 'NC2', ten_nhom_cv: 'HR', archived_at: null },
    ]);
    const config = {
      cv_config: {
        IT: { nhom1: ['K1', 'K2'] },
        HR: { nhom1: ['K1'] },
      },
      cv_priorities: {
        IT: { K1: 1, K2: 2 },
        HR: { K1: 1 },
      },
      kpi_pct: {},
      w_max_ref: 40, w_min_ref: 10,
      ty_le: { ca_nhan: { ca_nhan: 70 } },
    };
    const result = recomputeAllKpiPct(config, kpiList);
    expect(Object.keys(result.kpi_pct)).toEqual(expect.arrayContaining(['IT', 'HR']));
    const sumIT = Object.values(result.kpi_pct.IT).reduce((s, v) => s + v.pct, 0);
    const sumHR = Object.values(result.kpi_pct.HR).reduce((s, v) => s + v.pct, 0);
    expect(sumIT).toBeCloseTo(70, 0);
    // HR chỉ 1 KPI auto → nhận trọn 70đ
    expect(result.kpi_pct.HR.K1.pct).toBe(70);
    expect(sumHR).toBe(70);
  });
});

describe('computeNvWeights', () => {
  it('applies template weights per nhom_cv', () => {
    const config = {
      kpi_pct: { IT: { K1: { pct: 40 }, K2: { pct: 30 } } },
      nv_override: {},
    };
    const kpiList = [{ kpi_id: 'K1' }, { kpi_id: 'K2' }];
    const nvList = [{ nv_id: 'NV1', nhom_cv: 'IT' }];
    const result = computeNvWeights(config, kpiList, nvList);
    expect(result.NV1.K1).toBe(40);
    expect(result.NV1.K2).toBe(30);
  });

  it('applies nv_override', () => {
    const config = {
      kpi_pct: { IT: { K1: { pct: 40 } } },
      nv_override: { NV1: { K1: 50 } },
    };
    const kpiList = [{ kpi_id: 'K1' }];
    const nvList = [{ nv_id: 'NV1', nhom_cv: 'IT' }];
    const result = computeNvWeights(config, kpiList, nvList);
    expect(result.NV1.K1).toBe(50);
  });
});
