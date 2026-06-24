/**
 * @file DanhSachNV.jsx
 * @description Menu "Danh sách nhân viên" — quản lý thư viện NV, nhóm công việc, khu vực, NV theo tháng.
 *
 * SUB-MENU:
 * - /nhanvien/thuvienNV → ThuVienNV: CRUD thư viện NV + thư viện nhóm CV + thư viện khu vực
 * - /nhanvien/nvthang   → NvTheoThang: Quản lý danh sách NV theo từng tháng
 *
 * DỮ LIỆU ĐẦU VÀO:
 * - nv_library (localStorage ← nhan_vien): thư viện NV
 * - nv_snapshot_YYYY-MM (localStorage ← config_store): danh sách NV per tháng
 * - nhom_cv_list, khu_vuc_list (localStorage ← config_store): global lists
 *
 * DỮ LIỆU ĐẦU RA:
 * - nv_library → syncNvLibrary (nhan_vien)
 * - nv_snapshot_YYYY-MM → saveNvSnapshot → syncToSupabase (config_store)
 * - nhomCvLibrary → syncNhomCvLibrary; kvLibrary → syncKvLibrary
 *
 * PHÂN QUYỀN:
 * - Toàn module: admin + department_editor (canEditDept); viewer bị chặn (AccessDenied).
 *
 * LƯU Ý:
 * - Xóa tháng NV → cũng xóa KPI snapshot và dữ liệu Supabase tương ứng nếu có.
 * - NV đã nghỉ (archived_at ≠ null) vẫn được thêm vào tháng bình thường.
 */
import { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth, canEditDept } from '../contexts/AuthContext';
import { AccessDenied } from './Layout';
import {
  generateNvId,
  getNvLibrary, saveNvLibrary, addNvToLibrary, deleteNvFromLibrary,
  getAllNvCatalog,
  getNvSnapshot, saveNvSnapshot, deleteNvSnapshot, getSnapshotNvThangList, getNvListForThang,
  getKpiSnapshot, deleteKpiSnapshot,
  getInputCN, saveInputCN, getOutputDiem, saveOutputDiem, getOutputCT, saveOutputCT,
  syncToSupabase,
  deleteTrongSoConfig, unlockInputCN, unlockInputPhong,
  getNhomCvList, getNhomCvLibrary, saveNhomCvLibrary, addNhomCvToLibrary,
  deleteNhomCvFromLibrary, renameNhomCv,
  getAllNhomCvCatalog, generateNhomCvId,
  getKhuVucList, getKvLibrary, saveKvLibrary, addKvToLibrary,
  deleteKvFromLibrary, renameKv,
  getAllKvCatalog, generateKvId,
} from '../services/store';
import { isConnected, syncNvLibrary, syncNhomCvLibrary, syncKvLibrary, deleteMonthSheet, updateInputCNNvs } from '../services/supabaseService';
import { useSortConfig, formatUsedMonths } from '../utils/sortConfig';
import YearMonthPicker, { defaultThang } from './YearMonthPicker';
import XLSXStyle from 'xlsx-js-style';
import ImportConfirmModal from './ImportConfirmModal';

// ── Excel helpers (thư viện NV, NhomCV, KhuVuc) ──────────────────

const XLSX_HDR_S = {
  font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Segoe UI' },
  fill: { fgColor: { rgb: '1E40AF' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: { top:{style:'thin',color:{rgb:'93C5FD'}}, bottom:{style:'thin',color:{rgb:'93C5FD'}}, left:{style:'thin',color:{rgb:'93C5FD'}}, right:{style:'thin',color:{rgb:'93C5FD'}} },
};
const XLSX_DAT_S = (isEven) => ({
  font: { sz: 10, name: 'Segoe UI' },
  fill: { fgColor: { rgb: isEven ? 'F0F9FF' : 'FFFFFF' } },
  alignment: { vertical: 'center', wrapText: false },
  border: { top:{style:'thin',color:{rgb:'E2E8F0'}}, bottom:{style:'thin',color:{rgb:'E2E8F0'}}, left:{style:'thin',color:{rgb:'E2E8F0'}}, right:{style:'thin',color:{rgb:'E2E8F0'}} },
});

function applyXlsxStyles(ws, numDataRows, numCols) {
  for (let c = 0; c < numCols; c++) {
    const addr = XLSXStyle.utils.encode_cell({ r: 0, c });
    if (!ws[addr]) ws[addr] = { t: 's', v: '' };
    ws[addr].s = XLSX_HDR_S;
  }
  for (let r = 1; r <= numDataRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const addr = XLSXStyle.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = XLSX_DAT_S(r % 2 !== 0);
    }
  }
}

function exportNvTemplate(catalog) {
  const header = ['STT', 'Mã NV (mẫu)', 'Họ và tên', 'Trạng thái'];
  const rows = catalog.map((nv, i) => [i + 1, nv.nv_id, nv.ho_ten, nv.archived ? 'Đã nghỉ' : 'Đang làm việc']);
  const ws = XLSXStyle.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 22 }, { wch: 18 }];
  ws['!rows'] = [{ hpt: 25 }, ...rows.map(() => ({ hpt: 20 }))];
  ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  applyXlsxStyles(ws, rows.length, 4);
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, 'ThuVienNhanVien');
  XLSXStyle.writeFile(wb, 'ThuVienNhanVien.xlsx');
}

function exportNhomCvTemplate(catalog) {
  const header = ['STT', 'Mã nhóm CV (mẫu)', 'Tên nhóm công việc'];
  const rows = catalog.map((item, i) => [i + 1, item.nhom_cv_id, item.ten_nhom_cv]);
  const ws = XLSXStyle.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 30 }];
  ws['!rows'] = [{ hpt: 25 }, ...rows.map(() => ({ hpt: 20 }))];
  ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  applyXlsxStyles(ws, rows.length, 3);
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, 'ThuVienNhomCV');
  XLSXStyle.writeFile(wb, 'ThuVienNhomCongViec.xlsx');
}

function exportKvTemplate(catalog) {
  const header = ['STT', 'Mã khu vực (mẫu)', 'Tên khu vực quản lý'];
  const rows = catalog.map((item, i) => [i + 1, item.kv_id, item.ten_kv]);
  const ws = XLSXStyle.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 30 }];
  ws['!rows'] = [{ hpt: 25 }, ...rows.map(() => ({ hpt: 20 }))];
  ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  applyXlsxStyles(ws, rows.length, 3);
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, 'ThuVienKhuVuc');
  XLSXStyle.writeFile(wb, 'ThuVienKhuVucQuanLy.xlsx');
}

