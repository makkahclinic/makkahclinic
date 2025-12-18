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
  if (!dept) {
    return CONFIG.folders['🏢 المبنى (Building)'];
  }

  const norm = _normDeptName(dept);
  const withDash = norm.replace(/\s+/g, '-');

  if (DEPT_CODE_MAP[withDash]) {
    const key = DEPT_CODE_MAP[withDash];
    const folderId = CONFIG.folders[key];
    if (folderId) return folderId;
  }

  if (DEPT_CODE_MAP[norm]) {
    const key = DEPT_CODE_MAP[norm];
    const folderId = CONFIG.folders[key];
    if (folderId) return folderId;
  }

  if (CONFIG.folders[dept]) {
    return CONFIG.folders[dept];
  }

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
    if (String(data[i][0]).trim() === String(id).trim()) {
      return i + 1;
    }
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
  try {
    return new Date(dateString).toLocaleDateString('ar-SA');
  } catch (error) {
    return dateString;
  }
}

function formatDateForFileName(dateString) {
  if (!dateString) return 'unknown';
  try {
    return Utilities.formatDate(new Date(dateString), 'Asia/Riyadh', 'yyyy-MM-dd');
  } catch (error) {
    return 'unknown-date';
  }
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

    if (action === 'viewCert' && params.id) {
      return renderCertificatePage_(params.id);
    }

    const result = action ? handleApiRequest(params) : {
      ok: true,
      time: new Date().toISOString(),
      version: '2.0'
    };

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: String(err && err.message || err)
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    let params = {};
    if (e && e.postData) {
      params = JSON.parse(e.postData.contents || '{}');
    }
    const result = handleApiRequest(params);
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: String(err && err.message || err)
      }))
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
    case 'addRecord':           return addRecord(params);
    case 'updateRecord':        return updateRecord(params);
    case 'deleteRecord':        return deleteRecord(params);
    case 'uploadFile':          return uploadFile(params);
    case 'generateCertificate': return generateCertificate(params);
    case 'export':              return exportData(params.format);
    case 'repair':              return repairSheets();
    case 'getStats':            return getKPIs();
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
      ID:            row[0],
      Timestamp:     row[1],
      Department:    row[2],
      Staff:         row[3],
      AssetID:       row[4],
      AssetName:     row[5],
      TaskType:      row[6],
      StartDate:     row[7],
      DueDate:       row[8],
      CompletedDate: row[9],
      Status:        row[10],
      Priority:      row[11],
      DowntimeHours: row[12],
      File:          row[13],
      Certificate:   row[14],
      Notes:         row[15]
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
        id:       row[0],
        name:     row[4] || '',
        room:     row[3] || '',
        serial:   row[6] || '',
        status:   row[7] || '',
        frequency: row[8] || '',
        lastPM:   row[9] || '',
        nextPM:   row[10] || ''
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
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getValues()
      .flat()
      .filter(Boolean);
  } catch (error) {
    throw new Error('فشل في جلب الفنيين: ' + error.message);
  }
}

/** =====================[ KPI CALCULATIONS - UPDATED VERSION WITH 3 DEVICE COUNTS ]===================== **/
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
      assetNextDueDates[assetId] = {
        dueDate: dueDate,
        record: r
      };
    }
  });

  Object.values(assetNextDueDates).forEach(({ dueDate, record }) => {
    dueDate.setHours(0, 0, 0, 0);
    
    const status = String(record.Status || '').trim();
    
    if (status === 'OutOfService') return;
    
    if (dueDate < now) {
      overdue++;
    } else if (dueDate.getFullYear() === currentYear && 
               dueDate.getMonth() === currentMonth) {
      dueThisMonth++;
    }
  });

  // ====== ✅ أرقام على مستوى الأجهزة (Unique Devices) - التعديل الجديد ======
  let servicedDevices = 0;
  const overdueDevices = overdue;

  // نجمع حالة "آخر سجل" لكل جهاز بناءً على الأحدث في السجلات
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

  // 4) أجهزة لم تتم صيانتها نهائياً
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

  // ✅ حساب نسبة الإنجاز بناءً على الأجهزة المصانة وليس السجلات
  const completionRate = totalDevices
    ? Math.round((servicedDevices / totalDevices) * 100)
    : 0;

  // ✅ النتيجة النهائية مع الحقول الثلاثة الجديدة
  return {
    totalDevices,          // ✅ عدد الأجهزة كاملة
    servicedDevices,       // ✅ عدد الأجهزة المصانة
    overdueDevices,        // ✅ عدد الأجهزة المتأخرة (بالأحمر)
    notServicedDevices,    // عدد الأجهزة غير المصانة
    notServiced,
    dueThisMonth,
    overdue,
    outOfService,
    completed,
    critical,
    uncompleted,
    downtime: Math.round(downtime),
    completionRate,
    mttr
  };
}

