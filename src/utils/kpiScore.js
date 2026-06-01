/**
 * @file kpiScore.js
 * @description Thư viện tính toán điểm KPI — port chính xác từ hàm LAMBDA Excel.
 *
 * CHỨC NĂNG CHÍNH:
 * - kpiScore(value, lower, upper, maxPct, weight, giamTru): Tính điểm 1 KPI
 * - kpiPercent(value, lower, upper, maxPct, giamTru): % hoàn thành (private)
 * - kpiDisplayPct(value, upper, upper_gt_lower, giamTru): Tính % thực hiện để hiển thị
 * - xepLoaiWithConfig(tongDiem, config): Xếp loại theo ngưỡng cấu hình
 * - calcWeights / calcDiemPhong / calcNhanVien: Tính trọng số và điểm KPI
 *
 * LƯU Ý:
 * - upper_gt_lower = true: KQ cao hơn là tốt; false: KQ thấp hơn là tốt.
 * - giamTru (0–1): hệ số giảm chỉ tiêu. effectiveUpper = upper × giamTru.
 *   Chỉ áp dụng cho KPI cá nhân; KPI phòng luôn giamTru = 1.
 * - xepLoai(): hàm nội bộ dùng bởi calcNhanVien (ngưỡng mặc định); không export.
 * - kpiPercent(): hàm nội bộ dùng bởi calcNhanVien; không export.
 */
export function kpiScore(value, lower, upper, maxPct, weight, giamTru = 1) {
  if (value === null || value === undefined || value === '') return null;
  // Chỉ tiêu tính điểm = chỉ tiêu metadata × giảm trừ
  const effectiveUpper = upper * giamTru;
  if (effectiveUpper === lower) return null;

  const dir   = effectiveUpper >= lower ? 1 : -1;
  const v     = value * dir;
  const lo    = lower * dir;
  const hi    = effectiveUpper * dir;
  // dir=1 (cao tốt): vùng thưởng lên đến upper*maxPct
  // dir=-1 (thấp tốt): vùng thưởng xuống đến upper/maxPct
  const hiMax = dir > 0 ? effectiveUpper * maxPct * dir : (effectiveUpper / maxPct) * dir;

  let pct;
  if (v <= lo)         pct = 0;
  else if (v <= hi)    pct = (value - lower) / (effectiveUpper - lower) * 100;
  else if (v >= hiMax) pct = maxPct * 100;
  else                 pct = 100 + (v - hi) / (hiMax - hi) * (maxPct * 100 - 100);

  return (weight / 100) * pct;
}

function kpiPercent(value, lower, upper, maxPct, giamTru = 1) {
  if (value === null || value === undefined || value === '') return null;
  const effectiveUpper = upper * giamTru;
  if (effectiveUpper === lower) return null;

  const dir   = effectiveUpper >= lower ? 1 : -1;
  const v     = value * dir;
  const lo    = lower * dir;
  const hi    = effectiveUpper * dir;
  const hiMax = dir > 0 ? effectiveUpper * maxPct * dir : (effectiveUpper / maxPct) * dir;

  if (v <= lo)       return 0;
  if (v <= hi)       return (value - lower) / (effectiveUpper - lower);
  if (v >= hiMax)    return maxPct;
  return 1 + (v - hi) / (hiMax - hi) * (maxPct - 1);
}

// % thực hiện đơn giản: value/effectiveUpper (cao hơn tốt) hoặc effectiveUpper/value (thấp hơn tốt)
// giamTru: hệ số giảm chỉ tiêu (effectiveUpper = upper × giamTru)
// Trả về { pct: number } | { error: string } | null
export function kpiDisplayPct(value, upper, upperGtLower, giamTru = 1) {
  const effectiveUpper = parseFloat(upper) * giamTru;
  if (isNaN(effectiveUpper) || effectiveUpper === 0) return { error: 'Chỉ tiêu = 0' };
  const v = parseFloat(value);
  if (isNaN(v)) return null;
  if (upperGtLower === false && v === 0) return null;
  return { pct: upperGtLower === false ? effectiveUpper / v : v / effectiveUpper };
}

// Bảng quy đổi mức ưu tiên → trọng số thô
export const PRIORITY_WEIGHT_MAP = {
  1: 14, 2: 10, 3: 8, 4: 6, 5: 5,
  6: 4,  7: 3,  8: 2, 9: 2, 10: 1,
  11: 1, 12: 4, 13: 10
};

export function priorityToWeight(priority) {
  return PRIORITY_WEIGHT_MAP[priority] ?? 0;
}

export function calcWeights(activeKpis, totalPoints = 70) {
  const sumTho = activeKpis.reduce((s, k) => s + k.weight_tho, 0);
  if (sumTho === 0) return {};
  return Object.fromEntries(
    activeKpis.map(k => [k.kpi_id, (k.weight_tho / sumTho) * totalPoints])
  );
}

export function xepLoaiWithConfig(tongDiem, config) {
  const { A_plus = 105, A = 101, B = 100, C = 95 } = config || {};
  if (tongDiem >= A_plus) return 'A+';
  if (tongDiem >= A)      return 'A';
  if (tongDiem >= B)      return 'B';
  if (tongDiem >= C)      return 'C';
  return 'D';
}

