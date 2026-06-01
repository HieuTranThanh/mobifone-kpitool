/**
 * Code.js — GAS Web App chính
 * Deploy: Extensions → Apps Script → Deploy → New deployment
 *   Execute as: Me | Who has access: Anyone  ← PHẢI chọn "Anyone" (không cần tài khoản)
 */

// ── Tên các sheet ────────────────────────────────────────────
var S = {
  KPI_LIB:    'CONFIG_KPI_LIBRARY',
  NHOM_LIB:   'CONFIG_NHOM_LIBRARY',
  CFG_NV:     'CONFIG_NhanVien',
  NHOM_CV_LIB:'CONFIG_NhomCV',
  KV_LIB:     'CONFIG_KhuVuc',
  OUT_DIEM:   'OUTPUT_DiemTong',
  OUT_CT:     'OUTPUT_ChiTiet',
  STORE:      'CONFIG_Store',
};

// ── HTTP handlers ────────────────────────────────────────────

function doGet(e) {
  var p = e.parameter || {};
  var result;
  try {
    switch (p.action) {
      case 'getAll':        result = getAllData();                          break;
      case 'getStore':      result = getStore();                           break;
      case 'calcMonth':     result = calcMonth(p.thang);                   break;
      case 'getOutput':     result = getOutputDiem(p.thang);               break;
      case 'getDetail':     result = getOutputChiTiet(p.thang, p.nv_id);  break;
      case 'getInputPhong': result = getInputPhongData(p.thang);           break;
      case 'getInputCN':    result = getInputCNData(p.thang);              break;
      case 'getThangList':  result = getThangList();                       break;
      case 'getDiemThang':  result = getDiemThang(p.thang);               break;
      case 'deleteMonthSheet': result = deleteMonthSheet(p.thang);        break;
      case 'ping':          result = { ok: true, time: new Date().toISOString() }; break;
      default:              result = { error: 'Unknown action: ' + p.action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return jsonOut(result);
}

function doPost(e) {
  var result;
  try {
    var body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'syncKpiLibrary':   result = syncKpiLibrary(body.data);        break;
      case 'syncNhomLibrary':  result = syncNhomLibrary(body.data);       break;
      case 'syncNV':           result = syncConfigNV(body.data);          break;
      case 'syncNhomCvLibrary': result = syncNhomCvLibrary(body.data);  break;
      case 'syncKvLibrary':    result = syncKvLibrary(body.data);        break;
      case 'syncTrongSo':      result = syncConfigTS(body.data);          break;
      case 'syncWeightConfig': result = syncWeightConfig(body.data);      break;
      case 'syncInputCNRows':  result = syncInputCNRows(body.data);       break;
      case 'syncStore':        result = syncStore(body.data);             break;
      case 'bulkSyncStore':    result = bulkSyncStore(body.data);         break;
      case 'createMonthSheet':    result = createMonthSheetPost(body.data);             break;
      case 'updateInputCNKpis':   result = updateInputCNKpis(body.data);               break;
      case 'updateInputCNNvs':    result = updateInputCNNvs(body.data);                break;
      default: result = { error: 'Unknown action: ' + body.action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return jsonOut(result);
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sheet helpers ────────────────────────────────────────────

function getSheet(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet không tìm thấy: ' + name);
  return sh;
}

function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, 2).setValues([['key', 'json_value']]);
  }
  return sh;
}

function getOrCreateLibrarySheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

// headerRowIndex: row nào chứa machine headers (0-based, default 0)
// dataStartIndex: row nào bắt đầu data (0-based, default headerRowIndex+1)
function sheetToArr(name, headerRowIndex, dataStartIndex) {
  headerRowIndex = headerRowIndex || 0;
  dataStartIndex = (dataStartIndex !== undefined && dataStartIndex !== null) ? dataStartIndex : headerRowIndex + 1;
  var sh = getSheet(name);
  var data = sh.getDataRange().getValues();
  if (data.length <= headerRowIndex) return [];
  var headers = data[headerRowIndex].map(function(h) { return String(h).trim(); });
  return data.slice(dataStartIndex)
    .filter(function(row) { return row.some(function(c) { return c !== '' && c !== null; }); })
    .map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) { if (h) obj[h] = row[i]; });
      return obj;
    });
}

function clearAndWriteSheet(name, headers, rows) {
  var sh = getSheet(name);
  sh.clearContents();
  if (rows.length === 0) { sh.getRange(1,1,1,headers.length).setValues([headers]); return; }
  var all = [headers].concat(rows.map(function(r) {
    return headers.map(function(h) { return r[h] !== undefined ? r[h] : ''; });
  }));
  sh.getRange(1, 1, all.length, headers.length).setValues(all);
}

function sortSheetByCol(sheetName, colIdx) {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sh || sh.getLastRow() <= 1) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn())
      .sort({ column: colIdx, ascending: true });
  } catch(e) {}
}

// ── Library sheet helpers ─────────────────────────────────────

function getKpiLibraryData() {
  try {
    return sheetToArr(S.KPI_LIB);
  } catch (e) {
    return [];
  }
}

function getNhomLibraryData() {
  try {
    return sheetToArr(S.NHOM_LIB);
  } catch (e) {
    return [];
  }
}

// ── getAllData ────────────────────────────────────────────────

function getAllData() {
  var kpiLibrary    = getKpiLibraryData();
  var nhomLibrary   = getNhomLibraryData();
  var nvLibrary     = [];
  var nhomCvLibrary = [];
  var kvLibrary     = [];
  try { nvLibrary     = sheetToArr(S.CFG_NV);      } catch (e) {}
  try { nhomCvLibrary = sheetToArr(S.NHOM_CV_LIB); } catch (e) {}
  try { kvLibrary     = sheetToArr(S.KV_LIB);      } catch (e) {}
  var store = getStore();
  return {
    kpiLibrary:    kpiLibrary,
    nhomLibrary:   nhomLibrary,
    nvLibrary:     nvLibrary,
    nhomCvLibrary: nhomCvLibrary,
    kvLibrary:     kvLibrary,
    store:         store.data,
  };
}

// ── CONFIG_Store handlers ─────────────────────────────────────

function getStore() {
  var sh = getOrCreateSheet(S.STORE);
  var data = sh.getDataRange().getValues();
  var result = {};
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = String(data[i][1]).trim();
    if (!key || key === 'key') continue;
    try { result[key] = JSON.parse(val); } catch (e) { result[key] = val; }
  }
  return { data: result };
}

