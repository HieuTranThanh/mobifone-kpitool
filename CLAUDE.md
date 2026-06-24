# KPI Tool — Architecture Guide

## Tech stack
- React 19 + Vite 8 + Tailwind v3; `<BrowserRouter>` (react-router-dom v7)
- **Supabase PostgreSQL = nguồn sự thật**; localStorage = cache (xóa không mất data)
- `src/config.js`: SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULT_PHONG_ID (hardcoded)
- `services/supabaseService.js` (Supabase ops + auth) · `services/store.js` (localStorage R/W + local compute) · `services/calcService.js` (KPI scoring local)

## Nguyên tắc kiến trúc
- Mọi ghi → sync Supabase ngay (fire-and-forget; `isConnected()` trước mỗi write)
- App mount → `getAll()` pull → localStorage → `setRefreshKey` → Outlet re-mount
- `calcMonth` chạy local → lưu output lên Supabase
- Snapshot/template chỉ lưu ID refs; detail tra từ library khi render
- **KHÔNG** filter NV theo `active`/`archived_at` trong tính điểm/nhập liệu/trọng số

## Nguyên tắc "Đủ dữ liệu" — KHÔNG được thay đổi
Chưa đủ dữ liệu → KPI chưa có điểm (`xep_loai = null`). "Tính KPI" chỉ lưu + tính; NV thiếu data không có điểm.

**Nguồn logic duy nhất = `store.js`** (KHÔNG tự định nghĩa lại trong component):
| Hàm | Dùng ở |
|---|---|
| `computePhongInputStatus(inp, kpiPhong)` | NhapLieuPhong (`form` chưa lưu) |
| `getInputPhongStatus(thang)` | Dashboard, BaoCaoPhongTab |
| `getInputCNStatus(thang, nv_id)` | NhapLieuKPI, Dashboard, BaoCaoCaNhanTab, handleCalc |

**Điều kiện đủ:**
- KPI Phòng = `diem_kpi_chinhanh_kq` + 5 cột/KPI: `_value _upper _lower _trong_so _max_pct`
- KPI Cá nhân = 6 cột/KPI (5 trên + `_giam_tru`) **VÀ** KPI Phòng đủ
- Phòng chưa đủ → mọi NV cá nhân đều "thiếu" dù đã nhập đủ 6 cột

**3 badge:** `empty`(Chưa nhập, gray) · `partial`(Thiếu dữ liệu, yellow) · `full`(✓ Đủ dữ liệu, green). Class: `badge bg-{gray-100/yellow-100/green-100} text-{gray-400/yellow-700/green-700}`.

**handleCalc** dùng `getInputCNStatus` (KHÔNG tự build requiredSufs). Sau `calcSupabase`, override loại NV "thiếu" theo frontend khỏi kết quả dù server tính được:
```js
const incompleteIds = new Set(localUnscoredRows.map(r => r.nv_id));
const scoredRows = (result.ket_qua||[]).filter(r => !incompleteIds.has(r.nv_id));
```

## Auth & RBAC
```sql
CREATE TABLE app_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phong_id UUID,
  role TEXT CHECK (role IN ('admin','department_editor','branch_viewer','department_viewer')),
  display_name TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
```
**Permission matrix:**
| Menu | admin | dept_editor | branch_viewer | dept_viewer |
|---|:-:|:-:|:-:|:-:|
| Dashboard / Báo cáo KPI | ✅ | ✅ | ✅ | ✅ |
| DS NV / Quản lý KPI / Trọng số / Nhập liệu | ✅ | ✅ | ❌ | ❌ |
| Cấu hình xếp loại / Settings + user mgmt | ✅ | ❌ | ❌ | ❌ |

**Guard:** `if (!canEditDept(user)) return <AccessDenied/>;` (import từ AuthContext + Layout). Helpers: `canAdmin/canViewAll/canEditDept(u)`, `ROLE_LABELS`.
- `ROLE_LABELS` = single source; `ROLE_OPTIONS` derive từ nó. `refreshUser()` re-fetch sau khi admin tự edit. role null → warning vàng + chỉ Dashboard + Cài đặt.