function xepLoai(tongDiem) {
  return xepLoaiWithConfig(tongDiem, null);
}

export function xepLoaiLabel(loai) {
  const map = { 'A+': 'Xuất sắc', A: 'Vượt', B: 'Đạt', C: 'Đạt một phần', D: 'Không đạt KPI' };
  return map[loai] || '';
}

export function xepLoaiColor(loai) {
  const map = {
    'A+': 'bg-purple-100 text-purple-800',
    A:    'bg-green-100 text-green-800',
    B:    'bg-blue-100 text-blue-800',
    C:    'bg-yellow-100 text-yellow-800',
    D:    'bg-red-100 text-red-800',
  };
  return map[loai] || 'bg-gray-100 text-gray-800';
}

/**
 * Tính điểm đầy đủ cho 1 nhân viên trong 1 tháng.
 * directWeights: { kpi_id: points } — dùng từ hệ thống trọng số mới.
 * phongRatio: tỷ lệ điểm phòng đóng góp vào tổng điểm (mặc định 0.30).
 */
export function calcNhanVien({ nv, kpiList, trongSoMatrix, directWeights, inputCN, diemPhongTong, phongRatio = 0.30 }) {
  const activeKpisCN = kpiList.filter(k => k.kpi_cap === 'ca_nhan' && k.active !== false);

  let kpisWithWeight = [];
  let weights;
  if (directWeights && Object.keys(directWeights).length > 0) {
    weights = directWeights;
  } else {
    kpisWithWeight = activeKpisCN
      .map(k => {
        const rowTS = (trongSoMatrix || []).find(r => r.kpi_id === k.kpi_id) || {};
        const priority = rowTS[nv.nhom_cv] ?? 0;
        return { kpi_id: k.kpi_id, weight_tho: priorityToWeight(priority) };
      })
      .filter(k => k.weight_tho > 0);
    weights = calcWeights(kpisWithWeight);
  }

  const chiTiet = [];
  let diemCaNhan = 0;

  activeKpisCN.forEach(kpi => {
    const w = weights[kpi.kpi_id];
    if (!w) return;

    const value  = inputCN[kpi.kpi_id + '_value'];
    const lower  = inputCN[kpi.kpi_id + '_lower'];
    const upper  = inputCN[kpi.kpi_id + '_upper'];
    // Backward compat: giá trị cũ lưu dạng thập phân (1.0, 0.99), giá trị mới lưu dạng ×100 (100, 99)
    const rawGt = parseFloat(inputCN[kpi.kpi_id + '_giam_tru']);
    const gt = isNaN(rawGt) ? 1 : (rawGt > 2 ? rawGt / 100 : rawGt);
    const rawMp = parseFloat(inputCN[kpi.kpi_id + '_max_pct']);
    const maxPct = (isNaN(rawMp) || rawMp <= 0) ? 1 : (rawMp > 2 ? rawMp / 100 : rawMp);

    if (value === '' || value === null || value === undefined) return;

    const diem = kpiScore(value, lower, upper, maxPct, w, gt);
    if (diem === null) return;

    const pct = kpiPercent(value, lower, upper, maxPct, gt);
    diemCaNhan += diem;

    const wtho = kpisWithWeight.find(k => k.kpi_id === kpi.kpi_id)?.weight_tho ?? 0;
    // Lưu effectiveUpper (= upper × giam_tru) vào upper để hiển thị chỉ tiêu tính điểm trong báo cáo
    chiTiet.push({ kpi_id: kpi.kpi_id, lower, upper: upper * gt, value, max_pct: maxPct, weight_tho: wtho, weight_tuong_doi: w, giam_tru: gt, pct_th: pct, diem_quy_doi: diem });
  });

  const tongDiem = (diemPhongTong ?? 0) * phongRatio + diemCaNhan;

  return {
    diem_phong_dong_gop: (diemPhongTong ?? 0) * phongRatio,
    diem_ca_nhan: diemCaNhan,
    tong_diem: tongDiem,
    xep_loai: xepLoai(tongDiem),
    chi_tiet: chiTiet
  };
}

/**
 * Tính tổng điểm phòng (max 100đ)
 */
export function calcDiemPhong({ kpiList, inputPhong }) {
  const diemCN = parseFloat(inputPhong?.diem_kpi_chinhanh) || 0;
  let diemKPI = 0;

  kpiList
    .filter(k => k.kpi_cap === 'phong' && k.active !== false)
    .forEach(kpi => {
      const value  = inputPhong?.[kpi.kpi_id + '_value'];
      const lower  = inputPhong?.[kpi.kpi_id + '_lower'];
      const upper  = inputPhong?.[kpi.kpi_id + '_upper'];
      const w      = inputPhong?.[kpi.kpi_id + '_trong_so'];
      const rawMpP = parseFloat(inputPhong?.[kpi.kpi_id + '_max_pct']);
      const maxPct = isNaN(rawMpP) || rawMpP <= 0 ? (kpi.max_pct ?? 1) : (rawMpP > 2 ? rawMpP / 100 : rawMpP);
      if (value === '' || value === null || value === undefined) return;
      const d = kpiScore(value, lower, upper, maxPct, w, 1);
      if (d !== null) diemKPI += d;
    });

  return diemCN + diemKPI;
}
