import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import YearMonthPicker, { defaultThang } from '../components/YearMonthPicker';

const curThang = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

describe('YearMonthPicker', () => {
  const thangList = ['2026-03', '2026-01', '2025-12'];

  it('render 2 select (năm + tháng)', () => {
    const { container } = render(
      <YearMonthPicker thangList={thangList} value="2026-03" onChange={() => {}} />
    );
    const selects = container.querySelectorAll('select');
    expect(selects).toHaveLength(2);
  });

  it('liệt kê các năm duy nhất giảm dần', () => {
    render(<YearMonthPicker thangList={thangList} value="2026-03" onChange={() => {}} />);
    expect(screen.getByRole('option', { name: '2026' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2025' })).toBeInTheDocument();
  });

  it('chỉ liệt kê các tháng có dữ liệu của năm đang chọn (giảm dần)', () => {
    render(<YearMonthPicker thangList={thangList} value="2026-03" onChange={() => {}} />);
    expect(screen.getByRole('option', { name: 'Tháng 3' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Tháng 1' })).toBeInTheDocument();
    // Tháng 2/2026 không có dữ liệu → không xuất hiện
    expect(screen.queryByRole('option', { name: 'Tháng 2' })).not.toBeInTheDocument();
    // Tháng 12 thuộc 2025 → không thuộc năm 2026 đang chọn
    expect(screen.queryByRole('option', { name: 'Tháng 12' })).not.toBeInTheDocument();
  });

  it('đổi tháng gọi onChange với "YYYY-MM" đúng', () => {
    const onChange = vi.fn();
    const { container } = render(
      <YearMonthPicker thangList={thangList} value="2026-03" onChange={onChange} />
    );
    const monthSelect = container.querySelectorAll('select')[1];
    fireEvent.change(monthSelect, { target: { value: '1' } });
    expect(onChange).toHaveBeenCalledWith('2026-01');
  });

  it('đổi năm sang năm không có tháng hiện tại → chọn tháng đầu tiên của năm mới', () => {
    const onChange = vi.fn();
    const { container } = render(
      <YearMonthPicker thangList={thangList} value="2026-03" onChange={onChange} />
    );
    const yearSelect = container.querySelectorAll('select')[0];
    // 2025 chỉ có tháng 12; curM=3 không có → fallback về 12
    fireEvent.change(yearSelect, { target: { value: '2025' } });
    expect(onChange).toHaveBeenCalledWith('2025-12');
  });
});

describe('defaultThang', () => {
  it('trả về tháng hiện tại nếu có trong danh sách', () => {
    const cur = curThang();
    expect(defaultThang([cur, '2020-01'])).toBe(cur);
  });

  it('trả về phần tử đầu tiên nếu tháng hiện tại không có trong danh sách', () => {
    expect(defaultThang(['2024-05', '2024-04'])).toBe('2024-05');
  });

  it('trả về tháng hiện tại khi danh sách rỗng', () => {
    expect(defaultThang([])).toBe(curThang());
  });
});
