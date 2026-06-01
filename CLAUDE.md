# KPI Tool — Architecture Guide

## Tech stack
- React 19 + Vite 8 + Tailwind CSS v3; router: `<BrowserRouter>` (react-router-dom v7)
- **Supabase PostgreSQL** = nguồn sự thật duy nhất; localStorage = cache only (xóa không mất data)
- `src/config.js` — SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULT_PHONG_ID (hardcoded)
- `src/services/supabaseService.js` — Supabase ops + auth functions
- `src/services/store.js` — localStorage R/W + local computation
- `src/services/calcService.js` — local KPI scoring (no server)
- `gas/Code.js` — deprecated, reference only

## Kiến trúc nguyên tắc
- Mọi thao tác ghi → sync Supabase ngay (fire-and-forget)
- App mount → `getAll()` pull về localStorage → `setRefreshKey` → Outlet re-mount
- `calcMonth` chạy local → lưu output lên Supabase
- Snapshot/template chỉ lưu ID refs; detail tra từ library khi render
- **KHÔNG** filter NV theo `active`/`archived_at` trong tính điểm/nhập liệu/trọng số

## Nguyên tắc "Đủ dữ liệu" — cực kỳ quan trọng, KHÔNG được thay đổi

**Khi chưa đủ dữ liệu thì điểm KPI chưa có.** Bấm "Tính KPI" chỉ là lưu + tính điểm; nếu thiếu dữ liệu thì NV đó không được điểm — kết quả là `xep_loai = null`.

### Định nghĩa — nguồn duy nhất: `store.js`

**KHÔNG tự định nghĩa lại logic đủ/thiếu trong component.** Tất cả dùng hàm từ `store.js`:

```js
import { computePhongInputStatus, getInputPhongStatus, getInputCNStatus } from '../services/store';
```

| Hàm | Dùng ở đâu |
|---|---|
| `computePhongInputStatus(inp, kpiPhong)` | NhapLieuPhong (với `form` state chưa lưu) |
| `getInputPhongStatus(thang)` | Dashboard, BaoCaoPhongTab (từ localStorage) |
| `getInputCNStatus(thang, nv_id)` | NhapLieuKPI, Dashboard, BaoCaoCaNhanTab, handleCalc |

### Điều kiện "đủ dữ liệu"

**KPI Phòng đủ** = `diem_kpi_chinhanh_kq` + 5 cột per KPI: `_value`, `_upper`, `_lower`, `_trong_so`, `_max_pct`  
**KPI Cá nhân đủ** = 6 cột per KPI (`_value`, `_upper`, `_lower`, `_trong_so`, `_max_pct`, `_giam_tru`) **VÀ KPI Phòng phải đủ**

→ Nếu KPI Phòng chưa đủ → tất cả NV cá nhân đều "thiếu dữ liệu" kể cả khi đã nhập đủ 6 cột

### 3 trạng thái badge
- `empty` = chưa có bất kỳ thông tin nào
- `partial` = có một phần nhưng thiếu ít nhất 1 điều kiện
- `full` = đủ tất cả điều kiện

Badge CSS:
```jsx
<span className={{ empty:'badge bg-gray-100 text-gray-400', partial:'badge bg-yellow-100 text-yellow-700', full:'badge bg-green-100 text-green-700' }[status]}>
  {{ empty:'Chưa nhập', partial:'Thiếu dữ liệu', full:'✓ Đủ dữ liệu' }[status]}
</span>
```

### handleCalc — KHÔNG tự check required fields
```js
// ĐÚNG: dùng getInputCNStatus
const nvWithData = nvList.filter(nv => getInputCNStatus(thang, nv.nv_id) === 'full');
// SAI: tự build requiredSufs, FULL_SUFS, v.v.
```

Sau `calcGAS`, override — loại NV "thiếu" (theo frontend) khỏi danh sách đã tính dù server tính được:
```js
const incompleteIds = new Set(localUnscoredRows.map(r => r.nv_id));
const scoredRows    = (result.ket_qua || []).filter(r => !incompleteIds.has(r.nv_id));
```