function syncStore(data) {
  var sh = getOrCreateSheet(S.STORE);
  var all = sh.getDataRange().getValues();
  for (var i = 1; i < all.length; i++) {
    if (String(all[i][0]).trim() === data.key) {
      if (data.value === null) {
        sh.deleteRow(i + 1);
        return { ok: true, key: data.key, action: 'deleted' };
      }
      sh.getRange(i + 1, 2).setValue(JSON.stringify(data.value));
      return { ok: true, key: data.key, action: 'updated' };
    }
  }
  if (data.value !== null) {
    sh.appendRow([data.key, JSON.stringify(data.value)]);
    sortSheetByCol(S.STORE, 1);
    return { ok: true, key: data.key, action: 'created' };
  }
  return { ok: true, key: data.key, action: 'noop' };
}

function bulkSyncStore(data) {
  var entries = data.entries || {};
  var sh = getOrCreateSheet(S.STORE);
  var all = sh.getDataRange().getValues();

  var store = {};
  for (var i = 1; i < all.length; i++) {
    var k = String(all[i][0]).trim();
    if (k && k !== 'key') store[k] = all[i][1];
  }

  Object.keys(entries).forEach(function(key) {
    var value = entries[key];
    if (value === null) delete store[key];
    else store[key] = JSON.stringify(value);
  });

  var sortedKeys = Object.keys(store).sort();
  var rows = [['key', 'json_value']];
  sortedKeys.forEach(function(k) { rows.push([k, store[k]]); });
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 2).setValues(rows);

  return { ok: true, count: Object.keys(entries).length };
}

// ── Library sync handlers ─────────────────────────────────────

function syncKpiLibrary(data) {
  var headers = ['kpi_id', 'ten_kpi', 'don_vi', 'kpi_cap', 'upper_gt_lower', 'archived_at', 'cach_tinh'];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(S.KPI_LIB)) ss.insertSheet(S.KPI_LIB);
  clearAndWriteSheet(S.KPI_LIB, headers, data);
  sortSheetByCol(S.KPI_LIB, 1);
  return { ok: true, rows: data.length };
}

function syncNhomLibrary(data) {
  var headers = ['nhom_id', 'ten_nhom', 'kpi_cap', 'archived_at'];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(S.NHOM_LIB)) ss.insertSheet(S.NHOM_LIB);
  clearAndWriteSheet(S.NHOM_LIB, headers, data);
  sortSheetByCol(S.NHOM_LIB, 1);
  return { ok: true, rows: data.length };
}

// ── GET handlers ─────────────────────────────────────────────

function _safeSheetToArr(name) {
  try { return sheetToArr(name); } catch (e) { return []; }
}

function getOutputDiem(thang) {
  var rows = _safeSheetToArr(S.OUT_DIEM);
  if (thang) rows = rows.filter(function(r) { return r.thang === thang; });
  return { data: rows };
}

function getOutputChiTiet(thang, nv_id) {
  var rows = _safeSheetToArr(S.OUT_CT);
  if (thang)  rows = rows.filter(function(r) { return r.thang === thang; });
  if (nv_id)  rows = rows.filter(function(r) { return r.nv_id === nv_id; });
  return { data: rows };
}

function getInputPhongData(thang) {
  var store = getStore().data || {};
  if (thang) return { data: store['input_phong_' + thang] || null };
  // Trả về tất cả input_phong nếu không truyền thang
  var result = [];
  Object.keys(store).forEach(function(k) {
    if (k.indexOf('input_phong_') === 0 && store[k]) result.push(store[k]);
  });
  return { data: result[0] || null };
}

function getThangList() {
  var diemRows = _safeSheetToArr(S.OUT_DIEM);
  var store    = getStore().data || {};
  var set = {};
  diemRows.forEach(function(r) { if (r.thang) set[_thangStr(r.thang)] = true; });
  // Scan CONFIG_Store cho input_phong_* keys (format mới)
  Object.keys(store).forEach(function(k) {
    if (k.indexOf('input_phong_') === 0) {
      var t = k.replace('input_phong_', '');
      if (t) set[t] = true;
    }
  });
  var list = Object.keys(set).filter(Boolean).sort().reverse();
  return { data: list };
}

// Bundle inputCN + outputDiem + outputChiTiet cho 1 tháng trong 1 request
function getDiemThang(thang) {
  if (!thang) return { inputCN: [], outputDiem: [], outputChiTiet: [] };
  return {
    inputCN:       getInputCNData(thang).data,
    outputDiem:    getOutputDiem(thang).data,
    outputChiTiet: getOutputChiTiet(thang, null).data,
  };
}

// ── POST / Sync handlers ─────────────────────────────────────

