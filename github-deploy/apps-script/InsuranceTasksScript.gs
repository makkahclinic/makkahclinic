/**
 * نظام إدارة مهام التدقيق التأميني - Apps Script
 * Spreadsheet ID: 1rTGa4WOw1q0IQE7KCS8TtRJ58J0guTbfgcP30cE-EWk
 * 
 * الأوراق المطلوبة:
 * - Staff: قائمة الموظفين والأطباء
 * - Audit_Tasks: مهام التدقيق
 * - Delivery_Log: سجل التسليمات
 */

const SPREADSHEET_ID = '1rTGa4WOw1q0IQE7KCS8TtRJ58J0guTbfgcP30cE-EWk';

function doGet(e) {
  const action = e.parameter.action;
  
  try {
    switch(action) {
      case 'getStaffDoctors':
      case 'getDoctors':
        return jsonResponse(getStaffDoctors());
      case 'getTasks':
        return jsonResponse(getTasks());
      case 'getTaskFile':
        return jsonResponse(getTaskFile(e.parameter.taskId));
      case 'getDeliveryLog':
        return jsonResponse(getDeliveryLog());
      default:
        return jsonResponse({ success: false, error: 'Unknown action: ' + action });
    }
  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch(err) {
    return jsonResponse({ success: false, error: 'Invalid JSON' });
  }
  
  const action = data.action || e.parameter.action;
  
  try {
    switch(action) {
      case 'getStaffDoctors':
      case 'getDoctors':
        return jsonResponse(getStaffDoctors());
      case 'addTask':
      case 'createTask':
        return jsonResponse(addTask(data));
      case 'getTasks':
        return jsonResponse(getTasks());
      case 'getTaskFile':
        return jsonResponse(getTaskFile(data.taskId));
      case 'updateTaskStatus':
        return jsonResponse(updateTaskStatus(data));
      case 'saveReport':
      case 'saveTaskReport':
        return jsonResponse(saveReport(data));
      case 'deliverTask':
      case 'confirmDelivery':
        return jsonResponse(deliverTask(data));
      default:
        return jsonResponse({ success: false, error: 'Unknown action: ' + action });
    }
  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// جلب قائمة الأطباء من شيت Staff
// ========================================
function getStaffDoctors() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Staff');
  
  if (!sheet) {
    return { success: false, error: 'Staff sheet not found' };
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return { success: true, doctors: [] };
  }
  
  const headers = data[0].map(h => String(h).trim().toLowerCase());
  
  // البحث عن أعمدة الاسم والتخصص
  const nameColIndex = findColumnIndex(headers, ['الاسم', 'name', 'اسم الطبيب', 'doctor name']);
  const specialtyColIndex = findColumnIndex(headers, ['التخصص', 'specialty', 'القسم', 'department']);
  
  const doctors = [];
  for (let i = 1; i < data.length; i++) {
    const name = data[i][nameColIndex];
    if (name && String(name).trim()) {
      doctors.push({
        name: String(name).trim(),
        specialty: specialtyColIndex >= 0 ? String(data[i][specialtyColIndex] || '').trim() : ''
      });
    }
  }
  
  return { success: true, doctors: doctors };
}

function findColumnIndex(headers, possibleNames) {
  for (const name of possibleNames) {
    const idx = headers.indexOf(name.toLowerCase());
    if (idx >= 0) return idx;
  }
  return 0; // Default to first column
}

// ========================================
// إدارة المهام
// ========================================
function getTasks() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Audit_Tasks');
  
  if (!sheet) {
    // إنشاء الورقة إذا لم تكن موجودة
    sheet = ss.insertSheet('Audit_Tasks');
    sheet.appendRow(['id', 'doctorName', 'fileName', 'fileData', 'uploadedBy', 'uploadDate', 'status', 'analyzedBy', 'analysisDate', 'reportHtml', 'signature', 'deliveredBy', 'deliveryDate']);
    return { success: true, tasks: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return { success: true, tasks: [] };
  }
  
  const headers = data[0];
  const tasks = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const task = {};
    headers.forEach((h, idx) => {
      // Don't include fileData in listing (too large)
      if (h !== 'fileData') {
        task[h] = row[idx];
      }
    });
    task.rowIndex = i + 1; // For updates
    tasks.push(task);
  }
  
  return { success: true, tasks: tasks };
}

function addTask(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Audit_Tasks');
  
  if (!sheet) {
    sheet = ss.insertSheet('Audit_Tasks');
    sheet.appendRow(['id', 'doctorName', 'fileName', 'fileData', 'uploadedBy', 'uploadDate', 'status', 'analyzedBy', 'analysisDate', 'reportHtml', 'signature', 'deliveredBy', 'deliveryDate']);
  }
  
  const taskId = 'TASK-' + Date.now();
  const uploadDate = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm');
  
  sheet.appendRow([
    taskId,
    data.doctorName || '',
    data.fileName || '',
    data.fileData || '',
    data.uploadedBy || '',
    uploadDate,
    'pending',
    '', // analyzedBy
    '', // analysisDate
    '', // reportHtml
    '', // signature
    '', // deliveredBy
    ''  // deliveryDate
  ]);
  
  return { success: true, taskId: taskId, message: 'Task added successfully' };
}

function getTaskFile(taskId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Audit_Tasks');
  
  if (!sheet) {
    return { success: false, error: 'Audit_Tasks sheet not found' };
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const fileDataCol = headers.indexOf('fileData');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === taskId) {
      return { success: true, fileData: data[i][fileDataCol] };
    }
  }
  
  return { success: false, error: 'Task not found' };
}

