/***********************************************************
* 🌟 نظام معايرة الأجهزة الطبية – مجمع مكة الطبي بالزاهر
* نسخة ثابتة 2025
* - CAL_Log مع Pass/Fail واضح
* - PDF RTL بالعربية + رمز QR حقيقي (إن أمكن)
* - تواريخ بصيغة yyyy-MM-dd بدون مشاكل فرق توقيت
* - تجاوز يوم الجمعة (إجازة أسبوعية)
***********************************************************/


const CONFIG = {
 SHEETS: { ASSETS: 'AssetTasks', STAFF: 'Staff', LOG: 'CAL_Log' },
 DEPT_FOLDER_MAP: {
   'CSSD': '1ex3Zniu3zNJ9PUk2uD2nbWBG5rH76jtW',
   'RAD':  '1upfBhin4V8rZ0y2k3kkPPEt7kqSdXPTP',
   'ER':   '1N-GV4jMOZQX3PChwUtCzw7GccaciBl3q',
   'LAB':  '1-srsMxXPBzhDnhW6JdHxQQC_HVU9NBWX'
 },
 SIGNERS: ['الأستاذ صابر عبده', 'الأستاذ عدنان الرفاعي'],
 DEFAULT_DRIVE_FOLDER: 'CAL_Certificates',
 TIMEZONE: 'Asia/Riyadh'
};


/* =========================================================
* 🟢 doGet — قراءة البيانات (الأجهزة + الموظفين + السجل)
* =======================================================*/
function doGet(e) {
 try {
   const ss = SpreadsheetApp.getActiveSpreadsheet();
   const assetsMap = getAssetsMap_(ss);
   const staffList = getStaffList_(ss);
   const records   = getCalibrationLog_(ss);
   return respondSuccess({ assetsMap, staffList, records });
 } catch (err) {
   return respondError(err);
 }
}


/* =========================================================
* 🟠 doPost — استلام بيانات النموذج + رفع الملف + الشهادة
* =======================================================*/
function doPost(e) {
 try {
   if (!e || !e.postData || !e.postData.contents) {
     throw new Error('Empty POST body');
   }


   const body = JSON.parse(e.postData.contents);
   const d = body.data || {};
   const fileData = body.fileData || {};


   // 🗂️ اختيار مجلد القسم
   const folderId =
     CONFIG.DEPT_FOLDER_MAP[d.department] ||
     getOrCreateFolderByName_(CONFIG.DEFAULT_DRIVE_FOLDER).getId();
   const folder = DriveApp.getFolderById(folderId);


   // 📤 رفع الملف الأصلي (PDF/صورة)
   let fileUrl = '';
   if (fileData.base64) {
     const saved = saveBlobToFolder_(fileData, folder);
     fileUrl = saved.url;
   }


   // 🧾 إنشاء شهادة PDF (RTL + QR)
   const pdfFile = createCertificatePdf_(d, fileUrl, folder);
   const certUrl = pdfFile.getUrl();


   // 🧮 تسجيل السطر في CAL_Log
   const ss = SpreadsheetApp.getActiveSpreadsheet();
   const sh = ss.getSheetByName(CONFIG.SHEETS.LOG);
   const now = Utilities.formatDate(
     new Date(),
     CONFIG.TIMEZONE,
     'yyyy-MM-dd HH:mm:ss'
   );
   
   // حساب تاريخ الاستحقاق مع تجاوز الجمعة للتكرار اليومي
   let nextDue = d.nextDue || '';
   if (d.frequency && d.frequency.includes('يومي') && d.testDate) {
     nextDue = calculateNextDueSkipFriday_(d.testDate);
   }

   sh.appendRow([
     now,
     d.department || '',
     d.staff || '',
     d.assetID || '',
     d.assetName || '',
     d.testDate || '',
     d.frequency || '',
     nextDue,
     d.result || '',
     fileUrl,
     certUrl
   ]);


   const newRecord = {
     Timestamp: now,
     Department: d.department || '',
     Staff: d.staff || '',
     AssetID: d.assetID || '',
     AssetName: d.assetName || '',
     TestDate: normalizeYMD_(d.testDate),
     Frequency: d.frequency || '',
     NextDue: normalizeYMD_(nextDue),
     Result: normalizeResult_(d.result),
     File: fileUrl,
     Certificate: certUrl
   };


   return respondSuccess(
     { newRecord },
     '✅ تم الحفظ وإنشاء الشهادة بنجاح.'
   );
 } catch (err) {
   return respondError(err);
 }
}


/* =========================================================
* 📦 رفع الملف في المجلد المناسب
* =======================================================*/
function saveBlobToFolder_(fileData, folder) {
 const blob = Utilities.newBlob(
   Utilities.base64Decode(fileData.base64),
   fileData.mimeType,
   fileData.fileName
 );
 const file = folder.createFile(blob);
 file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
 return { id: file.getId(), url: file.getUrl(), name: file.getName() };
}


