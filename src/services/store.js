/**
 * @file store.js
 * @description Lớp dữ liệu trung tâm — quản lý toàn bộ state qua localStorage (cache).
 *
 * NGUYÊN TẮC: localStorage chỉ là cache; Supabase PostgreSQL là nguồn sự thật duy nhất.
 * Mọi hàm save* phải đi kèm syncToSupabase/syncKpiLibrary/syncNvLibrary tương ứng.
 *
 * DỮ LIỆU QUẢN LÝ:
 * - Thư viện: kpi_library, nhom_library, nv_library, nhom_cv_list, khu_vuc_list
 * - Template: kpi_list (refs), nhom_list (refs)
 * - Snapshot per-tháng: kpi_snapshot_*, nv_snapshot_*, trong_so_thang_*
 * - Operational: input_cn, input_phong, output_diem, output_chitiet
 * - Config: xep_loai_config, locked_cn_YYYY, locked_phong_YYYY
 *
 * LƯU Ý:
 * - initialData.js chỉ dùng khi chưa từng kết nối Supabase; sau kết nối thì không dùng nữa.
 * - Snapshot (kpi_snapshot_*, nv_snapshot_*) KHÔNG lưu vào initialData.
 * - getNvListForThang() KHÔNG filter theo active/archived — xử lý tất cả NV bình thường.
 */
// Persistent store dùng localStorage — chỉ là cache, nguồn sự thật là Supabase
import * as _initData from '../data/initialData';
// Dùng ?? [] để không crash khi initialData.js rỗng hoặc export thiếu
const INITIAL_KPI_LIST        = _initData.INITIAL_KPI_LIST        ?? [];
const INITIAL_NHOM_LIST       = _initData.INITIAL_NHOM_LIST       ?? [];
const INITIAL_KPI_LIBRARY     = _initData.INITIAL_KPI_LIBRARY     ?? [];
const INITIAL_NHOM_LIBRARY    = _initData.INITIAL_NHOM_LIBRARY    ?? [];
const INITIAL_NHAN_VIEN       = _initData.INITIAL_NHAN_VIEN       ?? [];
const INITIAL_TRONG_SO        = _initData.INITIAL_TRONG_SO        ?? [];
const NHOM_CV_LIST            = _initData.NHOM_CV_LIST            ?? [];
const KHU_VUC_LIST            = _initData.KHU_VUC_LIST            ?? [];
const INITIAL_NHOM_CV_LIBRARY = _initData.INITIAL_NHOM_CV_LIBRARY ?? [];
const INITIAL_KV_LIBRARY      = _initData.INITIAL_KV_LIBRARY      ?? [];

// Fire-and-forget sync lên Supabase config_store
export function syncToSupabase(key, value) {
  import('./supabaseService').then(({ isConnected, syncStore }) => {
    if (!isConnected()) return;
    syncStore(key, value).catch(err => console.warn('[Supabase sync]', key, err.message));
  });
}

export function deleteFromSupabase(key) {
  syncToSupabase(key, null);
}

