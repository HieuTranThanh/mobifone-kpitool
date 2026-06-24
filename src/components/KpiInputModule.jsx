/**
 * @file KpiInputModule.jsx
 * @description Menu "Nhập liệu KPI" — nhập liệu KPI cá nhân, KPI phòng và cấu hình xếp loại.
 *
 * SUB-MENU:
 * - /nhaplieu/nhaplieu         → NhapLieuKPI: Nhập KPI cá nhân từng NV + xuất/nhập Excel
 * - /nhaplieu/nhaplieuphong    → NhapLieuPhong: Nhập KPI cấp phòng + tính điểm
 * - /nhaplieu/cauhinh_xeploai  → CauHinhXepLoai: Cấu hình ngưỡng A+/A/B/C/D
 *
 * DỮ LIỆU ĐẦU VÀO:
 * - kpi_snapshot_YYYY-MM (localStorage): danh sách KPI per tháng
 * - input_cn (localStorage): dữ liệu nhập KPI cá nhân
 * - trong_so_thang_YYYY-MM: mode (auto/manual) ảnh hưởng field _trong_so
 *
 * DỮ LIỆU ĐẦU RA:
 * - input_cn → upsertInputCN (local) + sheet INPUT_CN_YYYY-MM cột _trong_so qua syncWeightConfig
 * - output_diem, output_chitiet → saveOutputDiem/CT sau khi tính điểm
 * - xep_loai_config → syncStore (config_store)
 *
 * PHÂN QUYỀN:
 * - Toàn module: admin + department_editor (canEditDept); viewer bị chặn (AccessDenied).
 * - Tab CauHinhXepLoai: chỉ admin (canAdmin).
 *
 * LƯU Ý:
 * - _trong_so trong modal: read-only khi mode='auto', editable khi mode='manual'.
 * - inputStatus badge tôn trọng mode: auto chỉ cần value/upper/lower; manual cần đủ 6 trường.
 * - NV đã nghỉ (archived_at ≠ null) vẫn được nhập/tính bình thường — trạng thái chỉ để hiển thị.
 */
import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useAuth, canAdmin, canEditDept } from '../contexts/AuthContext';
import { AccessDenied } from './Layout';
import { useParams } from 'react-router-dom';
import {
  getNvListForThang,
  getInputCNByThang, upsertInputCN,
  getInputPhongByThang, upsertInputPhong,
  getKpiSnapshot, getSnapshotThangList,
  isInputCNLocked, lockInputCN, unlockInputCN,
  syncToSupabase,
  isInputPhongLocked, lockInputPhong, unlockInputPhong,
  getTrongSoConfig, computeNvWeights,
  getOutputDiem, saveOutputDiem,
  getXepLoaiConfig, saveXepLoaiConfig, DEFAULT_XEP_LOAI_CONFIG,
  computePhongInputStatus, getInputCNStatus,
} from '../services/store';
import { calcMonth as calcLocal } from '../services/calcService';
import { isConnected, syncInputCNRows, syncInputPhong, getInputCN as sbGetInputCN, calcMonth as calcSupabase, upsertOutputDiem } from '../services/supabaseService';
import { kpiScore, kpiDisplayPct, xepLoaiColor } from '../utils/kpiScore';
import { setNavGuard, clearNavGuard } from '../utils/navGuard';
import { useSortConfig } from '../utils/sortConfig';
import YearMonthPicker, { defaultThang } from './YearMonthPicker';
import ImportConfirmModal from './ImportConfirmModal';
import XLSXStyle from 'xlsx-js-style';

// ── InputCaNhanModal ──────────────────────────────────────────

