/**
 * @file WeightManagement.jsx
 * @description Menu "Quản lý trọng số" — cấu hình và nhập trọng số KPI per tháng.
 *
 * SUB-MENU:
 * - /trongso/cauhinh → CauHinhTab: Tỷ lệ cấp, chọn mode, cấu hình nhóm KPI/tỷ lệ % (auto mode)
 * - /trongso/canhan  → CanhanTab: Trọng số cá nhân (ManualWeightGrid hoặc NvOverrideTab)
 *
 * CHẾ ĐỘ TRỌNG SỐ (mode per tháng):
 * - 'manual': NV nhập trực tiếp qua modal/Excel/ManualWeightGrid; input_cn_nv là nguồn chính.
 * - 'auto': Hệ thống tính từ cấu hình nhóm KPI; config_store key trong_so_weights_YYYY-MM.
 *   calcMonth tự detect mode qua sự hiện diện/vắng của trong_so_weights_YYYY-MM.
 *
 * DỮ LIỆU ĐẦU VÀO:
 * - trong_so_thang_YYYY-MM (localStorage): config mode + ty_le + nhom_kpi + cv_priorities
 * - kpi_snapshot_YYYY-MM: danh sách KPI tháng đó
 * - nv_snapshot_YYYY-MM: danh sách NV tháng đó
 * - input_cn (localStorage): _trong_so hiện tại của từng NV
 *
 * DỮ LIỆU ĐẦU RA:
 * - trong_so_thang_YYYY-MM → syncStore (Supabase config_store)
 * - trong_so_weights_YYYY-MM → syncToGas (Supabase config_store) — chỉ khi mode='auto'
 * - Cột _trong_so của input_cn_nv → syncWeightConfig
 *
 * PHÂN QUYỀN (TODO):
 * - CauHinhTab và nút "Lưu & Sync": chỉ admin/trưởng phòng mới có quyền.
 * - CanhanTab (ManualWeightGrid): quản lý chỉnh cho NV mình phụ trách.
 *
 * LƯU Ý:
 * - Chuyển auto→manual: phải deleteFromGas('trong_so_weights_*') để xóa key trong config_store.
 * - normalizeWeightsToInt dùng largest-remainder method → tổng luôn = target chính xác.
 * - Nút "Lưu & Sync" trong ManualWeightGrid KHÔNG ghi trong_so_weights — chỉ ghi sheet.
 */
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { setNavGuard, clearNavGuard } from '../utils/navGuard';
import { useAuth, canEditDept } from '../contexts/AuthContext';
import { AccessDenied } from './Layout';
import YearMonthPicker, { defaultThang } from './YearMonthPicker';
import {
  getSnapshotThangList, getKpiSnapshot,
  getNvListForThang, getNhomCvList, getNvSnapshot,
  getTrongSoConfig, saveTrongSoConfig,
  recomputeAllKpiPct, recomputeKpiPctForNhom, computeNvWeights,
  syncToGas, deleteFromGas,
  getInputCNByThang, upsertInputCN,
} from '../services/store';
import { isConnected, syncWeightConfig, getInputCN as gasGetInputCN } from '../services/supabaseService';
import XLSXStyle from 'xlsx-js-style';

// ─── Helpers ────────────────────────────────────────────────────────────────

let _idCounter = Date.now();
const genId = () => 'nk_' + (_idCounter++).toString(36);

function createDefaultConfig(thang) {
  return {
    thang,
    mode: 'manual',
    ty_le: {
      phong:   { cty: 50, phong: 50 },
      ca_nhan: { phong: 30, ca_nhan: 70 },
    },
    w_max_ref:    20,
    w_min_ref:    10,
    nhom_kpi:     [],
    cv_config:    {},
    cv_priorities: {},
    kpi_pct:      {},
    nv_override:  {},
  };
}

// Chuyển cv_priorities từ format cũ {nhomKpiId: {kpi_id: priority}} sang flat {kpi_id: priority}
function normalizePriorities(config) {
  if (!config.cv_priorities) return config;
  const newCvPrio = {};
  Object.entries(config.cv_priorities).forEach(([nhomCv, prioMap]) => {
    if (!prioMap) { newCvPrio[nhomCv] = {}; return; }
    const isNested = Object.values(prioMap).some(v => typeof v === 'object' && v !== null);
    if (!isNested) { newCvPrio[nhomCv] = prioMap; return; }
    const flat = {};
    Object.values(prioMap).forEach(nhomPrio => {
      if (typeof nhomPrio !== 'object' || nhomPrio === null) return;
      Object.entries(nhomPrio).forEach(([kpiId, p]) => {
        if (p != null && flat[kpiId] == null) flat[kpiId] = p;
      });
    });
    const sorted = Object.entries(flat).sort(([, a], [, b]) => a - b);
    const result = {};
    sorted.forEach(([id], i) => { result[id] = i + 1; });
    newCvPrio[nhomCv] = result;
  });
  return { ...config, cv_priorities: newCvPrio };
}

// Đặt lại priority toàn cục, hỗ trợ 3 loại: số 1..N, 'fixed', null
// 'fixed' KPI không tham gia renumber, chỉ numeric priorities được renumber liên tục 1..N
function reorderPriorities(existing, kpiId, newPriority) {
  const numericOthers = Object.entries(existing)
    .filter(([id, p]) => id !== kpiId && typeof p === 'number')
    .sort(([, a], [, b]) => a - b)
    .map(([id]) => id);
  const result = {};
  Object.entries(existing).forEach(([id, p]) => {
    if (id !== kpiId && p === 'fixed') result[id] = 'fixed';
  });
  if (newPriority === 'fixed') {
    result[kpiId] = 'fixed';
    numericOthers.forEach((id, i) => { result[id] = i + 1; });
    return result;
  }
  if (newPriority == null) {
    numericOthers.forEach((id, i) => { result[id] = i + 1; });
    return result;
  }
  const idx = Math.max(0, Math.min(newPriority - 1, numericOthers.length));
  numericOthers.splice(idx, 0, kpiId);
  numericOthers.forEach((id, i) => { result[id] = i + 1; });
  return result;
}

function fmt2(n) { return parseFloat(n.toFixed(2)); }

