/** =====================[ CONFIG ]===================== **/
const CONFIG = {
  sheetId: '1Mf6KN3OtrgpT3mYYIVDi5uDcknE_7wEZoK1aPXlzF9A',

  folders: {
    '🦷 قسم الأسنان (Dental)': '1X90N2U0am3H0Z4fJFBrUER1IjBKwrPXI',
    '📷 قسم الأشعة (RAD)':     '1nvDKOfyEuuyzxdORd7caS9kej0wLaWzz',
    '👶 قسم النساء والولادة (OB/GYN)': '1AcDWphAsYNak2EZSs_NXKD4dhrYm6PkW',
    '🔬 المختبر (LAB)':         '18Qk88cD9sG2C-TvotwA3MPHU6nHK9KgI',
    '🚑 الطوارئ (E.R)':        '1e7PZmNFz8wLbAorw1_2OK2ZVkncWToej',
    '🧼 التعقيم (CSSD)':        '1KVSDblQHbZ1YAn1bKSjyrxsKDZAnEdAN',
    '🏢 المبنى (Building)':     '1-04JUnPzyg03rIb1rTgNcL542ohI0tAZ'
  },

  fmsManager: 'صابر عبده',
  fmsDeputy: 'الاستاذ عدنان الرفاعي'
};

const DEPT_CODE_MAP = {
  'rad-maintains'      : '📷 قسم الأشعة (RAD)',
  'rad maintains'      : '📷 قسم الأشعة (RAD)',
  'rad'                : '📷 قسم الأشعة (RAD)',
  'ob/gyn-maintains'   : '👶 قسم النساء والولادة (OB/GYN)',
  'obgyn-maintains'    : '👶 قسم النساء والولادة (OB/GYN)',
  'lab-maintains'      : '🔬 المختبر (LAB)',
  'lab'                : '🔬 المختبر (LAB)',
  'e.r-maintains'      : '🚑 الطوارئ (E.R)',
  'er-maintains'       : '🚑 الطوارئ (E.R)',
  'er'                 : '🚑 الطوارئ (E.R)',
  'dental-maintains'   : '🦷 قسم الأسنان (Dental)',
  'dental'             : '🦷 قسم الأسنان (Dental)',
  'cssd-maintains'     : '🧼 التعقيم (CSSD)',
  'cssd'               : '🧼 التعقيم (CSSD)',
  'building-maintains' : '🏢 المبنى (Building)',
  'building'           : '🏢 المبنى (Building)'
};

function _normDeptName(value) {
  return String(value || '')
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    .trim()
    .toLowerCase();
}

function resolveDepartmentFolder(dept) {
  if (!dept) return CONFIG.folders['🏢 المبنى (Building)'];
  const norm = _normDeptName(dept);
  const withDash = norm.replace(/\s+/g, '-');
  if (DEPT_CODE_MAP[withDash]) {
    const key = DEPT_CODE_MAP[withDash];
    if (CONFIG.folders[key]) return CONFIG.folders[key];
  }
  if (DEPT_CODE_MAP[norm]) {
    const key = DEPT_CODE_MAP[norm];
    if (CONFIG.folders[key]) return CONFIG.folders[key];
  }
  if (CONFIG.folders[dept]) return CONFIG.folders[dept];
  return CONFIG.folders['🏢 المبنى (Building)'];
}

/** =====================[ HELPER FUNCTIONS ]===================== **/
function getSheet(name) {
  const ss = SpreadsheetApp.openById(CONFIG.sheetId);
  return ss.getSheetByName(name) || null;
}

function findRowIndexById_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(id).trim()) return i + 1;
  }
  return -1;
}

