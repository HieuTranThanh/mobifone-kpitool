/**
 * @file KpiReport.jsx
 * @description Menu "Báo cáo KPI" — Báo cáo kết quả KPI Phòng và cá nhân theo tháng.
 *
 * SUB-MENU:
 * - /baocao/phong   → BaoCaoPhongTab: Bảng kết quả KPI phòng chi tiết + xuất Excel tổng
 * - /baocao/canhan  → BaoCaoCaNhanTab (Chi tiết): Bảng điểm cá nhân từng NV
 *                  → ThongKeCaNhanTab (Thống kê): Ma trận % TH / chỉ tiêu / trọng số NV × KPI
 *
 * DỮ LIỆU ĐẦU VÀO:
 * - output_diem (Supabase → localStorage): điểm tổng + xếp loại NV
 * - output_chitiet (Supabase → localStorage): điểm từng KPI của NV
 * - input_phong (config_store → localStorage): dữ liệu KPI phòng
 * - input_cn (Supabase → localStorage): dữ liệu nhập KPI cá nhân
 * - kpi_snapshot_YYYY-MM, nv_snapshot_YYYY-MM: danh sách KPI/NV của tháng
 *
 * DỮ LIỆU ĐẦU RA:
 * - File Excel .xlsx khi nhấn nút "Xuất Excel" (exportAllToExcel, exportThongKeToExcel)
 * - Không ghi dữ liệu vào localStorage hoặc Supabase.
 *
 * PHÂN QUYỀN (TODO):
 * - Admin/trưởng phòng: xem tất cả NV, xuất Excel tổng.
 * - Staff: chỉ xem bảng của chính mình (lọc theo nv_id).
 * - Báo cáo phòng: chỉ admin/trưởng phòng mới xem được.
 *
 * LƯU Ý:
 * - BaoCaoCaNhanTab hiển thị output_chitiet từ Supabase nếu có; fallback về tính local.
 * - exportAllToExcel dùng XLSXStyle (có style); không dùng plain XLSX.
 */
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import XLSXStyle from 'xlsx-js-style';
import YearMonthPicker, { defaultThang } from './YearMonthPicker';
import {
  getOutputDiemByThang, getOutputCTByThangNV,
  getThangList, getKpiList, getNhomList, getNvLibrary,
  getSnapshotThangList, getInputPhongByThang, getInputPhong,
  getKpiSnapshot, getTrongSoConfig,
  getInputCNByThang, upsertInputCN,
  saveOutputDiem, getOutputDiem, saveOutputCT, getOutputCT,
  getNvListForThang, getXepLoaiConfig,
  getInputPhongStatus, getInputCNStatus,
} from '../services/store';
import {
  isConnected,
  getOutput as gasGetOutput,
  getDetail as gasGetDetail,
  getInputCN as gasGetInputCN,
} from '../services/supabaseService';
import { kpiScore, kpiDisplayPct, xepLoaiWithConfig, xepLoaiLabel } from '../utils/kpiScore';

function fmt(n, d = 2) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toFixed(d);
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return (Number(n) * 100).toFixed(1) + '%';
}
function fmtPctDisp(dp) {
  if (!dp) return '—';
  if (dp.error) return dp.error;
  return (dp.pct * 100).toFixed(1) + '%';
}

const XEP_LOAI_CLS = {
  'A+': 'text-purple-800 bg-purple-100 border-purple-300',
  A:    'text-green-800 bg-green-100 border-green-300',
  B:    'text-blue-800 bg-blue-100 border-blue-300',
  C:    'text-yellow-800 bg-yellow-100 border-yellow-300',
  D:    'text-red-800 bg-red-100 border-red-300',
};

// Cột chuẩn: STT | Tên KPI | ĐVT | KQ thực hiện | % Thực hiện | Chỉ tiêu | Ngưỡng dưới | Trọng số | Điểm QĐ | Điểm tối đa
const THEAD = (
  <thead className="bg-blue-50 border-b border-blue-100">
    <tr className="text-gray-600 text-xs uppercase tracking-wide">
      <th className="px-2 py-2.5 text-center w-10 border border-blue-100">STT</th>
      <th className="px-3 py-2.5 text-left border border-blue-100">Tên KPI</th>
      <th className="px-2 py-2.5 text-center w-20 border border-blue-100">ĐVT</th>
      <th className="px-2 py-2.5 text-center w-22 border border-blue-100">KQ thực hiện</th>
      <th className="px-2 py-2.5 text-center w-22 border border-blue-100">% Thực hiện</th>
      <th className="px-2 py-2.5 text-center w-22 border border-blue-100">Chỉ tiêu</th>
      <th className="px-2 py-2.5 text-center w-22 border border-blue-100">Ngưỡng dưới</th>
      <th className="px-2 py-2.5 text-center w-22 border border-blue-100">Trọng số</th>
      <th className="px-2 py-2.5 text-center w-22 border border-blue-100">Điểm Quy đổi</th>
      <th className="px-2 py-2.5 text-center w-22 border border-blue-100">Điểm tối đa (%)</th>
    </tr>
  </thead>
);

// Tính dữ liệu KPI Phòng từ local input
function computePhongData(thang) {
  const snap        = getKpiSnapshot(thang);
  const kpiListAll  = snap ? snap.kpiList : getKpiList();
  const kpiPhong    = kpiListAll.filter(k => k.kpi_cap === 'phong').sort((a, b) => a.stt - b.stt);
  const nhomListAll = snap?.nhomList || getNhomList();
  const nhomMap     = Object.fromEntries(nhomListAll.map(n => [n.nhom_id, n]));
  const weightCfg   = getTrongSoConfig(thang) || {};
  const ty_le_cty   = weightCfg?.ty_le?.phong?.cty   ?? 50;
  const ty_le_phong = weightCfg?.ty_le?.phong?.phong ?? 50;
  const inp         = getInputPhongByThang(thang) || {};

  let diemPhongSum = 0;
  const kpiCalc = {};
  kpiPhong.forEach(kpi => {
    const parseNum = key => {
      const raw = inp[kpi.kpi_id + key];
      if (raw === '' || raw === null || raw === undefined) return null;
      const f = parseFloat(raw); return isNaN(f) ? null : f;
    };
    const v  = parseNum('_value'), lo = parseNum('_lower'), hi = parseNum('_upper'), ws = parseNum('_trong_so');
    const rawMp = parseNum('_max_pct');
    const hasAny = v !== null || lo !== null || hi !== null || ws !== null;
    if (!hasAny) { kpiCalc[kpi.kpi_id] = null; return; }
    const maxPct = rawMp !== null && rawMp > 0 ? (rawMp > 2 ? rawMp / 100 : rawMp) : (kpi.max_pct ?? 1);
    let diem = null, dispPct = null;
    if (v !== null && lo !== null && hi !== null && ws !== null) {
      dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower);
      diem = kpiScore(v, lo, hi, maxPct, ws, 1);
      if (diem !== null) diemPhongSum += diem;
    } else if (v !== null && hi !== null) {
      dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower);
    }
    kpiCalc[kpi.kpi_id] = { value: v, lower: lo, upper: hi, w: ws, dispPct, diem, max_pct: Math.round(maxPct * 100) };
  });
  const kq_cty   = parseFloat(inp.diem_kpi_chinhanh_kq) || 0;
  const diem_cty = parseFloat(inp.diem_kpi_chinhanh) || (kq_cty * ty_le_cty / 100);
  const tongDiem = diem_cty + diemPhongSum;

  return { kpiPhong, nhomMap, kpiCalc, kq_cty, diem_cty, diemPhongSum, tongDiem, ty_le_cty, ty_le_phong, inp };
}