const KEYS = {
  kpiList:       'kpi_list',
  nhomList:      'nhom_list',
  kpiLibrary:    'kpi_library',
  nhomLibrary:   'nhom_library',
  nvLibrary:     'nv_library',
  nhomCvLibrary: 'nhom_cv_library',
  kvLibrary:     'kv_library',
  nvList:        'nv_list',
  trongSo:       'trong_so',
  inputCN:       'input_cn',
  inputPhong:    'input_phong',
  outputDiem:    'output_diem',
  outputCT:      'output_chitiet',
  nhomCvList:    'nhom_cv_list',
  khuVucList:    'khu_vuc_list',
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Resolve helpers ───────────────────────────────────────────

function resolveKpiRefs(refs, library) {
  const map = new Map((library || []).map(k => [k.kpi_id, k]));
  return (refs || []).map(ref => {
    const base = map.get(ref.kpi_id);
    if (!base) return null;
    return { ...base, nhom_id: ref.nhom_id, stt: ref.stt, active: true };
  }).filter(Boolean);
}

function resolveNhomRefs(refs, library) {
  const map = new Map((library || []).map(n => [n.nhom_id, n]));
  return (refs || []).map(ref => {
    const base = map.get(ref.nhom_id);
    if (!base) return null;
    return { ...base, thu_tu: ref.thu_tu, kpi_cap: ref.kpi_cap || base.kpi_cap };
  }).filter(Boolean);
}

// ── KPI Library ───────────────────────────────────────────────

export function getKpiLibrary()   { return load(KEYS.kpiLibrary, INITIAL_KPI_LIBRARY); }
export function saveKpiLibrary(v) { save(KEYS.kpiLibrary, v); }

export function addKpiToLibrary(kpi) {
  const lib = getKpiLibrary().filter(k => k.kpi_id !== kpi.kpi_id);
  lib.push({ ...kpi, archived_at: kpi.archived_at ?? null });
  saveKpiLibrary(lib);
}

export function archiveKpi(kpi) {
  const lib = getKpiLibrary();
  const idx = lib.findIndex(k => k.kpi_id === kpi.kpi_id);
  if (idx >= 0) lib[idx] = { ...lib[idx], archived_at: new Date().toISOString() };
  else lib.push({ ...kpi, archived_at: new Date().toISOString() });
  saveKpiLibrary(lib);
}

export function deleteKpiPermanently(kpi_id) {
  saveKpiLibrary(getKpiLibrary().filter(k => k.kpi_id !== kpi_id));
  save(KEYS.kpiList, load(KEYS.kpiList, []).filter(r => r.kpi_id !== kpi_id));
}

// ── Nhóm Library ─────────────────────────────────────────────

export function getNhomLibrary()   { return load(KEYS.nhomLibrary, INITIAL_NHOM_LIBRARY); }
export function saveNhomLibrary(v) { save(KEYS.nhomLibrary, v); }

export function addNhomToLibrary(nhom) {
  const lib = getNhomLibrary().filter(n => n.nhom_id !== nhom.nhom_id);
  lib.push({ ...nhom, archived_at: nhom.archived_at ?? null });
  saveNhomLibrary(lib);
}

export function deleteNhomPermanently(nhom_id) {
  saveNhomLibrary(getNhomLibrary().filter(n => n.nhom_id !== nhom_id));
  save(KEYS.nhomList, load(KEYS.nhomList, []).filter(r => r.nhom_id !== nhom_id));
  // Xóa nhom_id khỏi tất cả kpiList refs
  save(KEYS.kpiList, load(KEYS.kpiList, []).map(r =>
    r.nhom_id === nhom_id ? { ...r, nhom_id: '' } : r
  ));
}

// ── KPI List (template refs) ──────────────────────────────────
// getKpiList trả về resolved objects (backward compat với mọi consumer)
export function getKpiList() {
  const refs = load(KEYS.kpiList, INITIAL_KPI_LIST);
  // Nếu refs là full objects (format cũ), trả về as-is
  if (refs.length > 0 && refs[0].ten_kpi !== undefined) return refs;
  return resolveKpiRefs(refs, getKpiLibrary());
}

// Trả về raw refs (cho những nơi cần sync lên Supabase)
export function getKpiRefs() {
  const refs = load(KEYS.kpiList, INITIAL_KPI_LIST);
  // Nếu là full objects (format cũ), extract refs
  if (refs.length > 0 && refs[0].ten_kpi !== undefined)
    return refs.map(k => ({ kpi_id: k.kpi_id, nhom_id: k.nhom_id, stt: k.stt }));
  return refs;
}

// saveKpiList luôn extract refs trước khi lưu
export function saveKpiList(listOrRefs) {
  const refs = listOrRefs.map(k => ({ kpi_id: k.kpi_id, nhom_id: k.nhom_id || '', stt: k.stt }));
  save(KEYS.kpiList, refs);
}

// ── Nhóm List (template refs) ─────────────────────────────────
// getNhomList trả về resolved objects
export function getNhomList() {
  const refs = load(KEYS.nhomList, INITIAL_NHOM_LIST);
  // Nếu là full objects (format cũ), trả về as-is
  if (refs.length > 0 && refs[0].ten_nhom !== undefined) return refs;
  return resolveNhomRefs(refs, getNhomLibrary());
}

export function getNhomRefs() {
  const refs = load(KEYS.nhomList, INITIAL_NHOM_LIST);
  if (refs.length > 0 && refs[0].ten_nhom !== undefined)
    return refs.map(n => ({ nhom_id: n.nhom_id, thu_tu: n.thu_tu, kpi_cap: n.kpi_cap }));
  return refs;
}

export function saveNhomList(listOrRefs) {
  const refs = listOrRefs.map(n => ({ nhom_id: n.nhom_id, thu_tu: n.thu_tu, kpi_cap: n.kpi_cap }));
  save(KEYS.nhomList, refs);
}

// ── ID generators — format: PREFIX_xxxxxx (6 chữ số, tối đa 999999) ──────────

function _nextId(prefix, existingIds) {
  const set = new Set(existingIds);
  for (let i = 1; i <= 999999; i++) {
    const id = prefix + String(i).padStart(6, '0');
    if (!set.has(id)) return id;
  }
  throw new Error('Đã dùng hết mã ' + prefix);
}

export function generateKpiId(kpi_cap) {
  const prefix = kpi_cap === 'ca_nhan' ? 'KPI_CN_' : 'KPI_PH_';
  return _nextId(prefix, getKpiLibrary().map(k => k.kpi_id));
}

export function generateNhomId(kpi_cap) {
  const prefix = kpi_cap === 'ca_nhan' ? 'NhomKPI_CN_' : 'NhomKPI_PH_';
  return _nextId(prefix, getNhomLibrary().map(n => n.nhom_id));
}

export function generateNhomCvId() {
  return _nextId('NhomCV_CN_', getNhomCvLibrary().map(n => n.nhom_cv_id));
}

export function generateKvId() {
  return _nextId('KVQL_VN_', getKvLibrary().map(n => n.kv_id));
}

// ── KPI Catalog ───────────────────────────────────────────────

export function getAllKpiCatalog() {
  const library  = getKpiLibrary();
  const kpiRefs  = getKpiRefs();
  const templateIds = new Set(kpiRefs.map(r => r.kpi_id));

  const usedMonths = {};
  getSnapshotThangList().forEach(thang => {
    const snap = getKpiSnapshot(thang);
    const refs = snap?.kpiRefs || (snap?.kpiList ? snap.kpiList : []);
    refs.forEach(ref => {
      const id = ref.kpi_id;
      if (!usedMonths[id]) usedMonths[id] = [];
      usedMonths[id].push(thang);
    });
  });

  return library.map(kpi => ({
    ...kpi,
    inTemplate: templateIds.has(kpi.kpi_id),
    archived: !!kpi.archived_at,
    usedInMonths: usedMonths[kpi.kpi_id] || [],
  }));
}

// ── Nhóm Catalog ─────────────────────────────────────────────

export function getAllNhomCatalog() {
  const library   = getNhomLibrary();
  const nhomRefs  = getNhomRefs();
  const templateIds = new Set(nhomRefs.map(r => r.nhom_id));

  const usedMonths = {};
  getSnapshotThangList().forEach(thang => {
    const snap = getKpiSnapshot(thang);
    (snap?.nhomRefs || []).forEach(ref => {
      const id = ref.nhom_id;
      if (!usedMonths[id]) usedMonths[id] = [];
      usedMonths[id].push(thang);
    });
  });

  return library.map(nhom => ({
    ...nhom,
    inTemplate: templateIds.has(nhom.nhom_id),
    archived: !!nhom.archived_at,
    usedInMonths: usedMonths[nhom.nhom_id] || [],
  }));
}

// ── Nhóm Công việc Library ────────────────────────────────────

export function getNhomCvLibrary() {
  if (localStorage.getItem(KEYS.nhomCvLibrary) !== null) return load(KEYS.nhomCvLibrary, []);
  if (INITIAL_NHOM_CV_LIBRARY.length > 0) return INITIAL_NHOM_CV_LIBRARY;
  // first time: migrate from string list
  return load(KEYS.nhomCvList, NHOM_CV_LIST).map((name, i) => ({
    nhom_cv_id:  `NhomCV_CN_${String(i + 1).padStart(6, '0')}`,
    ten_nhom_cv: name,
    archived_at: null,
  }));
}
export function saveNhomCvLibrary(v) { save(KEYS.nhomCvLibrary, v); }

export function addNhomCvToLibrary(item) {
  const lib = getNhomCvLibrary().filter(n => n.nhom_cv_id !== item.nhom_cv_id);
  lib.push({ nhom_cv_id: item.nhom_cv_id, ten_nhom_cv: item.ten_nhom_cv, archived_at: null });
  saveNhomCvLibrary(lib);
}
export function deleteNhomCvFromLibrary(nhom_cv_id) {
  saveNhomCvLibrary(getNhomCvLibrary().filter(n => n.nhom_cv_id !== nhom_cv_id));
}
export function renameNhomCv(nhom_cv_id, newName) {
  const lib = getNhomCvLibrary();
  const item = lib.find(n => n.nhom_cv_id === nhom_cv_id);
  if (!item) return;
  const oldName = item.ten_nhom_cv;
  item.ten_nhom_cv = newName;
  saveNhomCvLibrary(lib);
  // propagate rename to all NV snapshots
  getSnapshotNvThangList().forEach(thang => {
    const snap = getNvSnapshot(thang);
    if (!snap?.nvRefs?.some(r => r.nhom_cv === oldName)) return;
    saveNvSnapshot(thang, snap.nvRefs.map(r => r.nhom_cv === oldName ? { ...r, nhom_cv: newName } : r));
  });
}
export function getAllNhomCvCatalog() {
  const library = getNhomCvLibrary();
  const usedMonths = {};
  getSnapshotNvThangList().forEach(thang => {
    (getNvSnapshot(thang)?.nvRefs || []).forEach(ref => {
      if (ref.nhom_cv) { if (!usedMonths[ref.nhom_cv]) usedMonths[ref.nhom_cv] = []; usedMonths[ref.nhom_cv].push(thang); }
    });
  });
  return library.map(item => ({ ...item, archived: !!item.archived_at, usedInMonths: usedMonths[item.ten_nhom_cv] || [] }));
}

// ── Khu vực quản lý Library ───────────────────────────────────

export function getKvLibrary() {
  if (localStorage.getItem(KEYS.kvLibrary) !== null) return load(KEYS.kvLibrary, []);
  if (INITIAL_KV_LIBRARY.length > 0) return INITIAL_KV_LIBRARY;
  // first time: migrate from string list
  return load(KEYS.khuVucList, KHU_VUC_LIST).map((name, i) => ({
    kv_id:      `KVQL_VN_${String(i + 1).padStart(6, '0')}`,
    ten_kv:     name,
    archived_at: null,
  }));
}
export function saveKvLibrary(v) { save(KEYS.kvLibrary, v); }

export function addKvToLibrary(item) {
  const lib = getKvLibrary().filter(n => n.kv_id !== item.kv_id);
  lib.push({ kv_id: item.kv_id, ten_kv: item.ten_kv, archived_at: null });
  saveKvLibrary(lib);
}
export function deleteKvFromLibrary(kv_id) {
  saveKvLibrary(getKvLibrary().filter(n => n.kv_id !== kv_id));
}
export function renameKv(kv_id, newName) {
  const lib = getKvLibrary();
  const item = lib.find(n => n.kv_id === kv_id);
  if (!item) return;
  const oldName = item.ten_kv;
  item.ten_kv = newName;
  saveKvLibrary(lib);
  getSnapshotNvThangList().forEach(thang => {
    const snap = getNvSnapshot(thang);
    if (!snap?.nvRefs?.some(r => r.khu_vuc === oldName)) return;
    saveNvSnapshot(thang, snap.nvRefs.map(r => r.khu_vuc === oldName ? { ...r, khu_vuc: newName } : r));
  });
}
export function getAllKvCatalog() {
  const library = getKvLibrary();
  const usedMonths = {};
  getSnapshotNvThangList().forEach(thang => {
    (getNvSnapshot(thang)?.nvRefs || []).forEach(ref => {
      if (ref.khu_vuc) { if (!usedMonths[ref.khu_vuc]) usedMonths[ref.khu_vuc] = []; usedMonths[ref.khu_vuc].push(thang); }
    });
  });
  return library.map(item => ({ ...item, archived: !!item.archived_at, usedInMonths: usedMonths[item.ten_kv] || [] }));
}

// ── Nhóm công việc & Khu vực (string list — derived từ library) ───────────────
export function getNhomCvList()   { return getNhomCvLibrary().filter(n => !n.archived_at).map(n => n.ten_nhom_cv); }
export function getKhuVucList()   { return getKvLibrary().filter(n => !n.archived_at).map(n => n.ten_kv); }

// ── Nhân viên ─────────────────────────────────────────────────
export function generateNvId() {
  return _nextId('NhanVien_', getNvLibrary().map(n => n.nv_id));
}

// ── NV Library (mirrors nhan_vien) ──────────────────────

export function getNvLibrary() {
  const lib = load(KEYS.nvLibrary, INITIAL_NHAN_VIEN);
  if (lib.length > 0) return lib;
  // migrate from old nv_list on first access
  return load(KEYS.nvList, []).map(n => ({
    nv_id: n.nv_id, ho_ten: n.ho_ten,
    archived_at: n.active === false ? new Date().toISOString() : null,
  }));
}

export function saveNvLibrary(v) { save(KEYS.nvLibrary, v); }

export function addNvToLibrary(nv) {
  const lib = getNvLibrary().filter(n => n.nv_id !== nv.nv_id);
  lib.push({ nv_id: nv.nv_id, ho_ten: nv.ho_ten, archived_at: nv.archived_at ?? null });
  saveNvLibrary(lib);
}

export function deleteNvFromLibrary(nv_id) {
  saveNvLibrary(getNvLibrary().filter(n => n.nv_id !== nv_id));
}

// ── NV Snapshot (per-month, in config_store) ──────────────────

function resolveNvRefs(refs, library) {
  const map = new Map((library || []).map(n => [n.nv_id, n]));
  return (refs || []).map(ref => {
    const base = map.get(ref.nv_id);
    if (!base) return null;
    return { ...ref, ho_ten: base.ho_ten, archived_at: base.archived_at, active: !base.archived_at };
  }).filter(Boolean);
}

export function getNvSnapshot(thang) {
  return load(`nv_snapshot_${thang}`, null);
}

export function getNvListForThang(thang) {
  const snap = getNvSnapshot(thang);
  if (snap?.nvRefs) return resolveNvRefs(snap.nvRefs, getNvLibrary());
  return load(KEYS.nvList, []);
}

export function saveNvSnapshot(thang, nvRefsOrObjects) {
  const refs = nvRefsOrObjects.map(n => ({ nv_id: n.nv_id, nhom_cv: n.nhom_cv || '', khu_vuc: n.khu_vuc || '', stt: n.stt }));
  const obj = {
    thang, nvRefs: refs,
    nhomCvList: getNhomCvList(),
    khuVucList: getKhuVucList(),
    created_at: new Date().toISOString(),
  };
  save(`nv_snapshot_${thang}`, obj);
  syncToSupabase(`nv_snapshot_${thang}`, obj);
}

export function deleteNvSnapshot(thang) {
  localStorage.removeItem(`nv_snapshot_${thang}`);
  deleteFromSupabase(`nv_snapshot_${thang}`);
}

export function getSnapshotNvThangList() {
  const result = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('nv_snapshot_')) result.push(key.replace('nv_snapshot_', ''));
  }
  return result.sort().reverse();
}