**PhongSwitcher:** admin/branch_viewer (nhãn "Xem KPI toàn chi nhánh") thấy ở sidebar header (default "🏢 Chọn phòng"); dept users không thấy (tên phòng = `phongList.find(p=>p.id===user.phong_id)?.ten_phong`). `phongList` fetch ở Layout, truyền qua prop; không có "Tất cả phòng".

**Cache isolation khi switch phòng** (`loadData()` Layout.jsx):
- Xóa prefix: `kpi_snapshot_ nv_snapshot_ trong_so_thang_ input_phong_ locked_cn_ locked_phong_ trong_so_weights_ output_meta_`
- Xóa exact: `kpi_library nhom_library nv_library nhom_cv_library kv_library kpi_list nhom_list nhom_cv_list khu_vuc_list trong_so xep_loai_config output_diem output_chitiet input_cn`
- Giữ: `supabase_url supabase_anon_key phong_id sb-kpi-auth`

## Supabase
**Tables:** Libraries (filter phong_id): `kpi_library nhom_library nhan_vien nhom_cv khu_vuc` · `config_store` (key-value/phong_id: snapshots, configs, weights) · Input `input_cn input_cn_nv` · Output `output_diem output_chitiet` · Auth `app_users phong`

**Key fn (supabaseService.js):** `getAll()` (libraries+config_store→localStorage) · `getDiemThang(thang)` (bundle inputCN+outputDiem+snapshots) · `calcMonth(thang)` (tính local → upsert output_diem+chitiet) · `syncToSupabase(key,val)`/`deleteFromSupabase(key)` (config_store) · `syncWeightConfig(thang,weights)` (auto weights → input_cn_nv) · `getPhongList()`

**RLS setup (bắt buộc khi Supabase mới):**
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

## Data structures
**ID format:** `kpi_id` KPI_CN_000001 / KPI_PH_000001 · `nhom_id` NhomKPI_CN_… / NhomKPI_PH_… · `nv_id` NhanVien_000001 · `nhom_cv_id` NhomCV_CN_… · `kv_id` KVQL_VN_…

**Library fields:**
- `kpi_library`: `upper_gt_lower`(true=cao tốt), `archived_at`(null=active), `cach_tinh`; **`max_pct` KHÔNG lưu** — là param/tháng trong input_cn
- `nhom_library`: không có `thu_tu` — `thu_tu`(I,II,III) là per-template/month
- `nhan_vien`: `nhom_cv`/`khu_vuc` không lưu library — per-month trong `nv_snapshot_YYYY-MM`

**Snapshots:**
```js
// NV: { thang, nvRefs:[{nv_id,nhom_cv,khu_vuc,stt}], nhomCvList, khuVucList }
// KPI: { thang, kpiRefs:[{kpi_id,nhom_id,stt}], nhomRefs:[{nhom_id,thu_tu,kpi_cap}] }
```

**localStorage keys:**
| Key | Nội dung |
|---|---|
| `kpi_library nhom_library nv_library nhom_cv_library kv_library` | Libraries |
| `kpi_list nhom_list nhom_cv_list khu_vuc_list trong_so xep_loai_config` | Config |
| `kpi_snapshot_YYYY-MM nv_snapshot_YYYY-MM` | KPI/NV per-month |
| `trong_so_thang_YYYY-MM` | Config trọng số (`mode:'manual'/'auto'`) |
| `trong_so_weights_YYYY-MM` | Weights auto mode (xóa khi về manual) |
| `input_phong_YYYY-MM` | KPI phòng per-month (config_store) |
| `locked_cn_YYYY locked_phong_YYYY` | `{"YYYY-MM":true}` tháng đã chốt |
| `output_diem output_chitiet input_cn` | Cache — xóa khi switch phòng |
| `supabase_url supabase_anon_key phong_id sb-kpi-auth` | System — giữ |
| `nv_list` | legacy — auto-migrate bởi `getNvLibrary()` |

