import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock AuthContext.useAuth để cô lập LoginPage khỏi Supabase
const { mockLogin } = vi.hoisted(() => ({ mockLogin: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

import LoginPage from '../components/LoginPage';

const typeInto = (placeholder, value) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

describe('LoginPage', () => {
  beforeEach(() => {
    mockLogin.mockReset();
  });

  it('hiển thị lỗi khi submit mà chưa nhập đủ email/mật khẩu', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /Đăng nhập/ }));
    expect(screen.getByText(/Vui lòng nhập email và mật khẩu/)).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('gọi login với email đã trim và mật khẩu khi submit hợp lệ', async () => {
    mockLogin.mockResolvedValueOnce();
    render(<LoginPage />);
    typeInto('name@example.com', '  user@test.com  ');
    typeInto('••••••••', 'secret');
    fireEvent.click(screen.getByRole('button', { name: /Đăng nhập/ }));
    await waitFor(() =>
      expect(mockLogin).toHaveBeenCalledWith('user@test.com', 'secret')
    );
  });

  it('hiển thị thông báo lỗi khi login thất bại', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Sai mật khẩu'));
    render(<LoginPage />);
    typeInto('name@example.com', 'user@test.com');
    typeInto('••••••••', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: /Đăng nhập/ }));
    expect(await screen.findByText(/Sai mật khẩu/)).toBeInTheDocument();
  });
});