function extractFileIdFromUrl(url) {
  if (!url) return null;
  const match = String(url).match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

function formatDate(dateString) {
  if (!dateString) return '-';
  try { return new Date(dateString).toLocaleDateString('ar-SA'); }
  catch (error) { return dateString; }
}

function _decodeBase64(input) {
  if (!input) throw new Error('fileData فارغ');
  let base64 = input, mime = null;
  const m = String(input).match(/^data:(.+);base64,(.*)$/);
  if (m) { mime = m[1]; base64 = m[2]; }
  return { bytes: Utilities.base64Decode(base64), mimeType: mime };
}

/** =====================[ ENTRY POINTS ]===================== **/
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action || '';
    if (action === 'viewCert' && params.id) return renderCertificatePage_(params.id);
    const result = action ? handleApiRequest(params) : { ok: true, time: new Date().toISOString(), version: '2.0' };
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(err && err.message || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    let params = {};
    if (e && e.postData) params = JSON.parse(e.postData.contents || '{}');
    const result = handleApiRequest(params);
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(err && err.message || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/** =====================[ API ROUTER ]===================== **/
function handleApiRequest(params) {
  const action = params && params.action;
  if (!action) throw new Error('No action specified');
  switch (action) {
    case 'getRecords':          return getRecords();
    case 'getAssets':           return getAssets();
    case 'getStaff':            return getStaff();
    case 'getKPIs':             return getKPIs();
    case 'getStats':            return getKPIs();
    case 'addRecord':           return addRecord(params);
    case 'updateRecord':        return updateRecord(params);
    case 'deleteRecord':        return deleteRecord(params);
    case 'uploadFile':          return uploadFile(params);
    case 'generateCertificate': return generateCertificate(params);
    case 'export':              return exportData(params.format);
    case 'repair':              return repairSheets();
    case 'health':              return { ok: true, time: new Date().toISOString(), version: '2.0' };
    default: throw new Error('Action not found: ' + action);
  }
}

/** =====================[ READ OPERATIONS ]===================== **/
function getRecords() {
  try {
    const sheet = getSheet('Records');
    if (!sheet || sheet.getLastRow() <= 1) return [];
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    return data.map(row => ({
      ID: row[0], Timestamp: row[1], Department: row[2], Staff: row[3],
      AssetID: row[4], AssetName: row[5], TaskType: row[6], StartDate: row[7],
      DueDate: row[8], CompletedDate: row[9], Status: row[10], Priority: row[11],
      DowntimeHours: row[12], File: row[13], Certificate: row[14], Notes: row[15]
    })).filter(r => r.ID);
  } catch (error) {
    throw new Error('فشل في جلب السجلات: ' + error.message);
  }
}

function getAssets() {
  try {
    const sheet = getSheet('Assets');
    if (!sheet || sheet.getLastRow() <= 1) return {};
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
    const assetsMap = {};
    data.forEach(row => {
      if (!row[1]) return;
      const department = String(row[1]).trim();
      if (!assetsMap[department]) assetsMap[department] = [];
      assetsMap[department].push({
        id: row[0], name: row[4] || '', room: row[3] || '', serial: row[6] || '',
        status: row[7] || '', frequency: row[8] || '', lastPM: row[9] || '', nextPM: row[10] || ''
      });
    });
    return assetsMap;
  } catch (error) {
    throw new Error('فشل في جلب الأصول: ' + error.message);
  }
}

function getStaff() {
  try {
    const sheet = getSheet('Staff');
    if (!sheet || sheet.getLastRow() <= 1) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat().filter(Boolean);
  } catch (error) {
    throw new Error('فشل في جلب الفنيين: ' + error.message);
  }
}

/** =====================[ KPI CALCULATIONS - FIXED VERSION V2 ]===================== **/
function getKPIs() {
  const records = getRecords();
  const assetsMap = getAssets();

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // 1) إجمالي الأجهزة من شيت Assets
  const allAssetIds = new Set();
  Object.values(assetsMap).forEach(list => {
    if (!Array.isArray(list)) return;
    list.forEach(a => {
      const id = String(a.id || '').trim();
      if (id) allAssetIds.add(id);
    });
  });
  const totalDevices = allAssetIds.size;

  // 2) مؤشرات عامة من السجلات
  const devicesWithRecord = new Set();
  let outOfService = 0;
  let completed = 0;
  let critical = 0;
  let uncompleted = 0;
  let downtime = 0;

  records.forEach(r => {
    const assetId = String(r.AssetID || '').trim();
    const status = String(r.Status || '').trim();
    if (assetId) devicesWithRecord.add(assetId);
    if (status === 'Completed') completed++;
    else uncompleted++;
    if (status === 'OutOfService') outOfService++;
    if (status === 'Critical') critical++;
    downtime += Number(r.DowntimeHours) || 0;
  });

  // 3) حساب الأجهزة المتأخرة والمستحقة
  let dueThisMonth = 0;
  let overdue = 0;
  const assetNextDueDates = {};

  records.forEach(r => {
    const assetId = String(r.AssetID || '').trim();
    if (!assetId || !r.DueDate) return;
    const dueDate = r.DueDate instanceof Date ? new Date(r.DueDate) : new Date(r.DueDate);
    if (isNaN(dueDate)) return;
    if (!assetNextDueDates[assetId] || dueDate > assetNextDueDates[assetId].dueDate) {
      assetNextDueDates[assetId] = { dueDate: dueDate, record: r };
    }
  });

  Object.values(assetNextDueDates).forEach(({ dueDate, record }) => {
    dueDate.setHours(0, 0, 0, 0);
    const status = String(record.Status || '').trim();
    if (status === 'OutOfService') return;
    if (dueDate < now) {
      overdue++;
    } else if (dueDate.getFullYear() === currentYear && dueDate.getMonth() === currentMonth) {
      dueThisMonth++;
    }
  });

  // ====== أرقام على مستوى الأجهزة (Unique Devices) ======
  // عدد الأجهزة المصانة = أجهزة لديها آخر سجل حالته Completed
  let servicedDevices = 0;
  const overdueDevices = overdue;

  // نجمع حالة "آخر سجل" لكل جهاز بناءً على الأحدث
  const latestByAsset = {};
  records.forEach(r => {
    const assetId = String(r.AssetID || '').trim();
    if (!assetId) return;
    const d = new Date(r.Timestamp || r.CompletedDate || r.StartDate || r.DueDate || 0);
    if (isNaN(d)) return;
    if (!latestByAsset[assetId] || d > latestByAsset[assetId].d) {
      latestByAsset[assetId] = { d, r };
    }
  });

  Object.values(latestByAsset).forEach(({ r }) => {
    const status = String(r.Status || '').trim();
    if (status === 'Completed') servicedDevices++;
  });

  // عدد الأجهزة غير المصانة = كل الأجهزة - الأجهزة المصانة
  const notServicedDevices = Math.max(totalDevices - servicedDevices, 0);

  // 4) أجهزة لم تتم صيانتها نهائياً (لم يظهر لها أي سجل)
  let notServiced = 0;
  allAssetIds.forEach(id => {
    if (!devicesWithRecord.has(id)) notServiced++;
  });

  // 5) MTTR + نسبة الإنجاز
  const completedWithDates = records.filter(r =>
    r.Status === 'Completed' && r.StartDate && r.CompletedDate
  );

  const mttr = completedWithDates.length
    ? Math.round(
        completedWithDates.reduce((t, r) => {
          const s = new Date(r.StartDate);
          const c = new Date(r.CompletedDate);
          return t + ((c - s) / (1000 * 3600 * 24));
        }, 0) / completedWithDates.length
      )
    : 0;

  const completionRate = totalDevices
    ? Math.round((servicedDevices / totalDevices) * 100)
    : 0;

  return {
    totalDevices,          // عدد الأجهزة كاملة
    servicedDevices,       // عدد الأجهزة المصانة
    overdueDevices,        // عدد الأجهزة المتأخرة (بالأحمر)
    notServicedDevices,    // عدد الأجهزة غير المصانة
    dueThisMonth,
    overdue,
    outOfService,
    completed,
    critical,
    uncompleted,
    downtime: Math.round(downtime),
    completionRate,
    mttr,
    notServiced
  };
}

/** =====================[ WRITE OPERATIONS ]===================== **/
function addRecord(params) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet('Records');
    if (!sheet) throw new Error('جدول Records غير موجود');
    const id = Utilities.getUuid();
    const timestamp = new Date().toISOString();
    const row = [
      id, timestamp, params.department, params.staff, params.assetID, params.assetName,
      params.taskType, params.startDate, params.dueDate, params.completedDate,
      params.status, params.priority, params.downtimeHours, '', '', params.notes || ''
    ];
    sheet.appendRow(row);
    return {
      ID: id, Timestamp: timestamp, Department: params.department, Staff: params.staff,
      AssetID: params.assetID, AssetName: params.assetName, TaskType: params.taskType,
      StartDate: params.startDate, DueDate: params.dueDate, CompletedDate: params.completedDate,
      Status: params.status, Priority: params.priority, DowntimeHours: params.downtimeHours
    };
  } catch (error) {
    throw new Error('فشل في إضافة السجل: ' + error.message);
  } finally {
    lock.releaseLock();
  }
}

function updateRecord(params) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet('Records');
    if (!sheet) throw new Error('جدول Records غير موجود');
    const rowIndex = findRowIndexById_(sheet, params.id);
    if (rowIndex === -1) throw new Error('Record not found');
    const row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
    const updatedRow = [
      row[0], row[1], params.department || row[2], params.staff || row[3],
      params.assetID || row[4], params.assetName || row[5], params.taskType || row[6],
      params.startDate || row[7], params.dueDate || row[8], params.completedDate || row[9],
      params.status || row[10], params.priority || row[11], params.downtimeHours || row[12],
      row[13], row[14], params.notes || row[15]
    ];
    sheet.getRange(rowIndex, 1, 1, updatedRow.length).setValues([updatedRow]);
    return { success: true };
  } catch (error) {
    throw new Error('فشل في تحديث السجل: ' + error.message);
  } finally {
    lock.releaseLock();
  }
}