function syncConfigNV(data) {
  var headers = ['nv_id', 'ho_ten', 'trang_thai', 'archived_at'];
  var rows = (data || []).map(function(nv) {
    return {
      nv_id:      nv.nv_id,
      ho_ten:     nv.ho_ten,
      trang_thai: nv.archived_at ? 'Đã nghỉ' : 'Đang làm',
      archived_at: nv.archived_at || '',
    };
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(S.CFG_NV)) ss.insertSheet(S.CFG_NV);
  clearAndWriteSheet(S.CFG_NV, headers, rows);
  sortSheetByCol(S.CFG_NV, 1);
  return { ok: true, rows: rows.length };
}

function syncNhomCvLibrary(data) {
  var headers = ['nhom_cv_id', 'ten_nhom_cv', 'archived_at'];
  var rows = (data || []).map(function(item) {
    return { nhom_cv_id: item.nhom_cv_id, ten_nhom_cv: item.ten_nhom_cv, archived_at: item.archived_at || '' };
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(S.NHOM_CV_LIB)) ss.insertSheet(S.NHOM_CV_LIB);
  clearAndWriteSheet(S.NHOM_CV_LIB, headers, rows);
  sortSheetByCol(S.NHOM_CV_LIB, 1);
  return { ok: true, rows: rows.length };
}

function syncKvLibrary(data) {
  var headers = ['kv_id', 'ten_kv', 'archived_at'];
  var rows = (data || []).map(function(item) {
    return { kv_id: item.kv_id, ten_kv: item.ten_kv, archived_at: item.archived_at || '' };
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(S.KV_LIB)) ss.insertSheet(S.KV_LIB);
  clearAndWriteSheet(S.KV_LIB, headers, rows);
  sortSheetByCol(S.KV_LIB, 1);
  return { ok: true, rows: rows.length };
}

function syncConfigTS(data) {
  var nhoms = ['VHKT','Tối ưu','Truyền dẫn','Văn phòng','VHKT+Tối ưu','VHKT+Truyền dẫn','VHKT+PAKH','VHKT+Hạ tầng'];
  var headers = ['kpi_id'].concat(nhoms);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss.getSheetByName('CONFIG_TrongSo')) return { ok: true, skipped: true };
    clearAndWriteSheet('CONFIG_TrongSo', headers, data);
  } catch (e) {}
  return { ok: true, rows: data.length };
}

// Ghi trọng số vào cột _trong_so của sheet INPUT_CN_YYYY-MM
function syncWeightConfig(data) {
  var thang     = data.thang;
  var nvWeights = data.nvWeights;
  if (!thang || !nvWeights) throw new Error('Thiếu thang hoặc nvWeights');

  var sheetName = 'INPUT_CN_' + thang;
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var sh  = ss.getSheetByName(sheetName);
  if (!sh) return { ok: false, error: 'Không tìm thấy sheet ' + sheetName };

  var all = sh.getDataRange().getValues();
  // Row 0: display, Row 1: machine headers, Row 2: sub-headers, Row 3+: data
  if (all.length < 4) return { ok: true, updated: 0 };

  var headers  = all[1].map(function(h) { return String(h).trim(); });
  var nvIdCol  = headers.indexOf('nv_id');
  if (nvIdCol < 0) throw new Error('Không tìm thấy cột nv_id trong ' + sheetName);

  var tsCols = {};
  headers.forEach(function(h, i) {
    if (h.slice(-9) === '_trong_so') tsCols[h.slice(0, -9)] = i;
  });

  var updated = 0;
  for (var r = 3; r < all.length; r++) {
    var nvId   = String(all[r][nvIdCol]);
    var weights = nvWeights[nvId];
    if (!weights) continue;
    Object.keys(weights).forEach(function(kpiId) {
      var col = tsCols[kpiId];
      if (col !== undefined) all[r][col] = weights[kpiId];
    });
    updated++;
  }

  if (updated > 0) {
    var dataRows = all.slice(3);
    sh.getRange(4, 1, dataRows.length, all[0].length).setValues(dataRows);
  }

  return { ok: true, thang: thang, updated: updated };
}

// Ghi kết quả nhập liệu KPI cá nhân vào sheet INPUT_CN_YYYY-MM
// rows: [{nv_id, thang, ho_ten, nhom_cv, khu_vuc, kpi_id_value, kpi_id_upper, ...}]
// Tự động thêm dòng mới nếu nv_id chưa có trong sheet (sheet tạo thiếu NV)
function syncInputCNRows(data) {
  var thang = data.thang;
  var rows  = Array.isArray(data.rows) ? data.rows : [data.rows];
  if (!thang) throw new Error('Thiếu thang');

  var sheetName = 'INPUT_CN_' + thang;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return { ok: false, error: 'Không tìm thấy sheet ' + sheetName };

  var all = sh.getDataRange().getValues();
  // Row 0: display, Row 1: machine headers, Row 2: sub-headers, Row 3+: data
  if (all.length < 3) return { ok: false, error: 'Sheet thiếu header rows' };

  var headers = all[1].map(function(h) { return String(h).trim(); });
  var nvIdCol = headers.indexOf('nv_id');
  if (nvIdCol < 0) throw new Error('Không tìm thấy cột nv_id trong ' + sheetName);

  var dataRows = all.length >= 4 ? all.slice(3) : [];
  var updated = 0;

  rows.forEach(function(row) {
    if (!row || !row.nv_id) return;
    for (var i = 0; i < dataRows.length; i++) {
      if (String(dataRows[i][nvIdCol]).trim() === String(row.nv_id).trim()) {
        Object.keys(row).forEach(function(key) {
          var col = headers.indexOf(key);
          if (col < 0) return;
          var v = row[key];
          // Không ghi đè _trong_so bằng chuỗi rỗng — trọng số được quản lý bởi syncWeightConfig
          if (key.slice(-9) === '_trong_so' && (v === '' || v === null || v === undefined)) return;
          dataRows[i][col] = (v === '' || v === null || v === undefined) ? '' : v;
        });
        updated++;
        break;
      }
    }
    // Không tự thêm row mới — sheet phải được khởi tạo đủ NV qua createMonthTemplate
  });

  if (updated > 0) {
    sh.getRange(4, 1, dataRows.length, all[0].length).setValues(dataRows);
  }
  return { ok: true, thang: thang, updated: updated, total: rows.length };
}

// ── Tự tạo các sheet bắt buộc nếu chưa có ───────────────────

function _ensureIndexSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName('INDEX')) return;
  var sh = ss.insertSheet('INDEX');
  var headers = ['Tháng', 'Link', 'Trạng thái', 'Điểm TB',
    'A+ (Xuất sắc)', 'A (Vượt)', 'B (Đạt)', 'C (Đạt một phần)', 'D (Không đạt)'];
  var hdr = sh.getRange(1, 1, 1, headers.length);
  hdr.setValues([headers]);
  hdr.setFontWeight('bold').setBackground('#1e40af').setFontColor('#ffffff');
}

function _ensureOutputSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(S.OUT_DIEM)) {
    var sh = ss.insertSheet(S.OUT_DIEM);
    sh.getRange(1,1,1,9).setValues([['thang','nv_id','ho_ten','nhom_cv','khu_vuc','diem_phong_dong_gop','diem_ca_nhan','tong_diem','xep_loai']]);
  }
  if (!ss.getSheetByName(S.OUT_CT)) {
    var sh2 = ss.insertSheet(S.OUT_CT);
    sh2.getRange(1,1,1,12).setValues([['thang','nv_id','kpi_id','lower','upper','value','max_pct','weight_tho','weight_tuong_doi','giam_tru','pct_th','diem_quy_doi']]);
  }
}

// ── Tạo sheet tháng mới ──────────────────────────────────────

