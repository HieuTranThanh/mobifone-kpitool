/* eslint-disable react-refresh/only-export-components */
/**
 * @file YearMonthPicker.jsx
 * @description Component chọn năm + tháng dùng chung cho tất cả menu.
 *
 * PROPS:
 * - thangList: string[] — danh sách tháng có dữ liệu, format "YYYY-MM"
 * - value: string — tháng đang chọn "YYYY-MM"
 * - onChange(thang): callback khi người dùng đổi tháng
 *
 * EXPORT PHỤ:
 * - defaultThang(list): trả về tháng mặc định — ưu tiên tháng hiện tại nếu có trong list.
 */
// Chọn năm + tháng thống nhất, mặc định hiển thị tháng/năm hiện tại nếu có trong danh sách
export default function YearMonthPicker({ thangList = [], value, onChange, className = '' }) {
  const now   = new Date();
  const nowY  = now.getFullYear();
  const nowM  = now.getMonth() + 1;

  const allYears = [...new Set(thangList.map(t => parseInt(t.slice(0, 4))))].sort().reverse();
  const curY     = value ? parseInt(value.slice(0, 4)) : nowY;
  const curM     = value ? parseInt(value.slice(5, 7)) : nowM;

  const monthsForYear = yr =>
    thangList.filter(t => t.startsWith(String(yr) + '-')).map(t => parseInt(t.slice(5))).sort((a, b) => b - a);

  const availMonths = monthsForYear(curY);

  const handleYear = newY => {
    const yr     = parseInt(newY);
    const months = monthsForYear(yr);
    const m      = months.includes(curM) ? curM : (months[0] || nowM);
    onChange(`${yr}-${String(m).padStart(2, '0')}`);
  };
  const handleMonth = newM => onChange(`${curY}-${String(newM).padStart(2, '0')}`);

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <select className="input w-24 text-sm" value={curY}
        onChange={e => handleYear(e.target.value)}>
        {allYears.length
          ? allYears.map(y => <option key={y} value={y}>{y}</option>)
          : <option value={nowY}>{nowY}</option>}
      </select>
      <select className="input w-24 text-sm" value={curM}
        onChange={e => handleMonth(parseInt(e.target.value))}>
        {availMonths.length
          ? availMonths.map(m => <option key={m} value={m}>Tháng {m}</option>)
          : <option value={curM}>Tháng {curM}</option>}
      </select>
    </div>
  );
}

// Trả về thang mặc định: ưu tiên tháng hiện tại nếu có trong list, fallback về phần tử đầu tiên
export function defaultThang(list) {
  const now   = new Date();
  const curT  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return list.includes(curT) ? curT : (list[0] || curT);
}