/** =====================[ WRITE OPERATIONS ]===================== **/
function addRecord(params) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet('Records');
    if (!sheet) throw new Error('جدول Records غير موجود. يرجى تشغيل إصلاح الجداول أولاً.');

    const id = Utilities.getUuid();
    const timestamp = new Date().toISOString();

    const row = [
      id,
      timestamp,
      params.department,
      params.staff,
      params.assetID,
      params.assetName,
      params.taskType,
      params.startDate,
      params.dueDate,
      params.completedDate,
      params.status,
      params.priority,
      params.downtimeHours,
      '',
      '',
      params.notes || ''
    ];

    sheet.appendRow(row);

    return {
      ID: id,
      Timestamp: timestamp,
      Department: params.department,
      Staff: params.staff,
      AssetID: params.assetID,
      AssetName: params.assetName,
      TaskType: params.taskType,
      StartDate: params.startDate,
      DueDate: params.dueDate,
      CompletedDate: params.completedDate,
      Status: params.status,
      Priority: params.priority,
      DowntimeHours: params.downtimeHours
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
      row[0],
      row[1],
      params.department || row[2],
      params.staff || row[3],
      params.assetID || row[4],
      params.assetName || row[5],
      params.taskType || row[6],
      params.startDate || row[7],
      params.dueDate || row[8],
      params.completedDate || row[9],
      params.status || row[10],
      params.priority || row[11],
      params.downtimeHours || row[12],
      row[13],
      row[14],
      params.notes || row[15]
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

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (_) {}

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

/** =====================[ QR & CERTIFICATES ]===================== **/
function createQrDataUrl_(text) {
  const url = 'https://quickchart.io/qr?text=' + encodeURIComponent(text) + '&size=220';
  const resp = UrlFetchApp.fetch(url);
  const blob = resp.getBlob();
  const bytes = blob.getBytes();
  const base64 = Utilities.base64Encode(bytes);
  return 'data:image/png;base64,' + base64;
}

function generateCertificate(params) {
  try {
    const sheet = getSheet('Records');
    if (!sheet) throw new Error('جدول Records غير موجود');

    const rowIndex = findRowIndexById_(sheet, params.id);
    if (rowIndex === -1) throw new Error('Record not found');

    const row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];

    const record = {
      ID: row[0],
      Timestamp: row[1],
      Department: row[2],
      Staff: row[3],
      AssetID: row[4],
      AssetName: row[5],
      TaskType: row[6],
      StartDate: row[7],
      DueDate: row[8],
      CompletedDate: row[9],
      Status: row[10],
      Priority: row[11],
      DowntimeHours: row[12],
      File: row[13],
      Certificate: row[14],
      Notes: row[15]
    };

    let qrPayload;
    if (record.File && record.File.trim() !== '') {
      const fileUrls = record.File.split(',').map(url => url.trim()).filter(url => url !== '');
      if (fileUrls.length > 0) {
        qrPayload = fileUrls[0];
      } else {
        qrPayload = record.Certificate;
      }
    } else {
      qrPayload = record.Certificate;
    }

    const pdf = createCertificatePDF(
      record,
      params.fmsManager || CONFIG.fmsManager,
      params.fmsDeputy || CONFIG.fmsDeputy,
      qrPayload
    );

    pdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    sheet.getRange(rowIndex, 15).setValue(pdf.getUrl());

    return { url: pdf.getUrl(), id: pdf.getId() };
  } catch (error) {
    throw new Error('Failed to generate certificate: ' + error.message);
  }
}