function createMonthSheetPost(data) {
  var thang   = data.thang;
  var kpiList = data.kpiList || [];
  var nvList  = data.nvList  || [];
  if (!thang) throw new Error('Thiếu tham số thang');
  _ensureIndexSheet();
  _ensureOutputSheets();
  var result = createMonthInputSheet(thang, kpiList, nvList);
  _updateIndex();
  return { ok: true, created: result.created, sheetName: result.sheetName, sheetId: result.sheetId };
}

function createMonthInputSheet(thang, kpiList, nvList) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = 'INPUT_CN_' + thang;
  var sh = ss.getSheetByName(sheetName);
  var created = false;

  if (!sh) {
    sh = ss.insertSheet(sheetName);
    created = true;
  } else {
    sh.clearContents();
  }

  // Chỉ KPI cá nhân, sắp theo stt
  var cnKpis = (kpiList || [])
    .filter(function(k) { return k.kpi_cap === 'ca_nhan'; })
    .sort(function(a, b) { return (parseInt(a.stt) || 0) - (parseInt(b.stt) || 0); });

  var fixedCols   = ['nv_id', 'ho_ten', 'nhom_cv', 'khu_vuc', 'thang'];
  var fixedLabels = ['Mã NV', 'Họ tên', 'Nhóm CV', 'Khu vực', 'Tháng'];

  var displayRow = fixedLabels.slice();
  var machineRow = fixedCols.slice();
  var subRow     = ['', '', '', '', ''];

  cnKpis.forEach(function(kpi) {
    var label = kpi.stt + '. ' + kpi.ten_kpi + ' (' + (kpi.don_vi || '') + ')';
    displayRow.push(label, '', '', '', '', '');
    machineRow.push(
      kpi.kpi_id + '_value',
      kpi.kpi_id + '_upper',
      kpi.kpi_id + '_lower',
      kpi.kpi_id + '_trong_so',
      kpi.kpi_id + '_max_pct',
      kpi.kpi_id + '_giam_tru'
    );
    subRow.push('KQ TH', 'Chỉ tiêu', 'Ngưỡng dưới', 'Trọng số', 'Điểm tối đa', 'Giảm trừ');
  });

  var numCols = machineRow.length;
  if (numCols === 0) return { created: created, sheetName: sheetName, sheetId: sh.getSheetId() };

  sh.getRange(1, 1, 1, numCols).setValues([displayRow]);
  sh.getRange(2, 1, 1, numCols).setValues([machineRow]);
  sh.getRange(3, 1, 1, numCols).setValues([subRow]);

  // Pre-fill NV rows — tất cả NV trong danh sách (kể cả đã nghỉ)
  if ((nvList || []).length > 0) {
    var dataRows = nvList.map(function(nv) {
      var row = fixedCols.map(function(col) {
        if (col === 'thang') return thang;
        return nv[col] !== undefined ? nv[col] : '';
      });
      cnKpis.forEach(function(kpi) {
        row.push('', '', '', '', 100, 100); // value, upper, lower, trong_so, max_pct(%), giam_tru(%)
      });
      return row;
    });
    sh.getRange(4, 1, dataRows.length, numCols).setValues(dataRows);
  }

  return { created: created, sheetName: sheetName, sheetId: sh.getSheetId() };
}

// Đọc dữ liệu nhập KPI cá nhân từ sheet INPUT_CN_YYYY-MM
function getInputCNData(thang) {
  if (!thang) throw new Error('Thiếu tham số thang');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('INPUT_CN_' + thang);
  if (!sh) return { data: [] };
  var rows = sheetToArr('INPUT_CN_' + thang, 1, 3);
  var result = rows
    .filter(function(r) { return r.nv_id; })
    .map(function(r) {
      var obj = { thang: thang };
      Object.keys(r).forEach(function(k) {
        var v = r[k];
        if (k !== 'thang') obj[k] = (v === '' || v === null || v === undefined) ? '' : v;
        else obj[k] = thang;
      });
      return obj;
    });
  return { data: result };
}

function deleteMonthSheet(thang) {
  if (!thang) throw new Error('Thiếu tham số thang');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = 'INPUT_CN_' + thang;
  var sh = ss.getSheetByName(sheetName);
  if (sh) {
    ss.deleteSheet(sh);
    _updateIndex();
    return { ok: true, deleted: true, sheetName: sheetName };
  }
  return { ok: true, deleted: false, sheetName: sheetName };
}

// ── Tính điểm ───────────────────────────────────────────────

function _thangStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM');
  return String(v || '').trim();
}