---

## Auth & RBAC

### app_users schema (Supabase public)
```sql
CREATE TABLE app_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phong_id UUID,
  role TEXT CHECK (role IN ('admin','department_editor','company_viewer','department_viewer')),
  display_name TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4 Roles + Permission matrix
| Menu | admin | dept_editor | company_viewer | dept_viewer |
|---|:---:|:---:|:---:|:---:|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Danh sách NV / Quản lý KPI / Trọng số / Nhập liệu | ✅ | ✅ | ❌ | ❌ |
| Báo cáo KPI | ✅ | ✅ | ✅ | ✅ |
| Cấu hình xếp loại | ✅ | ❌ | ❌ | ❌ |
| Settings / user mgmt | ✅ | ❌ | ❌ | ❌ |

### Guard pattern
```jsx
import { useAuth, canEditDept } from '../contexts/AuthContext';
import { AccessDenied } from './Layout';
const { user } = useAuth();
if (!canEditDept(user)) return <AccessDenied />;
```
Helpers export từ `AuthContext.jsx`: `canAdmin(u)`, `canViewAll(u)`, `canEditDept(u)`, `ROLE_LABELS`
- `ROLE_LABELS` = single source of truth cho nhãn role; `ROLE_OPTIONS` phải derive từ `ROLE_LABELS`
- `refreshUser()`: re-fetch profile sau khi admin tự edit mình
- role null/undefined: warning vàng + chỉ Dashboard + nút Cài đặt

### PhongSwitcher
- admin/company_viewer: PhongSwitcher ở sidebar header; default chưa chọn → "🏢 Chọn phòng"
- department users: không thấy PhongSwitcher; tên phòng = `phongList.find(p=>p.id===user.phong_id)?.ten_phong`
- `phongList` fetch tại Layout level, truyền xuống qua prop; không có "Tất cả phòng"

### Cache isolation khi switch phòng (`loadData()` trong Layout.jsx)
Xóa prefix: `kpi_snapshot_`, `nv_snapshot_`, `trong_so_thang_`, `input_phong_`, `locked_cn_`, `locked_phong_`, `trong_so_weights_`, `output_meta_`  
Xóa exact: `kpi_library nhom_library nv_library nhom_cv_library kv_library kpi_list nhom_list nhom_cv_list khu_vuc_list trong_so xep_loai_config output_diem output_chitiet input_cn`  
Giữ lại: `supabase_url supabase_anon_key phong_id sb-kpi-auth`

---

## Supabase

### Tables
- Libraries (filter phong_id): `kpi_library`, `nhom_library`, `nhan_vien`, `nhom_cv`, `khu_vuc`
- `config_store` — key-value per phong_id (snapshots, configs, weights)
- Input: `input_cn`, `input_cn_nv` | Output: `output_diem`, `output_chitiet`
- Auth: `app_users`, `phong`

### Key functions (supabaseService.js)
| Hàm | Mô tả |
|---|---|
| `getAll()` | Fetch libraries + config_store → localStorage |
| `getDiemThang(thang)` | Bundle inputCN + outputDiem + snapshots |
| `calcMonth(thang)` | Tính điểm local → upsert output_diem + output_chitiet |
| `syncToGas(key,val)` / `deleteFromGas(key)` | Upsert/xóa config_store |
| `syncWeightConfig(thang,weights)` | Sync auto weights lên input_cn_nv |
| `bulkSyncStore(entries)` | Upsert nhiều keys (import backup) |
| `getPhongList()` | Danh sách phòng |

### RLS setup — bắt buộc khi Supabase mới
```sql
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role = 'admin');
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
DROP POLICY IF EXISTS "read_self" ON app_users;
DROP POLICY IF EXISTS "admin_manage" ON app_users;
CREATE POLICY "read_self"    ON app_users FOR SELECT USING (id = auth.uid());
CREATE POLICY "admin_manage" ON app_users FOR ALL USING (is_admin()) WITH CHECK (is_admin());
-- INSERT admin đầu tiên (bypass RLS):
INSERT INTO app_users (id, role, display_name, phong_id)
VALUES ('<UUID từ Auth>', 'admin', 'Tên Admin', NULL)
ON CONFLICT (id) DO UPDATE SET role = 'admin';
```

---

## Data structures

### ID format
- `kpi_id`: `KPI_CN_000001`–`KPI_CN_999999` / `KPI_PH_000001`–`KPI_PH_999999`
- `nhom_id`: `NhomKPI_CN_000001`... / `NhomKPI_PH_000001`...
- `nv_id`: `NhanVien_000001`–`NhanVien_999999`
- `nhom_cv_id`: `NhomCV_CN_000001`... | `kv_id`: `KVQL_VN_000001`...

### Library fields quan trọng
- `kpi_library`: `upper_gt_lower` (true=cao tốt), `archived_at` (null=active), `cach_tinh`; **`max_pct` không lưu** — là param per-month trong input_cn
- `nhom_library`: không có `thu_tu` — `thu_tu` (I,II,III) là per-template/month
- `nhan_vien`: `nhom_cv`/`khu_vuc` không lưu trong library — là per-month trong `nv_snapshot_YYYY-MM`

### Snapshots
```js
// NV snapshot
{ thang, nvRefs:[{nv_id,nhom_cv,khu_vuc,stt}], nhomCvList:[...], khuVucList:[...] }
// KPI snapshot
{ thang, kpiRefs:[{kpi_id,nhom_id,stt}], nhomRefs:[{nhom_id,thu_tu,kpi_cap}] }
// KPI template ref
{ kpi_id:'KPI_CN_000001', nhom_id:'NhomKPI_CN_000001', stt:1 }
```

### localStorage keys
| Key | Nội dung |
|---|---|
| `kpi_library`, `nhom_library`, `nv_library`, `nhom_cv_library`, `kv_library` | Libraries |
| `kpi_list`, `nhom_list`, `nhom_cv_list`, `khu_vuc_list`, `trong_so`, `xep_loai_config` | Config |
| `kpi_snapshot_YYYY-MM`, `nv_snapshot_YYYY-MM` | KPI/NV per-month |
| `trong_so_thang_YYYY-MM` | Config trọng số (`mode:'manual'/'auto'`) |
| `trong_so_weights_YYYY-MM` | Weights auto mode |
| `input_phong_YYYY-MM` | KPI phòng per-month |
| `locked_cn_YYYY`, `locked_phong_YYYY` | `{"YYYY-MM":true}` — tháng đã chốt |
| `output_diem`, `output_chitiet`, `input_cn` | Cache — xóa khi switch phòng |
| `supabase_url`, `supabase_anon_key`, `phong_id`, `sb-kpi-auth` | System — giữ lại |
| `nv_list` | legacy — auto-migrated bởi `getNvLibrary()` |

---

## Logic tính điểm
- `kpiScore(value, lower, upper, maxPct, weight, giamTru)` — port từ LAMBDA Excel
- `tongDiem = diemPhong × phongRatio + diemCaNhan`
- Xếp loại: A+ ≥105 (Xuất sắc) | A ≥101 (Vượt) | B ≥100 (Đạt) | C ≥95 (Đạt một phần) | D <95
- Xếp hạng: standard competition ranking (1,1,1,4,5...) — không dùng sequential (1,2,3)

---

## Modules

### WeightManagement.jsx — Quản lý trọng số
**Edit mode:**
- Default: read-only; "✏️ Chỉnh sửa" phía trên Bước 1 → alert cảnh báo → vào `editMode`
- editMode: auto-save localStorage debounced 800ms (KHÔNG sync Supabase)
- "💾 Lưu & Sync" → validate → `saveTrongSoConfig` + `syncWeightConfig` → thoát editMode
- `beforeunload` handler cảnh báo đóng tab/refresh khi có unsaved changes
- In-app navigation guard: `setNavGuard(msg)` khi `editMode && isDirty`, `clearNavGuard()` khi save/cancel; Layout.jsx intercept tất cả NavLink clicks và `toggleMenu` — ⚠️ `useBlocker` không dùng được với `<BrowserRouter>`
- `readOnly` prop truyền xuống: TyLeCap, ModeSelector, NhomKpiPanel, CvConfigPanel
- `copyFromMonth`: auto-enter editMode sau copy

**Validation (auto mode):** Chỉ báo lỗi khi KPI chưa được add vào bất kỳ nhóm nào. KPI đã add nhưng priority=null (0đ) là **hợp lệ** — nghĩa là "Không tính".

**Dual mode:**
- Manual: `_trong_so` từ input_cn
- Auto: Bước 3–4 config; khi lưu: `syncWeightConfig` + `syncToGas('trong_so_weights_YYYY-MM')`
- Chuyển auto→manual: `deleteFromGas('trong_so_weights_YYYY-MM')`

**Thuật toán Constrained Linear Allocation:**
```
avg=total/N; b=max(0,min(2*(wMax-avg)/(N-1), 2*(avg-wMin)/(N-1)))
w_i = (avg - b*(N-1)/2) + b*(N-1-i)   // i=0 = ưu tiên 1 (cao nhất)
```
`normalizeWeightsToInt(weights, target)`: largest-remainder, tổng = target chính xác.

### KPIManagement.jsx
- Tab 1 Thư viện: sub-tab KPI Cá nhân / KPI Phòng; `+T` chỉ hiện khi `!inTemplate && !archived`
- Tab 2 Template: edit nhóm chỉ cho sửa STT (`thu_tu`), **không sửa tên nhóm** (quản lý ở Thư viện)
- Tab 3 KPI theo tháng (`TheoThang`): phải có NV snapshot trước; `recompactNhom` renumber I,II,III... sau xóa; navigation guard qua `setNavGuard` khi `editMode`
- Modal multi-select: Phase 1 = checkbox+search; Phase 2 = gán STT/nhóm; `onAdd` nhận mảng

### DanhSachNV.jsx
- Sub-tab A Thư viện NV: CRUD nhan_vien; `syncNvLibrary()` sau mọi thao tác
- Sub-tab B NV theo tháng: snapshot mỗi tháng độc lập; sao chép giữ nhomCvList + khuVucList
- NhomCV/KhuVuc update tên: dùng `renameNhomCv`/`renameKv` để cascade sang NV snapshots

### KpiInputModule.jsx — Nhập liệu KPI
- NV list: `getNvListForThang(thang)` — không filter active/archived
- `InputCaNhanModal`: 6 fields per KPI (lower, upper, value, trong_so, max_pct, giam_tru)
- `_trong_so`: read-only khi `mode === 'auto'`; `_max_pct` default = 100
- Status badge cá nhân: dùng `FULL_SUFS` = **6 fields** (manual: value/upper/lower/trong_so/max_pct/giam_tru) hoặc **3 fields** (auto: value/upper/lower) — xem mục "Đủ dữ liệu"
- Status badge phòng (`phongInputStatus` useMemo): kiểm tra `diem_kpi_chinhanh_kq` + 4 fields per KPI từ `form` state

### Dashboard.jsx
- Month picker: `getThangList()` (tháng có output_diem/input_phong) — **không** `getSnapshotThangList()`
- Badge chốt KPI cạnh tiêu đề section: `isInputPhongLocked` / `isInputCNLocked`
- `diem_kpi_chinhanh_kq` = điểm gốc hiển thị; `diem_kpi_chinhanh` = đã nhân trọng số
- **Section "Tiến độ nhập liệu"** (Feature A): 4 thẻ trạng thái — NV nhập liệu KPI (chi tiết: X đã tính/nhập đủ/thiếu/chưa nhập), KPI Phòng, Chốt CN, Chốt Phòng. `progress` useMemo derive từ `rankedRows` để lấy `ly_do` sẵn có.
- **Section "Biểu đồ điểm KPI"** (Feature B): CSS bar chart ngang, màu theo xếp loại (`BAR_COLOR` map), scale max=115đ.
- **Ghi chú tháng** (Feature E): admin ghi chú per-tháng, lưu key `month_note_YYYY-MM` trong config_store via `saveMonthNote`. Dùng `<textarea>` (3 rows, maxLength=500); Ctrl+Enter để lưu, Esc để hủy. Display dùng `whitespace-pre-wrap`. Người dùng thường chỉ xem, admin thấy nút ✏️.

### KpiReport.jsx
- `exportAllToExcel(thang)`: sheet order = KPI Phòng → Tổng hợp NV → [Tên NV] × n
- Sheet "Tổng hợp NV": nguồn = `nvList` (sort nv_id A-Z), join outputDiem; cột Chi tiết = hyperlink `#'TênNV'!A1`
- `nvSheetNameMap` pre-compute tên sheet để hyperlink khớp chính xác
- `exportNvAllMonthsToExcel(nvId, hoTen, xepLoaiCfg, filteredThangList)`: xuất toàn bộ KPI 1 NV theo năm; fetch Supabase async nếu thiếu data trước khi export; sheet "Tổng hợp KPI" + sheet/tháng
- `exportPhongAllMonthsToExcel(filteredThangList)`: xuất toàn bộ KPI Phòng theo năm; dùng `computePhongData()` + localStorage (không fetch async); sheet "Tổng hợp KPI Phòng" + sheet/tháng; chỉ export tháng có `inp` không rỗng
- `BaoCaoPhongTab`: có `exportYear` state + nút "📥 Xuất toàn bộ KPI Phòng năm đã chọn" (căn phải đầu tab); badge `phongStatus` (empty/partial/full) đầu toolbar; `BaoCaoCaNhanTab` tab Chi tiết: tương tự + badge `nvInputStatus` cạnh NV selector
- **`exportAllNvAllMonthsToExcel(year, filteredThangList)`** (Feature D): bảng chéo tháng × NV; nguồn = `getOutputDiemByThang` (localStorage); nút "📊 Xuất tổng hợp tất cả NV" trong toolbar BaoCaoCaNhanTab
  - Sheet 1 "Điểm NV {year}": plain alternating rows (F8FAFC/FFFFFF), **không tô màu xếp loại**; ô `tong_diem = 0` hoặc không có điểm → để trống
  - Sheet 2 "Xếp loại {year}": tô màu nhạt theo xếp loại (palette `XL_FILL_LOAI`); ô không có xếp loại hoặc điểm = 0 → để trống
  - Cột NV: `wch: 18` (Sheet 1) / `wch: 12` (Sheet 2); header row `hpt: 40` + `wrapText: true`
  - Frozen: `xSplit: 2, ySplit: 2` (giữ cột STT + Tháng)

