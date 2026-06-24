import { describe, it, expect } from 'vitest';
import { formatUsedMonths } from '../utils/sortConfig';

describe('formatUsedMonths', () => {
  it('returns null for empty/null input', () => {
    expect(formatUsedMonths(null)).toBeNull();
    expect(formatUsedMonths([])).toBeNull();
  });

  it('formats single month', () => {
    expect(formatUsedMonths(['2026-03'])).toBe('2026: T3');
  });

  it('formats consecutive months as range', () => {
    expect(formatUsedMonths(['2026-01', '2026-02', '2026-03'])).toBe('2026: T1→T3');
  });

  it('formats non-consecutive months separately', () => {
    expect(formatUsedMonths(['2026-01', '2026-03', '2026-05'])).toBe('2026: T1, T3, T5');
  });

  it('formats mixed consecutive and non-consecutive', () => {
    const result = formatUsedMonths(['2026-01', '2026-02', '2026-03', '2026-05', '2026-07', '2026-08']);
    expect(result).toBe('2026: T1→T3, T5, T7→T8');
  });

  it('groups by year', () => {
    const result = formatUsedMonths(['2025-11', '2025-12', '2026-01']);
    expect(result).toContain('2025:');
    expect(result).toContain('2026:');
  });

  it('deduplicates months', () => {
    expect(formatUsedMonths(['2026-01', '2026-01'])).toBe('2026: T1');
  });
});
