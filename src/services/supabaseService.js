/**
 * @file supabaseService.js
 * @description Supabase client — data operations + auth.
 *
 * DỮ LIỆU:
 * - Libraries → bảng kpi_library, nhom_library, nhan_vien, nhom_cv, khu_vuc
 * - Config/Snapshot → bảng config_store (key-value JSONB)
 * - Input CN → bảng input_cn + input_cn_nv (normalized)
 * - Output → bảng output_diem + output_chitiet
 *
 * PHÂN QUYỀN:
 * - PhongSwitcher yêu cầu chọn 1 phòng cụ thể → mọi query đều filter theo phong_id.
 *
 * LƯU Ý:
 * - calcMonth() chạy local (calcService.js) rồi lưu kết quả lên Supabase.
 * - phong_id lấy từ localStorage 'phong_id' → fallback về DEFAULT_PHONG_ID trong config.js.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULT_PHONG_ID } from '../config';

const SUPABASE_URL_KEY  = 'supabase_url';
const SUPABASE_KEY_KEY  = 'supabase_anon_key';
const PHONG_ID_KEY      = 'phong_id';

// ── Supabase client (lazy, cached) ───────────────────────────────
let _client = null;
let _clientUrl = null;
let _clientKey = null;

function getClient() {
  const url = (typeof localStorage !== 'undefined' ? localStorage.getItem(SUPABASE_URL_KEY) : null) || SUPABASE_URL;
  const key = (typeof localStorage !== 'undefined' ? localStorage.getItem(SUPABASE_KEY_KEY) : null) || SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!_client || _clientUrl !== url || _clientKey !== key) {
    _client    = createClient(url, key, { auth: { persistSession: true, storageKey: 'sb-kpi-auth' } });
    _clientUrl = url;
    _clientKey = key;
  }
  return _client;
}

// ── Config accessors ──────────────────────────────────────────────
export function getSupabaseUrl()    { return localStorage.getItem(SUPABASE_URL_KEY)  || SUPABASE_URL; }
export function setSupabaseUrl(url) { localStorage.setItem(SUPABASE_URL_KEY, url.trim()); _client = null; }
export function getAnonKey()        { return localStorage.getItem(SUPABASE_KEY_KEY) || SUPABASE_ANON_KEY; }
export function setAnonKey(key)     { localStorage.setItem(SUPABASE_KEY_KEY, key.trim()); _client = null; }
export function getPhongId()        { return localStorage.getItem(PHONG_ID_KEY) || DEFAULT_PHONG_ID || ''; }
export function setPhongId(id)      { localStorage.setItem(PHONG_ID_KEY, id.trim()); }

export function isConnected() {
  return !!(getSupabaseUrl() && getAnonKey());
}

// ── Auth functions (dùng bởi AuthContext) ────────────────────────
export async function authSignIn(email, password) {
  const sb = requireClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function authSignOut() {
  const sb = getClient();
  if (sb) await sb.auth.signOut();
}

export function onAuthStateChange(callback) {
  const sb = getClient();
  if (!sb) return () => {};
  const { data: { subscription } } = sb.auth.onAuthStateChange(callback);
  return () => subscription.unsubscribe();
}

export async function getAuthSession() {
  const sb = getClient();
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

export async function getAppUserProfile(userId) {
  const sb = requireClient();
  const { data } = await sb.from('app_users').select('role,phong_id,display_name').eq('id', userId).single();
  return data;
}

// ── User management (chỉ admin) ───────────────────────────────────
export async function getAppUsers() {
  const sb = requireClient();
  const { data, error } = await sb.from('app_users').select('id,role,phong_id,display_name,created_at');
  chk(error, 'getAppUsers');
  return data || [];
}

export async function updateAppUser(userId, updates) {
  const sb = requireClient();
  const { error } = await sb.from('app_users').update(updates).eq('id', userId);
  chk(error, 'updateAppUser');
}

export async function deleteAppUser(userId) {
  const sb = requireClient();
  const { error } = await sb.from('app_users').delete().eq('id', userId);
  chk(error, 'deleteAppUser');
}

export async function insertAppUser(row) {
  const sb = requireClient();
  const { error } = await sb.from('app_users').insert(row);
  chk(error, 'insertAppUser');
}

// ── Lấy danh sách phòng (cho admin chọn khi tạo user) ────────────
export async function getPhongList() {
  const sb = requireClient();
  const { data, error } = await sb.from('phong').select('id,ten_phong,ma_phong');
  chk(error, 'getPhongList');
  return data || [];
}

// ── Helpers ──────────────────────────────────────────────────────
function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function requireClient() {
  const sb = getClient();
  if (!sb) throw new Error('Chưa cấu hình Supabase URL và Anon Key. Vào ⚙️ Cài đặt để nhập.');
  return sb;
}

function requirePhong() {
  const id = getPhongId();
  if (!id) throw new Error('Chưa cấu hình Phòng ID. Vào ⚙️ Cài đặt → nhập Phòng ID sau khi tạo phòng trên Supabase.');
  return id;
}

function chk(error, ctx) {
  if (error) throw new Error(`[Supabase:${ctx}] ${error.message}`);
}

// Wide-format object → normalized rows cho input_cn table
function wideRowToDb(wideRow, thang, phongId) {
  const kpiIds = new Set();
  for (const key of Object.keys(wideRow)) {
    const m = key.match(/^(.+)_(value|upper|lower|trong_so|max_pct|giam_tru)$/);
    if (m) kpiIds.add(m[1]);
  }
  return [...kpiIds].map(kpiId => ({
    phong_id:    phongId,
    thang,
    nv_id:       wideRow.nv_id,
    kpi_id:      kpiId,
    value_input: toNum(wideRow[`${kpiId}_value`]),
    upper_input: toNum(wideRow[`${kpiId}_upper`]),
    lower_input: toNum(wideRow[`${kpiId}_lower`]),
    trong_so:    toNum(wideRow[`${kpiId}_trong_so`]),
    max_pct:     toNum(wideRow[`${kpiId}_max_pct`]) ?? 100,
    giam_tru:    toNum(wideRow[`${kpiId}_giam_tru`]) ?? 100,
    updated_at:  new Date().toISOString(),
  }));
}

// Normalized rows → wide-format objects (format mà React components đang dùng)
function dbToCNRows(cnRows, nvRows, thang) {
  const nvMap = {};
  for (const nv of nvRows) {
    nvMap[nv.nv_id] = {
      nv_id: nv.nv_id, thang,
      ho_ten: nv.ho_ten ?? '', nhom_cv: nv.nhom_cv ?? '', khu_vuc: nv.khu_vuc ?? '',
    };
  }
  for (const row of cnRows) {
    if (!nvMap[row.nv_id]) nvMap[row.nv_id] = { nv_id: row.nv_id, thang };
    const p = row.kpi_id;
    nvMap[row.nv_id][`${p}_value`]    = row.value_input  ?? '';
    nvMap[row.nv_id][`${p}_upper`]    = row.upper_input  ?? '';
    nvMap[row.nv_id][`${p}_lower`]    = row.lower_input  ?? '';
    nvMap[row.nv_id][`${p}_trong_so`] = row.trong_so     ?? '';
    nvMap[row.nv_id][`${p}_max_pct`]  = row.max_pct      ?? 100;
    nvMap[row.nv_id][`${p}_giam_tru`] = row.giam_tru     ?? 100;
  }
  return Object.values(nvMap);
}

function dbToOutputDiem(row) {
  return {
    thang: row.thang, nv_id: row.nv_id, ho_ten: row.ho_ten,
    nhom_cv: row.nhom_cv, khu_vuc: row.khu_vuc,
    diem_phong_dong_gop: row.diem_phong_dong_gop,
    diem_ca_nhan: row.diem_ca_nhan,
    tong_diem: row.tong_diem, xep_loai: row.xep_loai,
  };
}

function dbToOutputChiTiet(row) {
  return {
    thang: row.thang, nv_id: row.nv_id, kpi_id: row.kpi_id,
    lower: row.lower_val, upper: row.upper_val, value: row.value_val,
    max_pct: row.max_pct, weight_tho: row.weight_tho,
    weight_tuong_doi: row.weight_tuong_doi, giam_tru: row.giam_tru,
    pct_th: row.pct_th, diem_quy_doi: row.diem_quy_doi,
  };
}

// ── getAll ────────────────────────────────────────────────────────
// Tải toàn bộ data khi app khởi động (thư viện + config_store + output_diem)
export async function getAll() {
  const sb      = requireClient();
  const phongId = requirePhong();

  const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
    sb.from('kpi_library').select('kpi_id,ten_kpi,don_vi,kpi_cap,upper_gt_lower,archived_at,cach_tinh').eq('phong_id', phongId).order('kpi_id'),
    sb.from('nhom_library').select('nhom_id,ten_nhom,kpi_cap,archived_at').eq('phong_id', phongId).order('nhom_id'),
    sb.from('nhan_vien').select('nv_id,ho_ten,archived_at').eq('phong_id', phongId).order('nv_id'),
    sb.from('nhom_cv').select('nhom_cv_id,ten_nhom_cv,archived_at').eq('phong_id', phongId).order('nhom_cv_id'),
    sb.from('khu_vuc').select('kv_id,ten_kv,archived_at').eq('phong_id', phongId).order('kv_id'),
    sb.from('config_store').select('key,value').eq('phong_id', phongId),
    sb.from('output_diem').select('thang,nv_id,ho_ten,nhom_cv,khu_vuc,diem_phong_dong_gop,diem_ca_nhan,tong_diem,xep_loai').eq('phong_id', phongId),
  ]);
  chk(r1.error, 'getAll:kpi'); chk(r2.error, 'getAll:nhom');
  chk(r3.error, 'getAll:nv');  chk(r4.error, 'getAll:nhomcv');
  chk(r5.error, 'getAll:kv');  chk(r6.error, 'getAll:store');
  chk(r7.error, 'getAll:outputDiem');

  const store = {};
  (r6.data || []).forEach(row => { store[row.key] = row.value; });

  return {
    kpiLibrary:    r1.data || [],
    nhomLibrary:   r2.data || [],
    nvLibrary:     r3.data || [],
    nhomCvLibrary: r4.data || [],
    kvLibrary:     r5.data || [],
    store,
    outputDiem:    (r7.data || []).map(dbToOutputDiem),
  };
}

// ── Config Store ──────────────────────────────────────────────────
export async function syncStore(key, value) {
  const sb = requireClient(); const phongId = requirePhong();
  if (value === null) {
    const { error } = await sb.from('config_store').delete().eq('phong_id', phongId).eq('key', key);
    chk(error, 'syncStore:delete');
    return { ok: true, key, action: 'deleted' };
  }
  const { error } = await sb.from('config_store')
    .upsert({ phong_id: phongId, key, value, updated_at: new Date().toISOString() }, { onConflict: 'phong_id,key' });
  chk(error, 'syncStore:upsert');
  return { ok: true, key, action: 'upserted' };
}

// ── Library Sync ──────────────────────────────────────────────────
export async function syncKpiLibrary(data) {
  const sb = requireClient(); const phongId = requirePhong();
  const rows = (data || []).map(item => ({
    phong_id: phongId, kpi_id: item.kpi_id, ten_kpi: item.ten_kpi || '',
    don_vi: item.don_vi || '', kpi_cap: item.kpi_cap,
    upper_gt_lower: item.upper_gt_lower !== false,
    archived_at: item.archived_at || null, cach_tinh: item.cach_tinh || '',
  }));
  if (rows.length > 0) {
    const { error } = await sb.from('kpi_library').upsert(rows, { onConflict: 'phong_id,kpi_id' });
    chk(error, 'syncKpiLibrary:upsert');
    const ids = rows.map(r => r.kpi_id);
    await sb.from('kpi_library').delete().eq('phong_id', phongId).not('kpi_id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`);
  } else {
    await sb.from('kpi_library').delete().eq('phong_id', phongId);
  }
  return { ok: true, rows: rows.length };
}

export async function syncNhomLibrary(data) {
  const sb = requireClient(); const phongId = requirePhong();
  const rows = (data || []).map(item => ({
    phong_id: phongId, nhom_id: item.nhom_id, ten_nhom: item.ten_nhom || '',
    kpi_cap: item.kpi_cap, archived_at: item.archived_at || null,
  }));
  if (rows.length > 0) {
    const { error } = await sb.from('nhom_library').upsert(rows, { onConflict: 'phong_id,nhom_id' });
    chk(error, 'syncNhomLibrary:upsert');
    const ids = rows.map(r => r.nhom_id);
    await sb.from('nhom_library').delete().eq('phong_id', phongId).not('nhom_id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`);
  } else {
    await sb.from('nhom_library').delete().eq('phong_id', phongId);
  }
  return { ok: true, rows: rows.length };
}

export async function syncNvLibrary(data) {
  const sb = requireClient(); const phongId = requirePhong();
  const rows = (data || []).map(item => ({
    phong_id: phongId, nv_id: item.nv_id, ho_ten: item.ho_ten || '',
    archived_at: item.archived_at || null,
  }));
  if (rows.length > 0) {
    const { error } = await sb.from('nhan_vien').upsert(rows, { onConflict: 'phong_id,nv_id' });
    chk(error, 'syncNvLibrary:upsert');
    const ids = rows.map(r => r.nv_id);
    await sb.from('nhan_vien').delete().eq('phong_id', phongId).not('nv_id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`);
  } else {
    await sb.from('nhan_vien').delete().eq('phong_id', phongId);
  }
  return { ok: true, rows: rows.length };
}

export async function syncNhomCvLibrary(data) {
  const sb = requireClient(); const phongId = requirePhong();
  const rows = (data || []).map(item => ({
    phong_id: phongId, nhom_cv_id: item.nhom_cv_id, ten_nhom_cv: item.ten_nhom_cv || '',
    archived_at: item.archived_at || null,
  }));
  if (rows.length > 0) {
    const { error } = await sb.from('nhom_cv').upsert(rows, { onConflict: 'phong_id,nhom_cv_id' });
    chk(error, 'syncNhomCvLibrary:upsert');
    const ids = rows.map(r => r.nhom_cv_id);
    await sb.from('nhom_cv').delete().eq('phong_id', phongId).not('nhom_cv_id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`);
  } else {
    await sb.from('nhom_cv').delete().eq('phong_id', phongId);
  }
  return { ok: true, rows: rows.length };
}

export async function syncKvLibrary(data) {
  const sb = requireClient(); const phongId = requirePhong();
  const rows = (data || []).map(item => ({
    phong_id: phongId, kv_id: item.kv_id, ten_kv: item.ten_kv || '',
    archived_at: item.archived_at || null,
  }));
  if (rows.length > 0) {
    const { error } = await sb.from('khu_vuc').upsert(rows, { onConflict: 'phong_id,kv_id' });
    chk(error, 'syncKvLibrary:upsert');
    const ids = rows.map(r => r.kv_id);
    await sb.from('khu_vuc').delete().eq('phong_id', phongId).not('kv_id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`);
  } else {
    await sb.from('khu_vuc').delete().eq('phong_id', phongId);
  }
  return { ok: true, rows: rows.length };
}

// ── Input CN ──────────────────────────────────────────────────────
export async function createMonthTemplate(thang, kpiList, nvList) {
  const sb = requireClient(); const phongId = requirePhong();
  const cnKpis = (kpiList || []).filter(k => k.kpi_cap === 'ca_nhan');
  const nvRows = (nvList || []).map(nv => ({
    phong_id: phongId, thang, nv_id: nv.nv_id,
    ho_ten: nv.ho_ten || '', nhom_cv: nv.nhom_cv || '', khu_vuc: nv.khu_vuc || '',
  }));
  if (nvRows.length > 0) {
    const { error } = await sb.from('input_cn_nv').upsert(nvRows, { onConflict: 'phong_id,thang,nv_id' });
    chk(error, 'createMonthTemplate:nv');
  }
  const cnRows = [];
  for (const nv of nvList || []) {
    for (const kpi of cnKpis) {
      cnRows.push({ phong_id: phongId, thang, nv_id: nv.nv_id, kpi_id: kpi.kpi_id, max_pct: 100, giam_tru: 100 });
    }
  }
  if (cnRows.length > 0) {
    const { error } = await sb.from('input_cn').upsert(cnRows, { onConflict: 'phong_id,thang,nv_id,kpi_id', ignoreDuplicates: true });
    chk(error, 'createMonthTemplate:cn');
  }
  return { ok: true, created: true, sheetName: `input_cn_${thang}`, sheetId: thang };
}

export async function getInputCN(thang) {
  const sb = requireClient(); const phongId = requirePhong();
  const [r1, r2] = await Promise.all([
    sb.from('input_cn').select('*').eq('phong_id', phongId).eq('thang', thang),
    sb.from('input_cn_nv').select('*').eq('phong_id', phongId).eq('thang', thang),
  ]);
  chk(r1.error, 'getInputCN:cn'); chk(r2.error, 'getInputCN:nv');
  return { data: dbToCNRows(r1.data || [], r2.data || [], thang) };
}

export async function syncInputCNRows(thang, rows) {
  const sb = requireClient(); const phongId = requirePhong();
  const rowArray = Array.isArray(rows) ? rows : [rows];
  const nvRows = []; const cnRows = [];
  for (const wideRow of rowArray) {
    if (!wideRow?.nv_id) continue;
    nvRows.push({ phong_id: phongId, thang, nv_id: wideRow.nv_id,
      ho_ten: wideRow.ho_ten ?? '', nhom_cv: wideRow.nhom_cv ?? '', khu_vuc: wideRow.khu_vuc ?? '' });
    cnRows.push(...wideRowToDb(wideRow, thang, phongId));
  }
  await Promise.all([
    nvRows.length > 0 ? sb.from('input_cn_nv').upsert(nvRows, { onConflict: 'phong_id,thang,nv_id' }).then(({ error }) => chk(error, 'syncInputCNRows:nv')) : Promise.resolve(),
    cnRows.length > 0 ? sb.from('input_cn').upsert(cnRows, { onConflict: 'phong_id,thang,nv_id,kpi_id' }).then(({ error }) => chk(error, 'syncInputCNRows:cn')) : Promise.resolve(),
  ]);
  return { ok: true, thang, updated: rowArray.length, total: rowArray.length };
}

export async function syncWeightConfig(thang, nvWeights) {
  const sb = requireClient(); const phongId = requirePhong();
  // Fetch existing max_pct and giam_tru to avoid overwriting user-entered values
  const { data: existing } = await sb
    .from('input_cn')
    .select('nv_id,kpi_id,max_pct,giam_tru')
    .eq('phong_id', phongId)
    .eq('thang', thang);
  const existingMap = {};
  for (const row of (existing || [])) existingMap[`${row.nv_id}:${row.kpi_id}`] = row;
  const rows = [];
  for (const [nvId, weights] of Object.entries(nvWeights || {})) {
    for (const [kpiId, weight] of Object.entries(weights || {})) {
      const ex = existingMap[`${nvId}:${kpiId}`];
      rows.push({ phong_id: phongId, thang, nv_id: nvId, kpi_id: kpiId,
        trong_so: weight, max_pct: ex?.max_pct ?? 100, giam_tru: ex?.giam_tru ?? 100,
        updated_at: new Date().toISOString() });
    }
  }
  if (rows.length > 0) {
    const { error } = await sb.from('input_cn').upsert(rows, { onConflict: 'phong_id,thang,nv_id,kpi_id' });
    chk(error, 'syncWeightConfig');
  }
  return { ok: true, thang, updated: Object.keys(nvWeights || {}).length };
}

export async function updateInputCNKpis(thang, addedKpis, removedKpiIds, _finalKpiList) {
  const sb = requireClient(); const phongId = requirePhong();
  if (removedKpiIds?.length > 0) {
    const { error } = await sb.from('input_cn').delete().eq('phong_id', phongId).eq('thang', thang).in('kpi_id', removedKpiIds);
    chk(error, 'updateInputCNKpis:delete');
  }
  if (addedKpis?.length > 0) {
    const { data: nvData } = await sb.from('input_cn_nv').select('nv_id').eq('phong_id', phongId).eq('thang', thang);
    const nvIds = (nvData || []).map(r => r.nv_id);
    if (nvIds.length > 0) {
      const newRows = [];
      for (const nvId of nvIds) {
        for (const kpi of addedKpis) {
          newRows.push({ phong_id: phongId, thang, nv_id: nvId, kpi_id: kpi.kpi_id, max_pct: 100, giam_tru: 100 });
        }
      }
      const { error } = await sb.from('input_cn').upsert(newRows, { onConflict: 'phong_id,thang,nv_id,kpi_id', ignoreDuplicates: true });
      chk(error, 'updateInputCNKpis:insert');
    }
  }
  return { ok: true, added: (addedKpis || []).length, removed: (removedKpiIds || []).length };
}

export async function updateInputCNNvs(thang, addedNvs, removedNvIds, _orderedNvIds) {
  const sb = requireClient(); const phongId = requirePhong();
  if (removedNvIds?.length > 0) {
    await Promise.all([
      sb.from('input_cn').delete().eq('phong_id', phongId).eq('thang', thang).in('nv_id', removedNvIds).then(({ error }) => chk(error, 'updateInputCNNvs:delCn')),
      sb.from('input_cn_nv').delete().eq('phong_id', phongId).eq('thang', thang).in('nv_id', removedNvIds).then(({ error }) => chk(error, 'updateInputCNNvs:delNv')),
    ]);
  }
  if (addedNvs?.length > 0) {
    const nvRows = addedNvs.map(nv => ({
      phong_id: phongId, thang, nv_id: nv.nv_id,
      ho_ten: nv.ho_ten || '', nhom_cv: nv.nhom_cv || '', khu_vuc: nv.khu_vuc || '',
    }));
    const { data: kpiData } = await sb.from('input_cn').select('kpi_id').eq('phong_id', phongId).eq('thang', thang);
    const kpiIds = [...new Set((kpiData || []).map(r => r.kpi_id))];
    const cnRows = [];
    for (const nv of addedNvs) {
      for (const kpiId of kpiIds) {
        cnRows.push({ phong_id: phongId, thang, nv_id: nv.nv_id, kpi_id: kpiId, max_pct: 100, giam_tru: 100 });
      }
    }
    await Promise.all([
      sb.from('input_cn_nv').upsert(nvRows, { onConflict: 'phong_id,thang,nv_id' }).then(({ error }) => chk(error, 'updateInputCNNvs:addNv')),
      cnRows.length > 0
        ? sb.from('input_cn').upsert(cnRows, { onConflict: 'phong_id,thang,nv_id,kpi_id', ignoreDuplicates: true }).then(({ error }) => chk(error, 'updateInputCNNvs:addCn'))
        : Promise.resolve(),
    ]);
  }
  return { ok: true, added: (addedNvs || []).length, removed: (removedNvIds || []).length };
}

export async function deleteMonthSheet(thang) {
  const sb = requireClient(); const phongId = requirePhong();
  await Promise.all([
    sb.from('input_cn').delete().eq('phong_id', phongId).eq('thang', thang).then(({ error }) => chk(error, 'deleteMonthSheet:cn')),
    sb.from('input_cn_nv').delete().eq('phong_id', phongId).eq('thang', thang).then(({ error }) => chk(error, 'deleteMonthSheet:nv')),
    sb.from('output_diem').delete().eq('phong_id', phongId).eq('thang', thang).then(({ error }) => chk(error, 'deleteMonthSheet:diem')),
    sb.from('output_chitiet').delete().eq('phong_id', phongId).eq('thang', thang).then(({ error }) => chk(error, 'deleteMonthSheet:ct')),
  ]);
  return { ok: true, deleted: true, thang };
}

// ── Input Phong ───────────────────────────────────────────────────
export async function syncInputPhong(row) {
  return syncStore('input_phong_' + row.thang, row);
}

// ── Output ────────────────────────────────────────────────────────
export async function getOutput(thang) {
  const sb = requireClient();
  const { data, error } = await sb.from('output_diem').select('*').eq('thang', thang).eq('phong_id', requirePhong());
  chk(error, 'getOutput');
  return { data: (data || []).map(dbToOutputDiem) };
}

export async function getDetail(thang, nv_id) {
  const sb = requireClient();
  let q = sb.from('output_chitiet').select('*').eq('thang', thang).eq('phong_id', requirePhong());
  if (nv_id) q = q.eq('nv_id', nv_id);
  const { data, error } = await q;
  chk(error, 'getDetail');
  return { data: (data || []).map(dbToOutputChiTiet) };
}

// ── Bundle query: lấy toàn bộ data 1 tháng từ Supabase ───────────
export async function getDiemThang(thang) {
  const sb = requireClient();
  const phongId = requirePhong();
  const storeKeys = [`kpi_snapshot_${thang}`, `nv_snapshot_${thang}`, `trong_so_thang_${thang}`, `input_phong_${thang}`];
  const [r1, r2, r3, r4, r5] = await Promise.all([
    sb.from('input_cn').select('*').eq('phong_id', phongId).eq('thang', thang),
    sb.from('input_cn_nv').select('*').eq('phong_id', phongId).eq('thang', thang),
    sb.from('output_diem').select('*').eq('phong_id', phongId).eq('thang', thang),
    sb.from('output_chitiet').select('*').eq('phong_id', phongId).eq('thang', thang),
    sb.from('config_store').select('key,value').eq('phong_id', phongId).in('key', storeKeys),
  ]);
  chk(r1.error, 'getDiemThang:cn'); chk(r2.error, 'getDiemThang:nv');
  chk(r3.error, 'getDiemThang:diem'); chk(r4.error, 'getDiemThang:ct');
  const store = {};
  (r5.data || []).forEach(row => { store[row.key] = row.value; });
  return {
    inputCN:       dbToCNRows(r1.data || [], r2.data || [], thang),
    outputDiem:    (r3.data || []).map(dbToOutputDiem),
    outputChiTiet: (r4.data || []).map(dbToOutputChiTiet),
    kpiSnapshot:   store[`kpi_snapshot_${thang}`]   || null,
    nvSnapshot:    store[`nv_snapshot_${thang}`]    || null,
    trongSoThang:  store[`trong_so_thang_${thang}`] || null,
    inputPhong:    store[`input_phong_${thang}`]    || null,
  };
}

// ── Tính điểm KPI ─────────────────────────────────────────────────
// Chạy local (calcService) rồi lưu kết quả lên Supabase
export async function calcMonth(thang) {
  const sb = requireClient(); const phongId = requirePhong();

  // Chạy tính điểm local (dùng data đã có trong localStorage)
  const { calcMonth: localCalc } = await import('./calcService');
  const result = localCalc(thang);

  // Lưu kết quả lên Supabase
  const { getOutputDiem, getOutputCT } = await import('./store');
  const allDiem = getOutputDiem().filter(r => r.thang === thang);
  const allCT   = getOutputCT().filter(r => r.thang === thang);

  const diemRows = allDiem.map(r => ({
    phong_id: phongId, thang: r.thang, nv_id: r.nv_id,
    ho_ten: r.ho_ten, nhom_cv: r.nhom_cv, khu_vuc: r.khu_vuc,
    diem_phong_dong_gop: r.diem_phong_dong_gop, diem_ca_nhan: r.diem_ca_nhan,
    tong_diem: r.tong_diem, xep_loai: r.xep_loai, updated_at: new Date().toISOString(),
  }));
  const ctRows = allCT.map(r => ({
    phong_id: phongId, thang: r.thang, nv_id: r.nv_id, kpi_id: r.kpi_id,
    lower_val: r.lower, upper_val: r.upper, value_val: r.value,
    max_pct: r.max_pct, weight_tho: r.weight_tho, weight_tuong_doi: r.weight_tuong_doi,
    giam_tru: r.giam_tru, pct_th: r.pct_th, diem_quy_doi: r.diem_quy_doi,
  }));

  await Promise.all([
    diemRows.length > 0 ? sb.from('output_diem').upsert(diemRows, { onConflict: 'phong_id,thang,nv_id' }).then(({ error }) => chk(error, 'calcMonth:diem')) : Promise.resolve(),
    ctRows.length > 0   ? sb.from('output_chitiet').upsert(ctRows, { onConflict: 'phong_id,thang,nv_id,kpi_id' }).then(({ error }) => chk(error, 'calcMonth:ct')) : Promise.resolve(),
  ]);

  return { ok: result.success, thang, so_nv: result.so_nv, diem_phong: result.diem_phong, ket_qua: allDiem };
}

// Ghi đè output_diem trên Supabase cho các NV "thiếu dữ liệu" (tong_diem=null)
// Cần gọi sau calcMonth để đảm bảo Supabase không còn dữ liệu cũ của các NV chưa đủ điều kiện
export async function upsertOutputDiem(rows) {
  if (!rows || rows.length === 0) return;
  const sb = requireClient(); const phongId = requirePhong();
  const diemRows = rows.map(r => ({
    phong_id: phongId, thang: r.thang, nv_id: r.nv_id,
    ho_ten: r.ho_ten || null, nhom_cv: r.nhom_cv || null, khu_vuc: r.khu_vuc || null,
    diem_phong_dong_gop: r.diem_phong_dong_gop ?? null,
    diem_ca_nhan: r.diem_ca_nhan ?? null,
    tong_diem: r.tong_diem ?? null,
    xep_loai: r.xep_loai ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await sb.from('output_diem').upsert(diemRows, { onConflict: 'phong_id,thang,nv_id' });
  chk(error, 'upsertOutputDiem');
}

// ── Danh sách tháng ───────────────────────────────────────────────
export async function getThangList() {
  const sb = requireClient();
  const phongId = requirePhong();
  const [r1, r2] = await Promise.all([
    sb.from('output_diem').select('thang').eq('phong_id', phongId),
    sb.from('config_store').select('key').eq('phong_id', phongId).like('key', 'input_phong_%'),
  ]);
  const set = new Set();
  (r1.data || []).forEach(r => { if (r.thang) set.add(r.thang); });
  (r2.data || []).forEach(r => set.add(r.key.replace('input_phong_', '')));
  return { data: [...set].filter(Boolean).sort().reverse() };
}

// ── Ping ──────────────────────────────────────────────────────────
export async function ping() {
  const sb = requireClient();
  const { error } = await sb.from('phong').select('id').limit(1);
  if (error) throw new Error(error.message);
  return { ok: true, time: new Date().toISOString() };
}
