import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setNavGuard, clearNavGuard, checkNavGuard } from '../utils/navGuard';

describe('navGuard', () => {
  beforeEach(() => {
    clearNavGuard();
    vi.restoreAllMocks();
  });

  it('allows navigation when no guard is set', () => {
    expect(checkNavGuard()).toBe(true);
    expect(checkNavGuard('/some/path')).toBe(true);
  });

  it('blocks navigation when guard is set and user cancels', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setNavGuard('Bạn có muốn rời đi?');
    expect(checkNavGuard()).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith('Bạn có muốn rời đi?');
  });

  it('allows navigation when guard is set and user confirms', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setNavGuard('Bạn có muốn rời đi?');
    expect(checkNavGuard()).toBe(true);
    expect(checkNavGuard('/another')).toBe(true);
  });

  it('clears guard after user confirms', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setNavGuard('Warning');
    checkNavGuard();
    expect(checkNavGuard()).toBe(true);
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it('allows intra-menu navigation with safePrefix', () => {
    setNavGuard('Warning', '/trong-so');
    expect(checkNavGuard('/trong-so/step2')).toBe(true);
  });

  it('blocks cross-menu navigation even with safePrefix', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setNavGuard('Warning', '/trong-so');
    expect(checkNavGuard('/dashboard')).toBe(false);
  });

  it('clearNavGuard removes guard completely', () => {
    setNavGuard('Warning');
    clearNavGuard();
    expect(checkNavGuard()).toBe(true);
  });
});
