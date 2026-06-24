# KPI Tool — Quick Start (đọc khi mở chat mới)

Chi tiết đầy đủ: [`CLAUDE.md`](CLAUDE.md). File này chỉ là bootstrap.

## Là gì
Web app chấm KPI cá nhân hàng tháng — MobiFone Đắk Lắk (19 NV), thay Excel 27 sheet.
Stack: React 19 + Vite 8 + Tailwind v3 + Supabase PostgreSQL + `<BrowserRouter>` (react-router-dom v7).
Deploy: Cloudflare Pages ← GitHub. Dev: `cd kpi-tool && npm run dev` → :5173.

## Kiến trúc cốt lõi
- **Supabase = nguồn sự thật; localStorage = cache** (xóa không mất data)
- Auth: Supabase email/pw + bảng `app_users` (role + phong_id). 4 roles: admin > department_editor > branch_viewer/department_viewer
- Multi-phòng độc lập; switch phòng → clear cache → re-fetch
- `src/config.js`: SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULT_PHONG_ID (hardcoded)

## Files chính
| File | Vai trò |
|---|---|
| `services/supabaseService.js` | Supabase ops + auth |
| `services/store.js` | localStorage R/W + local compute + logic "đủ dữ liệu" |
| `services/calcService.js` | Tính điểm local |
| `contexts/AuthContext.jsx` | Auth state + guards + ROLE_LABELS |
| `components/Layout.jsx` | Layout + PhongSwitcher + loadData() |
| `components/WeightManagement.jsx` | Trọng số (edit/save mode) |
| `components/KpiReport.jsx` | Báo cáo + xuất Excel |

## Quy tắc bất biến (đừng vi phạm)
1. KHÔNG filter NV theo `active`/`archived_at` trong tính điểm/nhập liệu/trọng số
2. Logic "đủ dữ liệu" chỉ từ `store.js` (`getInputCNStatus`/`getInputPhongStatus`/`computePhongInputStatus`) — chưa đủ → `xep_loai=null`
3. Dashboard month picker = `getThangList()` (không `getSnapshotThangList()`)
4. `ROLE_LABELS` (AuthContext) = single source; `ROLE_OPTIONS` derive từ đó
5. Xếp hạng NV: standard competition (1,1,1,4…), không sequential
6. Edit nhóm KPI trong template/tháng: chỉ sửa STT (`thu_tu`), không sửa tên nhóm
7. Export "Tổng hợp NV" nguồn = `nvList` (tất cả NV) join outputDiem; KPI Phòng toàn năm dùng `computePhongData()`+localStorage (không fetch Supabase)
8. Sync thư viện lên Supabase qua UI: ẩn hoàn toàn trong production

## Known gotcha — router
`useBlocker` (react-router-dom v7) chỉ chạy với data router (`createBrowserRouter`). App dùng `<BrowserRouter>` → KHÔNG dùng `useBlocker` (crash). In-app nav warning workaround: `utils/navGuard.js` singleton + Layout intercept; tab/refresh warning: `beforeunload`.

## Testing
```bash
npm run test     # Vitest — 125 tests: unit (kpiScore, store, calcService, navGuard, sortConfig) + component (ImportConfirmModal, YearMonthPicker, LoginPage, Dashboard, KpiInputModule, WeightManagement)
npm run lint     # ESLint
npm run build    # production build
```
Sau khi sửa code: chạy `npm run test && npm run lint && npm run build` — cả 3 phải PASS. Chi tiết: xem section "Testing" trong `CLAUDE.md`.

## Pending / known issues
- In-app nav warning chuẩn cần migrate sang `createBrowserRouter` (hiện workaround navGuard). Không còn TODO/feature flag nào khác.

## RLS Supabase (1 lần khi tạo project mới)
Xem section "RLS setup" trong `CLAUDE.md`.