export function getAllNvCatalog() {
  const library = getNvLibrary();
  const usedMonths = {};
  getSnapshotNvThangList().forEach(thang => {
    const snap = getNvSnapshot(thang);
    (snap?.nvRefs || []).forEach(ref => {
      if (!usedMonths[ref.nv_id]) usedMonths[ref.nv_id] = [];
      usedMonths[ref.nv_id].push(thang);
    });
  });
  return library.map(nv => ({
    ...nv,
    archived: !!nv.archived_at,
    usedInMonths: usedMonths[nv.nv_id] || [],
  }));
}

// ── Trọng số (legacy matrix) ──────────────────────────────────
export function getTrongSo()   { return load(KEYS.trongSo, INITIAL_TRONG_SO); }

// ── Input cá nhân ─────────────────────────────────────────────
export function getInputCN()   { return load(KEYS.inputCN, []); }
export function saveInputCN(v) { save(KEYS.inputCN, v); }

export function getInputCNByThang(thang) {
  return getInputCN().filter(r => r.thang === thang);
}

export function upsertInputCN(row) {
  const all = getInputCN().filter(r => !(r.thang === row.thang && r.nv_id === row.nv_id));
  all.push(row);
  saveInputCN(all);
}

// ── Trạng thái đủ/thiếu dữ liệu — nguồn duy nhất (single source of truth) ───
// Nguyên tắc:
//   KPI Phòng đủ   = diem_kpi_chinhanh_kq + 5 cột per KPI: _value/_upper/_lower/_trong_so/_max_pct
//   KPI Cá nhân đủ = 6 cột per KPI (_value/_upper/_lower/_trong_so/_max_pct/_giam_tru) + KPI Phòng đủ
//   'empty'   = chưa có bất kỳ thông tin nào
//   'partial' = có một phần nhưng thiếu ít nhất 1 điều kiện
//   'full'    = đủ tất cả điều kiện
// Tất cả menu khác import và dùng hàm này — KHÔNG tự định nghĩa lại.