/* =========================================================
* 🗓️ حساب تاريخ الاستحقاق مع تجاوز الجمعة
* =======================================================*/
function calculateNextDueSkipFriday_(testDate) {
  const d = parseYMD_(testDate);
  if (!d) return '';
  
  // إضافة يوم واحد
  d.setDate(d.getDate() + 1);
  
  // إذا كان اليوم جمعة (5)، ننتقل للسبت
  if (d.getDay() === 5) {
    d.setDate(d.getDate() + 1);
  }
  
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function parseYMD_(value) {
  if (!value) return null;
  const s = value.toString().trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}


/* =========================================================
* 🧾 إنشاء شهادة PDF RTL + QR
* =======================================================*/
function createCertificatePdf_(d, fileUrl, folder) {
  const doc = DocumentApp.create('Certificate_' + (d.assetID || ''));
  const body = doc.getBody();

  body.setPageWidth(595.28);
  body.setPageHeight(841.89);
  body.setMarginTop(36);
  body.setMarginBottom(36);
  body.setMarginRight(36);
  body.setMarginLeft(36);
  try {
    body.setDocumentDirection(DocumentApp.DocumentDirection.RIGHT_TO_LEFT);
  } catch (e) {}

  function addRight(text, heading) {
    const p = body.appendParagraph(text);
    if (heading) p.setHeading(heading);
    p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    try {
      p.setTextAlignment(DocumentApp.TextAlignment.RIGHT);
      p.setLeftToRight(false);
    } catch (e) {}
    return p;
  }

  addRight('شهادة معايرة الأجهزة الطبية', DocumentApp.ParagraphHeading.HEADING1)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  addRight('مجمع مكة الطبي بالزاهر')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  body.appendParagraph(' ');

  const dateNow = Utilities.formatDate(
    new Date(),
    CONFIG.TIMEZONE,
    'yyyy-MM-dd HH:mm:ss'
  );

  const resultText =
    normalizeResult_(d.result) === 'Pass'
      ? 'مطابق (Pass)'
      : 'غير مطابق (Fail)';

  const tableData = [
    ['القسم', d.department || '—'],
    ['اسم الفني المنفذ', d.staff || '—'],
    ['رقم / اسم الجهاز', d.assetName || d.assetID || '—'],
    ['النتيجة', resultText],
    ['تاريخ الاختبار', d.testDate || '—'],
    ['تاريخ الاستحقاق القادم', d.nextDue || '—'],
    ['تاريخ الطباعة', dateNow],
    ['رابط التقرير المرفوع', fileUrl || '—']
  ];

  const infoTable = body.appendTable(tableData);
  infoTable.setBorderWidth(1);
  infoTable.setBorderColor('#888888');

  for (let r = 0; r < infoTable.getNumRows(); r++) {
    const row = infoTable.getRow(r);
    const labelCell = row.getCell(0);
    const valueCell = row.getCell(1);

    labelCell.setBackgroundColor('#f5f5f5');
    const labelChildren = labelCell.getNumChildren();
    for (let i = 0; i < labelChildren; i++) {
      const child = labelCell.getChild(i);
      if (child.getType && child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        const p = child.asParagraph();
        p.setBold(true);
        p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
        try { p.setTextAlignment(DocumentApp.TextAlignment.RIGHT); } catch (e) {}
      }
    }

    const valueChildren = valueCell.getNumChildren();
    for (let i = 0; i < valueChildren; i++) {
      const child = valueCell.getChild(i);
      if (child.getType && child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        const p = child.asParagraph();
        p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
        try { p.setTextAlignment(DocumentApp.TextAlignment.RIGHT); } catch (e) {}
      }
    }
  }

  try {
    infoTable.setColumnWidth(0, 140);
    infoTable.setColumnWidth(1, 350);
  } catch (e) {}

  body.appendParagraph(' ');

  const signTitle = addRight('التوقيعات:', null);
  signTitle.setBold(true);

  const signTable = body.appendTable([
    ['توقيع المنفذ', 'مدير إدارة الصيانة', 'مدير إدارة المرافق والسلامة (FMS)'],
    [
      d.staff || '........................',
      'الأستاذ عدنان الرفاعي',
      'الأستاذ صابر عبده'
    ]
  ]);

  signTable.setBorderWidth(0);

  for (let r = 0; r < signTable.getNumRows(); r++) {
    const row = signTable.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      cell.setPaddingTop(10);
      cell.setPaddingBottom(r === 0 ? 5 : 25);

      const childCount = cell.getNumChildren();
      for (let i = 0; i < childCount; i++) {
        const child = cell.getChild(i);
        if (child.getType && child.getType() === DocumentApp.ElementType.PARAGRAPH) {
          const p = child.asParagraph();
          p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
          try { p.setTextAlignment(DocumentApp.TextAlignment.RIGHT); } catch (e) {}
          if (r === 0) p.setBold(true);
        }
      }
    }
  }
  
  if (fileUrl) {
    try {
      const qrUrl =
        'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' +
        encodeURIComponent(fileUrl);
      const qrBlob = UrlFetchApp.fetch(qrUrl).getBlob()
        .setName('QR_' + (d.assetID || 'cal') + '.png');

      const qrParagraph = body.appendParagraph('');
      qrParagraph.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      const img = qrParagraph.appendInlineImage(qrBlob);
      img.setWidth(120).setHeight(120);

      const qrCaption = body.appendParagraph(
        'رمز الاستجابة السريعة (QR) لفتح تقرير المعايرة إلكترونيًا.'
      );
      qrCaption.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      qrCaption.setFontSize(10);
    } catch (qrErr) {
      Logger.log('QR error: ' + qrErr);
    }
  }

  body.appendParagraph(' ');

  const footer = addRight(
    'تم إصدار هذه الشهادة إلكترونيًا عبر نظام معايرة الأجهزة الطبية (CAL).'
  );
  footer.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  footer.setFontSize(10);

  doc.saveAndClose();

  const pdfBlob = doc.getAs('application/pdf')
    .setName('Certificate_' + (d.assetID || '') + '.pdf');
  const pdfFile = folder.createFile(pdfBlob);
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  DriveApp.getFileById(doc.getId()).setTrashed(true);

  return pdfFile;
}


