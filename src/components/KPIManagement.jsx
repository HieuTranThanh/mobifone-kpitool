/**
 * @file KPIManagement.jsx
 * @description Menu "Quản lý KPI" — Quản lý thư viện KPI, tạo template và cấu hình KPI theo tháng.
 *
 * SUB-MENU:
 * - /kpi/thuvien   → ThuVienKPI: CRUD thư viện KPI/Nhóm, thêm vào template (+T)
 * - /kpi/template  → TaoTemplate: Sắp xếp thứ tự KPI/Nhóm trong template toàn cầu
 * - /kpi/thang     → TheoThang: Tạo/chỉnh sửa snapshot KPI theo từng tháng
 *
 * LUỒNG DỮ LIỆU:
 *   Thư viện (kpi_library) → Template (kpi_list refs) → Snapshot tháng (kpi_snapshot_YYYY-MM)
 *
 * DỮ LIỆU ĐẦU VÀO:
 * - kpi_library, nhom_library (localStorage ← Supabase kpi_library/nhom_library)
 * - kpi_list, nhom_list (localStorage ← Supabase config_store)
 * - kpi_snapshot_YYYY-MM (localStorage ← Supabase config_store)
 *
 * DỮ LIỆU ĐẦU RA:
 * - kpi_library → syncKpiLibrary (Supabase kpi_library)
 * - nhom_library → syncNhomLibrary (Supabase nhom_library)
 * - kpi_list/nhom_list → syncStore (Supabase config_store)
 * - kpi_snapshot_YYYY-MM → syncStore + createMonthTemplate (Supabase input_cn)
 *
 * PHÂN QUYỀN:
 * - Toàn module: admin + department_editor (canEditDept); viewer bị chặn (AccessDenied).
 *
 * LƯU Ý:
 * - Không thêm NV snapshot trước khi tạo KPI tháng (TheoThang kiểm tra này).
 * - Xóa tháng KPI → tự động xóa dữ liệu input_cn tháng đó trên Supabase.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { setNavGuard, clearNavGuard } from '../utils/navGuard';
import { useSortConfig, formatUsedMonths } from '../utils/sortConfig';
import { useAuth, canEditDept } from '../contexts/AuthContext';
import { AccessDenied } from './Layout';
import YearMonthPicker, { defaultThang } from './YearMonthPicker';
import ImportConfirmModal from './ImportConfirmModal';
import {
  getKpiList, saveKpiList,
  getNhomList, saveNhomList,
  getKpiLibrary, saveKpiLibrary,
  getNhomLibrary, saveNhomLibrary,
  archiveKpi,
  addKpiToLibrary, addNhomToLibrary,
  generateKpiId, generateNhomId,
  getKpiSnapshot, saveKpiSnapshot, getSnapshotThangList, deleteKpiSnapshot,
  getInputCN, saveInputCN, getOutputDiem, saveOutputDiem, getOutputCT, saveOutputCT,
  getOutputDiemByThang,
  getAllKpiCatalog, getAllNhomCatalog,
  deleteKpiPermanently, deleteNhomPermanently,
  syncToSupabase,
  getNvSnapshot, getNvListForThang,
  deleteTrongSoConfig,
  unlockInputCN, unlockInputPhong,
} from '../services/store';
import {
  isConnected, syncKpiLibrary, syncNhomLibrary,
  createMonthTemplate, deleteMonthSheet, updateInputCNKpis,
} from '../services/supabaseService';
import XLSXStyle from 'xlsx-js-style';

// ── Excel helpers (thư viện KPI) ──────────────────────────────

const KPI_LIB_HDR_S = {
  font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Segoe UI' },
  fill: { fgColor: { rgb: '1E40AF' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: { top:{style:'thin',color:{rgb:'93C5FD'}}, bottom:{style:'thin',color:{rgb:'93C5FD'}}, left:{style:'thin',color:{rgb:'93C5FD'}}, right:{style:'thin',color:{rgb:'93C5FD'}} },
};
const KPI_LIB_DAT_S = (isEven) => ({
  font: { sz: 10, name: 'Segoe UI' },
  fill: { fgColor: { rgb: isEven ? 'F0F9FF' : 'FFFFFF' } },
  alignment: { vertical: 'center', wrapText: false },
  border: { top:{style:'thin',color:{rgb:'E2E8F0'}}, bottom:{style:'thin',color:{rgb:'E2E8F0'}}, left:{style:'thin',color:{rgb:'E2E8F0'}}, right:{style:'thin',color:{rgb:'E2E8F0'}} },
});

function applyKpiLibStyles(ws, numDataRows, numCols, wrapCols = []) {
  for (let c = 0; c < numCols; c++) {
    const addr = XLSXStyle.utils.encode_cell({ r: 0, c });
    if (!ws[addr]) ws[addr] = { t: 's', v: '' };
    ws[addr].s = KPI_LIB_HDR_S;
  }
  for (let r = 1; r <= numDataRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const addr = XLSXStyle.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      const s = KPI_LIB_DAT_S(r % 2 !== 0);
      ws[addr].s = wrapCols.includes(c)
        ? { ...s, alignment: { ...s.alignment, wrapText: true } }
        : s;
    }
  }
}

function exportNhomKpiTemplate(nhomCatalog, cap) {
  const capLabel = cap === 'ca_nhan' ? 'CaNhan' : 'Phong';
  const header = ['STT', 'Mã nhóm (mẫu)', 'Tên nhóm KPI'];
  const rows = nhomCatalog.map((item, i) => [i + 1, item.nhom_id, item.ten_nhom]);
  const ws = XLSXStyle.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 35 }];
  ws['!rows'] = [{ hpt: 25 }, ...rows.map(() => ({ hpt: 20 }))];
  ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  applyKpiLibStyles(ws, rows.length, 3);
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, `ThuVienNhomKPI_${capLabel}`);
  XLSXStyle.writeFile(wb, `ThuVienNhomKPI_${capLabel}.xlsx`);
}

function exportKpiLibTemplate(kpiCatalog, cap) {
  const capLabel = cap === 'ca_nhan' ? 'CaNhan' : 'Phong';
  const header = ['STT', 'Mã KPI (mẫu)', 'Tên KPI', 'Đơn vị tính', 'Chiều KPI', 'Cách tính'];
  const rows = kpiCatalog.map((item, i) => [
    i + 1, item.kpi_id, item.ten_kpi, item.don_vi || '',
    item.upper_gt_lower ? '↑ Càng cao càng tốt' : '↓ Càng thấp càng tốt',
    item.cach_tinh || '',
  ]);
  const ws = XLSXStyle.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{ wch: 6 }, { wch: 18 }, { wch: 55 }, { wch: 12 }, { wch: 20 }, { wch: 100 }];
  ws['!rows'] = [{ hpt: 25 }, ...rows.map(() => ({ hpt: 40 }))];
  ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  applyKpiLibStyles(ws, rows.length, 6, [2, 5]);
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, `ThuVienKPI_${capLabel}`);
  XLSXStyle.writeFile(wb, `ThuVienKPI_${capLabel}.xlsx`);
}

function parseImportNhomKpi(file, onDone) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb  = XLSXStyle.read(e.target.result, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSXStyle.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const entries = [];
      aoa.slice(1).forEach(row => {
        const tenNhom   = String(row[2] ?? '').trim();
        if (!tenNhom) return;
        const nhomIdRef = String(row[1] ?? '').trim() || null;
        entries.push({ ten_nhom: tenNhom, nhom_id_ref: nhomIdRef });
      });
      onDone(entries);
    } catch (err) { alert('Lỗi đọc file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function parseImportKpiLib(file, onDone) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb  = XLSXStyle.read(e.target.result, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSXStyle.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const entries = [];
      aoa.slice(1).forEach(row => {
        const tenKpi = String(row[2] ?? '').trim();
        if (!tenKpi) return;
        const kpiIdRef = String(row[1] ?? '').trim() || null;
        const donVi    = String(row[3] ?? '').trim();
        const chieuRaw = String(row[4] ?? '').trim();
        const cachTinh = String(row[5] ?? '').trim();
        const upperGtLower = !chieuRaw.includes('↓') && !chieuRaw.toLowerCase().includes('thấp');
        entries.push({ kpi_id_ref: kpiIdRef, ten_kpi: tenKpi, don_vi: donVi, upper_gt_lower: upperGtLower, cach_tinh: cachTinh });
      });
      onDone(entries);
    } catch (err) { alert('Lỗi đọc file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

// Normalize chuỗi để so sánh: trim + chuẩn hóa line endings (Excel đổi \n → \r\n)
const normStr = s => (s ?? '').trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const ROMAN_OPTIONS = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];

// ── Helpers ───────────────────────────────────────────────────

function renumberStt(list) {
  const caN = list.filter(k => k.kpi_cap === 'ca_nhan').sort((a,b) => a.stt - b.stt).map((k,i) => ({...k, stt: i+1}));
  const ph  = list.filter(k => k.kpi_cap === 'phong').sort((a,b) => a.stt - b.stt).map((k,i) => ({...k, stt: i+1}));
  return [...caN, ...ph];
}

function insertKpiAtStt(list, kpi) {
  const same  = list.filter(k => k.kpi_cap === kpi.kpi_cap).map(k => k.stt >= kpi.stt ? {...k, stt: k.stt+1} : k);
  const other = list.filter(k => k.kpi_cap !== kpi.kpi_cap);
  return renumberStt([...other, ...same, kpi]);
}

function removeAndRenumber(list, kpi_id) {
  return renumberStt(list.filter(k => k.kpi_id !== kpi_id));
}

function insertNhomAtThuTu(nhomList, nhom) {
  const cap = nhom.kpi_cap;
  const idx = ROMAN_OPTIONS.indexOf(nhom.thu_tu);
  const shifted = nhomList.map(n => {
    if (n.kpi_cap !== cap) return n;
    const i = ROMAN_OPTIONS.indexOf(n.thu_tu);
    return i >= idx ? { ...n, thu_tu: ROMAN_OPTIONS[Math.min(i + 1, ROMAN_OPTIONS.length - 1)] } : n;
  });
  return [...shifted, nhom];
}

function recompactNhom(nhomList, kpi_cap) {
  const same = nhomList
    .filter(n => n.kpi_cap === kpi_cap)
    .sort((a, b) => ROMAN_OPTIONS.indexOf(a.thu_tu) - ROMAN_OPTIONS.indexOf(b.thu_tu))
    .map((n, i) => ({ ...n, thu_tu: ROMAN_OPTIONS[i] }));
  return [...nhomList.filter(n => n.kpi_cap !== kpi_cap), ...same];
}

function applyNhomEdit(nhomList, editedNhom) {
  const without   = nhomList.filter(n => n.nhom_id !== editedNhom.nhom_id);
  const compacted = recompactNhom(without, editedNhom.kpi_cap);
  return insertNhomAtThuTu(compacted, editedNhom);
}


// ── useKpiStore ───────────────────────────────────────────────

function useKpiStore() {
  const [kpiList,      setKpiList]      = useState(getKpiList);
  const [nhomList,     setNhomList]     = useState(getNhomList);
  const [kpiLibrary,   setKpiLibrary]   = useState(getKpiLibrary);
  const [nhomLibrary,  setNhomLibrary]  = useState(getNhomLibrary);
  const [syncMsg,      setSyncMsg]      = useState('');

  const persistKpi  = v => { setKpiList(v); saveKpiList(v); syncToSupabase('kpi_list', v); };
  const persistNhom = v => { setNhomList(v); saveNhomList(v); syncToSupabase('nhom_list', v); };

  const persistKpiLibrary = v => {
    setKpiLibrary(v);
    saveKpiLibrary(v);
    if (isConnected())
      syncKpiLibrary(v)
        .then(() => { setSyncMsg('✓ Đã đồng bộ thư viện KPI'); setTimeout(() => setSyncMsg(''), 3000); })
        .catch(e => setSyncMsg('⚠️ Sync thất bại: ' + e.message));
  };

  const persistNhomLibrary = v => {
    setNhomLibrary(v);
    saveNhomLibrary(v);
    if (isConnected())
      syncNhomLibrary(v)
        .then(() => { setSyncMsg('✓ Đã đồng bộ thư viện nhóm KPI'); setTimeout(() => setSyncMsg(''), 3000); })
        .catch(e => setSyncMsg('⚠️ Sync thất bại: ' + e.message));
  };

  return {
    kpiList, nhomList, kpiLibrary, nhomLibrary, syncMsg,
    persistKpi, persistNhom, persistKpiLibrary, persistNhomLibrary,
  };
}

const CAP_LABEL = { ca_nhan: 'KPI Cá nhân', phong: 'KPI Phòng' };
const CAP_ICON  = { ca_nhan: '👤', phong: '🏢' };

// ── SubTabs ───────────────────────────────────────────────────

function SubTabs({ cap, onChange }) {
  return (
    <div className="flex gap-1 bg-slate-100 p-1 rounded-lg shrink-0">
      {['ca_nhan', 'phong'].map(c => (
        <button key={c} onClick={() => onChange(c)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${cap === c ? 'bg-white shadow text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>
          {CAP_ICON[c]} {CAP_LABEL[c]}
        </button>
      ))}
    </div>
  );
}

// ── InfoBox ───────────────────────────────────────────────────

function InfoBox({ icon, title, desc, color = 'blue' }) {
  const cls = {
    blue:   'bg-blue-50 border-blue-200 text-blue-800',
    purple: 'bg-purple-50 border-purple-200 text-purple-800',
    teal:   'bg-teal-50 border-teal-200 text-teal-800',
  }[color];
  return (
    <div className={`border rounded-xl px-4 py-3 text-sm ${cls}`}>
      {icon} <strong>{title}</strong> — {desc}
    </div>
  );
}

// ── NhomCreateForm ────────────────────────────────────────────

function NhomCreateForm({ cap, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    nhom_id: generateNhomId(cap),
    ten_nhom: '',
    kpi_cap: cap,
    archived_at: null,
  }));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="card border-green-200 bg-green-50 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-green-900">Thêm Nhóm {CAP_ICON[cap]} {CAP_LABEL[cap]} vào thư viện</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Mã nhóm (tự động)</label>
          <input className="input bg-slate-100 text-slate-500 text-xs font-mono w-32" value={form.nhom_id} readOnly />
        </div>
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-slate-700 mb-1">Tên nhóm KPI *</label>
          <input className="input" value={form.ten_nhom}
            onChange={e => set('ten_nhom', e.target.value)}
            placeholder="Nhập tên nhóm..."
            onKeyDown={e => e.key === 'Enter' && form.ten_nhom.trim() && onSave(form)} />
        </div>
        <button onClick={() => { if (!form.ten_nhom.trim()) return alert('Vui lòng nhập Tên nhóm'); onSave(form); }}
          className="btn-primary">💾 Lưu vào thư viện</button>
        <button onClick={onCancel} className="btn-secondary">Hủy</button>
      </div>
    </div>
  );
}

// ── KpiCreateForm ─────────────────────────────────────────────

function KpiCreateForm({ cap, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    kpi_id: generateKpiId(cap), ten_kpi: '', don_vi: '',
    kpi_cap: cap, upper_gt_lower: true, archived_at: null, cach_tinh: '',
  }));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="card border-blue-200 bg-blue-50 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-blue-900">Thêm {CAP_ICON[cap]} {CAP_LABEL[cap]} vào thư viện</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Mã KPI (tự động)</label>
          <input className="input bg-slate-100 text-slate-500 text-xs font-mono" value={form.kpi_id} readOnly />
        </div>
        <div className="lg:col-span-2">
          <label className="block text-xs font-medium text-slate-700 mb-1">Tên KPI *</label>
          <input className="input" value={form.ten_kpi}
            onChange={e => set('ten_kpi', e.target.value)} placeholder="Nhập tên KPI..." />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Đơn vị tính</label>
          <input className="input" value={form.don_vi}
            onChange={e => set('don_vi', e.target.value)} placeholder="%, Điểm, Giờ..." />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Chiều KPI</label>
          <select className="input" value={form.upper_gt_lower ? 'up' : 'down'}
            onChange={e => set('upper_gt_lower', e.target.value === 'up')}>
            <option value="up">↑ Càng cao càng tốt</option>
            <option value="down">↓ Càng thấp càng tốt</option>
          </select>
        </div>
        <div className="lg:col-span-4">
          <label className="block text-xs font-medium text-slate-700 mb-1">Cách tính</label>
          <textarea className="input w-full text-sm" rows={3}
            value={form.cach_tinh}
            onChange={e => set('cach_tinh', e.target.value)}
            placeholder="Mô tả cách tính, nguồn dữ liệu, công thức..." />
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={() => { if (!form.ten_kpi.trim()) return alert('Vui lòng nhập Tên KPI'); onSave(form); }}
          className="btn-primary">💾 Lưu vào thư viện</button>
        <button onClick={onCancel} className="btn-secondary">Hủy</button>
      </div>
    </div>
  );
}

// ── KpiEditForm — chỉ STT + Nhóm (Template & Tháng) ──────────

function KpiEditForm({ cap, nhomList, initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const groups = (nhomList || []).filter(n => n.kpi_cap === cap)
    .sort((a,b) => ROMAN_OPTIONS.indexOf(a.thu_tu) - ROMAN_OPTIONS.indexOf(b.thu_tu));

  return (
    <div className="flex items-end gap-3 flex-wrap py-1">
      <div className="text-xs text-slate-500 self-center shrink-0 hidden sm:block">
        <span className="font-medium text-slate-700">{form.ten_kpi || form.kpi_id}</span>
        <span className="block text-slate-400">Để sửa Tên/Đơn vị tính/Chiều → Thư viện KPI</span>
      </div>
      <div className="w-52">
        <label className="block text-xs font-medium text-slate-700 mb-1">Nhóm</label>
        <select className="input text-sm" value={form.nhom_id} onChange={e => set('nhom_id', e.target.value)}>
          <option value="">-- Chọn nhóm --</option>
          {groups.map(n => <option key={n.nhom_id} value={n.nhom_id}>{n.thu_tu}. {n.ten_nhom}</option>)}
        </select>
      </div>
      <div className="w-20">
        <label className="block text-xs font-medium text-slate-700 mb-1">STT</label>
        <input type="number" min="1" className="input text-sm" value={form.stt}
          onChange={e => set('stt', parseInt(e.target.value) || 1)} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave(form)} className="btn-primary text-sm">💾 Lưu</button>
        <button onClick={onCancel} className="btn-secondary text-sm">Hủy</button>
      </div>
    </div>
  );
}

// ── KpiLibraryEditForm ────────────────────────────────────────

function KpiLibraryEditForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3 py-1">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-slate-700 mb-1">Tên KPI *</label>
          <input className="input text-sm" value={form.ten_kpi}
            onChange={e => set('ten_kpi', e.target.value)} />
        </div>
        <div className="w-28">
          <label className="block text-xs font-medium text-slate-700 mb-1">Đơn vị tính</label>
          <input className="input text-sm" value={form.don_vi || ''}
            onChange={e => set('don_vi', e.target.value)} placeholder="%, Điểm..." />
        </div>
        <div className="w-44">
          <label className="block text-xs font-medium text-slate-700 mb-1">Chiều KPI</label>
          <select className="input text-sm" value={form.upper_gt_lower ? 'up' : 'down'}
            onChange={e => set('upper_gt_lower', e.target.value === 'up')}>
            <option value="up">↑ Cao hơn tốt hơn</option>
            <option value="down">↓ Thấp hơn tốt hơn</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Cách tính</label>
        <textarea className="input text-sm w-full" rows={3}
          value={form.cach_tinh || ''}
          onChange={e => set('cach_tinh', e.target.value)}
          placeholder="Mô tả cách tính, nguồn dữ liệu, công thức..." />
      </div>
      <div className="flex gap-2">
        <button onClick={() => { if (!form.ten_kpi.trim()) return alert('Vui lòng nhập Tên KPI'); onSave(form); }}
          className="btn-primary text-sm">💾 Lưu</button>
        <button onClick={onCancel} className="btn-secondary text-sm">Hủy</button>
      </div>
    </div>
  );
}

// ── NhomLibraryEditForm ───────────────────────────────────────

function NhomLibraryEditForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial);
  return (
    <div className="flex items-end gap-3 flex-wrap py-1">
      <div className="flex-1 min-w-48">
        <label className="block text-xs font-medium text-slate-700 mb-1">Tên nhóm KPI *</label>
        <input className="input text-sm" value={form.ten_nhom}
          onChange={e => setForm(f => ({ ...f, ten_nhom: e.target.value }))} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => { if (!form.ten_nhom.trim()) return alert('Vui lòng nhập Tên nhóm'); onSave(form); }}
          className="btn-primary text-sm">💾 Lưu</button>
        <button onClick={onCancel} className="btn-secondary text-sm">Hủy</button>
      </div>
    </div>
  );
}

// ── NhomPickerModal — multi-select nhóm từ thư viện ─────────

function NhomPickerModal({ cap, currentNhomList, onAdd, onClose }) {
  const [search,      setSearch]      = useState('');
  const [phase,       setPhase]       = useState(1);
  const [selected,    setSelected]    = useState(new Set());
  const [assignments, setAssignments] = useState([]);

  const usedIds    = useMemo(() => new Set((currentNhomList || []).map(n => n.nhom_id)), [currentNhomList]);
  const usedRomans = useMemo(() => new Set((currentNhomList || []).filter(n => n.kpi_cap === cap).map(n => n.thu_tu)), [currentNhomList, cap]);

  const catalog = useMemo(() =>
    getAllNhomCatalog()
      .filter(n => n.kpi_cap === cap && !n.archived && !usedIds.has(n.nhom_id))
      .filter(n => !search || n.ten_nhom.toLowerCase().includes(search.toLowerCase()) || n.nhom_id.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.nhom_id.localeCompare(b.nhom_id)),
    [cap, usedIds, search]
  );

  const toggleSelect = id => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleProceed = () => {
    const items = catalog.filter(n => selected.has(n.nhom_id));
    const taken = new Set(usedRomans);
    setAssignments(items.map(nhom => {
      const thuTu = ROMAN_OPTIONS.find(r => !taken.has(r)) || 'I';
      taken.add(thuTu);
      return { nhom, thu_tu: thuTu };
    }));
    setPhase(2);
  };

  const updateThuTu = (nhom_id, thu_tu) =>
    setAssignments(prev => prev.map(a => a.nhom.nhom_id === nhom_id ? { ...a, thu_tu } : a));

  const removeAssignment = nhom_id =>
    setAssignments(prev => prev.filter(a => a.nhom.nhom_id !== nhom_id));

  const handleConfirm = () => {
    const thuTuSet = new Set(assignments.map(a => a.thu_tu));
    if (thuTuSet.size < assignments.length) return alert('Có STT La Mã trùng nhau, vui lòng điều chỉnh.');
    onAdd(assignments.map(a => ({ ...a.nhom, thu_tu: a.thu_tu, kpi_cap: cap })));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="font-bold">📁 Thêm Nhóm {CAP_ICON[cap]} {CAP_LABEL[cap]} từ thư viện</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>

        {phase === 1 ? (
          <>
            <div className="px-4 py-3 border-b flex gap-2 items-center">
              <input className="input flex-1" placeholder="🔍 Tìm tên nhóm..."
                value={search} onChange={e => setSearch(e.target.value)} />
              {selected.size > 0 && <span className="text-xs text-green-600 font-medium whitespace-nowrap">Đã chọn {selected.size}</span>}
            </div>
            <div className="overflow-y-auto flex-1">
              {catalog.length === 0 ? (
                <p className="text-center text-slate-400 py-10 text-sm">
                  Không còn nhóm nào trong thư viện để thêm.
                  <br /><span className="text-xs">Tạo nhóm mới trong tab "Thư viện KPI".</span>
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-blue-50 border-b border-blue-100 sticky top-0">
                    <tr>
                      <th className="th w-8 text-center">
                        <input type="checkbox"
                          checked={selected.size === catalog.length && catalog.length > 0}
                          onChange={e => setSelected(e.target.checked ? new Set(catalog.map(n => n.nhom_id)) : new Set())} />
                      </th>
                      <th className="th">Tên nhóm KPI</th>
                      <th className="th w-28">Mã nhóm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.map(item => (
                      <tr key={item.nhom_id}
                        className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${selected.has(item.nhom_id) ? 'bg-green-50' : ''}`}
                        onClick={() => toggleSelect(item.nhom_id)}>
                        <td className="td text-center" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(item.nhom_id)} onChange={() => toggleSelect(item.nhom_id)} />
                        </td>
                        <td className="td font-medium">{item.ten_nhom}</td>
                        <td className="td font-mono text-green-700">{item.nhom_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-4 border-t flex gap-2 justify-end">
              <button onClick={onClose} className="btn-secondary text-sm">Hủy</button>
              <button onClick={handleProceed} disabled={selected.size === 0}
                className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                Tiếp tục →{selected.size > 0 ? ` (${selected.size})` : ''}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-3 border-b">
              <p className="text-sm text-slate-600">Gán STT (La Mã) cho {assignments.length} nhóm đã chọn:</p>
            </div>
            <div className="overflow-y-auto flex-1">
              {assignments.length === 0
                ? <p className="text-center text-slate-400 py-8 text-sm">Chưa có nhóm nào</p>
                : (
                  <table className="w-full text-xs">
                    <thead className="bg-blue-50 border-b border-blue-100 sticky top-0">
                      <tr>
                        <th className="th">Tên nhóm KPI</th>
                        <th className="th w-32">STT (La Mã)</th>
                        <th className="th w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map(a => {
                        const takenOthers = new Set(assignments.filter(x => x.nhom.nhom_id !== a.nhom.nhom_id).map(x => x.thu_tu));
                        const available   = ROMAN_OPTIONS.filter(r => !usedRomans.has(r));
                        return (
                          <tr key={a.nhom.nhom_id} className="border-t border-slate-100">
                            <td className="td font-medium">{a.nhom.ten_nhom}</td>
                            <td className="td">
                              <select className="input text-xs py-0.5 w-24" value={a.thu_tu}
                                onChange={e => updateThuTu(a.nhom.nhom_id, e.target.value)}>
                                {available.map(r => (
                                  <option key={r} value={r}>{r}{takenOthers.has(r) ? ' ⚠️' : ''}</option>
                                ))}
                              </select>
                            </td>
                            <td className="td text-center">
                              <button onClick={() => removeAssignment(a.nhom.nhom_id)}
                                className="text-slate-300 hover:text-red-500 text-base leading-none">✕</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              }
            </div>
            <div className="px-6 py-4 border-t flex gap-2 justify-between">
              <button onClick={() => setPhase(1)} className="btn-secondary text-sm">← Chọn lại</button>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary text-sm">Hủy</button>
                <button onClick={handleConfirm} disabled={assignments.length === 0}
                  className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                  + Thêm {assignments.length} nhóm
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── LibraryPickerModal — multi-select KPI từ thư viện ────────

function LibraryPickerModal({ cap, currentList, nhomList, onAdd, onClose, preSelected = null }) {
  const currentIds  = useMemo(() => new Set(currentList.map(k => k.kpi_id)), [currentList]);
  const maxStt      = useMemo(() =>
    Math.max(0, ...currentList.filter(k => k.kpi_cap === cap).map(k => k.stt || 0)),
    [currentList, cap]
  );
  const nhomOptions = (nhomList || []).filter(n => n.kpi_cap === cap)
    .sort((a, b) => ROMAN_OPTIONS.indexOf(a.thu_tu) - ROMAN_OPTIONS.indexOf(b.thu_tu));

  const [search,      setSearch]      = useState('');
  const [phase,       setPhase]       = useState(preSelected ? 2 : 1);
  const [selected,    setSelected]    = useState(() => preSelected ? new Set([preSelected.kpi_id]) : new Set());
  const [assignments, setAssignments] = useState(() =>
    preSelected
      ? [{ kpi: preSelected, nhom_id: nhomOptions[0]?.nhom_id || '', stt: maxStt + 1 }]
      : []
  );

  const libItems = useMemo(() =>
    getAllKpiCatalog()
      .filter(k => k.kpi_cap === cap && !currentIds.has(k.kpi_id) && !k.archived)
      .filter(k => !search || k.ten_kpi.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.kpi_id.localeCompare(b.kpi_id)),
    [cap, currentIds, search]
  );

  const toggleSelect = id => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleProceed = () => {
    const items = libItems.filter(k => selected.has(k.kpi_id));
    setAssignments(items.map((kpi, i) => ({
      kpi,
      nhom_id: nhomOptions[0]?.nhom_id || '',
      stt: maxStt + i + 1,
    })));
    setPhase(2);
  };

  const updateAssignment = (kpi_id, field, value) =>
    setAssignments(prev => prev.map(a => a.kpi.kpi_id === kpi_id ? { ...a, [field]: value } : a));

  const removeAssignment = kpi_id =>
    setAssignments(prev => prev.filter(a => a.kpi.kpi_id !== kpi_id));

  const applyNhomToAll = nhom_id =>
    setAssignments(prev => prev.map(a => ({ ...a, nhom_id })));

  const handleConfirm = () => {
    if (assignments.some(a => !a.nhom_id)) return alert('Vui lòng chọn Nhóm cho tất cả KPI');
    onAdd(assignments.map(a => {
      const { archived, inTemplate, usedInMonths, archived_at, ...base } = a.kpi;
      return { ...base, nhom_id: a.nhom_id, stt: a.stt, active: true, max_pct: base.max_pct || 1 };
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="font-bold">📚 Thêm {CAP_ICON[cap]} {CAP_LABEL[cap]} từ thư viện</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>

        {phase === 1 ? (
          <>
            <div className="px-4 py-3 border-b flex gap-2 items-center">
              <input className="input flex-1" placeholder="🔍 Tìm tên KPI..."
                value={search} onChange={e => setSearch(e.target.value)} />
              {selected.size > 0 && <span className="text-xs text-blue-600 font-medium whitespace-nowrap">Đã chọn {selected.size}</span>}
            </div>
            <div className="overflow-y-auto overflow-x-auto flex-1">
              {libItems.length === 0 ? (
                <p className="text-center text-slate-400 py-10 text-sm">
                  Không còn KPI nào trong thư viện để thêm.
                  <br /><span className="text-xs">Tạo KPI mới trong tab "Thư viện KPI".</span>
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-blue-50 border-b border-blue-100 sticky top-0">
                    <tr>
                      <th className="th w-8 text-center">
                        <input type="checkbox"
                          checked={selected.size === libItems.length && libItems.length > 0}
                          onChange={e => setSelected(e.target.checked ? new Set(libItems.map(k => k.kpi_id)) : new Set())} />
                      </th>
                      <th className="th">Tên KPI</th>
                      <th className="th w-28">Mã KPI</th>
                      <th className="th w-16">ĐVT</th>
                      <th className="th w-16 text-center">Chiều</th>
                    </tr>
                  </thead>
                  <tbody>
                    {libItems.map(item => (
                      <tr key={item.kpi_id}
                        className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${selected.has(item.kpi_id) ? 'bg-blue-50' : ''}`}
                        onClick={() => toggleSelect(item.kpi_id)}>
                        <td className="td text-center" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(item.kpi_id)} onChange={() => toggleSelect(item.kpi_id)} />
                        </td>
                        <td className="td font-medium">{item.ten_kpi}</td>
                        <td className="td font-mono text-blue-600 text-[10px]">{item.kpi_id}</td>
                        <td className="td text-slate-500">{item.don_vi}</td>
                        <td className="td text-center text-slate-500">{item.upper_gt_lower ? '↑' : '↓'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-4 border-t flex gap-2 justify-end">
              <button onClick={onClose} className="btn-secondary text-sm">Hủy</button>
              <button onClick={handleProceed} disabled={selected.size === 0}
                className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                Tiếp tục →{selected.size > 0 ? ` (${selected.size} KPI)` : ''}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-3 border-b flex items-center gap-3 flex-wrap">
              {!preSelected && (
                <button onClick={() => setPhase(1)} className="text-xs text-blue-600 hover:text-blue-800">← Chọn lại</button>
              )}
              <span className="text-sm text-slate-600">{assignments.length} KPI đã chọn</span>
              {nhomOptions.length > 0 && assignments.length > 1 && (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-slate-500 whitespace-nowrap">Gán nhóm tất cả:</span>
                  <select className="input text-xs py-0.5 w-44" defaultValue=""
                    onChange={e => e.target.value && applyNhomToAll(e.target.value)}>
                    <option value="" disabled>-- Chọn nhóm --</option>
                    {nhomOptions.map(n => <option key={n.nhom_id} value={n.nhom_id}>{n.thu_tu}. {n.ten_nhom}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="overflow-y-auto overflow-x-auto flex-1">
              {assignments.length === 0
                ? <p className="text-center text-slate-400 py-8 text-sm">Chưa có KPI nào</p>
                : (
                  <table className="w-full text-xs">
                    <thead className="bg-blue-50 border-b border-blue-100 sticky top-0">
                      <tr>
                        <th className="th">Tên KPI</th>
                        <th className="th w-48">Nhóm *</th>
                        <th className="th w-20">STT</th>
                        <th className="th w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map(a => (
                        <tr key={a.kpi.kpi_id} className="border-t border-slate-100">
                          <td className="td font-medium">
                            {a.kpi.ten_kpi}
                            <span className="block text-[10px] text-slate-400">{a.kpi.don_vi}{a.kpi.upper_gt_lower ? ' ↑' : ' ↓'}</span>
                          </td>
                          <td className="td">
                            <select className="input text-xs py-0.5" value={a.nhom_id}
                              onChange={e => updateAssignment(a.kpi.kpi_id, 'nhom_id', e.target.value)}>
                              <option value="">-- Chọn nhóm --</option>
                              {nhomOptions.map(n => <option key={n.nhom_id} value={n.nhom_id}>{n.thu_tu}. {n.ten_nhom}</option>)}
                            </select>
                          </td>
                          <td className="td">
                            <input type="number" min="1" className="input text-xs py-0.5 w-20" value={a.stt}
                              onChange={e => updateAssignment(a.kpi.kpi_id, 'stt', parseInt(e.target.value) || 1)} />
                          </td>
                          <td className="td text-center">
                            <button onClick={() => removeAssignment(a.kpi.kpi_id)}
                              className="text-slate-300 hover:text-red-500 text-base leading-none">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            </div>
            <div className="px-6 py-4 border-t flex gap-2 justify-end">
              <button onClick={onClose} className="btn-secondary text-sm">Hủy</button>
              <button onClick={handleConfirm} disabled={assignments.length === 0}
                className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                + Thêm {assignments.length} KPI
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── KpiGroupTable ─────────────────────────────────────────────

function KpiGroupTable({ list, nhomMap, cap, nhomList, editingKpi, setEditingKpi, onSave, onDelete, colSpan = 5, sort }) {
  const sortedList = sort ? [...list].sort(sort) : list;

  const groupIds = [];
  const groupMap = {};
  sortedList.forEach(k => {
    if (!groupMap[k.nhom_id]) { groupMap[k.nhom_id] = []; groupIds.push(k.nhom_id); }
    groupMap[k.nhom_id].push(k);
  });

  if (sortedList.length === 0) {
    return (
      <tr>
        <td colSpan={colSpan} className="td text-center text-slate-400 py-8">
          Chưa có KPI — thêm từ thư viện
        </td>
      </tr>
    );
  }

  // Sort groups by thu_tu
  groupIds.sort((a, b) => {
    const ta = nhomMap[a]?.thu_tu || 'Z';
    const tb = nhomMap[b]?.thu_tu || 'Z';
    return ROMAN_OPTIONS.indexOf(ta) - ROMAN_OPTIONS.indexOf(tb);
  });

  return groupIds.map(nhom_id => {
    const nhom = nhomMap[nhom_id];
    return [
      <tr key={`g-${nhom_id}`} className="bg-blue-50 border-t border-blue-100">
        <td colSpan={colSpan} className="px-4 py-1.5 font-semibold text-blue-800 text-xs">
          {nhom ? `${nhom.thu_tu}. ${nhom.ten_nhom}` : '(Chưa phân nhóm)'}
        </td>
      </tr>,
      ...groupMap[nhom_id].map(k => {
        const isEditingThis = editingKpi?.kpi_id === k.kpi_id;
        return [
          <tr key={k.kpi_id}
            className={`border-t border-slate-100 hover:bg-slate-50 ${isEditingThis ? 'bg-blue-50' : ''}`}>
            <td className="td text-center text-slate-400 font-mono w-8">{k.stt}</td>
            <td className="td text-slate-900 font-medium">
              {k.ten_kpi}
              <span className="block text-slate-400 font-mono font-normal text-[10px]">{k.kpi_id}</span>
            </td>
            <td className="td text-slate-500 w-14">{k.don_vi}</td>
            <td className="td text-slate-600 w-28">{k.upper_gt_lower ? '↑ Cao hơn tốt hơn' : '↓ Thấp hơn tốt hơn'}</td>
            {onDelete && (
              <td className="td text-center w-20">
                <div className="flex gap-1 justify-center">
                  <button onClick={() => setEditingKpi(isEditingThis ? null : { ...k })}
                    className={`p-1 rounded hover:bg-blue-50 ${isEditingThis ? 'text-blue-600' : 'text-slate-400 hover:text-blue-600'}`}
                    title="Sửa STT / Nhóm">✏️</button>
                  <button onClick={() => onDelete(k.kpi_id)}
                    className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                    title="Xóa">🗑️</button>
                </div>
              </td>
            )}
          </tr>,
          isEditingThis && (
            <tr key={`edit-${k.kpi_id}`} className="bg-blue-50 border-t border-blue-200">
              <td colSpan={colSpan} className="px-4 py-3">
                <KpiEditForm
                  cap={cap} nhomList={nhomList} initial={editingKpi}
                  onSave={form => { onSave(form); setEditingKpi(null); }}
                  onCancel={() => setEditingKpi(null)}
                />
              </td>
            </tr>
          ),
        ];
      }),
    ];
  });
}

// ── Tab 1: Thư viện KPI ───────────────────────────────────────

function ThuVienKPI({ kpiList, nhomList, kpiLibrary, nhomLibrary, persistKpi, persistNhom, persistKpiLibrary, persistNhomLibrary }) {
  const [cap, setCap]                 = useState('ca_nhan');
  const [search, setSearch]           = useState('');
  const [addingKpi, setAddingKpi]           = useState(false);
  const [addingNhom, setAddingNhom]         = useState(false);
  const [editingKpi, setEditingKpi]         = useState(null);
  const [editingNhom, setEditingNhom]       = useState(null);
  const [expandedCachTinh, setExpandedCachTinh] = useState(null);
  const [addingToTemplate, setAddingToTemplate] = useState(null);
  const [addingNhomToTemplate, setAddingNhomToTemplate] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importConfirm, setImportConfirm] = useState(null);
  const nhomFileRef = useRef(null);
  const kpiFileRef  = useRef(null);

  // Sort cho nhóm library: mặc định theo nhom_id A-Z
  const nhomSort = useSortConfig('nhom_id');
  // Sort cho KPI library: mặc định theo kpi_id A-Z
  const kpiSort  = useSortConfig('kpi_id');

  const nhomCatalog = useMemo(() =>
    getAllNhomCatalog()
      .filter(n => n.kpi_cap === cap)
      .filter(n => !search || n.ten_nhom.toLowerCase().includes(search.toLowerCase()) || n.nhom_id.toLowerCase().includes(search.toLowerCase())),
    [nhomLibrary, cap, search, nhomList] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const kpiCatalog = useMemo(() =>
    getAllKpiCatalog()
      .filter(k => k.kpi_cap === cap)
      .filter(k => !search || k.ten_kpi.toLowerCase().includes(search.toLowerCase()) || k.kpi_id.toLowerCase().includes(search.toLowerCase())),
    [kpiLibrary, kpiList, cap, search] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const nhomSorted = nhomSort.sortItems(nhomCatalog);
  const kpiSorted  = kpiSort.sortItems(kpiCatalog);

  const capChange = c => {
    setCap(c); setAddingKpi(false); setAddingNhom(false); setEditingKpi(null); setEditingNhom(null); setSearch(''); setImportMsg('');
  };

  const handleImportNhom = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    parseImportNhomKpi(file, entries => {
      const lib = getNhomLibrary();
      const toUpdate = [];
      const toAdd    = [];
      entries.forEach(({ ten_nhom, nhom_id_ref }) => {
        const existing = nhom_id_ref
          ? lib.find(n => n.nhom_id === nhom_id_ref && n.kpi_cap === cap)
          : null;
        if (existing) {
          if (normStr(existing.ten_nhom) !== normStr(ten_nhom))
            toUpdate.push({ nhom_id: existing.nhom_id, ten_nhom_cu: existing.ten_nhom, ten_nhom_moi: ten_nhom });
        } else {
          toAdd.push(ten_nhom);
        }
      });

      const previewLines = toUpdate.slice(0, 10).map(u => `• [${u.nhom_id}] "${u.ten_nhom_cu}" → "${u.ten_nhom_moi}"`);
      if (toUpdate.length > 10) previewLines.push(`... và ${toUpdate.length - 10} nhóm khác`);

      const capLabel = cap === 'ca_nhan' ? 'Cá nhân' : 'Phòng';

      const executeImport = (doUpdates) => {
        let updatedLib = [...lib];
        let updateCount = 0;
        if (doUpdates) {
          toUpdate.forEach(u => {
            const idx = updatedLib.findIndex(n => n.nhom_id === u.nhom_id);
            if (idx >= 0) { updatedLib[idx] = { ...updatedLib[idx], ten_nhom: u.ten_nhom_moi }; updateCount++; }
          });
          saveNhomLibrary(updatedLib);
        }
        let newCount = 0;
        toAdd.forEach(ten_nhom => {
          addNhomToLibrary({ nhom_id: generateNhomId(cap), ten_nhom, kpi_cap: cap, archived_at: null });
          newCount++;
        });
        persistNhomLibrary(getNhomLibrary());
        const parts = [];
        if (updateCount > 0) parts.push(`cập nhật ${updateCount} nhóm`);
        if (newCount > 0)    parts.push(`thêm mới ${newCount} nhóm`);
        setImportMsg(parts.length ? `✓ ${parts.join(', ')}` : '✓ Không có thay đổi');
        setTimeout(() => setImportMsg(''), 6000);
        setImportConfirm(null);
      };

      setImportConfirm({
        title: `Xác nhận nhập Nhóm KPI ${capLabel} từ Excel`,
        loaiDuLieu: `Thư viện nhóm KPI ${capLabel}`,
        bangSupabase: 'nhom_library',
        thang: null,
        themMoi: toAdd.length,
        capNhat: toUpdate.length,
        previewLines,
        warnings: toUpdate.length > 0 ? ['Đổi tên nhóm KPI ảnh hưởng đến hiển thị báo cáo'] : [],
        onConfirm: () => executeImport(true),
        onConfirmAddOnly: toUpdate.length > 0 ? () => executeImport(false) : null,
      });
    });
    e.target.value = '';
  };

  const handleImportKpi = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    parseImportKpiLib(file, entries => {
      const lib = getKpiLibrary();
      const toUpdate = [];
      const toAdd    = [];
      entries.forEach(entry => {
        const existing = entry.kpi_id_ref
          ? lib.find(k => k.kpi_id === entry.kpi_id_ref && k.kpi_cap === cap)
          : null;
        if (existing) {
          const changed = normStr(existing.ten_kpi) !== normStr(entry.ten_kpi) ||
                          normStr(existing.don_vi) !== normStr(entry.don_vi) ||
                          existing.upper_gt_lower !== entry.upper_gt_lower ||
                          normStr(existing.cach_tinh) !== normStr(entry.cach_tinh);
          if (changed) toUpdate.push({ existing, entry });
        } else {
          toAdd.push(entry);
        }
      });

      const previewLines = toUpdate.slice(0, 8).map(({ existing: ex, entry: en }) => {
        const diffs = [];
        if (normStr(ex.ten_kpi) !== normStr(en.ten_kpi)) diffs.push(`tên: "${ex.ten_kpi}" → "${en.ten_kpi}"`);
        if (normStr(ex.don_vi) !== normStr(en.don_vi))   diffs.push(`ĐVT: "${ex.don_vi}" → "${en.don_vi}"`);
        if (ex.upper_gt_lower !== en.upper_gt_lower)     diffs.push(`chiều KPI thay đổi`);
        if (normStr(ex.cach_tinh) !== normStr(en.cach_tinh)) diffs.push(`cách tính thay đổi`);
        return `• [${ex.kpi_id}] ${diffs.join('; ')}`;
      });
      if (toUpdate.length > 8) previewLines.push(`... và ${toUpdate.length - 8} KPI khác`);

      const capLabel = cap === 'ca_nhan' ? 'Cá nhân' : 'Phòng';

      const executeImport = (doUpdates) => {
        let updatedLib = [...lib];
        let updateCount = 0;
        if (doUpdates) {
          toUpdate.forEach(({ existing: ex, entry: en }) => {
            const idx = updatedLib.findIndex(k => k.kpi_id === ex.kpi_id);
            if (idx >= 0) {
              updatedLib[idx] = { ...updatedLib[idx], ten_kpi: en.ten_kpi, don_vi: en.don_vi,
                upper_gt_lower: en.upper_gt_lower, cach_tinh: en.cach_tinh };
              updateCount++;
            }
          });
          saveKpiLibrary(updatedLib);
          if (updateCount > 0) {
            const updatedIds = new Set(toUpdate.map(({ existing: ex }) => ex.kpi_id));
            const libMap = Object.fromEntries(updatedLib.map(k => [k.kpi_id, k]));
            persistKpi(kpiList.map(k => updatedIds.has(k.kpi_id) ? { ...k, ...libMap[k.kpi_id] } : k));
          }
        }
        let newCount = 0;
        toAdd.forEach(entry => {
          addKpiToLibrary({ kpi_id: generateKpiId(cap), ten_kpi: entry.ten_kpi, don_vi: entry.don_vi,
            kpi_cap: cap, upper_gt_lower: entry.upper_gt_lower, cach_tinh: entry.cach_tinh, archived_at: null });
          newCount++;
        });
        persistKpiLibrary(getKpiLibrary());
        const parts = [];
        if (updateCount > 0) parts.push(`cập nhật ${updateCount} KPI`);
        if (newCount > 0)    parts.push(`thêm mới ${newCount} KPI`);
        setImportMsg(parts.length ? `✓ ${parts.join(', ')}` : '✓ Không có thay đổi');
        setTimeout(() => setImportMsg(''), 6000);
        setImportConfirm(null);
      };

      setImportConfirm({
        title: `Xác nhận nhập KPI ${capLabel} từ Excel`,
        loaiDuLieu: `Thư viện KPI ${capLabel}`,
        bangSupabase: 'kpi_library',
        thang: null,
        themMoi: toAdd.length,
        capNhat: toUpdate.length,
        previewLines,
        warnings: toUpdate.length > 0 ? ['Thay đổi thông tin KPI ảnh hưởng đến hiển thị báo cáo và template'] : [],
        onConfirm: () => executeImport(true),
        onConfirmAddOnly: toUpdate.length > 0 ? () => executeImport(false) : null,
      });
    });
    e.target.value = '';
  };

  // ── Nhóm handlers ──
  const saveNewNhom = form => {
    addNhomToLibrary(form);
    persistNhomLibrary(getNhomLibrary());
    setAddingNhom(false);
  };

  const handleNhomEdit = form => {
    const lib = getNhomLibrary();
    const idx = lib.findIndex(n => n.nhom_id === form.nhom_id);
    if (idx >= 0) lib[idx] = { ...lib[idx], ten_nhom: form.ten_nhom };
    persistNhomLibrary(lib);
    setEditingNhom(null);
  };

  const handleNhomDelete = (nhom_id, ten_nhom) => {
    const catalog = getAllNhomCatalog();
    const item = catalog.find(n => n.nhom_id === nhom_id);
    if (item?.inTemplate) return alert('Không thể xóa — nhóm đang dùng trong template.');
    if (item?.usedInMonths?.length > 0) return alert(`Không thể xóa — nhóm đã dùng ở ${item.usedInMonths.length} tháng.`);
    if (!confirm(`Xóa vĩnh viễn nhóm "${ten_nhom}"?`)) return;
    deleteNhomPermanently(nhom_id);
    persistNhomLibrary(getNhomLibrary());
  };

  const handleNhomAddToTemplate = () => setAddingNhomToTemplate(true);

  // ── KPI handlers ──
  const saveNewKpi = form => {
    addKpiToLibrary(form);
    persistKpiLibrary(getKpiLibrary());
    setAddingKpi(false);
  };

  const handleKpiEdit = form => {
    const fields = { ten_kpi: form.ten_kpi, don_vi: form.don_vi, upper_gt_lower: form.upper_gt_lower, cach_tinh: form.cach_tinh ?? '' };
    const lib = getKpiLibrary();
    const idx = lib.findIndex(k => k.kpi_id === form.kpi_id);
    if (idx >= 0) { lib[idx] = { ...lib[idx], ...fields }; persistKpiLibrary(lib); }
    // Cập nhật tên trong kpiList (resolved, nếu inTemplate)
    if (form.inTemplate) persistKpi(kpiList.map(k => k.kpi_id === form.kpi_id ? { ...k, ...fields } : k));
    setEditingKpi(null);
  };

  const permanentDeleteKpi = (kpi_id, ten_kpi) => {
    if (!confirm(`Xóa vĩnh viễn "${ten_kpi}"? Không thể hoàn tác.`)) return;
    deleteKpiPermanently(kpi_id);
    persistKpiLibrary(getKpiLibrary());
  };

  const handleKpiAddToTemplate = kpiDatas => {
    let updated = kpiList;
    kpiDatas.forEach(kpiData => {
      const { archived, inTemplate, usedInMonths, archived_at, ...clean } = kpiData;
      updated = insertKpiAtStt(updated.filter(k => k.kpi_id !== clean.kpi_id), clean);
    });
    persistKpi(updated);
    setAddingToTemplate(null);
  };

  return (
    <div className="space-y-5">
      <InfoBox icon="📚" title="Thư viện KPI" color="blue"
        desc={<>danh sách gốc toàn bộ các nhóm KPI và tên KPI. Tạo và chỉnh sửa thông số gốc ở đây, sau đó thêm vào <strong>Tạo template KPI</strong>.</>} />

      <div className="flex gap-2 items-center flex-wrap">
        <SubTabs cap={cap} onChange={capChange} />
        <div className="relative flex-1 min-w-44">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
          <input className="input pl-8" placeholder="Tìm tên nhóm hoặc tên KPI..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* ── Bảng Thư viện Nhóm KPI ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-sm text-slate-700">
            📁 Thư viện Nhóm KPI {CAP_ICON[cap]}
            <span className="text-slate-400 font-normal ml-1">({nhomCatalog.length} nhóm)</span>
          </h3>
          <div className="flex gap-2 flex-wrap items-center">
            {importMsg && <span className="text-xs text-green-600 font-medium">{importMsg}</span>}
            <button className="btn-secondary text-sm" onClick={() => exportNhomKpiTemplate(nhomSorted, cap)}>
              📥 Xuất template Excel
            </button>
            <button className="btn-secondary text-sm" onClick={() => nhomFileRef.current?.click()}>
              📤 Nhập từ Excel
            </button>
            <input type="file" ref={nhomFileRef} accept=".xlsx,.xls" className="hidden" onChange={handleImportNhom} />
            {!addingNhom && (
              <button onClick={() => { setAddingNhom(true); setAddingKpi(false); setImportMsg(''); }} className="btn-primary text-sm">
                + Thêm Nhóm mới
              </button>
            )}
          </div>
        </div>

        {addingNhom && <NhomCreateForm cap={cap} onSave={saveNewNhom} onCancel={() => setAddingNhom(false)} />}

        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-blue-50 border-b border-blue-100">
                <tr>
                  <th onClick={() => nhomSort.handleSort('ten_nhom')} className={nhomSort.thCls('ten_nhom')}>Tên nhóm KPI{nhomSort.sortIcon('ten_nhom')}</th>
                  <th onClick={() => nhomSort.handleSort('nhom_id')} className={`${nhomSort.thCls('nhom_id')} hidden sm:table-cell`}>Mã nhóm{nhomSort.sortIcon('nhom_id')}</th>
                  <th className="th w-36 hidden md:table-cell">Dùng ở tháng</th>
                  <th className="th w-28 text-center hidden sm:table-cell">Trạng thái</th>
                  <th className="th w-36 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {nhomSorted.length === 0 ? (
                  <tr><td colSpan={5} className="td text-center text-slate-400 py-8">Chưa có nhóm nào</td></tr>
                ) : nhomSorted.map(item => {
                  const isEditing = editingNhom?.nhom_id === item.nhom_id;
                  const canDelete = !item.inTemplate && item.usedInMonths.length === 0;
                  return [
                    <tr key={item.nhom_id} className={`border-t border-slate-100 hover:bg-slate-50 ${isEditing ? 'bg-green-50' : ''}`}>
                      <td className="td font-medium text-slate-900">
                        {item.ten_nhom}
                        <span className="block text-[10px] font-mono text-green-600 sm:hidden">{item.nhom_id}</span>
                      </td>
                      <td className="td font-mono text-green-700 hidden sm:table-cell">{item.nhom_id}</td>
                      <td className="td hidden md:table-cell">
                        {item.usedInMonths.length > 0
                          ? <span className="whitespace-pre-line text-slate-600">{formatUsedMonths(item.usedInMonths)}</span>
                          : <span className="text-slate-400 italic">Chưa dùng</span>}
                      </td>
                      <td className="td text-center hidden sm:table-cell">
                        {item.inTemplate
                          ? <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">Trong template</span>
                          : item.archived
                          ? <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs">Lưu trữ</span>
                          : <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs">Thư viện</span>}
                      </td>
                      <td className="td text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setEditingNhom(isEditing ? null : item)}
                            className={`p-1.5 rounded-lg transition-colors ${isEditing ? 'text-blue-600 bg-blue-100' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                            title="Chỉnh sửa">✏️</button>
                          {!item.inTemplate && !item.archived && (
                            <button onClick={handleNhomAddToTemplate}
                              className="px-1.5 py-0.5 rounded-md text-[11px] font-semibold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200"
                              title="Thêm vào template">+T</button>
                          )}
                          {canDelete ? (
                            <button onClick={() => handleNhomDelete(item.nhom_id, item.ten_nhom)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Xóa vĩnh viễn">🗑️</button>
                          ) : (
                            <span className="p-1.5 text-slate-300 cursor-not-allowed" title={item.inTemplate ? 'Đang trong template' : 'Đã dùng trong tháng'}>🔒</span>
                          )}
                        </div>
                      </td>
                    </tr>,
                    isEditing && (
                      <tr key={`nedit-${item.nhom_id}`} className="bg-green-50 border-t border-green-200">
                        <td colSpan={5} className="px-4 py-3">
                          <NhomLibraryEditForm initial={editingNhom} onSave={handleNhomEdit} onCancel={() => setEditingNhom(null)} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Bảng Thư viện KPI ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-sm text-slate-700">
            📋 Thư viện KPI {CAP_ICON[cap]}
            <span className="text-slate-400 font-normal ml-1">({kpiCatalog.length} KPI)</span>
          </h3>
          <div className="flex gap-2 flex-wrap items-center">
            <button className="btn-secondary text-sm" onClick={() => exportKpiLibTemplate(kpiSorted, cap)}>
              📥 Xuất template Excel
            </button>
            <button className="btn-secondary text-sm" onClick={() => kpiFileRef.current?.click()}>
              📤 Nhập từ Excel
            </button>
            <input type="file" ref={kpiFileRef} accept=".xlsx,.xls" className="hidden" onChange={handleImportKpi} />
            {!addingKpi && (
              <button onClick={() => { setAddingKpi(true); setAddingNhom(false); setImportMsg(''); }} className="btn-primary text-sm">
                + Thêm KPI mới
              </button>
            )}
          </div>
        </div>

        {addingKpi && <KpiCreateForm cap={cap} onSave={saveNewKpi} onCancel={() => setAddingKpi(false)} />}

        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-blue-50 border-b border-blue-100">
                <tr>
                  <th onClick={() => kpiSort.handleSort('ten_kpi')} className={kpiSort.thCls('ten_kpi')}>Tên KPI{kpiSort.sortIcon('ten_kpi')}</th>
                  <th onClick={() => kpiSort.handleSort('kpi_id')} className={`${kpiSort.thCls('kpi_id')} hidden sm:table-cell`}>Mã KPI{kpiSort.sortIcon('kpi_id')}</th>
                  <th className="th w-16 hidden sm:table-cell">ĐVT</th>
                  <th onClick={() => kpiSort.handleSort('upper_gt_lower')} className={`${kpiSort.thCls('upper_gt_lower')} hidden lg:table-cell`}>Chiều KPI{kpiSort.sortIcon('upper_gt_lower')}</th>
                  <th className="th w-36 hidden md:table-cell">Dùng ở tháng</th>
                  <th className="th w-28 text-center hidden md:table-cell">Trạng thái</th>
                  <th className="th w-20 text-center hidden sm:table-cell">Cách tính</th>
                  <th className="th w-36 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {kpiSorted.length === 0 ? (
                  <tr><td colSpan={8} className="td text-center text-slate-400 py-8">Chưa có KPI nào trong thư viện</td></tr>
                ) : kpiSorted.map(item => {
                  const isEditing    = editingKpi?.kpi_id === item.kpi_id;
                  const isExpanded   = expandedCachTinh === item.kpi_id && !isEditing;
                  const canDelete    = !item.inTemplate && item.usedInMonths.length === 0;
                  const monthStr     = formatUsedMonths(item.usedInMonths);
                  const hasCachTinh  = !!item.cach_tinh?.trim();
                  return [
                    <tr key={item.kpi_id} className={`border-t border-slate-100 hover:bg-slate-50 ${isEditing ? 'bg-blue-50' : isExpanded ? 'bg-amber-50' : ''}`}>
                      <td className="td font-medium text-slate-900">
                        {item.ten_kpi}
                        <span className="block text-[10px] font-mono text-blue-600 sm:hidden">{item.kpi_id} · {item.don_vi}</span>
                      </td>
                      <td className="td font-mono text-blue-700 hidden sm:table-cell">{item.kpi_id}</td>
                      <td className="td text-slate-500 hidden sm:table-cell">{item.don_vi}</td>
                      <td className="td text-slate-600 hidden lg:table-cell">{item.upper_gt_lower ? '↑ Cao hơn tốt hơn' : '↓ Thấp hơn tốt hơn'}</td>
                      <td className="td hidden md:table-cell">
                        {monthStr
                          ? <span className="whitespace-pre-line text-slate-600 leading-relaxed">{monthStr}</span>
                          : <span className="text-slate-400 italic">Chưa dùng</span>}
                      </td>
                      <td className="td text-center hidden md:table-cell">
                        {item.inTemplate
                          ? <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">Trong template</span>
                          : item.archived
                          ? <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs">Lưu trữ</span>
                          : <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs">Thư viện</span>}
                      </td>
                      <td className="td text-center hidden sm:table-cell">
                        {hasCachTinh ? (
                          <button
                            className={`text-xs px-2 py-0.5 rounded border transition-colors ${isExpanded ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-slate-50 text-blue-600 border-blue-200 hover:bg-blue-50'}`}
                            onClick={() => setExpandedCachTinh(isExpanded ? null : item.kpi_id)}>
                            {isExpanded ? '▲ Thu' : '▼ Xem'}
                          </button>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="td text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => { setEditingKpi(isEditing ? null : item); setAddingKpi(false); setExpandedCachTinh(null); }}
                            className={`p-1.5 rounded-lg transition-colors ${isEditing ? 'text-blue-600 bg-blue-100' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                            title="Chỉnh sửa">✏️</button>
                          {!item.inTemplate && !item.archived && (
                            <button onClick={() => { setAddingToTemplate(item); setAddingKpi(false); setEditingKpi(null); }}
                              className="px-1.5 py-0.5 rounded-md text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200"
                              title="Thêm vào template">+T</button>
                          )}
                          {canDelete ? (
                            <button onClick={() => permanentDeleteKpi(item.kpi_id, item.ten_kpi)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Xóa vĩnh viễn">🗑️</button>
                          ) : (
                            <span className="p-1.5 text-slate-300 cursor-not-allowed" title={item.inTemplate ? 'Đang trong template' : 'Đã dùng trong tháng'}>🔒</span>
                          )}
                        </div>
                      </td>
                    </tr>,
                    isExpanded && (
                      <tr key={`ct-${item.kpi_id}`} className="bg-amber-50 border-t border-amber-200">
                        <td colSpan={8} className="px-4 py-3">
                          <p className="text-xs font-medium text-amber-800 mb-1">Cách tính: <span className="font-normal text-slate-700">{item.ten_kpi}</span></p>
                          <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{item.cach_tinh}</p>
                        </td>
                      </tr>
                    ),
                    isEditing && (
                      <tr key={`kedit-${item.kpi_id}`} className="bg-blue-50 border-t border-blue-200">
                        <td colSpan={8} className="px-4 py-3">
                          <KpiLibraryEditForm
                            initial={{ ...editingKpi, inTemplate: item.inTemplate }}
                            onSave={handleKpiEdit}
                            onCancel={() => setEditingKpi(null)}
                          />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {addingNhomToTemplate && (
        <NhomPickerModal
          cap={cap} currentNhomList={nhomList}
          onAdd={nhoms => {
            let updated = nhomList;
            nhoms.forEach(nhom => { updated = insertNhomAtThuTu(updated.filter(n => n.nhom_id !== nhom.nhom_id), nhom); });
            persistNhom(updated);
            setAddingNhomToTemplate(null);
          }}
          onClose={() => setAddingNhomToTemplate(null)}
        />
      )}

      {addingToTemplate && (
        <LibraryPickerModal
          cap={cap} currentList={kpiList} nhomList={nhomList}
          preSelected={addingToTemplate}
          onAdd={handleKpiAddToTemplate}
          onClose={() => setAddingToTemplate(null)}
        />
      )}

      {importConfirm && (
        <ImportConfirmModal
          open={true}
          onClose={() => setImportConfirm(null)}
          onConfirm={importConfirm.onConfirm}
          onConfirmAddOnly={importConfirm.onConfirmAddOnly}
          title={importConfirm.title}
          loaiDuLieu={importConfirm.loaiDuLieu}
          bangSupabase={importConfirm.bangSupabase}
          thang={importConfirm.thang}
          themMoi={importConfirm.themMoi}
          capNhat={importConfirm.capNhat}
          previewLines={importConfirm.previewLines}
          warnings={importConfirm.warnings}
        />
      )}
    </div>
  );
}

// ── BulkDeleteModal — dùng chung cho Xóa Nhóm và Xóa KPI ─────

function BulkDeleteModal({ title, items, labelKey, onConfirm, onClose }) {
  const [selected, setSelected] = useState(new Set());
  const toggle   = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(s => s.size === items.length ? new Set() : new Set(items.map(x => x.id)));
  const allSelected = selected.size === items.length && items.length > 0;

  const handleConfirm = () => {
    if (!selected.size) return;
    const names = items.filter(x => selected.has(x.id)).map(x => x[labelKey] || x.id).join(', ');
    if (!confirm(`Xóa ${selected.size} mục: ${names}?\n\nHành động này không thể hoàn tác.`)) return;
    onConfirm([...selected]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-bold text-base text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-2 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Chọn tất cả ({items.length})
          </label>
          {items.map(item => (
            <label key={item.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5">
              <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
              <span>{item.label || item[labelKey] || item.id}</span>
            </label>
          ))}
          {!items.length && <p className="text-slate-400 text-sm text-center py-4">Không có mục nào</p>}
        </div>
        <div className="px-5 py-4 border-t flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary text-sm">Hủy</button>
          <button onClick={handleConfirm} disabled={!selected.size} className="btn-danger text-sm disabled:opacity-40">
            🗑️ Xóa {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab 2: Tạo template KPI ───────────────────────────────────

function TaoTemplate({ kpiList, nhomList, persistKpi, persistNhom }) {
  const [cap, setCap]             = useState('ca_nhan');
  const [search, setSearch]       = useState('');
  const [filterNhom, setFilterNhom] = useState('');
  const [editing, setEditing]     = useState(null);
  const [editingNhom, setEditingNhom] = useState(null); // { nhom_id, ten_nhom, thu_tu }
  const [showPickKpi, setShowPickKpi]     = useState(false);
  const [showPickNhom, setShowPickNhom]   = useState(false);
  const [showDelNhom, setShowDelNhom]     = useState(false);
  const [showDelKpi,  setShowDelKpi]      = useState(false);
  const [showCopyThang, setShowCopyThang] = useState(false);

  // State cho "Copy từ tháng"
  const snapList = getSnapshotThangList();
  const srcYears = [...new Set(snapList.map(t => parseInt(t.split('-')[0])))].sort((a, b) => b - a);
  const defaultSrcYear = srcYears[0] || new Date().getFullYear();
  const [copyYear, setCopyYear]   = useState(defaultSrcYear);
  const srcMonthsForYear = snapList
    .filter(t => parseInt(t.split('-')[0]) === copyYear)
    .map(t => parseInt(t.split('-')[1]))
    .sort((a, b) => b - a);
  const [copyMonth, setCopyMonth] = useState(srcMonthsForYear[0] || 1);

  const handleCopyYearChange = y => {
    setCopyYear(y);
    const months = snapList
      .filter(t => parseInt(t.split('-')[0]) === y)
      .map(t => parseInt(t.split('-')[1]))
      .sort((a, b) => b - a);
    setCopyMonth(months[0] || 1);
  };

  const handleCopyFromThang = () => {
    const thang = `${copyYear}-${String(copyMonth).padStart(2, '0')}`;
    const src = getKpiSnapshot(thang);
    if (!src) return alert(`Tháng ${copyMonth}/${copyYear} chưa có KPI snapshot`);
    if (!confirm(`Sao chép toàn bộ danh sách KPI và nhóm từ tháng ${copyMonth}/${copyYear} vào template?\nTemplate hiện tại sẽ bị thay thế.`)) return;
    persistKpi(src.kpiList || []);
    persistNhom(src.nhomList || []);
    setShowCopyThang(false);
  };

  const { handleSort, sortIcon, thCls, sortItems } = useSortConfig('stt');

  const nhomOptions = useMemo(() =>
    nhomList.filter(n => n.kpi_cap === cap)
      .sort((a,b) => ROMAN_OPTIONS.indexOf(a.thu_tu) - ROMAN_OPTIONS.indexOf(b.thu_tu)),
    [nhomList, cap]
  );
  const nhomMap = useMemo(() => Object.fromEntries(nhomList.map(n => [n.nhom_id, n])), [nhomList]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return kpiList
      .filter(k => k.kpi_cap === cap)
      .filter(k => !filterNhom || k.nhom_id === filterNhom)
      .filter(k => !q || k.ten_kpi?.toLowerCase().includes(q) || k.kpi_id.toLowerCase().includes(q));
  }, [kpiList, cap, filterNhom, search]);

  const handleSaveEdit = form => {
    persistKpi(insertKpiAtStt(kpiList.filter(k => k.kpi_id !== form.kpi_id), form));
  };

  const deleteKpi = kpi_id => {
    const kpi = kpiList.find(k => k.kpi_id === kpi_id);
    if (!kpi) return;
    if (!confirm(`Xóa "${kpi.ten_kpi}" khỏi template? KPI vẫn giữ trong thư viện.`)) return;
    archiveKpi(kpi);
    persistKpi(removeAndRenumber(kpiList, kpi_id));
  };

  const handlePickNhom = nhoms => {
    let updated = nhomList;
    nhoms.forEach(nhom => { updated = insertNhomAtThuTu(updated.filter(n => n.nhom_id !== nhom.nhom_id), nhom); });
    persistNhom(updated);
    setShowPickNhom(false);
  };

  const removeNhom = nhom_id => {
    const nhom = nhomList.find(n => n.nhom_id === nhom_id);
    if (!nhom) return;
    const hasKpi = kpiList.some(k => k.kpi_cap === cap && k.nhom_id === nhom_id);
    if (hasKpi && !confirm(`Nhóm "${nhom.ten_nhom}" còn KPI. Xóa nhóm? Các KPI sẽ mất liên kết nhóm.`)) return;
    persistNhom(nhomList.filter(n => n.nhom_id !== nhom_id));
    if (editingNhom?.nhom_id === nhom_id) setEditingNhom(null);
  };

  const handleSaveNhomEdit = () => {
    if (!editingNhom) return;
    const name = editingNhom.ten_nhom.trim();
    if (!name) return;
    persistNhom(applyNhomEdit(nhomList, { ...editingNhom, ten_nhom: name }));
    setEditingNhom(null);
  };

  const nhomListCap = nhomOptions;
  const capChange = c => { setCap(c); setFilterNhom(''); setSearch(''); setEditing(null); setEditingNhom(null); };

  return (
    <div className="space-y-4">
      <InfoBox icon="📋" title="Tạo template KPI" color="teal"
        desc={<>bộ KPI mặc định dùng khi tạo tháng mới. Thêm Nhóm và KPI từ thư viện, chỉnh STT tại đây.</>} />

      <div className="flex gap-2 items-center flex-wrap">
        <SubTabs cap={cap} onChange={capChange} />
        <div className="relative flex-1 min-w-44">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
          <input className="input pl-8" placeholder="Tìm tên KPI..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-44 text-sm" value={filterNhom} onChange={e => setFilterNhom(e.target.value)}>
          <option value="">Tất cả nhóm</option>
          {nhomOptions.map(n => <option key={n.nhom_id} value={n.nhom_id}>{n.thu_tu}. {n.ten_nhom}</option>)}
        </select>
        <span className="text-xs text-slate-400 whitespace-nowrap">{filtered.length} KPI</span>
      </div>

      {/* Nhóm hiện có trong template */}
      {nhomListCap.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-slate-600">Nhóm trong template:</p>
          <div className="flex flex-wrap gap-2">
            {nhomListCap.map(n => (
              <div key={n.nhom_id} className={`flex items-center gap-1 bg-white border rounded-lg px-2 py-1 text-xs ${editingNhom?.nhom_id === n.nhom_id ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'}`}>
                <span className="font-bold text-blue-700">{n.thu_tu}.</span>
                <span>{n.ten_nhom}</span>
                <button onClick={() => setEditingNhom(editingNhom?.nhom_id === n.nhom_id ? null : { nhom_id: n.nhom_id, ten_nhom: n.ten_nhom, thu_tu: n.thu_tu, kpi_cap: n.kpi_cap })}
                  className="text-slate-300 hover:text-blue-500 ml-1" title="Chỉnh sửa">✏️</button>
                <button onClick={() => removeNhom(n.nhom_id)} className="text-slate-300 hover:text-red-500" title="Xóa">✕</button>
              </div>
            ))}
          </div>
          {editingNhom && nhomListCap.some(n => n.nhom_id === editingNhom.nhom_id) && (
            <div className="flex gap-2 items-end flex-wrap bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mt-1">
              <div>
                <label className="block text-xs text-slate-500 mb-0.5">STT La Mã</label>
                <select autoFocus className="input text-xs py-0.5 w-20" value={editingNhom.thu_tu}
                  onChange={e => setEditingNhom(prev => ({ ...prev, thu_tu: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveNhomEdit(); if (e.key === 'Escape') setEditingNhom(null); }}>
                  {ROMAN_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <p className="text-xs text-slate-500 self-center">
                Tên nhóm: <span className="font-medium text-slate-700">{editingNhom.ten_nhom}</span>
                <span className="ml-1 text-slate-400">(sửa tên trong Thư viện KPI)</span>
              </p>
              <button className="btn-primary text-xs" onClick={handleSaveNhomEdit}>💾 Lưu</button>
              <button className="btn-secondary text-xs" onClick={() => setEditingNhom(null)}>Hủy</button>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setShowPickNhom(true)} className="btn-secondary text-sm">+ Thêm Nhóm từ thư viện</button>
        <button onClick={() => setShowPickKpi(true)} className="btn-primary text-sm">+ Thêm KPI từ thư viện</button>
        <button onClick={() => setShowDelNhom(true)} className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">🗑️ Xóa Nhóm</button>
        <button onClick={() => setShowDelKpi(true)}  className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">🗑️ Xóa KPI</button>
        <button
          onClick={() => setShowCopyThang(v => !v)}
          disabled={snapList.length === 0}
          className="btn-secondary text-sm disabled:opacity-40 disabled:pointer-events-none">
          📅 Copy từ tháng
        </button>
      </div>

      {showCopyThang && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 space-y-3">
          <p className="text-sm font-semibold text-indigo-900">Sao chép KPI từ tháng</p>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Năm</label>
              <select className="input w-24 text-sm" value={copyYear} onChange={e => handleCopyYearChange(parseInt(e.target.value))}>
                {srcYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Tháng</label>
              <select className="input w-28 text-sm" value={copyMonth} onChange={e => setCopyMonth(parseInt(e.target.value))}>
                {srcMonthsForYear.map(m => <option key={m} value={m}>Tháng {m}</option>)}
              </select>
            </div>
            <button className="btn-primary text-sm" onClick={handleCopyFromThang}>Sao chép</button>
            <button className="btn-secondary text-sm" onClick={() => setShowCopyThang(false)}>Hủy</button>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-blue-50 border-b border-blue-100">
              <tr>
                <th onClick={() => handleSort('stt')} className={thCls('stt')}>STT{sortIcon('stt')}</th>
                <th onClick={() => handleSort('ten_kpi')} className={thCls('ten_kpi')}>Tên KPI{sortIcon('ten_kpi')}</th>
                <th className="th w-14">ĐVT</th>
                <th onClick={() => handleSort('upper_gt_lower')} className={thCls('upper_gt_lower')}>Chiều KPI{sortIcon('upper_gt_lower')}</th>
                <th className="th w-20 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <KpiGroupTable
                list={sortItems(filtered)} nhomMap={nhomMap} cap={cap} nhomList={nhomList}
                editingKpi={editing} setEditingKpi={setEditing}
                onSave={handleSaveEdit} onDelete={deleteKpi} colSpan={5}
              />
            </tbody>
          </table>
        </div>
      </div>

      {showPickNhom && (
        <NhomPickerModal cap={cap} currentNhomList={nhomList} onAdd={handlePickNhom} onClose={() => setShowPickNhom(false)} />
      )}
      {showPickKpi && (
        <LibraryPickerModal
          cap={cap} currentList={kpiList} nhomList={nhomList}
          onAdd={kpiDatas => {
            let updated = kpiList;
            kpiDatas.forEach(kpiData => {
              const { archived, inTemplate, usedInMonths, archived_at, ...clean } = kpiData;
              updated = insertKpiAtStt(updated.filter(k => k.kpi_id !== clean.kpi_id), clean);
            });
            persistKpi(updated);
            setShowPickKpi(false);
          }}
          onClose={() => setShowPickKpi(false)}
        />
      )}
      {showDelNhom && (
        <BulkDeleteModal
          title="Xóa Nhóm KPI khỏi template"
          items={nhomOptions.map(n => ({ id: n.nhom_id, label: `${n.thu_tu}. ${n.ten_nhom}` }))}
          labelKey="label"
          onConfirm={ids => persistNhom(nhomList.filter(n => !ids.includes(n.nhom_id)))}
          onClose={() => setShowDelNhom(false)}
        />
      )}
      {showDelKpi && (
        <BulkDeleteModal
          title="Xóa KPI khỏi template"
          items={kpiList.filter(k => k.kpi_cap === cap).sort((a,b) => a.stt - b.stt).map(k => ({ id: k.kpi_id, label: `${k.stt}. ${k.ten_kpi}` }))}
          labelKey="label"
          onConfirm={ids => persistKpi(renumberStt(kpiList.filter(k => !ids.includes(k.kpi_id))))}
          onClose={() => setShowDelKpi(false)}
        />
      )}
    </div>
  );
}

// ── Tab 3: KPI theo tháng ─────────────────────────────────────

function TheoThang({ kpiList, nhomList }) {
  const [snapList, setSnapList]     = useState(getSnapshotThangList);
  const [thang, setThang]           = useState(() => defaultThang(getSnapshotThangList()));
  const [capTab, setCapTab]         = useState('ca_nhan');
  const [search, setSearch]         = useState('');
  const [filterNhom, setFilterNhom] = useState('');
  const [showAddMonth, setShowAddMonth] = useState(false);
  const [newYear,  setNewYear]      = useState(new Date().getFullYear());
  const [newMonth, setNewMonth]     = useState(new Date().getMonth() + 1);
  const [mode, setMode]             = useState('copy');
  const [copyThang, setCopyThang]   = useState(() => defaultThang(getSnapshotThangList()));
  const [addMsg, setAddMsg]         = useState('');
  const [editMode, setEditMode]     = useState(false);
  const [editedKpiList, setEditedKpiList] = useState([]);
  const [editedNhomList, setEditedNhomList] = useState([]);
  const [editingKpi, setEditingKpi] = useState(null);
  const [editingNhom, setEditingNhom] = useState(null); // { nhom_id, ten_nhom, thu_tu, kpi_cap }
  const [showPickKpi, setShowPickKpi]   = useState(false);
  const [showPickNhom, setShowPickNhom] = useState(false);
  const [showDelNhom, setShowDelNhom]   = useState(false);
  const [showDelKpi,  setShowDelKpi]    = useState(false);

  useEffect(() => {
    if (editMode) {
      setNavGuard('KPI tháng đang có thay đổi chưa lưu.\nThoát trang sẽ mất các thay đổi. Tiếp tục không?');
    } else {
      clearNavGuard();
    }
    return () => clearNavGuard();
  }, [editMode]);

  const { handleSort, sortIcon, thCls, sortItems } = useSortConfig('stt');

  const snapshot    = thang ? getKpiSnapshot(thang) : null;
  const hasResults  = thang ? getOutputDiemByThang(thang).length > 0 : false;
  const editable    = true;

  const snapNhomList = useMemo(() => editMode ? editedNhomList : (snapshot?.nhomList || nhomList), [snapshot, nhomList, editMode, editedNhomList]);
  const snapNhomMap  = useMemo(() => Object.fromEntries(snapNhomList.map(n => [n.nhom_id, n])), [snapNhomList]);

  const nhomOptions = useMemo(() =>
    snapNhomList.filter(n => n.kpi_cap === capTab)
      .sort((a,b) => ROMAN_OPTIONS.indexOf(a.thu_tu) - ROMAN_OPTIONS.indexOf(b.thu_tu)),
    [snapNhomList, capTab]
  );

  const addMonth = async () => {
    const thangNew = `${newYear}-${String(newMonth).padStart(2, '0')}`;
    if (getKpiSnapshot(thangNew)) return alert('Tháng này đã được tạo');
    if (!getNvSnapshot(thangNew)) return alert(`Tháng ${thangNew.replace('-', '/')} chưa có danh sách nhân viên.\nVui lòng tạo danh sách NV trong "Danh sách nhân viên → NV theo tháng" trước.`);

    let snapKpiList, snapNhomListNew;
    if (mode === 'copy') {
      snapKpiList    = kpiList;
      snapNhomListNew = nhomList;
    } else if (mode === 'copy_thang') {
      const srcSnap  = getKpiSnapshot(copyThang);
      if (!srcSnap) return alert(`Tháng ${copyThang} chưa có dữ liệu KPI để copy`);
      snapKpiList    = srcSnap.kpiList || [];
      snapNhomListNew = srcSnap.nhomList || [];
    } else {
      snapKpiList    = [];
      snapNhomListNew = [];
    }

    saveKpiSnapshot(thangNew, snapKpiList, snapNhomListNew);
    setSnapList(getSnapshotThangList()); setThang(thangNew); setShowAddMonth(false); setAddMsg('');

    if (isConnected()) {
      setAddMsg('⏳ Đang tạo dữ liệu tháng trên Supabase...');
      try {
        const nvList = getNvListForThang(thangNew);
        const res = await createMonthTemplate(thangNew, snapKpiList, nvList);
        setAddMsg(`✅ Đã tạo dữ liệu tháng "${res.sheetName || thangNew}" trên Supabase.`);
      } catch (e) {
        setAddMsg(`⚠️ Tạo sheet thất bại: ${e.message}`);
      }
    }
  };

  const deleteMonth = async () => {
    if (!confirm(
      `Xóa tháng KPI ${thang.replace('-','/')}?\n\nDữ liệu sẽ bị xóa:\n• KPI snapshot tháng này\n• Cấu hình trọng số tháng này${isConnected() ? '\n• Dữ liệu tháng này trên Supabase sẽ bị xóa' : ''}\n\n(Danh sách NV tháng này không bị ảnh hưởng)\n\nHành động không thể hoàn tác.`
    )) return;
    deleteKpiSnapshot(thang);
    deleteTrongSoConfig(thang);
    unlockInputCN(thang);
    unlockInputPhong(thang);
    saveInputCN(getInputCN().filter(r => r.thang !== thang));
    saveOutputDiem(getOutputDiem().filter(r => r.thang !== thang));
    saveOutputCT(getOutputCT().filter(r => r.thang !== thang));
    // Xóa input_phong và output cache để tháng không reappear sau reload
    localStorage.removeItem('input_phong_' + thang);
    localStorage.removeItem('output_meta_' + thang);
    syncToSupabase('input_phong_' + thang, null);
    syncToSupabase('output_diem_' + thang, null);
    syncToSupabase('output_meta_' + thang, null);
    const nl = getSnapshotThangList(); setSnapList(nl); setThang(nl[0] || ''); setEditMode(false);
    if (isConnected()) {
      setAddMsg('⏳ Đang xóa dữ liệu...');
      try {
        await deleteMonthSheet(thang);
        setAddMsg(`✅ Đã xóa toàn bộ dữ liệu tháng ${thang}.`);
      } catch (e) {
        setAddMsg(`⚠️ Xóa Supabase thất bại: ${e.message}`);
      }
    }
  };

  const handleSaveNhomEdit = () => {
    if (!editingNhom) return;
    const name = editingNhom.ten_nhom.trim();
    if (!name) return;
    setEditedNhomList(prev => applyNhomEdit(prev, { ...editingNhom, ten_nhom: name }));
    setEditingNhom(null);
  };

  const startEdit = () => {
    setEditedKpiList((snapshot?.kpiList || []).map(k => ({ ...k })));
    setEditedNhomList((snapshot?.nhomList || []).map(n => ({ ...n })));
    setEditMode(true); setEditingKpi(null); setEditingNhom(null); setShowPickKpi(false); setShowPickNhom(false);
  };

  const saveEdit = async () => {
    const oldIds = new Set((snapshot?.kpiList || []).map(k => k.kpi_id));
    const newIds = new Set(editedKpiList.map(k => k.kpi_id));
    const addedKpis     = editedKpiList.filter(k => k.kpi_cap === 'ca_nhan' && !oldIds.has(k.kpi_id));
    const removedKpiIds = [...oldIds].filter(id => !newIds.has(id) && (snapshot?.kpiList || []).find(k => k.kpi_id === id)?.kpi_cap === 'ca_nhan');
    saveKpiSnapshot(thang, editedKpiList, editedNhomList);
    setEditMode(false); setEditingKpi(null); setEditingNhom(null); setShowPickKpi(false); setShowPickNhom(false);
    if (isConnected() && (addedKpis.length > 0 || removedKpiIds.length > 0)) {
      setAddMsg('⏳ Đang cập nhật Supabase...');
      try {
        const finalCN = editedKpiList.filter(k => k.kpi_cap === 'ca_nhan');
        await updateInputCNKpis(thang, addedKpis, removedKpiIds, finalCN);
        setAddMsg('✅ Đã cập nhật danh sách KPI trên sheet.');
      } catch (e) {
        setAddMsg(`⚠️ Không thể cập nhật sheet: ${e.message}`);
      }
    }
  };

  const handleSaveKpiEdit = form => {
    setEditedKpiList(prev => insertKpiAtStt(prev.filter(k => k.kpi_id !== form.kpi_id), form));
  };

  const handleRemoveKpi = kpi_id =>
    setEditedKpiList(prev => removeAndRenumber(prev, kpi_id));

  const handlePickNhom = nhoms => {
    setEditedNhomList(prev => {
      let updated = prev;
      nhoms.forEach(nhom => { updated = insertNhomAtThuTu(updated.filter(n => n.nhom_id !== nhom.nhom_id), nhom); });
      return updated;
    });
    setShowPickNhom(false);
  };

  const handleRemoveNhom = nhom_id => {
    setEditedNhomList(prev => prev.filter(n => n.nhom_id !== nhom_id));
    if (editingNhom?.nhom_id === nhom_id) setEditingNhom(null);
  };

  const handleAddKpiFromLib = kpiDatas => {
    setEditedKpiList(prev => {
      let updated = prev;
      kpiDatas.forEach(kpiData => {
        const { archived, inTemplate, usedInMonths, archived_at, ...clean } = kpiData;
        updated = insertKpiAtStt(updated, clean);
      });
      return updated;
    });
    setShowPickKpi(false);
  };

  const renderSection = () => {
    if (!snapshot) return null;
    const sourceList = editMode ? editedKpiList : snapshot.kpiList;
    const q = search.toLowerCase();
    const filtered = sourceList
      .filter(k => k.kpi_cap === capTab)
      .filter(k => !filterNhom || k.nhom_id === filterNhom)
      .filter(k => !q || k.ten_kpi?.toLowerCase().includes(q) || k.kpi_id.toLowerCase().includes(q));

    const colSpan = editMode ? 5 : 4;
    return (
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-blue-50 border-b border-blue-100">
              <tr>
                <th onClick={() => handleSort('stt')} className={thCls('stt')}>STT{sortIcon('stt')}</th>
                <th onClick={() => handleSort('ten_kpi')} className={thCls('ten_kpi')}>Tên KPI{sortIcon('ten_kpi')}</th>
                <th className="th w-14">ĐVT</th>
                <th onClick={() => handleSort('upper_gt_lower')} className={thCls('upper_gt_lower')}>Chiều KPI{sortIcon('upper_gt_lower')}</th>
                {editMode && <th className="th w-20 text-center">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              <KpiGroupTable
                list={sortItems(filtered)} nhomMap={snapNhomMap} cap={capTab}
                nhomList={snapNhomList}
                editingKpi={editingKpi} setEditingKpi={setEditingKpi}
                onSave={handleSaveKpiEdit}
                onDelete={editMode ? handleRemoveKpi : null}
                colSpan={colSpan}
              />
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="td text-center text-slate-400 py-8">
                    {editMode ? 'Chưa có KPI — thêm từ thư viện'
                      : search || filterNhom ? 'Không tìm thấy KPI phù hợp' : 'Không có KPI nào'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <InfoBox icon="📅" title="KPI theo tháng" color="purple"
        desc="xem và chỉnh sửa KPI cho từng tháng cụ thể. Mỗi tháng có danh sách KPI riêng." />

      <div className="flex items-center gap-2 flex-wrap">
        {snapList.length > 0 ? (
          <YearMonthPicker
            thangList={snapList}
            value={thang}
            onChange={t => { setThang(t); setEditMode(false); setEditingKpi(null); setShowPickKpi(false); setSearch(''); setFilterNhom(''); }}
          />
        ) : (
          <span className="text-sm text-slate-400 italic">Chưa có tháng nào</span>
        )}
        {snapList.length > 0 && thang && (
          <button onClick={deleteMonth}
            className="btn-secondary text-sm text-red-500 hover:text-red-700 border-red-200 hover:bg-red-50">
            🗑️ Xóa KPI tháng
          </button>
        )}
        <button onClick={() => setShowAddMonth(v => !v)} className="btn-secondary text-sm">
          + Thêm tháng mới
        </button>
      </div>

      {showAddMonth && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-4 space-y-3">
          <p className="text-sm font-semibold text-blue-900">Tạo tháng mới</p>
          <div className="flex items-center gap-3 flex-wrap">
            <select value={newYear} onChange={e => setNewYear(parseInt(e.target.value))} className="input w-24 text-sm">
              {Array.from({length:5},(_,i) => new Date().getFullYear()-2+i).map(y =>
                <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={newMonth} onChange={e => setNewMonth(parseInt(e.target.value))} className="input w-28 text-sm">
              {Array.from({length:12},(_,i) => i+1).map(m =>
                <option key={m} value={m}>Tháng {m}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="mode" value="copy" checked={mode==='copy'} onChange={() => setMode('copy')} />
              📋 Copy từ template hiện tại
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="mode" value="copy_thang" checked={mode==='copy_thang'} onChange={() => setMode('copy_thang')} />
              📅 Copy từ tháng khác
            </label>
            {mode === 'copy_thang' && snapList.length > 0 && (
              <div className="ml-6">
                <YearMonthPicker thangList={snapList} value={copyThang} onChange={setCopyThang} />
              </div>
            )}
            {mode === 'copy_thang' && snapList.length === 0 && (
              <p className="ml-6 text-xs text-yellow-700">Chưa có tháng nào để copy</p>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="mode" value="blank" checked={mode==='blank'} onChange={() => setMode('blank')} />
              📝 KPI trống hoàn toàn
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={addMonth} className="btn-primary text-sm">Tạo tháng</button>
            <button onClick={() => setShowAddMonth(false)} className="btn-secondary text-sm">Hủy</button>
          </div>
        </div>
      )}

      {addMsg && (
        <div className={`px-4 py-3 rounded-lg text-sm ${addMsg.startsWith('✅') ? 'bg-green-50 text-green-800' : addMsg.startsWith('⏳') ? 'bg-blue-50 text-blue-800' : 'bg-yellow-50 text-yellow-800'}`}>
          {addMsg}
        </div>
      )}

      {hasResults && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
          ℹ️ Tháng này đã có kết quả chấm điểm. Nếu chỉnh sửa danh sách KPI, hãy vào <strong>Nhập liệu KPI → Lưu &amp; Tính kết quả</strong> để cập nhật lại.
        </div>
      )}

      {snapshot && (
        <>
          {/* Toolbar: SubTabs + search + filter + nút chỉnh sửa / lưu-hủy */}
          <div className="flex gap-2 items-center flex-wrap">
            <SubTabs cap={capTab} onChange={c => {
              setCapTab(c); setEditingKpi(null); setEditingNhom(null); setShowPickKpi(false); setShowPickNhom(false); setFilterNhom('');
            }} />
            <div className="relative min-w-44 flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
              <input className="input pl-8" placeholder="Tìm tên KPI..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="input w-44 text-sm" value={filterNhom} onChange={e => setFilterNhom(e.target.value)}>
              <option value="">Tất cả nhóm</option>
              {nhomOptions.map(n => <option key={n.nhom_id} value={n.nhom_id}>{n.thu_tu}. {n.ten_nhom}</option>)}
            </select>
            {editable && !editMode && (
              <button className="btn-secondary text-sm" onClick={startEdit}>✏️ Chỉnh sửa KPI tháng</button>
            )}
            {editMode && (
              <>
                <button className="btn-primary text-sm" onClick={saveEdit}>💾 Lưu thay đổi</button>
                <button className="btn-secondary text-sm" onClick={() => { setEditMode(false); setEditingKpi(null); setEditingNhom(null); setShowPickKpi(false); setShowPickNhom(false); }}>Hủy</button>
              </>
            )}
          </div>

          {/* Nhóm hiện có (edit mode) — giống TaoTemplate */}
          {editMode && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-slate-600">Nhóm trong tháng {capTab === 'ca_nhan' ? 'cá nhân' : 'phòng'}:</p>
              <div className="flex flex-wrap gap-2">
                {editedNhomList.filter(n => n.kpi_cap === capTab)
                  .sort((a, b) => ROMAN_OPTIONS.indexOf(a.thu_tu) - ROMAN_OPTIONS.indexOf(b.thu_tu))
                  .map(n => (
                    <div key={n.nhom_id} className={`flex items-center gap-1 bg-white border rounded-lg px-2 py-1 text-xs ${editingNhom?.nhom_id === n.nhom_id ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'}`}>
                      <span className="font-bold text-blue-700">{n.thu_tu}.</span>
                      <span>{n.ten_nhom}</span>
                      <button onClick={() => setEditingNhom(editingNhom?.nhom_id === n.nhom_id ? null : { nhom_id: n.nhom_id, ten_nhom: n.ten_nhom, thu_tu: n.thu_tu, kpi_cap: n.kpi_cap })}
                        className="text-slate-300 hover:text-blue-500 ml-1" title="Chỉnh sửa">✏️</button>
                      <button onClick={() => handleRemoveNhom(n.nhom_id)} className="text-slate-300 hover:text-red-500" title="Xóa">✕</button>
                    </div>
                  ))}
                {editedNhomList.filter(n => n.kpi_cap === capTab).length === 0 && (
                  <span className="text-xs text-slate-400 italic">Chưa có nhóm — thêm từ thư viện</span>
                )}
              </div>
              {editingNhom && editedNhomList.some(n => n.nhom_id === editingNhom.nhom_id && n.kpi_cap === capTab) && (
                <div className="flex gap-2 items-end flex-wrap bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-0.5">STT La Mã</label>
                    <select autoFocus className="input text-xs py-0.5 w-20" value={editingNhom.thu_tu}
                      onChange={e => setEditingNhom(prev => ({ ...prev, thu_tu: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveNhomEdit(); if (e.key === 'Escape') setEditingNhom(null); }}>
                      {ROMAN_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-slate-500 self-center">
                    Tên nhóm: <span className="font-medium text-slate-700">{editingNhom.ten_nhom}</span>
                    <span className="ml-1 text-slate-400">(sửa tên trong Thư viện KPI)</span>
                  </p>
                  <button className="btn-primary text-xs" onClick={handleSaveNhomEdit}>💾 Lưu</button>
                  <button className="btn-secondary text-xs" onClick={() => setEditingNhom(null)}>Hủy</button>
                </div>
              )}
            </div>
          )}

          {/* Action buttons (edit mode) — giống TaoTemplate */}
          {editMode && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setShowPickNhom(true)} className="btn-secondary text-sm">+ Thêm Nhóm từ thư viện</button>
              <button onClick={() => { setShowPickKpi(true); setEditingKpi(null); }} className="btn-primary text-sm">+ Thêm KPI từ thư viện</button>
              <button onClick={() => setShowDelNhom(true)} className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">🗑️ Xóa Nhóm</button>
              <button onClick={() => setShowDelKpi(true)}  className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">🗑️ Xóa KPI</button>
            </div>
          )}

          <p className="text-xs text-slate-400">
            Ngày tạo: {snapshot.created_at ? new Date(snapshot.created_at).toLocaleString('vi-VN') : '—'}
            {editMode && <span className="ml-2 text-red-600 font-bold">· Lưu ý: đang chỉnh sửa — chưa lưu</span>}
          </p>

          {renderSection()}
        </>
      )}

      {editMode && showPickNhom && (
        <NhomPickerModal cap={capTab} currentNhomList={editedNhomList} onAdd={handlePickNhom} onClose={() => setShowPickNhom(false)} />
      )}
      {editMode && showPickKpi && (
        <LibraryPickerModal
          cap={capTab} currentList={editedKpiList}
          nhomList={editedNhomList.filter(n => n.kpi_cap === capTab).length > 0 ? editedNhomList : snapNhomList}
          onAdd={handleAddKpiFromLib} onClose={() => setShowPickKpi(false)}
        />
      )}
      {editMode && showDelNhom && (
        <BulkDeleteModal
          title="Xóa Nhóm KPI khỏi tháng"
          items={editedNhomList.filter(n => n.kpi_cap === capTab).map(n => ({ id: n.nhom_id, label: `${n.thu_tu}. ${n.ten_nhom}` }))}
          labelKey="label"
          onConfirm={ids => setEditedNhomList(prev => prev.filter(n => !ids.includes(n.nhom_id)))}
          onClose={() => setShowDelNhom(false)}
        />
      )}
      {editMode && showDelKpi && (
        <BulkDeleteModal
          title="Xóa KPI khỏi tháng"
          items={editedKpiList.filter(k => k.kpi_cap === capTab).sort((a,b) => a.stt - b.stt).map(k => ({ id: k.kpi_id, label: `${k.stt}. ${k.ten_kpi}` }))}
          labelKey="label"
          onConfirm={ids => setEditedKpiList(prev => renumberStt(prev.filter(k => !ids.includes(k.kpi_id))))}
          onClose={() => setShowDelKpi(false)}
        />
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────

export default function KPIManagement() {
  const store = useKpiStore();
  const { tab: urlTab = 'thuvien' } = useParams();
  const { user } = useAuth();
  if (!canEditDept(user)) return <div className="p-3 md:p-6"><h2 className="text-xl font-bold text-slate-900">Quản lý KPI</h2><div className="mt-6"><AccessDenied /></div></div>;

  const TAB_TITLES = {
    thuvien:  '📚 Thư viện KPI',
    template: '📋 Tạo template KPI',
    thang:    '📅 KPI theo tháng',
  };

  return (
    <div className="p-3 md:p-6 space-y-5">
      {store.syncMsg && (
        <div className={`text-xs px-3 py-2 rounded-lg ${store.syncMsg.startsWith('⚠️') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {store.syncMsg}
        </div>
      )}
      <div>
        <h2 className="text-lg md:text-xl font-bold text-slate-900">{TAB_TITLES[urlTab] ?? 'Quản lý KPI'}</h2>
        <p className="text-slate-500 text-xs mt-0.5">Luồng xử lý dữ liệu: Tạo thư viện → Tạo template → Tạo KPI tháng</p>
      </div>

      {urlTab === 'thuvien' && (
        <ThuVienKPI
          kpiList={store.kpiList} nhomList={store.nhomList}
          kpiLibrary={store.kpiLibrary} nhomLibrary={store.nhomLibrary}
          persistKpi={store.persistKpi} persistNhom={store.persistNhom}
          persistKpiLibrary={store.persistKpiLibrary} persistNhomLibrary={store.persistNhomLibrary}
        />
      )}
      {urlTab === 'template' && (
        <TaoTemplate
          kpiList={store.kpiList} nhomList={store.nhomList}
          persistKpi={store.persistKpi} persistNhom={store.persistNhom}
        />
      )}
      {urlTab === 'thang' && (
        <TheoThang kpiList={store.kpiList} nhomList={store.nhomList} />
      )}
    </div>
  );
}
