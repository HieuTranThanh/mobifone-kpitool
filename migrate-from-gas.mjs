/**
 * migrate-from-gas.mjs
 * Chạy 1 lần để chuyển toàn bộ dữ liệu từ Google Sheets (GAS) sang Supabase.
 *
 * Cách chạy:
 *   cd kpi-tool
 *   node migrate-from-gas.mjs
 *
 * Yêu cầu: @supabase/supabase-js đã được cài (npm install @supabase/supabase-js)
 */

import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════════════════
//  CẤU HÌNH — điền vào trước khi chạy
// ═══════════════════════════════════════════════════════════════════

const GAS_URL      = 'https://script.google.com/macros/s/AKfycbxHSV-EF-PoKoxhCwj1ZrSz5Oe844A9q1y5Nuss7TjU3WlojLHchK4Hmwdi0Lv6P8QZ/exec';      // VD: https://script.google.com/macros/s/xxx/exec
const SUPABASE_URL = 'https://tvmdjzmipkvrunawuaba.supabase.co';  // VD: https://abcxyz.supabase.co
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2bWRqem1pcGt2cnVuYXd1YWJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2Mzc5NzcsImV4cCI6MjA5NDIxMzk3N30.T55k7djxIIbR1N2Or_FJH89qhNCPWq_bwHPZKCn3djc';      // eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
const PHONG_ID     = '5c97af34-4b0d-4607-b5c5-a2c6888d46ae';    // UUID từ bảng phong trong Supabase

// ═══════════════════════════════════════════════════════════════════