function calcMonth(thang) {
  if (!thang) throw new Error('Thiếu tham số thang');

  // Đọc snapshot từ CONFIG_Store để lấy KPI list của tháng đó
  var store    = getStore().data;
  var snap     = store['kpi_snapshot_' + thang];
  var kpiList  = [];

  if (snap && snap.kpiRefs && snap.kpiRefs.length > 0) {
    // Format mới: resolve kpiRefs từ CONFIG_KPI_LIBRARY
    var kpiLibrary = getKpiLibraryData();
    var kpiMap = {};
    kpiLibrary.forEach(function(k) { kpiMap[k.kpi_id] = k; });
    kpiList = snap.kpiRefs.map(function(ref) {
      var base = kpiMap[ref.kpi_id];
      if (!base) return null;
      return Object.assign({}, base, { nhom_id: ref.nhom_id, stt: ref.stt, active: true });
    }).filter(Boolean);
  } else if (snap && snap.kpiList) {
    // Format cũ: full objects trong snapshot
    kpiList = snap.kpiList.filter(function(k) { return k.active == true || k.active === 'TRUE'; });
  }

  // Đọc NV library từ CONFIG_NhanVien (chỉ nv_id, ho_ten, archived_at)
  var nvLibrary = sheetToArr(S.CFG_NV);
  var nvLibraryMap = {};
  nvLibrary.forEach(function(n) { nvLibraryMap[n.nv_id] = n; });

  // Ưu tiên snapshot per-month (có nhom_cv, khu_vuc); fallback sang schema cũ
  var nvSnap = store['nv_snapshot_' + thang];
  var nvList;
  if (nvSnap && nvSnap.nvRefs && nvSnap.nvRefs.length > 0) {
    nvList = nvSnap.nvRefs.map(function(ref) {
      var lib = nvLibraryMap[ref.nv_id] || {};
      return { nv_id: ref.nv_id, ho_ten: lib.ho_ten || ref.nv_id, nhom_cv: ref.nhom_cv || '', khu_vuc: ref.khu_vuc || '' };
    });
  } else {
    // Fallback: schema cũ (CONFIG_NhanVien còn đủ cột nhom_cv, khu_vuc, active)
    nvList = nvLibrary.filter(function(n) {
      if ('archived_at' in n && n.archived_at) return false;
      if ('active' in n) return n.active == true || n.active === 'TRUE';
      return true;
    });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  _ensureOutputSheets();

  var cnSheetName = ss.getSheetByName('INPUT_CN_' + thang) ? ('INPUT_CN_' + thang) : null;
  if (!cnSheetName) throw new Error('Không tìm thấy sheet INPUT_CN_' + thang);

  // Đọc pre-computed weights từ CONFIG_Store (ghi bởi WeightManagement auto mode)
  var nvWeightsConfig = store['trong_so_weights_' + thang] || null;

  // Đọc cấu hình ngưỡng xếp loại từ CONFIG_Store
  var xepLoaiConfig = store['xep_loai_config'] || null;

  var inputCN    = sheetToArr(cnSheetName, 1, 3).filter(function(r) { return _thangStr(r.thang) === thang; });
  var inputPhong = store['input_phong_' + thang] || {};

  var inputCNMap = {};
  inputCN.forEach(function(r) { inputCNMap[r.nv_id] = r; });

  var diemPhongTong = _calcDiemPhong(kpiList, inputPhong);

  var outDiem = [];
  var outCT   = [];

  var activeCNKpis = kpiList.filter(function(k) { return k.kpi_cap === 'ca_nhan'; });

  nvList.forEach(function(nv) {
    var row = inputCNMap[nv.nv_id];
    if (!row) return;

    var hasAllRequired;
    if (nvWeightsConfig) {
      // Auto mode: chỉ yêu cầu _value + _upper + _lower cho KPI có weight > 0
      var nvW = nvWeightsConfig[nv.nv_id] || {};
      var weightedKpis = activeCNKpis.filter(function(kpi) { return (nvW[kpi.kpi_id] || 0) > 0; });
      hasAllRequired = weightedKpis.every(function(kpi) {
        return ['_value', '_upper', '_lower'].every(function(suf) {
          var v = row[kpi.kpi_id + suf];
          return v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v));
        });
      });
    } else {
      // Manual mode / fallback: yêu cầu _value + _upper + _lower + _trong_so
      hasAllRequired = activeCNKpis.every(function(kpi) {
        return ['_value', '_upper', '_lower', '_trong_so'].every(function(suf) {
          var v = row[kpi.kpi_id + suf];
          return v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v));
        });
      });
    }
    if (!hasAllRequired) return;

    var res = _calcNV(nv, kpiList, row, diemPhongTong, nvWeightsConfig ? (nvWeightsConfig[nv.nv_id] || {}) : null);

    outDiem.push({
      thang: thang, nv_id: nv.nv_id, ho_ten: nv.ho_ten,
      nhom_cv: nv.nhom_cv, khu_vuc: nv.khu_vuc,
      diem_phong_dong_gop: _r(res.diemPhongDongGop),
      diem_ca_nhan:        _r(res.diemCaNhan),
      tong_diem:           _r(res.tongDiem),
      xep_loai:            _xepLoai(res.tongDiem, xepLoaiConfig),
    });

    res.chiTiet.forEach(function(ct) {
      outCT.push({
        thang: thang, nv_id: nv.nv_id,
        kpi_id: ct.kpi_id, lower: ct.lower, upper: ct.upper, value: ct.value,
        max_pct: ct.max_pct, weight_tho: ct.weight_tho,
        weight_tuong_doi: _r(ct.weight_tuong_doi, 4),
        giam_tru: ct.giam_tru,
        pct_th: _r(ct.pct_th, 4),
        diem_quy_doi: _r(ct.diem_quy_doi, 4),
      });
    });
  });

  _upsertOutput(S.OUT_DIEM,
    ['thang','nv_id','ho_ten','nhom_cv','khu_vuc','diem_phong_dong_gop','diem_ca_nhan','tong_diem','xep_loai'],
    outDiem, thang);

  _upsertOutput(S.OUT_CT,
    ['thang','nv_id','kpi_id','lower','upper','value','max_pct','weight_tho','weight_tuong_doi','giam_tru','pct_th','diem_quy_doi'],
    outCT, thang);

  _updateIndex();

  return {
    ok: true, thang: thang, so_nv: outDiem.length,
    diem_phong: _r(diemPhongTong),
    ket_qua: outDiem,
  };
}

function _updateIndex() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var indexSh = ss.getSheetByName('INDEX');
  if (!indexSh) return;

  var headers = ['Tháng', 'Link', 'Trạng thái', 'Điểm TB',
    'A+ (Xuất sắc)', 'A (Vượt)', 'B (Đạt)', 'C (Đạt một phần)', 'D (Không đạt)'];
  var hdr = indexSh.getRange(1, 1, 1, headers.length);
  hdr.setValues([headers]);
  hdr.setFontWeight('bold').setBackground('#1e40af').setFontColor('#ffffff');

  var ssUrl = ss.getUrl();

  var inputMonths = {};
  ss.getSheets().forEach(function(sh) {
    var m = sh.getName().match(/^INPUT_CN_(\d{4}-\d{2})$/);
    if (m) inputMonths[m[1]] = sh.getSheetId();
  });

  var statsMap = {};
  sheetToArr(S.OUT_DIEM).forEach(function(r) {
    if (!r.thang) return;
    var thangKey = _thangStr(r.thang);
    if (!thangKey) return;
    if (!statsMap[thangKey]) statsMap[thangKey] = { sum: 0, count: 0, 'A+': 0, A: 0, B: 0, C: 0, D: 0 };
    var s = statsMap[thangKey];
    s.sum += parseFloat(r.tong_diem) || 0;
    s.count++;
    if (r.xep_loai) s[r.xep_loai] = (s[r.xep_loai] || 0) + 1;
  });

  var allMonths = {};
  Object.keys(inputMonths).forEach(function(t) { allMonths[t] = true; });
  Object.keys(statsMap).forEach(function(t) { allMonths[t] = true; });
  var sorted = Object.keys(allMonths).sort().reverse();

  var lastRow = indexSh.getLastRow();
  if (lastRow > 1) indexSh.getRange(2, 1, lastRow - 1, 9).clearContent().clearFormat();
  if (!sorted.length) return;

  var dataRows = sorted.map(function(thang) {
    var stat = statsMap[thang];
    return [
      thang, '',
      stat ? 'Đã tính' : 'Chưa tính',
      stat && stat.count ? Math.round(stat.sum / stat.count * 10) / 10 : '',
      stat ? (stat['A+'] || 0) : '', stat ? stat.A : '', stat ? stat.B : '', stat ? stat.C : '', stat ? stat.D : '',
    ];
  });
  indexSh.getRange(2, 1, dataRows.length, 9).setValues(dataRows);

  sorted.forEach(function(thang, i) {
    var row = 2 + i;
    var gid = inputMonths[thang];
    if (gid !== undefined) {
      indexSh.getRange(row, 2).setFormula('=HYPERLINK("' + ssUrl + '#gid=' + gid + '","→ Mở")');
    } else {
      indexSh.getRange(row, 2).setValue('(chưa có)').setFontColor('#9ca3af');
    }
  });

  for (var i = 0; i < sorted.length; i++) {
    indexSh.getRange(2 + i, 1, 1, 9).setBackground(i % 2 === 0 ? '#f0f9ff' : '#ffffff');
  }
  indexSh.getRange(2, 1, sorted.length, 1).setFontWeight('bold');
  sorted.forEach(function(thang, i) {
    var cell = indexSh.getRange(2 + i, 3);
    if (statsMap[thang]) {
      cell.setFontColor('#166534').setFontWeight('bold');
    } else {
      cell.setFontColor('#9ca3af');
    }
  });
}

