/**
 * رفع السير الذاتية والموهلات الدراسية – مجمع مكة الطبي
 * يُربط مع: Sheet (Management) + مجلد Drive للملفات
 * الحماية: رقم سري للرفع والعرض
 */

// ـــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ
// الإعدادات (غيّرها أو انقل الرقم السري إلى Script Properties)
// ـــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ
var MANAGEMENT_SHEET_ID = '12Pw7s6fT4Qd3fZHZUcsJE79JuYnIzwk6vr69Uv-pFEg';
var MANAGEMENT_DRIVE_FOLDER_ID = '1NuhHv_8rnCZghPxmW6YUPrSOn9IkRDsh';
// الرقم السري للرفع والعرض (للإنتاج: ضعه في Script Properties باسم UPLOAD_PASSWORD)
var UPLOAD_PASSWORD = 'Makkah3026';

var MANAGEMENT_SHEET_NAME = 'الموهلات';

function _getPassword() {
  var p = PropertiesService.getScriptProperties().getProperty('UPLOAD_PASSWORD');
  return p && p.trim() ? p.trim() : UPLOAD_PASSWORD;
}

function _getSheet() {
  var ss = SpreadsheetApp.openById(MANAGEMENT_SHEET_ID);
  var sheet = ss.getSheetByName(MANAGEMENT_SHEET_NAME) || (ss.getSheets().length ? ss.getSheets()[0] : null);
  if (!sheet) sheet = ss.insertSheet(MANAGEMENT_SHEET_NAME);
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, 5).setValues([['الاسم', 'نوع الوثيقة', 'رابط الملف', 'اسم الملف', 'تاريخ الرفع']]);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  }
  return sheet;
}

function _getDriveFolder() {
  return DriveApp.getFolderById(MANAGEMENT_DRIVE_FOLDER_ID);
}

/**
 * doGet: إما صفحة الرفع/العرض، أو قائمة الموّهلات (JSON)
 */