## Logic tính điểm
- `kpiScore(value, lower, upper, maxPct, weight, giamTru)` — port từ LAMBDA Excel
- `tongDiem = diemPhong × phongRatio + diemCaNhan`
- Xếp loại: A+≥105(Xuất sắc) · A≥101(Vượt) · B≥100(Đạt) · C≥95(Đạt một phần) · D<95
- Xếp hạng: standard competition (1,1,1,4,5…), KHÔNG sequential

## Modules

### WeightManagement.jsx — Trọng số
- Default read-only; "✏️ Chỉnh sửa" (trên Bước 1) → alert → `editMode`
- editMode: auto-save localStorage debounced 800ms (KHÔNG sync Supabase)
- "💾 Lưu & Sync" → validate → `saveTrongSoConfig` + `syncWeightConfig` → thoát editMode
- `beforeunload` cảnh báo khi unsaved. In-app nav guard: `setNavGuard(msg)` khi `editMode && isDirty`, `clearNavGuard()` khi save/cancel; Layout intercept NavLink + `toggleMenu` — ⚠️ `useBlocker` KHÔNG dùng được với `<BrowserRouter>`
- `readOnly` prop → TyLeCap, ModeSelector, NhomKpiPanel, CvConfigPanel. `copyFromMonth` auto-enter editMode
- **Validation auto:** lỗi chỉ khi KPI chưa add vào nhóm nào. KPI đã add nhưng priority=null (0đ) là **hợp lệ** ("Không tính")
- **Dual mode:** manual=`_trong_so` từ input_cn; auto=Bước 3–4 config, lưu `syncWeightConfig`+`syncToSupabase('trong_so_weights_…')`; auto→manual = `deleteFromSupabase('trong_so_weights_…')`
- **Constrained Linear Allocation:**
```
avg=total/N; b=max(0,min(2*(wMax-avg)/(N-1), 2*(avg-wMin)/(N-1)))
w_i = (avg - b*(N-1)/2) + b*(N-1-i)   // i=0 = ưu tiên 1 (cao nhất)
```
`normalizeWeightsToInt(weights, target)`: largest-remainder, tổng = target chính xác.

### KPIManagement.jsx
- Tab1 Thư viện: sub-tab CN/Phòng; `+T` chỉ khi `!inTemplate && !archived`
- Tab2 Template: edit nhóm chỉ sửa STT (`thu_tu`), KHÔNG sửa tên nhóm (sửa ở Thư viện)
- Tab3 TheoThang: cần NV snapshot trước; `recompactNhom` renumber I,II,III sau xóa; nav guard qua `setNavGuard` khi editMode
- Modal multi-select: Phase1 checkbox+search; Phase2 gán STT/nhóm; `onAdd` nhận mảng

### DanhSachNV.jsx (export `DanhSachNVModule`)
- Sub-tab A Thư viện: CRUD nhan_vien; `syncNvLibrary()` sau mọi thao tác
- Sub-tab B Theo tháng: snapshot độc lập/tháng; sao chép giữ nhomCvList+khuVucList
- Update tên NhomCV/KhuVuc: `renameNhomCv`/`renameKv` cascade sang NV snapshots

### KpiInputModule.jsx — Nhập liệu
- NV list: `getNvListForThang(thang)` (không filter active/archived)
- `InputCaNhanModal`: 6 fields/KPI (lower upper value trong_so max_pct giam_tru); `_trong_so` read-only khi `mode==='auto'`; `_max_pct` default 100
- Badge CN: `FULL_SUFS` = 6 fields (manual) / 3 fields value,upper,lower (auto)
- Badge phòng (`phongInputStatus` useMemo): `diem_kpi_chinhanh_kq` + 4 fields/KPI từ `form`