function _upsertOutput(sheetName, headers, newRows, thang) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(sheetName)) ss.insertSheet(sheetName);
  var existing = sheetToArr(sheetName).filter(function(r) { return _thangStr(r.thang) !== thang; });
  clearAndWriteSheet(sheetName, headers, existing.concat(newRows));
  sortSheetByCol(sheetName, 1); // sort theo cột thang
}

// ── Core tính điểm ───────────────────────────────────────────

function _kpiScore(value, lower, upper, maxPct, weight, giamTru) {
  if (value === '' || value === null || value === undefined) return null;
  var gt  = (giamTru !== undefined && giamTru !== '' && giamTru !== null) ? Number(giamTru) : 1;
  // Chỉ tiêu tính điểm = chỉ tiêu metadata × giảm trừ
  var effectiveUpper = upper * gt;
  if (effectiveUpper === lower) return null;
  var dir = effectiveUpper >= lower ? 1 : -1;
  var v   = value * dir, lo = lower * dir, hi = effectiveUpper * dir, hiMax = effectiveUpper * maxPct * dir;
  var pct;
  if (v <= lo)      pct = 0;
  else if (v <= hi) pct = (value - lower) / (effectiveUpper - lower) * 100;
  else if (v >= hiMax) pct = maxPct * 100;
  else pct = 100 + (value - effectiveUpper) / (effectiveUpper * maxPct - effectiveUpper) * (maxPct * 100 - 100);
  return (weight / 100) * pct;
}

function _kpiPct(value, lower, upper, maxPct, giamTru) {
  if (value === '' || value === null || value === undefined) return null;
  var gt = (giamTru !== undefined && giamTru !== '' && giamTru !== null) ? Number(giamTru) : 1;
  var effectiveUpper = upper * gt;
  if (effectiveUpper === lower) return null;
  var dir = effectiveUpper >= lower ? 1 : -1;
  var v = value * dir, lo = lower * dir, hi = effectiveUpper * dir, hiMax = effectiveUpper * maxPct * dir;
  if (v <= lo)    return 0;
  if (v <= hi)    return (value - lower) / (effectiveUpper - lower);
  if (v >= hiMax) return maxPct;
  return 1 + (value - effectiveUpper) / (effectiveUpper * maxPct - effectiveUpper) * (maxPct - 1);
}

function _calcDiemPhong(kpiList, row) {
  var diemCN  = parseFloat(row.diem_kpi_chinhanh) || 0;
  var diemKPI = 0;
  kpiList.filter(function(k) { return k.kpi_cap === 'phong'; }).forEach(function(kpi) {
    var value  = row[kpi.kpi_id + '_value'];
    var lower  = row[kpi.kpi_id + '_lower'];
    var upper  = row[kpi.kpi_id + '_upper'];
    var w      = parseFloat(row[kpi.kpi_id + '_trong_so']) || 0;
    var rawMpP = parseFloat(row[kpi.kpi_id + '_max_pct']);
    var maxPct = isNaN(rawMpP) || rawMpP <= 0 ? (parseFloat(kpi.max_pct) || 1) : (rawMpP > 2 ? rawMpP / 100 : rawMpP);
    if (value === '' || value === null || value === undefined) return;
    var d = _kpiScore(parseFloat(value), parseFloat(lower), parseFloat(upper), maxPct, w, 1);
    if (d !== null) diemKPI += d;
  });
  return diemCN + diemKPI;
}

function _calcNV(nv, kpiList, inputRow, diemPhongTong, configWeights) {
  var activeCN = kpiList.filter(function(k) { return k.kpi_cap === 'ca_nhan'; });
  var weights  = {};

  if (configWeights) {
    // Auto mode: dùng weights từ CONFIG_Store
    Object.keys(configWeights).forEach(function(id) {
      var w = configWeights[id];
      if (w > 0) weights[id] = w;
    });
  } else {
    // Manual mode / fallback: đọc _trong_so từ sheet
    activeCN.forEach(function(k) {
      var w = parseFloat(inputRow[k.kpi_id + '_trong_so']);
      if (!isNaN(w) && w > 0) weights[k.kpi_id] = w;
    });
  }

  var diemCaNhan = 0;
  var chiTiet    = [];

  activeCN.forEach(function(kpi) {
    var w = weights[kpi.kpi_id];
    if (!w) return;
    var value  = parseFloat(inputRow[kpi.kpi_id + '_value']);
    var lower  = parseFloat(inputRow[kpi.kpi_id + '_lower']);
    var upper  = parseFloat(inputRow[kpi.kpi_id + '_upper']);
    // Backward compat: giá trị cũ dạng thập phân (1.0, 0.99), giá trị mới dạng ×100 (100, 99)
    var rawGt  = parseFloat(inputRow[kpi.kpi_id + '_giam_tru']);
    var gtVal  = isNaN(rawGt) ? 1 : (rawGt > 2 ? rawGt / 100 : rawGt);
    var rawMp  = parseFloat(inputRow[kpi.kpi_id + '_max_pct']);
    if (isNaN(rawMp) || rawMp <= 0) rawMp = parseFloat(kpi.max_pct) || 100;
    var maxPct = rawMp > 2 ? rawMp / 100 : rawMp;
    if (isNaN(value)) return;
    var diem = _kpiScore(value, lower, upper, maxPct, w, gtVal);
    if (diem === null) return;
    var pct = _kpiPct(value, lower, upper, maxPct, gtVal);
    diemCaNhan += diem;
    chiTiet.push({
      kpi_id: kpi.kpi_id, lower: lower, upper: upper * gtVal, value: value,
      max_pct: maxPct, weight_tho: w, weight_tuong_doi: w,
      giam_tru: gtVal,
      pct_th: pct, diem_quy_doi: diem,
    });
  });

  return {
    diemCaNhan: diemCaNhan,
    diemPhongDongGop: diemPhongTong * 0.30,
    tongDiem: diemPhongTong * 0.30 + diemCaNhan,
    chiTiet: chiTiet,
  };
}