#### Màu xếp loại cho Feature D (XL_FILL_LOAI — palette nhạt)
| Xếp loại | bg | fg |
|---|---|---|
| A+ | EDE9FE | 5B21B6 |
| A  | DCFCE7 | 166534 |
| B  | DBEAFE | 1E40AF |
| C  | FEF9C3 | 854D0E |
| D  | FEE2E2 | 991B1B |

### SettingsModal.jsx
- Tab Kết nối: "Ghi vào initialData.js" chỉ DEV mode — **không push lên Supabase**
- Tab Người dùng (admin only): `phong_id` ẩn/disabled cho admin + company_viewer

---

## Xuất/Nhập Excel

### Import rules
- Mã đã tồn tại → cập nhật (confirm trước); mã trống → tạo mới tự động
- KPI chiều: "↓"/"thấp" → `upper_gt_lower=false`
- NV trạng thái: "Đã nghỉ" → `archived_at=now()`
- NhomCV/KhuVuc update tên: cascade sang NV snapshots qua `renameNhomCv`/`renameKv`
- `xlsx-js-style` để xuất; `xlsx` để đọc

### Excel style
- Header: bold/white/sz11/Segoe UI, fill=`1E40AF`, align center, wrapText, border thin `93C5FD`
- Data: sz10/Segoe UI, fill=even`F0F9FF`/odd`FFFFFF`, border thin `E2E8F0`
- `wch`: STT=6, Mã=12, Tên=30, Điểm=12, Xếp loại=15, Mô tả=45
- Row height: header=**25**, data=**20** (KHÔNG dùng 18/36); KPI input header=100; `KPI_STRIPE_COLORS=['EFF6FF','F0FDF4']`
- Sheet có title row (row 0) + header row: title hpt=22, header hpt=25, data hpt=20
- **Frozen pane bắt buộc** cho tất cả export: `ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: N }]`
  - Sheet chỉ có header (row 0): `ySplit: 1`
  - Sheet có title+header (rows 0-1): `ySplit: 2`
  - Sheet có title+subtitle+header (rows 0-2): `ySplit: 3`