function updateTaskStatus(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Audit_Tasks');
  
  if (!sheet) {
    return { success: false, error: 'Audit_Tasks sheet not found' };
  }
  
  const sheetData = sheet.getDataRange().getValues();
  const headers = sheetData[0];
  const idCol = headers.indexOf('id');
  const statusCol = headers.indexOf('status');
  const analyzedByCol = headers.indexOf('analyzedBy');
  const analysisDateCol = headers.indexOf('analysisDate');
  const printedByCol = headers.indexOf('printedBy');
  
  for (let i = 1; i < sheetData.length; i++) {
    if (sheetData[i][idCol] === data.taskId) {
      const rowNum = i + 1;
      
      // Update status
      if (statusCol >= 0) {
        sheet.getRange(rowNum, statusCol + 1).setValue(data.status);
      }
      
      // Update analyzedBy if provided
      if (data.analyzedBy && analyzedByCol >= 0) {
        sheet.getRange(rowNum, analyzedByCol + 1).setValue(data.analyzedBy);
      }
      
      // Update analysisDate
      if ((data.status === 'analyzing' || data.status === 'analyzed') && analysisDateCol >= 0) {
        const now = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm');
        sheet.getRange(rowNum, analysisDateCol + 1).setValue(now);
      }
      
      return { success: true, message: 'Status updated' };
    }
  }
  
  return { success: false, error: 'Task not found' };
}

function saveReport(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Audit_Tasks');
  
  if (!sheet) {
    return { success: false, error: 'Audit_Tasks sheet not found' };
  }
  
  const sheetData = sheet.getDataRange().getValues();
  const headers = sheetData[0];
  const idCol = headers.indexOf('id');
  const reportCol = headers.indexOf('reportHtml');
  const statusCol = headers.indexOf('status');
  const analyzedByCol = headers.indexOf('analyzedBy');
  const analysisDateCol = headers.indexOf('analysisDate');
  
  for (let i = 1; i < sheetData.length; i++) {
    if (sheetData[i][idCol] === data.taskId) {
      const rowNum = i + 1;
      
      if (reportCol >= 0) {
        sheet.getRange(rowNum, reportCol + 1).setValue(data.reportHtml);
      }
      if (statusCol >= 0) {
        sheet.getRange(rowNum, statusCol + 1).setValue('analyzed');
      }
      if (analyzedByCol >= 0 && data.analyzedBy) {
        sheet.getRange(rowNum, analyzedByCol + 1).setValue(data.analyzedBy);
      }
      if (analysisDateCol >= 0) {
        const now = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm');
        sheet.getRange(rowNum, analysisDateCol + 1).setValue(now);
      }
      
      return { success: true, message: 'Report saved' };
    }
  }
  
  return { success: false, error: 'Task not found' };
}