function InputCaNhanModal({ nv, thang, snapshot, onClose }) {
  const kpiList = (snapshot?.kpiList || []).filter(k => k.kpi_cap === 'ca_nhan').sort((a, b) => a.stt - b.stt);
  const existing = getInputCNByThang(thang).find(r => r.nv_id === nv.nv_id) || {};

  const tsCfg     = getTrongSoConfig(thang);
  const isAutoMode = (tsCfg?.mode ?? 'manual') === 'auto';
  const nvWeights  = tsCfg ? (computeNvWeights(tsCfg, snapshot?.kpiList || [], [nv])[nv.nv_id] || {}) : {};

  const initForm = () => {
    const f = { thang, nv_id: nv.nv_id };
    kpiList.forEach(k => {
      f[k.kpi_id + '_lower']    = existing[k.kpi_id + '_lower']    ?? '';
      f[k.kpi_id + '_upper']    = existing[k.kpi_id + '_upper']    ?? '';
      f[k.kpi_id + '_value']    = existing[k.kpi_id + '_value']    ?? '';
      f[k.kpi_id + '_trong_so'] = existing[k.kpi_id + '_trong_so'] ?? (nvWeights[k.kpi_id] ?? 0);
      f[k.kpi_id + '_max_pct']  = existing[k.kpi_id + '_max_pct']  ?? 100;
      f[k.kpi_id + '_giam_tru'] = existing[k.kpi_id + '_giam_tru'] ?? 100;
    });
    return f;
  };

  const [form, setForm] = useState(initForm);
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = () => {
    const row = { ...form, thang, nv_id: nv.nv_id,
      ho_ten: nv.ho_ten || '', nhom_cv: nv.nhom_cv || '', khu_vuc: nv.khu_vuc || '' };
    upsertInputCN(row);
    if (isConnected()) syncInputCNRows(thang, [row]).catch(e => console.warn('[syncInputCN]', e));
    onClose();
  };

  if (!kpiList.length) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4">
          <p className="text-slate-600 mb-4">
            Tháng <strong>{thang}</strong> chưa có danh sách KPI.
            Tạo tháng trong tab <strong>Quản lý KPI</strong> trước.
          </p>
          <button className="btn-secondary" onClick={onClose}>Đóng</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h3 className="font-bold text-lg">{nv.ho_ten} – KPI tháng {thang.replace('-', '/')}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          {kpiList.map(k => (
            <div key={k.kpi_id} className="border border-slate-200 rounded-xl p-3">
              <p className="font-semibold text-xs text-slate-800 mb-2">
                <span className="text-blue-600 font-mono mr-1">{k.stt}.</span>
                {k.ten_kpi}
                <span className="text-slate-400 ml-1">({k.don_vi})</span>
                <span className="ml-2 text-slate-400">{k.upper_gt_lower ? '↑ Cao hơn tốt hơn' : '↓ Thấp hơn tốt hơn'}</span>
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[
                  { lbl: 'KQ thực hiện', key: '_value',    req: true,            step: '0.001' },
                  { lbl: 'Chỉ tiêu',     key: '_upper',    req: true,            step: '0.001' },
                  { lbl: 'Ngưỡng dưới',  key: '_lower',    req: true,            step: '0.001' },
                  { lbl: 'Trọng số',     key: '_trong_so', req: !isAutoMode,     step: '0.01'  },
                  { lbl: 'Điểm tối đa %',key: '_max_pct',  req: false,           step: '0.1'   },
                  { lbl: 'Giảm trừ %',   key: '_giam_tru', req: false,           step: '0.1'   },
                ].map(({ lbl, key, req, step }) => {
                  const isTrongSo = key === '_trong_so';
                  const roField   = isTrongSo && isAutoMode;
                  const val       = form[k.kpi_id + key];
                  const isEmpty   = req && (val === '' || val === null || val === undefined || isNaN(parseFloat(String(val ?? ''))));
                  return (
                    <div key={key}>
                      <label className="block text-xs mb-0.5 font-medium" style={{ color: isEmpty ? '#dc2626' : '#6b7280' }}>
                        {lbl}{req ? <span className="ml-0.5">*</span> : ''}
                        {roField && <span className="ml-1 text-slate-400 font-normal">(tự động)</span>}
                      </label>
                      {roField ? (
                        <div className="input text-xs py-1 bg-slate-50 text-slate-500 select-none">
                          {val !== '' && val !== undefined ? parseFloat(Number(val).toFixed(2)) : '—'}
                        </div>
                      ) : (
                        <input
                          type="number" step={step}
                          value={form[k.kpi_id + key] ?? ''}
                          onChange={e => set(k.kpi_id + key, e.target.value === '' ? '' : parseFloat(e.target.value))}
                          className={`input text-xs py-1 ${isEmpty ? 'border-red-400 bg-red-50' : ''}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-3 sticky bottom-0 bg-white">
          <button className="btn-secondary" onClick={onClose}>Hủy</button>
          <button className="btn-primary" onClick={handleSave}>💾 Lưu dữ liệu KPI</button>
        </div>
      </div>
    </div>
  );
}

// ── Excel helpers ─────────────────────────────────────────────

function exportTemplate(thang, snapshot, nvList, existingData) {
  const kpiList = (snapshot?.kpiList || [])
    .filter(k => k.kpi_cap === 'ca_nhan')
    .sort((a, b) => a.stt - b.stt);

  const HEADER_STYLE = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Segoe UI' },
    fill: { fgColor: { rgb: '1E40AF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top: {style:'thin',color:{rgb:'93C5FD'}}, bottom: {style:'thin',color:{rgb:'93C5FD'}}, left: {style:'thin',color:{rgb:'93C5FD'}}, right: {style:'thin',color:{rgb:'93C5FD'}} },
  };
  // Màu xen kẽ theo khối 6 cột của từng KPI (chỉ áp dụng cho data rows)
  const KPI_STRIPE_COLORS = ['EFF6FF', 'F0FDF4']; // xanh nhạt / xanh lá nhạt
  const KPI_DATA_STYLE = (kpiIdx) => ({
    font: { sz: 10, name: 'Segoe UI' },
    fill: { fgColor: { rgb: KPI_STRIPE_COLORS[kpiIdx % 2] } },
    alignment: { vertical: 'center', horizontal: 'center' },
    border: { top: {style:'thin',color:{rgb:'E2E8F0'}}, bottom: {style:'thin',color:{rgb:'E2E8F0'}}, left: {style:'thin',color:{rgb:'E2E8F0'}}, right: {style:'thin',color:{rgb:'E2E8F0'}} },
  });
  const FIXED_DATA_STYLE = (isEven) => ({
    font: { sz: 10, name: 'Segoe UI' },
    fill: { fgColor: { rgb: isEven ? 'F0F9FF' : 'FFFFFF' } },
    alignment: { vertical: 'center' },
    border: { top: {style:'thin',color:{rgb:'E2E8F0'}}, bottom: {style:'thin',color:{rgb:'E2E8F0'}}, left: {style:'thin',color:{rgb:'E2E8F0'}}, right: {style:'thin',color:{rgb:'E2E8F0'}} },
  });

  // Cấu trúc giống y chang sheet INPUT_CN trên Google Sheets
  const row0 = ['Mã NV', 'Họ tên', 'Nhóm CV', 'Khu vực'];
  const row1 = ['nv_id', 'ho_ten', 'nhom_cv', 'khu_vuc'];
  const row2 = ['', '', '', ''];

  kpiList.forEach(k => {
    row0.push(`[${k.stt}] ${k.ten_kpi} (${k.don_vi || ''})`, '', '', '', '', '');
    row1.push(
      `${k.kpi_id}_value`, `${k.kpi_id}_upper`, `${k.kpi_id}_lower`,
      `${k.kpi_id}_trong_so`, `${k.kpi_id}_max_pct`, `${k.kpi_id}_giam_tru`,
    );
    row2.push('KQ TH', 'Chỉ tiêu', 'Ngưỡng dưới', 'Trọng số', 'Điểm tối đa', 'Giảm trừ');
  });

  const dataRows = nvList.map(nv => {
    const ex = existingData.find(r => r.nv_id === nv.nv_id) || {};
    const row = [nv.nv_id, nv.ho_ten, nv.nhom_cv, nv.khu_vuc];
    kpiList.forEach(k => {
      row.push(
        ex[`${k.kpi_id}_value`]    ?? '',
        ex[`${k.kpi_id}_upper`]    ?? '',
        ex[`${k.kpi_id}_lower`]    ?? '',
        ex[`${k.kpi_id}_trong_so`] ?? '',
        ex[`${k.kpi_id}_max_pct`]  ?? 100,
        ex[`${k.kpi_id}_giam_tru`] ?? 100,
      );
    });
    return row;
  });

  const ws = XLSXStyle.utils.aoa_to_sheet([row0, row1, row2, ...dataRows]);
  ws['!views'] = [{ state: 'frozen', xSplit: 4, ySplit: 3 }];

  // Merge 6 cells cho tên KPI ở row 0 (mỗi KPI span 6 cột)
  ws['!merges'] = kpiList.map((_, i) => ({
    s: { r: 0, c: 4 + i * 6 },
    e: { r: 0, c: 4 + i * 6 + 5 },
  }));

  const cols = [{ wch: 16 }, { wch: 22 }, { wch: 18 }, { wch: 16 }];
  kpiList.forEach(() => cols.push({ wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 10 }, { wch: 12 }, { wch: 10 }));
  ws['!cols'] = cols;

  // Row 0: 80pt (tên KPI, đủ để wrap), row1: 30pt (machine keys), row2: 25pt (sub-headers), data: 20pt
  ws['!rows'] = [{ hpt: 80 }, { hpt: 30 }, { hpt: 25 }, ...dataRows.map(() => ({ hpt: 20 }))];

  const totalRows = 3 + dataRows.length;
  const totalCols = 4 + kpiList.length * 6;

  // Header rows (0-2): HEADER_STYLE cho tất cả ô
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < totalCols; c++) {
      const addr = XLSXStyle.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = HEADER_STYLE;
    }
  }

  // Data rows (3+): cột cố định dùng FIXED_DATA_STYLE, cột KPI dùng KPI_DATA_STYLE
  for (let r = 3; r < totalRows; r++) {
    for (let c = 0; c < 4; c++) {
      const addr = XLSXStyle.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = FIXED_DATA_STYLE(r % 2 === 0);
    }
    kpiList.forEach((_, idx) => {
      for (let off = 0; off < 6; off++) {
        const addr = XLSXStyle.utils.encode_cell({ r, c: 4 + idx * 6 + off });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = KPI_DATA_STYLE(idx);
      }
    });
  }

  const wb = XLSXStyle.utils.book_new();
  applyNumFmt(ws);
  XLSXStyle.utils.book_append_sheet(wb, ws, `NhapLieu_KPICaNhan_${thang}`);
  XLSXStyle.writeFile(wb, `NhapLieu_KPICaNhan_${thang}.xlsx`);
}

function parseImportFile(file, thang, kpiList, onDone) {
  const isAutoMode = (getTrongSoConfig(thang)?.mode ?? 'manual') === 'auto';
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb  = XLSXStyle.read(e.target.result, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSXStyle.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const headers = (aoa[1] || []).map(String);
      const rows    = aoa.slice(3);
      const nvIdKey = headers.includes('nv_id') ? 'nv_id' : 'ma_nv';

      const existingByNv = Object.fromEntries(getInputCNByThang(thang).map(r => [r.nv_id, r]));
      let count = 0;
      const imported = [];
      rows.forEach(row => {
        const nv_id = row[headers.indexOf(nvIdKey)];
        if (!nv_id) return;
        const existing = existingByNv[nv_id] || {};
        const inputRow = { ...existing, thang, nv_id };
        kpiList.forEach(k => {
          ['_value', '_upper', '_lower', '_trong_so', '_max_pct', '_giam_tru'].forEach(suf => {
            if (suf === '_trong_so' && isAutoMode) return;
            const key = `${k.kpi_id}${suf}`;
            const idx = headers.indexOf(key);
            if (idx >= 0 && row[idx] !== '' && row[idx] !== undefined) {
              inputRow[key] = parseFloat(row[idx]) || 0;
            }
          });
        });
        imported.push(inputRow);
        count++;
      });
      onDone(count, imported);
    } catch (err) {
      alert('Lỗi đọc file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function applyNumFmt(ws) {
  if (!ws['!ref']) return ws;
  const range = XLSXStyle.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSXStyle.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (cell && cell.t === 'n' && !cell.z) {
        cell.z = Number.isInteger(parseFloat(cell.v.toFixed(2))) ? '0' : '0.##';
      }
    }
  }
  return ws;
}

function exportTemplatePhong(thang, kpiList, existingForm) {
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

  const row0 = ['STT', 'Mã KPI', 'Tên KPI', 'ĐVT', 'KQ thực hiện', 'Chỉ tiêu', 'Ngưỡng dưới', 'Trọng số', 'Điểm tối đa'];
  const row1 = ['stt',  'kpi_id', 'ten_kpi', 'don_vi', 'value', 'upper', 'lower', 'trong_so', 'max_pct'];

  const dataRows = kpiList.map(k => {
    return [
      k.stt, k.kpi_id, k.ten_kpi, k.don_vi || '',
      existingForm[k.kpi_id + '_value']    ?? '',
      existingForm[k.kpi_id + '_upper']    ?? '',
      existingForm[k.kpi_id + '_lower']    ?? '',
      existingForm[k.kpi_id + '_trong_so'] ?? '',
      existingForm[k.kpi_id + '_max_pct']  ?? Math.round((k.max_pct ?? 1) * 100),
    ];
  });

  const ws = XLSXStyle.utils.aoa_to_sheet([row0, row1, ...dataRows]);
  ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 2 }];
  ws['!cols'] = [{ wch: 6 }, { wch: 16 }, { wch: 42 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
  ws['!rows'] = [{ hpt: 25 }, { hpt: 25 }, ...Array(dataRows.length).fill({ hpt: 20 })];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 9; c++) {
      const addr = XLSXStyle.utils.encode_cell({ r, c });
      if (ws[addr]) ws[addr].s = HDR_STYLE;
    }
  }
  for (let r = 2; r < 2 + dataRows.length; r++) {
    for (let c = 0; c < 9; c++) {
      const addr = XLSXStyle.utils.encode_cell({ r, c });
      if (ws[addr]) ws[addr].s = DATA_STYLE(r % 2 === 0);
    }
  }
  const wb = XLSXStyle.utils.book_new();
  applyNumFmt(ws);
  XLSXStyle.utils.book_append_sheet(wb, ws, `NhapLieu_KPIPhong_${thang}`);
  XLSXStyle.writeFile(wb, `NhapLieu_KPIPhong_${thang}.xlsx`);
}

function parseImportFilePhong(file, onDone) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb  = XLSXStyle.read(e.target.result, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSXStyle.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const headers = (aoa[1] || []).map(String);
      const kpiIdIdx  = headers.indexOf('kpi_id');
      const suffixes  = { value: '_value', upper: '_upper', lower: '_lower', trong_so: '_trong_so', max_pct: '_max_pct' };
      const idxMap = Object.fromEntries(Object.entries(suffixes).map(([k, v]) => [v, headers.indexOf(k)]));
      const updates = {};
      let count = 0;
      aoa.slice(2).forEach(row => {
        const kpi_id = String(row[kpiIdIdx] || '').trim();
        if (!kpi_id) return;
        count++;
        Object.entries(idxMap).forEach(([suf, idx]) => {
          if (idx >= 0 && row[idx] !== '' && row[idx] !== undefined) {
            updates[kpi_id + suf] = parseFloat(row[idx]) || 0;
          }
        });
      });
      onDone(updates, count);
    } catch (err) {
      alert('Lỗi đọc file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── NhapLieuKPI (Tab 2) ───────────────────────────────────────

function NhapLieuKPI() {
  const snapList  = getSnapshotThangList();
  const [thang, setThang]           = useState(() => defaultThang(snapList));
  const [nvList, setNvList]         = useState(() => getNvListForThang(snapList[0] || ''));
  const [inputModal, setInputModal] = useState(null);
  const [importMsg, setImportMsg]   = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [locked, setLocked]         = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcMsg, setCalcMsg]         = useState('');
  const [pulling, setPulling]         = useState(false);
  const [importCNPending, setImportCNPending] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    setLocked(isInputCNLocked(thang));
    setNvList(getNvListForThang(thang));
    setCalcMsg('');
    setImportMsg('');
    if (thang && isConnected()) {
      setPulling(true);
      sbGetInputCN(thang)
        .then(res => {
          if (res.data?.length > 0) {
            res.data.forEach(row => upsertInputCN({ ...row, thang }));
            setRefreshKey(k => k + 1);
          }
        })
        .catch(() => {})
        .finally(() => setPulling(false));
    }
  }, [thang]);

  const snapshot    = useMemo(() => thang ? getKpiSnapshot(thang) : null, [thang, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const isAutoMode  = (getTrongSoConfig(thang)?.mode ?? 'manual') === 'auto';
  const kpiList     = useMemo(() =>
    (snapshot?.kpiList || []).filter(k => k.kpi_cap === 'ca_nhan').sort((a, b) => a.stt - b.stt),
    [snapshot]
  );
  const existingData = useMemo(
    () => thang ? getInputCNByThang(thang) : [],
    [thang, refreshKey] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { sortKey, sortDir, handleSort, sortIcon, thCls, sortItems } = useSortConfig('stt');
  const sortedNv = useMemo(() => {
    const getStatus = n => {
      const s = getInputCNStatus(thang, n.nv_id);
      return s === 'empty' ? 0 : s === 'full' ? 2 : 1;
    };
    return sortItems(nvList, { stt: n => n.stt || 0, input_status: getStatus });
  }, [nvList, refreshKey, thang, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImport = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    parseImportFile(file, thang, kpiList, (count, imported) => {
      const existingNvIds = new Set(getInputCNByThang(thang).map(r => r.nv_id));
      const themMoi = imported.filter(r => !existingNvIds.has(r.nv_id)).length;
      const capNhat = imported.filter(r => existingNvIds.has(r.nv_id)).length;
      setImportCNPending({ count, imported, themMoi, capNhat });
    });
    e.target.value = '';
  };

  const doImportCN = () => {
    if (!importCNPending) return;
    const { count, imported } = importCNPending;
    imported.forEach(row => upsertInputCN(row));
    setRefreshKey(k => k + 1);
    setImportMsg(`✓ Đã nhập ${count} nhân viên`);
    if (isConnected() && imported?.length > 0) {
      syncInputCNRows(thang, imported)
        .then(() => setImportMsg(`✓ Đã nhập ${count} nhân viên (đã sync Supabase ✓)`))
        .catch(() => setImportMsg(`✓ Đã nhập ${count} nhân viên (⚠ sync Supabase thất bại)`));
    }
    setTimeout(() => setImportMsg(''), 5000);
    setImportCNPending(null);
  };

  const handleModalClose = () => {
    setInputModal(null);
    setRefreshKey(k => k + 1);
  };

  const handleLock = () => {
    if (!confirm(`Chốt KPI Cá nhân tháng ${thang}?\nSau khi chốt sẽ không thể nhập liệu thêm.`)) return;
    lockInputCN(thang);
    setLocked(true);
  };

  const handleUnlock = () => {
    if (!confirm(`Mở khóa KPI Cá nhân tháng ${thang}?\n\n⚠️ Dữ liệu đã chốt sẽ có thể bị thay đổi. Hãy chắc chắn trước khi tiếp tục.`)) return;
    unlockInputCN(thang);
    setLocked(false);
  };

  const handleCalc = async () => {
    if (!snapshot || calcLoading) return;

    // Đọc dữ liệu mới nhất từ localStorage (tránh stale data sau khi modal save)
    const freshData = getInputCNByThang(thang);

    // Kiểm tra giảm trừ % > 100 (không được phép)
    const invalidGiamTru = [];
    nvList.forEach(nv => {
      const row = freshData.find(r => r.nv_id === nv.nv_id);
      if (!row) return;
      kpiList.forEach(k => {
        const rawGt = parseFloat(row[k.kpi_id + '_giam_tru']);
        if (!isNaN(rawGt) && rawGt > 100) {
          invalidGiamTru.push({ nv: nv.ho_ten, kpi: k.ten_kpi, gt: rawGt });
        }
      });
    });
    if (invalidGiamTru.length > 0) {
      const lines = invalidGiamTru.slice(0, 5).map(x => `• ${x.nv} — ${x.kpi}: giảm trừ = ${x.gt}`).join('\n');
      setCalcMsg(`❌ Không thể tính điểm: có ${invalidGiamTru.length} KPI có Giảm trừ > 100% (chỉ được từ 0 đến 100).\n${lines}\n\n👉 Vào "Nhập liệu KPI" → chỉnh lại cột Giảm trừ % về ≤ 100.`);
      setCalcLoading(false);
      return;
    }

    // Kiểm tra trọng số chưa normalize (chỉ mode manual)
    if (!isAutoMode) {
      const weightTarget = getTrongSoConfig(thang)?.ty_le?.ca_nhan?.ca_nhan ?? 70;
      const unnormNv = nvList.filter(nv => {
        const row = freshData.find(r => r.nv_id === nv.nv_id);
        if (!row) return false;
        const hasValues = kpiList.some(k => {
          const v = row[k.kpi_id + '_value'];
          return v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(String(v)));
        });
        if (!hasValues) return false;
        const total = kpiList.reduce((s, k) => {
          const w = parseFloat(row[k.kpi_id + '_trong_so']);
          return s + (isNaN(w) ? 0 : w);
        }, 0);
        return total > 0 && Math.abs(total - weightTarget) > 0.01;
      });
      if (unnormNv.length > 0) {
        const names = unnormNv.slice(0, 5).map(n => `• ${n.ho_ten}`).join('\n');
        setCalcMsg(`❌ Không thể tính điểm: ${unnormNv.length} NV có tổng trọng số ≠ ${weightTarget}đ.\n${names}\n\n👉 Vào "Quản lý trọng số → Trọng số cá nhân" → bấm "⚖️ Normalize" rồi "💾 Lưu & Sync".`);
        setCalcLoading(false);
        return;
      }
    }

    // Phân loại NV dùng getInputCNStatus — cùng nguồn với status badge hiển thị
    const statusMap = Object.fromEntries(nvList.map(nv => [nv.nv_id, getInputCNStatus(thang, nv.nv_id)]));
    const localUnscoredRows = nvList
      .filter(nv => statusMap[nv.nv_id] !== 'full')
      .map(nv => {
        const cnStatus  = statusMap[nv.nv_id];
        const row       = freshData.find(r => r.nv_id === nv.nv_id);
        const hasAnyVal = row && kpiList.some(k => {
          const v = row[k.kpi_id + '_value'];
          return v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(String(v)));
        });
        const noWeight = !isAutoMode && hasAnyVal && kpiList.some(k => {
          const w = row[k.kpi_id + '_trong_so'];
          return w === '' || w === null || w === undefined || isNaN(parseFloat(String(w)));
        });
        return {
          thang, nv_id: nv.nv_id, ho_ten: nv.ho_ten,
          nhom_cv: nv.nhom_cv, khu_vuc: nv.khu_vuc,
          diem_phong_dong_gop: null, diem_ca_nhan: null,
          tong_diem: null, xep_loai: null,
          ly_do: cnStatus === 'empty' ? 'Chưa nhập dữ liệu' : noWeight ? 'Thiếu trọng số' : 'Thiếu dữ liệu',
        };
      });

    setCalcLoading(true);

    const nvMap = Object.fromEntries(nvList.map(n => [n.nv_id, n]));
    // Chỉ sync những row có ít nhất 1 _value được nhập — tránh ghi row rỗng lên Supabase
    const hasAnyValue = row => kpiList.some(k => {
      const v = row[k.kpi_id + '_value'];
      return v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(String(v)));
    });
    const enrichedData = freshData
      .filter(hasAnyValue)
      .map(row => {
        const nv = nvMap[row.nv_id];
        if (!nv) return row;
        return { ...row, ho_ten: nv.ho_ten || '', nhom_cv: nv.nhom_cv || '', khu_vuc: nv.khu_vuc || '' };
      });

    // Kiểm tra điểm phòng
    const phongInput  = getInputPhongByThang(thang);
    const diemPhong   = parseFloat(phongInput?.tong_diem_phong) || 0;
    const phongNote   = diemPhong === 0 ? ' (phòng chưa có → tính = 0)' : '';

    const incompleteNote = localUnscoredRows.length > 0
      ? ` ⚠️ ${localUnscoredRows.length} NV chưa đủ dữ liệu — KPI chưa được tính.`
      : '';
    setCalcMsg(`⏳ Đang tính… Điểm phòng: ${parseFloat(diemPhong.toFixed(2))}đ${phongNote}${incompleteNote}`);

    try {
      if (isConnected()) {
        // Đẩy toàn bộ input_cn lên Supabase (kèm ho_ten/nhom_cv/khu_vuc để tự thêm row còn thiếu)
        if (enrichedData.length > 0) {
          setCalcMsg(`⏳ Đang đồng bộ ${enrichedData.length} dòng lên Supabase...`);
          await syncInputCNRows(thang, enrichedData);
        }
        setCalcMsg('⏳ Đang tính điểm...');
        const result = await calcSupabase(thang);
        // Frontend "đủ dữ liệu" (6 fields) là chuẩn — loại NV "thiếu" khỏi danh sách đã tính
        // dù calcSupabase có tính được (vì server lấy trọng số từ config, bỏ qua _trong_so trong input_cn)
        const incompleteIds = new Set(localUnscoredRows.map(r => r.nv_id));
        const scoredRows    = (result.ket_qua || []).filter(r => !incompleteIds.has(r.nv_id));
        const scoredSet     = new Set(scoredRows.map(r => r.nv_id));
        // NV không có trong calcSupabase và không phải incomplete
        const otherUnscored = nvList
          .filter(nv => !scoredSet.has(nv.nv_id) && !incompleteIds.has(nv.nv_id))
          .map(nv => {
            const row    = freshData.find(r => r.nv_id === nv.nv_id);
            const hasVal = row && kpiList.some(k => {
              const v = row[k.kpi_id + '_value'];
              return v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(String(v)));
            });
            const noWeight = !isAutoMode && hasVal && kpiList.some(k => {
              const w = row[k.kpi_id + '_trong_so'];
              return w === '' || w === null || w === undefined || isNaN(parseFloat(String(w)));
            });
            return {
              thang, nv_id: nv.nv_id, ho_ten: nv.ho_ten,
              nhom_cv: nv.nhom_cv, khu_vuc: nv.khu_vuc,
              diem_phong_dong_gop: null, diem_ca_nhan: null,
              tong_diem: null, xep_loai: null,
              ly_do: !hasVal ? 'Chưa nhập dữ liệu' : noWeight ? 'Thiếu trọng số' : 'Thiếu dữ liệu',
            };
          });
        const unscoredRows = [...localUnscoredRows, ...otherUnscored];
        const fullOutput   = [...scoredRows, ...unscoredRows];
        const existing     = getOutputDiem().filter(r => r.thang !== thang);
        saveOutputDiem([...existing, ...fullOutput]);
        // Ghi đè Supabase: NV "thiếu dữ liệu" → tong_diem=null (calcSupabase đã tính cho họ bằng weight server)
        if (unscoredRows.length > 0) await upsertOutputDiem(unscoredRows);
        const meta = { updated_at: new Date().toISOString(), so_nv_tinh: scoredRows.length, so_nv_thieu: unscoredRows.length };
        syncToSupabase(`output_meta_${thang}`, meta);
        localStorage.setItem(`output_meta_${thang}`, JSON.stringify(meta));
        const dPhong = parseFloat((result.diem_phong ?? 0).toFixed(2)).toString();
        const doneNote = unscoredRows.length > 0
          ? ` ⚠️ ${unscoredRows.length} NV chưa đủ dữ liệu — KPI chưa được tính.`
          : '';
        setCalcMsg(`✅ Điểm phòng: ${dPhong}đ${phongNote}. Đã tính: ${scoredRows.length} NV.${doneNote}`);
      } else {
        const result = calcLocal(thang);
        // Ghi localUnscoredRows vào output_diem để Dashboard hiển thị đúng "chưa tính điểm"
        if (localUnscoredRows.length > 0) {
          const unscoredIds = new Set(localUnscoredRows.map(r => r.nv_id));
          const merged = getOutputDiem().filter(r => !(r.thang === thang && unscoredIds.has(r.nv_id)));
          saveOutputDiem([...merged, ...localUnscoredRows]);
        }
        const meta = { updated_at: new Date().toISOString(), so_nv_tinh: result.so_nv, so_nv_thieu: localUnscoredRows.length };
        localStorage.setItem(`output_meta_${thang}`, JSON.stringify(meta));
        const offlineNote = localUnscoredRows.length > 0
          ? ` ⚠️ ${localUnscoredRows.length} NV chưa đủ dữ liệu — KPI chưa được tính.`
          : '';
        setCalcMsg(`✅ Điểm phòng: ${parseFloat(diemPhong.toFixed(2))}đ${phongNote}. Đã tính: ${result.so_nv} NV.${offlineNote}`);
      }
    } catch (e) {
      setCalcMsg('❌ Lỗi: ' + e.message);
    }
    setCalcLoading(false);
    setTimeout(() => setCalcMsg(''), 10000);
  };

  if (!snapList.length) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-6 text-sm text-yellow-800 text-center">
        ⚠️ Chưa có tháng nào được tạo. Vào <strong>Quản lý KPI → KPI theo tháng</strong> để tạo tháng trước.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
        📝 <strong>Nhập liệu KPI cá nhân</strong> — Nhập kết quả KPI hàng tháng cho từng nhân viên.
        Xuất template Excel để nhập hàng loạt, sau đó import lại. Thực hiện chốt KPI sau khi đã chấm xong
      </div>

      {pulling && (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="animate-spin inline-block">⏳</span>
          Đang tải dữ liệu từ Supabase...
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <YearMonthPicker thangList={snapList} value={thang} onChange={setThang} />

        {snapshot ? (
          <span className="text-xs text-slate-400">{kpiList.length} KPI cá nhân</span>
        ) : (
          <span className="text-xs text-amber-600">⚠ Tháng {thang} chưa có snapshot KPI</span>
        )}
        {importMsg && <span className="text-xs text-green-600 font-medium">{importMsg}</span>}
        {calcMsg && (
          <span className={`text-xs font-medium ${
            calcMsg.startsWith('✅') ? 'text-green-600' :
            calcMsg.startsWith('❌') ? 'text-red-600' : 'text-blue-500'}`}>
            {calcMsg}
          </span>
        )}
        {locked && <span className="badge bg-red-100 text-red-700 ml-1">🔒 Đã chốt</span>}

        <div className="ml-auto flex flex-wrap gap-2 justify-end">
          <button
            className="btn-primary text-sm"
            disabled={!snapshot || calcLoading || locked}
            onClick={handleCalc}
          >
            {calcLoading ? '⏳...' : '💾 Tính KPI'}
          </button>
          <button
            className="btn-secondary text-sm"
            disabled={!snapshot}
            onClick={() => exportTemplate(thang, snapshot, nvList, existingData)}
          >
            📥 Xuất template Excel
          </button>
          <button
            className="btn-secondary text-sm"
            disabled={!snapshot || locked}
            onClick={() => fileRef.current?.click()}
          >
            📤 Nhập từ Excel
          </button>
          <input
            type="file"
            ref={fileRef}
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImport}
          />
          {locked ? (
            <button className="btn-secondary text-sm" onClick={handleUnlock}>🔓 Mở khóa</button>
          ) : (
            <button
              className="text-sm px-4 py-2 rounded-lg border border-orange-300 text-orange-700 hover:bg-orange-50 disabled:opacity-40"
              onClick={handleLock}
              disabled={!snapshot}
            >🔒 Chốt KPI</button>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-blue-50 border-b border-blue-100">
              <tr>
                <th className={`${thCls('stt')} w-8 text-center`} onClick={() => handleSort('stt')}>STT {sortIcon('stt')}</th>
                <th className={`${thCls('nv_id')} w-16 hidden sm:table-cell`} onClick={() => handleSort('nv_id')}>Mã NV {sortIcon('nv_id')}</th>
                <th className={thCls('ho_ten')} onClick={() => handleSort('ho_ten')}>Họ tên {sortIcon('ho_ten')}</th>
                <th className={`${thCls('nhom_cv')} w-40 hidden md:table-cell`} onClick={() => handleSort('nhom_cv')}>Nhóm CV {sortIcon('nhom_cv')}</th>
                <th className={`${thCls('khu_vuc')} w-32 hidden sm:table-cell`} onClick={() => handleSort('khu_vuc')}>Khu vực {sortIcon('khu_vuc')}</th>
                <th className={`${thCls('input_status')} w-28 text-center`} onClick={() => handleSort('input_status')}>Trạng thái {sortIcon('input_status')}</th>
                <th className="th w-16 text-center">Nhập dữ liệu</th>
              </tr>
            </thead>
            <tbody>
              {sortedNv.map((n, i) => {
                const inputStatus = getInputCNStatus(thang, n.nv_id);
                return (
                  <tr key={n.nv_id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="td text-center text-slate-400">{i + 1}</td>
                    <td className="td font-mono text-xs text-blue-600 hidden sm:table-cell">{n.nv_id}</td>
                    <td className="td font-medium text-slate-900">
                      {n.ho_ten}
                      <span className="block text-[10px] font-mono text-blue-500 sm:hidden">{n.nv_id}</span>
                    </td>
                    <td className="td text-slate-600 text-sm hidden md:table-cell">{n.nhom_cv}</td>
                    <td className="td text-slate-600 text-sm hidden sm:table-cell">{n.khu_vuc}</td>
                    <td className="td text-center">
                      <span className={{ empty: 'badge bg-slate-100 text-slate-400', partial: 'badge bg-yellow-100 text-yellow-700', full: 'badge bg-green-100 text-green-700' }[inputStatus]}>
                        {{ empty: 'Chưa nhập', partial: 'Thiếu dữ liệu', full: '✓ Đủ dữ liệu' }[inputStatus]}
                      </span>
                    </td>
                    <td className="td text-center">
                      <button
                        className={`p-1.5 rounded ${locked ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                        title={locked ? 'Đã chốt — mở khóa để nhập' : 'Nhập KPI'}
                        disabled={locked}
                        onClick={() => !locked && setInputModal({ nv: n, thang })}
                      >📝</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {inputModal && (
        <InputCaNhanModal
          nv={inputModal.nv}
          thang={inputModal.thang}
          snapshot={snapshot}
          onClose={handleModalClose}
        />
      )}

      {importCNPending && (
        <ImportConfirmModal
          open={true}
          onClose={() => setImportCNPending(null)}
          onConfirm={doImportCN}
          title="Xác nhận nhập liệu KPI Cá nhân từ Excel"
          loaiDuLieu="Input KPI cá nhân"
          bangSupabase="input_cn, input_cn_nv"
          thang={thang}
          themMoi={importCNPending.themMoi}
          capNhat={importCNPending.capNhat}
          previewLines={[]}
          warnings={[
            'Dữ liệu nhập từ Excel sẽ ghi đè thông tin hiện tại cho các nhân viên trong file',
            'Thao tác này không thể hoàn tác sau khi xác nhận',
          ]}
          confirmLabel="✅ Xác nhận nhập dữ liệu"
        />
      )}
    </div>
  );
}

// ── NhapLieuPhong (Tab 3) ─────────────────────────────────────

function NhapLieuPhong() {
  const snapList = getSnapshotThangList();
  const [thang, setThang]         = useState(() => defaultThang(snapList));
  const [form, setForm]             = useState({});
  const [locked, setLocked]         = useState(false);
  const [editMode, setEditMode]     = useState(false);
  const [isDirty, setIsDirty]       = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [calcMsg, setCalcMsg]     = useState('');
  const [importPhongPending, setImportPhongPending] = useState(null);
  const fileRefPhong              = useRef(null);
  const headerScrollRef           = useRef(null);
  const bodyScrollRef             = useRef(null);
  const syncFromBody = () => {
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = bodyScrollRef.current?.scrollLeft ?? 0;
  };

  const snapshot     = thang ? getKpiSnapshot(thang) : null;
  const weightConfig = thang ? getTrongSoConfig(thang) : null;
  const ty_le_chinhanh    = weightConfig?.ty_le?.phong?.chinhanh ?? weightConfig?.ty_le?.phong?.cty ?? 50;
  const ty_le_phong  = weightConfig?.ty_le?.phong?.phong ?? 50;

  const kpiList  = useMemo(() =>
    (snapshot?.kpiList || []).filter(k => k.kpi_cap === 'phong').sort((a, b) => a.stt - b.stt),
    [snapshot]
  );
  const nhomList = useMemo(() => snapshot?.nhomList || [], [snapshot]);

  useEffect(() => {
    if (!thang) return;
    setForm(getInputPhongByThang(thang) || {});
    setLocked(isInputPhongLocked(thang));
    setEditMode(false);
    setIsDirty(false);
  }, [thang]);

  const setField = (key, val) => { setForm(f => ({ ...f, [key]: val })); if (editMode) setIsDirty(true); };

  const doSave = (formData) => {
    const row = { ...formData, thang };
    kpiList.forEach(kpi => {
      ['_lower', '_upper', '_trong_so', '_value'].forEach(suf => {
        const v = parseFloat(row[kpi.kpi_id + suf]);
        row[kpi.kpi_id + suf] = isNaN(v) ? '' : v;
      });
      const rawMpInit = parseFloat(row[kpi.kpi_id + '_max_pct']);
      row[kpi.kpi_id + '_max_pct'] = (isNaN(rawMpInit) || rawMpInit <= 0) ? Math.round((kpi.max_pct ?? 1) * 100) : rawMpInit;
      const v      = parseFloat(row[kpi.kpi_id + '_value']);
      const l      = parseFloat(row[kpi.kpi_id + '_lower']);
      const u      = parseFloat(row[kpi.kpi_id + '_upper']);
      const w      = parseFloat(row[kpi.kpi_id + '_trong_so']);
      const rawMp  = parseFloat(row[kpi.kpi_id + '_max_pct']);
      const maxPct = isNaN(rawMp) || rawMp <= 0 ? (kpi.max_pct ?? 1) : (rawMp > 2 ? rawMp / 100 : rawMp);
      const valid  = !isNaN(v) && !isNaN(l) && !isNaN(u) && u !== l;
      const dispPct = (valid && !isNaN(u)) ? kpiDisplayPct(v, u, kpi.upper_gt_lower) : null;
      row[kpi.kpi_id + '_pct_th'] = (dispPct && 'pct' in dispPct) ? Math.round(dispPct.pct * 10000) / 10000 : '';
      row[kpi.kpi_id + '_diem']   = (valid && !isNaN(w) && w > 0) ? Math.round(kpiScore(v, l, u, maxPct, w, 1) * 1000) / 1000 : '';
    });
    const kq = parseFloat(row.diem_kpi_chinhanh_kq);
    row.diem_kpi_chinhanh_kq = isNaN(kq) ? '' : kq;
    row.diem_kpi_chinhanh    = isNaN(kq) ? '' : Math.round(kq * ty_le_chinhanh / 100 * 1000) / 1000;
    const kq_val   = isNaN(kq) ? 0 : kq;
    const phongSum = kpiList.reduce((s, kpi) => {
      const d = parseFloat(row[kpi.kpi_id + '_diem']);
      return s + (isNaN(d) ? 0 : d);
    }, 0);
    row.tong_diem_phong = Math.round((kq_val * ty_le_chinhanh / 100 + phongSum) * 1000) / 1000;
    upsertInputPhong(row);
    setForm(row);
    if (isConnected()) syncInputPhong(row).catch(e => console.warn('Sync KPI phòng Supabase thất bại:', e));
  };

  const computed = useMemo(() => {
    const result = {};
    kpiList.forEach(kpi => {
      const v = parseFloat(form[kpi.kpi_id + '_value']);
      const l = parseFloat(form[kpi.kpi_id + '_lower']);
      const u = parseFloat(form[kpi.kpi_id + '_upper']);
      const w = parseFloat(form[kpi.kpi_id + '_trong_so']);
      const rawMp2 = parseFloat(form[kpi.kpi_id + '_max_pct']);
      const maxPct = isNaN(rawMp2) || rawMp2 <= 0 ? (kpi.max_pct ?? 1) : (rawMp2 > 2 ? rawMp2 / 100 : rawMp2);
      const valid  = !isNaN(v) && !isNaN(l) && !isNaN(u) && u !== l;
      result[kpi.kpi_id] = {
        dispPct:     (!isNaN(v) && !isNaN(u)) ? kpiDisplayPct(v, u, kpi.upper_gt_lower) : null,
        diem_quy_doi: (valid && !isNaN(w) && w > 0) ? kpiScore(v, l, u, maxPct, w, 1) : null,
      };
    });
    return result;
  }, [form, kpiList]);

  const kq_chinhanh       = parseFloat(form.diem_kpi_chinhanh_kq) || 0;
  const diem_chinhanh     = kq_chinhanh * ty_le_chinhanh / 100;
  const diemPhongSum = kpiList.reduce((s, kpi) => s + (computed[kpi.kpi_id]?.diem_quy_doi || 0), 0);
  const totalDiem    = diem_chinhanh + diemPhongSum;

  const handleImportPhong = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    parseImportFilePhong(file, (updates, count) => {
      const existingPhong = getInputPhongByThang(thang) || {};
      const hasExisting = Object.keys(existingPhong).some(k => k !== 'thang' && existingPhong[k] !== '');
      setImportPhongPending({ updates, count, hasExisting });
    });
    e.target.value = '';
  };

  const doImportPhong = () => {
    if (!importPhongPending) return;
    const { updates, count } = importPhongPending;
    doSave({ ...form, ...updates });
    setEditMode(false);
    setIsDirty(false);
    setImportMsg(`✓ Đã nhập ${count} KPI từ file (đã lưu & sync Supabase ✓)`);
    setTimeout(() => setImportMsg(''), 5000);
    setImportPhongPending(null);
  };

  const handleSave = () => {
    doSave(form);
    setEditMode(false);
    setIsDirty(false);
    const totalW = kpiList.reduce((s, kpi) => {
      const v = parseFloat(form[kpi.kpi_id + '_trong_so']);
      return s + (isNaN(v) ? 0 : v);
    }, 0);
    const diff = Math.round((totalW - ty_le_phong) * 100) / 100;
    if (Math.abs(diff) > 0.01) {
      const direction = diff > 0 ? `giảm ${Math.abs(diff)}đ` : `tăng ${Math.abs(diff)}đ`;
      setCalcMsg(`✅ Đã lưu. ⚠️ Tổng trọng số yêu cầu: ${ty_le_phong}đ — đã nhập: ${Math.round(totalW * 100) / 100}đ — cần ${direction} để đúng tổng`);
    } else {
      setCalcMsg('✅ Đã lưu & đồng bộ KPI Phòng lên Supabase');
    }
    setTimeout(() => setCalcMsg(''), 8000);
  };

  const handleLock = () => {
    if (!confirm(`Chốt KPI Phòng tháng ${thang}?\nSau khi chốt sẽ không thể hiệu chỉnh dữ liệu.`)) return;
    lockInputPhong(thang);
    setLocked(true);
  };

  const handleUnlock = () => {
    if (!confirm(`Mở khóa KPI Phòng tháng ${thang}?\n\n⚠️ Dữ liệu đã chốt sẽ có thể bị thay đổi. Hãy chắc chắn trước khi tiếp tục.`)) return;
    unlockInputPhong(thang);
    setLocked(false);
    setEditMode(false);
    setIsDirty(false);
  };

  const handleEnterEditPhong = () => {
    alert('Lưu ý: Sau khi chỉnh sửa xong, bạn phải bấm nút "Lưu & Sync" để các thay đổi được lưu vào cơ sở dữ liệu. Nếu không lưu, các thay đổi sẽ không có hiệu lực.');
    setEditMode(true);
    setIsDirty(false);
  };

  useEffect(() => {
    if (!editMode || !isDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editMode, isDirty]);

  useEffect(() => {
    if (editMode && isDirty) {
      setNavGuard('Nhập liệu KPI Phòng đang có thay đổi chưa lưu.\nThoát trang sẽ mất các thay đổi. Tiếp tục không?');
    } else {
      clearNavGuard();
    }
    return () => clearNavGuard();
  }, [editMode, isDirty]);

  const groups = useMemo(() => {
    const nhomMap = new Map(nhomList.map(n => [n.nhom_id, n]));
    const ordered = [];
    const seen    = new Set();
    kpiList.forEach(kpi => {
      if (!seen.has(kpi.nhom_id)) {
        seen.add(kpi.nhom_id);
        ordered.push({
          nhom: nhomMap.get(kpi.nhom_id) || { nhom_id: kpi.nhom_id, ten_nhom: kpi.nhom_id },
          kpis: [],
        });
      }
      ordered[ordered.length - 1].kpis.push(kpi);
    });
    return ordered;
  }, [kpiList, nhomList]);

  // Dùng computePhongInputStatus (từ store) với form state để phản ánh ngay cả khi chưa lưu
  const phongInputStatus = useMemo(() => computePhongInputStatus(form, kpiList), [form, kpiList]);

  if (!snapList.length) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-6 text-sm text-yellow-800 text-center">
        ⚠️ Chưa có tháng nào được tạo. Vào <strong>Quản lý KPI → KPI theo tháng</strong> để tạo tháng trước.
      </div>
    );
  }

  const fmtPct  = dp => {
    if (!dp) return '—';
    if (dp.error) return dp.error;
    return parseFloat((dp.pct * 100).toFixed(2)) + '%';
  };
  const fmtDiem = v => v !== null ? parseFloat(v.toFixed(2)).toString() : '—';
  const fmtInputNum = v => (!editMode && v !== '' && v != null && !isNaN(parseFloat(v)))
    ? parseFloat(Number(v).toFixed(2))
    : (v ?? '');

  const inputCls = (locked || !editMode)
    ? 'no-spin bg-slate-50 text-slate-400 cursor-not-allowed'
    : 'no-spin';

  return (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-800">
        🏢 <strong>Nhập liệu KPI Phòng</strong> — Nhập kết quả KPI hàng tháng cấp phòng.
        Xuất template Excel để nhập hàng loạt, sau đó import lại. Thực hiện chốt KPI sau khi đã chấm xong
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <YearMonthPicker thangList={snapList} value={thang} onChange={(t) => {
          if (editMode && isDirty && !window.confirm('Bạn đang chỉnh sửa nhưng chưa lưu. Chuyển tháng sẽ mất các thay đổi chưa lưu. Tiếp tục không?')) return;
          setThang(t);
        }} />

        {snapshot ? (
          <span className="text-xs text-slate-400">{kpiList.length} KPI phòng</span>
        ) : (
          <span className="text-xs text-amber-600">⚠ Tháng {thang} chưa có snapshot KPI</span>
        )}
        {snapshot && (
          <span className={{
            empty:   'badge bg-slate-100 text-slate-400',
            partial: 'badge bg-yellow-100 text-yellow-700',
            full:    'badge bg-green-100 text-green-700',
          }[phongInputStatus]}>
            {{ empty: 'Chưa có dữ liệu', partial: 'Thiếu dữ liệu', full: '✓ Đủ dữ liệu' }[phongInputStatus]}
          </span>
        )}
        {calcMsg   && (
          <span className={`text-xs font-medium ${
            calcMsg.startsWith('✅') ? 'text-green-600' :
            calcMsg.startsWith('❌') || calcMsg.startsWith('⚠') ? 'text-orange-600' : 'text-blue-500'}`}>
            {calcMsg}
          </span>
        )}
        {importMsg && <span className="text-xs text-green-600 font-medium">{importMsg}</span>}
        {locked    && <span className="badge bg-red-100 text-red-700 ml-1">🔒 Đã chốt</span>}
        {editMode && isDirty && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">⚠️ Có thay đổi chưa lưu</span>
        )}

        <div className="ml-auto flex gap-2">
          {!editMode && !locked && (
            <button className="btn-secondary text-sm" onClick={handleEnterEditPhong} disabled={!snapshot}>
              ✏️ Chỉnh sửa
            </button>
          )}
          {editMode && (
            <button className="btn-primary text-sm" onClick={handleSave} disabled={!snapshot}>
              💾 Lưu & Sync KPI Phòng
            </button>
          )}
          <button
            className="btn-secondary text-sm"
            disabled={!snapshot}
            onClick={() => exportTemplatePhong(thang, kpiList, form)}
          >📥 Xuất template Excel</button>
          <button
            className="btn-secondary text-sm"
            disabled={!snapshot || locked || !editMode}
            onClick={() => fileRefPhong.current?.click()}
          >📤 Nhập từ Excel</button>
          <input type="file" ref={fileRefPhong} accept=".xlsx,.xls" className="hidden" onChange={handleImportPhong} />
          {locked ? (
            <button className="btn-secondary text-sm" onClick={handleUnlock}>🔓 Mở khóa</button>
          ) : !editMode ? (
            <button
              className="text-sm px-4 py-2 rounded-lg border border-orange-300 text-orange-700 hover:bg-orange-50 disabled:opacity-40"
              onClick={handleLock}
              disabled={!snapshot}
            >🔒 Chốt KPI</button>
          ) : null}
        </div>
      </div>

      {snapshot && (
        <div className="card p-0">
        <div ref={headerScrollRef} className="sticky top-0 z-10 overflow-hidden border-b border-blue-100 rounded-t-xl">
          <table className="text-sm" style={{ tableLayout: 'fixed', width: '100%', minWidth: 1000 }}>
            <colgroup>{[40,300,80,80,80,80,80,80,80,80].map((w,i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead className="bg-blue-50 border-b border-blue-100">
              <tr>
                <th className="th text-center w-[40px]">STT</th>
                <th className="th min-w-[300px]">Tên KPI</th>
                <th className="th text-center w-[80px]">ĐVT</th>
                <th className="th text-center w-[80px]">KQ thực hiện</th>
                <th className="th text-center w-[80px]">% Thực hiện</th>
                <th className="th text-center w-[80px]">Chỉ tiêu</th>
                <th className="th text-center w-[80px]">Ngưỡng dưới</th>
                <th className="th text-center w-[80px]">Trọng số</th>
                <th className="th text-center w-[80px]">Điểm Quy đổi</th>
                <th className="th text-center w-[80px]">Điểm tối đa (%)</th>
              </tr>
            </thead>
          </table>
        </div>
        <div ref={bodyScrollRef} className="overflow-x-auto" onScroll={syncFromBody}>
          <table className="text-sm" style={{ tableLayout: 'fixed', width: '100%', minWidth: 1000 }}>
            <colgroup>{[40,300,80,80,80,80,80,80,80,80].map((w,i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <tbody>
                {/* Row A — KPI Chi nhánh */}
                <tr className="bg-green-50 text-green-900">
                  <td className="px-3 py-2 text-center font-bold text-sm">A</td>
                  <td colSpan={2} className="px-3 py-2 font-bold text-sm">KPI Chi nhánh</td>
                  <td className="px-1.5 py-1">
                    <input
                      type="number" step="0.01" min="0" max="120"
                      disabled={locked || !editMode}
                      placeholder="VD: 100"
                      value={form.diem_kpi_chinhanh_kq ?? ''}
                      onChange={e => setField('diem_kpi_chinhanh_kq', e.target.value)}
                      className={(locked || !editMode) ? 'no-spin bg-slate-50 text-slate-400 cursor-not-allowed' : 'no-spin'}
                    />
                  </td>
                  <td className="px-3 py-2 text-center text-sm">
                    {kq_chinhanh > 0 ? parseFloat(kq_chinhanh.toFixed(2)) + '%' : '—'}
                  </td>
                  <td colSpan={2} className="px-3 py-2 text-center text-xs text-green-600">—</td>
                  <td className="px-3 py-2 text-center text-sm font-semibold">{ty_le_chinhanh}</td>
                  <td className="px-3 py-2 text-center font-bold text-green-700">{fmtDiem(diem_chinhanh)}</td>
                  <td className="px-3 py-2 text-center text-green-600">{parseFloat(ty_le_chinhanh.toFixed(2)).toString()}</td>
                </tr>

                {/* Row B — KPI Phòng header */}
                <tr className="bg-blue-50 text-blue-900">
                  <td className="px-3 py-2 text-center font-bold text-sm">B</td>
                  <td colSpan={2} className="px-3 py-2 font-bold text-sm">KPI Phòng</td>
                  <td colSpan={2} className="px-3 py-2 text-center text-xs text-blue-500">—</td>
                  <td colSpan={2} className="px-3 py-2 text-center text-xs text-blue-500">—</td>
                  <td className="px-3 py-2 text-center text-sm font-semibold">{ty_le_phong}</td>
                  <td className="px-3 py-2 text-center font-bold text-blue-700">{fmtDiem(diemPhongSum)}</td>
                  <td className="px-3 py-2 text-center text-blue-500">{parseFloat(ty_le_phong.toFixed(2)).toString()}</td>
                </tr>

                {groups.map(({ nhom, kpis }) => (
                  <Fragment key={nhom.nhom_id || nhom.ten_nhom}>
                    <tr className="bg-blue-50 border-t border-blue-100">
                      <td colSpan={10} className="px-4 py-1.5 text-sm font-semibold text-blue-700">
                        {nhom.thu_tu ? `${nhom.thu_tu}. ${nhom.ten_nhom}` : nhom.ten_nhom}
                      </td>
                    </tr>
                    {kpis.map(kpi => {
                      const c = computed[kpi.kpi_id] || {};
                      return (
                        <tr key={kpi.kpi_id} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="td text-center text-slate-400">{kpi.stt}</td>
                          <td className="td text-slate-900 whitespace-normal break-words">
                            {kpi.ten_kpi}
                            <span className="block text-xs text-slate-400 font-mono mt-0.5">{kpi.kpi_id}</span>
                          </td>
                          <td className="td text-center text-slate-500 text-xs">{kpi.don_vi}</td>
                          <td className="td px-1.5">
                            <input type="number" step="any" disabled={locked || !editMode}
                              value={fmtInputNum(form[kpi.kpi_id + '_value'])}
                              onChange={e => setField(kpi.kpi_id + '_value', e.target.value)}
                              className={inputCls} />
                          </td>
                          <td className={`td text-center ${c.dispPct?.error ? 'text-red-500 text-xs' : 'font-medium text-blue-700'}`}>{fmtPct(c.dispPct)}</td>
                          <td className="td px-1.5">
                            <input type="number" step="any" disabled={locked || !editMode}
                              value={fmtInputNum(form[kpi.kpi_id + '_upper'])}
                              onChange={e => setField(kpi.kpi_id + '_upper', e.target.value)}
                              className={inputCls} />
                          </td>
                          <td className="td px-1.5">
                            <input type="number" step="any" disabled={locked || !editMode}
                              value={fmtInputNum(form[kpi.kpi_id + '_lower'])}
                              onChange={e => setField(kpi.kpi_id + '_lower', e.target.value)}
                              className={inputCls} />
                          </td>
                          <td className="td px-1.5">
                            <input type="number" step="any" disabled={locked || !editMode}
                              value={fmtInputNum(form[kpi.kpi_id + '_trong_so'])}
                              onChange={e => setField(kpi.kpi_id + '_trong_so', e.target.value)}
                              className={inputCls} />
                          </td>
                          <td className="td text-center font-medium text-green-700">{fmtDiem(c.diem_quy_doi)}</td>
                          <td className="td px-1.5">
                            <input type="number" step="1" min="100" disabled={locked || !editMode}
                              value={form[kpi.kpi_id + '_max_pct'] ?? Math.round((kpi.max_pct ?? 1) * 100)}
                              onChange={e => setField(kpi.kpi_id + '_max_pct', e.target.value)}
                              className={inputCls} />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}

                {/* Row C — Tổng điểm */}
                <tr className="border-t-2 border-slate-300 bg-yellow-50">
                  <td className="px-3 py-2 text-center font-bold text-slate-700">C</td>
                  <td colSpan={7} className="px-3 py-2 font-bold text-slate-700">Tổng điểm phòng (A + B)</td>
                  <td colSpan={2} className="px-3 py-2 text-center font-bold text-blue-900 text-base">
                    {fmtDiem(totalDiem)} đ
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {importPhongPending && (
        <ImportConfirmModal
          open={true}
          onClose={() => setImportPhongPending(null)}
          onConfirm={doImportPhong}
          title="Xác nhận nhập liệu KPI Phòng từ Excel"
          loaiDuLieu="Input KPI phòng"
          bangSupabase="config_store (key: input_phong_YYYY-MM)"
          thang={thang}
          themMoi={importPhongPending.hasExisting ? 0 : importPhongPending.count}
          capNhat={importPhongPending.hasExisting ? importPhongPending.count : 0}
          previewLines={[]}
          warnings={[
            'Dữ liệu KPI Phòng nhập từ Excel sẽ ghi đè thông tin hiện tại của tháng này',
            'Thao tác này không thể hoàn tác sau khi xác nhận',
          ]}
          confirmLabel="✅ Xác nhận nhập dữ liệu"
        />
      )}
    </div>
  );
}

// ── CauHinhXepLoai ────────────────────────────────────────────────────────────

function CauHinhXepLoai() {
  const [config, setConfig] = useState(() => getXepLoaiConfig());
  const [editMode, setEditMode] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const set = (key, val) => { setConfig(c => ({ ...c, [key]: val })); if (editMode) setIsDirty(true); };

  const vals = () => [config.A_plus, config.A, config.B, config.C].map(Number);
  const isValid = () => {
    const v = vals();
    return v.every(n => !isNaN(n) && n > 0) && v[0] > v[1] && v[1] > v[2] && v[2] > v[3];
  };

  const handleEnterEditXepLoai = () => {
    alert('Lưu ý: Sau khi chỉnh sửa xong, bạn phải bấm nút "Lưu & Sync" để các thay đổi được lưu vào cơ sở dữ liệu. Nếu không lưu, các thay đổi sẽ không có hiệu lực.');
    setEditMode(true);
    setIsDirty(false);
  };

  useEffect(() => {
    if (!editMode || !isDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editMode, isDirty]);

  useEffect(() => {
    if (editMode && isDirty) {
      setNavGuard('Cấu hình xếp loại đang có thay đổi chưa lưu.\nThoát trang sẽ mất các thay đổi. Tiếp tục không?');
    } else {
      clearNavGuard();
    }
    return () => clearNavGuard();
  }, [editMode, isDirty]);

  const handleSave = () => {
    if (!isValid()) return;
    const cfg = { A_plus: Number(config.A_plus), A: Number(config.A), B: Number(config.B), C: Number(config.C) };
    saveXepLoaiConfig(cfg);
    setEditMode(false);
    setIsDirty(false);
    setSavedMsg('✓ Đã lưu & đồng bộ cấu hình xếp loại');
    setTimeout(() => setSavedMsg(''), 3000);
  };

  const handleReset = () => { setConfig({ ...DEFAULT_XEP_LOAI_CONFIG }); if (editMode) setIsDirty(true); };

  const ROWS = [
    { key: 'A_plus', loai: 'A+', label: 'Xuất sắc',      cond: `≥ ${config.A_plus}` },
    { key: 'A',      loai: 'A',  label: 'Vượt',           cond: `≥ ${config.A} và < ${config.A_plus}` },
    { key: 'B',      loai: 'B',  label: 'Đạt',            cond: `≥ ${config.B} và < ${config.A}` },
    { key: 'C',      loai: 'C',  label: 'Đạt một phần',   cond: `≥ ${config.C} và < ${config.B}` },
    { key: null,     loai: 'D',  label: 'Không đạt KPI',  cond: `< ${config.C}` },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 text-sm text-purple-800">
        🏅 <strong>Cấu hình xếp loại</strong> — Thiết lập các ngưỡng điểm để phân loại kết quả KPI. Áp dụng cho cả KPI Phòng và KPI Cá nhân
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-slate-800">Bảng ngưỡng điểm xếp loại</h3>
          {!editMode ? (
            <button className="btn-secondary text-sm ml-auto" onClick={handleEnterEditXepLoai}>
              ✏️ Chỉnh sửa
            </button>
          ) : (
            <div className="ml-auto flex items-center gap-2">
              {isDirty && (
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">⚠️ Có thay đổi chưa lưu</span>
              )}
              <button onClick={handleSave} disabled={!isValid()} className="btn-primary text-sm disabled:opacity-40">
                💾 Lưu & Sync
              </button>
              <button onClick={handleReset} className="btn-secondary text-sm">
                ↩ Đặt lại mặc định
              </button>
            </div>
          )}
          {savedMsg && <span className="text-green-600 text-sm font-medium">{savedMsg}</span>}
        </div>
        <table className="w-full text-sm border border-slate-200 rounded-xl overflow-hidden">
          <thead className="bg-blue-50 border-b border-blue-100">
            <tr className="text-slate-600">
              <th className="th text-center w-20">Xếp loại</th>
              <th className="th">Mức độ hoàn thành</th>
              <th className="th">Điều kiện</th>
              <th className="th text-center w-36">Ngưỡng điểm</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(row => (
              <tr key={row.loai} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="td text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${xepLoaiColor(row.loai)}`}>{row.loai}</span>
                </td>
                <td className="td font-medium">{row.label}</td>
                <td className="td text-slate-500 text-xs">{row.cond}</td>
                <td className="td text-center">
                  {row.key ? (
                    <input
                      type="number"
                      className={`input w-24 text-center text-sm ${!editMode ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
                      value={config[row.key]}
                      onChange={e => set(row.key, e.target.value)}
                      disabled={!editMode}
                      min={1}
                      max={200}
                      step={1}
                    />
                  ) : (
                    <span className="text-slate-400 text-xs italic">Điểm còn lại</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {editMode && !isValid() && (
          <p className="text-xs text-red-600">⚠️ Ngưỡng không hợp lệ — cần A+ &gt; A &gt; B &gt; C &gt; 0</p>
        )}
      </div>

      <div className="card p-4 text-xs text-slate-500 space-y-1">
        <p className="font-medium text-slate-700">Lưu ý khi thay đổi ngưỡng</p>
        <p>• Ngưỡng mới áp dụng ngay cho tính điểm phía client (Offline). Các kết quả đã lưu trước đó không bị thay đổi.</p>
        <p>• Để tính lại kết quả theo ngưỡng mới: vào <strong>Nhập liệu KPI cá nhân</strong> → chọn tháng → bấm <strong>Tính kết quả</strong>.</p>
      </div>
    </div>
  );
}

// ── KpiInputModule — module "Nhập liệu KPI" ──────────────────────────────────

const TAB_TITLES_EM = {
  nhaplieu:         '📝 Nhập liệu KPI cá nhân',
  nhaplieuphong:    '🏢 Nhập liệu KPI Phòng',
  cauhinh_xeploai:  '🏅 Cấu hình xếp loại',
};

const TAB_DESC_EM = {
  nhaplieu:         'Nhập kết quả KPI hàng tháng cho từng nhân viên, có thể xuất template/nhập liệu từ Excel',
  nhaplieuphong:    'Nhập kết quả KPI cấp Phòng hàng tháng, có thể xuất template/nhập liệu từ Excel',
  cauhinh_xeploai:  'Thiết lập các ngưỡng điểm dùng để xếp loại kết quả KPI',
};

export default function KpiInputModule() {
  const { tab: urlTab = 'nhaplieu' } = useParams();
  const { user } = useAuth();

  if (!canEditDept(user)) {
    return (
      <div className="p-3 md:p-6">
        <h2 className="text-xl font-bold text-slate-900">Nhập liệu KPI</h2>
        <div className="mt-6"><AccessDenied /></div>
      </div>
    );
  }

  // cauhinh_xeploai chỉ admin mới truy cập
  if (urlTab === 'cauhinh_xeploai' && !canAdmin(user)) {
    return (
      <div className="p-3 md:p-6">
        <h2 className="text-xl font-bold text-slate-900">🏅 Cấu hình xếp loại</h2>
        <div className="mt-6"><AccessDenied /></div>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-6 space-y-5">
      <div>
        <h2 className="text-lg md:text-xl font-bold text-slate-900">{TAB_TITLES_EM[urlTab] ?? 'Nhập liệu KPI'}</h2>
        <p className="text-slate-500 text-xs mt-0.5">
          {TAB_DESC_EM[urlTab] ?? 'Nhập liệu KPI cá nhân và KPI phòng hàng tháng'}
        </p>
      </div>
      {urlTab === 'nhaplieu'         && <NhapLieuKPI />}
      {urlTab === 'nhaplieuphong'    && <NhapLieuPhong />}
      {urlTab === 'cauhinh_xeploai'  && <CauHinhXepLoai />}
    </div>
  );
}