---

## File organization — 1 file per menu cha
| File | Menu |
|---|---|
| `LoginPage.jsx` | Auth login |
| `contexts/AuthContext.jsx` | Auth context + guards |
| `Layout.jsx` | Layout + PhongSwitcher; export `AccessDenied` |
| `Dashboard.jsx` | Dashboard |
| `DanhSachNV.jsx` | Danh sách NV; export `DanhSachNVModule` |
| `KpiInputModule.jsx` | Nhập liệu KPI |
| `KPIManagement.jsx` | Quản lý KPI |
| `WeightManagement.jsx` | Quản lý trọng số |
| `KpiReport.jsx` | Báo cáo KPI |
| `SettingsModal.jsx` | Settings |

**Không tạo file mới** trừ khi component dùng ở >1 menu cha.  
`utils/navGuard.js` — singleton guard cho in-app navigation warning (dùng bởi WeightManagement + KPIManagement).

---

## UI conventions
- Loading: `⏳ Đang tải dữ liệu từ Supabase...` (blue-50 box) — dưới info box, trên content
- Badge xếp loại: A+=purple | A=green | B=blue | C=yellow | D=red; class CSS: `.badge-Aplus .badge-A .badge-B .badge-C .badge-D`
- Archived rows: `opacity-60`; empty cells: `text-gray-300 —`
- Mobile: padding `p-3 md:p-6`; sidebar overlay `<md`; ẩn cột phụ `hidden sm:table-cell`; toolbar dùng `flex-wrap`
- SettingsModal: bottom sheet mobile (`items-end rounded-t-2xl`), center modal tablet+

