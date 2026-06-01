-- KPI Tool — Supabase PostgreSQL Schema v2.0
-- Thay thế hoàn toàn Google Sheets + Google Apps Script
-- Chạy toàn bộ file này trong Supabase SQL Editor

-- ── Extensions ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Phòng (Departments) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phong (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ma_phong  TEXT UNIQUE NOT NULL,       -- 'pvt', 'pkt', ...
  ten_phong TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Thư viện KPI ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_library (
  id             BIGSERIAL PRIMARY KEY,
  phong_id       UUID NOT NULL REFERENCES phong(id) ON DELETE CASCADE,
  kpi_id         TEXT NOT NULL,
  ten_kpi        TEXT,
  don_vi         TEXT,
  kpi_cap        TEXT CHECK (kpi_cap IN ('ca_nhan', 'phong')),
  upper_gt_lower BOOLEAN DEFAULT TRUE,
  archived_at    TIMESTAMPTZ,
  cach_tinh      TEXT,
  UNIQUE(phong_id, kpi_id)
);

-- ── Thư viện Nhóm KPI ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nhom_library (
  id          BIGSERIAL PRIMARY KEY,
  phong_id    UUID NOT NULL REFERENCES phong(id) ON DELETE CASCADE,
  nhom_id     TEXT NOT NULL,
  ten_nhom    TEXT,
  kpi_cap     TEXT CHECK (kpi_cap IN ('ca_nhan', 'phong')),
  archived_at TIMESTAMPTZ,
  UNIQUE(phong_id, nhom_id)
);

-- ── Nhân viên ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nhan_vien (
  id          BIGSERIAL PRIMARY KEY,
  phong_id    UUID NOT NULL REFERENCES phong(id) ON DELETE CASCADE,
  nv_id       TEXT NOT NULL,
  ho_ten      TEXT,
  archived_at TIMESTAMPTZ,
  UNIQUE(phong_id, nv_id)
);

-- ── Nhóm Công việc ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nhom_cv (
  id          BIGSERIAL PRIMARY KEY,
  phong_id    UUID NOT NULL REFERENCES phong(id) ON DELETE CASCADE,
  nhom_cv_id  TEXT NOT NULL,
  ten_nhom_cv TEXT,
  archived_at TIMESTAMPTZ,
  UNIQUE(phong_id, nhom_cv_id)
);

-- ── Khu vực quản lý ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS khu_vuc (
  id          BIGSERIAL PRIMARY KEY,
  phong_id    UUID NOT NULL REFERENCES phong(id) ON DELETE CASCADE,
  kv_id       TEXT NOT NULL,
  ten_kv      TEXT,
  archived_at TIMESTAMPTZ,
  UNIQUE(phong_id, kv_id)
);

-- ── Config Store ──────────────────────────────────────────────────
-- Thay thế CONFIG_Store trên Google Sheets
-- Lưu snapshot, template refs, config per-tháng dạng JSONB
CREATE TABLE IF NOT EXISTS config_store (
  id         BIGSERIAL PRIMARY KEY,
  phong_id   UUID NOT NULL REFERENCES phong(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(phong_id, key)
);

-- ── Nhập liệu KPI cá nhân ────────────────────────────────────────
-- Thay thế các sheet INPUT_CN_YYYY-MM
-- Chuẩn hóa: 1 row per (phong, thang, nv, kpi)
CREATE TABLE IF NOT EXISTS input_cn (
  id           BIGSERIAL PRIMARY KEY,
  phong_id     UUID NOT NULL REFERENCES phong(id) ON DELETE CASCADE,
  thang        TEXT NOT NULL,        -- 'YYYY-MM'
  nv_id        TEXT NOT NULL,
  kpi_id       TEXT NOT NULL,
  value_input  NUMERIC,
  upper_input  NUMERIC,
  lower_input  NUMERIC,
  trong_so     NUMERIC,
  max_pct      NUMERIC DEFAULT 100,
  giam_tru     NUMERIC DEFAULT 100,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(phong_id, thang, nv_id, kpi_id)
);

-- ── Metadata NV per tháng ─────────────────────────────────────────
-- Lưu ho_ten, nhom_cv, khu_vuc của NV cho từng tháng cụ thể
CREATE TABLE IF NOT EXISTS input_cn_nv (
  id       BIGSERIAL PRIMARY KEY,
  phong_id UUID NOT NULL REFERENCES phong(id) ON DELETE CASCADE,
  thang    TEXT NOT NULL,
  nv_id    TEXT NOT NULL,
  ho_ten   TEXT,
  nhom_cv  TEXT,
  khu_vuc  TEXT,
  UNIQUE(phong_id, thang, nv_id)
);

-- ── Kết quả điểm tổng ────────────────────────────────────────────
-- Thay thế sheet OUTPUT_DiemTong
CREATE TABLE IF NOT EXISTS output_diem (
  id                  BIGSERIAL PRIMARY KEY,
  phong_id            UUID NOT NULL REFERENCES phong(id) ON DELETE CASCADE,
  thang               TEXT NOT NULL,
  nv_id               TEXT NOT NULL,
  ho_ten              TEXT,
  nhom_cv             TEXT,
  khu_vuc             TEXT,
  diem_phong_dong_gop NUMERIC,
  diem_ca_nhan        NUMERIC,
  tong_diem           NUMERIC,
  xep_loai            TEXT,
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(phong_id, thang, nv_id)
);

-- ── Kết quả chi tiết ─────────────────────────────────────────────
-- Thay thế sheet OUTPUT_ChiTiet
CREATE TABLE IF NOT EXISTS output_chitiet (
  id               BIGSERIAL PRIMARY KEY,
  phong_id         UUID NOT NULL REFERENCES phong(id) ON DELETE CASCADE,
  thang            TEXT NOT NULL,
  nv_id            TEXT NOT NULL,
  kpi_id           TEXT NOT NULL,
  lower_val        NUMERIC,
  upper_val        NUMERIC,
  value_val        NUMERIC,
  max_pct          NUMERIC,
  weight_tho       NUMERIC,
  weight_tuong_doi NUMERIC,
  giam_tru         NUMERIC,
  pct_th           NUMERIC,
  diem_quy_doi     NUMERIC,
  UNIQUE(phong_id, thang, nv_id, kpi_id)
);

-- ── Indexes (performance) ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kpi_library_phong       ON kpi_library(phong_id);
CREATE INDEX IF NOT EXISTS idx_nhom_library_phong      ON nhom_library(phong_id);
CREATE INDEX IF NOT EXISTS idx_nhan_vien_phong         ON nhan_vien(phong_id);
CREATE INDEX IF NOT EXISTS idx_nhom_cv_phong           ON nhom_cv(phong_id);
CREATE INDEX IF NOT EXISTS idx_khu_vuc_phong           ON khu_vuc(phong_id);
CREATE INDEX IF NOT EXISTS idx_config_store_phong_key  ON config_store(phong_id, key);
CREATE INDEX IF NOT EXISTS idx_input_cn_phong_thang    ON input_cn(phong_id, thang);
CREATE INDEX IF NOT EXISTS idx_input_cn_nv_phong_thang ON input_cn_nv(phong_id, thang);
CREATE INDEX IF NOT EXISTS idx_output_diem_thang       ON output_diem(phong_id, thang);
CREATE INDEX IF NOT EXISTS idx_output_ct_thang         ON output_chitiet(phong_id, thang);

-- ── Row Level Security ────────────────────────────────────────────
-- Phase 1: Cho phép tất cả (dùng anon key, không cần auth)
-- Phase 2 (sau): Thêm Supabase Auth và policy theo user/phong_id

ALTER TABLE phong          ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_library    ENABLE ROW LEVEL SECURITY;
ALTER TABLE nhom_library   ENABLE ROW LEVEL SECURITY;
ALTER TABLE nhan_vien      ENABLE ROW LEVEL SECURITY;
ALTER TABLE nhom_cv        ENABLE ROW LEVEL SECURITY;
ALTER TABLE khu_vuc        ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_store   ENABLE ROW LEVEL SECURITY;
ALTER TABLE input_cn       ENABLE ROW LEVEL SECURITY;
ALTER TABLE input_cn_nv    ENABLE ROW LEVEL SECURITY;
ALTER TABLE output_diem    ENABLE ROW LEVEL SECURITY;
ALTER TABLE output_chitiet ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_phong"          ON phong          FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_kpi_library"    ON kpi_library    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_nhom_library"   ON nhom_library   FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_nhan_vien"      ON nhan_vien      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_nhom_cv"        ON nhom_cv        FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_khu_vuc"        ON khu_vuc        FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_config_store"   ON config_store   FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_input_cn"       ON input_cn       FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_input_cn_nv"    ON input_cn_nv    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_output_diem"    ON output_diem    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_output_chitiet" ON output_chitiet FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── Phòng mặc định (thêm phòng của bạn tại đây) ─────────────────
-- Sau khi chạy schema, chạy lệnh này để tạo phòng:
-- INSERT INTO phong (ma_phong, ten_phong) VALUES ('pvt', 'Phòng Viễn thông') RETURNING id;
-- Copy UUID id trả về vào ô "Phòng ID" trong Cài đặt của app