function deleteRecord(params) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet('Records');
    if (!sheet) throw new Error('جدول Records غير موجود');
    const rowIndex = findRowIndexById_(sheet, params.id);
    if (rowIndex === -1) throw new Error('Record not found');
    const row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
    sheet.deleteRow(rowIndex);
    try {
      const fileUrls = row[13] ? String(row[13]).split(',') : [];
      fileUrls.forEach(url => {
        try {
          const fileId = extractFileIdFromUrl(url.trim());
          if (fileId) DriveApp.getFileById(fileId).setTrashed(true);
        } catch (e) {}
      });
      const certificateUrl = row[14];
      if (certificateUrl) {
        try {
          const certId = extractFileIdFromUrl(certificateUrl);
          if (certId) DriveApp.getFileById(certId).setTrashed(true);
        } catch (e) {}
      }
    } catch (e) {}
    return { success: true };
  } catch (error) {
    throw new Error('فشل في حذف السجل: ' + error.message);
  } finally {
    lock.releaseLock();
  }
}

function uploadFile(params) {
  try {
    const folderId = resolveDepartmentFolder(params.department);
    const folder = DriveApp.getFolderById(folderId);
    const decoded = _decodeBase64(params.fileData);
    const mime = params.mimeType || decoded.mimeType || 'application/octet-stream';
    const name = params.fileName || ('upload_' + Date.now());
    const file = folder.createFile(Utilities.newBlob(decoded.bytes, mime, name));
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (_) {}
    const sheet = getSheet('Records');
    const rowIndex = findRowIndexById_(sheet, params.recordId);
    if (rowIndex === -1) throw new Error('Record not found by ID: ' + params.recordId);
    const current = sheet.getRange(rowIndex, 14).getValue();
    sheet.getRange(rowIndex, 14).setValue(current ? (current + ',' + file.getUrl()) : file.getUrl());
    return { url: file.getUrl(), id: file.getId(), name: file.getName(), attached: true };
  } catch (error) {
    throw new Error('Failed to upload file: ' + error.message);
  }
}

/** =====================[ EXPORT & REPAIR ]===================== **/
function exportData(format) {
  const records = getRecords();
  if (format === 'csv') {
    const headers = ['ID','Timestamp','Department','Staff','AssetID','AssetName','TaskType','StartDate','DueDate','CompletedDate','Status','Priority','DowntimeHours','Notes'];
    const rows = records.map(r => headers.map(h => r[h] || ''));
    return { csv: [headers, ...rows].map(row => row.join(',')).join('\n') };
  }
  return { records };
}

function repairSheets() {
  const ss = SpreadsheetApp.openById(CONFIG.sheetId);
  const recordsHeaders = ['ID','Timestamp','Department','Staff','AssetID','AssetName','TaskType','StartDate','DueDate','CompletedDate','Status','Priority','DowntimeHours','File','Certificate','Notes'];
  const assetsHeaders = ['ID','Department','Category','Room','Name','Model','Serial','Status','Frequency','LastPM','NextPM','Notes'];
  const staffHeaders = ['Name'];

  ['Records', 'Assets', 'Staff'].forEach((name, i) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      const headers = i === 0 ? recordsHeaders : (i === 1 ? assetsHeaders : staffHeaders);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  });
  return { repaired: true };
}