### Sidebar submenu — phân biệt màu theo vị trí
Mỗi submenu item trong cùng 1 menu cha có dot màu nhỏ (`w-1.5 h-1.5 rounded-full`) theo thứ tự.
Màu dot **khớp** với màu info box trên trang tương ứng — tạo hệ thống màu nhất quán:
```
const SUBMENU_DOT = ['bg-blue-400', 'bg-teal-400', 'bg-purple-400', 'bg-orange-400'];
// childIdx 0=blue(1st), 1=teal(2nd), 2=purple(3rd), 3=orange(4th, dự phòng)
```
NavLink submenu dùng `flex items-center gap-2`. Dot đặt trước label.

### Bảng dữ liệu — 2 loại

#### Loại 1: Management table (CRUD / danh sách)
Dùng cho: DanhSachNV, KPIManagement thư viện, KpiInputModule danh sách NV, Dashboard, WeightManagement, SettingsModal.

```jsx
<div className="card p-0 overflow-hidden">
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-blue-50 border-b border-blue-100">
        <tr>
          <th className="th text-center w-10">STT</th>
          <th className="th">Tên cột</th>
          {/* Cột ẩn mobile: hidden sm:table-cell / hidden md:table-cell */}
          <th className="th text-center w-20">Thao tác</th>
        </tr>
      </thead>
      <tbody>
        {/* Row thường */}
        <tr className="border-t border-gray-100 hover:bg-gray-50">
          <td className="td text-center text-gray-400">{i + 1}</td>
          <td className="td font-medium text-gray-900">{name}</td>
          <td className="td text-center">
            <div className="flex items-center justify-center gap-1">...</div>
          </td>
        </tr>
        {/* Row đang edit */}
        <tr className="bg-blue-50 border-t border-blue-200">
          <td colSpan={n} className="px-4 py-3">...</td>
        </tr>
        {/* Row archived */}
        <tr className="border-t border-gray-100 opacity-60">...</tr>
        {/* Group header row */}
        <tr className="bg-blue-50 border-t border-blue-100">
          <td colSpan={n} className="px-4 py-1.5 font-semibold text-blue-800 text-xs">
            {nhom.thu_tu}. {nhom.ten_nhom}
          </td>
        </tr>
        {/* Empty state */}
        <tr>
          <td colSpan={n} className="td text-center text-gray-400 py-8">Chưa có dữ liệu</td>
        </tr>
        {/* Summary/total row */}
        <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
          <td colSpan={n-1} className="td">Tổng</td>
          <td className="td text-right tabular-nums">{total}</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

**Quy tắc management table:**
- `.th` class cho tất cả `<th>` — thêm `text-center` để override `text-left` khi cần
- `.td` class cho tất cả `<td>` — thêm modifier như `font-medium`, `text-right`, `tabular-nums`
- Mã ID: `font-mono text-xs text-blue-600`; số/điểm: `text-right tabular-nums font-semibold`
- Cột thao tác: `text-center` + nút dùng `flex items-center justify-center gap-1`
- Empty state: luôn `py-8` (KHÔNG dùng `py-6`, `py-10`)
- Row active/selected: `bg-blue-50`; row editing expand: `bg-blue-50 border-t border-blue-200`
- Thead: luôn `bg-blue-50 border-b border-blue-100` (**KHÔNG** dùng `bg-gray-50`)

#### Loại 2: Report table (báo cáo dạng dense grid)
Dùng cho: KpiReport hiển thị bảng KPI, bảng cross NV×KPI.

```jsx
<div className="overflow-x-auto">
  <table className="w-full text-xs border-collapse">
    <thead className="bg-blue-50 border-b border-blue-100">
      <tr className="text-gray-600 text-xs uppercase tracking-wide">
        <th className="th-report text-center w-8">STT</th>
        <th className="th-report text-left">Tên KPI</th>
        <th className="th-report text-right w-22">Điểm</th>
      </tr>
    </thead>
    <tbody>
      {/* Group header row */}
      <tr className="bg-blue-50 border-t border-blue-100">
        <td colSpan={n} className="td-report font-semibold text-blue-700">
          {nhom.ten_nhom}
        </td>
      </tr>
      {/* Data row */}
      <tr className="hover:bg-gray-50">
        <td className="td-report text-center text-gray-400">{stt}</td>
        <td className="td-report text-gray-800">{ten_kpi}</td>
        <td className="td-report text-right font-semibold text-blue-700">{diem}</td>
      </tr>
      {/* Summary section header (green=CTY, blue=Phòng, indigo=CN Phòng) */}
      <tr className="bg-green-50 text-green-900 font-semibold">
        <td className="td-report text-center">A</td>
        <td className="td-report">KPI Công ty</td>
        ...
      </tr>
      {/* Total row */}
      <tr className="bg-gray-100 text-gray-800 font-bold border-t-2 border-gray-300">
        <td className="td-report text-center">C</td>
        <td colSpan={n-2} className="td-report">Tổng điểm</td>
        <td className="td-report text-right text-blue-700">{tongDiem}</td>
      </tr>
    </tbody>
  </table>
