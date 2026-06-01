// ============================================================
// calcAll.js — Engine tính điểm toàn bộ, đọc INPUT, ghi OUTPUT
// Chạy bởi Google Apps Script (GAS) khi bấm "Tính điểm" từ Web App
// ============================================================

var SHEET_NAMES = {
  CONFIG_KPI:      'CONFIG_KPI',
  CONFIG_NV:       'CONFIG_NhanVien',
  CONFIG_TS:       'CONFIG_TrongSo',
  INPUT_CN:        'INPUT_KetQua_CaNhan',
  INPUT_PHONG:     'INPUT_KetQua_Phong',
  OUTPUT_DIEM:     'OUTPUT_DiemTong',
  OUTPUT_CHITIET:  'OUTPUT_ChiTiet'
};

/**
 * HTTP GET handler — Web App gọi: ?action=calcMonth&thang=2026-03
 */
function doGet(e) {
  var action = e.parameter.action;
  var result;
  try {
    if (action === 'calcMonth') {
      result = calcMonth(e.parameter.thang);
    } else if (action === 'getOutput') {
      result = getOutput(e.parameter.thang);
    } else {
      result = { error: 'Unknown action' };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Helpers ------------------------------------------------

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sheet không tồn tại: ' + name);
  return sh;
}

function sheetToObjects(sheetName) {
  var sh = getSheet(sheetName);
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function clearAndWrite(sheetName, headers, rows) {
  var sh = getSheet(sheetName);
  sh.clearContents();
  if (rows.length === 0) return;
  var all = [headers].concat(rows.map(function(r) {
    return headers.map(function(h) { return r[h] !== undefined ? r[h] : ''; });
  }));
  sh.getRange(1, 1, all.length, headers.length).setValues(all);
}

// ---- Main calc ----------------------------------------------

function calcMonth(thang) {
  if (!thang) throw new Error('Thiếu tham số thang');

  // --- Đọc config
  var kpiList = sheetToObjects(SHEET_NAMES.CONFIG_KPI)
    .filter(function(k) { return k.active == true || k.active == 'TRUE'; });

  var nvList = sheetToObjects(SHEET_NAMES.CONFIG_NV)
    .filter(function(n) { return n.active == true || n.active == 'TRUE'; });

  var tsRows = sheetToObjects(SHEET_NAMES.CONFIG_TS);
  var tsMap = {};
  tsRows.forEach(function(r) { tsMap[r.kpi_id] = r; });

  // --- Đọc INPUT cá nhân (lọc theo tháng)
  var inputCN = sheetToObjects(SHEET_NAMES.INPUT_CN)
    .filter(function(r) { return r.thang === thang; });

  var inputCNMap = {};
  inputCN.forEach(function(r) { inputCNMap[r.nv_id] = r; });

  // --- Đọc INPUT phòng (lọc theo tháng)
  var inputPhong = sheetToObjects(SHEET_NAMES.INPUT_PHONG)
    .filter(function(r) { return r.thang === thang; });
  var phongRow = inputPhong[0] || {};

  // --- Tính điểm phòng
  var diemPhongTong = calcDiemPhong(phongRow, kpiList);

  // --- OUTPUT rows
  var outDiem    = [];
  var outChiTiet = [];

  nvList.forEach(function(nv) {
    var row = inputCNMap[nv.nv_id];
    if (!row) return;

    // Lấy KPI active cá nhân
    var activeKpis = kpiList.filter(function(k) { return k.kpi_cap === 'ca_nhan'; });

    // Tính weight_tho từ CONFIG_TrongSo
    var kpisWithWeight = activeKpis.map(function(k) {
      var tsRow = tsMap[k.kpi_id] || {};
      var priority = tsRow[nv.nhom_cv] || 0;
      return { kpi_id: k.kpi_id, weight_tho: priorityToWeight(priority) };
    }).filter(function(k) { return k.weight_tho > 0; });

    var weights = calcWeights(kpisWithWeight, 70);

    var diemCaNhan = 0;
    activeKpis.forEach(function(kpi) {
      var w = weights[kpi.kpi_id];
      if (!w) return;

      var value   = row[kpi.kpi_id + '_value'];
      var lower   = row[kpi.kpi_id + '_lower'];
      var upper   = row[kpi.kpi_id + '_upper'];
      var gt      = row[kpi.kpi_id + '_giam_tru'];
      var maxPct  = kpi.max_pct || 1.2;

      if (value === '' || value === null || value === undefined) return;

      var diem = kpiScore(value, lower, upper, maxPct, w, gt !== undefined ? gt : 1);
      if (diem === null) return;

      diemCaNhan += diem;

      outChiTiet.push({
        thang:           thang,
        nv_id:           nv.nv_id,
        kpi_id:          kpi.kpi_id,
        lower:           lower,
        upper:           upper,
        value:           value,
        max_pct:         maxPct,
        weight_tho:      kpisWithWeight.find(function(k) { return k.kpi_id === kpi.kpi_id; }) ?
                           kpisWithWeight.find(function(k) { return k.kpi_id === kpi.kpi_id; }).weight_tho : 0,
        weight_tuong_doi: w,
        giam_tru:        gt !== undefined ? gt : 1,
        diem_quy_doi:    Math.round(diem * 1000) / 1000
      });
    });

    var tongDiem = diemPhongTong * 0.30 + diemCaNhan;

    outDiem.push({
      thang:               thang,
      nv_id:               nv.nv_id,
      ho_ten:              nv.ho_ten,
      nhom_cv:             nv.nhom_cv,
      khu_vuc:             nv.khu_vuc,
      diem_phong_dong_gop: Math.round(diemPhongTong * 0.30 * 1000) / 1000,
      diem_ca_nhan:        Math.round(diemCaNhan * 1000) / 1000,
      tong_diem:           Math.round(tongDiem * 1000) / 1000,
      xep_loai:            xepLoai(tongDiem)
    });
  });

  // --- Ghi OUTPUT
  clearAndWrite(SHEET_NAMES.OUTPUT_DIEM,
    ['thang','nv_id','ho_ten','nhom_cv','khu_vuc','diem_phong_dong_gop','diem_ca_nhan','tong_diem','xep_loai'],
    outDiem);

  clearAndWrite(SHEET_NAMES.OUTPUT_CHITIET,
    ['thang','nv_id','kpi_id','lower','upper','value','max_pct','weight_tho','weight_tuong_doi','giam_tru','diem_quy_doi'],
    outChiTiet);

  return { success: true, thang: thang, so_nv: outDiem.length };
}

function calcDiemPhong(row, kpiList) {
  var diemCN = parseFloat(row.diem_kpi_chinhanh) || 0;
  var diemKPI = 0;

  kpiList.filter(function(k) { return k.kpi_cap === 'phong'; })
    .forEach(function(kpi) {
      var value  = row[kpi.kpi_id + '_value'];
      var lower  = row[kpi.kpi_id + '_lower'];
      var upper  = row[kpi.kpi_id + '_upper'];
      var w      = row[kpi.kpi_id + '_trong_so'];
      var maxPct = kpi.max_pct || 1.2;
      if (value === '' || value === null || value === undefined) return;
      var d = kpiScore(value, lower, upper, maxPct, w, 1);
      if (d !== null) diemKPI += d;
    });

  return diemCN + diemKPI;
}

function getOutput(thang) {
  var rows = sheetToObjects(SHEET_NAMES.OUTPUT_DIEM);
  if (thang) rows = rows.filter(function(r) { return r.thang === thang; });
  return { data: rows };
}