function _hv(v) { const n = parseFloat(String(v ?? '')); return !isNaN(n); }

// KPI Phòng: nhận form/inp object + danh sách kpiPhong
// (nhận tham số để dùng được cả với form state chưa lưu trong NhapLieuPhong)
export function computePhongInputStatus(inp, kpiPhong) {
  const SUFS  = ['_value', '_upper', '_lower', '_trong_so', '_max_pct'];
  const kq    = inp?.diem_kpi_chinhanh_kq;
  const hasAny = _hv(kq) || kpiPhong.some(k => SUFS.some(s => _hv(inp?.[k.kpi_id + s])));
  if (!hasAny) return 'empty';
  return (_hv(kq) && kpiPhong.every(k => SUFS.every(s => _hv(inp?.[k.kpi_id + s])))) ? 'full' : 'partial';
}

// KPI Phòng từ localStorage
export function getInputPhongStatus(thang) {
  const inp      = getInputPhongByThang(thang);
  const snap     = getKpiSnapshot(thang);
  const kpiPhong = (snap?.kpiList || getKpiList()).filter(k => k.kpi_cap === 'phong');
  return computePhongInputStatus(inp, kpiPhong);
}

// KPI Cá nhân: 'full' yêu cầu đủ 6 cột VÀ KPI Phòng đủ
export function getInputCNStatus(thang, nv_id) {
  const isAuto = (getTrongSoConfig(thang)?.mode ?? 'manual') === 'auto';
  const snap   = getKpiSnapshot(thang);
  const kpiCN  = (snap?.kpiList || getKpiList()).filter(k => k.kpi_cap === 'ca_nhan');
  const nvRow  = getInputCNByThang(thang).find(r => r.nv_id === nv_id);
  const THREE  = ['_value', '_upper', '_lower'];
  const FULL   = isAuto ? THREE : ['_value', '_upper', '_lower', '_trong_so', '_max_pct', '_giam_tru'];
  const hasAny = nvRow && kpiCN.some(k => THREE.some(s => _hv(nvRow[k.kpi_id + s])));
  if (!hasAny) return 'empty';
  return (kpiCN.every(k => FULL.every(s => _hv(nvRow[k.kpi_id + s]))) && getInputPhongStatus(thang) === 'full')
    ? 'full' : 'partial';
}

