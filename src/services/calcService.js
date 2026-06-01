/**
 * @file calcService.js
 * @description Engine tính điểm KPI phía client (offline fallback).
 *
 * CHỨC NĂNG:
 * - calcMonth(thang): Tính điểm cho tất cả NV của tháng đó, lưu vào output_diem + output_chitiet.
 *   Kết quả giống GAS calcMonth nhưng chạy local (không cần kết nối).
 *
 * DỮ LIỆU ĐẦU VÀO:
 * - kpi_snapshot_YYYY-MM (localStorage): danh sách KPI cá nhân + phòng theo tháng
 * - nv_snapshot_YYYY-MM (localStorage): danh sách NV theo tháng
 * - input_cn (localStorage): dữ liệu nhập KPI từng NV
 * - input_phong (localStorage): dữ liệu KPI phòng
 * - trong_so_thang_YYYY-MM (localStorage): cấu hình tỷ lệ + trọng số
 * - xep_loai_config (localStorage): ngưỡng xếp loại A+/A/B/C/D
 *
 * DỮ LIỆU ĐẦU RA:
 * - output_diem (localStorage): tổng điểm + xếp loại mỗi NV
 * - output_chitiet (localStorage): điểm từng KPI cá nhân
 *
 * LƯU Ý:
 * - Đây là engine chính thức — GAS đã ngưng sử dụng.
 * - Nếu không có kpi_snapshot → fallback về global kpi_list.
 */
import {
  calcDiemPhong, calcNhanVien, xepLoaiWithConfig,
} from '../utils/kpiScore';
import {
  getKpiList, getNvListForThang, getTrongSo,
  getInputCNByThang, getInputPhongByThang,
  saveOutputDiem, saveOutputCT, getOutputDiem, getOutputCT,
  getTrongSoConfig, computeNvWeights, getKpiSnapshot, getXepLoaiConfig,
} from './store';

export function calcMonth(thang) {
  const snap      = getKpiSnapshot(thang);
  const kpiList   = snap ? snap.kpiList : getKpiList();
  const nvList    = getNvListForThang(thang);
  const inputPhongRow = getInputPhongByThang(thang) || {};
  const inputCNRows   = getInputCNByThang(thang);

  const inputCNMap = {};
  inputCNRows.forEach(r => { inputCNMap[r.nv_id] = r; });

  // Kiểm tra cấu hình trọng số mới
  const weightConfig  = getTrongSoConfig(thang);
  const mode          = weightConfig?.mode ?? 'manual';
  const phongRatio    = weightConfig ? (weightConfig.ty_le?.ca_nhan?.phong ?? 30) / 100 : 0.30;
  const caNhanKpis    = kpiList.filter(k => k.kpi_cap === 'ca_nhan');
  let nvWeightsMap;
  let trongSo;
  if (mode === 'auto' && weightConfig) {
    // Auto mode: tính weights từ cấu hình kpi_pct
    nvWeightsMap = computeNvWeights(weightConfig, kpiList, nvList);
    trongSo = null;
  } else {
    // Manual mode: đọc weights trực tiếp từ trường _trong_so trong inputCN
    nvWeightsMap = {};
    nvList.forEach(nv => {
      const cnRow = inputCNMap[nv.nv_id] || {};
      const nwt = {};
      caNhanKpis.forEach(k => {
        const w = parseFloat(cnRow[k.kpi_id + '_trong_so']);
        if (!isNaN(w) && w > 0) nwt[k.kpi_id] = w;
      });
      nvWeightsMap[nv.nv_id] = nwt;
    });
    trongSo = getTrongSo();
  }
  const xepLoaiCfg    = getXepLoaiConfig();

  const diemPhongTong = calcDiemPhong({ kpiList, inputPhong: inputPhongRow });

  const outDiem = [];
  const outCT   = [];

  nvList.forEach(nv => {
    const inputCN = inputCNMap[nv.nv_id];
    if (!inputCN) return;

    const directWeights = nvWeightsMap[nv.nv_id];

    const result = calcNhanVien({
      nv, kpiList, trongSoMatrix: trongSo, directWeights, inputCN, diemPhongTong, phongRatio
    });

    outDiem.push({
      thang,
      nv_id:               nv.nv_id,
      ho_ten:              nv.ho_ten,
      nhom_cv:             nv.nhom_cv,
      khu_vuc:             nv.khu_vuc,
      diem_phong_dong_gop: Math.round(result.diem_phong_dong_gop * 1000) / 1000,
      diem_ca_nhan:        Math.round(result.diem_ca_nhan * 1000) / 1000,
      tong_diem:           Math.round(result.tong_diem * 1000) / 1000,
      xep_loai:            xepLoaiWithConfig(result.tong_diem, xepLoaiCfg),
    });

    result.chi_tiet.forEach(ct => {
      outCT.push({ thang, nv_id: nv.nv_id, ...ct });
    });
  });

  // Merge: xóa tháng cũ, thêm mới
  const existDiem = getOutputDiem().filter(r => r.thang !== thang);
  saveOutputDiem([...existDiem, ...outDiem]);

  const existCT = getOutputCT().filter(r => r.thang !== thang);
  saveOutputCT([...existCT, ...outCT]);

  return { success: true, thang, so_nv: outDiem.length, diem_phong: Math.round(diemPhongTong * 100) / 100 };
}
