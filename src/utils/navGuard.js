// Module-level nav guard — dùng vì useBlocker không hoạt động với <BrowserRouter>.
// Components gọi setNavGuard(msg) khi bắt đầu edit, clearNavGuard() khi save/cancel.
// Layout.jsx gọi checkNavGuard() trước mọi programmatic navigation và NavLink click.

let _guard = null;

export function setNavGuard(msg) { _guard = msg; }
export function clearNavGuard() { _guard = null; }

/** Trả về true nếu được phép navigate (không có guard, hoặc user xác nhận thoát). */
export function checkNavGuard() {
  if (!_guard) return true;
  return window.confirm(_guard);
}