function _xepLoai(d, cfg) {
  var c = cfg || {};
  if (d >= (c.A_plus || 105)) return 'A+';
  if (d >= (c.A     || 101))  return 'A';
  if (d >= (c.B     || 100))  return 'B';
  if (d >= (c.C     ||  95))  return 'C';
  return 'D';
}

function _r(n, d) { return Math.round(n * Math.pow(10, d||3)) / Math.pow(10, d||3); }

// ── Cập nhật cột KPI trong INPUT_CN_YYYY-MM khi danh sách KPI thay đổi ───────
// data: { thang, addedKpis: [{kpi_id, ten_kpi, don_vi, stt}], removedKpiIds: [kpi_id], finalKpiList: [{kpi_id, stt}] }
function updateInputCNKpis(data) {
  var thang         = data.thang;
  var addedKpis     = data.addedKpis     || [];
  var removedKpiIds = data.removedKpiIds || [];
  var finalKpiList  = data.finalKpiList  || [];
  if (!thang) throw new Error('Thiếu tham số thang');
  if (!addedKpis.length && !removedKpiIds.length) return { ok: true, msg: 'Không có thay đổi' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('INPUT_CN_' + thang);
  if (!sh) return { ok: false, error: 'Sheet không tồn tại: INPUT_CN_' + thang };

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastCol < 5) return { ok: true, msg: 'Sheet trống' };

  var allData    = sh.getRange(1, 1, Math.max(lastRow, 3), lastCol).getValues();
  var displayRow = allData[0] || [];
  var machineRow = allData[1] || [];
  var subRow     = allData[2] || [];
  var dataRows   = lastRow > 3 ? allData.slice(3) : [];
  var FIXED      = 5; // nv_id, ho_ten, nhom_cv, khu_vuc, thang

  // Tập hợp KPI bị xóa
  var removedSet = {};
  removedKpiIds.forEach(function(id) { removedSet[id] = true; });

  // Xác định thứ tự KPI hiện có (chỉ lấy _value col làm marker)
  var currentKpiIds = [];
  var seenKpi = {};
  for (var c = FIXED; c < machineRow.length; c++) {
    var h = String(machineRow[c] || '');
    if (h.slice(-6) === '_value') {
      var kid = h.slice(0, -6);
      if (!seenKpi[kid]) { currentKpiIds.push(kid); seenKpi[kid] = true; }
    }
  }

  // Giữ lại KPI không bị xóa
  var keptKpiIds = currentKpiIds.filter(function(id) { return !removedSet[id]; });

  // Xây dựng cột mới: fixed + kept + added
  var newDisplay = displayRow.slice(0, FIXED);
  var newMachine = machineRow.slice(0, FIXED);
  var newSub     = subRow.slice(0, FIXED);
  var newData    = dataRows.map(function(r) { return r.slice(0, FIXED); });

  // Thêm các KPI kept
  keptKpiIds.forEach(function(kid) {
    var startC = -1;
    for (var c = FIXED; c < machineRow.length; c++) {
      if (String(machineRow[c] || '') === kid + '_value') { startC = c; break; }
    }
    if (startC < 0) return;
    for (var off = 0; off < 6; off++) {
      newDisplay.push(displayRow[startC + off] !== undefined ? displayRow[startC + off] : '');
      newMachine.push(machineRow[startC + off] !== undefined ? machineRow[startC + off] : '');
      newSub.push(subRow[startC + off]     !== undefined ? subRow[startC + off]     : '');
      dataRows.forEach(function(row, ri) {
        newData[ri].push(row[startC + off] !== undefined ? row[startC + off] : '');
      });
    }
  });

  // Thêm cột cho KPI mới
  addedKpis.forEach(function(kpi) {
    var label = (kpi.stt || '') + '. ' + (kpi.ten_kpi || '') + ' (' + (kpi.don_vi || '') + ')';
    newDisplay.push(label, '', '', '', '', '');
    newMachine.push(kpi.kpi_id+'_value', kpi.kpi_id+'_upper', kpi.kpi_id+'_lower',
                    kpi.kpi_id+'_trong_so', kpi.kpi_id+'_max_pct', kpi.kpi_id+'_giam_tru');
    newSub.push('KQ TH', 'Chỉ tiêu', 'Ngưỡng dưới', 'Trọng số', 'Điểm tối đa', 'Giảm trừ');
    dataRows.forEach(function(_, ri) {
      newData[ri].push('', '', '', '', 100, 100);
    });
  });

  // Sắp xếp lại theo STT trong finalKpiList
  if (finalKpiList.length > 0) {
    var allNewKpiIds = keptKpiIds.concat(addedKpis.map(function(k) { return k.kpi_id; }));
    var orderMap = {};
    finalKpiList.forEach(function(k, i) { orderMap[k.kpi_id] = i; });
    var sorted = allNewKpiIds.slice().sort(function(a, b) {
      return (orderMap[a] !== undefined ? orderMap[a] : 9999) - (orderMap[b] !== undefined ? orderMap[b] : 9999);
    });
    if (JSON.stringify(sorted) !== JSON.stringify(allNewKpiIds)) {
      var posMap = {};
      allNewKpiIds.forEach(function(id, i) { posMap[id] = i; });
      var sd = [], sm = [], ss2 = [];
      var sdArr = dataRows.map(function() { return []; });
      sorted.forEach(function(id) {
        var i = posMap[id];
        for (var off = 0; off < 6; off++) {
          sd.push(newDisplay[FIXED + i*6 + off]);
          sm.push(newMachine[FIXED + i*6 + off]);
          ss2.push(newSub[FIXED + i*6 + off]);
          dataRows.forEach(function(_, ri) {
            sdArr[ri].push(newData[ri][FIXED + i*6 + off]);
          });
        }
      });
      newDisplay = newDisplay.slice(0, FIXED).concat(sd);
      newMachine = newMachine.slice(0, FIXED).concat(sm);
      newSub     = newSub.slice(0, FIXED).concat(ss2);
      newData    = newData.map(function(r, ri) { return r.slice(0, FIXED).concat(sdArr[ri]); });
    }
  }

  // Cập nhật STT prefix trong display header theo finalKpiList (stt thực tế sau khi edit)
  if (finalKpiList.length > 0) {
    var finalOrderMap = {};
    finalKpiList.forEach(function(k, i) { finalOrderMap[k.kpi_id] = { stt: k.stt, idx: i }; });
    // Xác định kpi_id tại mỗi slot trong newDisplay
    for (var slot = 0; slot < Math.floor((newDisplay.length - FIXED) / 6); slot++) {
      var machineHeader = String(newMachine[FIXED + slot * 6] || '');
      if (machineHeader.slice(-6) !== '_value') continue;
      var kpiId = machineHeader.slice(0, -6);
      var fi = finalOrderMap[kpiId];
      if (!fi) continue;
      var oldLabel = String(newDisplay[FIXED + slot * 6] || '');
      // Thay thế phần STT ở đầu chuỗi "N. Tên KPI (đvt)"
      newDisplay[FIXED + slot * 6] = oldLabel.replace(/^\d+\.\s*/, fi.stt + '. ');
    }
  }

  // Ghi lại sheet
  var newCols  = newDisplay.length;
  var allRows  = [newDisplay, newMachine, newSub].concat(newData);
  sh.clearContents();
  if (newCols > 0 && allRows.length > 0) {
    sh.getRange(1, 1, allRows.length, newCols).setValues(allRows);
  }
  return { ok: true, added: addedKpis.length, removed: removedKpiIds.length };
}

