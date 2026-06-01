/**
 * @file Dashboard.jsx
 * @description Menu "Dashboard" — Màn hình tổng quan KPI theo tháng.
 *
 * CHỨC NĂNG:
 * - KPI Phòng: tổng điểm, xếp loại, danh sách KPI không đạt (<100%).
 * - KPI Cá nhân: bảng xếp hạng toàn phòng, trạng thái nhập liệu, bộ lọc khu vực/nhóm/xếp loại.
 * - Auto-pull từ Supabase khi chọn tháng (output_diem + input_phong).
 *
 * DỮ LIỆU ĐẦU VÀO:
 * - output_diem (Supabase → localStorage): kết quả điểm đã tính
 * - input_phong (Supabase → localStorage): dữ liệu KPI phòng
 * - input_cn (localStorage): dữ liệu nhập liệu KPI cá nhân (để tính ly_do động)
 * - kpi_snapshot_YYYY-MM, nv_snapshot_YYYY-MM: danh sách KPI/NV của tháng
 * - xep_loai_config: ngưỡng xếp loại
 *
 * DỮ LIỆU ĐẦU RA: Chỉ đọc — không ghi dữ liệu.
 *
 * PHÂN QUYỀN (TODO):
 * - Lọc NV theo khu vực/nhóm CV mà user có quyền xem.
 * - Admin xem tất cả; Manager xem theo nhóm; Staff chỉ xem bản thân.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import XLSXStyle from 'xlsx-js-style';
import YearMonthPicker from './YearMonthPicker';
import {
  getOutputDiemByThang, getThangList,
  getInputPhongByThang,
  getKpiList,
  getKpiSnapshot, getTrongSoConfig,
  saveOutputDiem, getOutputDiem,
  getNvListForThang,
  getXepLoaiConfig, getInputCNByThang, upsertInputCN,
  isInputCNLocked, isInputPhongLocked,
  getMonthNote, saveMonthNote,
  getInputCNStatus, getInputPhongStatus,
} from '../services/store';
import {
  isConnected, getDiemThang,
} from '../services/supabaseService';
import { useAuth, canAdmin } from '../contexts/AuthContext';
import { kpiDisplayPct, kpiScore, xepLoaiWithConfig, xepLoaiLabel } from '../utils/kpiScore';

function fmt(n, d = 2) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toFixed(d);
}

function fmtPctDisp(dp) {
  if (!dp) return '—';
  if (dp.error) return dp.error;
  return (dp.pct * 100).toFixed(1) + '%';
}

function computePhong(thang) {
  const rawInp = getInputPhongByThang(thang);
  if (!rawInp) return { hasData: false, kpiPhong: [], kpiCalc: {}, diem_cty: 0, diemPhongSum: 0, tongDiem: 0, ty_le_cty: 50, ty_le_phong: 50 };

  const snap       = getKpiSnapshot(thang);
  const kpiAll     = snap ? snap.kpiList : getKpiList();
  const kpiPhong   = kpiAll.filter(k => k.kpi_cap === 'phong').sort((a, b) => a.stt - b.stt);
  const weightCfg  = getTrongSoConfig(thang) || {};
  const ty_le_cty  = weightCfg?.ty_le?.phong?.cty   ?? 50;
  const ty_le_phong = weightCfg?.ty_le?.phong?.phong ?? 50;

  let diemPhongSum = 0;
  const kpiCalc = {};
  kpiPhong.forEach(kpi => {
    const value = rawInp[kpi.kpi_id + '_value'];
    const lower = rawInp[kpi.kpi_id + '_lower'];
    const upper = rawInp[kpi.kpi_id + '_upper'];
    const w     = rawInp[kpi.kpi_id + '_trong_so'];
    const ok = [value, lower, upper, w].every(v => v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v)));
    if (!ok) { kpiCalc[kpi.kpi_id] = null; return; }
    const v = parseFloat(value), lo = parseFloat(lower), hi = parseFloat(upper), ws = parseFloat(w);
    const rawMpP  = parseFloat(rawInp[kpi.kpi_id + '_max_pct']);
    const maxPct  = isNaN(rawMpP) || rawMpP <= 0 ? (kpi.max_pct ?? 1) : (rawMpP > 2 ? rawMpP / 100 : rawMpP);
    const dispPct = kpiDisplayPct(v, hi, kpi.upper_gt_lower);
    const pct     = dispPct && 'pct' in dispPct ? dispPct.pct : null;
    const diem    = kpiScore(v, lo, hi, maxPct, ws, 1);
    kpiCalc[kpi.kpi_id] = { value: v, lower: lo, upper: hi, w: ws, pct, dispPct, diem, diemMax: ws * maxPct, max_pct: Math.round(maxPct * 100) };
    if (diem !== null) diemPhongSum += diem;
  });

  const diem_cty_dong_gop = parseFloat(rawInp.diem_kpi_chinhanh) || 0;
  const kq_raw = parseFloat(rawInp.diem_kpi_chinhanh_kq);
  const diem_cty = !isNaN(kq_raw) ? kq_raw : diem_cty_dong_gop;
  const tongDiem = diem_cty_dong_gop + diemPhongSum;
  return { hasData: true, kpiPhong, kpiCalc, diem_cty, diem_cty_dong_gop, diemPhongSum, tongDiem, ty_le_cty, ty_le_phong };
}

const BAR_COLOR = {
  'A+': 'bg-purple-400',
  A:    'bg-green-400',
  B:    'bg-blue-400',
  C:    'bg-yellow-400',
  D:    'bg-red-400',
};

const LOAI_UI = {
  'A+': { card: 'border-purple-200 bg-purple-50',  tc: 'text-purple-700', badge: 'bg-purple-100 text-purple-800' },
  A:    { card: 'border-green-200 bg-green-50',    tc: 'text-green-700',  badge: 'bg-green-100 text-green-800'  },
  B:    { card: 'border-blue-200 bg-blue-50',      tc: 'text-blue-700',   badge: 'bg-blue-100 text-blue-800'   },
  C:    { card: 'border-yellow-200 bg-yellow-50',  tc: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-800'},
  D:    { card: 'border-red-200 bg-red-50',        tc: 'text-red-700',    badge: 'bg-red-100 text-red-800'     },
};

function exportDashboardToExcel(thang, data) {
  const HEADER_STYLE = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Segoe UI' },
    fill: { fgColor: { rgb: '1E40AF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top: { style: 'thin', color: { rgb: '93C5FD' } }, bottom: { style: 'thin', color: { rgb: '93C5FD' } }, left: { style: 'thin', color: { rgb: '93C5FD' } }, right: { style: 'thin', color: { rgb: '93C5FD' } } },
  };
  const dataStyle = (isEven) => ({
    font: { sz: 10, name: 'Segoe UI' },
    fill: { fgColor: { rgb: isEven ? 'F0F9FF' : 'FFFFFF' } },
    alignment: { vertical: 'center', wrapText: false },
    border: { top: { style: 'thin', color: { rgb: 'E2E8F0' } }, bottom: { style: 'thin', color: { rgb: 'E2E8F0' } }, left: { style: 'thin', color: { rgb: 'E2E8F0' } }, right: { style: 'thin', color: { rgb: 'E2E8F0' } } },
  });
  const headers = ['STT', 'Mã nhân viên', 'Họ và tên', 'Trạng thái', 'Nhóm CV', 'Khu vực', 'Điểm KPI', 'Xếp loại', 'Mức độ hoàn thành', 'Hạng'];
  const colWidths = [{ wch: 6 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 8 }];
  const ws = {};
  headers.forEach((h, c) => {
    ws[XLSXStyle.utils.encode_cell({ r: 0, c })] = { v: h, t: 's', s: HEADER_STYLE };
  });
  data.forEach((r, i) => {
    const s = dataStyle(i % 2 === 0);
    const cells = [
      { v: i + 1, t: 'n' },
      { v: r.nv_id || '', t: 's' },
      { v: r.ho_ten || '', t: 's' },
      { v: r.active ? 'Đang làm' : 'Đã nghỉ', t: 's' },
      { v: r.nhom_cv || '', t: 's' },
      { v: r.khu_vuc || '', t: 's' },
      r.tong_diem != null ? { v: parseFloat(r.tong_diem.toFixed(2)), t: 'n' } : { v: '', t: 's' },
      { v: r.xep_loai || '', t: 's' },
      { v: r.xep_loai ? xepLoaiLabel(r.xep_loai) : (r.ly_do || ''), t: 's' },
      r.rank != null ? { v: r.rank, t: 'n' } : { v: '', t: 's' },
    ];
    cells.forEach((cell, c) => {
      ws[XLSXStyle.utils.encode_cell({ r: i + 1, c })] = { ...cell, s };
    });
  });
  ws['!ref'] = XLSXStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: headers.length - 1 } });
  ws['!cols'] = colWidths;
  ws['!rows'] = [{ hpt: 25 }, ...data.map(() => ({ hpt: 20 }))];
  ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, `KPI ${thang.replace('-', '.')}`);
  XLSXStyle.writeFile(wb, `Dashboard_KPICaNhan_${thang}.xlsx`);
}

export default function Dashboard() {
  const [thang, setThang] = useState(() => {
    const now  = new Date();
    const curT = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const list = getThangList();
    return list.includes(curT) ? curT : (list[0] || curT);
  });
  const [rows, setRows]             = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterKV, setFilterKV]     = useState('');
  const [filterNhom, setFilterNhom] = useState('');
  const [filterLoai, setFilterLoai] = useState('');
  const [filterName, setFilterName] = useState('');
  const [sortKey, setSortKey]       = useState('nv_id');
  const [sortDir, setSortDir]       = useState('asc');
  const [loading, setLoading]       = useState(false);
  const [monthNote, setMonthNote]     = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [noteInput, setNoteInput]     = useState('');
  const { user } = useAuth();

  const dataThangList = useMemo(() => getThangList(), [refreshKey]);

  useEffect(() => {
    setMonthNote(getMonthNote(thang));
    setEditingNote(false);
    setNoteInput('');
  }, [thang]);

  const reload = useCallback(async () => {
    setLoading(true);
    if (isConnected()) {
      try {
        const res = await getDiemThang(thang);
        if (res.outputDiem?.length) {
          const prev      = getOutputDiem();
          const scoredIds = new Set(res.outputDiem.map(r => r.nv_id));
          const unscored  = prev.filter(r => r.thang === thang && !r.xep_loai && !scoredIds.has(r.nv_id));
          const other     = prev.filter(r => r.thang !== thang);
          saveOutputDiem([...other, ...res.outputDiem, ...unscored]);
        }
        if (res.inputCN?.length > 0) res.inputCN.forEach(row => upsertInputCN({ ...row, thang }));
      } catch (_) {}
    }
    setRows(getOutputDiemByThang(thang));
    setRefreshKey(k => k + 1);
    setLoading(false);
  }, [thang]);

  useEffect(() => { reload(); }, [reload]);

  const phong = useMemo(() => computePhong(thang), [thang, refreshKey]);

  const meta = useMemo(() => {
    try {
      const raw = localStorage.getItem(`output_meta_${thang}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [thang, refreshKey]);

  const rankedRows = useMemo(() => {
    const nvList      = getNvListForThang(thang);
    const nvMap       = Object.fromEntries(nvList.map(n => [n.nv_id, n]));
    const inputCNRows = getInputCNByThang(thang);
    const inputCNMap  = Object.fromEntries(inputCNRows.map(r => [r.nv_id, r]));
    const snap        = getKpiSnapshot(thang);
    const kpiCaNhan   = (snap?.kpiList || []).filter(k => k.kpi_cap === 'ca_nhan');

    const scored   = rows.filter(r => r.xep_loai);
    const unscored = rows.filter(r => !r.xep_loai);
    const _ss = [...scored].sort((a, b) => (b.tong_diem ?? -Infinity) - (a.tong_diem ?? -Infinity));
    const sortedScored = _ss.reduce((acc, r, i) => {
      const rank = i === 0 ? 1 : (r.tong_diem !== _ss[i - 1].tong_diem ? i + 1 : acc[i - 1].rank);
      acc.push({ ...r, rank, active: nvMap[r.nv_id]?.active !== false });
      return acc;
    }, []);

    const isAutoMode = (getTrongSoConfig(thang)?.mode ?? 'manual') === 'auto';

    const mappedUnscored = unscored.map(r => {
      const cnStatus = getInputCNStatus(thang, r.nv_id);
      let ly_do;
      if (cnStatus === 'empty') {
        ly_do = 'Chưa nhập dữ liệu';
      } else if (cnStatus === 'full') {
        ly_do = 'Đã nhập đủ — chờ tính điểm';
      } else {
        const nvRow    = inputCNMap[r.nv_id];
        const missingW = !isAutoMode && kpiCaNhan.some(k => {
          const w = nvRow?.[k.kpi_id + '_trong_so'];
          return w === '' || w === null || w === undefined || isNaN(parseFloat(String(w)));
        });
        ly_do = missingW ? 'Thiếu trọng số' : 'Thiếu dữ liệu';
      }
      return { ...r, rank: null, active: nvMap[r.nv_id]?.active !== false, ly_do };
    });
    return [...sortedScored, ...mappedUnscored];
  }, [rows, thang, refreshKey]);

  const kvList   = useMemo(() => [...new Set(rows.map(r => r.khu_vuc))].filter(Boolean).sort(), [rows]);
  const nhomList = useMemo(() => [...new Set(rows.map(r => r.nhom_cv))].filter(Boolean).sort(), [rows]);

  const progress = useMemo(() => {
    const total      = rankedRows.length;
    const scored     = rankedRows.filter(r =>  r.xep_loai).length;
    const chuaNhap   = rankedRows.filter(r => !r.xep_loai && r.ly_do === 'Chưa nhập dữ liệu').length;
    const nhapDu     = rankedRows.filter(r => !r.xep_loai && r.ly_do === 'Đã nhập đủ — chờ tính điểm').length;
    const nhapThieu  = rankedRows.filter(r => !r.xep_loai && (r.ly_do === 'Thiếu dữ liệu' || r.ly_do === 'Thiếu trọng số')).length;
    return { total, scored, chuaNhap, nhapDu, nhapThieu };
  }, [rankedRows]);

  const chartRows = useMemo(() =>
    [...rankedRows.filter(r => r.xep_loai && r.tong_diem != null)]
      .sort((a, b) => (b.tong_diem ?? 0) - (a.tong_diem ?? 0)),
  [rankedRows]);

  const stats = useMemo(() => {
    const s = { 'A+': 0, A: 0, B: 0, C: 0, D: 0, chua_tinh: 0 };
    rows.forEach(r => {
      if (r.xep_loai && r.xep_loai in s) s[r.xep_loai]++;
      else if (!r.xep_loai) s.chua_tinh++;
    });
    return s;
  }, [rows]);

  const filtered = useMemo(() => {
    const nameQ = filterName.trim().toLowerCase();
    let result = rankedRows.filter(r =>
      (!filterKV   || r.khu_vuc  === filterKV)  &&
      (!filterNhom || r.nhom_cv  === filterNhom) &&
      (!filterLoai || r.xep_loai === filterLoai) &&
      (!nameQ      || (r.ho_ten || '').toLowerCase().includes(nameQ))
    );
    const sc = result.filter(r =>  r.xep_loai);
    const un = result.filter(r => !r.xep_loai);
    if (sortKey === 'rank') {
      result = [...(sortDir === 'desc' ? [...sc].reverse() : sc), ...un];
    } else {
      const sortedSc = [...sc].sort((a, b) => {
        let va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
        if (typeof va === 'string') { va = va.toLowerCase(); vb = String(vb).toLowerCase(); }
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ?  1 : -1;
        return 0;
      });
      result = [...sortedSc, ...un];
    }
    return result;
  }, [rankedRows, filterKV, filterNhom, filterLoai, filterName, sortKey, sortDir]);

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortIcon = key =>
    sortKey !== key
      ? <span className="text-gray-300 ml-0.5 text-[10px]">↕</span>
      : <span className="text-blue-500 ml-0.5 text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>;

  const isPhongLocked   = useMemo(() => isInputPhongLocked(thang),  [thang, refreshKey]);
  const isCaNhanLocked  = useMemo(() => isInputCNLocked(thang),     [thang, refreshKey]);

  const phongComplete = useMemo(() => getInputPhongStatus(thang) === 'full', [thang, refreshKey]);

  const phongAll   = phong.kpiPhong.filter(k => phong.kpiCalc[k.kpi_id] !== null);
  const phongDat   = phongAll.filter(k => phong.kpiCalc[k.kpi_id]?.pct !== null && phong.kpiCalc[k.kpi_id].pct >= 1);
  const phongKhDat = phongAll.filter(k => {
    const c = phong.kpiCalc[k.kpi_id];
    return c?.pct !== null && c.pct !== undefined && c.pct < 1;
  });
  const phongLoai = phong.hasData ? xepLoaiWithConfig(phong.tongDiem, getXepLoaiConfig()) : null;
  const phongUI   = phongLoai ? LOAI_UI[phongLoai] : null;

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg md:text-xl font-bold text-slate-900">📊 Dashboard</h2>
          <p className="text-slate-500 text-xs mt-0.5">Tổng quan kết quả KPI Phòng và cá nhân, điểm số và xếp loại theo tháng</p>
        </div>
        {dataThangList.length > 0 && (
          <YearMonthPicker thangList={dataThangList} value={thang} onChange={setThang} />
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
        📊 <strong>Dashboard</strong> — Tổng hợp điểm KPI Phòng và từng nhân viên theo tháng. Chọn tháng để xem kết quả thực hiện, điểm số và xếp loại.
      </div>

      {dataThangList.length === 0 && (
        <div className="card flex flex-col items-center gap-3 py-16 text-center text-slate-400">
          <span className="text-4xl">📭</span>
          <p className="text-base font-medium text-gray-500">Chưa có dữ liệu KPI nào</p>
          <p className="text-sm">Hãy nhập liệu và tính điểm KPI trong menu <strong>Nhập liệu KPI</strong> trước.</p>
        </div>
      )}

      {loading && (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="animate-spin inline-block">⏳</span>
          Đang tải dữ liệu từ Supabase...
        </div>
      )}

      {/* ── TIẾN ĐỘ NHẬP LIỆU + GHI CHÚ THÁNG (A + E) ─────── */}
      {dataThangList.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Tiến độ nhập liệu — tháng {thang.replace('-', '/')}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: 'Nhập liệu KPI Cá nhân',
                value: `${progress.scored}/${progress.total} đã tính điểm`,
                detail: (() => {
                  const parts = [];
                  if (progress.nhapDu    > 0) parts.push(`${progress.nhapDu} nhập đủ, chờ tính`);
                  if (progress.nhapThieu > 0) parts.push(`${progress.nhapThieu} thiếu dữ liệu`);
                  if (progress.chuaNhap  > 0) parts.push(`${progress.chuaNhap} chưa nhập`);
                  return parts.join(' · ');
                })(),
                ok: progress.scored === progress.total && progress.total > 0,
              },
              {
                label: 'Nhập liệu KPI Phòng',
                value: !phong.hasData ? 'Chưa có dữ liệu' : phongComplete ? 'Đủ dữ liệu' : 'Thiếu dữ liệu',
                ok: phongComplete,
              },
              {
                label: 'Chốt KPI cá nhân',
                value: isCaNhanLocked ? 'Đã chốt' : 'Chưa chốt',
                ok: isCaNhanLocked,
              },
              {
                label: 'Chốt KPI phòng',
                value: isPhongLocked ? 'Đã chốt' : 'Chưa chốt',
                ok: isPhongLocked,
              },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 flex items-center gap-3 shadow-sm"
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                  item.ok ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-500'
                }`}>{item.ok ? '✓' : '○'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500">{item.label}</p>
                  <p className={`font-semibold text-sm mt-0.5 ${item.ok ? 'text-green-700' : 'text-amber-700'}`}>
                    {item.value}
                  </p>
                  {item.detail && (
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{item.detail}</p>
                  )}
                </div>
                <span className={`w-2 h-2 rounded-full shrink-0 ${item.ok ? 'bg-green-400' : 'bg-amber-400'}`} />
              </div>
            ))}
          </div>

          {editingNote ? (
            <div className="space-y-2">
              <textarea
                className="input w-full text-sm resize-none"
                rows={3}
                placeholder="Ghi chú cho tháng này (tối đa 500 ký tự). Ctrl+Enter để lưu, Esc để hủy."
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                maxLength={500}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setEditingNote(false);
                  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    const trimmed = noteInput.trim();
                    saveMonthNote(thang, trimmed);
                    setMonthNote(trimmed);
                    setEditingNote(false);
                  }
                }}
              />
              <div className="flex items-center gap-2 justify-end">
                <span className="text-xs text-gray-400 mr-auto">{noteInput.length}/500 ký tự</span>
                <button className="btn-secondary text-xs" onClick={() => setEditingNote(false)}>Hủy</button>
                <button
                  className="btn-primary text-xs"
                  onClick={() => {
                    const trimmed = noteInput.trim();
                    saveMonthNote(thang, trimmed);
                    setMonthNote(trimmed);
                    setEditingNote(false);
                  }}
                >
                  💾 Lưu
                </button>
              </div>
            </div>
          ) : monthNote ? (
            <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
              <span className="text-base shrink-0 mt-0.5">📌</span>
              <span className="flex-1 whitespace-pre-wrap">{monthNote}</span>
              {canAdmin(user) && (
                <button
                  className="text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded hover:bg-amber-100 transition-colors"
                  onClick={() => { setNoteInput(monthNote); setEditingNote(true); }}
                  title="Chỉnh sửa ghi chú"
                >
                  ✏️
                </button>
              )}
            </div>
          ) : canAdmin(user) ? (
            <button
              className="text-xs text-slate-400 hover:text-blue-500 flex items-center gap-1 py-1 transition-colors"
              onClick={() => { setNoteInput(''); setEditingNote(true); }}
            >
              <span>+</span>
              <span>Thêm ghi chú cho tháng {thang.replace('-', '/')}</span>
            </button>
          ) : null}
        </section>
      )}

      {/* ── VÙNG 1: KPI PHÒNG ─────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            KPI Phòng — tháng {thang.replace('-', '/')}
          </h3>
          {phong.hasData && (
            isPhongLocked
              ? <span className="badge-success text-xs px-2.5 py-1">🔒 Đã chốt KPI</span>
              : <span className="badge-warning text-xs px-2.5 py-1">⏳ Đang tạm tính</span>
          )}
        </div>

        {!phong.hasData ? (
          <div className="card flex items-center gap-3 px-5 py-5 text-slate-400">
            <span className="text-2xl">📭</span>
            <span className="text-sm">Chưa có dữ liệu KPI phòng tháng này.</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Điểm tổng + xếp loại */}
              <div className={`rounded-xl border p-6 flex items-center gap-5 ${phongUI?.card || 'border-slate-200 bg-slate-50'}`}>
                <div>
                  <p className={`text-5xl font-bold tabular-nums tracking-tight ${phongUI?.tc || 'text-slate-700'}`}>
                    {fmt(phong.tongDiem)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1.5">Tổng điểm KPI Phòng</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    KPI phòng: {fmt(phong.diemPhongSum)}đ · KPI Công ty: {fmt(phong.diem_cty_dong_gop)}đ
                  </p>
                </div>
                {phongLoai && (
                  <div className="ml-auto flex flex-col items-center gap-1.5 shrink-0">
                    <span className={`flex items-center justify-center w-16 h-16 rounded-2xl text-2xl font-bold shadow-sm ${phongUI?.badge}`}>
                      {phongLoai}
                    </span>
                    <p className="text-xs font-medium text-slate-600">{xepLoaiLabel(phongLoai)}</p>
                  </div>
                )}
              </div>

              {/* Thống kê nhanh */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                {[
                  { label: 'Điểm KPI Công ty',         value: fmt(phong.diem_cty) + 'đ' },
                  { label: 'Tỷ lệ trọng số KPI Công ty / KPI Phòng',    value: `${phong.ty_le_cty}% / ${phong.ty_le_phong}%` },
                  { label: 'Tổng số KPI phòng',         value: phong.kpiPhong.length },
                  { label: 'Số KPI đạt (% Thực hiện ≥ 100%)',       value: phongDat.length,   cls: 'text-green-600 font-semibold' },
                  { label: 'Số KPI không đạt (% Thực hiện < 100%)', value: phongKhDat.length, cls: 'text-red-600 font-semibold'   },
                ].map((row, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm border-b border-slate-100 last:border-0">
                    <span className="text-slate-500">{row.label}</span>
                    <span className={row.cls || 'font-medium text-slate-900'}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Danh sách KPI không đạt */}
            {phongKhDat.length > 0 && (
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-2.5 bg-red-50 border-b border-red-100">
                  <h4 className="text-sm font-semibold text-red-700">
                    Danh sách KPI không đạt ({phongKhDat.length})
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-blue-50 border-b border-blue-100">
                      <tr>
                        <th className="th">Tên KPI</th>
                        <th className="th text-center w-14">ĐVT</th>
                        <th className="th text-right w-22">KQ Thực hiện</th>
                        <th className="th text-right w-22">% Thực hiện</th>
                        <th className="th text-right w-22">Chỉ tiêu</th>
                        <th className="th text-right w-22">Ngưỡng dưới</th>
                        <th className="th text-right w-22">Trọng số</th>
                        <th className="th text-right w-22">Điểm quy đổi</th>
                        <th className="th text-right w-22">Điểm tối đa (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {phongKhDat.map(kpi => {
                        const c = phong.kpiCalc[kpi.kpi_id];
                        return (
                          <tr key={kpi.kpi_id} className="hover:bg-red-50/30 border-b border-slate-100 last:border-0">
                            <td className="td font-medium">{kpi.ten_kpi}</td>
                            <td className="td text-center text-slate-500">{kpi.don_vi}</td>
                            <td className="td text-right tabular-nums">{fmt(c.value)}</td>
                            <td className="td text-right text-red-600 font-medium">{fmtPctDisp(c.dispPct)}</td>
                            <td className="td text-right tabular-nums">{fmt(c.upper)}</td>
                            <td className="td text-right tabular-nums">{fmt(c.lower)}</td>
                            <td className="td text-right tabular-nums">{fmt(c.w)}</td>
                            <td className="td text-right tabular-nums">{fmt(c.diem)}</td>
                            <td className="td text-right tabular-nums">{c.max_pct}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── VÙNG 2: KPI CÁ NHÂN ──────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            KPI Cá nhân — tháng {thang.replace('-', '/')}
          </h3>
          {rows.length > 0 && (
            isCaNhanLocked
              ? <span className="badge-success text-xs px-2.5 py-1">🔒 Đã chốt KPI</span>
              : <span className="badge-warning text-xs px-2.5 py-1">⏳ Đang tạm tính</span>
          )}
        </div>

        {/* Summary cards — click để filter */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {['A+', 'A', 'B', 'C', 'D'].map(loai => {
            const lc     = LOAI_UI[loai];
            const active = filterLoai === loai;
            return (
              <button key={loai}
                onClick={() => setFilterLoai(active ? '' : loai)}
                className={`rounded-xl border p-3.5 text-left transition-all shadow-sm ${lc.card} ${active ? 'ring-2 ring-offset-1 ring-blue-500' : 'hover:opacity-90'}`}>
                <p className={`text-2xl font-bold tabular-nums ${lc.tc}`}>{stats[loai]}</p>
                <p className="text-xs text-slate-600 mt-0.5">{xepLoaiLabel(loai)}</p>
              </button>
            );
          })}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-left shadow-sm">
            <p className="text-2xl font-bold tabular-nums text-slate-500">{stats.chua_tinh}</p>
            <p className="text-xs text-slate-500 mt-0.5">Chưa có điểm</p>
          </div>
        </div>

        {/* Feature B: Biểu đồ điểm NV */}
        {chartRows.length > 0 && (
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
              Biểu đồ điểm KPI cá nhân — tháng {thang.replace('-', '/')}
            </h4>
            <div className="space-y-2">
              {chartRows.map(r => {
                const pct = Math.min(100, Math.max(1, (r.tong_diem / 115) * 100));
                const barCls = BAR_COLOR[r.xep_loai] || 'bg-slate-300';
                const lc = LOAI_UI[r.xep_loai] || {};
                return (
                  <div key={r.nv_id} className="flex items-center gap-2.5 text-xs">
                    <span className="w-28 shrink-0 text-right text-slate-700 truncate font-medium">{r.ho_ten}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-3.5 overflow-hidden">
                      <div className={`h-3.5 rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-14 text-right font-semibold tabular-nums text-slate-800">
                      {Number(r.tong_diem).toFixed(2)}đ
                    </span>
                    <span className={`w-8 text-center font-bold text-xs ${lc.tc || 'text-slate-500'}`}>
                      {r.xep_loai}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bộ lọc */}
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="text"
            className="input w-full sm:w-64"
            placeholder="🔍 Tìm tên nhân viên..."
            value={filterName}
            onChange={e => setFilterName(e.target.value)}
          />
          <select className="input flex-1 sm:flex-none sm:w-44" value={filterKV} onChange={e => setFilterKV(e.target.value)}>
            <option value="">Tất cả khu vực</option>
            {kvList.map(v => <option key={v}>{v}</option>)}
          </select>
          <select className="input flex-1 sm:flex-none sm:w-48" value={filterNhom} onChange={e => setFilterNhom(e.target.value)}>
            <option value="">Tất cả nhóm CV</option>
            {nhomList.map(v => <option key={v}>{v}</option>)}
          </select>
          <select className="input flex-1 sm:flex-none sm:w-44" value={filterLoai} onChange={e => setFilterLoai(e.target.value)}>
            <option value="">Tất cả xếp loại</option>
            {['A+', 'A', 'B', 'C', 'D'].map(l => (
              <option key={l} value={l}>{l} — {xepLoaiLabel(l)}</option>
            ))}
          </select>
          {(filterKV || filterNhom || filterLoai || filterName) && (
            <button className="btn-secondary text-xs"
              onClick={() => { setFilterKV(''); setFilterNhom(''); setFilterLoai(''); setFilterName(''); }}>
              ✕ Xóa lọc
            </button>
          )}
          <button
            className="btn-secondary text-sm sm:ml-auto"
            disabled={!filtered.length}
            onClick={() => exportDashboardToExcel(thang, filtered)}
          >
            📥 Xuất Excel
          </button>
        </div>

        {/* Bảng kết quả */}
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
            <span className="font-semibold text-slate-900 text-sm">
              Kết quả KPI {thang.replace('-', '/')}
              {filtered.length !== rows.length && (
                <span className="text-slate-400 font-normal ml-2 text-xs">
                  ({filtered.length}/{rows.length})
                </span>
              )}
            </span>
            <div className="flex items-center gap-3 flex-wrap">
              {meta?.updated_at && (
                <span className="text-xs text-slate-400">
                  🕐 Cập nhật: {new Date(meta.updated_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <span className="text-xs text-slate-400">
                {rows.filter(r => r.xep_loai).length}/{rows.length} NV có điểm
              </span>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center text-slate-400 py-12">
              <p className="text-4xl mb-3">📭</p>
              <p className="font-medium text-sm">Chưa có kết quả tháng này</p>
              <p className="text-xs mt-1">Vào tab Nhập liệu để nhập và tính điểm</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-blue-50 border-b border-blue-100">
                  <tr>
                    <th className="th text-center w-10">STT</th>
                    <th className="th cursor-pointer select-none w-20 hidden sm:table-cell" onClick={() => handleSort('nv_id')}>
                      Mã NV {sortIcon('nv_id')}
                    </th>
                    <th className="th cursor-pointer select-none" onClick={() => handleSort('ho_ten')}>
                      Họ và tên {sortIcon('ho_ten')}
                    </th>
                    <th className="th text-center hidden md:table-cell">Trạng thái</th>
                    <th className="th cursor-pointer select-none hidden lg:table-cell" onClick={() => handleSort('nhom_cv')}>
                      Nhóm CV {sortIcon('nhom_cv')}
                    </th>
                    <th className="th cursor-pointer select-none hidden md:table-cell" onClick={() => handleSort('khu_vuc')}>
                      Khu vực {sortIcon('khu_vuc')}
                    </th>
                    <th className="th text-right cursor-pointer select-none" onClick={() => handleSort('tong_diem')}>
                      Điểm {sortIcon('tong_diem')}
                    </th>
                    <th className="th text-center cursor-pointer select-none" onClick={() => handleSort('xep_loai')}>
                      Xếp loại {sortIcon('xep_loai')}
                    </th>
                    <th className="th text-center hidden sm:table-cell">Mức độ HT</th>
                    <th className="th text-center cursor-pointer select-none w-14 hidden sm:table-cell" onClick={() => handleSort('rank')}>
                      Hạng {sortIcon('rank')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const isScored = !!r.xep_loai;
                    const lc = LOAI_UI[r.xep_loai] || {};
                    const lyDoBadge = r.ly_do === 'Chưa nhập dữ liệu'
                      ? 'bg-slate-100 text-slate-500 border border-slate-200'
                      : r.ly_do === 'Đã nhập đủ — chờ tính điểm'
                        ? 'bg-teal-50 text-teal-700 border border-teal-200'
                        : r.ly_do === 'Thiếu trọng số'
                          ? 'bg-orange-50 text-orange-700 border border-orange-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200';
                    return (
                      <tr key={r.nv_id} className={`border-b border-slate-100 last:border-0 ${isScored ? 'hover:bg-slate-50' : 'bg-amber-50/20 hover:bg-amber-50/40'}`}>
                        <td className="td text-center text-slate-400 text-xs">{i + 1}</td>
                        <td className="td text-xs text-slate-500 tabular-nums font-mono hidden sm:table-cell">{r.nv_id}</td>
                        <td className="td font-medium text-slate-900">
                          {r.ho_ten}
                          <span className="block text-[10px] text-slate-400 sm:hidden">{r.nv_id}</span>
                        </td>
                        <td className="td text-center hidden md:table-cell">
                          {r.active
                            ? <span className="badge-success">Đang làm</span>
                            : <span className="badge-neutral">Đã nghỉ</span>}
                        </td>
                        <td className="td text-slate-600 text-xs hidden lg:table-cell">{r.nhom_cv}</td>
                        <td className="td text-slate-600 text-xs hidden md:table-cell">{r.khu_vuc}</td>
                        {isScored ? (
                          <>
                            <td className="td text-right font-semibold tabular-nums">{fmt(r.tong_diem)}</td>
                            <td className="td text-center">
                              <span className={`badge ${lc.badge}`}>{r.xep_loai}</span>
                            </td>
                            <td className="td text-center hidden sm:table-cell">
                              <span className={`badge ${lc.badge}`}>{xepLoaiLabel(r.xep_loai)}</span>
                            </td>
                            <td className="td text-center font-medium text-slate-500 text-xs hidden sm:table-cell">#{r.rank}</td>
                          </>
                        ) : (
                          <>
                            <td className="td text-right text-slate-300 text-xs">—</td>
                            <td className="td text-center">
                              <span className={`badge text-xs ${lyDoBadge}`}>{r.ly_do}</span>
                            </td>
                            <td className="td text-center text-slate-300 text-xs hidden sm:table-cell">—</td>
                            <td className="td text-center text-slate-300 text-xs hidden sm:table-cell">—</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