### Dashboard.jsx
- Month picker: `getThangList()` (có output_diem/input_phong) — KHÔNG `getSnapshotThangList()`
- Badge chốt: `isInputPhongLocked`/`isInputCNLocked`. `diem_kpi_chinhanh_kq`=gốc hiển thị; `diem_kpi_chinhanh`=đã ×trọng số
- **Tiến độ nhập liệu** (Feat A): 4 thẻ — NV nhập KPI (đã tính/đủ/thiếu/chưa), KPI Phòng, Chốt CN, Chốt Phòng; `progress` useMemo derive từ `rankedRows` (lấy `ly_do`)
- **Biểu đồ điểm** (Feat B): CSS bar ngang, màu theo `BAR_COLOR`, scale max=115
- **📢 Thông báo** (Feat E): section riêng (header amber) đứng **trước** Tiến độ. Admin quản lý nhiều ghi chú/tháng; mỗi ghi chú `{id,text,url}` — url rỗng=📌 thường, có url=🔗 (tab mới, text=nhãn). Key `month_note_YYYY-MM` config_store dạng **mảng** via `getMonthNotes`/`saveMonthNotes` (legacy chuỗi đơn auto-migrate→mảng). State `notes`+`editingId`(null|'new'|id)+`draftText`/`draftUrl`. Editor: textarea(2 rows, max500)+input URL; Ctrl+Enter lưu, Esc hủy. User thường chỉ xem; admin có ✏️/🗑️ + nút thêm. Ẩn với user thường khi chưa có ghi chú

### KpiReport.jsx
- `exportAllToExcel(thang)`: sheet KPI Phòng → Tổng hợp NV → [Tên NV]×n. Sheet Tổng hợp NV: nguồn `nvList`(sort nv_id A-Z) join outputDiem; cột Chi tiết = hyperlink `#'TênNV'!A1`; `nvSheetNameMap` pre-compute tên sheet
- `exportNvAllMonthsToExcel(nvId,hoTen,xepLoaiCfg,filteredThangList)`: 1 NV theo năm; **fetch Supabase async** nếu thiếu data; sheet Tổng hợp KPI + sheet/tháng; `exporting` state→"⏳ Đang tải..."
- `exportPhongAllMonthsToExcel(filteredThangList)`: KPI Phòng theo năm; dùng `computePhongData()`+localStorage (KHÔNG fetch async); sheet Tổng hợp KPI Phòng + sheet/tháng; chỉ tháng có `inp` không rỗng
- `BaoCaoPhongTab`: `exportYear` state + nút "📥 Xuất toàn bộ KPI Phòng năm" (phải, đầu tab); badge `phongStatus` đầu toolbar. `BaoCaoCaNhanTab` tab Chi tiết tương tự + badge `nvInputStatus`
- **`exportAllNvAllMonthsToExcel(year,filteredThangList)`** (Feat D): bảng chéo tháng×NV; nguồn `getOutputDiemByThang`(localStorage); nút "📊 Xuất tổng hợp tất cả NV"
  - Sheet1 "Điểm NV {year}": plain alternating (F8FAFC/FFFFFF), KHÔNG tô màu xếp loại; `tong_diem=0`/không điểm → trống
  - Sheet2 "Xếp loại {year}": tô màu nhạt theo `XL_FILL_LOAI`; không xếp loại/điểm=0 → trống
  - Cột NV `wch:18`(S1)/`12`(S2); header `hpt:40`+wrapText; Frozen `xSplit:2,ySplit:2`
  - `XL_FILL_LOAI` (bg/fg): A+ EDE9FE/5B21B6 · A DCFCE7/166534 · B DBEAFE/1E40AF · C FEF9C3/854D0E · D FEE2E2/991B1B

### SettingsModal.jsx
- Tab Kết nối: "Ghi vào initialData.js" chỉ DEV — KHÔNG push Supabase
- Tab Người dùng (admin): `phong_id` ẩn/disabled cho admin + branch_viewer

