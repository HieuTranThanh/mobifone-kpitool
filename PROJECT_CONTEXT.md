# KPI Tool — Project Context (Quick Start)

**Đọc file này khi bắt đầu chat mới. Chi tiết đầy đủ trong `CLAUDE.md`.**

## Tóm tắt project
Web app chấm KPI cá nhân hàng tháng — MobiFone Đắk Lắk, 19 NV, thay Excel 27 sheet.  
Stack: React 19 + Vite 8 + Tailwind v3 + Supabase PostgreSQL + `<BrowserRouter>` (react-router-dom v7).  
Deploy: Cloudflare Pages ← GitHub. Dev: `cd kpi-tool && npm run dev` → localhost:5173.

## Kiến trúc cốt lõi
- **Supabase = nguồn sự thật; localStorage = cache** (xóa không mất data)
- Auth: Supabase email/password + bảng `app_users` (role + phong_id)
- 4 roles: `admin` > `department_editor` > `company_viewer` / `department_viewer`
- Multi-phong: data mỗi phòng hoàn toàn độc lập; switch phòng → clear cache → re-fetch
- `src/config.js`: SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULT_PHONG_ID (hardcoded)

## Files chính
| File | Vai trò |
|---|---|
| `src/services/supabaseService.js` | Tất cả Supabase ops + auth |
| `src/services/store.js` | localStorage R/W + local computation |
| `src/services/calcService.js` | Tính điểm local |
| `src/contexts/AuthContext.jsx` | Auth state + guards + ROLE_LABELS |
| `src/components/Layout.jsx` | Layout + PhongSwitcher + loadData() |
| `src/components/WeightManagement.jsx` | Quản lý trọng số (edit/save mode) |
| `src/components/KpiReport.jsx` | Báo cáo KPI + xuất Excel |

## Trạng thái hiện tại (2026-05-27)

### WeightManagement — đã implement
- Edit/Save mode: default read-only; "✏️ Chỉnh sửa" → editMode → "💾 Lưu & Sync"
- `readOnly` prop truyền xuống tất cả child components (TyLeCap, ModeSelector, NhomKpiPanel, CvConfigPanel)
- Auto-save localStorage debounced 800ms trong editMode (không sync Supabase)
- `beforeunload` handler cảnh báo đóng tab khi unsaved
- Validation fix: KPI priority=null (0đ/"Không tính") là hợp lệ; lỗi chỉ khi KPI chưa add vào nhóm nào

### KpiReport — xuất Excel (đã implement đầy đủ)

**Submenu Báo cáo KPI Phòng (`/baocao/phong`):**
- `exportAllToExcel(thang)`: xuất 1 tháng — KPI Phòng + Tổng hợp NV + sheet từng NV
- `exportPhongAllMonthsToExcel(filteredThangList)`: xuất toàn bộ KPI Phòng theo năm đã chọn
  - Sheet "Tổng hợp KPI Phòng": STT | Tháng | KQ KPI CN (%) | Điểm KPI CN | Điểm KPI Phòng | Tổng điểm | hyperlink
  - Sheets chi tiết: 1 sheet/tháng, cùng layout KPI Phòng (Row A/B/C + nhóm + bảng KPI)
  - Dữ liệu từ `computePhongData()` (localStorage); **không cần fetch Supabase async**
  - Chỉ export tháng có data (`inp` không rỗng); alert nếu không có tháng nào
  - Tên file: `BaoCaoKPI_Phong_YYYY_YYYY-MM-DD.xlsx`
- UI `BaoCaoPhongTab`: dropdown năm + nút "📥 Xuất toàn bộ KPI Phòng năm đã chọn" (căn phải đầu tab)

**Submenu Báo cáo KPI Cá nhân (`/baocao/canhan`), tab Chi tiết:**
- `exportNvAllMonthsToExcel(nvId, hoTen, xepLoaiCfg, filteredThangList)`: xuất toàn bộ KPI của 1 NV theo năm
  - Sheet "Tổng hợp KPI": STT | Tháng | Tên NV | KPI Phòng | KPI Cá nhân | Tổng điểm | Xếp loại | Mức độ HT | hyperlink
  - Sheets chi tiết: 1 sheet/tháng, layout KPI Cá nhân (Row A=phòng, B=cá nhân, C=tổng + nhóm + bảng)
  - **Fetch Supabase async** trước khi export nếu thiếu output_diem / output_chitiet / input_cn
  - `exporting` state → nút hiển thị "⏳ Đang tải..."
  - Tên file: `BaoCaoKPI_NV_{hoTen}_{date}.xlsx`

**Cả hai export đều dùng style giống nhau:**
- Header: bold/white/`1E40AF`; data stripe `F0F9FF`/`FFFFFF`; row A=green, B=blue, C=bold-blue; nhóm=`DBEAFE`

### Known gotcha — router
`useBlocker` (react-router-dom v7) **chỉ hoạt động với data router** (`createBrowserRouter`).  
App đang dùng `<BrowserRouter>` → **không dùng `useBlocker`** → crash.  
Workaround: dùng `window.addEventListener('beforeunload', ...)` cho browser-level warning.

## Các quy tắc quan trọng nhất
1. **Không filter NV theo `active`/`archived_at`** trong tính điểm/nhập liệu/trọng số
2. **Dashboard month picker**: `getThangList()` (có output_diem), không `getSnapshotThangList()`
3. **ROLE_LABELS** trong AuthContext = single source; `ROLE_OPTIONS` phải derive từ đó
4. **Xếp hạng NV**: standard competition (1,1,1,4,5...), không sequential
5. **Sync thư viện lên Supabase qua UI**: ẩn hoàn toàn trong production (localStorage < Supabase)
6. **Edit nhóm KPI trong template/tháng**: chỉ sửa STT (`thu_tu`), không sửa tên nhóm
7. **Export Excel**: nguồn sheet "Tổng hợp NV" = `nvList` (tất cả NV), join outputDiem sau
8. **Export KPI Phòng toàn năm**: dùng `computePhongData()` + localStorage; không fetch Supabase

## localStorage keys quan trọng
- `trong_so_thang_YYYY-MM`: config trọng số (`mode:'manual'/'auto'`)
- `trong_so_weights_YYYY-MM`: weights tính tự động (xóa khi chuyển về manual)
- `kpi_snapshot_YYYY-MM`, `nv_snapshot_YYYY-MM`: snapshot per-month
- `locked_cn_YYYY`, `locked_phong_YYYY`: trạng thái chốt `{"YYYY-MM":true}`
- `xep_loai_config`: ngưỡng xếp loại A+/A/B/C/D
- `input_phong_YYYY-MM`: dữ liệu KPI Phòng per-month (trong config_store, load bởi `getAll()`)

## Pending / Known issues
- `useBlocker` in-app navigation warning chưa có (cần migrate sang `createBrowserRouter`)
- Không có feature flag hay pending TODO nào khác

## RLS Supabase setup (một lần khi tạo project mới)
Xem section "RLS setup" trong `CLAUDE.md`.
