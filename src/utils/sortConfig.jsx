// Shared sort hook và format utility — dùng bởi KPIManagement, KpiInputModule, DanhSachNV.

import { useState } from 'react';

/**
 * Hook quản lý trạng thái sort cho bảng dữ liệu.
 * @param {string} defaultKey - Key sort mặc định
 * @param {'asc'|'desc'} defaultDir - Hướng sort mặc định
 * @returns {{ sortKey, sortDir, handleSort, sortIcon, thCls, sortItems }}
 *   sortItems(items, getters?) — getters: { [key]: item => value } để custom extract
 */
export function useSortConfig(defaultKey, defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sortIcon = key => sortKey === key
    ? <span className="ml-0.5 text-blue-500">{sortDir === 'asc' ? '↑' : '↓'}</span>
    : <span className="ml-0.5 text-slate-300">↕</span>;

  const thCls = key => `th cursor-pointer select-none whitespace-nowrap ${sortKey === key ? 'text-blue-600' : ''}`;

  const sortItems = (items, getters = {}) => {
    const getter = getters[sortKey] ?? (item => { const v = item[sortKey]; return typeof v === 'string' ? v : (v ?? ''); });
    return [...items].sort((a, b) => {
      const av = getter(a), bv = getter(b);
      const cmp = typeof av === 'string'
        ? av.localeCompare(bv, 'vi', { sensitivity: 'base' })
        : (av < bv ? -1 : av > bv ? 1 : 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  };

  return { sortKey, sortDir, handleSort, sortIcon, thCls, sortItems };
}

/**
 * Format danh sách tháng thành dạng compact: "2026: T1→T3, T5"
 * @param {string[]} months - Mảng tháng "YYYY-MM"
 * @returns {string|null}
 */
export function formatUsedMonths(months) {
  if (!months || months.length === 0) return null;
  const byYear = {};
  months.forEach(m => {
    const [y, mo] = m.split('-');
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(parseInt(mo));
  });
  return Object.keys(byYear).sort().map(year => {
    const ms = [...new Set(byYear[year])].sort((a, b) => a - b);
    const parts = [];
    let s = ms[0], e = ms[0];
    for (let i = 1; i < ms.length; i++) {
      if (ms[i] === e + 1) { e = ms[i]; }
      else { parts.push(s === e ? `T${s}` : `T${s}→T${e}`); s = e = ms[i]; }
    }
    parts.push(s === e ? `T${s}` : `T${s}→T${e}`);
    return `${year}: ${parts.join(', ')}`;
  }).join('\n');
}