## Excel
**Import:** mã tồn tại→cập nhật (confirm); mã trống→tạo mới · KPI "↓"/"thấp"→`upper_gt_lower=false` · NV "Đã nghỉ"→`archived_at=now()` · update tên NhomCV/KhuVuc cascade qua `renameNhomCv`/`renameKv` · dùng `xlsx-js-style` cả đọc lẫn xuất (`xlsx` đã gỡ vì trùng)

**Style:** Header bold/white/sz11/Segoe UI, fill `1E40AF`, center, wrapText, border thin `93C5FD` · Data sz10/Segoe UI, fill even`F0F9FF`/odd`FFFFFF`, border thin `E2E8F0` · `wch` STT=6 Mã=12 Tên=30 Điểm=12 Xếp loại=15 Mô tả=45 · Row height header=25 data=20 (KHÔNG 18/36); KPI input header=100; `KPI_STRIPE_COLORS=['EFF6FF','F0FDF4']`
- **Frozen pane bắt buộc:** `ws['!views']=[{state:'frozen',xSplit:0,ySplit:N}]`; N = 1 (chỉ header) / 2 (title+header) / 3 (title+subtitle+header)

## File organization — 1 file/menu cha
`LoginPage.jsx`(login) · `contexts/AuthContext.jsx`(context+guards) · `Layout.jsx`(layout+PhongSwitcher, export `AccessDenied`) · `Dashboard.jsx` · `DanhSachNV.jsx` · `KpiInputModule.jsx` · `KPIManagement.jsx` · `WeightManagement.jsx` · `KpiReport.jsx` · `SettingsModal.jsx`
- KHÔNG tạo file mới trừ khi dùng ở >1 menu cha. `utils/navGuard.js` = singleton guard (WeightManagement + KPIManagement)

## UI conventions
- Loading: `⏳ Đang tải dữ liệu từ Supabase...` (blue-50 box, dưới info box trên content)
- Badge xếp loại: A+=purple A=green B=blue C=yellow D=red; class `.badge-Aplus/.badge-A/.badge-B/.badge-C/.badge-D`
- Archived rows `opacity-60`; empty cells `text-gray-300 —`
- Mobile: padding `p-3 md:p-6`; sidebar overlay `<md`; ẩn cột phụ `hidden sm:table-cell`; toolbar `flex-wrap`. SettingsModal: bottom sheet mobile (`items-end rounded-t-2xl`), center tablet+

**Sidebar submenu dot màu theo vị trí** (khớp màu info box trang):
```
const SUBMENU_DOT = ['bg-blue-400','bg-teal-400','bg-purple-400','bg-orange-400'];
// 0=blue(1st) 1=teal(2nd) 2=purple(3rd) 3=orange(4th)
```
Dot `w-1.5 h-1.5 rounded-full`, NavLink `flex items-center gap-2`, dot trước label.

### Bảng — 2 loại
**Loại 1 Management** (DanhSachNV, KPIManagement thư viện, KpiInput DS NV, Dashboard, WeightManagement, SettingsModal):
- Wrapper `card p-0 overflow-hidden` > `overflow-x-auto` > `table w-full text-sm`
- Thead luôn `bg-blue-50 border-b border-blue-100` (KHÔNG bg-gray-50)
- `.th` (thêm `text-center` khi cần); `.td` (+ `font-medium`/`text-right`/`tabular-nums`)
- Mã ID `font-mono text-xs text-blue-600`; số/điểm `text-right tabular-nums font-semibold`
- Cột thao tác `text-center` + `flex items-center justify-center gap-1`
- Row thường `border-t border-gray-100 hover:bg-gray-50`; STT `td text-center text-gray-400`
- Row edit `bg-blue-50 border-t border-blue-200`; archived `+opacity-60`
- Group header `bg-blue-50 border-t border-blue-100` td `colSpan px-4 py-1.5 font-semibold text-blue-800 text-xs` ("{thu_tu}. {ten_nhom}")
- Empty state `td text-center text-gray-400 py-8` (luôn py-8)
- Total `border-t-2 border-gray-300 bg-gray-50 font-semibold`, số `td text-right tabular-nums`