function deliverTask(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Audit_Tasks');
  
  if (!sheet) {
    return { success: false, error: 'Audit_Tasks sheet not found' };
  }
  
  const sheetData = sheet.getDataRange().getValues();
  const headers = sheetData[0];
  const idCol = headers.indexOf('id');
  const statusCol = headers.indexOf('status');
  const signatureCol = headers.indexOf('signature');
  const deliveredByCol = headers.indexOf('deliveredBy');
  const deliveryDateCol = headers.indexOf('deliveryDate');
  
  for (let i = 1; i < sheetData.length; i++) {
    if (sheetData[i][idCol] === data.taskId) {
      const rowNum = i + 1;
      
      // حفظ التوقيع في Google Drive
      let signatureUrl = '';
      if (data.signature && data.signature.startsWith('data:image')) {
        try {
          signatureUrl = saveSignatureToDrive(data.signature, data.taskId);
        } catch(err) {
          signatureUrl = data.signature; // Fallback to base64
        }
      }
      
      if (statusCol >= 0) {
        sheet.getRange(rowNum, statusCol + 1).setValue('delivered');
      }
      if (signatureCol >= 0) {
        sheet.getRange(rowNum, signatureCol + 1).setValue(signatureUrl || data.signature);
      }
      if (deliveredByCol >= 0) {
        sheet.getRange(rowNum, deliveredByCol + 1).setValue(data.deliveredBy || '');
      }
      if (deliveryDateCol >= 0) {
        const now = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm');
        sheet.getRange(rowNum, deliveryDateCol + 1).setValue(now);
      }
      
      return { success: true, message: 'Task delivered successfully' };
    }
  }
  
  return { success: false, error: 'Task not found' };
}

function saveSignatureToDrive(base64Data, taskId) {
  // Remove data URL prefix
  const base64Content = base64Data.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Content), 'image/png', 'signature_' + taskId + '.png');
  
  // Create or get signatures folder
  const folders = DriveApp.getFoldersByName('Insurance_Signatures');
  let folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder('Insurance_Signatures');
  }
  
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  return 'https://drive.google.com/uc?id=' + file.getId();
}

function getDeliveryLog() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Audit_Tasks');
  
  if (!sheet) {
    return { success: true, logs: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return { success: true, logs: [] };
  }
  
  const headers = data[0];
  const logs = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[headers.indexOf('status')];
    
    // فقط المهام المسلمة
    if (status === 'delivered') {
      logs.push({
        doctorName: row[headers.indexOf('doctorName')],
        uploadedBy: row[headers.indexOf('uploadedBy')],
        uploadDate: row[headers.indexOf('uploadDate')],
        analyzedBy: row[headers.indexOf('analyzedBy')],
        analysisDate: row[headers.indexOf('analysisDate')],
        deliveryDate: row[headers.indexOf('deliveryDate')],
        signature: row[headers.indexOf('signature')],
        status: status
      });
    }
  }
  
  return { success: true, logs: logs };
}

// ========================================
// إنشاء الأوراق المطلوبة تلقائياً
// ========================================
function initializeSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Audit_Tasks sheet
  if (!ss.getSheetByName('Audit_Tasks')) {
    const sheet = ss.insertSheet('Audit_Tasks');
    sheet.appendRow(['id', 'doctorName', 'fileName', 'fileData', 'uploadedBy', 'uploadDate', 'status', 'analyzedBy', 'analysisDate', 'reportHtml', 'signature', 'deliveredBy', 'deliveryDate']);
    sheet.setFrozenRows(1);
  }
  
  // Staff sheet (if not exists)
  if (!ss.getSheetByName('Staff')) {
    const sheet = ss.insertSheet('Staff');
    sheet.appendRow(['الاسم', 'التخصص', 'القسم', 'البريد الإلكتروني']);
    sheet.setFrozenRows(1);
  }
  
  return { success: true, message: 'Sheets initialized' };
}
