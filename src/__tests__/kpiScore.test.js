import { describe, it, expect } from 'vitest';
import {
  kpiScore, kpiDisplayPct, xepLoaiWithConfig, xepLoaiLabel, xepLoaiColor,
  calcNhanVien, calcDiemPhong,
} from '../utils/kpiScore';

describe('kpiScore', () => {
  it('returns null for empty/null value', () => {
    expect(kpiScore(null, 0, 100, 1, 10)).toBeNull();
    expect(kpiScore(undefined, 0, 100, 1, 10)).toBeNull();
    expect(kpiScore('', 0, 100, 1, 10)).toBeNull();
  });

  it('returns null when effectiveUpper === lower', () => {
    expect(kpiScore(50, 100, 100, 1, 10)).toBeNull();
  });

  it('scores 0 when value <= lower (cao tot)', () => {
    expect(kpiScore(0, 0, 100, 1, 10)).toBe(0);
    expect(kpiScore(-5, 0, 100, 1, 10)).toBe(0);
  });

  it('scores proportionally between lower and upper (cao tot)', () => {
    const result = kpiScore(50, 0, 100, 1.2, 10);
    expect(result).toBeCloseTo(5, 1);
  });

  it('scores 100% at upper (cao tot)', () => {
    const result = kpiScore(100, 0, 100, 1.2, 10);
    expect(result).toBeCloseTo(10, 5);
  });

  it('scores maxPct*100 at or above maxPct*upper (cao tot)', () => {
    const result = kpiScore(120, 0, 100, 1.2, 10);
    expect(result).toBeCloseTo(12, 5);
  });

  it('handles bonus zone between upper and maxPct*upper (cao tot)', () => {
    const result = kpiScore(110, 0, 100, 1.2, 10);
    expect(result).toBeGreaterThan(10);
    expect(result).toBeLessThan(12);
  });

  it('handles thap tot (lower > upper, dir=-1)', () => {
    const result = kpiScore(50, 100, 0, 1, 10);
    expect(result).toBeCloseTo(5, 1);
  });

  it('applies giamTru correctly', () => {
    const noGT = kpiScore(90, 0, 100, 1, 10, 1);
    const withGT = kpiScore(90, 0, 100, 1, 10, 0.9);
    expect(withGT).not.toEqual(noGT);
    expect(withGT).toBeCloseTo(10, 5);
  });

  it('weight=0 means 0 points regardless of value', () => {
    expect(kpiScore(100, 0, 100, 1, 0)).toBe(0);
  });
});

describe('kpiDisplayPct', () => {
  it('returns null for NaN value', () => {
    expect(kpiDisplayPct('abc', 100, true)).toBeNull();
  });

  it('returns error when upper=0', () => {
    const r = kpiDisplayPct(50, 0, true);
    expect(r).toEqual({ error: 'Chỉ tiêu = 0' });
  });

  it('computes pct for cao tot', () => {
    const r = kpiDisplayPct(80, 100, true);
    expect(r.pct).toBeCloseTo(0.8);
  });

  it('computes pct for thap tot', () => {
    const r = kpiDisplayPct(50, 100, false);
    expect(r.pct).toBeCloseTo(2);
  });

  it('returns null for thap tot when value=0', () => {
    expect(kpiDisplayPct(0, 100, false)).toBeNull();
  });

  it('applies giamTru to upper', () => {
    const r = kpiDisplayPct(80, 100, true, 0.8);
    expect(r.pct).toBeCloseTo(1.0);
  });
});

describe('xepLoaiWithConfig', () => {
  const cfg = { A_plus: 105, A: 101, B: 100, C: 95 };

  it('A+ when >= 105', () => expect(xepLoaiWithConfig(105, cfg)).toBe('A+'));
  it('A when >= 101', () => expect(xepLoaiWithConfig(101, cfg)).toBe('A'));
  it('B when >= 100', () => expect(xepLoaiWithConfig(100, cfg)).toBe('B'));
  it('C when >= 95', () => expect(xepLoaiWithConfig(95, cfg)).toBe('C'));
  it('D when < 95', () => expect(xepLoaiWithConfig(94, cfg)).toBe('D'));
  it('uses defaults when config is null', () => {
    expect(xepLoaiWithConfig(110, null)).toBe('A+');
    expect(xepLoaiWithConfig(94, null)).toBe('D');
  });
});

describe('xepLoaiLabel', () => {
  it('maps known labels', () => {
    expect(xepLoaiLabel('A+')).toBe('Xuất sắc');
    expect(xepLoaiLabel('A')).toBe('Vượt');
    expect(xepLoaiLabel('B')).toBe('Đạt');
    expect(xepLoaiLabel('C')).toBe('Đạt một phần');
    expect(xepLoaiLabel('D')).toBe('Không đạt KPI');
  });

  it('returns empty for unknown', () => {
    expect(xepLoaiLabel('X')).toBe('');
  });
});