**Loại 2 Report** (KpiReport bảng KPI, cross NV×KPI):
- `table w-full text-xs border-collapse` (border-collapse bắt buộc); thead `bg-blue-50 border-b border-blue-100`
- `.th-report`/`.td-report` (từ index.css)
- Group header `bg-blue-50 border-t border-blue-100` td `font-semibold text-blue-700`
- Data row `hover:bg-gray-50`; STT `text-center text-gray-400`; điểm `text-right font-semibold text-blue-700`
- Summary header màu: green=KPI Chi nhánh, blue=KPI Phòng, indigo=KPI Phòng (trong báo cáo CN)
- Total `bg-gray-100 font-bold border-t-2 border-gray-300`; stripe (nếu cần) `i%2? 'bg-gray-50':''`

### Phần tử dùng chung
- **Page title:** `h2.text-lg md:text-xl font-bold text-gray-900` ({Icon}{Tên}) + `p.text-gray-500 text-xs mt-0.5` (mô tả)
- **Info/guide box** (màu theo vị trí submenu, khớp dot): 1st blue / 2nd teal / 3rd purple / 4th orange — `bg-{c}-50 border border-{c}-200 rounded-xl px-4 py-3 text-sm text-{c}-800`. Dashboard=blue. KHÔNG dùng màu trạng thái (amber/red/green) cho info box chính
- **Thông báo phụ trong-page:** blue=info amber=warning red=error green=success (`bg-{c}-50`)
- **Section header:** `h3.text-xs font-semibold text-gray-400 uppercase tracking-widest`
- **Empty state:** `card flex flex-col items-center gap-3 py-12 text-center text-gray-400` + 📭 text-4xl + p chính + p gợi ý
- **Toolbar:** `flex items-center gap-2 flex-wrap`; filters trái, spacer `flex-1`, actions phải (Nhập→Xuất→Thêm)
- **Sub-tab switcher:** wrapper `flex gap-1 bg-gray-100 p-1 rounded-lg`; btn `px-4 py-1.5 rounded-md text-sm font-medium`, active `bg-white shadow text-blue-700` else `text-gray-500 hover:text-gray-700`
- **Modal:** overlay `fixed inset-0 z-50 flex items-center justify-center bg-black/40`; box `bg-white rounded-2xl shadow-2xl w-full max-w-{X} mx-4 max-h-[90vh] overflow-y-auto`; header/footer sticky `border-b`/`border-t`; close `✕`; footer `flex justify-end gap-3` (btn-secondary Hủy + btn-primary 💾 Lưu)
- **Year/Month Picker:** luôn `import YearMonthPicker` — KHÔNG implement `<select>` inline riêng

### Hiển thị số (UI + Excel) — nhất quán mọi nơi
- Thập phân: làm tròn 2 số, bỏ trailing zero (`50.33`, `97.55`); nguyên: chính nó không `.00`
- % giống vậy (`100.39%`, `84.9%`, `100%`)
- Helpers (KpiReport.jsx): `fmt(n,d=2)` UI `parseFloat(Number(n).toFixed(d)).toString()` · `r2` Excel · `fmtPct(n)` (`n*100`+'%') · `fmtPctDisp(dp)`
- KHÔNG `.toFixed()` trực tiếp vào JSX — luôn bọc `parseFloat()`

## Code rules
- Không comment trừ khi lý do không rõ; không abstraction sớm; giao tiếp tiếng Việt
- `isConnected()` trước mọi Supabase write
- JSDoc header mỗi file: `@file`, `@description`, PHÂN QUYỀN, LƯU Ý (≤30 dòng)