function createCertificatePDF(record, manager, deputy, qrPayload) {
  const folderId = resolveDepartmentFolder(record.Department);
  const folder = DriveApp.getFolderById(folderId);

  const now = new Date();
  const year = now.getFullYear();
  const shortId = String(record.ID || '').substring(0, 8);
  const certNumber = 'MC-FMS-' + year + '-' + shortId;

  if (!qrPayload) {
    const webAppUrl = ScriptApp.getService().getUrl();
    if (webAppUrl) {
      qrPayload = webAppUrl + '?action=viewCert&id=' + encodeURIComponent(record.ID || '');
    } else {
      qrPayload =
        'شهادة صيانة رقم: ' + certNumber + '\n' +
        'القسم: ' + (record.Department || '-') + '\n' +
        'الجهاز: ' + (record.AssetName || record.AssetID || '-') + '\n' +
        'الحالة: ' + (record.Status || '-') + '\n' +
        'تاريخ التنفيذ: ' + formatDate(record.StartDate) + '\n' +
        'تاريخ الإغلاق: ' + formatDate(record.CompletedDate);
    }
  }

  const qrDataUrl = createQrDataUrl_(qrPayload);

  const qrDescription = record.File && record.File.trim() !== '' ? 
    'امسح الكود لفتح الملف المرفق' : 
    'امسح الكود لعرض تفاصيل الشهادة';

  const html = `<!DOCTYPE html>
  <html dir="rtl">
  <head>
  <meta charset="utf-8">
  <style>
   body { font-family: Arial, sans-serif; margin:0; padding:40px; background:#fff; }
   .page {
     max-width:800px; margin:0 auto; color:#000; line-height:1.8;
     font-size:14px; border:1px solid #ccc; padding:32px 40px;
   }
   h1,h2 { margin:0; text-align:center; }
   h1 { font-size:22px; margin-bottom:4px; }
   h2 { font-size:18px; margin-bottom:16px; }
   .meta {
     display:flex; justify-content:space-between;
     margin-top:8px; margin-bottom:18px; font-size:13px;
   }
   .section-title {
     font-size:15px; font-weight:bold; margin:16px 0 8px; text-decoration:underline;
   }
   .details {
     width:100%; border-collapse:collapse; margin-bottom:24px; font-size:13px;
   }
   .details th,.details td {
     padding:6px 8px; border:1px solid #ccc; text-align:right; vertical-align:top;
   }
   .details th { width:25%; background:#f2f2f2; font-weight:bold; }
   .bottom-row {
     display:flex; justify-content:space-between; align-items:flex-start;
     margin-top:24px; border-top:1px solid #ccc; padding-top:16px;
   }
   .signatures { display:flex; gap:32px; font-size:12px; }
   .sig-box { text-align:center; min-width:140px; }
   .sig-box .title { margin-bottom:6px; }
   .sig-box .name  { font-weight:bold; margin-top:20px; }
   .qr-block { text-align:center; font-size:10px; color:#555; }
   .qr-block img {
     width:120px; height:120px; border:1px solid #ddd; border-radius:4px;
   }
   .footer-note { margin-top:24px; font-size:11px; text-align:center; color:#555; }
  </style>
  </head>
  <body>
  <div class="page">
   <h1>مجمع مكة الطبي بالزاهر</h1>
   <h2>شهادة إنجاز مهمة صيانة جهاز طبي</h2>

   <div class="meta">
     <span><strong>التاريخ:</strong> ${formatDate(record.CompletedDate)}</span>
     <span><strong>رقم الشهادة:</strong> ${certNumber}</span>
   </div>

   <div class="section-title">تفاصيل المهمة</div>
   <table class="details">
     <tr><th>القسم</th><td>${record.Department || '-'}</td></tr>
     <tr><th>الجهاز</th><td>${record.AssetName || record.AssetID || '-'}</td></tr>
     <tr><th>رقم الجهاز</th><td>${record.AssetID || '-'}</td></tr>
     <tr><th>الفني المنفذ</th><td>${record.Staff || '-'}</td></tr>
     <tr><th>نوع المهمة</th><td>${record.TaskType === 'PM' ? 'صيانة وقائية (PM)' : 'صيانة تصحيحية (CM)'}</td></tr>
     <tr><th>الحالة</th><td>${record.Status || '-'}</td></tr>
     <tr><th>تاريخ التنفيذ</th><td>${formatDate(record.StartDate)}</td></tr>
     <tr><th>تاريخ الإغلاق</th><td>${formatDate(record.CompletedDate)}</td></tr>
     <tr><th>ساعات التوقف</th><td>${record.DowntimeHours || '0'}</td></tr>
     <tr><th>ملاحظات</th><td>${record.Notes || 'لا توجد ملاحظات'}</td></tr>
   </table>

   <div class="bottom-row">
     <div class="signatures">
       <div class="sig-box">
         <div class="title">منفذ العمل</div>
         <div class="name">${record.Staff || ''}</div>
       </div>
       <div class="sig-box">
         <div class="title">رئيس لجنة إدارة المرافق (FMS)</div>
         <div class="name">${manager}</div>
       </div>
       <div class="sig-box">
         <div class="title">مدير إدارة الصيانة</div>
         <div class="name">${deputy}</div>
       </div>
     </div>
     <div class="qr-block">
       <img src="${qrDataUrl}" alt="QR Code">
       <div>${qrDescription}</div>
     </div>
   </div>

   <p class="footer-note">
     تم توليد هذه الشهادة تلقائياً من نظام إدارة الصيانة – مجمع مكة الطبي بالزاهر
   </p>
  </div>
  </body>
  </html>`;

  const blob = Utilities.newBlob(html, 'text/html', 'certificate.html');
  const pdf = blob.getAs('application/pdf');
  const fileName =
    'شهادة_صيانة_' + (record.AssetID || 'جهاز') + '_' +
    formatDateForFileName(record.CompletedDate) + '.pdf';

  return folder.createFile(pdf).setName(fileName);
}