// Kiểm tra cấu hình
if ([GAS_URL, SUPABASE_URL, SUPABASE_KEY, PHONG_ID].some(v => v.startsWith('PASTE_'))) {
  console.error('❌ Bạn chưa điền đủ cấu hình vào đầu file migrate-from-gas.mjs!');
  console.error('   Mở file và thay thế 4 giá trị PASTE_xxx_HERE');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── Helpers ──────────────────────────────────────────────────────────

function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

async function gasGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${GAS_URL}?${qs}`);
  if (!res.ok) throw new Error(`GAS HTTP ${res.status} cho action=${action}`);
  const json = await res.json();
  if (json.error) throw new Error(`GAS error (${action}): ${json.error}`);
  return json;
}

async function upsert(table, rows, conflict) {
  if (!rows.length) {
    console.log(`  — ${table}: 0 rows (bỏ qua)`);
    return;
  }
  const { error } = await sb.from(table).upsert(rows, { onConflict: conflict });
  if (error) throw new Error(`[${table}] ${error.message}`);
  console.log(`  ✓ ${table}: ${rows.length} rows`);
}

// Wide-format row từ INPUT_CN sheet → normalized rows cho input_cn table
// GAS trả về {nv_id, ho_ten, nhom_cv, khu_vuc, thang, KPI_CN001_value, KPI_CN001_upper, ...}
function wideRowToDb(wideRow, thang) {
  const kpiIds = new Set();
  for (const key of Object.keys(wideRow)) {
    const m = key.match(/^(.+)_(value|upper|lower|trong_so|max_pct|giam_tru)$/);
    if (m) kpiIds.add(m[1]);
  }
  return [...kpiIds].map(kpiId => ({
    phong_id:    PHONG_ID,
    thang,
    nv_id:       String(wideRow.nv_id),
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

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  MIGRATE: Google Sheets → Supabase PostgreSQL');
  console.log('═══════════════════════════════════════════════\n');

  // ── Bước 1: Tải toàn bộ thư viện từ GAS ─────────────────────────
  console.log('🔄 Bước 1: Tải thư viện từ GAS...');
  const all = await gasGet('getAll');
  const {
    kpiLibrary    = [],
    nhomLibrary   = [],
    nvLibrary     = [],
    nhomCvLibrary = [],
    kvLibrary     = [],
    store         = {},
  } = all;
  console.log(`   KPI: ${kpiLibrary.length}, Nhóm: ${nhomLibrary.length}, NV: ${nvLibrary.length}, NhomCV: ${nhomCvLibrary.length}, KhuVuc: ${kvLibrary.length}, Store keys: ${Object.keys(store).length}`);

  // ── Bước 2: Migrate thư viện lên Supabase ────────────────────────
  console.log('\n🔄 Bước 2: Migrate thư viện...');

  // kpi_library — GAS headers: kpi_id, ten_kpi, don_vi, kpi_cap, upper_gt_lower, archived_at, cach_tinh
  await upsert('kpi_library', kpiLibrary.map(k => ({
    phong_id:      PHONG_ID,
    kpi_id:        k.kpi_id,
    ten_kpi:       k.ten_kpi        || '',
    don_vi:        k.don_vi         || '',
    kpi_cap:       k.kpi_cap        || 'ca_nhan',
    upper_gt_lower: k.upper_gt_lower === false || k.upper_gt_lower === 'FALSE' ? false : true,
    archived_at:   k.archived_at    || null,
    cach_tinh:     k.cach_tinh      || '',
  })), 'phong_id,kpi_id');

  // nhom_library — GAS headers: nhom_id, ten_nhom, kpi_cap, archived_at
  await upsert('nhom_library', nhomLibrary.map(n => ({
    phong_id:   PHONG_ID,
    nhom_id:    n.nhom_id,
    ten_nhom:   n.ten_nhom   || '',
    kpi_cap:    n.kpi_cap    || 'ca_nhan',
    archived_at: n.archived_at || null,
  })), 'phong_id,nhom_id');

  // nhan_vien — GAS headers: nv_id, ho_ten, trang_thai, archived_at
  await upsert('nhan_vien', nvLibrary.map(n => ({
    phong_id:   PHONG_ID,
    nv_id:      n.nv_id,
    ho_ten:     n.ho_ten    || '',
    archived_at: n.archived_at || null,
  })), 'phong_id,nv_id');

  // nhom_cv — GAS headers: nhom_cv_id, ten_nhom_cv, archived_at
  await upsert('nhom_cv', nhomCvLibrary.map(n => ({
    phong_id:    PHONG_ID,
    nhom_cv_id:  n.nhom_cv_id,
    ten_nhom_cv: n.ten_nhom_cv || '',
    archived_at: n.archived_at  || null,
  })), 'phong_id,nhom_cv_id');

  // khu_vuc — GAS headers: kv_id, ten_kv, archived_at
  await upsert('khu_vuc', kvLibrary.map(k => ({
    phong_id:   PHONG_ID,
    kv_id:      k.kv_id,
    ten_kv:     k.ten_kv || k.ten_khu_vuc || '',  // fallback nếu field name khác
    archived_at: k.archived_at || null,
  })), 'phong_id,kv_id');

  // ── Bước 3: Migrate CONFIG_Store ─────────────────────────────────
  console.log('\n🔄 Bước 3: Migrate CONFIG_Store...');
  const storeRows = Object.entries(store).map(([key, value]) => ({
    phong_id:   PHONG_ID,
    key,
    value,
    updated_at: new Date().toISOString(),
  }));
  await upsert('config_store', storeRows, 'phong_id,key');

  // ── Bước 4: Migrate dữ liệu hàng tháng ──────────────────────────
  console.log('\n🔄 Bước 4: Migrate dữ liệu hàng tháng...');
  let thangList = [];
  try {
    const tl = await gasGet('getThangList');
    thangList = (tl.data || []);
    if (!thangList.length) {
      console.log('   Không tìm thấy tháng nào có dữ liệu. Bỏ qua bước 4.');
    } else {
      console.log(`   Tìm thấy ${thangList.length} tháng: ${thangList.join(', ')}`);
    }
  } catch (e) {
    console.log(`   ⚠ Không lấy được danh sách tháng: ${e.message}`);
  }

  for (const thang of thangList) {
    console.log(`\n   📅 Tháng ${thang}...`);

    // Thử getDiemThang (bundle) trước; fallback sang 3 calls riêng nếu GAS chưa deploy mới
    let inputCN = [], outputDiem = [], outputChiTiet = [];
    try {
      const monthData = await gasGet('getDiemThang', { thang });
      inputCN       = monthData.inputCN       || [];
      outputDiem    = monthData.outputDiem    || [];
      outputChiTiet = monthData.outputChiTiet || [];
    } catch (e) {
      if (!e.message.includes('Unknown action')) {
        console.log(`      ⚠ Lỗi lấy dữ liệu tháng ${thang}: ${e.message}`);
        continue;
      }
      // GAS chưa có getDiemThang — dùng 3 calls riêng
      console.log(`      (GAS cũ, dùng getInputCN + getOutput + getDetail)`);
      try {
        const [r1, r2, r3] = await Promise.all([
          gasGet('getInputCN', { thang }),
          gasGet('getOutput',  { thang }),
          gasGet('getDetail',  { thang }),
        ]);
        inputCN       = r1.data || [];
        outputDiem    = r2.data || [];
        outputChiTiet = r3.data || [];
      } catch (e2) {
        console.log(`      ⚠ Lỗi lấy dữ liệu tháng ${thang}: ${e2.message}`);
        continue;
      }
    }

    // input_cn_nv + input_cn (wide → normalized)
    // GAS trả về: {nv_id, ho_ten, nhom_cv, khu_vuc, thang, KPI_xxx_value, ...}
    if (inputCN.length) {
      const nvRows = inputCN
        .filter(r => r.nv_id)
        .map(r => ({
          phong_id: PHONG_ID,
          thang,
          nv_id:    String(r.nv_id),
          ho_ten:   r.ho_ten   || '',
          nhom_cv:  r.nhom_cv  || '',
          khu_vuc:  r.khu_vuc  || '',
        }));
      await upsert('input_cn_nv', nvRows, 'phong_id,thang,nv_id');

      const cnRows = inputCN
        .filter(r => r.nv_id)
        .flatMap(r => wideRowToDb(r, thang))
        .filter(r => r.kpi_id);
      await upsert('input_cn', cnRows, 'phong_id,thang,nv_id,kpi_id');
    } else {
      console.log(`      — input_cn: 0 rows`);
    }

    // output_diem
    // GAS OUTPUT_DiemTong headers: thang, nv_id, ho_ten, nhom_cv, khu_vuc,
    //   diem_phong_dong_gop, diem_ca_nhan, tong_diem, xep_loai
    if (outputDiem.length) {
      await upsert('output_diem', outputDiem.map(r => ({
        phong_id:           PHONG_ID,
        thang:              thang,
        nv_id:              String(r.nv_id),
        ho_ten:             r.ho_ten    || '',
        nhom_cv:            r.nhom_cv   || '',
        khu_vuc:            r.khu_vuc   || '',
        diem_phong_dong_gop: toNum(r.diem_phong_dong_gop),
        diem_ca_nhan:       toNum(r.diem_ca_nhan),
        tong_diem:          toNum(r.tong_diem),
        xep_loai:           r.xep_loai  || '',
        updated_at:         new Date().toISOString(),
      })), 'phong_id,thang,nv_id');
    } else {
      console.log(`      — output_diem: 0 rows`);
    }

    // output_chitiet
    // GAS OUTPUT_ChiTiet headers: thang, nv_id, kpi_id, lower, upper, value,
    //   max_pct, weight_tho, weight_tuong_doi, giam_tru, pct_th, diem_quy_doi
    // Supabase dùng lower_val, upper_val, value_val (thêm _val để tránh reserved word)
    if (outputChiTiet.length) {
      await upsert('output_chitiet', outputChiTiet.map(r => ({
        phong_id:        PHONG_ID,
        thang:           thang,
        nv_id:           String(r.nv_id),
        kpi_id:          r.kpi_id,
        lower_val:       toNum(r.lower),
        upper_val:       toNum(r.upper),
        value_val:       toNum(r.value),
        max_pct:         toNum(r.max_pct),
        weight_tho:      toNum(r.weight_tho),
        weight_tuong_doi: toNum(r.weight_tuong_doi),
        giam_tru:        toNum(r.giam_tru),
        pct_th:          toNum(r.pct_th),
        diem_quy_doi:    toNum(r.diem_quy_doi),
      })), 'phong_id,thang,nv_id,kpi_id');
    } else {
      console.log(`      — output_chitiet: 0 rows`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ MIGRATION HOÀN TẤT!');
  console.log('═══════════════════════════════════════════════');
  console.log('Bước tiếp theo:');
  console.log('  1. Cập nhật src/config.js với SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULT_PHONG_ID');
  console.log('  2. npm run build && push lên GitHub');
  console.log('  3. Vào app, kiểm tra dữ liệu đã hiển thị đúng');
}

main().catch(err => {
  console.error('\n❌ Lỗi migration:', err.message);
  process.exit(1);
});