function TyLeNumInput({ value, onChange: onCh, readOnly }) {
  return (
    <input type="number" min="0" max="100" step="5"
      className={`input w-16 text-center ${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
      value={value}
      disabled={readOnly}
      onChange={e => onCh(e.target.value)} />
  );
}

// ─── Phần 1: Tỷ lệ cấp ──────────────────────────────────────────────────────

function TyLeCap({ config, kpiList, onChange, readOnly }) {
  const { ty_le } = config;

  const update = (group, side, raw) => {
    if (readOnly) return;
    const val = Math.min(100, Math.max(0, parseInt(raw) || 0));
    const other = 100 - val;
    const newTL = { ...ty_le };
    if (group === 'phong')
      newTL.phong = side === 'cty' ? { cty: val, phong: other } : { cty: other, phong: val };
    else
      newTL.ca_nhan = side === 'phong' ? { phong: val, ca_nhan: other } : { phong: other, ca_nhan: val };

    let newCfg = { ...config, ty_le: newTL };
    if (group === 'ca_nhan' && config.nhom_kpi.length > 0) {
      const oldPct = config.ty_le?.ca_nhan?.ca_nhan ?? 70;
      const newPct = newTL.ca_nhan.ca_nhan;
      if (newPct !== oldPct && oldPct > 0) {
        const ratio = newPct / oldPct;
        newCfg = {
          ...newCfg,
          nhom_kpi: config.nhom_kpi.map(n => ({ ...n, pct: Math.round((parseFloat(n.pct) || 0) * ratio * 10) / 10 })),
        };
        newCfg = recomputeAllKpiPct(newCfg, kpiList);
      }
    }
    onChange(newCfg);
  };

  return (
    <div className="card p-4">
      <h3 className="font-semibold text-gray-800 mb-3">Bước 1 — Cấu hình tỷ lệ trọng số giữa các cấp</h3>
      <div className="space-y-3 text-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
          <span className="font-medium text-gray-700 sm:w-36">Điểm KPI phòng =</span>
          <div className="flex items-center gap-2 flex-wrap">
            <TyLeNumInput value={ty_le.phong.cty}   onChange={v => update('phong', 'cty', v)} readOnly={readOnly} />
            <span className="text-gray-500">% Công ty</span>
            <span className="text-gray-400">+</span>
            <TyLeNumInput value={ty_le.phong.phong} onChange={v => update('phong', 'phong', v)} readOnly={readOnly} />
            <span className="text-gray-500">% Phòng</span>
            <span className="text-gray-400 text-xs">(tổng {ty_le.phong.cty + ty_le.phong.phong}%)</span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
          <span className="font-medium text-gray-700 sm:w-36">Điểm KPI cá nhân =</span>
          <div className="flex items-center gap-2 flex-wrap">
            <TyLeNumInput value={ty_le.ca_nhan.phong}    onChange={v => update('ca_nhan', 'phong', v)} readOnly={readOnly} />
            <span className="text-gray-500">% Phòng</span>
            <span className="text-gray-400">+</span>
            <TyLeNumInput value={ty_le.ca_nhan.ca_nhan}  onChange={v => update('ca_nhan', 'ca_nhan', v)} readOnly={readOnly} />
            <span className="text-gray-500">% Cá nhân</span>
            <span className="text-gray-400 text-xs">(tổng {ty_le.ca_nhan.phong + ty_le.ca_nhan.ca_nhan}%)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Bước 2: Nhóm KPI toàn cục + % tổng ─────────────────────────────────────

function NhomKpiPanel({ config, kpiList, onChange, readOnly }) {
  const [newTen, setNewTen]         = useState('');
  const [newPct, setNewPct]         = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameTen, setRenameTen]   = useState('');

  const ca_nhan_pct = config.ty_le?.ca_nhan?.ca_nhan ?? 70;
  const totalPct    = config.nhom_kpi.reduce((s, n) => s + (parseFloat(n.pct) || 0), 0);
  const remaining   = ca_nhan_pct - totalPct;
  const overBudget  = totalPct > ca_nhan_pct + 0.01;
  const balanced    = Math.abs(remaining) < 0.01;

  const addNhom = () => {
    const ten = newTen.trim();
    if (!ten) return;
    const pct = Math.max(0, parseFloat(newPct) || 0);
    onChange({ ...config, nhom_kpi: [...config.nhom_kpi, { id: genId(), ten, pct }] });
    setNewTen('');
    setNewPct('');
  };

  const deleteNhom = (id) => {
    const inUse = Object.values(config.cv_config || {}).some(cv => (cv[id] || []).length > 0);
    if (inUse && !confirm('Nhóm đang có KPI được gán ở một số nhóm công việc. Xóa nhóm sẽ bỏ gán các KPI đó. Tiếp tục?')) return;
    const newCvConfig = {};
    Object.entries(config.cv_config || {}).forEach(([nhomCv, cvCfg]) => {
      const { [id]: _, ...rest } = cvCfg;
      newCvConfig[nhomCv] = rest;
    });
    const newCfg = { ...config, nhom_kpi: config.nhom_kpi.filter(n => n.id !== id), cv_config: newCvConfig };
    onChange(recomputeAllKpiPct(newCfg, kpiList));
  };

  const renameNhom = (id) => {
    const ten = renameTen.trim();
    if (!ten) return;
    onChange({ ...config, nhom_kpi: config.nhom_kpi.map(n => n.id === id ? { ...n, ten } : n) });
    setRenamingId(null);
  };

  const updatePct = (id, raw) => {
    const val = Math.max(0, parseFloat(raw) || 0);
    onChange({ ...config, nhom_kpi: config.nhom_kpi.map(n => n.id === id ? { ...n, pct: val } : n) });
  };

  const commitPct = () => {
    onChange(recomputeAllKpiPct(config, kpiList));
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-gray-800">Bước 3 — Tạo nhóm KPI và trọng số tương ứng</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">Tổng:</span>
          <span className={`font-semibold ${overBudget ? 'text-red-600' : balanced ? 'text-green-600' : 'text-orange-500'}`}>
            {fmt2(totalPct)}đ / {ca_nhan_pct}đ
          </span>
          {!balanced && (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${overBudget ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
              {overBudget ? `vượt ${fmt2(-remaining)}đ` : `còn ${fmt2(remaining)}đ`}
            </span>
          )}
          {balanced && <span className="px-2 py-0.5 rounded bg-green-100 text-green-700 text-xs font-medium">✓ Cân bằng</span>}
        </div>
      </div>

      <p className="text-xs text-gray-500">Tạo nhóm để phân loại KPI. Tổng % các nhóm phải bằng {ca_nhan_pct}đ (phần cá nhân).</p>

      {config.nhom_kpi.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-blue-50 border-b border-blue-100">
            <tr>
              <th className="th text-left">Tên nhóm KPI</th>
              <th className="th text-center w-28">tổng trọng số</th>
              <th className="th w-20"></th>
            </tr>
          </thead>
          <tbody>
            {config.nhom_kpi.map(nhom => (
              <tr key={nhom.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="td">
                  {!readOnly && renamingId === nhom.id ? (
                    <div className="flex gap-1">
                      <input autoFocus className="input text-sm flex-1" value={renameTen}
                        onChange={e => setRenameTen(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') renameNhom(nhom.id); if (e.key === 'Escape') setRenamingId(null); }} />
                      <button className="btn-primary text-xs px-2 py-1" onClick={() => renameNhom(nhom.id)}>Lưu</button>
                      <button className="btn-secondary text-xs px-2 py-1" onClick={() => setRenamingId(null)}>Hủy</button>
                    </div>
                  ) : (
                    <span className="font-medium text-gray-800">{nhom.ten}</span>
                  )}
                </td>
                <td className="td text-center">
                  <div className="flex items-center justify-center gap-1">
                    <input type="number" min="0" max={ca_nhan_pct} step="1"
                      className={`input w-16 text-center text-sm py-0.5 ${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                      value={nhom.pct}
                      disabled={readOnly}
                      onChange={e => updatePct(nhom.id, e.target.value)}
                      onBlur={!readOnly ? commitPct : undefined} />
                    <span className="text-gray-400 text-xs">đ</span>
                  </div>
                </td>
                <td className="td text-center">
                  {!readOnly && (
                    <div className="flex items-center justify-center gap-2">
                      {renamingId !== nhom.id && (
                        <button className="text-blue-400 hover:text-blue-600 text-sm"
                          onClick={() => { setRenamingId(nhom.id); setRenameTen(nhom.ten); }}>✏️</button>
                      )}
                      <button className="text-red-400 hover:text-red-600 text-sm" onClick={() => deleteNhom(nhom.id)}>🗑️</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {config.nhom_kpi.length === 0 && (
        <p className="text-gray-400 text-sm italic">Chưa có nhóm KPI nào.</p>
      )}

      {!readOnly && (
        <div className="flex gap-2 pt-1">
          <input className="input text-sm flex-1" placeholder="Tên nhóm KPI mới..."
            value={newTen} onChange={e => setNewTen(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addNhom()} />
          <input type="number" min="0" step="1" placeholder="Tổng đ"
            className="input text-sm w-24 text-center"
            value={newPct} onChange={e => setNewPct(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addNhom()} />
          <button className="btn-primary text-sm px-3" onClick={addNhom}>+ Tạo</button>
        </div>
      )}
    </div>
  );
}

// ─── KpiAddModal — multi-select KPI cho nhóm KPI ────────────────────────────

function KpiAddModal({ nhomId, nhomKpiTen, unassigned, globalPrioritizedCount, onAdd, onClose }) {
  const [phase, setPhase]           = useState(1);
  const [search, setSearch]         = useState('');
  const [selected, setSelected]     = useState(new Set());
  const [assignments, setAssignments] = useState([]);

  const filtered = unassigned.filter(kk => !search || kk.ten_kpi.toLowerCase().includes(search.toLowerCase()));

  const toggleSelect = id => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleProceed = () => {
    const items = unassigned.filter(kk => selected.has(kk.kpi_id));
    setAssignments(items.map((kpi, i) => ({
      kpiId: kpi.kpi_id, tenKpi: kpi.ten_kpi,
      priority: globalPrioritizedCount + i + 1,
    })));
    setPhase(2);
  };

  const updatePriority = (kpiId, val) =>
    setAssignments(prev => prev.map(a => a.kpiId === kpiId ? { ...a, priority: val } : a));

  const removeItem = kpiId =>
    setAssignments(prev => prev.filter(a => a.kpiId !== kpiId));

  const handleConfirm = () => {
    assignments.forEach(a => onAdd(nhomId, a.kpiId, a.priority));
    onClose();
  };

  const maxPrioOpts = globalPrioritizedCount + assignments.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-bold text-gray-800">+ Thêm KPI vào nhóm "{nhomKpiTen}"</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        {phase === 1 ? (
          <>
            <div className="px-4 py-3 border-b flex gap-2 items-center">
              <input className="input flex-1 text-sm" placeholder="🔍 Tìm tên KPI..."
                value={search} onChange={e => setSearch(e.target.value)} autoFocus />
              {selected.size > 0 && <span className="text-xs text-blue-600 font-medium whitespace-nowrap">Đã chọn {selected.size}</span>}
            </div>
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0 ? (
                <p className="text-center text-gray-400 py-10 text-sm">Không có KPI nào chưa được gán.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-blue-50 border-b border-blue-100 sticky top-0">
                    <tr>
                      <th className="th w-8 text-center">
                        <input type="checkbox"
                          checked={selected.size === filtered.length && filtered.length > 0}
                          onChange={e => setSelected(e.target.checked ? new Set(filtered.map(k => k.kpi_id)) : new Set())} />
                      </th>
                      <th className="th text-left">Tên KPI</th>
                      <th className="th w-14 text-center">STT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(kk => (
                      <tr key={kk.kpi_id}
                        className={`border-t border-gray-100 hover:bg-gray-50 cursor-pointer ${selected.has(kk.kpi_id) ? 'bg-blue-50' : ''}`}
                        onClick={() => toggleSelect(kk.kpi_id)}>
                        <td className="td text-center" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(kk.kpi_id)} onChange={() => toggleSelect(kk.kpi_id)} />
                        </td>
                        <td className="td font-medium text-gray-700">{kk.ten_kpi}</td>
                        <td className="td text-center text-gray-400">{kk.stt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-4 border-t flex gap-2 justify-end">
              <button onClick={onClose} className="btn-secondary text-sm">Hủy</button>
              <button onClick={handleProceed} disabled={selected.size === 0}
                className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                Tiếp tục → {selected.size > 0 ? `(${selected.size} KPI)` : ''}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-3 border-b flex items-center gap-3">
              <button onClick={() => setPhase(1)} className="text-xs text-blue-600 hover:text-blue-800">← Chọn lại</button>
              <span className="text-sm text-gray-600">{assignments.length} KPI — đặt mức ưu tiên</span>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-xs">
                <thead className="bg-blue-50 border-b border-blue-100 sticky top-0">
                  <tr>
                    <th className="th text-left">Tên KPI</th>
                    <th className="th w-36 text-center">Mức ưu tiên</th>
                    <th className="th w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a.kpiId} className="border-t border-gray-100">
                      <td className="td text-gray-700 font-medium">{a.tenKpi}</td>
                      <td className="td text-center">
                        <select
                          className="input text-xs py-0.5 w-28 text-center"
                          value={a.priority ?? ''}
                          onChange={e => {
                            const v = e.target.value;
                            updatePriority(a.kpiId, v === '' ? null : v === 'fixed' ? 'fixed' : parseInt(v));
                          }}
                        >
                          <option value="">— (0đ)</option>
                          <option value="fixed">📌 Cố định</option>
                          {Array.from({ length: maxPrioOpts }, (_, i) => i + 1).map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </td>
                      <td className="td text-center">
                        <button className="text-gray-300 hover:text-red-500" onClick={() => removeItem(a.kpiId)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-4 border-t flex gap-2 justify-end">
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

// ─── Export trọng số nhóm CV ra Excel ─────────────────────────────────────────

const EXCEL_HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Segoe UI' },
  fill: { fgColor: { rgb: '1E40AF' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: { top: { style: 'thin', color: { rgb: '93C5FD' } }, bottom: { style: 'thin', color: { rgb: '93C5FD' } }, left: { style: 'thin', color: { rgb: '93C5FD' } }, right: { style: 'thin', color: { rgb: '93C5FD' } } },
};

const excelDataStyle = (isEven) => ({
  font: { sz: 10, name: 'Segoe UI' },
  fill: { fgColor: { rgb: isEven ? 'F0F9FF' : 'FFFFFF' } },
  alignment: { vertical: 'center', wrapText: false },
  border: { top: { style: 'thin', color: { rgb: 'E2E8F0' } }, bottom: { style: 'thin', color: { rgb: 'E2E8F0' } }, left: { style: 'thin', color: { rgb: 'E2E8F0' } }, right: { style: 'thin', color: { rgb: 'E2E8F0' } } },
});

function exportNhomWeightsToExcel(thang, nhomCvList, config, kpiList) {
  const wb = XLSXStyle.utils.book_new();
  const kpiIdSet = new Set(kpiList.map(k => k.kpi_id));

  nhomCvList.forEach(nhomCv => {
    const cvCfg        = config.cv_config?.[nhomCv] || {};
    const cvPriorities = config.cv_priorities?.[nhomCv] || {};
    const kpiPct       = config.kpi_pct?.[nhomCv] || {};

    const assignedKpis = [];
    (config.nhom_kpi || []).forEach(nhom => {
      (cvCfg[nhom.id] || []).forEach(id => {
        const kpi = kpiList.find(k => k.kpi_id === id);
        if (kpi && kpiIdSet.has(id)) assignedKpis.push(kpi);
      });
    });

    assignedKpis.sort((a, b) => {
      const pa = cvPriorities[a.kpi_id];
      const pb = cvPriorities[b.kpi_id];
      const na = typeof pa === 'number' ? pa : pa === 'fixed' ? 9998 : 9999;
      const nb = typeof pb === 'number' ? pb : pb === 'fixed' ? 9998 : 9999;
      return na - nb;
    });

    const headers = ['Mức ưu tiên', 'Tên KPI', 'Trọng số (đ)'];
    const rows = assignedKpis.map(kpi => {
      const prio     = cvPriorities[kpi.kpi_id] ?? null;
      const prioLabel = prio === 'fixed' ? 'Cố định' : prio == null ? 'Không tính' : `${prio}`;
      const pct      = kpiPct[kpi.kpi_id]?.pct || 0;
      return [prioLabel, kpi.ten_kpi, pct];
    });

    const ws = XLSXStyle.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 14 }, { wch: 38 }, { wch: 14 }];
    ws['!rows'] = [{ hpt: 25 }, ...rows.map(() => ({ hpt: 20 }))];

    headers.forEach((h, ci) => {
      const addr = XLSXStyle.utils.encode_cell({ r: 0, c: ci });
      ws[addr] = { v: h, t: 's', s: EXCEL_HEADER_STYLE };
    });

    rows.forEach((row, ri) => {
      const ds = excelDataStyle(ri % 2 === 0);
      row.forEach((val, ci) => {
        const addr = XLSXStyle.utils.encode_cell({ r: ri + 1, c: ci });
        ws[addr] = {
          v: val, t: typeof val === 'number' ? 'n' : 's',
          s: { ...ds, alignment: { ...ds.alignment, horizontal: ci === 1 ? 'left' : 'center' } },
        };
      });
    });

    XLSXStyle.utils.book_append_sheet(wb, ws, nhomCv.slice(0, 31));
  });

  if (!wb.SheetNames.length) return;
  XLSXStyle.writeFile(wb, `TrongSo_NhomCV_${thang}.xlsx`);
}

// ─── Export trọng số cá nhân ra Excel ─────────────────────────────────────────

function exportNvWeightsToExcel(thang, kpiList, nvList, weightsMap) {
  const wb = XLSXStyle.utils.book_new();

  nvList.forEach(nv => {
    const weights = weightsMap[nv.nv_id] || {};
    const headers = ['STT', 'Tên KPI', 'Trọng số (đ)'];
    const rows    = kpiList.map(k => [k.stt, k.ten_kpi, weights[k.kpi_id] ?? 0]);

    const ws = XLSXStyle.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 6 }, { wch: 55 }, { wch: 14 }];
    ws['!rows'] = [{ hpt: 25 }, ...rows.map(() => ({ hpt: 20 }))];

    headers.forEach((h, ci) => {
      const addr = XLSXStyle.utils.encode_cell({ r: 0, c: ci });
      ws[addr] = { v: h, t: 's', s: EXCEL_HEADER_STYLE };
    });

    rows.forEach((row, ri) => {
      const ds = excelDataStyle(ri % 2 === 0);
      row.forEach((val, ci) => {
        const addr = XLSXStyle.utils.encode_cell({ r: ri + 1, c: ci });
        ws[addr] = {
          v: val, t: typeof val === 'number' ? 'n' : 's',
          s: { ...ds, alignment: { ...ds.alignment, horizontal: ci !== 1 ? 'center' : 'left' } },
        };
      });
    });

    XLSXStyle.utils.book_append_sheet(wb, ws, nv.ho_ten.slice(0, 31));
  });

  if (!wb.SheetNames.length) return;
  XLSXStyle.writeFile(wb, `TrongSo_CaNhan_${thang}.xlsx`);
}

// ─── Bước 3: Cấu hình KPI per nhóm công việc ─────────────────────────────────

function CvConfigPanel({ thang, config, nhomCvList, kpiList, onChange, readOnly }) {
  const [selNhomCv, setSelNhomCv]   = useState(nhomCvList[0] || '');
  const [editingKpi, setEditingKpi] = useState(null);
  const [editVal, setEditVal]       = useState('');
  const [addModal, setAddModal]     = useState(null); // { nhomId, nhomKpiTen } hoặc null

  useEffect(() => { if (readOnly) setEditingKpi(null); }, [readOnly]);

  const ca_nhan_pct = config.ty_le?.ca_nhan?.ca_nhan ?? 70;
  const wMaxRef     = config.w_max_ref ?? 20;
  const wMinRef     = config.w_min_ref ?? 10;

  if (!config.nhom_kpi.length) {
    return (
      <div className="card p-4">
        <h3 className="font-semibold text-gray-800 mb-2">Bước 4 — Cấu hình KPI theo nhóm công việc</h3>
        <p className="text-gray-400 text-sm italic">Tạo nhóm KPI ở Bước 3 trước.</p>
      </div>
    );
  }

  const cvCfg        = config.cv_config?.[selNhomCv] || {};
  const cvPriorities = config.cv_priorities?.[selNhomCv] || {};
  const kpiPct       = config.kpi_pct?.[selNhomCv] || {};

  const kpiIdSet               = new Set(kpiList.map(k => k.kpi_id));
  const allAssignedIds         = new Set(Object.values(cvCfg).flat().filter(id => kpiIdSet.has(id)));
  const unassigned             = kpiList.filter(kk => !allAssignedIds.has(kk.kpi_id));
  const globalPrioritizedCount = [...allAssignedIds].filter(id => typeof cvPriorities[id] === 'number').length;
  const totalAssigned          = Object.entries(kpiPct).filter(([id]) => kpiIdSet.has(id)).reduce((s, [, e]) => s + (e?.pct || 0), 0);

  const assignedArr   = [...allAssignedIds];
  const fixedSum      = assignedArr.filter(id => cvPriorities[id] === 'fixed').reduce((s, id) => s + (kpiPct[id]?.pct || 0), 0);
  const customAutoSum = assignedArr.filter(id => typeof cvPriorities[id] === 'number' && kpiPct[id]?.custom).reduce((s, id) => s + (kpiPct[id]?.pct || 0), 0);
  const autoBudget    = Math.max(0, ca_nhan_pct - fixedSum - customAutoSum);
  const autoN         = assignedArr.filter(id => typeof cvPriorities[id] === 'number' && !kpiPct[id]?.custom).length;
  const _avg          = autoN > 0 ? autoBudget / autoN : 0;
  const _bFMax        = autoN > 1 ? 2 * (wMaxRef - _avg) / (autoN - 1) : 0;
  const _bFMin        = autoN > 1 ? 2 * (_avg - wMinRef) / (autoN - 1) : 0;
  const _b            = Math.max(0, Math.min(_bFMax, _bFMin));
  const _a            = _avg - _b * (autoN - 1) / 2;
  const previewMax    = autoN > 0 ? fmt2(_a + _b * (autoN - 1)) : null;
  const previewMin    = autoN > 0 ? fmt2(_a) : null;
  const maxBinds  = autoN > 1 && _bFMax <= _bFMin;
  const minBinds  = autoN > 1 && _bFMin < _bFMax;
  const reqBudget = autoN > 0 ? Math.ceil(autoN * (wMaxRef + wMinRef) / 2) : 0;

  const summary = nhomCvList.map(cv => {
    const pct = config.kpi_pct?.[cv] || {};
    const tot = Object.entries(pct).filter(([id]) => kpiIdSet.has(id)).reduce((s, [, e]) => s + (e?.pct || 0), 0);
    return { cv, tot };
  });

  const setCvPriorities = (newPrioMap) => ({
    ...config.cv_priorities,
    [selNhomCv]: newPrioMap,
  });

  const assignKpi = (nhomKpiId, kpiId, priority) => {
    if (!kpiId) return;
    const prev       = cvCfg[nhomKpiId] || [];
    const newCvCfg   = { ...config.cv_config, [selNhomCv]: { ...cvCfg, [nhomKpiId]: [...prev, kpiId] } };
    const newPrioMap = reorderPriorities(cvPriorities, kpiId, priority ?? null);
    let newKpiPct    = { ...kpiPct };
    if (priority === 'fixed') newKpiPct = { ...newKpiPct, [kpiId]: { pct: 0, custom: true } };
    const tempCfg = {
      ...config,
      cv_config:     newCvCfg,
      cv_priorities: setCvPriorities(newPrioMap),
      kpi_pct:       { ...config.kpi_pct, [selNhomCv]: newKpiPct },
    };
    onChange(recomputeAllKpiPct(tempCfg, kpiList));
  };

  const removeKpi = (nhomKpiId, kpiId) => {
    const prev       = cvCfg[nhomKpiId] || [];
    const newCvCfg   = { ...config.cv_config, [selNhomCv]: { ...cvCfg, [nhomKpiId]: prev.filter(id => id !== kpiId) } };
    const newPrioMap = reorderPriorities(cvPriorities, kpiId, null);
    const newKpiPct  = { ...kpiPct };
    delete newKpiPct[kpiId];
    const tempCfg = {
      ...config,
      cv_config:     newCvCfg,
      cv_priorities: setCvPriorities(newPrioMap),
      kpi_pct:       { ...config.kpi_pct, [selNhomCv]: newKpiPct },
    };
    onChange(recomputeAllKpiPct(tempCfg, kpiList));
  };

  const updatePriority = (kpiId, newPriority) => {
    const newPrioMap  = reorderPriorities(cvPriorities, kpiId, newPriority);
    const oldPriority = cvPriorities[kpiId];
    let newKpiPct     = { ...kpiPct };
    if (newPriority === 'fixed' && oldPriority !== 'fixed') {
      newKpiPct = { ...newKpiPct, [kpiId]: { pct: newKpiPct[kpiId]?.pct ?? 0, custom: true } };
    } else if (oldPriority === 'fixed' && newPriority !== 'fixed') {
      newKpiPct = { ...newKpiPct, [kpiId]: { ...(newKpiPct[kpiId] || {}), custom: false } };
    }
    const tempCfg = {
      ...config,
      cv_priorities: setCvPriorities(newPrioMap),
      kpi_pct:       { ...config.kpi_pct, [selNhomCv]: newKpiPct },
    };
    onChange(recomputeAllKpiPct(tempCfg, kpiList));
  };

  const commitKpiEdit = (kpiId) => {
    const val       = parseFloat(editVal) || 0;
    const newKpiPct = { ...kpiPct, [kpiId]: { pct: val, custom: true } };
    const tempCfg   = { ...config, kpi_pct: { ...config.kpi_pct, [selNhomCv]: newKpiPct } };
    const recomp    = recomputeKpiPctForNhom(selNhomCv, tempCfg, kpiList);
    onChange({ ...tempCfg, kpi_pct: { ...config.kpi_pct, [selNhomCv]: recomp } });
    setEditingKpi(null);
  };

  const resetKpi = (kpiId) => {
    const newKpiPct = { ...kpiPct, [kpiId]: { ...(kpiPct[kpiId] || {}), custom: false } };
    const tempCfg   = { ...config, kpi_pct: { ...config.kpi_pct, [selNhomCv]: newKpiPct } };
    const recomp    = recomputeKpiPctForNhom(selNhomCv, tempCfg, kpiList);
    onChange({ ...tempCfg, kpi_pct: { ...config.kpi_pct, [selNhomCv]: recomp } });
  };

  const overBudget = totalAssigned > ca_nhan_pct + 0.01;
  const balanced   = Math.abs(totalAssigned - ca_nhan_pct) < 0.01;

  return (
    <div className="card p-4 space-y-4">
      {addModal && (
        <KpiAddModal
          nhomId={addModal.nhomId}
          nhomKpiTen={addModal.nhomKpiTen}
          unassigned={unassigned}
          globalPrioritizedCount={globalPrioritizedCount}
          onAdd={assignKpi}
          onClose={() => setAddModal(null)}
        />
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="font-semibold text-gray-800">Bước 4 — Cấu hình KPI theo nhóm công việc</h3>
          <button className="btn-secondary text-xs px-3 py-1.5"
            onClick={() => exportNhomWeightsToExcel(thang, nhomCvList, config, kpiList)}
            disabled={kpiList.length === 0 || nhomCvList.length === 0}
            title="Xuất trọng số nhóm CV ra Excel">
            📥 Xuất Excel
          </button>
        </div>
        <select className="input text-sm w-full sm:w-52" value={selNhomCv}
          onChange={e => { setSelNhomCv(e.target.value); setEditingKpi(null); setAddModal(null); }}>
          {nhomCvList.map(n => <option key={n}>{n}</option>)}
        </select>
      </div>

      {/* Cấu hình Constrained Linear Allocation */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-sm text-gray-700 font-medium whitespace-nowrap">Phân bổ tự động:</span>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 whitespace-nowrap">Điểm KPI cao nhất:</label>
            <input type="number" min="1" max={ca_nhan_pct} step="0.5"
              className={`input w-16 text-center text-sm py-0.5 ${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
              value={wMaxRef}
              disabled={readOnly}
              onChange={e => {
                if (readOnly) return;
                const val = Math.max(1, parseFloat(e.target.value) || 20);
                onChange(recomputeAllKpiPct({ ...config, w_max_ref: val }, kpiList));
              }} />
            <span className="text-xs text-gray-400">đ</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 whitespace-nowrap">Điểm KPI thấp nhất:</label>
            <input type="number" min="0" max={ca_nhan_pct} step="0.5"
              className={`input w-16 text-center text-sm py-0.5 ${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
              value={wMinRef}
              disabled={readOnly}
              onChange={e => {
                if (readOnly) return;
                const val = Math.max(0, parseFloat(e.target.value) || 10);
                onChange(recomputeAllKpiPct({ ...config, w_min_ref: val }, kpiList));
              }} />
            <span className="text-xs text-gray-400">đ</span>
          </div>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          Hệ thống chia điểm giảm dần theo thứ tự ưu tiên — KPI quan trọng nhất nhận nhiều nhất, ít quan trọng hơn nhận ít hơn. Thực hiện đặt mức điểm cao nhất và thấp nhất mong muốn; hệ thống sẽ tự cân bằng để tổng điểm luôn đúng.
          {_b > 0 && maxBinds && (
            <span className="block mt-1 text-blue-700">
              ✅ Với {autoN} KPI (ngân sách {fmt2(autoBudget)}đ): KPI ưu tiên 1 = <strong>{previewMax}đ</strong> (đúng mức cao nhất đã đặt), KPI ưu tiên {autoN} = <strong>{previewMin}đ</strong>.
            </span>
          )}
          {_b > 0 && minBinds && (
            <span className="block mt-1 text-amber-700">
              ⚠️ Ngân sách {fmt2(autoBudget)}đ cho {autoN} KPI chưa đủ để KPI ưu tiên 1 đạt {wMaxRef}đ.{' '}
              Kết quả: KPI ưu tiên 1 = <strong>{previewMax}đ</strong>, KPI ưu tiên {autoN} = <strong>{previewMin}đ</strong> (đúng mức thấp nhất đã đặt).{' '}
              Muốn KPI ưu tiên 1 đạt đúng {wMaxRef}đ, cần tăng ngân sách điểm lên ít nhất <strong>{reqBudget}đ</strong>.
            </span>
          )}
          {autoN > 1 && _b <= 0 && (
            <span className="block mt-1 text-red-600">
              ⚠️ Cài đặt mâu thuẫn: mức thấp nhất hoặc cao nhất không hợp lệ so với ngân sách. Tất cả {autoN} KPI nhận đều nhau ~{fmt2(_avg)}đ.
            </span>
          )}
        </p>
      </div>

      {/* Hướng dẫn loại ưu tiên */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 space-y-1">
        <p className="font-medium text-gray-700">Cách sử dụng cột "Mức ưu tiên":</p>
        <div className="grid grid-cols-1 gap-0.5">
          <span><span className="inline-block w-5 text-center font-bold text-blue-600">N</span> <strong>1..N — Tự động:</strong> hệ thống tự tính điểm theo thứ tự ưu tiên — ưu tiên 1 nhiều nhất, ưu tiên N ít nhất. Có thể chỉnh tay (cam ✏️), bấm ↺ để về tự động.</span>
          <span><span className="inline-block w-5 text-center">📌</span> <strong>Cố định:</strong> trọng số cố định, thực hiện nhập bằng tay. Không tham gia phân bổ tự động — phần còn lại chia cho nhóm 1..N.</span>
          <span><span className="inline-block w-5 text-center text-gray-400">—</span> <strong>Không tính:</strong> trọng số = 0đ, KPI không được chấm điểm tháng này.</span>
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex flex-wrap gap-1.5">
        {summary.map(({ cv, tot }) => {
          const isOk  = Math.abs(tot - ca_nhan_pct) < 0.01;
          const isOvr = tot > ca_nhan_pct + 0.01;
          return (
            <span key={cv}
              className={`text-xs px-2 py-0.5 rounded border cursor-pointer ${cv === selNhomCv ? 'bg-blue-100 text-blue-700 border-blue-300' : isOk ? 'bg-green-50 text-green-600 border-green-200' : isOvr ? 'bg-red-50 text-red-600 border-red-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}
              onClick={() => { setSelNhomCv(cv); setEditingKpi(null); setAddModal(null); }}
            >
              {cv}: {fmt2(tot)}đ
            </span>
          );
        })}
      </div>

      <div className="text-xs text-gray-500 flex gap-4 flex-wrap">
        <span>Giới hạn: <strong>{ca_nhan_pct}đ</strong></span>
        <span>Phân bổ: <strong className={overBudget ? 'text-red-600' : balanced ? 'text-green-600' : 'text-orange-500'}>{fmt2(totalAssigned)}đ</strong></span>
        {!balanced && <span>Còn lại: <strong>{fmt2(ca_nhan_pct - totalAssigned)}đ</strong></span>}
      </div>

      {overBudget && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">
          ⚠️ Tổng trọng số ({fmt2(totalAssigned)}đ) vượt quá giới hạn cá nhân ({ca_nhan_pct}đ).
        </div>
      )}

      {/* Per nhóm KPI blocks */}
      <div className="space-y-4">
        {config.nhom_kpi.map(nhom => {
          const nhomKpiIds       = cvCfg[nhom.id] || [];
          const nhomKpis         = nhomKpiIds
            .map(id => kpiList.find(kk => kk.kpi_id === id))
            .filter(Boolean)
            .sort((a, b) => {
              const pa = cvPriorities[a.kpi_id];
              const pb = cvPriorities[b.kpi_id];
              const na = typeof pa === 'number' ? pa : pa === 'fixed' ? 9998 : 9999;
              const nb = typeof pb === 'number' ? pb : pb === 'fixed' ? 9998 : 9999;
              return na !== nb ? na - nb : a.stt - b.stt;
            });
          const nhomTotal        = nhomKpis.reduce((s, kk) => s + (kpiPct[kk.kpi_id]?.pct || 0), 0);
          const nhomBudget       = parseFloat(nhom.pct) || 0;

          return (
            <div key={nhom.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-800 text-sm">{nhom.ten}</span>
                {nhomBudget > 0 && (
                  <span className="text-xs text-gray-400 bg-white border border-gray-200 px-2 py-0.5 rounded">{nhomBudget}đ tham khảo</span>
                )}
                {nhomKpis.length > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded text-gray-500">phân bổ thực tế: {fmt2(nhomTotal)}đ</span>
                )}
              </div>

              {nhomKpis.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border border-gray-100 rounded bg-white">
                  <thead className="bg-blue-50 border-b border-blue-100">
                    <tr>
                      <th className="th text-center w-32">Mức ưu tiên</th>
                      <th className="th text-left">Tên KPI</th>
                      <th className="th text-center w-24">Trọng số</th>
                      <th className="th w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {nhomKpis.map(kk => {
                      const entry       = kpiPct[kk.kpi_id];
                      const pct         = entry?.pct || 0;
                      const isCustom    = entry?.custom || false;
                      const isEdit      = editingKpi === kk.kpi_id;
                      const currentPrio = cvPriorities[kk.kpi_id] ?? null;
                      const isFixed     = currentPrio === 'fixed';
                      const isAuto      = typeof currentPrio === 'number';
                      const isZero      = currentPrio == null;
                      const maxOpts     = isAuto ? globalPrioritizedCount : globalPrioritizedCount + 1;
                      return (
                        <tr key={kk.kpi_id} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="td text-center">
                            <select
                              className={`input text-xs py-0.5 w-28 text-center ${isZero ? 'text-gray-300' : isFixed ? 'text-orange-700 font-semibold' : 'text-blue-700 font-semibold'} ${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                              value={currentPrio ?? ''}
                              disabled={readOnly}
                              onChange={e => {
                                if (readOnly) return;
                                const v = e.target.value;
                                updatePriority(kk.kpi_id, v === '' ? null : v === 'fixed' ? 'fixed' : parseInt(v));
                              }}
                            >
                              <option value="">— (0đ)</option>
                              <option value="fixed">📌 Cố định</option>
                              {Array.from({ length: maxOpts }, (_, i) => i + 1).map(p => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                          </td>
                          <td className="td text-gray-700">{kk.ten_kpi}</td>
                          <td className="td text-center">
                            {!readOnly && isEdit ? (
                              <input autoFocus type="number" step="0.1" min="0" max={ca_nhan_pct}
                                className="input w-16 text-center text-xs py-0.5"
                                value={editVal}
                                onChange={e => setEditVal(e.target.value)}
                                onBlur={() => commitKpiEdit(kk.kpi_id)}
                                onKeyDown={e => { if (e.key === 'Enter') commitKpiEdit(kk.kpi_id); if (e.key === 'Escape') setEditingKpi(null); }} />
                            ) : (
                              <button
                                className={`text-xs px-2 py-0.5 rounded font-mono ${isZero ? 'bg-gray-100 text-gray-300 cursor-default' : isFixed ? 'bg-orange-100 text-orange-700' : isCustom ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}
                                onClick={() => !isZero && !readOnly && (setEditingKpi(kk.kpi_id), setEditVal(String(fmt2(pct))))}
                                title={isZero ? 'Chọn loại để bật trọng số' : readOnly ? '' : isFixed ? 'Cố định — click để chỉnh' : 'Click để chỉnh tay'}
                              >
                                {isZero ? '—' : `${fmt2(pct)}đ${isFixed ? ' 📌' : isCustom ? ' ✏️' : ''}`}
                              </button>
                            )}
                          </td>
                          <td className="td text-center">
                            {!readOnly && (
                              <div className="flex items-center justify-center gap-1">
                                {isCustom && isAuto && (
                                  <button className="text-gray-300 hover:text-gray-500" onClick={() => resetKpi(kk.kpi_id)} title="Đặt lại về tự động">↺</button>
                                )}
                                <button className="text-gray-300 hover:text-red-500" onClick={() => removeKpi(nhom.id, kk.kpi_id)} title="Bỏ KPI khỏi nhóm">×</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}

              {nhomKpis.length === 0 && (
                <p className="text-xs text-gray-400 italic">Chưa có KPI nào trong nhóm này.</p>
              )}

              {!readOnly && unassigned.length > 0 ? (
                <button className="btn-secondary text-xs w-full mt-1 py-1.5"
                  onClick={() => setAddModal({ nhomId: nhom.id, nhomKpiTen: nhom.ten })}>
                  + Thêm KPI vào nhóm này ({unassigned.length} KPI chưa gán)
                </button>
              ) : !readOnly && nhomKpis.length === 0 ? (
                <p className="text-xs text-gray-300 italic">Tất cả KPI đã được gán vào nhóm khác.</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bước 2: Chọn chế độ trọng số ──────────────────────────────────────────────

function ModeSelector({ config, onChange, readOnly }) {
  const [editing, setEditing] = useState(false);
  const [pendingMode, setPendingMode] = useState(config.mode || 'manual');
  const mode = config.mode || 'manual';

  useEffect(() => { if (readOnly) setEditing(false); }, [readOnly]);

  const handleConfirm = () => {
    const newConfig = { ...config, mode: pendingMode };
    onChange(newConfig);
    if (pendingMode === 'manual') {
      localStorage.removeItem(`trong_so_weights_${config.thang}`);
      deleteFromGas(`trong_so_weights_${config.thang}`);
    }
    setEditing(false);
  };

  const modeLabels = { manual: '✋ Nhập tay', auto: '⚙️ Tự động' };

  return (
    <div className="card p-4">
      <h3 className="font-semibold text-gray-800 mb-3">Bước 2 — Chế độ nhập trọng số</h3>
      {!editing ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${mode === 'auto' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
            {modeLabels[mode]}
          </span>
          {!readOnly && (
            <button className="btn-secondary text-xs" onClick={() => { setPendingMode(mode); setEditing(true); }}>
              ✏️ Thay đổi
            </button>
          )}
          <p className="text-xs text-gray-500">
            {mode === 'auto'
              ? 'Trọng số tính tự động từ Bước 3–4. Nhập liệu KPI không thể hiệu chỉnh được trọng số.'
              : 'Trọng số được nhập tay trong Submenu Nhập liệu KPI cá nhân , import Excel, hoặc Hiệu chỉnh trọng số cá nhân.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            {[['manual', '✋ Nhập tay', 'nhập hoặc import từng NV'], ['auto', '⚙️ Tự động', 'tính từ cấu hình Bước 3–4']].map(([m, label, desc]) => (
              <label key={m} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${pendingMode === m ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <input type="radio" name="mode" value={m} checked={pendingMode === m} onChange={() => setPendingMode(m)} className="accent-blue-600" />
                <span className="font-medium text-sm">{label}</span>
                <span className="text-xs text-gray-500">— {desc}</span>
              </label>
            ))}
          </div>
          {pendingMode !== mode && (
            <div className={`rounded-lg p-3 text-xs ${pendingMode === 'manual' ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-blue-50 border border-blue-200 text-blue-800'}`}>
              {pendingMode === 'manual'
                ? '⚠️ Chuyển sang nhập tay. Trọng số tự động trong CONFIG_Store sẽ bị xóa — calcMonth sẽ đọc từ cột _trong_so trên sheet. Trọng số đã ghi vào sheet vẫn còn và có thể chỉnh tiếp.'
                : 'ℹ️ Chuyển sang tự động. Sau khi bấm Lưu & Sync, trọng số sẽ được tính theo Bước 3–4 và ghi đè lên sheet.'
              }
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-primary text-xs" onClick={handleConfirm}>Xác nhận</button>
            <button className="btn-secondary text-xs" onClick={() => setEditing(false)}>Hủy</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Searchable NV Selects ───────────────────────────────────────────────────

function SearchableNvSelect({ nvList, value, onChange, placeholder = 'Chọn nhân viên...' }) {
  const [search, setSearch] = useState('');
  const [open, setOpen]     = useState(false);

  const match = q => nv =>
    !q ||
    nv.ho_ten?.toLowerCase().includes(q.toLowerCase()) ||
    nv.nhom_cv?.toLowerCase().includes(q.toLowerCase()) ||
    nv.khu_vuc?.toLowerCase().includes(q.toLowerCase());

  const filtered = nvList.filter(match(search));
  const selected = nvList.find(n => n.nv_id === value);

  return (
    <div className="relative" tabIndex={-1}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setOpen(false); setSearch(''); } }}>
      <button type="button"
        className="input text-xs py-1 flex items-center gap-1 min-w-40 text-left"
        onClick={() => setOpen(v => !v)}>
        <span className="flex-1 truncate">
          {selected ? selected.ho_ten : <span className="text-gray-400">{placeholder}</span>}
        </span>
        <span className="text-gray-400 shrink-0 ml-1">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 bg-white border border-gray-200 rounded-lg shadow-xl mt-1 w-64">
          <input autoFocus
            className="input text-xs m-1.5 block w-[calc(100%-12px)]"
            placeholder="Tìm tên, nhóm CV, khu vực..."
            value={search}
            onChange={e => setSearch(e.target.value)} />
          <div className="max-h-48 overflow-y-auto">
            {filtered.map(nv => (
              <div key={nv.nv_id} tabIndex={0}
                className={`px-3 py-1.5 text-xs cursor-pointer hover:bg-blue-50 ${nv.nv_id === value ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-700'}`}
                onClick={() => { onChange(nv.nv_id); setOpen(false); setSearch(''); }}
                onKeyDown={e => e.key === 'Enter' && (onChange(nv.nv_id), setOpen(false), setSearch(''))}>
                <div>{nv.ho_ten}</div>
                {(nv.nhom_cv || nv.khu_vuc) && (
                  <div className="text-[10px] text-gray-400">{[nv.nhom_cv, nv.khu_vuc].filter(Boolean).join(' · ')}</div>
                )}
              </div>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-gray-400 italic">Không tìm thấy.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchableNvMultiSelect({ nvList, values, onChange, placeholder = 'Chọn nhân viên đích...' }) {
  const [search, setSearch] = useState('');
  const [open, setOpen]     = useState(false);

  const match = q => nv =>
    !q ||
    nv.ho_ten?.toLowerCase().includes(q.toLowerCase()) ||
    nv.nhom_cv?.toLowerCase().includes(q.toLowerCase()) ||
    nv.khu_vuc?.toLowerCase().includes(q.toLowerCase());

  const filtered = nvList.filter(match(search));

  const toggle = id =>
    onChange(values.includes(id) ? values.filter(v => v !== id) : [...values, id]);

  const selectAllFiltered = () =>
    onChange([...new Set([...values, ...filtered.map(n => n.nv_id)])]);

  const clearFiltered = () =>
    onChange(values.filter(id => !filtered.some(n => n.nv_id === id)));

  return (
    <div className="relative" tabIndex={-1}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setOpen(false); setSearch(''); } }}>
      <button type="button"
        className="input text-xs py-1 flex items-center gap-1 min-w-44 text-left"
        onClick={() => setOpen(v => !v)}>
        <span className="flex-1 truncate">
          {values.length === 0
            ? <span className="text-gray-400">{placeholder}</span>
            : `${values.length} NV đã chọn`}
        </span>
        <span className="text-gray-400 shrink-0 ml-1">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 bg-white border border-gray-200 rounded-lg shadow-xl mt-1 w-72">
          <input autoFocus
            className="input text-xs m-1.5 block w-[calc(100%-12px)]"
            placeholder="Tìm tên, nhóm CV, khu vực..."
            value={search}
            onChange={e => setSearch(e.target.value)} />
          <div className="flex items-center gap-3 px-3 py-1 border-b border-gray-100 text-xs">
            <button tabIndex={0} className="text-blue-500 hover:text-blue-700" onClick={selectAllFiltered}>Chọn tất cả</button>
            <button tabIndex={0} className="text-gray-400 hover:text-gray-600" onClick={clearFiltered}>Bỏ chọn</button>
            {values.length > 0 && <span className="ml-auto text-gray-400">{values.length} đã chọn</span>}
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map(nv => (
              <label key={nv.nv_id} tabIndex={0}
                className="flex items-start gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-blue-50">
                <input type="checkbox" tabIndex={-1}
                  className="accent-blue-600 mt-0.5 shrink-0"
                  checked={values.includes(nv.nv_id)}
                  onChange={() => toggle(nv.nv_id)} />
                <div>
                  <div className="text-gray-700">{nv.ho_ten}</div>
                  {(nv.nhom_cv || nv.khu_vuc) && (
                    <div className="text-[10px] text-gray-400">{[nv.nhom_cv, nv.khu_vuc].filter(Boolean).join(' · ')}</div>
                  )}
                </div>
              </label>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-gray-400 italic">Không tìm thấy.</p>}
          </div>
          <div className="border-t border-gray-100 p-1.5">
            <button tabIndex={0} className="btn-secondary text-xs w-full" onClick={() => { setOpen(false); setSearch(''); }}>Đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Manual Weight Grid (canhan tab, mode=manual) ────────────────────────────

// Chuẩn hóa trọng số về target với 2 chữ số thập phân (largest-remainder)
function normalizeToDecimal(weights, target) {
  const keys = Object.keys(weights).filter(k => (weights[k] || 0) > 0);
  if (!keys.length) return { ...weights };
  const S = keys.reduce((s, k) => s + (weights[k] || 0), 0);
  if (S <= 0) return { ...weights };
  const floors = keys.map(k => Math.floor(weights[k] / S * target * 100) / 100);
  let rem = Math.round((target - floors.reduce((a, b) => a + b, 0)) * 100);
  const order = keys.map((k, i) => ({ i, frac: (weights[k] / S * target * 100) % 1 })).sort((a, b) => b.frac - a.frac);
  order.forEach(({ i }) => { if (rem > 0) { floors[i] = Math.round((floors[i] + 0.01) * 100) / 100; rem--; } });
  const result = { ...weights };
  keys.forEach((k, i) => { result[k] = floors[i]; });
  return result;
}

function ManualWeightGrid({ thang, config, kpiList, nvList }) {
  const target = config?.ty_le?.ca_nhan?.ca_nhan ?? 100;

  const initGrid = () => {
    const g = {};
    const cnByNv = Object.fromEntries(getInputCNByThang(thang).map(r => [r.nv_id, r]));
    nvList.forEach(nv => {
      const row = cnByNv[nv.nv_id] || {};
      g[nv.nv_id] = {};
      kpiList.forEach(k => {
        const v = row[k.kpi_id + '_trong_so'];
        g[nv.nv_id][k.kpi_id] = (v !== undefined && v !== '') ? (parseFloat(v) || 0) : 0;
      });
    });
    return g;
  };

  const [grid, setGrid]                   = useState(initGrid);
  const [saving, setSaving]               = useState(false);
  const [syncStatus, setSyncStatus]       = useState('');
  const [normalizeStatus, setNormalizeStatus] = useState('');
  const [filterNhomCv, setFilterNhomCv]   = useState('');
  const [filterKhuVuc, setFilterKhuVuc]   = useState('');
  const [copySource, setCopySource]       = useState('');
  const [copyTargets, setCopyTargets]     = useState([]);
  const [copyStatus, setCopyStatus]       = useState('');

  useEffect(() => { setGrid(initGrid()); }, [thang, nvList.length, kpiList.length]);

  const nhomCvOptions = [...new Set(nvList.map(n => n.nhom_cv).filter(Boolean))].sort();
  const khuVucOptions = [...new Set(nvList.map(n => n.khu_vuc).filter(Boolean))].sort();

  const displayNvList = nvList.filter(nv =>
    (!filterNhomCv || nv.nhom_cv === filterNhomCv) &&
    (!filterKhuVuc || nv.khu_vuc === filterKhuVuc)
  );

  const copyTargetOptions = nvList.filter(nv => nv.nv_id !== copySource);

  const handleCopy = () => {
    if (!copySource || copyTargets.length === 0) return;
    const srcWeights = grid[copySource] || {};
    setGrid(g => {
      const newG = { ...g };
      copyTargets.forEach(nvId => { newG[nvId] = { ...srcWeights }; });
      return newG;
    });
    const srcName = nvList.find(n => n.nv_id === copySource)?.ho_ten || copySource;
    setCopyStatus(`✅ Đã copy từ ${srcName} sang ${copyTargets.length} NV`);
    setTimeout(() => setCopyStatus(''), 3000);
  };

  const setWeight = (nvId, kpiId, val) =>
    setGrid(g => ({ ...g, [nvId]: { ...g[nvId], [kpiId]: parseFloat(val) || 0 } }));

  const nvTotal = nvId => Object.values(grid[nvId] || {}).reduce((s, v) => s + (v || 0), 0);

  const totalCls = (total) => {
    if (total === 0) return 'bg-gray-100 text-gray-400';
    if (Math.abs(total - target) < 0.5) return 'bg-green-100 text-green-700';
    if (total > target) return 'bg-red-100 text-red-700';
    return 'bg-yellow-100 text-yellow-700';
  };

  const handleNormalize = () => {
    const newGrid = {};
    nvList.forEach(nv => {
      newGrid[nv.nv_id] = normalizeToDecimal(grid[nv.nv_id] || {}, target);
    });
    setGrid(newGrid);
    setNormalizeStatus(`✅ Đã normalize về ${target}đ cho ${nvList.length} NV`);
    setTimeout(() => setNormalizeStatus(''), 4000);
  };

  const handleSave = async () => {
    setSaving(true);
    setSyncStatus('');

    // Kiểm tra NV chưa normalize (tổng lệch > 0.01đ so với target)
    const unnormalized = nvList.filter(nv => {
      const S = Object.values(grid[nv.nv_id] || {}).reduce((s, v) => s + (v || 0), 0);
      return S > 0 && Math.abs(S - target) > 0.01;
    });

    const existingByNv = Object.fromEntries(getInputCNByThang(thang).map(r => [r.nv_id, r]));
    nvList.forEach(nv => {
      const existing = existingByNv[nv.nv_id] || { thang, nv_id: nv.nv_id };
      const updated = { ...existing };
      kpiList.forEach(k => { updated[k.kpi_id + '_trong_so'] = grid[nv.nv_id]?.[k.kpi_id] ?? 0; });
      upsertInputCN(updated);
    });

    const weightPayload = {};
    nvList.forEach(nv => { weightPayload[nv.nv_id] = grid[nv.nv_id] || {}; });

    const warnNote = unnormalized.length > 0
      ? ` ⚠️ ${unnormalized.length} NV chưa normalize (tổng ≠ ${target}đ) — dùng nút "Normalize" để chuẩn hóa`
      : '';
    if (isConnected()) {
      try {
        await syncWeightConfig(thang, weightPayload);
        setSyncStatus(`✅ Đã lưu & sync Supabase.${warnNote}`);
      } catch (e) {
        setSyncStatus(`⚠️ Lưu OK, sync Supabase thất bại: ${e.message}${warnNote}`);
      }
    } else {
      setSyncStatus(`✅ Đã lưu (chưa kết nối Supabase).${warnNote}`);
    }
    setSaving(false);
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-gray-800">Trọng số cá nhân — chế độ nhập tay</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Mục tiêu: <strong>{target}đ</strong>/NV. Nhập trọng số, sau đó bấm <strong>Normalize</strong> để chuẩn hóa tổng = {target}đ trước khi lưu.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {normalizeStatus && <span className="text-xs text-green-700">{normalizeStatus}</span>}
          {syncStatus && <span className={`text-xs ${syncStatus.startsWith('✅') ? 'text-green-700' : 'text-orange-600'}`}>{syncStatus}</span>}
          <button className="btn-secondary text-sm" onClick={handleNormalize} disabled={kpiList.length === 0 || nvList.length === 0}>
            ⚖️ Normalize
          </button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ Đang lưu...' : '💾 Lưu & Sync'}
          </button>
          <button className="btn-secondary text-sm"
            onClick={() => exportNvWeightsToExcel(thang, kpiList, nvList, grid)}
            disabled={kpiList.length === 0 || nvList.length === 0}
            title="Xuất trọng số cá nhân ra Excel">
            📥 Xuất Excel
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {nvList.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center text-xs">
          <span className="text-gray-500 font-medium">Lọc:</span>
          <select className="input text-xs py-1 w-44" value={filterNhomCv} onChange={e => setFilterNhomCv(e.target.value)}>
            <option value="">Tất cả nhóm CV ({nvList.length})</option>
            {nhomCvOptions.map(n => (
              <option key={n} value={n}>{n} ({nvList.filter(nv => nv.nhom_cv === n).length})</option>
            ))}
          </select>
          <select className="input text-xs py-1 w-44" value={filterKhuVuc} onChange={e => setFilterKhuVuc(e.target.value)}>
            <option value="">Tất cả khu vực</option>
            {khuVucOptions.map(k => (
              <option key={k} value={k}>{k} ({nvList.filter(nv => nv.khu_vuc === k).length})</option>
            ))}
          </select>
          {(filterNhomCv || filterKhuVuc) && (
            <button className="text-blue-500 hover:text-blue-700 underline" onClick={() => { setFilterNhomCv(''); setFilterKhuVuc(''); }}>
              Xóa bộ lọc
            </button>
          )}
          <span className="text-gray-400">Hiển thị {displayNvList.length}/{nvList.length} NV</span>
        </div>
      )}

      {/* Copy trọng số */}
      {nvList.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="text-xs font-medium text-amber-800 shrink-0">Copy trọng số:</span>
          <span className="text-xs text-amber-700 shrink-0">Nguồn</span>
          <SearchableNvSelect nvList={nvList} value={copySource} onChange={v => { setCopySource(v); setCopyTargets([]); }} placeholder="Chọn NV nguồn..." />
          <span className="text-xs text-amber-700 shrink-0">→ Đích</span>
          <SearchableNvMultiSelect nvList={copyTargetOptions} values={copyTargets} onChange={setCopyTargets} placeholder="Chọn NV đích..." />
          <button className="btn-primary text-xs px-3 py-1"
            disabled={!copySource || copyTargets.length === 0}
            onClick={handleCopy}>
            Copy
          </button>
          {copyStatus && <span className="text-xs text-green-700">{copyStatus}</span>}
        </div>
      )}

      {kpiList.length === 0 ? (
        <p className="text-gray-400 text-sm italic">Tháng này chưa có KPI cá nhân.</p>
      ) : displayNvList.length === 0 ? (
        <p className="text-gray-400 text-sm italic">Không có nhân viên phù hợp bộ lọc.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-blue-50 border-b border-blue-100">
              <tr>
                <th className="th w-8 text-center">STT</th>
                <th className="th text-left">Tên KPI</th>
                {displayNvList.map(nv => (
                  <th key={nv.nv_id} className="th text-center min-w-[84px]">
                    <div>{nv.ho_ten}</div>
                    {nv.nhom_cv && <div className="text-gray-400 font-normal text-[10px]">{nv.nhom_cv}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpiList.map(k => (
                <tr key={k.kpi_id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="td text-center text-gray-400">{k.stt}</td>
                  <td className="td text-gray-700">{k.ten_kpi}</td>
                  {displayNvList.map(nv => (
                    <td key={nv.nv_id} className="td p-1 text-center">
                      <input type="number" min="0" step="0.01"
                        className="input w-20 text-center text-xs py-0.5 tabular-nums"
                        value={grid[nv.nv_id]?.[k.kpi_id] ?? 0}
                        onChange={e => setWeight(nv.nv_id, k.kpi_id, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <td className="td text-center" colSpan={2}>Tổng (mục tiêu: {target}đ)</td>
                {displayNvList.map(nv => {
                  const total = nvTotal(nv.nv_id);
                  return (
                    <td key={nv.nv_id} className="td text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${totalCls(total)}`}>
                        {total}đ
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab Ghi đè KPI cá nhân ──────────────────────────────────────────────────────

function NvOverrideTab({ thang, config, kpiList, nvList, onChange, readOnly }) {
  const [selNvId, setSelNvId]       = useState(nvList[0]?.nv_id || '');
  const [editingKpi, setEditingKpi] = useState(null);
  const [editVal, setEditVal]       = useState('');

  const ca_nhan_pct = config.ty_le?.ca_nhan?.ca_nhan ?? 70;
  const nv          = nvList.find(n => n.nv_id === selNvId);
  const template    = config.kpi_pct?.[nv?.nhom_cv] || {};
  const override    = config.nv_override?.[selNvId] || {};
  const hasOverride = Object.keys(override).length > 0;

  const effective = {};
  Object.entries(template).forEach(([id, { pct }]) => { effective[id] = pct; });
  Object.entries(override).forEach(([id, pct]) => { effective[id] = pct; });
  const totalPct = Object.values(effective).reduce((a, b) => a + b, 0);

  const setOvrd = (kpiId, raw) => {
    if (readOnly) return;
    const val = parseFloat(raw) || 0;
    onChange({ ...config, nv_override: { ...config.nv_override, [selNvId]: { ...override, [kpiId]: val } } });
  };

  const clearOvrd = (kpiId) => {
    if (readOnly) return;
    const newOvrd = { ...override };
    delete newOvrd[kpiId];
    const newNvOvrd = { ...config.nv_override, [selNvId]: newOvrd };
    if (!Object.keys(newOvrd).length) delete newNvOvrd[selNvId];
    onChange({ ...config, nv_override: newNvOvrd });
  };

  const clearAll = () => {
    if (readOnly) return;
    if (!confirm('Xóa toàn bộ ghi đè KPI cá nhân cho nhân viên này?')) return;
    const newNvOvrd = { ...config.nv_override };
    delete newNvOvrd[selNvId];
    onChange({ ...config, nv_override: newNvOvrd });
  };

  const displayKpis = kpiList.filter(k => k.kpi_id in template || k.kpi_id in override).sort((a, b) => a.stt - b.stt);
  const overBudget  = totalPct > ca_nhan_pct + 0.05;

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-gray-800 flex-1">
              {readOnly ? 'Trọng số cá nhân (chỉ xem, không thể hiệu chỉnh)' : 'Hiệu chỉnh trọng số cá nhân'}
            </h3>
            <div className="flex items-center gap-2 shrink-0">
              <button className="btn-secondary text-xs"
                onClick={() => {
                  const weights = computeNvWeights(config, kpiList, nvList);
                  exportNvWeightsToExcel(thang, kpiList, nvList, weights);
                }}
                disabled={kpiList.length === 0 || nvList.length === 0}
                title="Xuất trọng số cá nhân ra Excel">
                📥 Xuất Excel
              </button>
              {!readOnly && hasOverride && (
                <button className="text-xs text-red-500 hover:text-red-700 underline" onClick={clearAll}>Xóa ghi đè</button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select className="input text-sm flex-1 min-w-0 sm:flex-none sm:w-56" value={selNvId} onChange={e => { setSelNvId(e.target.value); setEditingKpi(null); }}>
              {nvList.map(n => (
                <option key={n.nv_id} value={n.nv_id}>
                  {n.ho_ten}{(!readOnly && config.nv_override?.[n.nv_id] && Object.keys(config.nv_override[n.nv_id]).length) ? ' ✏️' : ''}
                </option>
              ))}
            </select>
            {nv && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{nv.nhom_cv}</span>}
          </div>
        </div>

        {nv ? (
          <>
            <div className="text-xs text-gray-500 flex gap-4 flex-wrap">
              <span>Tổng: <strong className={overBudget ? 'text-red-600' : 'text-green-600'}>{fmt2(totalPct)}đ</strong> / {ca_nhan_pct}đ</span>
              {hasOverride && <span className="text-orange-600">✏️ Có {Object.keys(override).length} ghi đè</span>}
            </div>
            {overBudget && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
                ⚠️ Tổng trọng số ({fmt2(totalPct)}đ) vượt giới hạn ({ca_nhan_pct}đ). Hãy điều chỉnh để tổng = {ca_nhan_pct}đ.
              </p>
            )}
            {!readOnly && (
              <p className="text-xs text-gray-400 italic">
                Click vào cột "Ghi đè KPI" để chỉnh tay. Ô template bên cạnh để tham khảo. Bấm ↺ để xóa ghi đè từng KPI.
              </p>
            )}
            {displayKpis.length === 0 ? (
              <p className="text-gray-400 text-sm italic">Nhân viên này chưa có KPI được phân bổ trọng số (cần cấu hình Bước 3–4 trước).</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-blue-50 border-b border-blue-100">
                  <tr>
                    <th className="th text-center w-8">STT</th>
                    <th className="th text-left">Tên KPI</th>
                    <th className="th text-center w-24">Template</th>
                    <th className="th text-center w-28">Ghi đè KPI</th>
                    <th className="th w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {displayKpis.map(k => {
                    const tmplPct    = template[k.kpi_id]?.pct ?? 0;
                    const ovrdPct    = override[k.kpi_id];
                    const isOverride = ovrdPct !== undefined;
                    const isEdit     = editingKpi === k.kpi_id;
                    return (
                      <tr key={k.kpi_id} className={`border-t border-gray-100 ${isOverride ? 'bg-orange-50' : 'hover:bg-gray-50'}`}>
                        <td className="td text-center text-gray-400">{k.stt}</td>
                        <td className="td text-gray-700">{k.ten_kpi}</td>
                        <td className="td text-center font-mono text-gray-400">{fmt2(tmplPct)}đ</td>
                        <td className="td text-center">
                          {!readOnly && isEdit ? (
                            <input autoFocus type="number" step="0.1" min="0" max={ca_nhan_pct}
                              className="input w-20 text-center text-xs py-0.5"
                              value={editVal}
                              onChange={e => setEditVal(e.target.value)}
                              onBlur={() => { setOvrd(k.kpi_id, editVal); setEditingKpi(null); }}
                              onKeyDown={e => { if (e.key === 'Enter') { setOvrd(k.kpi_id, editVal); setEditingKpi(null); } if (e.key === 'Escape') setEditingKpi(null); }} />
                          ) : (
                            <button
                              className={`text-xs px-2 py-0.5 rounded font-mono ${isOverride ? 'bg-orange-100 text-orange-700 font-semibold' : 'bg-gray-100 text-gray-400'} ${!readOnly ? 'hover:bg-gray-200 cursor-pointer' : 'cursor-default'}`}
                              onClick={() => { if (!readOnly) { setEditingKpi(k.kpi_id); setEditVal(String(fmt2(ovrdPct ?? tmplPct))); } }}
                            >
                              {isOverride ? `${fmt2(ovrdPct)}đ${readOnly ? '' : ' ✏️'}` : '—'}
                            </button>
                          )}
                        </td>
                        <td className="td text-center">
                          {!readOnly && isOverride && (
                            <button className="text-gray-300 hover:text-gray-500 text-xs" onClick={() => clearOvrd(k.kpi_id)} title="Xóa ghi đè">↺</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </>
        ) : (
          <p className="text-gray-400 text-sm italic">Chọn nhân viên để cấu hình.</p>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WeightManagement() {
  const { tab: urlTab = 'cauhinh' } = useParams();
  const { user } = useAuth();
  const [thangList, setThangList] = useState(() => getSnapshotThangList());
  const [thang, setThang]         = useState('');
  const [config, setConfig]       = useState(null);
  const [snapshot, setSnapshot]   = useState(null);
  const [saveStatus, setSaveStatus]     = useState('');
  const [saving, setSaving]             = useState(false);
  const [loadingInputCN, setLoadingInputCN] = useState(false);
  const [inputCNKey, setInputCNKey]     = useState(0);
  const [editMode, setEditMode]   = useState(false);
  const [isDirty, setIsDirty]     = useState(false);
  const [saveError, setSaveError] = useState('');

  // Auto-save to localStorage only when in edit mode (NOT to Supabase — that happens on explicit Lưu & Sync)
  useEffect(() => {
    if (!config || !thang || !editMode) return;
    const timer = setTimeout(() => {
      localStorage.setItem(`trong_so_thang_${thang}`, JSON.stringify(config));
    }, 800);
    return () => clearTimeout(timer);
  }, [config, thang, editMode]);

  // Warn on browser close/refresh when in edit mode with unsaved changes
  useEffect(() => {
    if (!editMode || !isDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editMode, isDirty]);

  // Warn on in-app navigation when in edit mode with unsaved changes
  useEffect(() => {
    if (editMode && isDirty) {
      setNavGuard('Cấu hình trọng số đang có thay đổi chưa lưu.\nThoát trang sẽ mất các thay đổi. Tiếp tục không?');
    } else {
      clearNavGuard();
    }
    return () => clearNavGuard();
  }, [editMode, isDirty]);
  const [copySourceThang, setCopySourceThang] = useState(() => defaultThang(getSnapshotThangList()));
  const [showCopyPicker, setShowCopyPicker]   = useState(false);

  const nvList     = useMemo(() => getNvListForThang(thang), [thang]);
  const nhomCvList = useMemo(() => {
    const inUse = new Set(nvList.map(n => n.nhom_cv).filter(Boolean));
    const snap  = getNvSnapshot(thang);
    const ordered = (snap?.nhomCvList?.length > 0 ? snap.nhomCvList : getNhomCvList()).filter(cv => inUse.has(cv));
    inUse.forEach(cv => { if (!ordered.includes(cv)) ordered.push(cv); });
    return ordered;
  }, [thang, nvList]);
  const kpiList    = useMemo(
    () => (snapshot?.kpiList || []).filter(k => k.kpi_cap === 'ca_nhan').sort((a, b) => a.stt - b.stt),
    [snapshot]
  );

  const onConfigChange = useCallback((newConfig) => {
    setIsDirty(true);
    setConfig(newConfig);
  }, []);

  const handleEnterEdit = () => {
    alert('Lưu ý: Sau khi chỉnh sửa xong, bạn phải bấm nút "Lưu & Sync" để các thay đổi được lưu vào cơ sở dữ liệu. Nếu không lưu, các thay đổi sẽ không có hiệu lực.');
    setEditMode(true);
    setIsDirty(false);
    setSaveError('');
  };

  const loadThang = (t) => {
    if (editMode && isDirty) {
      if (!window.confirm('Bạn đang chỉnh sửa nhưng chưa lưu. Chuyển tháng sẽ mất các thay đổi chưa lưu. Tiếp tục không?')) return;
    }
    setEditMode(false);
    setIsDirty(false);
    setSaveError('');
    const snap = getKpiSnapshot(t);
    setSnapshot(snap);
    const raw = getTrongSoConfig(t) || createDefaultConfig(t);
    setConfig(normalizePriorities(raw));
    setThang(t);
    if (isConnected()) {
      setLoadingInputCN(true);
      gasGetInputCN(t)
        .then(res => {
          if (res.data?.length > 0) {
            res.data.forEach(row => upsertInputCN({ ...row, thang: t }));
            setInputCNKey(k => k + 1);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingInputCN(false));
    }
  };

  useEffect(() => {
    const list = getSnapshotThangList();
    setThangList(list);
    if (list.length) loadThang(defaultThang(list));
  }, []);

  useEffect(() => {
    if (!thang) return;
    const srcList = thangList.filter(t => t !== thang);
    if (srcList.length > 0 && !srcList.includes(copySourceThang)) {
      setCopySourceThang(srcList[srcList.length - 1]);
    }
  }, [thang, thangList]);

  const handleSave = async () => {
    if (!config || !thang) return;

    // Validate for auto mode: mọi KPI phải được gán vào ít nhất 1 nhóm KPI
    if (config.mode === 'auto') {
      const kpiIdSet = new Set(kpiList.map(k => k.kpi_id));
      const errs = [];
      nhomCvList.forEach(cv => {
        const cvCfgLocal = config.cv_config?.[cv] || {};
        const assigned   = new Set(Object.values(cvCfgLocal).flat().filter(id => kpiIdSet.has(id)));
        const unassigned = kpiList.filter(k => !assigned.has(k.kpi_id));
        if (unassigned.length > 0)
          errs.push(`Nhóm CV "${cv}": ${unassigned.length} KPI chưa được thêm vào nhóm KPI (${unassigned.map(k => k.ten_kpi).join(', ')})`);
      });
      if (errs.length > 0) { setSaveError(errs.join('\n')); return; }
    }
    setSaveError('');
    setSaving(true);
    setSaveStatus('');
    saveTrongSoConfig(thang, config);
    if (config.mode === 'auto' && isConnected() && kpiList.length > 0) {
      try {
        const weights = computeNvWeights(config, kpiList, nvList);
        await syncWeightConfig(thang, weights);
        syncToGas(`trong_so_weights_${thang}`, weights);
        setSaveStatus('✅ Đã lưu & sync');
      } catch {
        setSaveStatus('⚠️ Lưu OK, sync thất bại');
      }
    } else {
      // Xóa weights cũ từ auto mode (nếu có) để tránh orphan data trong config_store
      localStorage.removeItem(`trong_so_weights_${thang}`);
      deleteFromGas(`trong_so_weights_${thang}`);
      setSaveStatus('✅ Đã lưu');
    }
    setSaving(false);
    setEditMode(false);
    setIsDirty(false);
    setTimeout(() => setSaveStatus(''), 3000);
  };

  // Copy trọng số từ tháng được chọn — chỉ copy các KPI trùng nhau giữa 2 tháng
  const copyFromMonth = () => {
    if (!copySourceThang || copySourceThang === thang) { alert('Vui lòng chọn tháng nguồn khác tháng hiện tại.'); return; }
    const srcCfg = getTrongSoConfig(copySourceThang);
    if (!srcCfg) { alert(`Tháng ${copySourceThang} chưa có cấu hình trọng số.`); return; }

    const srcSnap     = getKpiSnapshot(copySourceThang);
    const srcKpiIds   = new Set((srcSnap?.kpiList || []).filter(k => k.kpi_cap === 'ca_nhan').map(k => k.kpi_id));
    const missingInSrc = kpiList.filter(k => !srcKpiIds.has(k.kpi_id));
    const missingNote  = missingInSrc.length > 0
      ? `\n\n⚠️ Có ${missingInSrc.length} KPI của tháng ${thang} không tồn tại ở tháng ${copySourceThang} — cần cấu hình thêm sau khi copy:\n${missingInSrc.map(k => `  • ${k.ten_kpi}`).join('\n')}`
      : '';

    if (!confirm(
      `Copy cấu hình từ tháng ${copySourceThang} sang tháng ${thang}?\n\n` +
      `• Tỷ lệ phân bổ, giá trị Max/Min: copy toàn bộ\n` +
      `• Ưu tiên KPI: chỉ copy các KPI có trong cả 2 tháng\n` +
      `• Trọng số cũ của tháng hiện tại sẽ bị xóa` +
      missingNote
    )) return;

    const srcPriorities = normalizePriorities(srcCfg).cv_priorities || {};
    const targetKpiIds  = new Set(kpiList.map(k => k.kpi_id));
    const newPriorities = {};
    Object.entries(srcPriorities).forEach(([nhomCv, kvMap]) => {
      newPriorities[nhomCv] = {};
      Object.entries(kvMap || {}).forEach(([kpiId, prio]) => {
        if (targetKpiIds.has(kpiId)) newPriorities[nhomCv][kpiId] = prio;
      });
    });

    // Lọc cv_config để bỏ kpiId không còn trong tháng đích
    const srcCvConfig = srcCfg.cv_config || {};
    const newCvConfig = {};
    Object.entries(srcCvConfig).forEach(([nhomCv, nhomCfg]) => {
      newCvConfig[nhomCv] = {};
      Object.entries(nhomCfg || {}).forEach(([nhomId, ids]) => {
        newCvConfig[nhomCv][nhomId] = (ids || []).filter(id => targetKpiIds.has(id));
      });
    });

    const base = normalizePriorities({
      ...srcCfg,
      thang,
      cv_config:     newCvConfig,
      cv_priorities: newPriorities,
      kpi_pct:       {},
      nv_override:   {},
    });
    setConfig(recomputeAllKpiPct(base, kpiList));
    setEditMode(true);
    setIsDirty(true);
    setSaveError('');
    setShowCopyPicker(false);
  };

  if (!canEditDept(user)) return <div className="p-3 md:p-6"><h2 className="text-xl font-bold text-gray-900">Quản lý trọng số</h2><div className="mt-6"><AccessDenied /></div></div>;

  if (!thangList.length) {
    return (
      <div className="p-3 md:p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Quản lý Trọng số KPI</h2>
        <p className="text-gray-500">Chưa có tháng nào. Hãy tạo tháng trong module Quản lý KPI trước.</p>
      </div>
    );
  }

  const TAB_TITLES_TS = { cauhinh: '⚙️ Cấu hình trọng số', canhan: '👤 Hiệu chỉnh trọng số cá nhân' };

  return (
    <div className="p-3 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg md:text-xl font-bold text-gray-900">{TAB_TITLES_TS[urlTab] ?? 'Quản lý Trọng số'}</h2>
          <p className="text-gray-500 text-xs mt-0.5">Cấu hình trọng số KPI theo nhóm công việc/cá nhân từng tháng</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <YearMonthPicker thangList={thangList} value={thang} onChange={loadThang} />
          {thangList.length > 1 && (
            <div className="relative">
              <button
                className="btn-secondary text-sm"
                onClick={() => setShowCopyPicker(v => !v)}
                title="Copy cấu hình trọng số từ tháng bất kỳ"
              >
                📋 Copy từ tháng
              </button>
              {showCopyPicker && (() => {
                const curMode      = config?.mode || 'manual';
                const sameModeSrc  = thangList.filter(t => t !== thang && (getTrongSoConfig(t)?.mode || 'manual') === curMode);
                return (
                  <div className="absolute right-0 top-9 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2 min-w-72">
                    <p className="text-xs font-semibold text-gray-700">Chọn tháng nguồn:</p>
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      ℹ️ Chọn chế độ nhập trọng số ở Bước 2 trước khi copy. Chỉ hiển thị các tháng cùng chế độ <strong>{curMode === 'auto' ? 'Tự động' : 'Nhập tay'}</strong>.
                    </p>
                    {sameModeSrc.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Không có tháng nào cùng chế độ để copy.</p>
                    ) : (
                      <YearMonthPicker thangList={sameModeSrc} value={copySourceThang} onChange={setCopySourceThang} />
                    )}
                    <div className="flex gap-2">
                      <button className="btn-primary text-xs" onClick={copyFromMonth} disabled={sameModeSrc.length === 0}>Copy</button>
                      <button className="btn-secondary text-xs" onClick={() => setShowCopyPicker(false)}>Hủy</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {config && urlTab === 'cauhinh' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
            ⚙️ <strong>Cấu hình trọng số</strong> — Cấu hình tỷ lệ trọng số giữa các cấp và chọn chế độ nhập trọng số (nhập tay / tự động). Thực hiện cấu hình cho chế độ nhập trọng số tự động (Bước 3 & 4)
          </div>

          {/* Toolbar chỉnh sửa — phía trên Bước 1 */}
          <div className="flex items-center gap-3 flex-wrap">
            {!editMode ? (
              <button className="btn-secondary text-sm" onClick={handleEnterEdit}>
                ✏️ Chỉnh sửa
              </button>
            ) : (
              <>
                <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
                  {saving ? '⏳ Đang sync...' : '💾 Lưu & Sync'}
                </button>
                {saveStatus && (
                  <span className={`text-xs ${saveStatus.startsWith('✅') ? 'text-green-600' : 'text-orange-600'}`}>
                    {saveStatus}
                  </span>
                )}
              </>
            )}
            {editMode && isDirty && (
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                ⚠️ Có thay đổi chưa lưu
              </span>
            )}
          </div>

          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 whitespace-pre-line">
              ⚠️ Chưa cấu hình đầy đủ — không thể lưu:{'\n'}{saveError}
            </div>
          )}

          <TyLeCap      config={config} kpiList={kpiList} onChange={onConfigChange} readOnly={!editMode} />
          <ModeSelector config={config} onChange={onConfigChange} readOnly={!editMode} />
          {config.mode === 'auto' && (
            <>
              <NhomKpiPanel config={config} kpiList={kpiList} onChange={onConfigChange} readOnly={!editMode} />
              <CvConfigPanel thang={thang} config={config} nhomCvList={nhomCvList} kpiList={kpiList}
                onChange={onConfigChange} readOnly={!editMode} />
            </>
          )}
        </div>
      )}

      {config && urlTab === 'canhan' && (
        <div className="space-y-3">
          <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-800">
            👤 <strong>Trọng số cá nhân</strong> — Xem và chỉnh trọng số KPI cho từng nhân viên. Chế độ nhập tay trọng số cho phép sửa trực tiếp trên bảng; chế độ nhập trọng số tự động chỉ xem, không thể hiệu chỉnh
          </div>
          {loadingInputCN && (
            <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="animate-spin inline-block">⏳</span>
              Đang tải dữ liệu từ Supabase...
            </div>
          )}
          {config.mode === 'manual'
            ? <ManualWeightGrid key={`mgrid-${thang}-${inputCNKey}`} thang={thang} config={config} kpiList={kpiList} nvList={nvList} />
            : <NvOverrideTab thang={thang} config={config} kpiList={kpiList} nvList={nvList} onChange={setConfig} readOnly />}
        </div>
      )}
    </div>
  );
}
