/**
 * Tính điểm quy đổi cho 1 KPI
 * Port chính xác từ hàm LAMBDA Excel
 *
 * @param {number} value   - Kết quả thực hiện
 * @param {number} lower   - Ngưỡng dưới (dưới mức này = 0 điểm)
 * @param {number} upper   - Chỉ tiêu (= 100% hoàn thành)
 * @param {number} maxPct  - Hệ số trần thưởng (vd: 1.2 = tối đa 120%)
 * @param {number} weight  - Trọng số tương đối (đã chuẩn hóa, đơn vị điểm)
 * @param {number} giamTru - Hệ số giảm trừ (mặc định = 1)
 * @returns {number|null}
 */
function kpiScore(value, lower, upper, maxPct, weight, giamTru) {
  try {
    if (value === null || value === undefined || value === '') return null;
    if (upper === lower) return null;

    const gt = giamTru !== undefined && giamTru !== null ? giamTru : 1;
    const dir = upper >= lower ? 1 : -1;

    const v     = value * dir;
    const lo    = lower * dir;
    const hi    = upper * dir;
    const hiMax = upper * maxPct * dir;

    let pct;
    if (v <= lo) {
      pct = 0;
    } else if (v <= hi) {
      pct = (value - lower) / (upper - lower) * 100;
    } else if (v >= hiMax) {
      pct = maxPct * 100;
    } else {
      pct = 100 + (value - upper) / (upper * maxPct - upper) * (maxPct * 100 - 100);
    }

    return (weight / 100) * pct * gt;
  } catch (e) {
    return null;
  }
}

/**
 * Tính % thực hiện (0–MaxPct) cho 1 KPI, không nhân weight
 */
function kpiPercent(value, lower, upper, maxPct) {
  try {
    if (value === null || value === undefined || value === '') return null;
    if (upper === lower) return null;

    const dir   = upper >= lower ? 1 : -1;
    const v     = value * dir;
    const lo    = lower * dir;
    const hi    = upper * dir;
    const hiMax = upper * maxPct * dir;

    if (v <= lo)    return 0;
    if (v <= hi)    return (value - lower) / (upper - lower);
    if (v >= hiMax) return maxPct;
    return 1 + (value - upper) / (upper * maxPct - upper) * (maxPct - 1);
  } catch (e) {
    return null;
  }
}
