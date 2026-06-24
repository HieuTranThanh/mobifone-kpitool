/**
 * @file ImportConfirmModal.jsx
 * @description Modal xác nhận trước khi đẩy dữ liệu nhập Excel lên Supabase.
 * Dùng chung cho 3 menu: Danh sách NV, Quản lý KPI, Nhập liệu KPI.
 *
 * Props:
 *   open              — boolean: hiển thị modal
 *   onClose           — () => void: đóng mà không làm gì
 *   onConfirm         — () => void: xác nhận toàn bộ (cập nhật + thêm mới)
 *   onConfirmAddOnly  — () => void | null: chỉ thêm mới, bỏ qua cập nhật (chỉ có cho import thư viện)
 *   title             — string: tiêu đề modal (ví dụ "Xác nhận nhập Nhân viên")
 *   loaiDuLieu        — string: mô tả loại dữ liệu đang nhập
 *   bangSupabase      — string: tên bảng Supabase sẽ bị ảnh hưởng
 *   thang             — string | null: "YYYY-MM" nếu thao tác theo tháng, null nếu thư viện
 *   themMoi           — number: số mục sẽ được thêm mới
 *   capNhat           — number: số mục sẽ được cập nhật
 *   previewLines      — string[]: danh sách chi tiết thay đổi (tối đa 10 dòng)
 *   warnings          — string[]: cảnh báo thêm hiển thị dưới dạng amber box
 *   confirmLabel      — string | undefined: nhãn nút xác nhận chính
 */
export default function ImportConfirmModal({
  open,
  onClose,
  onConfirm,
  onConfirmAddOnly,
  title,
  loaiDuLieu,
  bangSupabase,
  thang,
  themMoi,
  capNhat,
  previewLines,
  warnings,
  confirmLabel,
}) {
  if (!open) return null;

  const fmtThang = t => {
    if (!t) return null;
    const [y, m] = t.split('-');
    return `Tháng ${parseInt(m)}/${y}`;
  };

  const hasChanges = (themMoi > 0) || (capNhat > 0);

  const mainLabel = confirmLabel
    ?? (onConfirmAddOnly && capNhat > 0 ? '✅ Cập nhật + thêm mới' : '✅ Xác nhận nhập dữ liệu');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h3 className="font-bold text-lg">⚠️ {title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-6 py-4 space-y-4">

          {/* Thông tin thao tác */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm space-y-1.5">
            <div className="flex gap-2">
              <span className="text-blue-500 font-medium w-36 shrink-0">Loại dữ liệu:</span>
              <span className="text-blue-800 font-semibold">{loaiDuLieu}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-blue-500 font-medium w-36 shrink-0">Bảng Supabase:</span>
              <span className="text-blue-800 font-mono text-xs">{bangSupabase}</span>
            </div>
            {thang && (
              <div className="flex gap-2">
                <span className="text-blue-500 font-medium w-36 shrink-0">Tháng KPI:</span>
                <span className="text-blue-800 font-semibold">{fmtThang(thang)}</span>
              </div>
            )}
          </div>

          {/* Tóm tắt thay đổi */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Tóm tắt thao tác</h4>
            {!hasChanges ? (
              <p className="text-slate-500 text-sm italic">Không phát hiện thay đổi nào trong file.</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {themMoi > 0 && (
                  <span className="badge bg-green-100 text-green-800 text-sm px-3 py-1">
                    ➕ Thêm mới: <strong>{themMoi}</strong> mục
                  </span>
                )}
                {capNhat > 0 && (
                  <span className="badge bg-amber-100 text-amber-800 text-sm px-3 py-1">
                    ✏️ Cập nhật: <strong>{capNhat}</strong> mục
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Chi tiết thay đổi */}
          {previewLines?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Chi tiết thay đổi</h4>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 max-h-36 overflow-y-auto text-xs text-slate-700 space-y-0.5 font-mono leading-5">
                {previewLines.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            </div>
          )}

          {/* Cảnh báo */}
          {warnings?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
              {warnings.map((w, i) => (
                <p key={i} className="text-sm text-amber-800">⚠️ {w}</p>
              ))}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-3 sticky bottom-0 bg-white flex-wrap">
          <button className="btn-secondary" onClick={onClose}>✕ Hủy</button>
          {onConfirmAddOnly && capNhat > 0 && (
            <button className="btn-secondary" onClick={onConfirmAddOnly}>
              ➕ Chỉ thêm mới
            </button>
          )}
          <button className="btn-primary" onClick={onConfirm}>
            {mainLabel}
          </button>
        </div>

      </div>
    </div>
  );
}