describe('xepLoaiColor', () => {
  it('returns correct classes for known grades', () => {
    expect(xepLoaiColor('A+')).toContain('purple');
    expect(xepLoaiColor('A')).toContain('green');
    expect(xepLoaiColor('B')).toContain('blue');
    expect(xepLoaiColor('C')).toContain('yellow');
    expect(xepLoaiColor('D')).toContain('red');
  });

  it('returns slate for unknown', () => {
    expect(xepLoaiColor('X')).toContain('slate');
  });
});

describe('calcDiemPhong', () => {
  const kpiList = [
    { kpi_id: 'KPI_PH_000001', kpi_cap: 'phong', active: true },
    { kpi_id: 'KPI_PH_000002', kpi_cap: 'phong', active: true },
    { kpi_id: 'KPI_CN_000001', kpi_cap: 'ca_nhan', active: true },
  ];

  it('returns 0 when no input', () => {
    expect(calcDiemPhong({ kpiList, inputPhong: {} })).toBe(0);
  });

  it('includes diem_kpi_chinhanh', () => {
    const inp = { diem_kpi_chinhanh: '15' };
    expect(calcDiemPhong({ kpiList, inputPhong: inp })).toBe(15);
  });

  it('calculates phong KPI scores', () => {
    const inp = {
      diem_kpi_chinhanh: '10',
      KPI_PH_000001_value: 80,
      KPI_PH_000001_lower: 0,
      KPI_PH_000001_upper: 100,
      KPI_PH_000001_trong_so: 20,
      KPI_PH_000001_max_pct: 100,
    };
    const result = calcDiemPhong({ kpiList, inputPhong: inp });
    expect(result).toBeGreaterThan(10);
  });

  it('ignores ca_nhan KPIs', () => {
    const inp = {
      KPI_CN_000001_value: 80,
      KPI_CN_000001_lower: 0,
      KPI_CN_000001_upper: 100,
      KPI_CN_000001_trong_so: 20,
      KPI_CN_000001_max_pct: 100,
    };
    expect(calcDiemPhong({ kpiList, inputPhong: inp })).toBe(0);
  });
});

describe('calcNhanVien', () => {
  const kpiList = [
    { kpi_id: 'KPI_CN_000001', kpi_cap: 'ca_nhan', active: true },
    { kpi_id: 'KPI_PH_000001', kpi_cap: 'phong', active: true },
  ];
  const nv = { nv_id: 'NV001', nhom_cv: 'Kế toán' };

  it('returns zero scores when no input data', () => {
    const result = calcNhanVien({
      nv, kpiList, trongSoMatrix: [], directWeights: { KPI_CN_000001: 70 },
      inputCN: {}, diemPhongTong: 0, phongRatio: 0.3,
    });
    expect(result.diem_ca_nhan).toBe(0);
    expect(result.tong_diem).toBe(0);
    expect(result.chi_tiet).toHaveLength(0);
  });

  it('calculates scores with directWeights', () => {
    const inputCN = {
      KPI_CN_000001_value: 80,
      KPI_CN_000001_lower: 0,
      KPI_CN_000001_upper: 100,
      KPI_CN_000001_max_pct: 100,
      KPI_CN_000001_giam_tru: 100,
    };
    const result = calcNhanVien({
      nv, kpiList, trongSoMatrix: [], directWeights: { KPI_CN_000001: 70 },
      inputCN, diemPhongTong: 80, phongRatio: 0.3,
    });
    expect(result.diem_phong_dong_gop).toBeCloseTo(24);
    expect(result.diem_ca_nhan).toBeGreaterThan(0);
    expect(result.tong_diem).toBeGreaterThan(24);
    expect(result.chi_tiet).toHaveLength(1);
    expect(result.chi_tiet[0].kpi_id).toBe('KPI_CN_000001');
  });

  it('includes phong ratio contribution', () => {
    const result = calcNhanVien({
      nv, kpiList, trongSoMatrix: [], directWeights: {},
      inputCN: {}, diemPhongTong: 100, phongRatio: 0.3,
    });
    expect(result.diem_phong_dong_gop).toBeCloseTo(30);
    expect(result.tong_diem).toBeCloseTo(30);
  });

  it('handles giamTru as percentage (>2 means /100)', () => {
    const inputCN = {
      KPI_CN_000001_value: 80,
      KPI_CN_000001_lower: 0,
      KPI_CN_000001_upper: 100,
      KPI_CN_000001_max_pct: 100,
      KPI_CN_000001_giam_tru: 90,
    };
    const result = calcNhanVien({
      nv, kpiList, trongSoMatrix: [], directWeights: { KPI_CN_000001: 70 },
      inputCN, diemPhongTong: 0, phongRatio: 0.3,
    });
    expect(result.chi_tiet[0].giam_tru).toBeCloseTo(0.9);
  });
});
