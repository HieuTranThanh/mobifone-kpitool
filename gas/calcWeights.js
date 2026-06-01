/**
 * Bảng quy đổi mức ưu tiên → trọng số thô
 */
const PRIORITY_WEIGHT_MAP = {
  1: 14, 2: 10, 3: 8, 4: 6, 5: 5,
  6: 4,  7: 3,  8: 2, 9: 2, 10: 1,
  11: 1, 12: 4, 13: 10
};

/**
 * Lấy trọng số thô từ mức ưu tiên
 */
function priorityToWeight(priority) {
  return PRIORITY_WEIGHT_MAP[priority] || 0;
}

/**
 * Tính trọng số tương đối cho tất cả KPI active của 1 NV
 * Chuẩn hóa tổng về đúng totalPoints (= 70)
 *
 * @param {Array}  activeKpis   - [{kpi_id, weight_tho}]
 * @param {number} totalPoints  - 70
 * @returns {Object}            - { kpi_id: weight_tuong_doi }
 */
function calcWeights(activeKpis, totalPoints) {
  totalPoints = totalPoints || 70;
  const sumTho = activeKpis.reduce(function(s, k) { return s + k.weight_tho; }, 0);
  if (sumTho === 0) return {};
  const result = {};
  activeKpis.forEach(function(k) {
    result[k.kpi_id] = (k.weight_tho / sumTho) * totalPoints;
  });
  return result;
}

/**
 * Xếp loại dựa trên tổng điểm
 */
function xepLoai(tongDiem) {
  if (tongDiem >= 95)   return 'A';
  if (tongDiem >= 80)   return 'B';
  if (tongDiem >= 70)   return 'C';
  return 'D';
}
