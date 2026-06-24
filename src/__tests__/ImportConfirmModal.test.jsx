import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImportConfirmModal from '../components/ImportConfirmModal';

// Props tối thiểu để modal hiển thị
const baseProps = {
  open: true,
  onClose: () => {},
  onConfirm: () => {},
  title: 'Xác nhận nhập Nhân viên',
  loaiDuLieu: 'Thư viện nhân viên',
  bangSupabase: 'nhan_vien',
  thang: null,
  themMoi: 0,
  capNhat: 0,
  previewLines: [],
  warnings: [],
};

describe('ImportConfirmModal', () => {
  it('không render gì khi open=false', () => {
    const { container } = render(<ImportConfirmModal {...baseProps} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hiển thị tiêu đề, loại dữ liệu và bảng Supabase', () => {
    render(<ImportConfirmModal {...baseProps} />);
    expect(screen.getByText(/Xác nhận nhập Nhân viên/)).toBeInTheDocument();
    expect(screen.getByText('Thư viện nhân viên')).toBeInTheDocument();
    expect(screen.getByText('nhan_vien')).toBeInTheDocument();
  });

  it('hiển thị "không phát hiện thay đổi" khi themMoi và capNhat đều 0', () => {
    render(<ImportConfirmModal {...baseProps} />);
    expect(screen.getByText(/Không phát hiện thay đổi nào/)).toBeInTheDocument();
  });

  it('hiển thị badge thêm mới và cập nhật theo số lượng', () => {
    render(<ImportConfirmModal {...baseProps} themMoi={3} capNhat={2} />);
    expect(screen.getByText(/Thêm mới:/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/Cập nhật:/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('định dạng tháng "YYYY-MM" thành "Tháng M/YYYY"', () => {
    render(<ImportConfirmModal {...baseProps} thang="2026-06" />);
    expect(screen.getByText('Tháng 6/2026')).toBeInTheDocument();
  });

  it('render previewLines và warnings', () => {
    render(
      <ImportConfirmModal
        {...baseProps}
        capNhat={1}
        previewLines={['• [NV_001] tên: "A" → "B"']}
        warnings={['Cảnh báo cascade dữ liệu']}
      />
    );
    expect(screen.getByText('• [NV_001] tên: "A" → "B"')).toBeInTheDocument();
    expect(screen.getByText(/Cảnh báo cascade dữ liệu/)).toBeInTheDocument();
  });

  it('gọi onConfirm và onClose khi bấm nút tương ứng', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ImportConfirmModal {...baseProps} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByText('✕ Hủy'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('✅ Xác nhận nhập dữ liệu'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('hiển thị nút "Chỉ thêm mới" chỉ khi có onConfirmAddOnly và capNhat>0', () => {
    const onConfirmAddOnly = vi.fn();
    const { rerender } = render(
      <ImportConfirmModal {...baseProps} capNhat={2} onConfirmAddOnly={onConfirmAddOnly} />
    );
    const btn = screen.getByText('➕ Chỉ thêm mới');
    fireEvent.click(btn);
    expect(onConfirmAddOnly).toHaveBeenCalledTimes(1);
    // Nhãn nút chính đổi thành "Cập nhật + thêm mới"
    expect(screen.getByText('✅ Cập nhật + thêm mới')).toBeInTheDocument();

    // capNhat=0 → không có nút "Chỉ thêm mới"
    rerender(<ImportConfirmModal {...baseProps} capNhat={0} onConfirmAddOnly={onConfirmAddOnly} />);
    expect(screen.queryByText('➕ Chỉ thêm mới')).not.toBeInTheDocument();
  });

  it('ưu tiên confirmLabel khi được truyền', () => {
    render(<ImportConfirmModal {...baseProps} confirmLabel="✅ Nhãn tùy chỉnh" />);
    expect(screen.getByText('✅ Nhãn tùy chỉnh')).toBeInTheDocument();
  });
});