</div>
```

**Quy tắc report table:**
- `.th-report` và `.td-report` từ `index.css`
- `border-collapse` bắt buộc trên `<table>`
- Group header row: `bg-blue-50 border-t border-blue-100` (KHÔNG dùng `bg-gray-50`)
- Summary section header màu: green=KPI Công ty, blue=KPI Phòng, indigo=KPI Phòng (trong báo cáo cá nhân)
- Total row: `bg-gray-100 font-bold border-t-2 border-gray-300`
- Striped rows (chỉ khi cần): `i % 2 === 0 ? '' : 'bg-gray-50'`

### Các phần tử UI xuất hiện thường xuyên — quy tắc đồng bộ

**Page title (tiêu đề trang)**
```jsx
<h2 className="text-lg md:text-xl font-bold text-gray-900">{Icon} {Tên trang}</h2>
<p className="text-gray-500 text-xs mt-0.5">{Mô tả ngắn}</p>
```

**Info/guide box (ô hướng dẫn đầu trang) — màu theo vị trí submenu**

Màu info box phản ánh vị trí submenu trong menu cha — khớp với màu dot indicator trên sidebar:

| Vị trí | Màu dot | Màu info box |
|---|---|---|
| 1st submenu | `bg-blue-400` | `bg-blue-50 border-blue-200 text-blue-800` |
| 2nd submenu | `bg-teal-400` | `bg-teal-50 border-teal-200 text-teal-800` |
| 3rd submenu | `bg-purple-400` | `bg-purple-50 border-purple-200 text-purple-800` |
| 4th submenu | `bg-orange-400` | `bg-orange-50 border-orange-200 text-orange-800` |

Dashboard (không có submenu): dùng blue.

```jsx
{/* 1st submenu */}
<div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
  {Icon} <strong>{Tên trang}</strong> — {Mô tả}.
