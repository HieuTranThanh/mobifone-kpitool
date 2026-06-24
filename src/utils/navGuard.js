// Module-level nav guard — dùng vì useBlocker không hoạt động với <BrowserRouter>.
// Components gọi setNavGuard(msg, safePrefix?) khi bắt đầu edit, clearNavGuard() khi save/cancel.
// Layout.jsx gọi checkNavGuard(to?) trước mọi programmatic navigation và NavLink click.

let _guard = null;
let _safePrefix = null;

export function setNavGuard(msg, safePrefix = null) { _guard = msg; _safePrefix = safePrefix; }
export function clearNavGuard() { _guard = null; _safePrefix = null; }

/**
 * Trả về true nếu được phép navigate.
 * - Không có guard → luôn cho qua.
 * - Destination bắt đầu bằng safePrefix → cho qua (intra-menu navigation).
 * - Còn lại → hiện confirm; nếu user OK thì clear guard và cho qua.
 */
export function checkNavGuard(to = null) {
  if (!_guard) return true;
  if (to && _safePrefix && to.startsWith(_safePrefix)) return true;
  const ok = window.confirm(_guard);
  if (ok) clearNavGuard();
  return ok;
}
