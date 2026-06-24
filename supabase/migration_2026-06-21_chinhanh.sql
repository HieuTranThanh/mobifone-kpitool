-- ════════════════════════════════════════════════════════════════════
-- Migration 2026-06-21 — Đổi thuật ngữ "Công ty" → "Chi nhánh"
-- ════════════════════════════════════════════════════════════════════
-- Chạy TOÀN BỘ file này trong Supabase SQL Editor.
--
-- ⚠️ THỨ TỰ TRIỂN KHAI (bắt buộc): chạy SQL này RỒI deploy code mới NGAY
--    (cùng thời điểm). Code mới check role 'branch_viewer' và ghi key
--    ty_le.phong.chinhanh — phải khớp với dữ liệu sau migration.
--    Nên chạy lúc ít người dùng để tránh khoảng trống quyền truy cập.
--
-- An toàn: chạy lại nhiều lần không gây hại (idempotent). Bọc trong 1
-- transaction — lỗi giữa chừng sẽ rollback toàn bộ.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Role: company_viewer → branch_viewer ─────────────────────────
-- Gỡ CHECK cũ, đổi dữ liệu, thêm CHECK mới (giá trị 'branch_viewer').
-- Nhãn hiển thị "Xem KPI toàn chi nhánh" nằm ở app (ROLE_LABELS), không ở DB.
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;

UPDATE app_users
SET role = 'branch_viewer'
WHERE role = 'company_viewer';

ALTER TABLE app_users
  ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin', 'department_editor', 'branch_viewer', 'department_viewer'));

-- ── 2. Config trọng số: ty_le.phong.cty → ty_le.phong.chinhanh ──────
-- Các bản ghi 'trong_so_thang_YYYY-MM' trong config_store có value JSONB
-- chứa { ty_le: { phong: { cty, phong } } }. Chuyển key cty → chinhanh,
-- GIỮ NGUYÊN giá trị số (không reset tỷ lệ). Chỉ đụng các bản ghi còn key
-- cũ và chưa có key mới.
UPDATE config_store
SET value = jsonb_set(value, '{ty_le,phong,chinhanh}', value #> '{ty_le,phong,cty}', true)
            #- '{ty_le,phong,cty}'
WHERE key LIKE 'trong_so_thang_%'
  AND (value #> '{ty_le,phong}') ? 'cty'
  AND NOT ((value #> '{ty_le,phong}') ? 'chinhanh');

COMMIT;

-- ── 3. Kiểm tra sau migration (chạy riêng, không bắt buộc) ──────────
-- SELECT role, count(*) FROM app_users GROUP BY role;            -- không còn 'company_viewer'
-- SELECT key, value #> '{ty_le,phong}' AS phong_ratio
-- FROM config_store WHERE key LIKE 'trong_so_thang_%';           -- thấy 'chinhanh', không còn 'cty'