</div>
{/* 2nd submenu */}
<div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-800">
  ...
</div>
{/* 3rd submenu */}
<div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 text-sm text-purple-800">
  ...
</div>
```

**Phân biệt info box chính vs. thông báo trạng thái:**
- Info box chính (guide, đầu trang): màu theo vị trí submenu (blue/teal/purple)
- Thông báo thông tin phụ (trong-page): `bg-blue-50` (info), `bg-amber-50` (warning), `bg-red-50` (error), `bg-green-50` (success)
- **KHÔNG** dùng màu trạng thái (amber/red/green) cho info box chính đầu trang

**Section header (tiêu đề section/vùng)**
```jsx
<h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{Tên section}</h3>
```

**Empty state (khi không có dữ liệu)**
```jsx
<div className="card flex flex-col items-center gap-3 py-12 text-center text-gray-400">
  <span className="text-4xl">📭</span>
  <p className="font-medium text-gray-500">{Thông báo chính}</p>
  <p className="text-sm">{Gợi ý hành động}</p>
</div>
```

**Action toolbar (thanh công cụ)**
```jsx
<div className="flex items-center gap-2 flex-wrap">
  {/* Filters/search bên trái */}
  <div className="flex-1" /> {/* spacer */}
  {/* Actions bên phải: Nhập (import) → Xuất (export) → Thêm mới */}