// ── Input phòng ───────────────────────────────────────────────
// Mỗi tháng lưu riêng: localStorage key = 'input_phong_YYYY-MM'
// Backward compat: cũng đọc mảng cũ từ KEYS.inputPhong

export function getInputPhong() {
  const result = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('input_phong_')) {
      try { const v = JSON.parse(localStorage.getItem(k)); if (v?.thang) result.push(v); } catch {}
    }
  }
  // Backward compat: mảng cũ
  load(KEYS.inputPhong, []).forEach(r => { if (r.thang && !result.find(x => x.thang === r.thang)) result.push(r); });
  return result;
}

export function getInputPhongByThang(thang) {
  const v = localStorage.getItem('input_phong_' + thang);
  if (v) { try { return JSON.parse(v); } catch {} }
  return load(KEYS.inputPhong, []).find(r => r.thang === thang) || null;
}

export function upsertInputPhong(row) {
  localStorage.setItem('input_phong_' + row.thang, JSON.stringify(row));
}

// ── Output ────────────────────────────────────────────────────
export function getOutputDiem()   { return load(KEYS.outputDiem, []); }
export function saveOutputDiem(v) { save(KEYS.outputDiem, v); }

export function getOutputDiemByThang(thang) {
  return getOutputDiem().filter(r => r.thang === thang);
}