// Xuất toàn bộ ra Excel
function exportAllToExcel(thang) {
  const HEADER = Object.assign(
    ['STT', 'Tên KPI', 'ĐVT', 'KQ thực hiện', '% Thực hiện', 'Chỉ tiêu', 'Ngưỡng dưới', 'Trọng số', 'Điểm Quy đổi', 'Điểm tối đa'],
    { __tag: 'header' }
  );
  const COL_WIDTHS = [{ wch: 6 }, { wch: 44 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
  const HEADER_STYLE = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Segoe UI' },
    fill: { fgColor: { rgb: '1E40AF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top: {style:'thin',color:{rgb:'93C5FD'}}, bottom: {style:'thin',color:{rgb:'93C5FD'}}, left: {style:'thin',color:{rgb:'93C5FD'}}, right: {style:'thin',color:{rgb:'93C5FD'}} },
  };
  const DATA_STYLE = (isEven) => ({
    font: { sz: 10, name: 'Segoe UI' },
    fill: { fgColor: { rgb: isEven ? 'F0F9FF' : 'FFFFFF' } },
    alignment: { vertical: 'center' },
    border: { top: {style:'thin',color:{rgb:'E2E8F0'}}, bottom: {style:'thin',color:{rgb:'E2E8F0'}}, left: {style:'thin',color:{rgb:'E2E8F0'}}, right: {style:'thin',color:{rgb:'E2E8F0'}} },
  });
  const GROUP_STYLE = {
    font: { bold: true, sz: 10, name: 'Segoe UI', color: { rgb: '1E40AF' } },
    fill: { fgColor: { rgb: 'DBEAFE' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: { top: {style:'thin',color:{rgb:'BFDBFE'}}, bottom: {style:'thin',color:{rgb:'BFDBFE'}}, left: {style:'thin',color:{rgb:'BFDBFE'}}, right: {style:'thin',color:{rgb:'BFDBFE'}} },
  };
  const ROW_A_STYLE = { font: { bold: true, sz: 10, name: 'Segoe UI', color: { rgb: '14532D' } }, fill: { fgColor: { rgb: 'DCFCE7' } }, alignment: { vertical: 'center' }, border: { top: {style:'thin',color:{rgb:'86EFAC'}}, bottom: {style:'thin',color:{rgb:'86EFAC'}}, left: {style:'thin',color:{rgb:'86EFAC'}}, right: {style:'thin',color:{rgb:'86EFAC'}} } };
  const ROW_B_STYLE = { font: { bold: true, sz: 10, name: 'Segoe UI', color: { rgb: '1E3A5F' } }, fill: { fgColor: { rgb: 'DBEAFE' } }, alignment: { vertical: 'center' }, border: { top: {style:'thin',color:{rgb:'93C5FD'}}, bottom: {style:'thin',color:{rgb:'93C5FD'}}, left: {style:'thin',color:{rgb:'93C5FD'}}, right: {style:'thin',color:{rgb:'93C5FD'}} } };
  const ROW_C_STYLE = { font: { bold: true, sz: 10, name: 'Segoe UI', color: { rgb: '1E40AF' } }, fill: { fgColor: { rgb: 'EFF6FF' } }, alignment: { vertical: 'center' }, border: { top: {style:'medium',color:{rgb:'93C5FD'}}, bottom: {style:'medium',color:{rgb:'93C5FD'}}, left: {style:'thin',color:{rgb:'BFDBFE'}}, right: {style:'thin',color:{rgb:'BFDBFE'}} } };
  const TITLE_STYLE = { font: { bold: true, sz: 13, name: 'Segoe UI', color: { rgb: '1E3A5F' } }, alignment: { horizontal: 'left', vertical: 'center' } };
  const WARNING_STYLE = {
    font: { bold: true, sz: 10, name: 'Segoe UI', color: { rgb: '92400E' } },
    fill: { fgColor: { rgb: 'FEF3C7' } },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    border: { top: {style:'medium',color:{rgb:'F59E0B'}}, bottom: {style:'medium',color:{rgb:'F59E0B'}}, left: {style:'thin',color:{rgb:'FCD34D'}}, right: {style:'thin',color:{rgb:'FCD34D'}} },
  };

  function applyStyles(ws, rows) {
    rows.forEach((row, r) => {
      row.forEach((_, c) => {
        const addr = XLSXStyle.utils.encode_cell({ r, c });
        if (!ws[addr]) return;
        const tag = row.__tag;
        if (tag === 'warning') { ws[addr].s = WARNING_STYLE; return; }
        if (tag === 'title')   { ws[addr].s = TITLE_STYLE; return; }
        if (tag === 'sub')     { ws[addr].s = { font: { sz: 9, name: 'Segoe UI', color: { rgb: '6B7280' } }, alignment: { vertical: 'center' } }; return; }
        if (tag === 'header')  { ws[addr].s = HEADER_STYLE; return; }
        if (tag === 'A')       { ws[addr].s = ROW_A_STYLE; return; }
        if (tag === 'B')       { ws[addr].s = ROW_B_STYLE; return; }
        if (tag === 'C')       { ws[addr].s = ROW_C_STYLE; return; }
        if (tag === 'nhom')    { ws[addr].s = GROUP_STYLE; return; }
        ws[addr].s = DATA_STYLE(r % 2 === 0);
      });
    });
    rows.forEach((row, r) => {
      if (['warning', 'title', 'sub', 'header'].includes(row.__tag)) return;
      const addr = XLSXStyle.utils.encode_cell({ r, c: 1 });
      if (ws[addr]?.s) ws[addr].s = { ...ws[addr].s, alignment: { ...(ws[addr].s.alignment || {}), wrapText: true } };
    });
  }

  const phong = computePhongData(thang);
  const { kpiPhong, nhomMap, kpiCalc, kq_cty, diem_cty, diemPhongSum, tongDiem, ty_le_cty, ty_le_phong } = phong;

  const snap        = getKpiSnapshot(thang);
  const kpiListAll  = snap ? snap.kpiList : getKpiList();
  const kpiCaNhan   = kpiListAll.filter(k => k.kpi_cap === 'ca_nhan').sort((a, b) => a.stt - b.stt);
  const weightCfg   = getTrongSoConfig(thang) || {};
  const ty_le_cn_phong = weightCfg?.ty_le?.ca_nhan?.phong   ?? 30;
  const ty_le_cn_cn    = weightCfg?.ty_le?.ca_nhan?.ca_nhan ?? 70;

  const nvList     = getNvListForThang(thang);
  const inputCNAll = getInputCNByThang(thang);

  const nvSheetNameMap = {};
  nvList.forEach(nv => {
    const nm = nv.ho_ten.replace(/[\\/*?[\]:]/g, '').slice(0, 31);
    nvSheetNameMap[nv.nv_id] = nm || nv.nv_id;
  });

  const wb = XLSXStyle.utils.book_new();

  // === Sheet 1: KPI Phòng ===
  const rowA = Object.assign(['A', 'KPI Công ty', '', kq_cty > 0 ? kq_cty : '', '', '', '', ty_le_cty, diem_cty > 0 ? diem_cty : '', ty_le_cty], { __tag: 'A' });
  const rowB = Object.assign(['B', 'KPI Phòng', '', '', '', '', '', ty_le_phong, diemPhongSum > 0 ? diemPhongSum : '', ty_le_phong], { __tag: 'B' });
  const phongRows = [
    Object.assign([`Báo cáo KPI Phòng — Tháng ${thang.replace('-', '/')}`], { __tag: 'title' }),
    Object.assign([`KPI Công ty: ${kq_cty > 0 ? kq_cty.toFixed(2) + '%' : '—'}   |   Điểm KPI Phòng: ${diemPhongSum.toFixed(2)}đ   |   Tổng: ${tongDiem.toFixed(2)}đ`], { __tag: 'sub' }),
    HEADER,
    rowA,
    rowB,
  ];

  let lastNhomId = null, stt = 0;
  kpiPhong.forEach(k => {
    if (k.nhom_id !== lastNhomId) {
      lastNhomId = k.nhom_id;
      const nhom = nhomMap[k.nhom_id];
      phongRows.push(Object.assign(['', nhom ? `${nhom.thu_tu}. ${nhom.ten_nhom}` : (k.nhom_id || ''), '', '', '', '', '', '', '', ''], { __tag: 'nhom' }));
    }
    stt++;
    const c = kpiCalc[k.kpi_id];
    phongRows.push([stt, k.ten_kpi, k.don_vi || '', c && c.value !== null ? c.value : '', c && c.dispPct ? fmtPctDisp(c.dispPct) : '', c && c.upper !== null ? c.upper : '', c && c.lower !== null ? c.lower : '', c && c.w !== null ? c.w : '', c && c.diem !== null ? c.diem : '', c ? c.max_pct : '']);
  });
  phongRows.push(Object.assign(['C', 'Tổng điểm phòng (A + B)', '', '', '', '', '', '', tongDiem, ''], { __tag: 'C' }));

  const phongStatus = getInputPhongStatus(thang);
  if (phongStatus !== 'full') {
    const msg = phongStatus === 'empty'
      ? `⚠ DỮ LIỆU CHƯA ĐỦ — KPI Phòng tháng ${thang.replace('-','/')}: Chưa nhập dữ liệu. Kết quả trong sheet này chưa phải số liệu chính thức.`
      : `⚠ DỮ LIỆU CHƯA ĐỦ — KPI Phòng tháng ${thang.replace('-','/')}: Thiếu một số chỉ tiêu. Kết quả trong sheet này chưa phải số liệu chính thức.`;
    phongRows.unshift(Object.assign([msg, '', '', '', '', '', '', '', '', ''], { __tag: 'warning' }));
  }

  const wsPhong = XLSXStyle.utils.aoa_to_sheet(phongRows);
  wsPhong['!cols'] = COL_WIDTHS;
  const phFixed = phongStatus !== 'full' ? 4 : 3;
  wsPhong['!rows'] = [
    ...(phongStatus !== 'full' ? [{ hpt: 36 }] : []),
    { hpt: 22 }, { hpt: 20 }, { hpt: 25 },
    ...Array(phongRows.length - phFixed).fill({ hpt: 30 }),
  ];
  wsPhong['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: phFixed }];
  if (phongStatus !== 'full') wsPhong['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];
  applyStyles(wsPhong, phongRows);
  XLSXStyle.utils.book_append_sheet(wb, wsPhong, 'KPI Phòng');

  // === Sheet 2: Tổng hợp điểm KPI NV ===
  {
    const outputDiem    = getOutputDiemByThang(thang);
    const outputDiemMap = Object.fromEntries(outputDiem.map(r => [r.nv_id, r]));

    const rankMap = {};
    const _ss = [...outputDiem.filter(r => r.xep_loai)]
      .sort((a, b) => (b.tong_diem ?? -Infinity) - (a.tong_diem ?? -Infinity));
    let _r = 1;
    _ss.forEach((r, i) => {
      if (i > 0 && r.tong_diem !== _ss[i - 1].tong_diem) _r = i + 1;
      rankMap[r.nv_id] = _r;
    });

    const sumRows = [...nvList]
      .sort((a, b) => (a.nv_id || '').localeCompare(b.nv_id || ''))
      .map(nv => {
        const d = outputDiemMap[nv.nv_id];
        return {
          nv_id:     nv.nv_id,
          ho_ten:    nv.ho_ten,
          nhom_cv:   d?.nhom_cv || nv.nhom_cv || '',
          khu_vuc:   d?.khu_vuc || nv.khu_vuc || '',
          active:    nv.active,
          tong_diem: d?.tong_diem ?? null,
          xep_loai:  d?.xep_loai || null,
          rank:      rankMap[nv.nv_id] ?? null,
        };
      });

    const SUM_HDR_COLS = ['STT', 'Mã NV', 'Họ và tên', 'Trạng thái', 'Nhóm CV', 'Khu vực', 'Điểm KPI', 'Xếp loại', 'Mức độ HT', 'Hạng', 'Chi tiết'];
    const SUM_COL_W    = [{wch:6},{wch:16},{wch:20},{wch:12},{wch:18},{wch:16},{wch:12},{wch:12},{wch:20},{wch:8},{wch:14}];
    const LINK_STYLE   = {
      font: { sz: 10, name: 'Segoe UI', color: { rgb: '1D4ED8' }, underline: true },
      fill: { fgColor: { rgb: 'EFF6FF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top:{style:'thin',color:{rgb:'E2E8F0'}}, bottom:{style:'thin',color:{rgb:'E2E8F0'}}, left:{style:'thin',color:{rgb:'E2E8F0'}}, right:{style:'thin',color:{rgb:'E2E8F0'}} },
    };

    const wsSummary = {};
    wsSummary[XLSXStyle.utils.encode_cell({r:0,c:0})] = {
      v: `Tổng hợp điểm KPI Cá nhân — Tháng ${thang.replace('-','/')}`,
      t: 's', s: TITLE_STYLE,
    };
    SUM_HDR_COLS.forEach((h, c) => {
      wsSummary[XLSXStyle.utils.encode_cell({r:1,c})] = { v: h, t: 's', s: HEADER_STYLE };
    });
    sumRows.forEach((r, i) => {
      const s    = DATA_STYLE(i % 2 === 0);
      const rowR = i + 2;
      const dataCells = [
        { v: i + 1, t: 'n' },
        { v: r.nv_id || '', t: 's' },
        { v: r.ho_ten || '', t: 's' },
        { v: r.active !== false ? 'Đang làm' : 'Đã nghỉ', t: 's' },
        { v: r.nhom_cv, t: 's' },
        { v: r.khu_vuc, t: 's' },
        r.tong_diem != null ? { v: parseFloat(Number(r.tong_diem).toFixed(2)), t: 'n' } : { v: '', t: 's' },
        r.xep_loai ? { v: r.xep_loai, t: 's' } : { v: 'Thiếu dữ liệu', t: 's', _warn: true },
        { v: r.xep_loai ? xepLoaiLabel(r.xep_loai) : '', t: 's' },
        r.rank != null ? { v: r.rank, t: 'n' } : { v: '', t: 's' },
      ];
      dataCells.forEach((cell, c) => {
        const { _warn, ...cellData } = cell;
        const cellStyle = _warn
          ? { ...s, font: { sz: 10, name: 'Segoe UI', bold: true, color: { rgb: '92400E' } }, fill: { fgColor: { rgb: 'FEF3C7' } }, alignment: { horizontal: 'center', vertical: 'center' } }
          : s;
        wsSummary[XLSXStyle.utils.encode_cell({r: rowR, c})] = { ...cellData, s: cellStyle };
      });
      const sheetTarget = nvSheetNameMap[r.nv_id];
      wsSummary[XLSXStyle.utils.encode_cell({r: rowR, c: 10})] = {
        v: 'Xem chi tiết', t: 's', s: LINK_STYLE,
        l: { Target: `#'${sheetTarget}'!A1`, Tooltip: `KPI chi tiết: ${r.ho_ten}` },
      };
    });

    const sumEndRow = 1 + sumRows.length;
    wsSummary['!ref']    = XLSXStyle.utils.encode_range({s:{r:0,c:0}, e:{r:sumEndRow,c:10}});
    wsSummary['!cols']   = SUM_COL_W;
    wsSummary['!rows']   = [{hpt:22},{hpt:25},...Array(sumRows.length).fill({hpt:20})];
    wsSummary['!merges'] = [{s:{r:0,c:0}, e:{r:0,c:10}}];
    wsSummary['!views']  = [{ state: 'frozen', xSplit: 0, ySplit: 2 }];
    XLSXStyle.utils.book_append_sheet(wb, wsSummary, 'Tổng hợp NV');
  }

  // === Sheets: KPI Cá nhân per NV ===
  nvList.forEach(nv => {
    const nvInput = inputCNAll.find(r => r.nv_id === nv.nv_id) || {};

    let diemCaNhanSum = 0;
    const kpiCalcCN = {};
    kpiCaNhan.forEach(kpi => {
      const parseNum = key => {
        const raw = nvInput[kpi.kpi_id + key];
        if (raw === '' || raw === null || raw === undefined) return null;
        const f = parseFloat(raw); return isNaN(f) ? null : f;
      };
      const rawMp2 = parseNum('_max_pct');
      const maxPct = rawMp2 !== null && rawMp2 > 0 ? (rawMp2 > 2 ? rawMp2 / 100 : rawMp2) : 1;
      const rawGt2 = parseFloat(nvInput[kpi.kpi_id + '_giam_tru']);
      const giamTru = isNaN(rawGt2) ? 1 : (rawGt2 > 2 ? rawGt2 / 100 : rawGt2);
      const v = parseNum('_value'), lo = parseNum('_lower'), hi = parseNum('_upper'), ws = parseNum('_trong_so');
      const hasAny = v !== null || lo !== null || hi !== null || ws !== null;
      if (!hasAny) { kpiCalcCN[kpi.kpi_id] = null; return; }
      const effectiveHi = hi !== null ? hi * giamTru : null;
      let diem = null, dispPct = null;
      if (v !== null && lo !== null && effectiveHi !== null && ws !== null && effectiveHi !== lo) {
        dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower, giamTru);
        diem = kpiScore(v, lo, hi, maxPct, ws, giamTru);
        if (diem !== null) diemCaNhanSum += diem;
      } else if (v !== null && hi !== null) {
        dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower, giamTru);
      }
      kpiCalcCN[kpi.kpi_id] = { value: v, lower: lo, upper: effectiveHi, w: ws, dispPct, diem, diemMax: Math.round(maxPct * 100) };
    });

    const diemPhongDongGop = tongDiem * (ty_le_cn_phong / 100);
    const tongDiemCN = diemPhongDongGop + diemCaNhanSum;

    const cnRowA = Object.assign(['A', 'KPI Phòng', '', tongDiem > 0 ? tongDiem : '', '', '', '', ty_le_cn_phong, diemPhongDongGop > 0 ? diemPhongDongGop : '', ''], { __tag: 'A' });
    const cnRowB = Object.assign(['B', 'KPI Cá nhân', '', '', '', '', '', ty_le_cn_cn, diemCaNhanSum > 0 ? diemCaNhanSum : '', ''], { __tag: 'B' });
    const cnRows = [
      Object.assign([`Báo cáo KPI Cá nhân — ${nv.ho_ten} — Tháng ${thang.replace('-', '/')}`], { __tag: 'title' }),
      Object.assign([`Nhóm CV: ${nv.nhom_cv || ''}   |   Khu vực: ${nv.khu_vuc || ''}`], { __tag: 'sub' }),
      HEADER,
      cnRowA,
      cnRowB,
    ];

    let lastNhomCNId = null, sttCN = 0;
    kpiCaNhan.forEach(k => {
      if (k.nhom_id !== lastNhomCNId) {
        lastNhomCNId = k.nhom_id;
        const nhom = nhomMap[k.nhom_id];
        cnRows.push(Object.assign(['', nhom ? `${nhom.thu_tu}. ${nhom.ten_nhom}` : (k.nhom_id || ''), '', '', '', '', '', '', '', ''], { __tag: 'nhom' }));
      }
      sttCN++;
      const c = kpiCalcCN[k.kpi_id];
      cnRows.push([sttCN, k.ten_kpi, k.don_vi || '', c && c.value !== null ? c.value : '', c && c.dispPct ? fmtPctDisp(c.dispPct) : '', c && c.upper !== null ? c.upper : '', c && c.lower !== null ? c.lower : '', c && c.w !== null ? c.w : '', c && c.diem !== null ? c.diem : '', c ? c.diemMax : '']);
    });
    cnRows.push(Object.assign(['C', 'Tổng điểm', '', '', '', '', '', '', tongDiemCN > 0 ? tongDiemCN : '', ''], { __tag: 'C' }));

    const nvStatus = getInputCNStatus(thang, nv.nv_id);
    if (nvStatus !== 'full') {
      const msg = nvStatus === 'empty'
        ? `⚠ DỮ LIỆU CHƯA ĐỦ — ${nv.ho_ten} — Tháng ${thang.replace('-','/')}: Chưa nhập dữ liệu. Kết quả trong sheet này chưa phải số liệu chính thức.`
        : `⚠ DỮ LIỆU CHƯA ĐỦ — ${nv.ho_ten} — Tháng ${thang.replace('-','/')}: Thiếu một số chỉ tiêu (hoặc KPI Phòng chưa đủ). Kết quả chưa phải điểm chính thức.`;
      cnRows.unshift(Object.assign([msg, '', '', '', '', '', '', '', '', ''], { __tag: 'warning' }));
    }

    const wsName = nvSheetNameMap[nv.nv_id];
    const wsCN = XLSXStyle.utils.aoa_to_sheet(cnRows);
    wsCN['!cols'] = COL_WIDTHS;
    const cnFixed = nvStatus !== 'full' ? 4 : 3;
    wsCN['!rows'] = [
      ...(nvStatus !== 'full' ? [{ hpt: 36 }] : []),
      { hpt: 22 }, { hpt: 20 }, { hpt: 25 },
      ...Array(cnRows.length - cnFixed).fill({ hpt: 30 }),
    ];
    wsCN['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: cnFixed }];
    if (nvStatus !== 'full') wsCN['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];
    applyStyles(wsCN, cnRows);
    XLSXStyle.utils.book_append_sheet(wb, wsCN, wsName);
  });

  XLSXStyle.writeFile(wb, `BaoCaoKPI_ChiTietThang_${thang}.xlsx`);
}

// ─── Xuất tổng hợp tất cả NV × tất cả tháng trong năm ───────────────────────
// Sheet chính: cross-table tháng × NV, điểm có màu theo xếp loại

function exportAllNvAllMonthsToExcel(year, filteredThangList) {
  const nvLibrary = getNvLibrary().sort((a, b) => (a.nv_id || '').localeCompare(b.nv_id || ''));
  if (!nvLibrary.length) return alert('Không có dữ liệu nhân viên.');

  // Lấy output_diem từ localStorage cho tất cả tháng
  const diemMap = {};   // diemMap[thang][nv_id] = { tong_diem, xep_loai }
  filteredThangList.forEach(thang => {
    diemMap[thang] = {};
    getOutputDiemByThang(thang).forEach(r => {
      diemMap[thang][r.nv_id] = { tong_diem: r.tong_diem, xep_loai: r.xep_loai };
    });
  });

  // Lọc tháng có ít nhất 1 NV có điểm
  const activeMonths = filteredThangList.filter(t => Object.keys(diemMap[t] || {}).length > 0);
  if (!activeMonths.length) return alert(`Không có dữ liệu điểm KPI cá nhân cho năm ${year}.`);

  // Màu xếp loại — chỉ dùng cho Sheet 2 (Xếp loại), palette nhạt chuyên nghiệp
  const XL_FILL_LOAI = {
    'A+': { bg: 'EDE9FE', fg: '5B21B6' },
    A:    { bg: 'DCFCE7', fg: '166534' },
    B:    { bg: 'DBEAFE', fg: '1E40AF' },
    C:    { bg: 'FEF9C3', fg: '854D0E' },
    D:    { bg: 'FEE2E2', fg: '991B1B' },
  };

  const HDR_STYLE = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Segoe UI' },
    fill: { fgColor: { rgb: '1E40AF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top:{style:'thin',color:{rgb:'93C5FD'}}, bottom:{style:'thin',color:{rgb:'93C5FD'}}, left:{style:'thin',color:{rgb:'93C5FD'}}, right:{style:'thin',color:{rgb:'93C5FD'}} },
  };
  const HDR_NV_STYLE = {
    ...HDR_STYLE,
    fill: { fgColor: { rgb: '1D4ED8' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  };
  const BORDER = { top:{style:'thin',color:{rgb:'E2E8F0'}}, bottom:{style:'thin',color:{rgb:'E2E8F0'}}, left:{style:'thin',color:{rgb:'E2E8F0'}}, right:{style:'thin',color:{rgb:'E2E8F0'}} };
  const EMPTY_CELL = {
    font: { sz: 10, name: 'Segoe UI', color: { rgb: 'D1D5DB' } },
    fill: { fgColor: { rgb: 'FAFAFA' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: BORDER,
  };
  const MONTH_CELL = {
    font: { bold: true, sz: 10, name: 'Segoe UI', color: { rgb: '1E3A8A' } },
    fill: { fgColor: { rgb: 'EFF6FF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top:{style:'thin',color:{rgb:'BFDBFE'}}, bottom:{style:'thin',color:{rgb:'BFDBFE'}}, left:{style:'thin',color:{rgb:'BFDBFE'}}, right:{style:'thin',color:{rgb:'BFDBFE'}} },
  };

  const TITLE_S = { font: { bold: true, sz: 13, name: 'Segoe UI', color: { rgb: '1E3A5F' } }, alignment: { horizontal: 'left', vertical: 'center' } };

  const wb = XLSXStyle.utils.book_new();

  // ── Sheet 1: Cross-table điểm (plain, không tô màu xếp loại) ─────────────
  const ws = {};

  const totalCols = 2 + nvLibrary.length;  // STT + Tháng + n NV
  ws[XLSXStyle.utils.encode_cell({ r: 0, c: 0 })] = { v: `Tổng hợp điểm KPI Cá nhân năm ${year} — Ô trống = chưa có đủ dữ liệu để tính điểm (tháng thiếu dữ liệu không được xếp loại)`, t: 's', s: TITLE_S };

  ws[XLSXStyle.utils.encode_cell({ r: 1, c: 0 })] = { v: 'STT', t: 's', s: HDR_STYLE };
  ws[XLSXStyle.utils.encode_cell({ r: 1, c: 1 })] = { v: 'Tháng', t: 's', s: HDR_STYLE };
  nvLibrary.forEach((nv, ci) => {
    ws[XLSXStyle.utils.encode_cell({ r: 1, c: 2 + ci })] = { v: nv.ho_ten, t: 's', s: HDR_NV_STYLE };
  });

  activeMonths.forEach((thang, ri) => {
    const rowR = ri + 2;
    ws[XLSXStyle.utils.encode_cell({ r: rowR, c: 0 })] = { v: ri + 1, t: 'n', s: MONTH_CELL };
    ws[XLSXStyle.utils.encode_cell({ r: rowR, c: 1 })] = { v: thang, t: 's', s: MONTH_CELL };

    nvLibrary.forEach((nv, ci) => {
      const d = diemMap[thang]?.[nv.nv_id];
      const cellAddr = XLSXStyle.utils.encode_cell({ r: rowR, c: 2 + ci });
      if (d?.tong_diem != null && d.tong_diem > 0 && d.xep_loai) {
        const colors = XL_FILL_LOAI[d.xep_loai];
        ws[cellAddr] = {
          v: parseFloat(Number(d.tong_diem).toFixed(2)),
          t: 'n',
          s: {
            font: { bold: true, sz: 10, name: 'Segoe UI', color: { rgb: colors?.fg || '1E3A5F' } },
            fill: { fgColor: { rgb: colors?.bg || 'F8FAFC' } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: BORDER,
          },
        };
      } else {
        ws[cellAddr] = { v: '', t: 's', s: EMPTY_CELL };
      }
    });
  });

  const endRow = 1 + activeMonths.length;
  ws['!ref'] = XLSXStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: endRow, c: totalCols - 1 } });
  ws['!cols'] = [{ wch: 6 }, { wch: 12 }, ...nvLibrary.map(() => ({ wch: 18 }))];
  ws['!rows'] = [{ hpt: 22 }, { hpt: 40 }, ...activeMonths.map(() => ({ hpt: 20 }))];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }];
  ws['!views'] = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
  XLSXStyle.utils.book_append_sheet(wb, ws, `Điểm NV ${year}`);

  // ── Sheet 2: Xếp loại (tô màu nhạt theo xếp loại) ────────────────────────
  const ws2 = {};
  ws2[XLSXStyle.utils.encode_cell({ r: 0, c: 0 })] = { v: `Xếp loại KPI Cá nhân năm ${year} — Ô trống = chưa có đủ dữ liệu để xếp loại`, t: 's', s: TITLE_S };
  ws2[XLSXStyle.utils.encode_cell({ r: 1, c: 0 })] = { v: 'STT', t: 's', s: HDR_STYLE };
  ws2[XLSXStyle.utils.encode_cell({ r: 1, c: 1 })] = { v: 'Tháng', t: 's', s: HDR_STYLE };
  nvLibrary.forEach((nv, ci) => {
    ws2[XLSXStyle.utils.encode_cell({ r: 1, c: 2 + ci })] = { v: nv.ho_ten, t: 's', s: HDR_NV_STYLE };
  });
  activeMonths.forEach((thang, ri) => {
    const rowR = ri + 2;
    ws2[XLSXStyle.utils.encode_cell({ r: rowR, c: 0 })] = { v: ri + 1, t: 'n', s: MONTH_CELL };
    ws2[XLSXStyle.utils.encode_cell({ r: rowR, c: 1 })] = { v: thang, t: 's', s: MONTH_CELL };
    nvLibrary.forEach((nv, ci) => {
      const d = diemMap[thang]?.[nv.nv_id];
      const cellAddr = XLSXStyle.utils.encode_cell({ r: rowR, c: 2 + ci });
      if (d?.xep_loai && d.tong_diem > 0) {
        const colors = XL_FILL_LOAI[d.xep_loai];
        ws2[cellAddr] = {
          v: d.xep_loai,
          t: 's',
          s: {
            font: { bold: true, sz: 11, name: 'Segoe UI', color: { rgb: colors?.fg || '1F2937' } },
            fill: { fgColor: { rgb: colors?.bg || 'F3F4F6' } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: BORDER,
          },
        };
      } else {
        ws2[cellAddr] = { v: '', t: 's', s: EMPTY_CELL };
      }
    });
  });
  ws2['!ref'] = XLSXStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: endRow, c: totalCols - 1 } });
  ws2['!cols'] = [{ wch: 6 }, { wch: 12 }, ...nvLibrary.map(() => ({ wch: 12 }))];
  ws2['!rows'] = [{ hpt: 22 }, { hpt: 40 }, ...activeMonths.map(() => ({ hpt: 20 }))];
  ws2['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }];
  ws2['!views'] = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
  XLSXStyle.utils.book_append_sheet(wb, ws2, `Xếp loại ${year}`);

  XLSXStyle.writeFile(wb, `BaoCaoKPI_TatCaNV_${year}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ============================================================
// Tab 1: Báo cáo KPI Phòng
// ============================================================
function BaoCaoPhongTab({ thang }) {
  const allThangList = useMemo(() => [...new Set([
    ...getSnapshotThangList(), ...getInputPhong().map(r => r.thang), ...getThangList(),
  ])].sort().reverse(), []);
  const availableYears = useMemo(() => {
    const y = new Set(allThangList.map(t => t.slice(0, 4)));
    return [...y].sort().reverse();
  }, [allThangList]);
  const [exportYear, setExportYear] = useState(() => new Date().getFullYear().toString());

  const snap        = thang ? getKpiSnapshot(thang) : null;
  const kpiListAll  = snap ? snap.kpiList : getKpiList();
  const kpiPhong    = kpiListAll.filter(k => k.kpi_cap === 'phong').sort((a, b) => a.stt - b.stt);
  const nhomListAll = snap?.nhomList || getNhomList();
  const nhomMap     = Object.fromEntries(nhomListAll.filter(n => n.kpi_cap === 'phong').map(n => [n.nhom_id, n]));

  const inp         = thang ? (getInputPhongByThang(thang) || {}) : {};
  const weightConfig = thang ? getTrongSoConfig(thang) : null;
  const ty_le_cty   = weightConfig?.ty_le?.phong?.cty   ?? 50;
  const ty_le_phong = weightConfig?.ty_le?.phong?.phong ?? 50;
  const hasData     = Object.keys(inp).length > 0;

  let diemPhongSum = 0;
  const kpiCalc = {};
  kpiPhong.forEach(kpi => {
    const parseNum = key => {
      const raw = inp[kpi.kpi_id + key];
      if (raw === '' || raw === null || raw === undefined) return null;
      const f = parseFloat(raw);
      return isNaN(f) ? null : f;
    };
    const v  = parseNum('_value');
    const lo = parseNum('_lower');
    const hi = parseNum('_upper');
    const ws = parseNum('_trong_so');
    const rawMp = parseNum('_max_pct');
    const hasAny = v !== null || lo !== null || hi !== null || ws !== null;
    if (!hasAny) { kpiCalc[kpi.kpi_id] = null; return; }
    const maxPct = rawMp !== null && rawMp > 0 ? (rawMp > 2 ? rawMp / 100 : rawMp) : (kpi.max_pct ?? 1);
    let diem = null, dispPct = null;
    if (v !== null && lo !== null && hi !== null && ws !== null) {
      dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower);
      diem = kpiScore(v, lo, hi, maxPct, ws, 1);
      if (diem !== null) diemPhongSum += diem;
    } else if (v !== null && hi !== null) {
      dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower);
    }
    kpiCalc[kpi.kpi_id] = { value: v, lower: lo, upper: hi, w: ws, dispPct, diem, max_pct: Math.round(maxPct * 100) };
  });

  const kq_cty   = parseFloat(inp.diem_kpi_chinhanh_kq) || 0;
  const diem_cty = parseFloat(inp.diem_kpi_chinhanh) || (kq_cty * ty_le_cty / 100);
  const tongDiem = diem_cty + diemPhongSum;

  const tableRows = [];
  let lastNhomId = null, stt = 0;
  kpiPhong.forEach(k => {
    if (k.nhom_id !== lastNhomId) {
      lastNhomId = k.nhom_id;
      const nhom = nhomMap[k.nhom_id];
      tableRows.push({ type: 'nhom', label: nhom ? `${nhom.thu_tu}. ${nhom.ten_nhom}` : k.nhom_id });
    }
    stt++;
    tableRows.push({ type: 'kpi', stt, kpi: k, calc: kpiCalc[k.kpi_id] });
  });

  const phongStatus = getInputPhongStatus(thang);

  if (!thang) return null;

  const handleExportAllMonths = () => {
    const months = allThangList.filter(t => t.startsWith(exportYear));
    if (!months.length) return alert(`Không có dữ liệu năm ${exportYear}.`);
    exportPhongAllMonthsToExcel(months);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap no-print">
        <span className={{
          empty: 'badge bg-gray-100 text-gray-400',
          partial: 'badge bg-yellow-100 text-yellow-700',
          full: 'badge bg-green-100 text-green-700',
        }[phongStatus]}>
          {{ empty: 'Chưa có dữ liệu', partial: 'Thiếu dữ liệu', full: '✓ Đủ dữ liệu' }[phongStatus]}
        </span>
        <div className="ml-auto flex items-center gap-2">
        <select value={exportYear} onChange={e => setExportYear(e.target.value)}
          className="input text-xs py-2" style={{ width: '7rem' }}>
          {availableYears.map(y => <option key={y} value={y}>Năm {y}</option>)}
        </select>
        <button className="btn-secondary text-xs" onClick={handleExportAllMonths}
          title="Xuất toàn bộ KPI Phòng của năm đã chọn sang Excel">
          📥 Xuất toàn bộ KPI Phòng năm đã chọn
        </button>
        </div>
      </div>
      {hasData && (
        <div className="flex flex-wrap gap-3 text-sm bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
          <span>
            <span className="text-gray-500">KPI Công ty: </span>
            <strong>{kq_cty > 0 ? `${kq_cty.toFixed(2)}` : '—'}</strong>
            <span className="text-gray-400 text-xs ml-1">(→ {fmt(diem_cty)} đ)</span>
          </span>
          <span className="text-gray-300">|</span>
          <span>
            <span className="text-gray-500">KPI Phòng: </span>
            <strong>{fmt(diemPhongSum)} đ</strong>
          </span>
          <span className="text-gray-300">|</span>
          <span className="font-bold text-blue-700">Tổng điểm: {fmt(tongDiem)} / 100 đ</span>
        </div>
      )}

      <div className="card p-0 overflow-hidden print:shadow-none print:border-0">
        <div className="text-center py-4 px-6 border-b">
          <p className="text-base font-bold uppercase tracking-wide">Bảng đánh giá kết quả thực hiện KPI Phòng</p>
          <p className="text-gray-500 mt-1 text-sm">Tháng {thang.replace('-', '/')}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            {THEAD}
            <tbody>
              {/* Row A */}
              <tr className="bg-green-50 text-green-900 font-semibold">
                <td className="px-2 py-2 text-center border border-green-200">A</td>
                <td className="px-3 py-2 border border-green-200">KPI Công ty</td>
                <td className="border border-green-200" />
                <td className="px-2 py-2 text-right border border-green-200">{kq_cty > 0 ? `${kq_cty.toFixed(2)}` : '—'}</td>
                <td className="border border-green-200" />
                <td className="border border-green-200" />
                <td className="border border-green-200" />
                <td className="px-2 py-2 text-right border border-green-200">{ty_le_cty}</td>
                <td className="px-2 py-2 text-right font-bold text-green-700 border border-green-200">{diem_cty > 0 ? fmt(diem_cty) : '—'}</td>
                <td className="px-2 py-2 text-right border border-green-200">{ty_le_cty}</td>
              </tr>

              {/* Row B */}
              <tr className="bg-blue-50 text-blue-900 font-semibold">
                <td className="px-2 py-2 text-center border border-blue-200">B</td>
                <td className="px-3 py-2 border border-blue-200">KPI Phòng</td>
                <td colSpan={5} className="border border-blue-200" />
                <td className="px-2 py-2 text-right border border-blue-200">{ty_le_phong}</td>
                <td className="px-2 py-2 text-right font-bold text-blue-700 border border-blue-200">{diemPhongSum > 0 ? fmt(diemPhongSum) : '—'}</td>
                <td className="px-2 py-2 text-right text-blue-500 border border-blue-200">{ty_le_phong}</td>
              </tr>

              {!hasData ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-400 italic">
                    Chưa có dữ liệu cho tháng này. Vào "Nhập liệu KPI" → tab "KPI Phòng" để nhập.
                  </td>
                </tr>
              ) : tableRows.map((row, idx) => {
                if (row.type === 'nhom') {
                  return (
                    <tr key={`nhom-${idx}`} className="bg-blue-50 border-t border-blue-100">
                      <td colSpan={10} className="px-3 py-1.5 font-semibold text-blue-700 text-xs border border-blue-100">
                        {row.label}
                      </td>
                    </tr>
                  );
                }
                const { kpi, calc, stt: s } = row;
                return (
                  <tr key={kpi.kpi_id} className="border border-gray-100 hover:bg-gray-50">
                    <td className="px-2 py-2 text-center text-gray-400 border border-gray-200">{s}</td>
                    <td className="px-3 py-2 text-gray-800 border border-gray-200">
                      {kpi.ten_kpi}
                      <span className="block text-gray-400 font-mono mt-0.5">{kpi.kpi_id}</span>
                    </td>
                    <td className="px-2 py-2 text-center text-gray-500 border border-gray-200">{kpi.don_vi}</td>
                    <td className="px-2 py-2 text-right font-medium border border-gray-200">{calc && calc.value !== null ? fmt(calc.value, 3) : ''}</td>
                    <td className={`px-2 py-2 text-right border border-gray-200${calc?.dispPct?.error ? ' text-red-500 text-xs' : ''}`}>{calc && calc.dispPct ? fmtPctDisp(calc.dispPct) : ''}</td>
                    <td className="px-2 py-2 text-right border border-gray-200">{calc && calc.upper !== null ? fmt(calc.upper, 3) : ''}</td>
                    <td className="px-2 py-2 text-right border border-gray-200">{calc && calc.lower !== null ? fmt(calc.lower, 3) : ''}</td>
                    <td className="px-2 py-2 text-right border border-gray-200">{calc && calc.w !== null ? calc.w : ''}</td>
                    <td className="px-2 py-2 text-right font-semibold text-blue-700 border border-gray-200">
                      {calc && calc.diem !== null ? fmt(calc.diem, 3) : ''}
                    </td>
                    <td className="px-2 py-2 text-right border border-gray-200">{calc ? calc.max_pct : ''}</td>
                  </tr>
                );
              })}

              {/* Row C */}
              <tr className="bg-gray-100 text-gray-800 font-bold border-t-2 border-gray-300">
                <td className="px-2 py-3 text-center border border-gray-200">C</td>
                <td colSpan={7} className="px-3 py-3 border border-gray-200">Tổng điểm phòng (A + B)</td>
                <td className="px-2 py-3 text-right text-blue-700 border border-gray-200">{hasData ? fmt(tongDiem) : '—'}</td>
                <td className="border border-gray-200" />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Xuất toàn bộ KPI của 1 nhân viên (tất cả tháng) ─────────────────────────

function exportNvAllMonthsToExcel(nvId, hoTen, xepLoaiCfg, filteredThangList) {
  const thangList = filteredThangList || getSnapshotThangList();
  const wb        = XLSXStyle.utils.book_new();

  // ── Styles giống exportAllToExcel ────────────────────────────────────────
  const HEADER     = Object.assign(
    ['STT', 'Tên KPI', 'ĐVT', 'KQ thực hiện', '% Thực hiện', 'Chỉ tiêu', 'Ngưỡng dưới', 'Trọng số', 'Điểm Quy đổi', 'Điểm tối đa'],
    { __tag: 'header' }
  );
  const COL_WIDTHS = [{ wch: 6 }, { wch: 44 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
  const HEADER_STYLE = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Segoe UI' },
    fill: { fgColor: { rgb: '1E40AF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top:{style:'thin',color:{rgb:'93C5FD'}}, bottom:{style:'thin',color:{rgb:'93C5FD'}}, left:{style:'thin',color:{rgb:'93C5FD'}}, right:{style:'thin',color:{rgb:'93C5FD'}} },
  };
  const DATA_STYLE  = (isEven) => ({
    font: { sz: 10, name: 'Segoe UI' },
    fill: { fgColor: { rgb: isEven ? 'F0F9FF' : 'FFFFFF' } },
    alignment: { vertical: 'center' },
    border: { top:{style:'thin',color:{rgb:'E2E8F0'}}, bottom:{style:'thin',color:{rgb:'E2E8F0'}}, left:{style:'thin',color:{rgb:'E2E8F0'}}, right:{style:'thin',color:{rgb:'E2E8F0'}} },
  });
  const GROUP_STYLE = {
    font: { bold: true, sz: 10, name: 'Segoe UI', color: { rgb: '1E40AF' } },
    fill: { fgColor: { rgb: 'DBEAFE' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: { top:{style:'thin',color:{rgb:'BFDBFE'}}, bottom:{style:'thin',color:{rgb:'BFDBFE'}}, left:{style:'thin',color:{rgb:'BFDBFE'}}, right:{style:'thin',color:{rgb:'BFDBFE'}} },
  };
  const ROW_A_STYLE = { font:{bold:true,sz:10,name:'Segoe UI',color:{rgb:'14532D'}}, fill:{fgColor:{rgb:'DCFCE7'}}, alignment:{vertical:'center'}, border:{top:{style:'thin',color:{rgb:'86EFAC'}}, bottom:{style:'thin',color:{rgb:'86EFAC'}}, left:{style:'thin',color:{rgb:'86EFAC'}}, right:{style:'thin',color:{rgb:'86EFAC'}}} };
  const ROW_B_STYLE = { font:{bold:true,sz:10,name:'Segoe UI',color:{rgb:'1E3A5F'}}, fill:{fgColor:{rgb:'DBEAFE'}}, alignment:{vertical:'center'}, border:{top:{style:'thin',color:{rgb:'93C5FD'}}, bottom:{style:'thin',color:{rgb:'93C5FD'}}, left:{style:'thin',color:{rgb:'93C5FD'}}, right:{style:'thin',color:{rgb:'93C5FD'}}} };
  const ROW_C_STYLE = { font:{bold:true,sz:10,name:'Segoe UI',color:{rgb:'1E40AF'}}, fill:{fgColor:{rgb:'EFF6FF'}}, alignment:{vertical:'center'}, border:{top:{style:'medium',color:{rgb:'93C5FD'}}, bottom:{style:'medium',color:{rgb:'93C5FD'}}, left:{style:'thin',color:{rgb:'BFDBFE'}}, right:{style:'thin',color:{rgb:'BFDBFE'}}} };
  const TITLE_STYLE = { font:{bold:true,sz:13,name:'Segoe UI',color:{rgb:'1E3A5F'}}, alignment:{horizontal:'left',vertical:'center'} };
  const SUB_STYLE   = { font:{sz:9,name:'Segoe UI',color:{rgb:'6B7280'}}, alignment:{vertical:'center'} };
  const WARNING_STYLE_NV = {
    font:{bold:true,sz:10,name:'Segoe UI',color:{rgb:'92400E'}},
    fill:{fgColor:{rgb:'FEF3C7'}},
    alignment:{horizontal:'left',vertical:'center',wrapText:true},
    border:{top:{style:'medium',color:{rgb:'F59E0B'}},bottom:{style:'medium',color:{rgb:'F59E0B'}},left:{style:'thin',color:{rgb:'FCD34D'}},right:{style:'thin',color:{rgb:'FCD34D'}}},
  };

  // Styles riêng cho sheet tổng hợp
  const SUM_HDR = {
    font:{bold:true,color:{rgb:'FFFFFF'},sz:11,name:'Segoe UI'},
    fill:{fgColor:{rgb:'1E40AF'}},
    alignment:{horizontal:'center',vertical:'center',wrapText:true},
    border:{top:{style:'thin',color:{rgb:'93C5FD'}},bottom:{style:'thin',color:{rgb:'93C5FD'}},left:{style:'thin',color:{rgb:'93C5FD'}},right:{style:'thin',color:{rgb:'93C5FD'}}},
  };
  const SUM_DATA  = (isEven) => ({
    font:{sz:10,name:'Segoe UI'},
    fill:{fgColor:{rgb:isEven?'F0F9FF':'FFFFFF'}},
    alignment:{vertical:'center',wrapText:false},
    border:{top:{style:'thin',color:{rgb:'E2E8F0'}},bottom:{style:'thin',color:{rgb:'E2E8F0'}},left:{style:'thin',color:{rgb:'E2E8F0'}},right:{style:'thin',color:{rgb:'E2E8F0'}}},
  });
  const LINK_STYLE = (isEven) => ({
    ...SUM_DATA(isEven),
    font:{sz:10,name:'Segoe UI',color:{rgb:'1D4ED8'},underline:true},
    alignment:{horizontal:'center',vertical:'center'},
  });
  const WARN_CELL_STYLE = (isEven) => ({
    ...SUM_DATA(isEven),
    font:{sz:10,name:'Segoe UI',bold:true,color:{rgb:'92400E'}},
    fill:{fgColor:{rgb:'FEF3C7'}},
    alignment:{horizontal:'center',vertical:'center'},
  });

  function applyStylesDetail(ws, rows) {
    rows.forEach((row, r) => {
      row.forEach((_, c) => {
        const addr = XLSXStyle.utils.encode_cell({ r, c });
        if (!ws[addr]) return;
        const tag = row.__tag;
        if (tag === 'warning') { ws[addr].s = WARNING_STYLE_NV; return; }
        if (tag === 'title')   { ws[addr].s = TITLE_STYLE; return; }
        if (tag === 'sub')     { ws[addr].s = SUB_STYLE; return; }
        if (tag === 'header')  { ws[addr].s = HEADER_STYLE; return; }
        if (tag === 'A')       { ws[addr].s = ROW_A_STYLE; return; }
        if (tag === 'B')       { ws[addr].s = ROW_B_STYLE; return; }
        if (tag === 'C')       { ws[addr].s = ROW_C_STYLE; return; }
        if (tag === 'nhom')    { ws[addr].s = GROUP_STYLE; return; }
        ws[addr].s = DATA_STYLE(r % 2 === 0);
      });
    });
    rows.forEach((row, r) => {
      if (['warning', 'title', 'sub', 'header'].includes(row.__tag)) return;
      const addr = XLSXStyle.utils.encode_cell({ r, c: 1 });
      if (ws[addr]?.s) ws[addr].s = { ...ws[addr].s, alignment: { ...(ws[addr].s.alignment || {}), wrapText: true } };
    });
  }

  // ── Thu thập dữ liệu ─────────────────────────────────────────────────────
  const allMonthData = [];
  thangList.forEach(thang => {
    const snap    = getKpiSnapshot(thang);
    const kpiList = (snap?.kpiList || []).filter(k => k.kpi_cap === 'ca_nhan').sort((a, b) => a.stt - b.stt);
    const nvList  = getNvListForThang(thang);
    const nvInfo  = nvList.find(n => n.nv_id === nvId);
    if (!nvInfo) return;

    const nhomMap   = Object.fromEntries((snap?.nhomList || []).map(n => [n.nhom_id, n]));
    const inputCN   = (getInputCNByThang(thang) || []).find(r => r.nv_id === nvId) || {};
    const diemRow   = getOutputDiemByThang(thang).find(r => r.nv_id === nvId) || null;
    const chiTiet   = getOutputCTByThangNV(thang, nvId);
    const weightCfg = getTrongSoConfig(thang) || {};
    const ty_le_ph  = weightCfg?.ty_le?.ca_nhan?.phong   ?? 30;
    const ty_le_cn  = weightCfg?.ty_le?.ca_nhan?.ca_nhan ?? 70;

    const kpiCalc = {};
    kpiList.forEach(kpi => {
      const ct = chiTiet.find(c => c.kpi_id === kpi.kpi_id);
      if (ct) {
        kpiCalc[kpi.kpi_id] = {
          value: ct.value, lower: ct.lower, upper: ct.upper,
          w: ct.weight_tuong_doi, diem: ct.diem_quy_doi,
          diemMax: ct.max_pct != null ? Math.round(ct.max_pct * 100) : null,
          pctDisp: ct.pct_th != null ? fmtPct(ct.pct_th) : '',
        };
      } else {
        const parseNum = key => {
          const raw = inputCN[kpi.kpi_id + key];
          if (raw === '' || raw === null || raw === undefined) return null;
          const f = parseFloat(raw); return isNaN(f) ? null : f;
        };
        const rawGt   = parseFloat(inputCN[kpi.kpi_id + '_giam_tru']);
        const giamTru = isNaN(rawGt) ? 1 : (rawGt > 2 ? rawGt / 100 : rawGt);
        const rawMp   = parseNum('_max_pct');
        const maxPct  = rawMp !== null && rawMp > 0 ? (rawMp > 2 ? rawMp / 100 : rawMp) : 1;
        const v = parseNum('_value'), lo = parseNum('_lower'), hi = parseNum('_upper'), w = parseNum('_trong_so');
        const hasAny = v !== null || lo !== null || hi !== null || w !== null;
        if (!hasAny) { kpiCalc[kpi.kpi_id] = null; return; }
        const effectiveHi = hi !== null ? hi * giamTru : null;
        let diem = null, dispPct = null;
        if (v !== null && lo !== null && effectiveHi !== null && w !== null && effectiveHi !== lo) {
          dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower, giamTru);
          diem    = kpiScore(v, lo, hi, maxPct, w, giamTru);
        } else if (v !== null && hi !== null) {
          dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower, giamTru);
        }
        kpiCalc[kpi.kpi_id] = { value: v, lower: lo, upper: effectiveHi, w, diem,
          diemMax: Math.round(maxPct * 100), pctDisp: dispPct ? fmtPctDisp(dispPct) : '' };
      }
    });

    const diemCaNhan  = Math.round(kpiList.reduce((s, k) => s + (kpiCalc[k.kpi_id]?.diem ?? 0), 0) * 1000) / 1000;
    const phongLocal  = computePhongData(thang);
    const hasPhong    = !!(phongLocal.inp?.thang);
    const phongRaw    = hasPhong ? phongLocal.tongDiem
      : (diemRow?.diem_phong_dong_gop != null ? diemRow.diem_phong_dong_gop / (ty_le_ph / 100) : null);
    const diemPhongDG = hasPhong
      ? Math.round(phongLocal.tongDiem * (ty_le_ph / 100) * 1000) / 1000
      : (diemRow?.diem_phong_dong_gop ?? null);
    const tongDiem = (diemPhongDG !== null || diemCaNhan > 0)
      ? Math.round(((diemPhongDG ?? 0) + diemCaNhan) * 1000) / 1000
      : (diemRow?.tong_diem ?? null);

    allMonthData.push({ thang, kpiList, kpiCalc, diemRow, nhomMap, ty_le_ph, ty_le_cn, diemCaNhan, diemPhongDG, phongRaw, tongDiem, nvInfo, cnStatus: getInputCNStatus(thang, nvId) });
  });

  if (!allMonthData.length) return alert('Không có dữ liệu tháng nào cho nhân viên này.');

  // ── Sheet tổng hợp ────────────────────────────────────────────────────────
  const sumHeaders = ['STT', 'Tháng/năm', 'Tên nhân viên', 'KPI Phòng', 'KPI Cá nhân', 'Tổng điểm', 'Xếp loại', 'Mức độ hoàn thành', 'Sheet chi tiết', 'Ghi chú'];
  const sumRows = allMonthData.map((d, i) => {
    const xl = d.tongDiem != null ? (xepLoaiWithConfig(d.tongDiem, xepLoaiCfg) || '') : (d.diemRow?.xep_loai || '');
    const cnStatus = getInputCNStatus(d.thang, nvId);
    const note = cnStatus !== 'full' ? (cnStatus === 'empty' ? '⚠ Chưa nhập dữ liệu' : '⚠ Thiếu dữ liệu') : '';
    return [i + 1, d.thang, hoTen,
      d.diemPhongDG ?? '', d.diemCaNhan > 0 ? d.diemCaNhan : (d.diemRow?.diem_ca_nhan ?? ''),
      d.tongDiem ?? '', xl, xepLoaiLabel(xl), d.thang, note];
  });
  const sumWs = XLSXStyle.utils.aoa_to_sheet([sumHeaders, ...sumRows]);
  sumWs['!cols']  = [{ wch: 6 }, { wch: 14 }, { wch: 28 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 22 }];
  sumWs['!rows']  = [{ hpt: 25 }, ...sumRows.map(() => ({ hpt: 20 }))];
  sumWs['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  sumHeaders.forEach((h, ci) => {
    const addr = XLSXStyle.utils.encode_cell({ r: 0, c: ci });
    if (sumWs[addr]) sumWs[addr].s = SUM_HDR;
  });
  sumRows.forEach((row, ri) => {
    const ds = SUM_DATA(ri % 2 === 0);
    row.forEach((val, ci) => {
      const addr = XLSXStyle.utils.encode_cell({ r: ri + 1, c: ci });
      if (!sumWs[addr]) return;
      if (ci === 8) {
        sumWs[addr].s = LINK_STYLE(ri % 2 === 0);
        sumWs[addr].l = { Target: `#'${val}'!A1` };
      } else if (ci === 9 && val) {
        sumWs[addr].s = WARN_CELL_STYLE(ri % 2 === 0);
      } else {
        sumWs[addr].s = { ...ds, alignment: { ...ds.alignment, horizontal: ci === 2 ? 'left' : 'center' } };
      }
    });
  });
  XLSXStyle.utils.book_append_sheet(wb, sumWs, 'Tổng hợp KPI');

  // ── Sheet chi tiết từng tháng (giống exportAllToExcel) ───────────────────
  allMonthData.forEach(({ thang, kpiList, kpiCalc, nhomMap, ty_le_ph, ty_le_cn, diemCaNhan, diemPhongDG, phongRaw, tongDiem, nvInfo, cnStatus }) => {
    const cnRowA = Object.assign(
      ['A', 'KPI Phòng', '', phongRaw > 0 ? phongRaw : '', '', '', '', ty_le_ph, diemPhongDG > 0 ? diemPhongDG : '', ''],
      { __tag: 'A' }
    );
    const cnRowB = Object.assign(
      ['B', 'KPI Cá nhân', '', '', '', '', '', ty_le_cn, diemCaNhan > 0 ? diemCaNhan : '', ''],
      { __tag: 'B' }
    );
    const cnRows = [
      Object.assign([`Báo cáo KPI Cá nhân — ${hoTen} — Tháng ${thang.replace('-', '/')}`], { __tag: 'title' }),
      Object.assign([`Nhóm CV: ${nvInfo?.nhom_cv || ''}   |   Khu vực: ${nvInfo?.khu_vuc || ''}`], { __tag: 'sub' }),
      HEADER,
      cnRowA,
      cnRowB,
    ];

    let lastNhomId = null, stt = 0;
    kpiList.forEach(k => {
      if (k.nhom_id !== lastNhomId) {
        lastNhomId = k.nhom_id;
        const nhom = nhomMap[k.nhom_id];
        cnRows.push(Object.assign(
          ['', nhom ? `${nhom.thu_tu}. ${nhom.ten_nhom}` : (k.nhom_id || ''), '', '', '', '', '', '', '', ''],
          { __tag: 'nhom' }
        ));
      }
      stt++;
      const c = kpiCalc[k.kpi_id];
      cnRows.push([
        stt, k.ten_kpi, k.don_vi || '',
        c && c.value !== null ? c.value : '',
        c?.pctDisp || '',
        c && c.upper !== null ? c.upper : '',
        c && c.lower !== null ? c.lower : '',
        c && c.w !== null ? c.w : '',
        c && c.diem !== null ? c.diem : '',
        c && c.diemMax != null ? c.diemMax : '',
      ]);
    });
    cnRows.push(Object.assign(
      ['C', 'Tổng điểm', '', '', '', '', '', '', tongDiem > 0 ? tongDiem : '', ''],
      { __tag: 'C' }
    ));

    if (cnStatus !== 'full') {
      const msg = cnStatus === 'empty'
        ? `⚠ DỮ LIỆU CHƯA ĐỦ — ${hoTen} — Tháng ${thang.replace('-','/')}: Chưa nhập dữ liệu. Kết quả trong sheet này chưa phải số liệu chính thức.`
        : `⚠ DỮ LIỆU CHƯA ĐỦ — ${hoTen} — Tháng ${thang.replace('-','/')}: Thiếu một số chỉ tiêu (hoặc KPI Phòng chưa đủ). Kết quả chưa phải điểm chính thức.`;
      cnRows.unshift(Object.assign([msg, '', '', '', '', '', '', '', '', ''], { __tag: 'warning' }));
    }

    const wsCN = XLSXStyle.utils.aoa_to_sheet(cnRows);
    wsCN['!cols'] = COL_WIDTHS;
    const detFixed = cnStatus !== 'full' ? 4 : 3;
    wsCN['!rows'] = [
      ...(cnStatus !== 'full' ? [{ hpt: 36 }] : []),
      { hpt: 22 }, { hpt: 20 }, { hpt: 25 },
      ...Array(cnRows.length - detFixed).fill({ hpt: 30 }),
    ];
    wsCN['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: detFixed }];
    if (cnStatus !== 'full') wsCN['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];
    applyStylesDetail(wsCN, cnRows);
    XLSXStyle.utils.book_append_sheet(wb, wsCN, thang.slice(0, 31));
  });

  XLSXStyle.writeFile(wb, `BaoCaoKPI_NV_${hoTen}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── Xuất toàn bộ KPI Phòng (tất cả tháng trong năm đã chọn) ────────────────

function exportPhongAllMonthsToExcel(filteredThangList) {
  const wb = XLSXStyle.utils.book_new();

  const HEADER     = Object.assign(
    ['STT', 'Tên KPI', 'ĐVT', 'KQ thực hiện', '% Thực hiện', 'Chỉ tiêu', 'Ngưỡng dưới', 'Trọng số', 'Điểm Quy đổi', 'Điểm tối đa'],
    { __tag: 'header' }
  );
  const COL_WIDTHS = [{ wch: 6 }, { wch: 44 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
  const HEADER_STYLE = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Segoe UI' },
    fill: { fgColor: { rgb: '1E40AF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top:{style:'thin',color:{rgb:'93C5FD'}}, bottom:{style:'thin',color:{rgb:'93C5FD'}}, left:{style:'thin',color:{rgb:'93C5FD'}}, right:{style:'thin',color:{rgb:'93C5FD'}} },
  };
  const DATA_STYLE = (isEven) => ({
    font: { sz: 10, name: 'Segoe UI' },
    fill: { fgColor: { rgb: isEven ? 'F0F9FF' : 'FFFFFF' } },
    alignment: { vertical: 'center' },
    border: { top:{style:'thin',color:{rgb:'E2E8F0'}}, bottom:{style:'thin',color:{rgb:'E2E8F0'}}, left:{style:'thin',color:{rgb:'E2E8F0'}}, right:{style:'thin',color:{rgb:'E2E8F0'}} },
  });
  const GROUP_STYLE = {
    font: { bold: true, sz: 10, name: 'Segoe UI', color: { rgb: '1E40AF' } },
    fill: { fgColor: { rgb: 'DBEAFE' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: { top:{style:'thin',color:{rgb:'BFDBFE'}}, bottom:{style:'thin',color:{rgb:'BFDBFE'}}, left:{style:'thin',color:{rgb:'BFDBFE'}}, right:{style:'thin',color:{rgb:'BFDBFE'}} },
  };
  const ROW_A_STYLE = { font:{bold:true,sz:10,name:'Segoe UI',color:{rgb:'14532D'}}, fill:{fgColor:{rgb:'DCFCE7'}}, alignment:{vertical:'center'}, border:{top:{style:'thin',color:{rgb:'86EFAC'}}, bottom:{style:'thin',color:{rgb:'86EFAC'}}, left:{style:'thin',color:{rgb:'86EFAC'}}, right:{style:'thin',color:{rgb:'86EFAC'}}} };
  const ROW_B_STYLE = { font:{bold:true,sz:10,name:'Segoe UI',color:{rgb:'1E3A5F'}}, fill:{fgColor:{rgb:'DBEAFE'}}, alignment:{vertical:'center'}, border:{top:{style:'thin',color:{rgb:'93C5FD'}}, bottom:{style:'thin',color:{rgb:'93C5FD'}}, left:{style:'thin',color:{rgb:'93C5FD'}}, right:{style:'thin',color:{rgb:'93C5FD'}}} };
  const ROW_C_STYLE = { font:{bold:true,sz:10,name:'Segoe UI',color:{rgb:'1E40AF'}}, fill:{fgColor:{rgb:'EFF6FF'}}, alignment:{vertical:'center'}, border:{top:{style:'medium',color:{rgb:'93C5FD'}}, bottom:{style:'medium',color:{rgb:'93C5FD'}}, left:{style:'thin',color:{rgb:'BFDBFE'}}, right:{style:'thin',color:{rgb:'BFDBFE'}}} };
  const TITLE_STYLE = { font:{bold:true,sz:13,name:'Segoe UI',color:{rgb:'1E3A5F'}}, alignment:{horizontal:'left',vertical:'center'} };
  const SUB_STYLE   = { font:{sz:9,name:'Segoe UI',color:{rgb:'6B7280'}}, alignment:{vertical:'center'} };
  const WARNING_STYLE_PH = {
    font:{bold:true,sz:10,name:'Segoe UI',color:{rgb:'92400E'}},
    fill:{fgColor:{rgb:'FEF3C7'}},
    alignment:{horizontal:'left',vertical:'center',wrapText:true},
    border:{top:{style:'medium',color:{rgb:'F59E0B'}},bottom:{style:'medium',color:{rgb:'F59E0B'}},left:{style:'thin',color:{rgb:'FCD34D'}},right:{style:'thin',color:{rgb:'FCD34D'}}},
  };

  const SUM_HDR = {
    font:{bold:true,color:{rgb:'FFFFFF'},sz:11,name:'Segoe UI'},
    fill:{fgColor:{rgb:'1E40AF'}},
    alignment:{horizontal:'center',vertical:'center',wrapText:true},
    border:{top:{style:'thin',color:{rgb:'93C5FD'}},bottom:{style:'thin',color:{rgb:'93C5FD'}},left:{style:'thin',color:{rgb:'93C5FD'}},right:{style:'thin',color:{rgb:'93C5FD'}}},
  };
  const SUM_DATA = (isEven) => ({
    font:{sz:10,name:'Segoe UI'},
    fill:{fgColor:{rgb:isEven?'F0F9FF':'FFFFFF'}},
    alignment:{vertical:'center',wrapText:false},
    border:{top:{style:'thin',color:{rgb:'E2E8F0'}},bottom:{style:'thin',color:{rgb:'E2E8F0'}},left:{style:'thin',color:{rgb:'E2E8F0'}},right:{style:'thin',color:{rgb:'E2E8F0'}}},
  });
  const LINK_STYLE = (isEven) => ({
    ...SUM_DATA(isEven),
    font:{sz:10,name:'Segoe UI',color:{rgb:'1D4ED8'},underline:true},
    alignment:{horizontal:'center',vertical:'center'},
  });
  const WARN_CELL_PH = (isEven) => ({
    ...SUM_DATA(isEven),
    font:{sz:10,name:'Segoe UI',bold:true,color:{rgb:'92400E'}},
    fill:{fgColor:{rgb:'FEF3C7'}},
    alignment:{horizontal:'center',vertical:'center'},
  });

  function applyStylesDetail(ws, rows) {
    rows.forEach((row, r) => {
      row.forEach((_, c) => {
        const addr = XLSXStyle.utils.encode_cell({ r, c });
        if (!ws[addr]) return;
        const tag = row.__tag;
        if (tag === 'warning') { ws[addr].s = WARNING_STYLE_PH; return; }
        if (tag === 'title')   { ws[addr].s = TITLE_STYLE; return; }
        if (tag === 'sub')     { ws[addr].s = SUB_STYLE; return; }
        if (tag === 'header')  { ws[addr].s = HEADER_STYLE; return; }
        if (tag === 'A')       { ws[addr].s = ROW_A_STYLE; return; }
        if (tag === 'B')       { ws[addr].s = ROW_B_STYLE; return; }
        if (tag === 'C')       { ws[addr].s = ROW_C_STYLE; return; }
        if (tag === 'nhom')    { ws[addr].s = GROUP_STYLE; return; }
        ws[addr].s = DATA_STYLE(r % 2 === 0);
      });
    });
    rows.forEach((row, r) => {
      if (['warning', 'title', 'sub', 'header'].includes(row.__tag)) return;
      const addr = XLSXStyle.utils.encode_cell({ r, c: 1 });
      if (ws[addr]?.s) ws[addr].s = { ...ws[addr].s, alignment: { ...(ws[addr].s.alignment || {}), wrapText: true } };
    });
  }

  // ── Collect data ──────────────────────────────────────────────────────────
  const allMonthData = [];
  filteredThangList.forEach(thang => {
    const phong   = computePhongData(thang);
    const hasData = Object.keys(phong.inp).length > 0;
    if (hasData) allMonthData.push({ thang, ...phong, phStatus: getInputPhongStatus(thang) });
  });

  if (!allMonthData.length) return alert('Không có dữ liệu KPI Phòng cho năm đã chọn.');

  // ── Sheet tổng hợp ────────────────────────────────────────────────────────
  const sumHeaders = ['STT', 'Tháng/năm', 'KQ KPI CN (%)', 'Điểm KPI CN', 'Điểm KPI Phòng', 'Tổng điểm', 'Sheet chi tiết', 'Ghi chú'];
  const sumRows = allMonthData.map((d, i) => {
    const note = d.phStatus !== 'full' ? (d.phStatus === 'empty' ? '⚠ Chưa nhập dữ liệu' : '⚠ Thiếu dữ liệu') : '';
    return [
      i + 1, d.thang,
      d.kq_cty > 0 ? d.kq_cty : '',
      d.diem_cty > 0 ? d.diem_cty : '',
      d.diemPhongSum > 0 ? d.diemPhongSum : '',
      d.tongDiem > 0 ? d.tongDiem : '',
      d.thang,
      note,
    ];
  });

  const sumWs = XLSXStyle.utils.aoa_to_sheet([sumHeaders, ...sumRows]);
  sumWs['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 22 }];
  sumWs['!rows'] = [{ hpt: 25 }, ...sumRows.map(() => ({ hpt: 20 }))];
  sumHeaders.forEach((h, ci) => {
    const addr = XLSXStyle.utils.encode_cell({ r: 0, c: ci });
    if (sumWs[addr]) sumWs[addr].s = SUM_HDR;
  });
  sumRows.forEach((row, ri) => {
    const ds = SUM_DATA(ri % 2 === 0);
    row.forEach((val, ci) => {
      const addr = XLSXStyle.utils.encode_cell({ r: ri + 1, c: ci });
      if (!sumWs[addr]) return;
      if (ci === 6) {
        sumWs[addr].s = LINK_STYLE(ri % 2 === 0);
        sumWs[addr].l = { Target: `#'${val}'!A1` };
      } else if (ci === 7 && val) {
        sumWs[addr].s = WARN_CELL_PH(ri % 2 === 0);
      } else {
        sumWs[addr].s = { ...ds, alignment: { ...ds.alignment, horizontal: 'center' } };
      }
    });
  });
  sumWs['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  XLSXStyle.utils.book_append_sheet(wb, sumWs, 'Tổng hợp KPI Phòng');

  // ── Sheet chi tiết từng tháng ─────────────────────────────────────────────
  allMonthData.forEach(({ thang, kpiPhong, nhomMap, kpiCalc, kq_cty, diem_cty, diemPhongSum, tongDiem, ty_le_cty, ty_le_phong, phStatus }) => {
    const rowA = Object.assign(
      ['A', 'KPI Công ty', '', kq_cty > 0 ? kq_cty : '', '', '', '', ty_le_cty, diem_cty > 0 ? diem_cty : '', ty_le_cty],
      { __tag: 'A' }
    );
    const rowB = Object.assign(
      ['B', 'KPI Phòng', '', '', '', '', '', ty_le_phong, diemPhongSum > 0 ? diemPhongSum : '', ty_le_phong],
      { __tag: 'B' }
    );
    const phongRows = [
      Object.assign([`Báo cáo KPI Phòng — Tháng ${thang.replace('-', '/')}`], { __tag: 'title' }),
      Object.assign([`KPI Công ty: ${kq_cty > 0 ? kq_cty.toFixed(2) + '%' : '—'}   |   Điểm KPI Phòng: ${diemPhongSum.toFixed(2)}đ   |   Tổng: ${tongDiem.toFixed(2)}đ`], { __tag: 'sub' }),
      HEADER,
      rowA,
      rowB,
    ];

    let lastNhomId = null, stt = 0;
    kpiPhong.forEach(k => {
      if (k.nhom_id !== lastNhomId) {
        lastNhomId = k.nhom_id;
        const nhom = nhomMap[k.nhom_id];
        phongRows.push(Object.assign(
          ['', nhom ? `${nhom.thu_tu}. ${nhom.ten_nhom}` : (k.nhom_id || ''), '', '', '', '', '', '', '', ''],
          { __tag: 'nhom' }
        ));
      }
      stt++;
      const c = kpiCalc[k.kpi_id];
      phongRows.push([
        stt, k.ten_kpi, k.don_vi || '',
        c && c.value !== null ? c.value : '',
        c && c.dispPct ? fmtPctDisp(c.dispPct) : '',
        c && c.upper !== null ? c.upper : '',
        c && c.lower !== null ? c.lower : '',
        c && c.w !== null ? c.w : '',
        c && c.diem !== null ? c.diem : '',
        c ? c.max_pct : '',
      ]);
    });
    phongRows.push(Object.assign(
      ['C', 'Tổng điểm phòng (A + B)', '', '', '', '', '', '', tongDiem, ''],
      { __tag: 'C' }
    ));

    if (phStatus !== 'full') {
      const msg = phStatus === 'empty'
        ? `⚠ DỮ LIỆU CHƯA ĐỦ — KPI Phòng tháng ${thang.replace('-','/')}: Chưa nhập dữ liệu. Kết quả trong sheet này chưa phải số liệu chính thức.`
        : `⚠ DỮ LIỆU CHƯA ĐỦ — KPI Phòng tháng ${thang.replace('-','/')}: Thiếu một số chỉ tiêu. Kết quả trong sheet này chưa phải số liệu chính thức.`;
      phongRows.unshift(Object.assign([msg, '', '', '', '', '', '', '', '', ''], { __tag: 'warning' }));
    }

    const wsPhong = XLSXStyle.utils.aoa_to_sheet(phongRows);
    wsPhong['!cols'] = COL_WIDTHS;
    const phDetFixed = phStatus !== 'full' ? 4 : 3;
    wsPhong['!rows'] = [
      ...(phStatus !== 'full' ? [{ hpt: 36 }] : []),
      { hpt: 22 }, { hpt: 20 }, { hpt: 25 },
      ...Array(phongRows.length - phDetFixed).fill({ hpt: 30 }),
    ];
    wsPhong['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: phDetFixed }];
    if (phStatus !== 'full') wsPhong['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];
    applyStylesDetail(wsPhong, phongRows);
    XLSXStyle.utils.book_append_sheet(wb, wsPhong, thang.slice(0, 31));
  });

  const year = filteredThangList[0]?.slice(0, 4) || '';
  XLSXStyle.writeFile(wb, `BaoCaoKPI_Phong_${year}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ============================================================
// Tab 2: Báo cáo KPI Cá nhân
// ============================================================
function BaoCaoCaNhanTab({ thang, onLoadingChange }) {
  const snap      = thang ? getKpiSnapshot(thang) : null;
  const kpiCaNhan = useMemo(() =>
    (snap ? snap.kpiList : getKpiList()).filter(k => k.kpi_cap === 'ca_nhan').sort((a, b) => a.stt - b.stt),
    [thang, snap]
  );
  const nhomList = snap?.nhomList || getNhomList();
  const nhomMap  = Object.fromEntries(nhomList.map(n => [n.nhom_id, n]));

  const nvList = useMemo(() => {
    const fromSnap = getNvListForThang(thang);
    return fromSnap.length > 0 ? fromSnap : getNvLibrary();
  }, [thang]);

  const [nvId, setNvId]             = useState(() => nvList[0]?.nv_id || '');
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportYear, setExportYear] = useState(() => new Date().getFullYear().toString());
  const [exporting, setExporting]   = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [hideZeroWeight, setHideZeroWeight] = useState(true);

  const allThangList = useMemo(() => [
    ...new Set([...getSnapshotThangList(), ...getThangList()])
  ].sort().reverse(), []);

  const availableYears = useMemo(() => {
    const years = new Set(allThangList.map(t => t.slice(0, 4)));
    return [...years].sort().reverse();
  }, [allThangList]);

  const handleExportAllMonths = async () => {
    const monthsForYear = allThangList.filter(t => t.startsWith(exportYear));
    if (!monthsForYear.length) return alert(`Không có dữ liệu năm ${exportYear} cho nhân viên này.`);
    setExporting(true);
    try {
      for (const t of monthsForYear) {
        const hasOut = getOutputDiemByThang(t).some(r => r.nv_id === nvId);
        const hasCT  = getOutputCTByThangNV(t, nvId).length > 0;
        const hasCN  = getInputCNByThang(t).some(r => r.nv_id === nvId);
        if (!hasOut || !hasCT || !hasCN) {
          try {
            const [outRes, detRes, cnRes] = await Promise.all([
              gasGetOutput(t),
              gasGetDetail(t, nvId),
              gasGetInputCN(t),
            ]);
            if (outRes.data?.length > 0) {
              const all = getOutputDiem();
              const ids = new Set(outRes.data.map(r => r.nv_id));
              saveOutputDiem([...all.filter(r => r.thang !== t), ...outRes.data,
                ...all.filter(r => r.thang === t && !r.xep_loai && !ids.has(r.nv_id))]);
            }
            if (detRes.data?.length > 0) {
              saveOutputCT([...getOutputCT().filter(r => !(r.thang === t && r.nv_id === nvId)), ...detRes.data]);
            }
            if (cnRes.data?.length > 0) {
              cnRes.data.forEach(row => upsertInputCN({ ...row, thang: t }));
            }
          } catch (_) {}
        }
      }
    } finally {
      setExporting(false);
    }
    exportNvAllMonthsToExcel(nvId, nv?.ho_ten || nvId, getXepLoaiConfig(), monthsForYear);
  };

  useEffect(() => {
    if (nvList.length && !nvList.find(n => n.nv_id === nvId)) setNvId(nvList[0]?.nv_id || '');
  }, [thang, nvList]);

  const nv      = nvList.find(n => n.nv_id === nvId);
  const diemRow = getOutputDiemByThang(thang).find(r => r.nv_id === nvId) || null;
  const chiTiet = getOutputCTByThangNV(thang, nvId);

  const nvInputCN = useMemo(() => {
    const rows = getInputCNByThang(thang);
    return rows.find(r => r.nv_id === nvId) || {};
  }, [thang, nvId, refreshKey]);

  const nvInputStatus = useMemo(() => getInputCNStatus(thang, nvId), [thang, nvId, refreshKey]);

  useEffect(() => {
    if (!isConnected() || !thang || !nvId) return;
    onLoadingChange?.(true);
    Promise.all([gasGetOutput(thang), gasGetDetail(thang, nvId)])
      .then(([outRes, detRes]) => {
        if (outRes.data?.length > 0) {
          const all       = getOutputDiem();
          const scoredIds = new Set(outRes.data.map(r => r.nv_id));
          const unscored  = all.filter(r => r.thang === thang && !r.xep_loai && !scoredIds.has(r.nv_id));
          const other     = all.filter(r => r.thang !== thang);
          saveOutputDiem([...other, ...outRes.data, ...unscored]);
        }
        if (detRes.data?.length > 0) {
          const existing = getOutputCT().filter(r => !(r.thang === thang && r.nv_id === nvId));
          saveOutputCT([...existing, ...detRes.data]);
        }
        setRefreshKey(k => k + 1);
      })
      .catch(e => console.warn('Lỗi tải kết quả từ Supabase:', e.message))
      .finally(() => onLoadingChange?.(false));
  }, [thang, nvId]);

  useEffect(() => {
    if (!isConnected() || !thang) return;
    gasGetInputCN(thang)
      .then(res => {
        if (res.data?.length > 0) {
          res.data.forEach(row => upsertInputCN({ ...row, thang }));
          setRefreshKey(k => k + 1);
        }
      })
      .catch(() => {});
  }, [thang]);

  const weightConfig = thang ? getTrongSoConfig(thang) : null;
  const ty_le_phong  = weightConfig?.ty_le?.ca_nhan?.phong   ?? 30;
  const ty_le_cn     = weightConfig?.ty_le?.ca_nhan?.ca_nhan ?? 70;
  const isAutoMode   = (weightConfig?.mode ?? 'manual') === 'auto';

  // Tính điểm local từ input_cn (không cần calcMonth)
  const localCalc = useMemo(() => {
    const result = {};
    kpiCaNhan.forEach(kpi => {
      const parseNum = key => {
        const raw = nvInputCN[kpi.kpi_id + key];
        if (raw === '' || raw === null || raw === undefined) return null;
        const f = parseFloat(raw); return isNaN(f) ? null : f;
      };
      // Backward compat: giá trị cũ dạng thập phân (1.0), giá trị mới dạng ×100 (100)
      const rawMp = parseNum('_max_pct');
      const maxPct = rawMp !== null && rawMp > 0 ? (rawMp > 2 ? rawMp / 100 : rawMp) : 1;
      const rawGt = parseFloat(nvInputCN[kpi.kpi_id + '_giam_tru']);
      const giamTru = isNaN(rawGt) ? 1 : (rawGt > 2 ? rawGt / 100 : rawGt);
      const v = parseNum('_value'), lo = parseNum('_lower'), hi = parseNum('_upper'), w = parseNum('_trong_so');
      const hasAny = v !== null || lo !== null || hi !== null || w !== null;
      if (!hasAny) { result[kpi.kpi_id] = null; return; }
      const effectiveHi = hi !== null ? hi * giamTru : null;
      let diem = null, dispPct = null;
      if (v !== null && lo !== null && effectiveHi !== null && w !== null && effectiveHi !== lo) {
        dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower, giamTru);
        diem = kpiScore(v, lo, hi, maxPct, w, giamTru);
      } else if (v !== null && hi !== null) {
        dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower, giamTru);
      }
      result[kpi.kpi_id] = {
        value: v, lower: lo, upper: effectiveHi, w,
        pct:     dispPct && 'pct' in dispPct ? dispPct.pct : null,
        dispPct,
        diem,
        diemMax: Math.round(maxPct * 100),
      };
    });
    return result;
  }, [kpiCaNhan, nvInputCN]);

  const localDiemCaNhan = useMemo(() => kpiCaNhan.reduce((s, k) => s + (localCalc[k.kpi_id]?.diem ?? 0), 0), [kpiCaNhan, localCalc]);
  const { tongDiem: localTongDiemPhong, inp: phongInp } = useMemo(() => computePhongData(thang), [thang]);
  const localDiemPhongDG = localTongDiemPhong * (ty_le_phong / 100);
  const localTongDiem    = localDiemPhongDG + localDiemCaNhan;
  const hasLocalData     = Object.values(localCalc).some(v => v !== null);
  // Có dữ liệu phòng trong localStorage hay không
  const hasLocalPhongData = !!(phongInp?.thang);

  // "KQ thực hiện" Row A: luôn lấy từ local (cùng nguồn với Báo cáo KPI Phòng) để tránh lệch do maxPct default
  const showDiemPhongRaw = hasLocalPhongData
    ? localTongDiemPhong
    : (diemRow ? diemRow.diem_phong_dong_gop / (ty_le_phong / 100) : null);
  // Điểm quy đổi Row A = KQ TH × (Trọng số/100) — công thức tường minh, nhất quán với trọng số hiển thị
  const showDiemPhongDG  = showDiemPhongRaw !== null
    ? Math.round(showDiemPhongRaw * (ty_le_phong / 100) * 1000) / 1000
    : null;
  // Row B = tổng diem_quy_doi của tất cả KPI trong bảng (nhất quán với những gì hiển thị)
  const showDiemCaNhan = chiTiet.length > 0
    ? Math.round(chiTiet.reduce((s, c) => s + (c.diem_quy_doi ?? 0), 0) * 1000) / 1000
    : hasLocalData ? localDiemCaNhan : (diemRow ? diemRow.diem_ca_nhan : null);
  // Tổng điểm Row C = Điểm quy đổi Row A + Điểm quy đổi Row B
  const showTongDiem     = (showDiemPhongDG !== null || showDiemCaNhan !== null)
    ? Math.round(((showDiemPhongDG ?? 0) + (showDiemCaNhan ?? 0)) * 1000) / 1000
    : null;
  const showXepLoai      = diemRow ? diemRow.xep_loai            : (hasLocalData ? xepLoaiWithConfig(localTongDiem, getXepLoaiConfig()) : null);
  const isLocalOnly      = !diemRow && hasLocalData;

  const tableRows = [];
  const NHOM_ORDER = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
  const nhomGroups = {};
  kpiCaNhan.forEach(k => {
    if (!nhomGroups[k.nhom_id]) nhomGroups[k.nhom_id] = [];
    nhomGroups[k.nhom_id].push(k);
  });
  Object.keys(nhomGroups)
    .sort((a, b) => {
      const ia = NHOM_ORDER.indexOf(nhomMap[a]?.thu_tu ?? '');
      const ib = NHOM_ORDER.indexOf(nhomMap[b]?.thu_tu ?? '');
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    })
    .forEach(nhomId => {
      const nhom = nhomMap[nhomId];
      tableRows.push({ type: 'nhom', label: nhom ? `${nhom.thu_tu}. ${nhom.ten_nhom}` : nhomId });
      nhomGroups[nhomId]
        .sort((a, b) => a.stt - b.stt)
        .forEach(k => {
          const ct = chiTiet.find(c => c.kpi_id === k.kpi_id) || null;
          const lc = localCalc[k.kpi_id];
          tableRows.push({ type: 'kpi', stt: k.stt, kpi: k, ct, lc });
        });
    });

  const filteredTableRows = (() => {
    if (!hideZeroWeight) return tableRows;
    const result = [];
    let i = 0;
    while (i < tableRows.length) {
      const row = tableRows[i];
      if (row.type === 'nhom') {
        let j = i + 1;
        const visibleKpis = [];
        while (j < tableRows.length && tableRows[j].type === 'kpi') {
          const r = tableRows[j];
          const w = r.ct ? r.ct.weight_tuong_doi : r.lc?.w;
          if (w == null || w !== 0) visibleKpis.push(r);
          j++;
        }
        if (visibleKpis.length > 0) result.push(row, ...visibleKpis);
        i = j;
      } else {
        result.push(row);
        i++;
      }
    }
    return result;
  })();

  if (!thang) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap no-print">
        <select value={nvId} onChange={e => setNvId(e.target.value)} className="input w-56">
          {nvList.map(n => <option key={n.nv_id} value={n.nv_id}>{n.ho_ten}</option>)}
        </select>
        <span className={{
          empty: 'badge bg-gray-100 text-gray-400',
          partial: 'badge bg-yellow-100 text-yellow-700',
          full: 'badge bg-green-100 text-green-700',
        }[nvInputStatus]}>
          {{ empty: 'Chưa nhập liệu', partial: 'Thiếu dữ liệu', full: '✓ Đủ dữ liệu' }[nvInputStatus]}
        </span>
        {showXepLoai && (
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${XEP_LOAI_CLS[showXepLoai] || ''}`}>
            {xepLoaiLabel(showXepLoai)} ({showXepLoai}) — {fmt(showTongDiem)} điểm
            {isLocalOnly && <span className="ml-1 font-normal text-gray-500">(tạm tính từ dữ liệu local)</span>}
          </span>
        )}
        {!showXepLoai && <span className="text-xs text-gray-400 italic">Chưa có đủ dữ liệu để tính điểm</span>}
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none ml-2">
          <input
            type="checkbox"
            checked={hideZeroWeight}
            onChange={e => setHideZeroWeight(e.target.checked)}
            className="rounded"
          />
          Ẩn KPI trọng số = 0
        </label>
        <div className="flex items-center gap-1 ml-auto flex-wrap justify-end">
          <select value={exportYear} onChange={e => setExportYear(e.target.value)}
            className="input text-xs py-2" style={{ width: '7rem' }}>
            {availableYears.map(y => <option key={y} value={y}>Năm {y}</option>)}
          </select>
          <button className="btn-secondary text-xs"
            disabled={!nvId || nvList.length === 0 || exporting}
            onClick={handleExportAllMonths}
            title="Xuất toàn bộ KPI của nhân viên này sang Excel">
            {exporting ? '⏳ Đang tải...' : '📥 Xuất KPI của NV đã chọn'}
          </button>
          <button className="btn-secondary text-xs"
            disabled={exportingAll}
            onClick={() => {
              const months = allThangList.filter(t => t.startsWith(exportYear));
              if (!months.length) return alert(`Không có dữ liệu năm ${exportYear}.`);
              setExportingAll(true);
              try { exportAllNvAllMonthsToExcel(exportYear, months); }
              finally { setExportingAll(false); }
            }}
            title="Xuất bảng tổng hợp điểm tất cả NV theo tháng sang Excel">
            {exportingAll ? '⏳ Đang xuất...' : '📊 Xuất tổng hợp tất cả NV'}
          </button>
        </div>
      </div>

      {/* Notice: KPI có giảm trừ chỉ tiêu */}
      {(() => {
        // Backward compat: giam_tru từ Supabase chiTiet là decimal; từ localStorage có thể là ×100
        const toGtDecimal = (raw) => { const n = parseFloat(raw); return isNaN(n) ? 1 : (n > 2 ? n / 100 : n); };
        const giamTruKpis = kpiCaNhan.filter(kpi => {
          const raw = chiTiet.find(c => c.kpi_id === kpi.kpi_id)?.giam_tru ?? nvInputCN[kpi.kpi_id + '_giam_tru'];
          return !isNaN(parseFloat(raw)) && toGtDecimal(raw) < 1;
        });
        if (!giamTruKpis.length) return null;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 no-print">
            <p className="font-semibold mb-1">⚠️ Các KPI được giảm chỉ tiêu trong tháng này:</p>
            <ul className="space-y-0.5 ml-2">
              {giamTruKpis.map(kpi => {
                const raw = chiTiet.find(c => c.kpi_id === kpi.kpi_id)?.giam_tru ?? nvInputCN[kpi.kpi_id + '_giam_tru'];
                const gt = toGtDecimal(raw);
                const uRaw = parseFloat(nvInputCN[kpi.kpi_id + '_upper']);
                return (
                  <li key={kpi.kpi_id}>
                    <strong>{kpi.stt}. {kpi.ten_kpi}</strong>
                    {': Chỉ tiêu gốc '}
                    {!isNaN(uRaw) ? uRaw : '?'}
                    {' → Chỉ tiêu tính điểm '}
                    {!isNaN(uRaw) ? Math.round(uRaw * gt * 1000) / 1000 : '?'}
                    {` (giảm trừ chỉ tiêu còn ${(gt * 100).toFixed(0)}%)`}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      <div className="card p-0 overflow-hidden print:shadow-none print:border-0">
        <div className="text-center py-4 px-6 border-b">
          <p className="text-base font-bold uppercase tracking-wide">Bảng đánh giá kết quả thực hiện KPI cá nhân</p>
          <p className="text-gray-500 mt-1 text-sm">Tháng {thang.replace('-', '/')}</p>
          <p className="mt-1.5 text-sm">
            <span className="text-gray-500">Nhân viên: </span>
            <strong>{nv?.ho_ten || '—'}</strong>
            {nv && <span className="text-gray-400 ml-3 text-xs">({nv.nhom_cv} · {nv.khu_vuc})</span>}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            {THEAD}
            <tbody>
              {/* Row A: KPI Phòng */}
              <tr className="bg-indigo-50 text-indigo-900 font-semibold border border-gray-200">
                <td className="px-2 py-2 text-center border border-indigo-200">A</td>
                <td className="px-3 py-2 border border-indigo-200">KPI Phòng</td>
                <td className="border border-indigo-200" />
                <td className="px-2 py-2 text-right border border-indigo-200">{showDiemPhongRaw !== null ? fmt(showDiemPhongRaw) : '—'}</td>
                <td className="border border-indigo-200" />
                <td className="border border-indigo-200" />
                <td className="border border-indigo-200" />
                <td className="px-2 py-2 text-right border border-indigo-200">{ty_le_phong}</td>
                <td className="px-2 py-2 text-right font-bold text-indigo-700 border border-indigo-200">{showDiemPhongDG !== null ? fmt(showDiemPhongDG) : '—'}</td>
                <td className="border border-indigo-200" />
              </tr>

              {/* Row B: KPI Cá nhân */}
              <tr className="bg-blue-50 text-blue-900 font-semibold border border-gray-200">
                <td className="px-2 py-2 text-center border border-blue-200">B</td>
                <td className="px-3 py-2 border border-blue-200">KPI Cá nhân</td>
                <td className="border border-blue-200" />
                <td className="border border-blue-200" />
                <td className="border border-blue-200" />
                <td className="border border-blue-200" />
                <td className="border border-blue-200" />
                <td className="px-2 py-2 text-right border border-blue-200">{ty_le_cn}</td>
                <td className="px-2 py-2 text-right font-bold text-blue-700 border border-blue-200">{showDiemCaNhan !== null ? fmt(showDiemCaNhan) : '—'}</td>
                <td className="border border-blue-200" />
              </tr>

              {filteredTableRows.map((row, idx) => {
                if (row.type === 'nhom') {
                  return (
                    <tr key={`nhom-${idx}`} className="bg-blue-50 border-t border-blue-100">
                      <td colSpan={10} className="px-3 py-1.5 font-semibold text-blue-700 text-xs border border-blue-100">
                        {row.label}
                      </td>
                    </tr>
                  );
                }
                const { kpi, ct, lc, stt } = row;
                // Ưu tiên chiTiet từ Supabase; fallback tính local
                const val     = ct ? ct.value            : lc?.value;
                const pctDisp = ct ? fmtPct(ct.pct_th)  : (lc?.dispPct ? fmtPctDisp(lc.dispPct) : '');
                const pctErr  = !ct && lc?.dispPct?.error;
                const rawPct  = ct ? ct.pct_th : lc?.dispPct?.pct;
                const isPctBad = rawPct != null && !isNaN(rawPct) && rawPct < 1;
                const upper   = ct ? ct.upper            : lc?.upper;
                const lower   = ct ? ct.lower            : lc?.lower;
                const w       = ct ? ct.weight_tuong_doi : lc?.w;
                const diem    = ct ? ct.diem_quy_doi     : lc?.diem;
                // Điểm tối đa hiển thị dạng % (100, 120) — không phải điểm cụ thể
                const ctMaxPct = ct?.max_pct != null ? Math.round(ct.max_pct * 100) : null;
                const rawMpLocal = parseFloat(nvInputCN[kpi.kpi_id + '_max_pct']);
                const localMaxPct = isNaN(rawMpLocal) ? null : (rawMpLocal > 2 ? rawMpLocal : rawMpLocal * 100);
                const diemMax = lc?.diemMax ?? ctMaxPct ?? localMaxPct;
                return (
                  <tr key={kpi.kpi_id} className="hover:bg-gray-50 border border-gray-100">
                    <td className="px-2 py-2 text-center text-gray-400 border border-gray-200">{stt}</td>
                    <td className="px-3 py-2 text-gray-800 border border-gray-200">
                      {kpi.ten_kpi}
                      <span className="block text-gray-400 font-mono mt-0.5">{kpi.kpi_id}</span>
                    </td>
                    <td className="px-2 py-2 text-center text-gray-500 border border-gray-200">{kpi.don_vi}</td>
                    <td className="px-2 py-2 text-right font-medium border border-gray-200">{val != null ? fmt(val, 3) : ''}</td>
                    <td className={`px-2 py-2 text-right border border-gray-200${pctErr ? ' text-red-500 text-xs' : isPctBad ? ' text-red-600 font-semibold' : ''}`}>{pctDisp}</td>
                    <td className="px-2 py-2 text-right border border-gray-200">{upper != null ? fmt(upper, 3) : ''}</td>
                    <td className="px-2 py-2 text-right border border-gray-200">{lower != null ? fmt(lower, 3) : ''}</td>
                    <td className="px-2 py-2 text-right border border-gray-200">{w != null ? fmt(w, 3) : ''}</td>
                    <td className="px-2 py-2 text-right font-semibold text-blue-700 border border-gray-200">{diem != null ? fmt(diem, 3) : ''}</td>
                    <td className="px-2 py-2 text-right border border-gray-200">{diemMax != null ? diemMax + '%' : ''}</td>
                  </tr>
                );
              })}

              {/* Row C */}
              <tr className="bg-gray-100 text-gray-800 font-bold border-t-2 border-gray-300">
                <td className="px-2 py-3 text-center border border-gray-200">C</td>
                <td colSpan={7} className="px-3 py-3 border border-gray-200">Tổng điểm</td>
                <td className="px-2 py-3 text-right text-blue-700 border border-gray-200">
                  {showTongDiem !== null ? fmt(showTongDiem) : '—'}
                  {isLocalOnly && showTongDiem !== null && <span className="text-gray-400 font-normal ml-1 text-xs">(tạm tính)</span>}
                </td>
                <td className="border border-gray-200" />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab Thống kê KPI Cá nhân
// ============================================================

const STAT_TABLES = [
  { id: 'pct_th',    label: '% Thực hiện' },
  { id: 'upper',     label: 'Chỉ tiêu' },
  { id: 'lower',     label: 'Ngưỡng dưới' },
  { id: 'trong_so',  label: 'Trọng số' },
  { id: 'diem_max',  label: 'Điểm tối đa' },
  { id: 'giam_tru',  label: 'Giảm trừ' },
  { id: 'cach_tinh', label: 'Cách tính KPI' },
];

function getStatCell(nvInput, kpi, type) {
  if (!nvInput) return null;
  const rawGtS = parseFloat(nvInput[kpi.kpi_id + '_giam_tru']);
  const giamTru = isNaN(rawGtS) ? 1 : (rawGtS > 2 ? rawGtS / 100 : rawGtS);
  if (type === 'pct_th') {
    const v = parseFloat(nvInput[kpi.kpi_id + '_value']);
    const u = parseFloat(nvInput[kpi.kpi_id + '_upper']);
    return kpiDisplayPct(v, u, kpi.upper_gt_lower, giamTru) || null;
  }
  if (type === 'upper') {
    const u = parseFloat(nvInput[kpi.kpi_id + '_upper']);
    return isNaN(u) ? null : Math.round(u * giamTru * 1000) / 1000;
  }
  if (type === 'lower') {
    const lo = parseFloat(nvInput[kpi.kpi_id + '_lower']);
    return isNaN(lo) ? null : lo;
  }
  if (type === 'trong_so') return nvInput[kpi.kpi_id + '_trong_so'] ?? null;
  if (type === 'diem_max') {
    // Hiển thị dạng % (100, 120) thay vì điểm cụ thể
    const rawMpS = parseFloat(nvInput[kpi.kpi_id + '_max_pct']);
    if (isNaN(rawMpS)) return null;
    return rawMpS > 2 ? rawMpS : Math.round(rawMpS * 100);
  }
  if (type === 'giam_tru') {
    // Hiển thị dạng % (100, 99) thay vì thập phân
    if (isNaN(rawGtS)) return null;
    return rawGtS > 2 ? rawGtS : Math.round(rawGtS * 10000) / 100;
  }
  return null;
}

function fmtStatCell(val, type) {
  if (val === null || val === undefined || val === '') return '—';
  if (type === 'pct_th') {
    if (typeof val === 'object') {
      if (val.error) return val.error;
      return (val.pct * 100).toFixed(1) + '%';
    }
    return String(val);
  }
  return String(val);
}

function exportThongKeToExcel(thang, nvList, kpiCaNhan, inputCNAll) {
  const wb = XLSXStyle.utils.book_new();
  const HDR_STYLE = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Segoe UI' },
    fill: { fgColor: { rgb: '1E40AF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top: {style:'thin',color:{rgb:'93C5FD'}}, bottom: {style:'thin',color:{rgb:'93C5FD'}}, left: {style:'thin',color:{rgb:'93C5FD'}}, right: {style:'thin',color:{rgb:'93C5FD'}} },
  };
  const DATA_STYLE = (isEven) => ({
    font: { sz: 10, name: 'Segoe UI' },
    fill: { fgColor: { rgb: isEven ? 'F0F9FF' : 'FFFFFF' } },
    alignment: { vertical: 'center' },
    border: { top: {style:'thin',color:{rgb:'E2E8F0'}}, bottom: {style:'thin',color:{rgb:'E2E8F0'}}, left: {style:'thin',color:{rgb:'E2E8F0'}}, right: {style:'thin',color:{rgb:'E2E8F0'}} },
  });
  const WARN_STYLE = {
    font: { sz: 10, name: 'Segoe UI', color: { rgb: 'B91C1C' }, bold: true },
    fill: { fgColor: { rgb: 'FEE2E2' } },
    alignment: { vertical: 'center', horizontal: 'center' },
    border: { top: {style:'thin',color:{rgb:'FECACA'}}, bottom: {style:'thin',color:{rgb:'FECACA'}}, left: {style:'thin',color:{rgb:'FECACA'}}, right: {style:'thin',color:{rgb:'FECACA'}} },
  };
  const TITLE_STYLE = { font: { bold: true, sz: 13, name: 'Segoe UI', color: { rgb: '1E3A5F' } }, alignment: { horizontal: 'left', vertical: 'center' } };

  STAT_TABLES.forEach(({ id, label }) => {
    let ws;
    if (id === 'cach_tinh') {
      const header = ['STT', 'Tên KPI', 'Đơn vị tính', 'Cách tính'];
      const dataRows = kpiCaNhan.map(kpi => [kpi.stt, kpi.ten_kpi, kpi.don_vi || '', kpi.cach_tinh || '']);
      ws = XLSXStyle.utils.aoa_to_sheet([
        [`${label} — Tháng ${thang.replace('-', '/')}`],
        header,
        ...dataRows,
      ]);
      ws['!cols'] = [{ wch: 6 }, { wch: 44 }, { wch: 14 }, { wch: 80 }];
      ws['!rows'] = [{ hpt: 20 }, { hpt: 22 }, ...Array(dataRows.length).fill({ hpt: 60 })];
      for (let c = 0; c < 4; c++) {
        const addr = XLSXStyle.utils.encode_cell({ r: 0, c: 0 });
        if (c === 0 && ws[addr]) ws[addr].s = TITLE_STYLE;
        const ha = XLSXStyle.utils.encode_cell({ r: 1, c });
        if (ws[ha]) ws[ha].s = HDR_STYLE;
      }
      for (let r = 2; r < 2 + dataRows.length; r++) {
        for (let c = 0; c < 4; c++) {
          const addr = XLSXStyle.utils.encode_cell({ r, c });
          if (!ws[addr]) continue;
          const s = { ...DATA_STYLE(r % 2 === 0) };
          if (c === 1 || c === 3) s.alignment = { ...s.alignment, wrapText: true, vertical: 'top' };
          ws[addr].s = s;
        }
      }
    } else {
      const header = ['STT', 'Họ và tên', 'Nhóm CV', 'Khu vực',
        ...kpiCaNhan.map(k => `[${k.stt}] ${k.ten_kpi}`)];
      const dataRows = nvList.map((nv, i) => {
        const inp = inputCNAll.find(r => r.nv_id === nv.nv_id) || null;
        return [
          i + 1, nv.ho_ten, nv.nhom_cv || '', nv.khu_vuc || '',
          ...kpiCaNhan.map(kpi => {
            const val = getStatCell(inp, kpi, id);
            if (val === null || val === undefined || val === '') return '';
            if (id === 'pct_th') {
              if (typeof val === 'object') return val.error ? val.error : val.pct * 100;
            }
            return parseFloat(val) || val;
          }),
        ];
      });
      ws = XLSXStyle.utils.aoa_to_sheet([
        [`${label} — Tháng ${thang.replace('-', '/')}`],
        header,
        ...dataRows,
      ]);
      ws['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 18 }, { wch: 16 },
        ...kpiCaNhan.map(() => ({ wch: 15 }))];
      ws['!rows'] = [{ hpt: 22 }, { hpt: 100 }, ...Array(dataRows.length).fill({ hpt: 20 })];
      const titleAddr = XLSXStyle.utils.encode_cell({ r: 0, c: 0 });
      if (ws[titleAddr]) ws[titleAddr].s = TITLE_STYLE;
      for (let c = 0; c < 4 + kpiCaNhan.length; c++) {
        const addr = XLSXStyle.utils.encode_cell({ r: 1, c });
        if (ws[addr]) ws[addr].s = HDR_STYLE;
      }
      for (let r = 2; r < 2 + nvList.length; r++) {
        for (let c = 0; c < 4 + kpiCaNhan.length; c++) {
          const addr = XLSXStyle.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell) continue;
          if (id === 'pct_th' && c >= 4 && typeof cell.v === 'number' && cell.v < 100) {
            cell.s = WARN_STYLE;
          } else {
            cell.s = DATA_STYLE(r % 2 === 0);
          }
        }
      }
    }
    XLSXStyle.utils.book_append_sheet(wb, ws, label.slice(0, 31));
  });
  XLSXStyle.writeFile(wb, `BaoCaoKPI_ThongKeThang_${thang}.xlsx`);
}

function ThongKeCaNhanTab({ thang, onLoadingChange }) {
  const [tableType, setTableType] = useState('pct_th');
  const [dataKey, setDataKey] = useState(0);

  useEffect(() => {
    if (!isConnected() || !thang) return;
    onLoadingChange?.(true);
    Promise.all([gasGetInputCN(thang), gasGetDetail(thang, '')])
      .then(([resInputCN, resChiTiet]) => {
        if (resInputCN.data?.length > 0)
          resInputCN.data.forEach(row => upsertInputCN({ ...row, thang }));
        if (resChiTiet.data?.length > 0) {
          const existing = getOutputCT().filter(r => r.thang !== thang);
          saveOutputCT([...existing, ...resChiTiet.data]);
        }
        setDataKey(k => k + 1);
      })
      .catch(() => {})
      .finally(() => onLoadingChange?.(false));
  }, [thang]);

  const snap = thang ? getKpiSnapshot(thang) : null;
  const kpiCaNhan = useMemo(() =>
    (snap ? snap.kpiList : getKpiList()).filter(k => k.kpi_cap === 'ca_nhan').sort((a, b) => a.stt - b.stt),
    [thang, snap]
  );
  const nvList = useMemo(() => {
    const s = getNvListForThang(thang);
    return s.length > 0 ? s : getNvLibrary();
  }, [thang]);
  const inputCNAll = useMemo(() => getInputCNByThang(thang), [thang, dataKey]);
  const chiTietFallback = useMemo(() => {
    const rows = getOutputCT().filter(r => r.thang === thang);
    const map = {};
    rows.forEach(row => {
      if (!map[row.nv_id]) map[row.nv_id] = {};
      map[row.nv_id][row.kpi_id + '_value']    = row.value;
      map[row.nv_id][row.kpi_id + '_upper']    = row.upper;
      map[row.nv_id][row.kpi_id + '_lower']    = row.lower;
      map[row.nv_id][row.kpi_id + '_trong_so'] = row.weight_tuong_doi;
      map[row.nv_id][row.kpi_id + '_max_pct']  = row.max_pct;
      map[row.nv_id][row.kpi_id + '_giam_tru'] = row.giam_tru;
    });
    return map;
  }, [thang, dataKey]);

  if (!thang) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap no-print">
        <select
          className="input w-44 text-sm"
          value={tableType}
          onChange={e => setTableType(e.target.value)}
        >
          {STAT_TABLES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button
          className="btn-secondary text-sm"
          disabled={!kpiCaNhan.length || !nvList.length}
          onClick={() => exportThongKeToExcel(thang, nvList, kpiCaNhan, inputCNAll)}
        >
          📥 Xuất Excel (tất cả các bảng)
        </button>
      </div>

      <div className="card p-0 overflow-hidden print:shadow-none print:border-0">
        <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center justify-between">
          <span className="font-semibold text-gray-700 text-sm">
            {STAT_TABLES.find(t => t.id === tableType)?.label} — Tháng {thang.replace('-', '/')}
          </span>
          <span className="text-xs text-gray-400">{nvList.length} nhân viên · {kpiCaNhan.length} KPI</span>
        </div>

        {!kpiCaNhan.length ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm italic">
            Tháng này chưa có snapshot KPI cá nhân.
          </div>
        ) : tableType === 'cach_tinh' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-blue-50 border-b border-blue-100">
                <tr className="text-gray-600 text-xs uppercase tracking-wide">
                  <th className="px-2 py-2 text-center w-8 border border-blue-100">STT</th>
                  <th className="px-2 py-2 text-left border border-blue-100" style={{ minWidth: 400 }}>Tên KPI</th>
                  <th className="px-2 py-2 text-left border border-blue-100" style={{ minWidth: 100 }}>Đơn vị tính</th>
                  <th className="px-2 py-2 text-left border border-blue-100">Giải thích cách tính</th>
                </tr>
              </thead>
              <tbody>
                {kpiCaNhan.map((kpi, i) => (
                  <tr key={kpi.kpi_id} className={`border-t border-gray-100 ${i % 2 === 0 ? '' : 'bg-gray-50'}`}>
                    <td className="px-2 py-2 text-center text-gray-500 border border-gray-200">{kpi.stt}</td>
                    <td className="px-2 py-2 font-medium text-gray-900 border border-gray-200">{kpi.ten_kpi}</td>
                    <td className="px-2 py-2 text-gray-600 border border-gray-200">{kpi.don_vi || '—'}</td>
                    <td className="px-2 py-2 text-gray-700 border border-gray-200 whitespace-pre-wrap leading-relaxed">
                      {kpi.cach_tinh || <span className="text-gray-300 italic">Chưa có mô tả</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-blue-50 border-b border-blue-100">
                <tr className="text-gray-600 text-xs uppercase tracking-wide">
                  <th className="px-2 py-2 text-center w-8 border border-blue-100">STT</th>
                  <th className="px-2 py-2 text-left border border-blue-100" style={{ minWidth: 130 }}>Họ và tên</th>
                  <th className="px-2 py-2 text-left border border-blue-100" style={{ minWidth: 100 }}>Nhóm CV</th>
                  <th className="px-2 py-2 text-left border border-blue-100" style={{ minWidth: 90 }}>Khu vực</th>
                  {kpiCaNhan.map(kpi => (
                    <th key={kpi.kpi_id} className="px-2 py-2 text-center border border-blue-100"
                      style={{ minWidth: 70, maxWidth: 110 }}>
                      <div style={{ wordBreak: 'break-word', whiteSpace: 'normal', lineHeight: '1.3' }}>
                        <span className="text-blue-500 font-mono block text-xs">{kpi.stt}</span>
                        {kpi.ten_kpi}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nvList.map((nv, i) => {
                  const inp = inputCNAll.find(r => r.nv_id === nv.nv_id) || chiTietFallback[nv.nv_id] || null;
                  return (
                    <tr key={nv.nv_id} className={`border-t border-gray-100 ${i % 2 === 0 ? '' : 'bg-gray-50'} hover:bg-blue-50`}>
                      <td className="px-2 py-1.5 text-center text-gray-400 border border-gray-200">{i + 1}</td>
                      <td className="px-2 py-1.5 font-medium text-gray-900 border border-gray-200">{nv.ho_ten}</td>
                      <td className="px-2 py-1.5 text-gray-600 border border-gray-200">{nv.nhom_cv}</td>
                      <td className="px-2 py-1.5 text-gray-600 border border-gray-200">{nv.khu_vuc}</td>
                      {kpiCaNhan.map(kpi => {
                        const val    = getStatCell(inp, kpi, tableType);
                        const isErr  = tableType === 'pct_th' && val?.error;
                        const isLow  = tableType === 'pct_th' && !isErr && val !== null && typeof val === 'object' && 'pct' in val && val.pct < 1;
                        return (
                          <td key={kpi.kpi_id}
                            className={`px-2 py-1.5 text-center border border-gray-200 ${
                              isErr ? 'text-red-500 text-xs' : isLow ? 'bg-red-50 text-red-700 font-medium' : ''
                            }`}>
                            {fmtStatCell(val, tableType)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {nvList.length === 0 && (
                  <tr>
                    <td colSpan={4 + kpiCaNhan.length} className="px-4 py-8 text-center text-gray-400 italic">
                      Chưa có danh sách nhân viên cho tháng này.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Main component
// ============================================================
const TABS = [
  { id: 'phong',   label: '🏢 KPI Phòng' },
  { id: 'ca_nhan', label: '👤 KPI Cá nhân' },
];

export default function KpiReport() {
  const { tab: urlTab = 'phong' } = useParams();
  // urlTab: 'phong' | 'canhan'
  const [caNhanSubTab, setCaNhanSubTab] = useState('thong_ke');
  const [caNhanLoading, setCaNhanLoading] = useState(false);
  const [exportingDetail, setExportingDetail] = useState(false);

  const thangList = useMemo(() => {
    const s = new Set([
      ...getSnapshotThangList(),
      ...getInputPhong().map(r => r.thang),
      ...getThangList(),
    ]);
    return Array.from(s).sort().reverse();
  }, []);
  const [thang, setThang] = useState(() => defaultThang(
    Array.from(new Set([...getSnapshotThangList(), ...getInputPhong().map(r => r.thang), ...getThangList()])).sort().reverse()
  ));

  const handleExportDetail = async () => {
    if (!thang) return;
    setExportingDetail(true);
    try {
      if (isConnected()) {
        try {
          const cnRes = await gasGetInputCN(thang);
          if (cnRes.data?.length > 0) {
            cnRes.data.forEach(row => upsertInputCN({ ...row, thang }));
          }
        } catch (_) {}
      }
      exportAllToExcel(thang);
    } finally {
      setExportingDetail(false);
    }
  };

  if (!thangList.length) {
    return (
      <div className="p-3 md:p-6 text-center py-16 text-gray-400">
        <p className="text-4xl mb-3">📊</p>
        <p className="font-medium">Chưa có dữ liệu tháng nào.</p>
        <p className="text-sm mt-1">Hãy tạo tháng trong Quản lý KPI và nhập liệu KPI Phòng.</p>
      </div>
    );
  }

  const TAB_TITLES_BC = {
    phong:  '📊 Báo cáo KPI Phòng',
    canhan: '📋 Báo cáo KPI Cá nhân',
  };
  const TAB_DESC_BC = {
    phong:  'Kết quả thực hiện KPI cấp Phòng theo từng tháng',
    canhan: 'Kết quả chấm điểm KPI từng nhân viên và bảng thống kê tổng hợp theo tháng',
  };

  return (
    <div className="p-3 md:p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3 no-print">
        <div>
          <h2 className="text-lg md:text-xl font-bold text-gray-900">{TAB_TITLES_BC[urlTab] ?? 'Báo cáo kết quả KPI'}</h2>
          <p className="text-gray-500 text-xs mt-0.5">{TAB_DESC_BC[urlTab] ?? 'Kết quả đánh giá KPI Phòng và cá nhân theo từng tháng'}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <YearMonthPicker thangList={thangList} value={thang} onChange={setThang} />
          <button className="btn-secondary text-sm" onClick={handleExportDetail} disabled={!thang || exportingDetail}>
            {exportingDetail ? '⏳ Đang tải...' : '📥 Chi tiết KPI Phòng + NV'}
          </button>
          <button className="btn-primary text-sm" onClick={() => window.print()}>🖨️ In</button>
        </div>
      </div>

      {urlTab === 'phong' && (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 no-print">
            📊 <strong>Báo cáo KPI Phòng</strong> — Kết quả thực hiện các chỉ tiêu KPI cấp Phòng, bao gồm điểm từng KPI và tổng điểm phòng theo tháng.
          </div>
          <BaoCaoPhongTab thang={thang} />
        </>
      )}

      {urlTab === 'canhan' && (
        <div className="space-y-3">
          <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-800 no-print">
            📋 <strong>Báo cáo KPI Cá nhân</strong> — Kết quả chấm điểm KPI từng nhân viên và bảng thống kê tổng hợp; bao gồm tab Thống kê (so sánh các NV) và Chi tiết (từng NV).
          </div>
          {caNhanLoading && (
            <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2 no-print">
              <span className="animate-spin inline-block">⏳</span>
              Đang tải dữ liệu từ Supabase...
            </div>
          )}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit no-print">
            {[
              { id: 'thong_ke', label: '📊 Thống kê' },
              { id: 'chi_tiet', label: '📋 Chi tiết' },
            ].map(st => (
              <button
                key={st.id}
                onClick={() => setCaNhanSubTab(st.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  caNhanSubTab === st.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
          {caNhanSubTab === 'thong_ke' && <ThongKeCaNhanTab thang={thang} onLoadingChange={setCaNhanLoading} />}
          {caNhanSubTab === 'chi_tiet' && <BaoCaoCaNhanTab  thang={thang} onLoadingChange={setCaNhanLoading} />}
        </div>
      )}
    </div>
  );
}