function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var action = (params.action || '').toString().toLowerCase();

  if (action === 'list') {
    var pass = (params.password || '').toString().trim();
    if (pass !== _getPassword()) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'رقم سري غير صحيح' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var list = _listQualifications(params.name ? (params.name || '').toString().trim() : '');
    return ContentService.createTextOutput(JSON.stringify({ ok: true, rows: list }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // عرض الكريدنشالس للزوار (بدون رقم سري) — للربط من صفحة الإدارة
  if (action === 'getcredentials' || action === 'getCredentials') {
    var name = (params.name || '').toString().trim();
    var list = _listQualificationsForDisplay(name);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, name: name, items: list }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  }

  var html = HtmlService.createTemplateFromFile('ManagementUpload');
  html.sheetId = MANAGEMENT_SHEET_ID;
  html.folderId = MANAGEMENT_DRIVE_FOLDER_ID;
  return html.evaluate()
    .setTitle('رفع الموّهلات – مجمع مكة الطبي')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * doPost: رفع ملف (صورة/PDF) – body JSON: name, password, docType, fileBase64, filename
 */
function doPost(e) {
  var result = { ok: false, error: '' };
  try {
    var body = e.postData && e.postData.contents ? e.postData.contents : (e.parameter && e.parameter.payload ? e.parameter.payload : '{}');
    var data = JSON.parse(body);
    var name = (data.name || '').toString().trim();
    var password = (data.password || '').toString().trim();
    var docType = (data.docType || '').toString().trim() || 'موهلة دراسية';
    var fileBase64 = data.fileBase64;
    var filename = (data.filename || 'document').toString().trim();

    if (!name) {
      result.error = 'الاسم مطلوب';
      return _jsonOutput(result);
    }
    if (password !== _getPassword()) {
      result.error = 'رقم سري غير صحيح';
      return _jsonOutput(result);
    }
    if (!fileBase64) {
      result.error = 'لم يُرفع ملف';
      return _jsonOutput(result);
    }

    var blob = _base64ToBlob(fileBase64, filename);
    var folder = _getDriveFolder();
    var safeName = name.replace(/[/\\?*:]/g, '_');
    var ext = filename.split('.').pop() || 'pdf';
    if (ext.length > 5) ext = 'pdf';
    var driveName = safeName + '_' + (docType || 'وثيقة') + '_' + new Date().getTime() + '.' + ext;
    var file = folder.createFile(blob).setName(driveName);
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    var fileUrl = file.getUrl();

    var sheet = _getSheet();
    var dateStr = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm');
    sheet.appendRow([name, docType, fileUrl, driveName, dateStr]);
    result.ok = true;
    result.fileUrl = fileUrl;
  } catch (err) {
    result.error = err.message || 'خطأ في الرفع';
  }
  return _jsonOutput(result);
}

function _jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _base64ToBlob(base64, filename) {
  var parts = base64.split(';base64,');
  var contentType = 'application/octet-stream';
  if (parts.length > 1 && parts[0].indexOf('data:') === 0) {
    contentType = parts[0].replace('data:', '').trim();
  }
  var raw = base64.replace(/^data:image\/\w+;base64,/, '').replace(/^data:application\/pdf;base64,/, '');
  var bytes = Utilities.base64Decode(raw);
  return Utilities.newBlob(bytes).setContentType(contentType).setName(filename);
}

function _listQualifications(filterName) {
  var sheet = _getSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var name = (r[0] || '').toString().trim();
    if (filterName && name !== filterName) continue;
    rows.push({
      name: name,
      docType: (r[1] || '').toString().trim(),
      fileUrl: (r[2] || '').toString().trim(),
      fileName: (r[3] || '').toString().trim(),
      date: (r[4] || '').toString().trim()
    });
  }
  return rows;
}

/** للعرض العام من الموقع: مطابقة جزئية على الاسم (يحتوي أو يساوي) */
function _listQualificationsForDisplay(searchName) {
  var sheet = _getSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var rows = [];
  var search = (searchName || '').toString().trim();
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var name = (r[0] || '').toString().trim();
    if (search && name.indexOf(search) === -1 && search.indexOf(name) === -1) continue;
    rows.push({
      docType: (r[1] || '').toString().trim(),
      fileUrl: (r[2] || '').toString().trim(),
      fileName: (r[3] || '').toString().trim(),
      date: (r[4] || '').toString().trim()
    });
  }
  return rows;
}

/** للاستدعاء من الواجهة عبر google.script.run */
function listQualifications(password, filterName) {
  if ((password || '').toString().trim() !== _getPassword()) return [];
  return _listQualifications((filterName || '').toString().trim());
}

/**
 * رفع وثيقة من الواجهة (google.script.run)
 */
function uploadQualification(name, password, docType, fileBase64, filename) {
  if ((name || '').toString().trim() === '') return { ok: false, error: 'الاسم مطلوب' };
  if ((password || '').toString().trim() !== _getPassword()) return { ok: false, error: 'رقم سري غير صحيح' };
  if (!fileBase64) return { ok: false, error: 'لم يُرفع ملف' };
  docType = (docType || '').toString().trim() || 'موهلة دراسية';
  filename = (filename || 'document').toString().trim();

  var blob = _base64ToBlob(fileBase64, filename);
  var folder = _getDriveFolder();
  var safeName = name.replace(/[/\\?*:]/g, '_');
  var ext = filename.split('.').pop() || 'pdf';
  if (ext.length > 5) ext = 'pdf';
  var driveName = safeName + '_' + docType + '_' + new Date().getTime() + '.' + ext;
  var file = folder.createFile(blob).setName(driveName);
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  var fileUrl = file.getUrl();

  var sheet = _getSheet();
  var dateStr = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm');
  sheet.appendRow([name, docType, fileUrl, driveName, dateStr]);
  return { ok: true, fileUrl: fileUrl };
}