export function getOutputCT()   { return load(KEYS.outputCT, []); }
export function saveOutputCT(v) { save(KEYS.outputCT, v); }

export function getOutputCTByThangNV(thang, nv_id) {
  return getOutputCT().filter(r => r.thang === thang && r.nv_id === nv_id);
}

// ── Trim cache input_cn — giữ tối đa N tháng gần nhất ────────
export function trimInputCNCache(maxMonths) {
  const all = getInputCN();
  if (!all.length) return;
  const months = [...new Set(all.map(r => r.thang))].sort().reverse();
  if (months.length <= maxMonths) return;
  const keep = new Set(months.slice(0, maxMonths));
  saveInputCN(all.filter(r => keep.has(r.thang)));
}

// ── Tháng danh sách ───────────────────────────────────────────
export function getThangList() {
  const set = new Set();
  getOutputDiem().forEach(r => set.add(r.thang));
  getInputPhong().forEach(r => set.add(r.thang));
  return Array.from(set).sort().reverse();
}

// ── Snapshot KPI theo tháng ───────────────────────────────────
// saveKpiSnapshot — lưu refs (không lưu full objects)
export function saveKpiSnapshot(thang, kpiListOrRefs, nhomListOrRefs) {
  const kpiRefs  = (kpiListOrRefs || []).map(k => ({ kpi_id: k.kpi_id, nhom_id: k.nhom_id || '', stt: k.stt }));
  const nhomRefs = (nhomListOrRefs || []).map(n => ({ nhom_id: n.nhom_id, thu_tu: n.thu_tu, kpi_cap: n.kpi_cap }));
  const obj = { thang, kpiRefs, nhomRefs, created_at: new Date().toISOString() };
  save(`kpi_snapshot_${thang}`, obj);
  syncToSupabase(`kpi_snapshot_${thang}`, obj);
}

// getKpiSnapshot — resolve refs tại thời điểm đọc (backward compat: trả về kpiList + nhomList)
export function getKpiSnapshot(thang) {
  const raw = load(`kpi_snapshot_${thang}`, null);
  if (!raw) return null;
  if (raw.kpiRefs) {
    const kpiLibrary  = getKpiLibrary();
    const nhomLibrary = getNhomLibrary();
    return {
      ...raw,
      kpiList:  resolveKpiRefs(raw.kpiRefs, kpiLibrary),
      nhomList: resolveNhomRefs(raw.nhomRefs || [], nhomLibrary),
    };
  }
  // Format cũ: full objects (đọc trực tiếp)
  return raw;
}

export function deleteKpiSnapshot(thang) {
  localStorage.removeItem(`kpi_snapshot_${thang}`);
  deleteFromSupabase(`kpi_snapshot_${thang}`);
}