// ── Cập nhật hàng NV trong INPUT_CN_YYYY-MM khi danh sách NV thay đổi ────────
// data: { thang, addedNvs: [{nv_id, ho_ten, nhom_cv, khu_vuc}], removedNvIds: [nv_id], orderedNvIds: [nv_id] }
function updateInputCNNvs(data) {
  var thang        = data.thang;
  var addedNvs     = data.addedNvs     || [];
  var removedNvIds = data.removedNvIds || [];
  var orderedNvIds = data.orderedNvIds || [];
  if (!thang) throw new Error('Thiếu tham số thang');
  if (!addedNvs.length && !removedNvIds.length) return { ok: true, msg: 'Không có thay đổi' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('INPUT_CN_' + thang);
  if (!sh) return { ok: false, error: 'Sheet không tồn tại: INPUT_CN_' + thang };

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastCol < 5) return { ok: true, msg: 'Sheet trống' };

  var allData    = sh.getRange(1, 1, Math.max(lastRow, 3), lastCol).getValues();
  var machineRow = allData[1] || [];
  var dataRows   = lastRow > 3 ? allData.slice(3) : [];

  var nvIdCol  = machineRow.indexOf('nv_id');
  var hoTenCol = machineRow.indexOf('ho_ten');
  var nhomCvCol= machineRow.indexOf('nhom_cv');
  var kvCol    = machineRow.indexOf('khu_vuc');
  var thangCol = machineRow.indexOf('thang');
  if (nvIdCol < 0) return { ok: false, error: 'Không tìm thấy cột nv_id' };

  // Xóa hàng của NV đã xóa khỏi tháng
  var removedSet = {};
  removedNvIds.forEach(function(id) { removedSet[id] = true; });
  var keptRows = dataRows.filter(function(row) {
    return !removedSet[String(row[nvIdCol] || '').trim()];
  });

  // Thêm hàng cho NV mới (chưa có trong sheet)
  var existSet = {};
  keptRows.forEach(function(r) { existSet[String(r[nvIdCol] || '').trim()] = true; });
  addedNvs.forEach(function(nv) {
    if (existSet[nv.nv_id]) return;
    var newRow = new Array(lastCol).fill('');
    if (nvIdCol  >= 0) newRow[nvIdCol]  = nv.nv_id   || '';
    if (hoTenCol >= 0) newRow[hoTenCol] = nv.ho_ten   || '';
    if (nhomCvCol>= 0) newRow[nhomCvCol]= nv.nhom_cv  || '';
    if (kvCol    >= 0) newRow[kvCol]    = nv.khu_vuc  || '';
    if (thangCol >= 0) newRow[thangCol] = thang;
    // Đặt max_pct=100, giam_tru=100 (%) cho tất cả KPI
    for (var c = 5; c < machineRow.length; c++) {
      var h = String(machineRow[c] || '');
      if (h.slice(-8) === '_max_pct' || h.slice(-9) === '_giam_tru') newRow[c] = 100;
    }
    keptRows.push(newRow);
  });

  // Sắp xếp theo thứ tự STT từ orderedNvIds (nếu có), fallback theo nv_id
  if (orderedNvIds.length > 0) {
    var orderMap = {};
    orderedNvIds.forEach(function(id, i) { orderMap[id] = i; });
    keptRows.sort(function(a, b) {
      var ai = orderMap[String(a[nvIdCol] || '').trim()];
      var bi = orderMap[String(b[nvIdCol] || '').trim()];
      if (ai === undefined) ai = 9999;
      if (bi === undefined) bi = 9999;
      return ai - bi;
    });
  } else {
    keptRows.sort(function(a, b) {
      return String(a[nvIdCol] || '').localeCompare(String(b[nvIdCol] || ''));
    });
  }

  // Ghi lại phần data (từ hàng 4 trở đi)
  if (dataRows.length > 0) {
    sh.getRange(4, 1, dataRows.length, lastCol).clearContent();
  }
  if (keptRows.length > 0) {
    sh.getRange(4, 1, keptRows.length, lastCol).setValues(keptRows);
  }
  return { ok: true, added: addedNvs.length, removed: removedNvIds.length };
}