## Quy ước thuật ngữ — "Chi nhánh" (KHÔNG dùng "Công ty")
KPI cấp trên (cấp công ty rót xuống phòng) gọi là **"KPI Chi nhánh"** ở MỌI nơi: UI hiển thị, biến, comment, Excel export. KHÔNG dùng "Công ty".
- Biến/key: `ty_le_chinhanh`, `diem_chinhanh`, `kq_chinhanh`, `diem_chinhanh_dong_gop`; config key `ty_le.phong.chinhanh`.
- **Key cũ `ty_le.phong.cty`**: đã migrate DB → `chinhanh` qua `supabase/migration_2026-06-21_chinhanh.sql`. Code vẫn giữ fallback đọc `?.chinhanh ?? ?.cty ?? 50` (Dashboard/KpiInputModule/KpiReport) + `normalizePriorities` (WeightManagement) tự migrate khi load — belt-and-suspenders cho localStorage cache chưa pull lại. KHÔNG xóa fallback `cty`.
- DB field `diem_kpi_chinhanh` / `diem_kpi_chinhanh_kq` (input_phong) vốn đã là "chi nhánh" — giữ nguyên.
- **Role `branch_viewer`** (trước là `company_viewer`, đã migrate DB cùng file SQL trên): nhãn UI "Xem KPI toàn chi nhánh" (`ROLE_LABELS`). Các role khác `admin`/`department_editor`/`department_viewer` giữ nguyên (không phải "công ty").
- **Triển khai SQL ↔ code phải đồng thời**: code check `branch_viewer` + ghi key `chinhanh`; chạy migration RỒI deploy ngay để khớp dữ liệu.

## Testing

**Stack:** Vitest 4 + jsdom + @testing-library/react + @testing-library/jest-dom

```bash
npm run test        # chạy 1 lần (CI)
npm run test:watch  # watch mode (dev)
npm run lint        # ESLint
npm run build       # production build
```

**Quy trình sau khi sửa code:** `npm run test && npm run lint && npm run build` — cả 3 phải PASS.

### Cấu trúc test
```
src/__tests__/
├── setup.js                    # localStorage mock + jest-dom
├── kpiScore.test.js            # kpiScore, kpiDisplayPct, xepLoaiWithConfig, calcDiemPhong, calcNhanVien
├── store.test.js               # CRUD Library/NV/Input/Output, ID gen, Snapshot, Lock, MonthNotes, computePhongInputStatus, recomputeKpiPct, computeNvWeights
├── calcService.test.js         # calcMonth (manual + auto mode, merge output)
├── navGuard.test.js            # setNavGuard, clearNavGuard, checkNavGuard, safePrefix
├── sortConfig.test.js          # formatUsedMonths (range, dedup, multi-year)
├── ImportConfirmModal.test.jsx # Component: render theo trạng thái + callback (props-driven, không cần mock)
├── YearMonthPicker.test.jsx    # Component: options năm/tháng + tương tác đổi năm/tháng + defaultThang
├── LoginPage.test.jsx          # Component: validate form + gọi login + báo lỗi (mock useAuth)
├── Dashboard.test.jsx          # Component: render offline từ output_diem (mock supabaseService + AuthContext + MemoryRouter)
├── KpiInputModule.test.jsx     # Component: tab CauHinhXepLoai — validate ngưỡng A+>A>B>C, edit/save (mock + Routes :tab)
└── WeightManagement.test.jsx   # Component: ManualWeightGrid (normalize/lưu) + copyFromMonth (copy trọng số tự động giữa tháng)
```

### Nguyên tắc test
- **Ưu tiên sửa code, không sửa test** — test phản ánh spec nghiệp vụ
- **Không thay đổi nghiệp vụ** để làm test pass; không xóa/vô hiệu tính năng
- Logic thuần (`utils/`, `services/`): test trực tiếp. Component: dùng `@testing-library/react`
- `setup.js` cung cấp `localStorage` mock (in-memory object) — mỗi test file gọi `localStorage.clear()` trong `beforeEach`
- Vitest config nằm trong `vite.config.js` (`test` block), dùng jsdom environment