// ── Lock input per-tháng (gộp per-year để tiết kiệm dòng trong config_store) ─
// Format: locked_cn_YYYY = { "YYYY-MM": true }; locked_phong_YYYY = { "YYYY-MM": true }
// Migration tự động từ format cũ locked_input_cn_YYYY-MM khi đọc lần đầu

function _yearLockKey(type, thang) { return `locked_${type}_${thang.slice(0, 4)}`; }

function _readYearLock(type, thang) {
  const yearKey = _yearLockKey(type, thang);
  // Migration: nếu còn key cũ per-month, gộp vào per-year rồi xóa
  const oldKey = `locked_input_${type}_${thang}`;
  if (localStorage.getItem(oldKey) !== null) {
    const yearData = { ...load(yearKey, {}), [thang]: true };
    save(yearKey, yearData);
    syncToSupabase(yearKey, yearData);
    localStorage.removeItem(oldKey);
    deleteFromSupabase(oldKey);
    return true;
  }
  return load(yearKey, {})[thang] === true;
}

function _writeYearLock(type, thang, locked) {
  const yearKey = _yearLockKey(type, thang);
  const yearData = { ...load(yearKey, {}) };
  if (locked) yearData[thang] = true;
  else delete yearData[thang];
  if (Object.keys(yearData).length === 0) {
    localStorage.removeItem(yearKey);
    deleteFromSupabase(yearKey);
  } else {
    save(yearKey, yearData);
    syncToSupabase(yearKey, yearData);
  }
}

export function isInputCNLocked(thang)  { return _readYearLock('cn', thang); }
export function lockInputCN(thang)      { _writeYearLock('cn', thang, true); }
export function unlockInputCN(thang)    { _writeYearLock('cn', thang, false); }

export function isInputPhongLocked(thang)  { return _readYearLock('phong', thang); }
export function lockInputPhong(thang)      { _writeYearLock('phong', thang, true); }
export function unlockInputPhong(thang)    { _writeYearLock('phong', thang, false); }

// ── Danh sách tháng có snapshot ───────────────────────────────
export function getSnapshotThangList() {
  const result = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('kpi_snapshot_')) result.push(key.replace('kpi_snapshot_', ''));
  }
  return result.sort().reverse();
}

// ── Trọng số cấu hình per-tháng ───────────────────────────────
export function getTrongSoConfig(thang)        { return load(`trong_so_thang_${thang}`, null); }
export function saveTrongSoConfig(thang, cfg)  { save(`trong_so_thang_${thang}`, cfg); syncToSupabase(`trong_so_thang_${thang}`, cfg); }
export function deleteTrongSoConfig(thang)     {
  localStorage.removeItem(`trong_so_thang_${thang}`);
  localStorage.removeItem(`trong_so_weights_${thang}`);
  deleteFromSupabase(`trong_so_thang_${thang}`);
  deleteFromSupabase(`trong_so_weights_${thang}`);
}

// ── Cấu hình xếp loại KPI ─────────────────────────────────────
export const DEFAULT_XEP_LOAI_CONFIG = { A_plus: 105, A: 101, B: 100, C: 95 };

export function getXepLoaiConfig() {
  return load('xep_loai_config', DEFAULT_XEP_LOAI_CONFIG);
}

export function saveXepLoaiConfig(config) {
  save('xep_loai_config', config);
  syncToSupabase('xep_loai_config', config);
}

// ── Ghi chú tháng ─────────────────────────────────────────────
// month_note_YYYY-MM lưu MẢNG ghi chú: [{ id, text, url }]. url rỗng = ghi chú thường.
// Legacy: trước đây lưu 1 chuỗi đơn → tự migrate thành mảng 1 phần tử khi đọc.
export function getMonthNotes(thang) {
  try {
    const raw = JSON.parse(localStorage.getItem(`month_note_${thang}`));
    if (!raw) return [];
    if (typeof raw === 'string') return [{ id: 'legacy', text: raw, url: '' }];
    if (Array.isArray(raw)) return raw.filter(n => n && (n.text || n.url));
    return [];
  } catch { return []; }
}
export function saveMonthNotes(thang, notes) {
  const arr = (Array.isArray(notes) ? notes : []).filter(n => n && (n.text || n.url));
  if (arr.length) {
    localStorage.setItem(`month_note_${thang}`, JSON.stringify(arr));
    syncToSupabase(`month_note_${thang}`, arr);
  } else {
    localStorage.removeItem(`month_note_${thang}`);
    deleteFromSupabase(`month_note_${thang}`);
  }
}