/* =========================================================
* 📊 قراءة جداول Google Sheet
* =======================================================*/

function normalizeYMD_(value) {
 if (!value) return '';
 if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
   return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
 }
 const s = value.toString().trim();
 if (!s) return '';
 if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
 const maybe = new Date(s);
 if (!isNaN(maybe)) {
   return Utilities.formatDate(maybe, CONFIG.TIMEZONE, 'yyyy-MM-dd');
 }
 return s;
}


function normalizeResult_(value) {
 if (!value) return 'Fail';
 const cleaned = value.toString().trim().replace(/\s/g, '').toLowerCase();
 return cleaned === 'pass' ? 'Pass' : 'Fail';
}


function getAssetsMap_(ss) {
 const sh = ss.getSheetByName(CONFIG.SHEETS.ASSETS);
 const vals = sh.getDataRange().getValues();
 const h = vals[0], rows = vals.slice(1);
 const iDept = h.indexOf('Department');
 const iID   = h.indexOf('TaskID');
 const iName = h.indexOf('TaskName');
 const map = {};
 rows.forEach(r => {
   const dept = r[iDept];
   const id   = r[iID];
   const name = r[iName];
   if (!dept || !id) return;
   if (!map[dept]) map[dept] = [];
   map[dept].push({ id, name });
 });
 return map;
}


function getStaffList_(ss) {
 const sh = ss.getSheetByName(CONFIG.SHEETS.STAFF);
 const vals = sh.getDataRange().getValues();
 const h = vals[0], rows = vals.slice(1);
 const iName = h.indexOf('StaffName');
 return rows.map(r => r[iName]).filter(Boolean);
}


function getCalibrationLog_(ss) {
 const sh = ss.getSheetByName(CONFIG.SHEETS.LOG);
 if (!sh) return [];
 const vals = sh.getDataRange().getValues();
 if (vals.length < 2) return [];
 const h = vals[0], rows = vals.slice(1);
 
 return rows.map(r => {
   const obj = {};
   h.forEach((col, i) => {
     obj[col] = r[i];
   });
   
   // قراءة File و Certificate بالـ index (العمود J=9, K=10) كـ fallback
   const fileByIndex = r[9] || '';
   const certByIndex = r[10] || '';
   
   return {
     Timestamp: obj.Timestamp || '',
     Department: obj.Department || '',
     Staff: obj.Staff || '',
     AssetID: obj.AssetID || '',
     AssetName: obj.AssetName || '',
     TestDate: normalizeYMD_(obj.TestDate),
     Frequency: obj.Frequency || '',
     NextDue: normalizeYMD_(obj.NextDue),
     Result: normalizeResult_(obj.Result),
     File: obj.File || fileByIndex || '',
     Certificate: obj.CertificateLink || obj.Certificate || certByIndex || ''
   };
 });
}


function getOrCreateFolderByName_(name) {
 const folders = DriveApp.getFoldersByName(name);
 if (folders.hasNext()) return folders.next();
 return DriveApp.createFolder(name);
}


function respondSuccess(data, message) {
 return ContentService.createTextOutput(JSON.stringify({
   status: 'success',
   message: message || 'OK',
   data: data
 })).setMimeType(ContentService.MimeType.JSON);
}


function respondError(err) {
 return ContentService.createTextOutput(JSON.stringify({
   status: 'error',
   message: err.message || 'Unknown error'
 })).setMimeType(ContentService.MimeType.JSON);
}