### Component test — pattern mock (jsdom + @testing-library/react)
- **Props-driven** (ImportConfirmModal, YearMonthPicker): render trực tiếp, không cần mock.
- **Module cần context/Supabase** (Dashboard, …): test ở chế độ **offline**:
  - `vi.mock('../services/supabaseService', () => ({ isConnected: () => false, ... }))` → component chỉ đọc localStorage.
  - `vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: {...} }), canEditDept: ... }))` — phải re-export đủ helper component dùng (`canEditDept`/`canViewAll`/…).
  - Bọc trong `<MemoryRouter>` nếu component dùng `useNavigate`/`useSearchParams`/`useParams`.
  - Seed dữ liệu qua `localStorage.setItem('output_diem', …)` rồi assert; `mockLogin` qua `vi.hoisted` cho mock hoisting.
- Chưa cài `@testing-library/user-event` → dùng `fireEvent`. Tên NV hiển thị ở nhiều nơi (biểu đồ + bảng) → dùng `getAllByText`/`findAllByText`.

### Thêm test mới
1. Tạo file `src/__tests__/<module>.test.js` (logic) hoặc `.test.jsx` (component)
2. Import từ module gốc, viết `describe`/`it` bình thường (Vitest globals enabled)
3. Nếu cần localStorage: đã có sẵn mock từ setup.js, chỉ cần `localStorage.clear()` trong `beforeEach`
4. Chạy `npm run test` + `npm run lint` để verify

### Coverage hiện tại (125 test cases)
| Module | Test cases | Chức năng chính được cover |
|---|---|---|
| `kpiScore.js` | 30 | Tính điểm KPI (cao/thấp tốt, giảm trừ, maxPct), xếp loại, tính điểm phòng/cá nhân |
| `store.js` | 42 | CRUD thư viện, ID gen, Input/Output, Snapshot, Lock, MonthNotes; **trọng số tự động**: recomputeKpiPctForNhom (priority/null/fixed/w_max binding/custom override), recomputeAllKpiPct (nhiều nhóm CV), computeNvWeights |
| `calcService.js` | 4 | calcMonth manual/auto, merge output, edge case không input |
| `navGuard.js` | 7 | Guard set/clear, safePrefix, confirm dialog |
| `sortConfig.jsx` | 7 | Format tháng (range, dedup, multi-year) |
| `ImportConfirmModal.jsx` | 9 | Render theo trạng thái (themMoi/capNhat/preview/warning), nhãn nút, callback |
| `YearMonthPicker.jsx` | 8 | Options năm/tháng theo dữ liệu, đổi năm/tháng → onChange, defaultThang |
| `LoginPage.jsx` | 3 | Validate rỗng, gọi login (email trim), hiển thị lỗi |
| `Dashboard.jsx` | 3 | Empty state, render bảng + thống kê từ output_diem, NV chưa có điểm |
| `KpiInputModule.jsx` (CauHinhXepLoai) | 3 | Render ngưỡng mặc định read-only, validate A+>A>B>C chặn Lưu, save ghi xep_loai_config |
| `WeightManagement.jsx` (ManualWeightGrid) | 3 | Render lưới NV×KPI, Normalize tổng về target, Lưu & Sync ghi `_trong_so` vào input_cn |
| `WeightManagement.jsx` (copyFromMonth) | 2 | **Copy trọng số tự động** giữa các tháng: copy nhóm KPI + cv_priorities (lọc KPI có ở cả 2 tháng), Lưu ghi cv_priorities + kpi_pct (w_max binding) vào trong_so_thang đích |

## Deploy
Cloudflare Pages ← GitHub (private). Build `npm run build`; Root `kpi-tool`; Output `dist`. `public/_redirects` có sẵn cho SPA routing.