// Constrained Linear Allocation: tìm spread b lớn nhất thoả mãn w_1 ≤ wMax và w_N ≥ wMin, Σ = total.
// Ràng buộc chặt hơn (gần avg hơn) được tôn trọng chính xác; ràng buộc kia tự động thoả.
function _constrainedLinearAllocate(kpis, total, wMax, wMin) {
  const n = kpis.length;
  if (!n || total <= 0) return {};
  if (n === 1) return { [kpis[0].kpi_id]: Math.round(total) };
  const avg  = total / n;
  const b    = Math.max(0, Math.min(
    2 * (wMax - avg) / (n - 1),
    2 * (avg - wMin) / (n - 1)
  ));
  const a    = avg - b * (n - 1) / 2;
  const intTotal = Math.round(total);
  const raws   = kpis.map((_, i) => a + b * (n - 1 - i));
  const floors = raws.map(v => Math.floor(v));
  const rem = intTotal - floors.reduce((s, v) => s + v, 0);
  raws.map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((x, y) => y.frac - x.frac)
      .slice(0, Math.max(0, rem))
      .forEach(({ i }) => floors[i]++);
  return Object.fromEntries(kpis.map((kk, i) => [kk.kpi_id, floors[i]]));
}

// Priority toàn cục: Constrained Linear Allocation trên toàn bộ ca_nhan_pct,
// xuyên suốt tất cả nhóm KPI (nhóm chỉ là nhãn tổ chức).
// 3 loại priority: số 1..N (auto), 'fixed' (bắt buộc — điền tay), null (0đ)
export function recomputeKpiPctForNhom(nhomCv, config, kpiList) {
  const cvConfig = config.cv_config?.[nhomCv] || {};
  const prioMap  = config.cv_priorities?.[nhomCv] || {};
  const existing = config.kpi_pct?.[nhomCv] || {};
  const wMaxRef  = config.w_max_ref ?? 20;
  const wMinRef  = config.w_min_ref ?? 10;
  const total    = config.ty_le?.ca_nhan?.ca_nhan ?? 70;
  const result   = {};

  const allKpiIds = [...new Set(Object.values(cvConfig).flat())];
  const allKpis   = allKpiIds.map(id => kpiList.find(kk => kk.kpi_id === id)).filter(Boolean);
  if (!allKpis.length) return result;

  // Loại 'fixed': giữ nguyên pct, trừ khỏi ngân sách auto
  const fixedKpis  = allKpis.filter(kk => prioMap[kk.kpi_id] === 'fixed');
  const activeKpis = allKpis
    .filter(kk => typeof prioMap[kk.kpi_id] === 'number')
    .sort((a, b) => prioMap[a.kpi_id] - prioMap[b.kpi_id]);
  const zeroKpis = allKpis.filter(kk => prioMap[kk.kpi_id] == null);

  fixedKpis.forEach(kk => {
    result[kk.kpi_id] = { pct: existing[kk.kpi_id]?.pct ?? 0, custom: true };
  });
  const fixedSum  = fixedKpis.reduce((s, kk) => s + (existing[kk.kpi_id]?.pct || 0), 0);
  const autoTotal = Math.max(0, total - fixedSum);

  const customMap = {}, autoKpis = [];
  activeKpis.forEach(kk => {
    const ex = existing[kk.kpi_id];
    if (ex?.custom) customMap[kk.kpi_id] = ex.pct;
    else autoKpis.push(kk);
  });

  const customSum = Object.values(customMap).reduce((a, b) => a + b, 0);
  const auto = _constrainedLinearAllocate(autoKpis, Math.max(0, autoTotal - customSum), wMaxRef, wMinRef);
  Object.entries(customMap).forEach(([id, pct]) => { result[id] = { pct, custom: true }; });
  Object.entries(auto).forEach(([id, pct])       => { result[id] = { pct, custom: false }; });
  zeroKpis.forEach(kk => { result[kk.kpi_id] = { pct: 0, custom: false }; });

  return result;
}

export function recomputeAllKpiPct(config, kpiList) {
  const kpiPct = {};
  getNhomCvList().forEach(nhomCv => {
    kpiPct[nhomCv] = recomputeKpiPctForNhom(nhomCv, config, kpiList);
  });
  return { ...config, kpi_pct: kpiPct };
}

export function computeNvWeights(config, kpiList, nvList) {
  const kpiIdSet = new Set(kpiList.map(k => k.kpi_id));
  const result = {};
  nvList.forEach(nv => {
    const template = config.kpi_pct?.[nv.nhom_cv] || {};
    const override = config.nv_override?.[nv.nv_id] || {};
    const weights  = {};
    Object.entries(template).forEach(([id, { pct }]) => { if (kpiIdSet.has(id)) weights[id] = pct > 0 ? pct : 0; });
    Object.entries(override).forEach(([id, pct]) => { if (kpiIdSet.has(id)) weights[id] = pct > 0 ? pct : 0; });
    result[nv.nv_id] = weights;
  });
  return result;
}