</div>
```

**Sub-tab switcher (chọn tab con)**
```jsx
<div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
  <button className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'
  }`}>Tab label</button>
</div>
```

**Modal**
```jsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-{X} mx-4 max-h-[90vh] overflow-y-auto">
    <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
      <h3 className="font-bold text-lg">{Tiêu đề}</h3>
      <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
    </div>
    <div className="px-6 py-4 space-y-4">...</div>
    <div className="px-6 py-4 border-t flex justify-end gap-3 sticky bottom-0 bg-white">
      <button className="btn-secondary">Hủy</button>
      <button className="btn-primary">💾 Lưu</button>
    </div>
  </div>
</div>
```

**Year/Month Picker — luôn dùng component dùng chung**
```jsx
import YearMonthPicker from './YearMonthPicker';
<YearMonthPicker thangList={thangList} value={thang} onChange={setThang} />
```
**KHÔNG** implement inline `<select>` year/month picker riêng trong từng component.

## Code rules
- Không comment trừ khi lý do không rõ từ code; không tạo abstraction sớm
- Giao tiếp với user bằng tiếng Việt
- `isConnected()` trước mọi Supabase write (fire-and-forget)
- JSDoc header mỗi file: `@file`, `@description`, PHÂN QUYỀN, LƯU Ý (≤30 dòng)

## Deploy
Cloudflare Pages ← GitHub repo (private)
- Build cmd: `npm run build`; Root dir: `kpi-tool`; Output: `dist`
- `public/_redirects` đã có cho SPA routing