function renderCertificatePage_(id) {
  const sheet = getSheet('Records');
  if (!sheet) {
    return HtmlService.createHtmlOutput('<h3>لا يمكن الوصول لجدول Records</h3>');
  }
  const rowIndex = findRowIndexById_(sheet, id);
  if (rowIndex === -1) {
    return HtmlService.createHtmlOutput('<h3>الشهادة غير موجودة أو تم حذفها</h3>');
  }

  const row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];

  const record = {
    ID: row[0],
    Timestamp: row[1],
    Department: row[2],
    Staff: row[3],
    AssetID: row[4],
    AssetName: row[5],
    TaskType: row[6],
    StartDate: row[7],
    DueDate: row[8],
    CompletedDate: row[9],
    Status: row[10],
    Priority: row[11],
    DowntimeHours: row[12],
    Notes: row[15]
  };

  const html = `<!DOCTYPE html>
  <html dir="rtl">
  <head>
  <meta charset="utf-8">
  <title>تفاصيل شهادة الصيانة</title>
  <style>
   body { font-family: Arial, sans-serif; background:#f5f5f5; margin:0; padding:20px; }
   .card {
     max-width:700px; margin:0 auto; background:#fff; padding:20px 24px;
     border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,.1);
   }
   h1 { margin-top:0; font-size:22px; text-align:center; }
   .meta { text-align:center; font-size:13px; color:#555; margin-bottom:16px; }
   table { width:100%; border-collapse:collapse; font-size:13px; }
   th, td { padding:6px 8px; border-bottom:1px solid #eee; text-align:right; }
   th { width:30%; color:#555; }
   .status { font-weight:bold; }
  </style>
  </head>
  <body>
  <div class="card">
   <h1>تفاصيل شهادة / تقرير الصيانة</h1>
   <div class="meta">
     رقم الشهادة (ID): ${record.ID}<br>
     التاريخ: ${formatDate(record.CompletedDate)}
   </div>
   <table>
     <tr><th>القسم</th><td>${record.Department || '-'}</td></tr>
     <tr><th>الجهاز</th><td>${record.AssetName || record.AssetID || '-'}</td></tr>
     <tr><th>رقم الجهاز</th><td>${record.AssetID || '-'}</td></tr>
     <tr><th>الفني المنفذ</th><td>${record.Staff || '-'}</td></tr>
     <tr><th>نوع المهمة</th><td>${record.TaskType === 'PM' ? 'صيانة وقائية (PM)' : 'صيانة تصحيحية (CM)'}</td></tr>
     <tr><th>الحالة</th><td class="status">${record.Status || '-'}</td></tr>
     <tr><th>تاريخ التنفيذ</th><td>${formatDate(record.StartDate)}</td></tr>
     <tr><th>تاريخ الإغلاق</th><td>${formatDate(record.CompletedDate)}</td></tr>
     <tr><th>ساعات التوقف</th><td>${record.DowntimeHours || '0'}</td></tr>
     <tr><th>ملاحظات</th><td>${record.Notes || 'لا توجد ملاحظات'}</td></tr>
   </table>
  </div>
  </body>
  </html>`;

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** =====================[ EXPORT & SETUP ]===================== **/
function exportData(format) {
  return {
    url: 'about:blank',
    format: format,
    message: 'Export functionality will be implemented soon'
  };
}

function repairSheets() {
  const ss = SpreadsheetApp.openById(CONFIG.sheetId);

  const sheetDefinitions = [
    {
      name: 'Records',
      headers: [
        'ID', 'Timestamp', 'Department', 'Staff', 'AssetID', 'AssetName', 'TaskType',
        'StartDate', 'DueDate', 'CompletedDate', 'Status', 'Priority', 'DowntimeHours',
        'File', 'Certificate', 'Notes'
      ]
    },
    {
      name: 'Assets',
      headers: [
        'AssetID', 'Department', 'RoomCode', 'RoomName', 'Device', 'Count', 'Serial',
        'AssetStatus', 'PM_Frequency', 'Last_PM', 'Next_PM', 'Vendor'
      ]
    },
    {
      name: 'Staff',
      headers: ['Name']
    }
  ];

  let createdSheets = [];

  sheetDefinitions.forEach(def => {
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
      sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
      createdSheets.push(def.name);
    }

    if (def.name === 'Records') {
      sheet.getRange('B:B').setNumberFormat('@');
    }
  });

  return {
    repaired: true,
    message: 'تم إصلاح الجداول بنجاح',
    createdSheets,
    time: new Date().toISOString()
  };
}

function setup() {
  return repairSheets();
}