function parseImportNv(file, onDone) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb  = XLSXStyle.read(e.target.result, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSXStyle.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const entries = [];
      aoa.slice(1).forEach(row => {
        const hoTen = String(row[2] ?? '').trim();
        if (!hoTen) return;
        const nvIdRef   = String(row[1] ?? '').trim() || null;
        const trangThai = String(row[3] ?? '').trim();
        entries.push({ nv_id_ref: nvIdRef, ho_ten: hoTen, archived_at: trangThai === 'Đã nghỉ' ? new Date().toISOString() : null });
      });
      onDone(entries);
    } catch (err) { alert('Lỗi đọc file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function parseImportGenericLib(file, onDone) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb  = XLSXStyle.read(e.target.result, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSXStyle.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const entries = [];
      aoa.slice(1).forEach(row => {
        const name  = String(row[2] ?? '').trim();
        if (!name) return;
        const idRef = String(row[1] ?? '').trim() || null;
        entries.push({ name, id_ref: idRef });
      });
      onDone(entries);
    } catch (err) { alert('Lỗi đọc file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

// Normalize chuỗi để so sánh: trim + chuẩn hóa line endings
const normStr = s => (s ?? '').trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');

// ── Generic library table (dùng cho NhomCV và KhuVuc) ───────────

function GenericLibraryTable({ title, icon, idField, nameField, catalog, onAdd, onRename, onDelete, generateId, onExport, onImport }) {
  const [addForm, setAddForm]     = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName]   = useState('');
  const [importMsg, setImportMsg] = useState('');
  const importRef = useRef(null);
  const { sortKey, sortDir, handleSort, sortIcon, thCls, sortItems } = useSortConfig(idField);

  const handleImportFile = e => {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;
    onImport(file, (msg) => {
      setImportMsg(msg);
      setTimeout(() => setImportMsg(''), 5000);
    });
    e.target.value = '';
  };

  const displayed = useMemo(() => sortItems(catalog), [catalog, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = () => {
    const name = addForm?.name?.trim();
    if (!name) return;
    if (catalog.some(n => n[nameField] === name)) return alert('Tên đã tồn tại');
    onAdd({ [idField]: generateId(), [nameField]: name });
    setAddForm(null);
  };

  const handleRename = (id) => {
    const name = editName.trim();
    if (!name) return setEditingId(null);
    if (catalog.some(n => n[idField] !== id && n[nameField] === name)) return alert('Tên đã tồn tại');
    onRename(id, name);
    setEditingId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <h4 className="font-semibold text-sm text-slate-800">{icon} {title} <span className="text-slate-400 font-normal">({catalog.length})</span></h4>
        <div className="ml-auto flex gap-2 flex-wrap justify-end items-center">
          {importMsg && <span className="text-xs text-green-600 font-medium">{importMsg}</span>}
          {onExport && (
            <button className="btn-secondary text-sm" onClick={onExport}>📥 Xuất template Excel</button>
          )}
          {onImport && (
            <>
              <button className="btn-secondary text-sm" onClick={() => importRef.current?.click()}>📤 Nhập từ Excel</button>
              <input type="file" ref={importRef} accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
            </>
          )}
          <button className="btn-primary text-sm" onClick={() => setAddForm({ name: '' })}>+ Thêm</button>
        </div>
      </div>

      {addForm && (
        <div className="flex gap-2 items-end bg-blue-50 rounded-xl p-3">
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">Mã (tự động)</label>
            <input className="input text-xs w-36 bg-slate-100" readOnly value={generateId()} />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-0.5">Tên *</label>
            <input autoFocus className="input text-sm w-full" value={addForm.name}
              onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          </div>
          <button className="btn-primary text-sm" onClick={handleAdd}>Thêm</button>
          <button className="btn-secondary text-sm" onClick={() => setAddForm(null)}>Hủy</button>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-blue-50 border-b border-blue-100">
            <tr>
              <th className="th w-10 text-center">STT</th>
              <th className={`${thCls(idField)} w-36 hidden sm:table-cell`} onClick={() => handleSort(idField)}>Mã ID {sortIcon(idField)}</th>
              <th className={thCls(nameField)} onClick={() => handleSort(nameField)}>Nội dung {sortIcon(nameField)}</th>
              <th className="th hidden md:table-cell">Đã dùng ở tháng</th>
              <th className="th w-24 text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((item, i) => (
              <Fragment key={item[idField]}>
                <tr className={`border-t border-slate-100 hover:bg-slate-50 ${editingId === item[idField] ? 'bg-blue-50' : ''}`}>
                  <td className="td text-center text-slate-400">{i + 1}</td>
                  <td className="td font-mono text-xs text-blue-600 hidden sm:table-cell">{item[idField]}</td>
                  <td className="td font-medium text-slate-900">{item[nameField]}</td>
                  <td className="td text-xs hidden md:table-cell">
                    {(() => {
                      const s = formatUsedMonths(item.usedInMonths);
                      return s
                        ? <span className="whitespace-pre-line text-slate-600 leading-relaxed">{s}</span>
                        : <span className="text-slate-400 italic">Chưa dùng</span>;
                    })()}
                  </td>
                  <td className="td text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => { if (editingId === item[idField]) setEditingId(null); else { setEditingId(item[idField]); setEditName(item[nameField]); } }}
                        className={`p-1.5 rounded-lg transition-colors ${editingId === item[idField] ? 'text-blue-600 bg-blue-100' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                        title="Chỉnh sửa">✏️</button>
                      {item.usedInMonths?.length === 0 ? (
                        <button onClick={() => { if (confirm('Xóa vĩnh viễn mục này?')) onDelete(item[idField]); }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Xóa vĩnh viễn">🗑️</button>
                      ) : (
                        <span className="p-1.5 text-slate-300 cursor-not-allowed" title="Đang được dùng — không thể xóa">🔒</span>
                      )}
                    </div>
                  </td>
                </tr>
                {editingId === item[idField] && (
                  <tr className="bg-blue-50 border-t border-blue-200">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="flex gap-2 items-end flex-wrap">
                        <div className="flex-1 min-w-44">
                          <label className="block text-xs text-slate-500 mb-0.5">Tên *</label>
                          <input autoFocus className="input text-sm w-full" value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleRename(item[idField]); if (e.key === 'Escape') setEditingId(null); }} />
                        </div>
                        <button className="btn-primary text-sm" onClick={() => handleRename(item[idField])}>💾 Lưu</button>
                        <button className="btn-secondary text-sm" onClick={() => setEditingId(null)}>Hủy</button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {displayed.length === 0 && (
              <tr><td colSpan={5} className="td text-center text-slate-400 py-8">Chưa có mục nào</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

// ── NvMonthEditRow — inline edit nhom_cv/khu_vuc/stt cho NV trong tháng ───────

function NvMonthEditRow({ nv, nhomCvList, khuVucList, onSave, onCancel }) {
  const [form, setForm] = useState({ nhom_cv: nv.nhom_cv || '', khu_vuc: nv.khu_vuc || '', stt: nv.stt });
  return (
    <tr className="bg-blue-50 border-t border-blue-200">
      <td colSpan={7} className="px-4 py-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">Nhóm công việc</label>
            <select className="input text-sm w-44"
              value={form.nhom_cv} onChange={e => setForm(f => ({ ...f, nhom_cv: e.target.value }))}>
              {nhomCvList.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">Khu vực</label>
            <select className="input text-sm w-36"
              value={form.khu_vuc} onChange={e => setForm(f => ({ ...f, khu_vuc: e.target.value }))}>
              {khuVucList.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">STT</label>
            <input type="number" min="1" className="input text-sm w-16" value={form.stt}
              onChange={e => setForm(f => ({ ...f, stt: parseInt(e.target.value) || 1 }))} />
          </div>
          <button className="btn-primary text-sm" onClick={() => onSave({ ...nv, ...form })}>💾 Lưu</button>
          <button className="btn-secondary text-sm" onClick={onCancel}>Hủy</button>
        </div>
      </td>
    </tr>
  );
}

// ── CreateNvThangModal ────────────────────────────────────────────

function CreateNvThangModal({ existingThangList, onConfirm, onClose }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = Array.from({ length: currentYear - 2023 }, (_, i) => 2024 + i);
  years.push(currentYear + 1);

  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [sourceType, setSourceType] = useState('empty');

  const srcYears = [...new Set(existingThangList.map(t => parseInt(t.split('-')[0])))].sort((a, b) => b - a);
  const defaultSrcYear = srcYears[0] || now.getFullYear();
  const [copyYear, setCopyYear] = useState(defaultSrcYear);

  const srcMonthsForYear = existingThangList
    .filter(t => parseInt(t.split('-')[0]) === copyYear)
    .map(t => parseInt(t.split('-')[1]))
    .sort((a, b) => b - a);
  const defaultSrcMonth = srcMonthsForYear[0] || 1;
  const [copyMonth, setCopyMonth] = useState(defaultSrcMonth);

  const handleCopyYearChange = y => {
    setCopyYear(y);
    const months = existingThangList
      .filter(t => parseInt(t.split('-')[0]) === y)
      .map(t => parseInt(t.split('-')[1]))
      .sort((a, b) => b - a);
    setCopyMonth(months[0] || 1);
  };

  const newThang    = `${year}-${String(month).padStart(2, '0')}`;
  const copyFrom    = sourceType === 'copy' ? `${copyYear}-${String(copyMonth).padStart(2, '0')}` : null;
  const alreadyExists = existingThangList.includes(newThang);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md mx-4 w-full space-y-4">
        <h3 className="font-bold text-lg">Tạo danh sách nhân viên cho tháng mới</h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Năm</label>
            <select className="input w-full" value={year} onChange={e => setYear(parseInt(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tháng</label>
            <select className="input w-full" value={month} onChange={e => setMonth(parseInt(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>Tháng {m}</option>
              ))}
            </select>
          </div>
        </div>

        {alreadyExists && (
          <p className="text-xs text-red-600">⚠ Tháng {month}/{year} đã có danh sách nhân viên.</p>
        )}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">Nguồn dữ liệu</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="radio" name="sourceType" value="empty" checked={sourceType === 'empty'}
                onChange={() => setSourceType('empty')} className="w-4 h-4" />
              Tạo danh sách trống
            </label>
            <label className={`flex items-center gap-2 cursor-pointer text-sm ${existingThangList.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}>
              <input type="radio" name="sourceType" value="copy" checked={sourceType === 'copy'}
                onChange={() => setSourceType('copy')} disabled={existingThangList.length === 0} className="w-4 h-4" />
              Sao chép từ tháng
            </label>
          </div>
          {sourceType === 'copy' && (
            <div className="grid grid-cols-2 gap-3 pl-1 pt-1">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Năm nguồn</label>
                <select className="input w-full" value={copyYear} onChange={e => handleCopyYearChange(parseInt(e.target.value))}>
                  {srcYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Tháng nguồn</label>
                <select className="input w-full" value={copyMonth} onChange={e => setCopyMonth(parseInt(e.target.value))}>
                  {srcMonthsForYear.map(m => <option key={m} value={m}>Tháng {m}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>Hủy</button>
          <button className="btn-primary" disabled={alreadyExists}
            onClick={() => !alreadyExists && onConfirm(newThang, copyFrom)}>
            Tạo tháng
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ThuVienNV (sub-tab A) ─────────────────────────────────────────────────────

function ThuVienNV() {
  const [catalog, setCatalog]         = useState(() => getAllNvCatalog());
  const [nhomCvCatalog, setNhomCvCat] = useState(() => getAllNhomCvCatalog());
  const [kvCatalog, setKvCat]         = useState(() => getAllKvCatalog());
  const [editingId, setEditingId]     = useState(null);
  const [editForm, setEditForm]       = useState(null);
  const [addForm, setAddForm]         = useState(null);
  const [filter, setFilter]           = useState('all');
  const [importMsg, setImportMsg]     = useState('');
  const [importConfirm, setImportConfirm] = useState(null);
  const nvFileRef = useRef(null);
  const { sortKey, sortDir, handleSort, sortIcon, thCls, sortItems } = useSortConfig('nv_id');

  const reloadCatalog = () => setCatalog(getAllNvCatalog());

  const persistLib = lib => {
    saveNvLibrary(lib);
    reloadCatalog();
    if (isConnected()) syncNvLibrary(lib).catch(e => console.warn('[syncNvLib]', e));
  };

  const persistNhomCvLib = lib => {
    saveNhomCvLibrary(lib);
    setNhomCvCat(getAllNhomCvCatalog());
    if (isConnected()) syncNhomCvLibrary(lib).catch(e => console.warn('[syncNhomCvLib]', e));
  };

  const persistKvLib = lib => {
    saveKvLibrary(lib);
    setKvCat(getAllKvCatalog());
    if (isConnected()) syncKvLibrary(lib).catch(e => console.warn('[syncKvLib]', e));
  };

  const handleAdd = () => {
    if (!addForm?.ho_ten.trim()) return;
    if (getNvLibrary().some(n => n.nv_id === addForm.nv_id)) return alert('Mã NV đã tồn tại');
    addNvToLibrary(addForm);
    persistLib(getNvLibrary());
    setAddForm(null);
  };

  const handleNvEdit = (nv_id) => {
    const name = editForm?.ho_ten?.trim();
    if (!name) return;
    const willArchive = !!editForm.archived_at;
    persistLib(getNvLibrary().map(n =>
      n.nv_id === nv_id ? { ...n, ho_ten: name, archived_at: editForm.archived_at } : n
    ));
    setEditingId(null);
    setEditForm(null);
    if (willArchive && filter === 'active') setFilter('all');
  };

  const handleImportNv = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    parseImportNv(file, entries => {
      const lib      = getNvLibrary();
      const toUpdate = [];
      const toAdd    = [];
      entries.forEach(entry => {
        const existing = entry.nv_id_ref ? lib.find(n => n.nv_id === entry.nv_id_ref) : null;
        if (existing) {
          const archivedMoi = entry.archived_at ? true : false;
          const changed = normStr(existing.ho_ten) !== normStr(entry.ho_ten) || !!existing.archived_at !== archivedMoi;
          if (changed) toUpdate.push({ nv_id: existing.nv_id, ho_ten_cu: existing.ho_ten, entry });
        } else {
          toAdd.push(entry);
        }
      });

      const previewLines = toUpdate.slice(0, 10).map(u => {
        const diffs = [];
        if (normStr(u.ho_ten_cu) !== normStr(u.entry.ho_ten)) diffs.push(`tên: "${u.ho_ten_cu}" → "${u.entry.ho_ten}"`);
        if (!!lib.find(n => n.nv_id === u.nv_id)?.archived_at !== !!u.entry.archived_at)
          diffs.push(`trạng thái thay đổi`);
        return `• [${u.nv_id}] ${diffs.join('; ')}`;
      });
      if (toUpdate.length > 10) previewLines.push(`... và ${toUpdate.length - 10} NV khác`);

      const executeImport = (doUpdates) => {
        let updatedLib = [...lib];
        let updateCount = 0;
        if (doUpdates) {
          toUpdate.forEach(({ nv_id, entry }) => {
            const idx = updatedLib.findIndex(n => n.nv_id === nv_id);
            if (idx >= 0) { updatedLib[idx] = { ...updatedLib[idx], ho_ten: entry.ho_ten, archived_at: entry.archived_at }; updateCount++; }
          });
          saveNvLibrary(updatedLib);
        }
        let newCount = 0;
        toAdd.forEach(entry => {
          addNvToLibrary({ nv_id: generateNvId(), ho_ten: entry.ho_ten, archived_at: entry.archived_at });
          newCount++;
        });
        persistLib(getNvLibrary());
        const parts = [];
        if (updateCount > 0) parts.push(`cập nhật ${updateCount} NV`);
        if (newCount > 0)    parts.push(`thêm mới ${newCount} NV`);
        setImportMsg(parts.length ? `✓ ${parts.join(', ')}` : '✓ Không có thay đổi');
        setTimeout(() => setImportMsg(''), 6000);
        setImportConfirm(null);
      };

      setImportConfirm({
        title: 'Xác nhận nhập Nhân viên từ Excel',
        loaiDuLieu: 'Thư viện nhân viên',
        bangSupabase: 'nhan_vien',
        thang: null,
        themMoi: toAdd.length,
        capNhat: toUpdate.length,
        previewLines,
        warnings: toUpdate.length > 0 ? ['Thay đổi thông tin NV ảnh hưởng đến dữ liệu báo cáo liên quan'] : [],
        onConfirm: () => executeImport(true),
        onConfirmAddOnly: toUpdate.length > 0 ? () => executeImport(false) : null,
      });
    });
    e.target.value = '';
  };

  const handleImportNhomCv = (file, setMsg) => {
    parseImportGenericLib(file, entries => {
      const lib      = getNhomCvLibrary();
      const toUpdate = [];
      const toAdd    = [];
      entries.forEach(({ name, id_ref }) => {
        const existing = id_ref ? lib.find(n => n.nhom_cv_id === id_ref) : null;
        if (existing) {
          if (normStr(existing.ten_nhom_cv) !== normStr(name)) toUpdate.push({ nhom_cv_id: existing.nhom_cv_id, ten_cu: existing.ten_nhom_cv, ten_moi: name });
        } else {
          toAdd.push(name);
        }
      });

      const previewLines = toUpdate.slice(0, 10).map(u => `• [${u.nhom_cv_id}] "${u.ten_cu}" → "${u.ten_moi}"`);
      if (toUpdate.length > 10) previewLines.push(`... và ${toUpdate.length - 10} nhóm khác`);

      const executeImport = (doUpdates) => {
        let updateCount = 0;
        if (doUpdates) {
          toUpdate.forEach(u => { renameNhomCv(u.nhom_cv_id, u.ten_moi); updateCount++; });
        }
        let newCount = 0;
        toAdd.forEach(name => {
          addNhomCvToLibrary({ nhom_cv_id: generateNhomCvId(), ten_nhom_cv: name });
          newCount++;
        });
        persistNhomCvLib(getNhomCvLibrary());
        const parts = [];
        if (updateCount > 0) parts.push(`cập nhật ${updateCount} nhóm`);
        if (newCount > 0)    parts.push(`thêm mới ${newCount} nhóm`);
        setMsg(parts.length ? `✓ ${parts.join(', ')}` : '✓ Không có thay đổi');
        setImportConfirm(null);
      };

      setImportConfirm({
        title: 'Xác nhận nhập Nhóm công việc từ Excel',
        loaiDuLieu: 'Thư viện nhóm công việc',
        bangSupabase: 'nhom_cv',
        thang: null,
        themMoi: toAdd.length,
        capNhat: toUpdate.length,
        previewLines,
        warnings: toUpdate.length > 0 ? ['Đổi tên nhóm CV sẽ cascade sang dữ liệu NV theo tháng và báo cáo'] : [],
        onConfirm: () => executeImport(true),
        onConfirmAddOnly: toUpdate.length > 0 ? () => executeImport(false) : null,
      });
    });
  };

  const handleImportKv = (file, setMsg) => {
    parseImportGenericLib(file, entries => {
      const lib      = getKvLibrary();
      const toUpdate = [];
      const toAdd    = [];
      entries.forEach(({ name, id_ref }) => {
        const existing = id_ref ? lib.find(n => n.kv_id === id_ref) : null;
        if (existing) {
          if (normStr(existing.ten_kv) !== normStr(name)) toUpdate.push({ kv_id: existing.kv_id, ten_cu: existing.ten_kv, ten_moi: name });
        } else {
          toAdd.push(name);
        }
      });

      const previewLines = toUpdate.slice(0, 10).map(u => `• [${u.kv_id}] "${u.ten_cu}" → "${u.ten_moi}"`);
      if (toUpdate.length > 10) previewLines.push(`... và ${toUpdate.length - 10} khu vực khác`);

      const executeImport = (doUpdates) => {
        let updateCount = 0;
        if (doUpdates) {
          toUpdate.forEach(u => { renameKv(u.kv_id, u.ten_moi); updateCount++; });
        }
        let newCount = 0;
        toAdd.forEach(name => {
          addKvToLibrary({ kv_id: generateKvId(), ten_kv: name });
          newCount++;
        });
        persistKvLib(getKvLibrary());
        const parts = [];
        if (updateCount > 0) parts.push(`cập nhật ${updateCount} khu vực`);
        if (newCount > 0)    parts.push(`thêm mới ${newCount} khu vực`);
        setMsg(parts.length ? `✓ ${parts.join(', ')}` : '✓ Không có thay đổi');
        setImportConfirm(null);
      };

      setImportConfirm({
        title: 'Xác nhận nhập Khu vực quản lý từ Excel',
        loaiDuLieu: 'Thư viện khu vực quản lý',
        bangSupabase: 'khu_vuc',
        thang: null,
        themMoi: toAdd.length,
        capNhat: toUpdate.length,
        previewLines,
        warnings: toUpdate.length > 0 ? ['Đổi tên khu vực sẽ cascade sang dữ liệu NV theo tháng và báo cáo'] : [],
        onConfirm: () => executeImport(true),
        onConfirmAddOnly: toUpdate.length > 0 ? () => executeImport(false) : null,
      });
    });
  };

  const handleDelete   = nv => {
    if (nv.usedInMonths.length > 0)
      return alert(`Không thể xóa — nhân viên có dữ liệu ở tháng: ${nv.usedInMonths.join(', ')}`);
    if (!confirm('Xóa vĩnh viễn nhân viên này?')) return;
    deleteNvFromLibrary(nv.nv_id);
    persistLib(getNvLibrary());
  };

  const displayed = useMemo(() => {
    let items = catalog;
    if (filter === 'active')   items = catalog.filter(n => !n.archived);
    if (filter === 'archived') items = catalog.filter(n => n.archived);
    return sortItems(items, { trang_thai: n => n.archived ? 1 : 0 });
  }, [catalog, filter, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
        📚 <strong>Thư viện nhân viên</strong> — danh sách toàn bộ các nhân viên được đánh giá KPI (bao gồm cả nv đang làm việc &amp; đã nghỉ việc), nhóm công việc, khu vực quản lý tương ứng
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <select value={filter} onChange={e => setFilter(e.target.value)} className="input text-sm w-36">
          <option value="active">Đang làm việc</option>
          <option value="archived">Đã nghỉ</option>
          <option value="all">Tất cả</option>
        </select>
        <span className="text-xs text-slate-400">{displayed.length} NV</span>
        <div className="ml-auto flex gap-2 flex-wrap justify-end items-center">
          {importMsg && <span className="text-xs text-green-600 font-medium">{importMsg}</span>}
          <button className="btn-secondary text-sm" onClick={() => exportNvTemplate(catalog)}>
            📥 Xuất template Excel
          </button>
          <button className="btn-secondary text-sm" onClick={() => nvFileRef.current?.click()}>
            📤 Nhập từ Excel
          </button>
          <input type="file" ref={nvFileRef} accept=".xlsx,.xls" className="hidden" onChange={handleImportNv} />
          <button className="btn-primary text-sm"
            onClick={() => setAddForm({ nv_id: generateNvId(), ho_ten: '', archived_at: null })}>
            + Thêm nhân viên
          </button>
        </div>
      </div>

      {addForm && (
        <div className="card p-3 bg-blue-50 border-blue-200 flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">Mã NV</label>
            <input className="input text-sm w-36 font-mono text-xs" value={addForm.nv_id}
              onChange={e => setAddForm(f => ({ ...f, nv_id: e.target.value }))} />
          </div>
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-slate-500 mb-0.5">Họ tên *</label>
            <input autoFocus className="input text-sm w-full" value={addForm.ho_ten}
              onChange={e => setAddForm(f => ({ ...f, ho_ten: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-0.5">Trạng thái</label>
            <select className="input text-sm w-36"
              value={addForm.archived_at ? 'archived' : 'active'}
              onChange={e => setAddForm(f => ({ ...f, archived_at: e.target.value === 'archived' ? new Date().toISOString() : null }))}>
              <option value="active">Đang làm việc</option>
              <option value="archived">Đã nghỉ</option>
            </select>
          </div>
          <button className="btn-primary text-sm" onClick={handleAdd}>Thêm</button>
          <button className="btn-secondary text-sm" onClick={() => setAddForm(null)}>Hủy</button>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-blue-50 border-b border-blue-100">
            <tr>
              <th className="th w-10 text-center">STT</th>
              <th className={`${thCls('nv_id')} w-20 hidden sm:table-cell`} onClick={() => handleSort('nv_id')}>Mã NV {sortIcon('nv_id')}</th>
              <th className={thCls('ho_ten')} onClick={() => handleSort('ho_ten')}>Họ và tên {sortIcon('ho_ten')}</th>
              <th className="th hidden md:table-cell">Đã làm ở tháng</th>
              <th className={`${thCls('trang_thai')} w-28 text-center hidden sm:table-cell`} onClick={() => handleSort('trang_thai')}>Trạng thái {sortIcon('trang_thai')}</th>
              <th className="th w-20 text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((nv, i) => (
              <Fragment key={nv.nv_id}>
                <tr className={`border-t border-slate-100 ${nv.archived ? 'opacity-60' : 'hover:bg-slate-50'} ${editingId === nv.nv_id ? 'bg-blue-50' : ''}`}>
                  <td className="td text-center text-slate-400">{i + 1}</td>
                  <td className="td font-mono text-xs text-blue-600 hidden sm:table-cell">{nv.nv_id}</td>
                  <td className="td font-medium text-slate-900">
                    {nv.ho_ten}
                    <span className="block text-[10px] font-mono text-blue-500 sm:hidden">{nv.nv_id}</span>
                    <span className={`sm:hidden inline-block mt-0.5 badge text-[10px] ${nv.archived ? 'bg-slate-100 text-slate-500' : 'bg-green-100 text-green-800'}`}>
                      {nv.archived ? 'Đã nghỉ' : 'Đang làm'}
                    </span>
                  </td>
                  <td className="td text-xs hidden md:table-cell">
                    {(() => {
                      const s = formatUsedMonths(nv.usedInMonths);
                      return s
                        ? <span className="whitespace-pre-line text-slate-600 leading-relaxed">{s}</span>
                        : <span className="text-slate-400 italic">Chưa có tháng</span>;
                    })()}
                  </td>
                  <td className="td text-center hidden sm:table-cell">
                    <span className={`badge ${nv.archived ? 'bg-slate-100 text-slate-500' : 'bg-green-100 text-green-800'}`}>
                      {nv.archived ? 'Đã nghỉ' : 'Đang làm việc'}
                    </span>
                  </td>
                  <td className="td text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => { if (editingId === nv.nv_id) { setEditingId(null); setEditForm(null); } else { setEditingId(nv.nv_id); setEditForm({ ho_ten: nv.ho_ten, archived_at: nv.archived_at }); } }}
                        className={`p-1.5 rounded-lg transition-colors ${editingId === nv.nv_id ? 'text-blue-600 bg-blue-100' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                        title="Chỉnh sửa">✏️</button>
                      {nv.usedInMonths.length === 0 ? (
                        <button onClick={() => handleDelete(nv)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Xóa vĩnh viễn">🗑️</button>
                      ) : (
                        <span className="p-1.5 text-slate-300 cursor-not-allowed" title="Đang có dữ liệu — không thể xóa">🔒</span>
                      )}
                    </div>
                  </td>
                </tr>
                {editingId === nv.nv_id && (
                  <tr className="bg-blue-50 border-t border-blue-200">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="flex gap-3 items-end flex-wrap">
                        <div className="flex-1 min-w-44">
                          <label className="block text-xs text-slate-500 mb-0.5">Họ tên *</label>
                          <input autoFocus className="input text-sm w-full" value={editForm?.ho_ten || ''}
                            onChange={e => setEditForm(f => ({ ...f, ho_ten: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') handleNvEdit(nv.nv_id); if (e.key === 'Escape') { setEditingId(null); setEditForm(null); } }} />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-0.5">Trạng thái</label>
                          <select className="input text-sm" value={editForm?.archived_at ? 'archived' : 'active'}
                            onChange={e => setEditForm(f => ({ ...f, archived_at: e.target.value === 'archived' ? (f.archived_at || new Date().toISOString()) : null }))}>
                            <option value="active">Đang làm việc</option>
                            <option value="archived">Đã nghỉ</option>
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button className="btn-primary text-sm" onClick={() => handleNvEdit(nv.nv_id)}>💾 Lưu</button>
                          <button className="btn-secondary text-sm" onClick={() => { setEditingId(null); setEditForm(null); }}>Hủy</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {displayed.length === 0 && (
              <tr><td colSpan={6} className="td text-center text-slate-400 py-8">Không có nhân viên nào</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      <div className="border-t border-slate-200 pt-4">
        <GenericLibraryTable
          title="Thư viện Nhóm công việc" icon="🏷️"
          idField="nhom_cv_id" nameField="ten_nhom_cv"
          catalog={nhomCvCatalog}
          generateId={generateNhomCvId}
          onAdd={item => { addNhomCvToLibrary(item); persistNhomCvLib(getNhomCvLibrary()); }}
          onRename={(id, name) => { renameNhomCv(id, name); persistNhomCvLib(getNhomCvLibrary()); }}
          onDelete={id => { deleteNhomCvFromLibrary(id); persistNhomCvLib(getNhomCvLibrary()); }}
          onExport={() => exportNhomCvTemplate(nhomCvCatalog)}
          onImport={handleImportNhomCv}
        />
      </div>

      <div className="border-t border-slate-200 pt-4">
        <GenericLibraryTable
          title="Thư viện Khu vực quản lý" icon="📍"
          idField="kv_id" nameField="ten_kv"
          catalog={kvCatalog}
          generateId={generateKvId}
          onAdd={item => { addKvToLibrary(item); persistKvLib(getKvLibrary()); }}
          onRename={(id, name) => { renameKv(id, name); persistKvLib(getKvLibrary()); }}
          onDelete={id => { deleteKvFromLibrary(id); persistKvLib(getKvLibrary()); }}
          onExport={() => exportKvTemplate(kvCatalog)}
          onImport={handleImportKv}
        />
      </div>

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

// ── AddNvModal — multi-select NV với per-NV nhom_cv/khu_vuc ──────────────────

function AddNvModal({ nvNotInMonth, nhomCvList, khuVucList, defaultStt, onConfirm, onClose }) {
  const [phase,       setPhase]       = useState(1);
  const [search,      setSearch]      = useState('');
  const [selected,    setSelected]    = useState(new Set());
  const [assignments, setAssignments] = useState([]);

  const filtered = nvNotInMonth.filter(n =>
    n.ho_ten.toLowerCase().includes(search.toLowerCase()) ||
    n.nv_id.toLowerCase().includes(search.toLowerCase())
  );
  const allChecked = filtered.length > 0 && filtered.every(n => selected.has(n.nv_id));

  const toggle = nv_id => setSelected(s => {
    const next = new Set(s);
    next.has(nv_id) ? next.delete(nv_id) : next.add(nv_id);
    return next;
  });
  const toggleAll = () => {
    if (allChecked) setSelected(s => { const n = new Set(s); filtered.forEach(x => n.delete(x.nv_id)); return n; });
    else            setSelected(s => { const n = new Set(s); filtered.forEach(x => n.add(x.nv_id));    return n; });
  };

  const handleProceed = () => {
    const items = nvNotInMonth.filter(n => selected.has(n.nv_id));
    setAssignments(items.map((n, i) => ({
      nv: n, nhom_cv: nhomCvList[0] || '', khu_vuc: khuVucList[0] || '', stt: defaultStt + i,
    })));
    setPhase(2);
  };

  const update     = (nv_id, field, value) =>
    setAssignments(prev => prev.map(a => a.nv.nv_id === nv_id ? { ...a, [field]: value } : a));
  const remove     = nv_id =>
    setAssignments(prev => prev.filter(a => a.nv.nv_id !== nv_id).map((a, i) => ({ ...a, stt: defaultStt + i })));
  const applyToAll = (field, value) =>
    setAssignments(prev => prev.map(a => ({ ...a, [field]: value })));

  const handleConfirm = () =>
    onConfirm(assignments.map(a => ({ nv_id: a.nv.nv_id, nhom_cv: a.nhom_cv, khu_vuc: a.khu_vuc, stt: a.stt })));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="font-bold text-lg">Thêm nhân viên vào tháng</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        {phase === 1 ? (
          <>
            <div className="px-4 py-3 border-b flex gap-2 items-center">
              <input autoFocus className="input flex-1 text-sm" placeholder="🔍 Tìm tên hoặc mã NV..."
                value={search} onChange={e => setSearch(e.target.value)} />
              {selected.size > 0 && <span className="text-xs text-blue-600 font-medium whitespace-nowrap">Đã chọn {selected.size}</span>}
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="bg-slate-50 px-4 py-2 flex items-center gap-2 border-b border-slate-200 sticky top-0">
                <input type="checkbox" className="w-4 h-4 rounded" checked={allChecked} onChange={toggleAll} />
                <span className="text-xs text-slate-500">Chọn tất cả ({filtered.length} NV)</span>
              </div>
              {filtered.length === 0
                ? <div className="px-4 py-6 text-sm text-slate-400 text-center">Không tìm thấy nhân viên</div>
                : filtered.map(n => (
                  <label key={n.nv_id}
                    className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 last:border-0 cursor-pointer ${selected.has(n.nv_id) ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                    <input type="checkbox" className="w-4 h-4 rounded"
                      checked={selected.has(n.nv_id)} onChange={() => toggle(n.nv_id)} />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{n.ho_ten}</p>
                      <p className="text-xs text-blue-500 font-mono">{n.nv_id}</p>
                    </div>
                  </label>
                ))
              }
            </div>
            <div className="px-6 py-4 border-t flex gap-2 justify-end">
              <button className="btn-secondary text-sm" onClick={onClose}>Hủy</button>
              <button className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed" disabled={selected.size === 0}
                onClick={handleProceed}>
                Tiếp tục →{selected.size > 0 ? ` (${selected.size} NV)` : ''}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-3 border-b flex items-center gap-3 flex-wrap">
              <button onClick={() => setPhase(1)} className="text-xs text-blue-600 hover:text-blue-800">← Chọn lại</button>
              <span className="text-sm text-slate-600">{assignments.length} nhân viên</span>
              {assignments.length > 1 && (
                <>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-xs text-slate-500 whitespace-nowrap">Gán nhóm tất cả:</span>
                    <select className="input text-xs py-0.5 w-36" defaultValue=""
                      onChange={e => e.target.value && applyToAll('nhom_cv', e.target.value)}>
                      <option value="" disabled>-- Chọn --</option>
                      {nhomCvList.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500 whitespace-nowrap">Khu vực tất cả:</span>
                    <select className="input text-xs py-0.5 w-32" defaultValue=""
                      onChange={e => e.target.value && applyToAll('khu_vuc', e.target.value)}>
                      <option value="" disabled>-- Chọn --</option>
                      {khuVucList.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="overflow-y-auto overflow-x-auto flex-1">
              <table className="w-full text-xs">
                <thead className="bg-blue-50 border-b border-blue-100 sticky top-0">
                  <tr>
                    <th className="th">Họ tên</th>
                    <th className="th w-44">Nhóm công việc</th>
                    <th className="th w-36">Khu vực</th>
                    <th className="th w-16">STT</th>
                    <th className="th w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a.nv.nv_id} className="border-t border-slate-100">
                      <td className="td font-medium">
                        {a.nv.ho_ten}
                        <span className="block text-[10px] text-slate-400 font-mono">{a.nv.nv_id}</span>
                      </td>
                      <td className="td">
                        <select className="input text-xs py-0.5" value={a.nhom_cv}
                          onChange={e => update(a.nv.nv_id, 'nhom_cv', e.target.value)}>
                          {nhomCvList.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td className="td">
                        <select className="input text-xs py-0.5" value={a.khu_vuc}
                          onChange={e => update(a.nv.nv_id, 'khu_vuc', e.target.value)}>
                          {khuVucList.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </td>
                      <td className="td">
                        <input type="number" min="1" className="input text-xs py-0.5 w-14" value={a.stt}
                          onChange={e => update(a.nv.nv_id, 'stt', parseInt(e.target.value) || 1)} />
                      </td>
                      <td className="td text-center">
                        <button onClick={() => remove(a.nv.nv_id)}
                          className="text-slate-300 hover:text-red-500 text-base leading-none">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t flex gap-2 justify-end">
              <button className="btn-secondary text-sm" onClick={onClose}>Hủy</button>
              <button className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed" disabled={assignments.length === 0}
                onClick={handleConfirm}>
                + Thêm {assignments.length} nhân viên
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── NvTheoThang (sub-tab B) ───────────────────────────────────────────────────

function NvTheoThang() {
  const initThangList = () => getSnapshotNvThangList();
  const [nvThangList, setNvThangList] = useState(initThangList);
  const [thang, setThang]             = useState(() => defaultThang(initThangList()));
  const [nvList, setNvList]           = useState(() => {
    const t = initThangList()[0] || '';
    return t ? getNvListForThang(t) : [];
  });
  const [editingId, setEditingId]     = useState(null);
  const [showAdd, setShowAdd]         = useState(false);
  const [showCreate, setShowCreate]   = useState(false);

  const nhomCvList = getNhomCvList();
  const khuVucList = getKhuVucList();

  useEffect(() => {
    setNvList(thang ? getNvListForThang(thang) : []);
    setEditingId(null);
    setShowAdd(false);
  }, [thang]);

  const reload = () => setNvList(thang ? getNvListForThang(thang) : []);

  const persistNvSnap = nvData => { saveNvSnapshot(thang, nvData); reload(); };

  const handleCreateMonth = (newThang, copyFrom) => {
    if (nvThangList.includes(newThang)) { alert(`Tháng ${newThang} đã có danh sách nhân viên`); return; }
    const initRefs = copyFrom
      ? (getNvSnapshot(copyFrom)?.nvRefs || [])
      : [];
    saveNvSnapshot(newThang, initRefs);
    const newList = getSnapshotNvThangList();
    setNvThangList(newList);
    setThang(newThang);
    setShowCreate(false);
  };

  const handleDeleteMonth = async () => {
    const hasKpiSnap = !!getKpiSnapshot(thang);
    const supabaseNote = hasKpiSnap && isConnected() ? `\n• Dữ liệu tháng ${thang} trên Supabase` : '';
    const msg = hasKpiSnap
      ? `Xóa tháng ${thang}?\n\nTháng này đang có KPI snapshot. Xóa danh sách NV tháng này sẽ đồng thời xóa:\n• Danh sách NV tháng ${thang}\n• KPI snapshot tháng ${thang}${supabaseNote}\n\nHành động không thể hoàn tác.`
      : `Xóa toàn bộ dữ liệu nhân viên tháng ${thang}? Hành động không thể hoàn tác.`;
    if (!confirm(msg)) return;
    deleteNvSnapshot(thang);
    if (hasKpiSnap) {
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
      if (isConnected()) deleteMonthSheet(thang).catch(e => console.warn('[deleteMonthSheet]', e.message));
    }
    const newList = getSnapshotNvThangList();
    setNvThangList(newList);
    setThang(newList[0] || '');
  };

  const handleSaveEdit = form => {
    const snap = getNvSnapshot(thang);
    const editedId = form.nv_id;
    const refs = (snap?.nvRefs || []).map(r =>
      r.nv_id === editedId ? { nv_id: r.nv_id, nhom_cv: form.nhom_cv, khu_vuc: form.khu_vuc, stt: form.stt } : r
    );
    refs.sort((a, b) => {
      const diff = (a.stt || 0) - (b.stt || 0);
      if (diff !== 0) return diff;
      return a.nv_id === editedId ? -1 : 1;
    });
    refs.forEach((r, i) => { r.stt = i + 1; });
    persistNvSnap(refs);
    setEditingId(null);
  };

  const handleAddNvBulk = newRefs => {
    const snap = getNvSnapshot(thang);
    const existingRefs  = snap?.nvRefs || [];
    const existingSet   = new Set(existingRefs.map(r => r.nv_id));
    const toAdd = newRefs.filter(r => !existingSet.has(r.nv_id));
    if (!toAdd.length) return;
    const newIds = new Set(toAdd.map(r => r.nv_id));
    let combined = [...existingRefs, ...toAdd];
    combined.sort((a, b) => {
      const diff = (a.stt || 0) - (b.stt || 0);
      if (diff !== 0) return diff;
      return newIds.has(a.nv_id) ? -1 : 1;
    });
    combined = combined.map((r, i) => ({ ...r, stt: i + 1 }));
    persistNvSnap(combined);
    setShowAdd(false);
    if (isConnected() && getKpiSnapshot(thang)) {
      const nvLib = getNvLibrary();
      const nvLibMap = Object.fromEntries(nvLib.map(n => [n.nv_id, n]));
      const addedNvsResolved = toAdd.map(r => ({
        nv_id:   r.nv_id,
        ho_ten:  nvLibMap[r.nv_id]?.ho_ten || r.nv_id,
        nhom_cv: r.nhom_cv || '',
        khu_vuc: r.khu_vuc || '',
      }));
      const orderedNvIds = combined.map(r => r.nv_id);
      updateInputCNNvs(thang, addedNvsResolved, [], orderedNvIds).catch(e => console.warn('[updateInputCNNvs]', e.message));
    }
  };

  const handleRemoveNv = nv_id => {
    if (!confirm('Bỏ nhân viên này khỏi tháng?')) return;
    const snap = getNvSnapshot(thang);
    const refs = (snap?.nvRefs || []).filter(r => r.nv_id !== nv_id).map((r, i) => ({ ...r, stt: i + 1 }));
    persistNvSnap(refs);
    if (isConnected() && getKpiSnapshot(thang)) {
      const orderedNvIds = refs.map(r => r.nv_id);
      updateInputCNNvs(thang, [], [nv_id], orderedNvIds).catch(e => console.warn('[updateInputCNNvs]', e.message));
    }
  };

  const nvInMonthIds = new Set(nvList.map(n => n.nv_id));
  const nvNotInMonth = getNvLibrary().filter(n => !nvInMonthIds.has(n.nv_id));
  const { sortKey, sortDir, handleSort, sortIcon, thCls, sortItems } = useSortConfig('stt');
  const sortedNvList = useMemo(
    () => sortItems(nvList, { stt: n => n.stt || 0, trang_thai: n => n.archived_at ? 1 : 0 }),
    [nvList, sortKey, sortDir] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-800">
        📅 <strong>Danh sách nhân viên theo tháng</strong> — mỗi tháng cần tạo danh sách nhân viên riêng tùy theo tình hình nhân sự, phân công công việc thực tế
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {nvThangList.length > 0
          ? <YearMonthPicker thangList={nvThangList} value={thang} onChange={setThang} />
          : <span className="text-sm text-slate-400 italic">-- Chưa có tháng --</span>}
        <span className="text-xs text-slate-400">{thang && nvThangList.length ? `${nvList.length} NV` : ''}</span>
        <div className="ml-auto flex flex-wrap gap-2 justify-end">
          <button
            className="btn-secondary text-sm disabled:opacity-40 disabled:pointer-events-none"
            disabled={nvThangList.length === 0 || nvNotInMonth.length === 0}
            onClick={() => setShowAdd(true)}>
            + Thêm NV
          </button>
          <button
            className="btn-secondary text-sm text-red-500 hover:text-red-700 disabled:opacity-40 disabled:pointer-events-none"
            disabled={nvThangList.length === 0}
            onClick={handleDeleteMonth}>
            🗑️ Xóa tháng
          </button>
          <button className="btn-primary text-sm" onClick={() => setShowCreate(true)}>+ Thêm tháng</button>
        </div>
      </div>

      {nvThangList.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-6 text-sm text-yellow-800 text-center">
          Chưa có tháng nào. Bấm <strong>&quot;+ Thêm tháng&quot;</strong> để tạo danh sách nhân viên theo tháng.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-blue-50 border-b border-blue-100">
                <tr>
                  <th className={`${thCls('stt')} w-8 text-center`} onClick={() => handleSort('stt')}>STT {sortIcon('stt')}</th>
                  <th className={`${thCls('nv_id')} w-20 hidden sm:table-cell`} onClick={() => handleSort('nv_id')}>Mã NV {sortIcon('nv_id')}</th>
                  <th className={thCls('ho_ten')} onClick={() => handleSort('ho_ten')}>Họ tên {sortIcon('ho_ten')}</th>
                  <th className={`${thCls('nhom_cv')} w-40 hidden md:table-cell`} onClick={() => handleSort('nhom_cv')}>Nhóm CV {sortIcon('nhom_cv')}</th>
                  <th className={`${thCls('khu_vuc')} w-32 hidden sm:table-cell`} onClick={() => handleSort('khu_vuc')}>Khu vực {sortIcon('khu_vuc')}</th>
                  <th className={`${thCls('trang_thai')} w-28 text-center hidden md:table-cell`} onClick={() => handleSort('trang_thai')}>Trạng thái {sortIcon('trang_thai')}</th>
                  <th className="th w-20 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {nvList.length === 0 && !showAdd && (
                  <tr><td colSpan={7} className="td text-center text-slate-400 py-8">Chưa có nhân viên nào trong tháng này</td></tr>
                )}
                {sortedNvList.map(n => [
                  <tr key={n.nv_id} className={`border-t border-slate-100 hover:bg-slate-50 ${n.archived_at ? 'opacity-60' : ''}`}>
                    <td className="td text-center text-slate-400">{n.stt}</td>
                    <td className="td font-mono text-xs text-blue-600 hidden sm:table-cell">{n.nv_id}</td>
                    <td className="td font-medium text-slate-900">
                      {n.ho_ten}
                      <span className="block text-[10px] font-mono text-blue-500 sm:hidden">{n.nv_id}</span>
                      <span className="block text-[10px] text-slate-500 sm:hidden">{n.khu_vuc}</span>
                    </td>
                    <td className="td text-slate-600 text-sm hidden md:table-cell">{n.nhom_cv}</td>
                    <td className="td text-slate-600 text-sm hidden sm:table-cell">{n.khu_vuc}</td>
                    <td className="td text-center hidden md:table-cell">
                      <span className={`badge whitespace-nowrap ${!n.archived_at ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'}`}>
                        {n.archived_at ? 'Đã nghỉ' : 'Đang làm việc'}
                      </span>
                    </td>
                    <td className="td text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setEditingId(editingId === n.nv_id ? null : n.nv_id)}
                          className="p-1.5 text-slate-400 hover:text-blue-600" title="Sửa">✏️</button>
                        <button onClick={() => handleRemoveNv(n.nv_id)}
                          className="p-1.5 text-slate-400 hover:text-red-600" title="Bỏ khỏi tháng">✕</button>
                      </div>
                    </td>
                  </tr>,
                  editingId === n.nv_id && (
                    <NvMonthEditRow key={`edit-${n.nv_id}`} nv={n} nhomCvList={nhomCvList} khuVucList={khuVucList}
                      onSave={handleSaveEdit} onCancel={() => setEditingId(null)} />
                  ),
                ])}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateNvThangModal existingThangList={nvThangList}
          onConfirm={handleCreateMonth} onClose={() => setShowCreate(false)} />
      )}
      {showAdd && (
        <AddNvModal
          nvNotInMonth={nvNotInMonth}
          nhomCvList={nhomCvList}
          khuVucList={khuVucList}
          defaultStt={nvList.length + 1}
          onConfirm={handleAddNvBulk}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

// ── DanhSachNVModule — module "Danh sách nhân viên" ──────────────────────────

const TAB_TITLES_NV = {
  thuvienNV: '📚 Thư viện nhân viên',
  nvthang:   '📅 Danh sách nhân viên theo tháng',
};

export default function DanhSachNVModule() {
  const { tab: urlTab = 'thuvienNV' } = useParams();
  const { user } = useAuth();
  if (!canEditDept(user)) return <div className="p-3 md:p-6"><h2 className="text-xl font-bold text-slate-900">Danh sách nhân viên</h2><div className="mt-6"><AccessDenied /></div></div>;
  return (
    <div className="p-3 md:p-6 space-y-5">
      <div>
        <h2 className="text-lg md:text-xl font-bold text-slate-900">{TAB_TITLES_NV[urlTab] ?? 'Danh sách nhân viên'}</h2>
        <p className="text-slate-500 text-xs mt-0.5">
          Quản lý thư viện nhân viên, nhóm công việc, khu vực và danh sách nhân viên theo từng tháng
        </p>
      </div>
      {urlTab === 'thuvienNV' && <ThuVienNV />}
      {urlTab === 'nvthang'   && <NvTheoThang />}
    </div>
  );
}
