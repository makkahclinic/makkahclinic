/**
 * نظام الشكاوى المستقل - Google Apps Script
 * مجمع مكة الطبي بالزاهر
 * 
 * ملف مستقل 100% - لا يتأثر بالأنظمة الأخرى
 * Spreadsheet: 1DLBbSkBdfsdyxlXptaCNZsKVoJ-F3B6famr6_8V50Z0
 */

const COMPLAINTS_SPREADSHEET_ID = '1DLBbSkBdfsdyxlXptaCNZsKVoJ-F3B6famr6_8V50Z0';
const COMPLAINTS_DRIVE_FOLDER_ID = '11WkMirtdIq48n5KHZkz4w0VGLj7ig6_8';

function doPost(e) {
  try {
    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Invalid JSON: ' + parseErr.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const action = body.action;
    const payload = body.payload || {};
    
    let result;
    
    switch (action) {
      case 'submitComplaint':
        result = submitComplaint(payload);
        break;
      case 'getComplaintStaff':
        result = getComplaintStaff();
        break;
      case 'verifyComplaintPasscode':
        result = verifyComplaintPasscode(payload.staffName, payload.passcode);
        break;
      case 'getComplaintStats':
        result = getComplaintStats(payload);
        break;
      case 'getComplaints':
        result = getComplaints(payload);
        break;
      case 'getComplaintDetails':
        result = getComplaintDetails(payload.complaintId);
        break;
      case 'updateComplaint':
        result = updateComplaint(payload);
        break;
      case 'addNote':
        result = addComplaintFollowup({
          complaintId: payload.complaintId,
          action: payload.action || payload.noteAction || 'ملاحظة',
          actionBy: payload.actionBy || 'النظام',
          notes: payload.notes || ''
        });
        break;
      case 'getComplaintHistory':
        result = getComplaintHistory(payload.complaintId);
        break;
      case 'getComplaintAssignmentList':
        result = getComplaintAssignmentList();
        break;
      case 'getComplaintEscalationList':
        result = getComplaintEscalationList();
        break;
      case 'assignComplaint':
        result = assignComplaint(payload);
        break;
      case 'escalateComplaint':
        result = escalateComplaint(payload);
        break;
      case 'deescalateComplaint':
        result = deescalateComplaint(payload);
        break;
      case 'closeComplaint':
        result = closeComplaint(payload);
        break;
      case 'debug':
        result = debugInfo();
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ ok: true, ...result }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  const action = p.action;
  
  function output_(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    let result;
    
    switch (action) {
      case 'debug':
        result = debugInfo();
        break;
      case 'getLocations':
        result = getLocations();
        break;
      case 'getComplaintStaff':
        result = getComplaintStaff();
        break;
      case 'verifyComplaintPasscode':
        result = verifyComplaintPasscode(p.staffName, p.passcode);
        break;
      case 'getComplaintStats':
        result = getComplaintStats(p);
        break;
      case 'getComplaints':
        result = getComplaints(p);
        break;
      case 'getComplaintDetails':
        result = getComplaintDetails(p.complaintId);
        break;
      case 'getComplaintHistory':
        result = getComplaintHistory(p.complaintId);
        break;
      case 'getComplaintAssignmentList':
        result = getComplaintAssignmentList();
        break;
      case 'getComplaintEscalationList':
        result = getComplaintEscalationList();
        break;
      case 'updateComplaint':
        const updatePayload = p.payload ? JSON.parse(p.payload) : p;
        result = updateComplaint(updatePayload);
        break;
      case 'addNote':
        const notePayload = p.payload ? JSON.parse(p.payload) : p;
        result = addComplaintFollowup({
          complaintId: notePayload.complaintId,
          action: notePayload.action || notePayload.noteAction || 'ملاحظة',
          actionBy: notePayload.actionBy || 'النظام',
          notes: notePayload.notes || ''
        });
        break;
      case 'assignComplaint':
        const assignPayload = p.payload ? JSON.parse(p.payload) : p;
        result = assignComplaint(assignPayload);
        break;
      case 'escalateComplaint':
        const escPayload = p.payload ? JSON.parse(p.payload) : p;
        result = escalateComplaint(escPayload);
        break;
      case 'deescalateComplaint':
        const deescPayload = p.payload ? JSON.parse(p.payload) : p;
        result = deescalateComplaint(deescPayload);
        break;
      case 'closeComplaint':
        const closePayload = p.payload ? JSON.parse(p.payload) : p;
        result = closeComplaint(closePayload);
        break;
      case 'submitComplaint':
        const submitPayload = p.payload ? JSON.parse(p.payload) : p;
        result = submitComplaint(submitPayload);
        break;
      default:
        return output_({ ok: true, message: 'Complaints API is running', version: '2.0' });
    }
    
    return output_({ ok: true, ...result });
    
  } catch (err) {
    return output_({ ok: false, error: err.message });
  }
}

// ============================================
// دالة جلب المواقع من الشيت (العمود F و G)
// ============================================
function getLocations() {
  const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Master');
  
  if (!sheet) {
    return { locations: [], error: 'ورقة Master غير موجودة' };
  }
  
  const data = sheet.getDataRange().getValues();
  const locations = [];
  
  for (let i = 1; i < data.length; i++) {
    const code = String(data[i][5] || '').trim(); // العمود F (index 5) - Room Code
    const name = String(data[i][6] || '').trim(); // العمود G (index 6) - Room Description
    
    if (code && name) {
      locations.push({ code: code, name: name });
    }
  }
  
  return { locations: locations };
}

// ============================================
// دالة التوزيع التلقائي من الشيت Master
// ============================================
function getRoutingFromMaster() {
  const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Master');
  
  if (!sheet) {
    return { routing: {}, escalation: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  const routing = {};       // { "شكوى مالية": "أ. صابر عبده", ... }
  const escalationSet = new Set();
  
  for (let i = 1; i < data.length; i++) {
    const assignName = String(data[i][2] || '').trim();    // العمود C - Assign
    const complaintType = String(data[i][3] || '').trim(); // العمود D - type of complain
    const escName = String(data[i][4] || '').trim();       // العمود E - Escalation
    
    if (complaintType && assignName) {
      routing[complaintType] = assignName;
    }
    if (escName) {
      escalationSet.add(escName);
    }
  }
  
  return { routing, escalation: Array.from(escalationSet) };
}

// ============================================
// الدوال المساعدة
// ============================================

function getSaudiDate() {
  const now = new Date();
  const saudiOffset = 3 * 60;
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utcTime + (saudiOffset * 60000));
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const str = String(value);
  if (str.includes('T')) {
    return str.split('T')[0];
  }
  return str;
}

function parseLogDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value);
  const parts = str.split('-');
  if (parts.length === 3) {
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  return null;
}

// الهيدر الموحد الجديد لـ Complaints_Log
const COMPLAINTS_LOG_HEADER = [
  'Complaint_ID', 'Submit_Date', 'Submit_Time', 'Complaint_Type',
  'Primary_Category', 'Subcategory', 'Severity', 'Severity_Label',
  'Complainant_Name', 'Complainant_Phone', 'Complainant_Email', 'Complaint_DateTime',
  'Locations',
  'Description', 'Complaint_Against', 'Attachments', 'Additional_Notes',
  'Status', 'Priority', 'Assigned_To', 'Assigned_Date',
  'Resolution', 'Resolution_Date', 'Closed_By', 'Response_Sent', 'Days_Open',
  'Escalated_To', 'Escalated_By', 'Escalation_Date', 'Escalation_Reason', 'Escalation_Count',
  'Root_Cause_Category', 'Root_Cause_Details'
];

function getComplaintsSheet(sheetName) {
  const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === 'Complaints_Log') {
      sheet.appendRow(COMPLAINTS_LOG_HEADER);
    } else if (sheetName === 'Complaints_Followup') {
      sheet.appendRow(['Followup_ID', 'Complaint_ID', 'Date', 'Action', 'Action_By', 'Notes', 'Status']);
    }
  }
  
  return sheet;
}

// دالة إصلاح الهيدر - تُشغّل مرة واحدة يدوياً
function ensureComplaintsLogHeader() {
  const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Complaints_Log');
  
  // لو الورقة غير موجودة → أنشئها
  if (!sheet) {
    sheet = ss.insertSheet('Complaints_Log');
    sheet.getRange(1, 1, 1, COMPLAINTS_LOG_HEADER.length).setValues([COMPLAINTS_LOG_HEADER]);
    Logger.log('تم إنشاء ورقة Complaints_Log وإضافة الهيدر');
    return { success: true, message: 'تم إنشاء الورقة وإضافة الهيدر' };
  }
  
  // لو الورقة فاضية تماماً
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, COMPLAINTS_LOG_HEADER.length).setValues([COMPLAINTS_LOG_HEADER]);
    Logger.log('تم إضافة الهيدر للورقة الفارغة');
    return { success: true, message: 'تم إضافة الهيدر' };
  }
  
  // قراءة الهيدر الحالي
  const lastCol = sheet.getLastColumn();
  const currentHeader = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  
  // لو الهيدر مطابق → لا تعمل شيء
  if (JSON.stringify(currentHeader) === JSON.stringify(COMPLAINTS_LOG_HEADER)) {
    Logger.log('Header already correct');
    return { success: true, message: 'الهيدر صحيح بالفعل' };
  }
  
  // تحديث الهيدر (استبدال أو توسيع)
  sheet.getRange(1, 1, 1, COMPLAINTS_LOG_HEADER.length).setValues([COMPLAINTS_LOG_HEADER]);
  Logger.log('تم تحديث الهيدر');
  return { success: true, message: 'تم تحديث الهيدر' };
}

function sheetToObjects(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  const headers = data[0];
  const rows = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = { _rowIndex: i + 1 };
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  
  return rows;
}

function debugInfo() {
  try {
    const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
    const sheets = ss.getSheets().map(s => s.getName());
    return {
      spreadsheetId: COMPLAINTS_SPREADSHEET_ID,
      sheets: sheets,
      timestamp: getSaudiDate().toISOString(),
      status: 'connected'
    };
  } catch (err) {
    return { error: err.message, status: 'error' };
  }
}

// ============================================
// دوال التفويض والاختبار - شغّل هذه الدوال أولاً!
// ============================================

// دالة تفويض Drive - شغّلها أولاً!
function authorizeDriveNow() {
  const folder = DriveApp.getFolderById(COMPLAINTS_DRIVE_FOLDER_ID);
  Logger.log("✅ Drive OK: " + folder.getName());
  return { success: true, folderName: folder.getName() };
}

// دالة اختبار الصلاحيات الكاملة
function testDriveAccess() {
  const folder = DriveApp.getFolderById(COMPLAINTS_DRIVE_FOLDER_ID);
  const folderName = folder.getName();
  
  const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
  const sheetName = ss.getName();
  
  Logger.log('✅ Drive Folder: ' + folderName);
  Logger.log('✅ Spreadsheet: ' + sheetName);
  Logger.log('✅ All permissions granted!');
  
  return {
    success: true,
    driveFolder: folderName,
    spreadsheet: sheetName,
    message: 'تم التحقق من الصلاحيات بنجاح!'
  };
}

// ============================================
// دوال رفع الملفات - نسخة محسنة تظهر الأخطاء
// ============================================

function uploadFilesToDrive(files, complaintId) {
  if (!files || files.length === 0) return [];
  
  // التأكد من وجود المجلد
  let folder;
  try {
    folder = DriveApp.getFolderById(COMPLAINTS_DRIVE_FOLDER_ID);
  } catch (e) {
    throw new Error("لم يتم العثور على مجلد Drive. تأكد من صحة Folder ID: " + e.message);
  }

  // إنشاء مجلد فرعي للشكوى
  let complaintFolder;
  try {
    complaintFolder = folder.createFolder(complaintId);
  } catch (e) {
    throw new Error("فشل إنشاء مجلد للشكوى: " + e.message);
  }

  const uploadedFiles = [];
  
  files.forEach((file, index) => {
    try {
      let base64Data = file.data;
      // تنظيف البيانات في حال وصلت مع الترويسة
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      
      // فك التشفير وإنشاء الملف
      const decoded = Utilities.base64Decode(base64Data);
      const blob = Utilities.newBlob(
        decoded,
        file.mimeType || 'application/octet-stream',
        file.name || ('attachment_' + (index + 1))
      );
      
      const driveFile = complaintFolder.createFile(blob);
      driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      uploadedFiles.push({
        name: file.name,
        url: driveFile.getUrl(),
        id: driveFile.getId()
      });
    } catch (err) {
      // الخطأ يظهر بوضوح
      throw new Error("فشل رفع الملف (" + file.name + "): " + err.message);
    }
  });
  
  return uploadedFiles;
}

// ============================================
// دوال الموظفين والتحقق
// ============================================

function getComplaintStaff() {
  const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Master');
  
  if (!sheet) {
    return { staff: [], assignment: [], escalation: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  const staff = [];
  const assignmentSet = new Set();
  
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();  // العمود A - اسم الموظف
    const pass = String(data[i][1] || '').trim();  // العمود B - الرقم السري
    const assign = String(data[i][2] || '').trim(); // العمود C - Assign
    
    if (name) {
      staff.push({ name, hasCode: !!pass });
    }
    if (assign) {
      assignmentSet.add(assign);
    }
  }
  
  // جلب قائمة التصعيد من العمود E
  const routingData = getRoutingFromMaster();
  
  return {
    staff,
    assignment: Array.from(assignmentSet),
    escalation: routingData.escalation
  };
}

function verifyComplaintPasscode(staffName, passcode) {
  const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Master');
  
  if (!sheet) {
    return { verified: false, error: 'ورقة Master غير موجودة' };
  }
  
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();
    const code = String(data[i][1] || '').trim();
    
    if (name === staffName && code === String(passcode)) {
      return { verified: true, name: name };
    }
  }
  
  return { verified: false, error: 'الاسم أو الرمز السري غير صحيح' };
}

function getComplaintAssignmentList() {
  const result = getComplaintStaff();
  return { assignment: result.assignment || [] };
}

function getComplaintEscalationList() {
  const result = getComplaintStaff();
  return { escalation: result.escalation || [] };
}

// ============================================
// دوال الشكاوى الأساسية
// ============================================

function submitComplaint(payload) {
  const sheet = getComplaintsSheet('Complaints_Log');
  const now = getSaudiDate();
  
  const complaintId = `CMP-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${Date.now().toString().slice(-6)}`;
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  
  // المواقع - لازم تكون Array
  const locationsArr = Array.isArray(payload.locations) ? payload.locations : [];
  const locations = locationsArr.join(', ');
  
  // التصنيف والخطورة
  const primaryCategory = payload.primaryCategory || '';
  const subcategory = payload.subcategory || '';
  const severity = payload.severity || '';
  const severityLabel = payload.severityLabel || '';
  
  // الأولوية من الخطورة
  const priority = (severity === 'high') ? 'high' : (severity === 'low') ? 'low' : 'medium';
  
  // التوزيع التلقائي من Master (Routing)
  const routingData = getRoutingFromMaster();
  const autoAssignedTo = routingData.routing[primaryCategory] || '';
  const status = autoAssignedTo ? 'in_progress' : 'new';
  const assignedDate = autoAssignedTo ? dateStr : '';
  
  // المرفقات
  let attachmentsInfo = '';
  if (payload.files && payload.files.length > 0) {
    try {
      const uploadedFiles = uploadFilesToDrive(payload.files, complaintId);
      attachmentsInfo = uploadedFiles.map(f => f.url).join('\n');
    } catch (e) {
      console.error('Attachment upload failed:', e);
      attachmentsInfo = 'فشل رفع المرفقات: ' + e.message;
    }
  }
  
  // الصف الجديد يطابق COMPLAINTS_LOG_HEADER بالترتيب
  sheet.appendRow([
    complaintId,                    // Complaint_ID
    dateStr,                        // Submit_Date
    timeStr,                        // Submit_Time
    payload.complaintType || '',    // Complaint_Type
    primaryCategory,                // Primary_Category
    subcategory,                    // Subcategory
    severity,                       // Severity
    severityLabel,                  // Severity_Label
    payload.complainantName || '',  // Complainant_Name
    payload.complainantPhone || '', // Complainant_Phone
    payload.complainantEmail || '', // Complainant_Email
    payload.complaintDateTime || '',// Complaint_DateTime
    locations,                      // Locations
    payload.description || '',      // Description
    payload.complaintAgainst || '', // Complaint_Against
    attachmentsInfo,                // Attachments
    payload.additionalNotes || '',  // Additional_Notes
    status,                         // Status
    priority,                       // Priority
    autoAssignedTo,                 // Assigned_To
    assignedDate,                   // Assigned_Date
    '',                             // Resolution
    '',                             // Resolution_Date
    '',                             // Closed_By
    'no',                           // Response_Sent
    0,                              // Days_Open
    '',                             // Escalated_To
    '',                             // Escalated_By
    '',                             // Escalation_Date
    '',                             // Escalation_Reason
    0,                              // Escalation_Count
    '',                             // Root_Cause_Category
    ''                              // Root_Cause_Details
  ]);
  
  return { 
    success: true, 
    complaintId: complaintId,
    assignedTo: autoAssignedTo,
    message: autoAssignedTo 
      ? `تم استلام شكواك بنجاح وتكليف ${autoAssignedTo} بمتابعتها`
      : 'تم استلام شكواك بنجاح'
  };
}

function getComplaintStats(params) {
  const sheet = getComplaintsSheet('Complaints_Log');
  const data = sheetToObjects(sheet);
  
  const now = getSaudiDate();
  let filtered = data;
  
  if (params && params.days) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - parseInt(params.days));
    filtered = data.filter(c => {
      const d = parseLogDate(c.Submit_Date);
      return d && d >= cutoff;
    });
  }
  
  const total = filtered.length;
  const newCount = filtered.filter(c => c.Status === 'new').length;
  const inProgress = filtered.filter(c => c.Status === 'in_progress').length;
  const closed = filtered.filter(c => c.Status === 'closed').length;
  
  // ✅ تفريق بين المصعدة النشطة والمنتهية
  const escalatedActive = filtered.filter(c => 
    c.Escalated_To && c.Escalated_To.trim() !== '' && c.Status !== 'closed'
  ).length;
  
  const escalatedResolved = filtered.filter(c => {
    const wasEscalated = (c.Escalation_Count && parseInt(c.Escalation_Count) > 0) || 
                         (c.Deescalation_Date && c.Deescalation_Date.trim() !== '');
    const escalatedToEmpty = !c.Escalated_To || c.Escalated_To.trim() === '';
    const isClosed = c.Status === 'closed';
    return wasEscalated && (escalatedToEmpty || isClosed);
  }).length;
  
  // للتوافق: escalated = النشطة فقط (لأن لوحة التحكم تستخدمها للتنبيهات)
  const escalated = escalatedActive;
  
  const closedWithDays = filtered.filter(c => c.Status === 'closed' && c.Days_Open);
  const avgDays = closedWithDays.length > 0 
    ? Math.round(closedWithDays.reduce((sum, c) => sum + (parseInt(c.Days_Open) || 0), 0) / closedWithDays.length)
    : 0;
  
  const byType = {};
  filtered.forEach(c => {
    const type = c.Complaint_Type || 'غير محدد';
    byType[type] = (byType[type] || 0) + 1;
  });
  
  return {
    total,
    new: newCount,
    in_progress: inProgress,
    closed,
    escalated,           // المصعدة النشطة فقط
    escalatedActive,     // نفس escalated
    escalatedResolved,   // المنتهية
    avgResolutionTime: avgDays,
    byType
  };
}

function getComplaints(params) {
  const sheet = getComplaintsSheet('Complaints_Log');
  const data = sheetToObjects(sheet);
  
  let filtered = data;
  
  if (params && params.status && params.status !== 'all') {
    filtered = filtered.filter(c => c.Status === params.status);
  }
  
  if (params && params.type && params.type !== 'all') {
    filtered = filtered.filter(c => c.Complaint_Type === params.type);
  }
  
  if (params && params.startDate) {
    filtered = filtered.filter(c => {
      const d = parseLogDate(c.Submit_Date);
      return d && d >= new Date(params.startDate);
    });
  }
  
  if (params && params.endDate) {
    filtered = filtered.filter(c => {
      const d = parseLogDate(c.Submit_Date);
      return d && d <= new Date(params.endDate);
    });
  }
  
  filtered.sort((a, b) => {
    const dateA = new Date(a.Submit_Date + ' ' + (a.Submit_Time || ''));
    const dateB = new Date(b.Submit_Date + ' ' + (b.Submit_Time || ''));
    return dateB - dateA;
  });
  
  const complaints = filtered.map(c => ({
    id: c.Complaint_ID,
    date: formatDate(c.Submit_Date),
    time: c.Submit_Time || '',
    type: c.Complaint_Type || '',
    // الحقول الجديدة
    primaryCategory: c.Primary_Category || '',
    subcategory: c.Subcategory || '',
    severity: c.Severity || '',
    severityLabel: c.Severity_Label || '',
    complainant: c.Complainant_Name || 'مجهول',
    phone: c.Complainant_Phone || '',
    location: c.Locations || '',
    description: (c.Description || '').substring(0, 100),
    attachments: c.Attachments || '',
    status: c.Status || 'new',
    priority: c.Priority || 'medium',
    assignedTo: c.Assigned_To || '',
    daysOpen: c.Days_Open || 0,
    // حقول الإغلاق
    resolution: c.Resolution || '',
    resolutionDate: formatDate(c.Resolution_Date),
    closedBy: c.Closed_By || '',
    responseSent: c.Response_Sent || 'no',
    // حقول التصعيد
    escalatedTo: c.Escalated_To || '',
    escalatedBy: c.Escalated_By || '',
    escalationDate: formatDate(c.Escalation_Date),
    escalationReason: c.Escalation_Reason || '',
    escalationCount: parseInt(c.Escalation_Count) || 0,
    isEscalated: c.Escalated_To ? true : false,
    // حقول إنهاء التصعيد
    deescalatedBy: c.Deescalated_By || '',
    deescalationDate: formatDate(c.Deescalation_Date),
    deescalationReason: c.Deescalation_Reason || '',
    // جذر المشكلة
    rootCauseCategory: c.Root_Cause_Category || '',
    rootCauseDetails: c.Root_Cause_Details || ''
  }));
  
  return { complaints, total: complaints.length };
}

function getComplaintDetails(complaintId) {
  const sheet = getComplaintsSheet('Complaints_Log');
  const data = sheetToObjects(sheet);
  
  const complaint = data.find(c => c.Complaint_ID === complaintId);
  
  if (!complaint) {
    return { error: 'الشكوى غير موجودة' };
  }
  
  const followupSheet = getComplaintsSheet('Complaints_Followup');
  const followups = sheetToObjects(followupSheet)
    .filter(f => f.Complaint_ID === complaintId)
    .sort((a, b) => new Date(b.Date) - new Date(a.Date));
  
  return {
    complaint: {
      id: complaint.Complaint_ID,
      submitDate: formatDate(complaint.Submit_Date),
      submitTime: complaint.Submit_Time || '',
      type: complaint.Complaint_Type || '',
      // الحقول الجديدة
      primaryCategory: complaint.Primary_Category || '',
      subcategory: complaint.Subcategory || '',
      severity: complaint.Severity || '',
      severityLabel: complaint.Severity_Label || '',
      complainantName: complaint.Complainant_Name || '',
      complainantPhone: complaint.Complainant_Phone || '',
      complainantEmail: complaint.Complainant_Email || '',
      complaintDateTime: complaint.Complaint_DateTime || '',
      locations: complaint.Locations || '',
      description: complaint.Description || '',
      complaintAgainst: complaint.Complaint_Against || '',
      attachments: complaint.Attachments || '',
      additionalNotes: complaint.Additional_Notes || '',
      status: complaint.Status || 'new',
      priority: complaint.Priority || 'medium',
      assignedTo: complaint.Assigned_To || '',
      assignedDate: formatDate(complaint.Assigned_Date),
      resolution: complaint.Resolution || '',
      resolutionDate: formatDate(complaint.Resolution_Date),
      closedBy: complaint.Closed_By || '',
      responseSent: complaint.Response_Sent || 'no',
      daysOpen: complaint.Days_Open || 0,
      // حقول التصعيد
      escalatedTo: complaint.Escalated_To || '',
      escalatedBy: complaint.Escalated_By || '',
      escalationDate: formatDate(complaint.Escalation_Date),
      escalationReason: complaint.Escalation_Reason || '',
      escalationCount: parseInt(complaint.Escalation_Count) || 0,
      isEscalated: complaint.Escalated_To ? true : false,
      // حقول إنهاء التصعيد
      deescalatedBy: complaint.Deescalated_By || '',
      deescalationDate: formatDate(complaint.Deescalation_Date),
      deescalationReason: complaint.Deescalation_Reason || '',
      // جذر المشكلة
      rootCauseCategory: complaint.Root_Cause_Category || '',
      rootCauseDetails: complaint.Root_Cause_Details || '',
      _rowIndex: complaint._rowIndex
    },
    followups: followups.map(f => ({
      id: f.Followup_ID,
      date: formatDate(f.Date),
      action: f.Action || '',
      actionBy: f.Action_By || '',
      notes: f.Notes || '',
      status: f.Status || ''
    }))
  };
}

function updateComplaint(payload) {
  const sheet = getComplaintsSheet('Complaints_Log');
  const data = sheetToObjects(sheet);
  
  const complaint = data.find(c => c.Complaint_ID === payload.complaintId);
  if (!complaint) {
    return { success: false, error: 'الشكوى غير موجودة' };
  }
  
  const rowIndex = complaint._rowIndex;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const updates = {
    'Status': payload.status,
    'Priority': payload.priority,
    'Assigned_To': payload.assignedTo,
    'Resolution': payload.resolution
  };
  
  Object.keys(updates).forEach(key => {
    if (updates[key] !== undefined) {
      const colIndex = headers.indexOf(key);
      if (colIndex !== -1) {
        sheet.getRange(rowIndex, colIndex + 1).setValue(updates[key]);
      }
    }
  });
  
  if (payload.action && payload.actionBy) {
    addComplaintFollowup({
      complaintId: payload.complaintId,
      action: payload.action,
      actionBy: payload.actionBy,
      notes: payload.notes || ''
    });
  }
  
  return { success: true, message: 'تم تحديث الشكوى' };
}

function addComplaintFollowup(payload) {
  const sheet = getComplaintsSheet('Complaints_Followup');
  
  const expectedHeaders = ['Followup_ID', 'Complaint_ID', 'Date', 'Action', 'Action_By', 'Notes', 'Status'];
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(expectedHeaders);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (currentHeaders[0] !== 'Followup_ID') {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    }
  }
  
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const followupId = `CF-${Date.now()}`;
  
  sheet.appendRow([
    followupId,
    payload.complaintId || '',
    dateStr,
    payload.action || '',
    payload.actionBy || '',
    payload.notes || '',
    'completed'
  ]);
  
  SpreadsheetApp.flush();
  
  return { success: true, followupId: followupId };
}

function getComplaintHistory(complaintId) {
  const sheet = getComplaintsSheet('Complaints_Followup');
  const data = sheetToObjects(sheet);
  
  const history = data
    .filter(f => f.Complaint_ID === complaintId)
    .sort((a, b) => new Date(b.Date) - new Date(a.Date))
    .map(f => ({
      id: f.Followup_ID,
      date: formatDate(f.Date),
      action: f.Action || '',
      actionBy: f.Action_By || '',
      notes: f.Notes || '',
      status: f.Status || ''
    }));
  
  return { history };
}

// ============================================
// دوال التكليف والتصعيد
// ============================================

function assignComplaint(payload) {
  const sheet = getComplaintsSheet('Complaints_Log');
  const data = sheetToObjects(sheet);
  
  const complaint = data.find(c => c.Complaint_ID === payload.complaintId);
  if (!complaint) {
    return { success: false, error: 'الشكوى غير موجودة' };
  }
  
  const rowIndex = complaint._rowIndex;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  const assignedToCol = headers.indexOf('Assigned_To');
  const assignedDateCol = headers.indexOf('Assigned_Date');
  const statusCol = headers.indexOf('Status');
  
  if (assignedToCol !== -1) sheet.getRange(rowIndex, assignedToCol + 1).setValue(payload.assignedTo);
  if (assignedDateCol !== -1) sheet.getRange(rowIndex, assignedDateCol + 1).setValue(dateStr);
  if (statusCol !== -1) sheet.getRange(rowIndex, statusCol + 1).setValue('in_progress');
  
  addComplaintFollowup({
    complaintId: payload.complaintId,
    action: `تكليف ${payload.assignedTo} بمتابعة الشكوى`,
    actionBy: payload.assignedBy || 'النظام',
    notes: payload.notes || ''
  });
  
  return { success: true, message: `تم تكليف ${payload.assignedTo} بمتابعة الشكوى` };
}

function escalateComplaint(payload) {
  const sheet = getComplaintsSheet('Complaints_Log');
  const data = sheetToObjects(sheet);
  
  const complaint = data.find(c => c.Complaint_ID === payload.complaintId);
  if (!complaint) {
    return { success: false, error: 'الشكوى غير موجودة' };
  }
  
  const rowIndex = complaint._rowIndex;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  // تحديث الأولوية إلى عالية
  const priorityCol = headers.indexOf('Priority');
  if (priorityCol !== -1) sheet.getRange(rowIndex, priorityCol + 1).setValue('high');
  
  // حفظ بيانات التصعيد
  const escalatedToCol = headers.indexOf('Escalated_To');
  const escalatedByCol = headers.indexOf('Escalated_By');
  const escalationDateCol = headers.indexOf('Escalation_Date');
  const escalationReasonCol = headers.indexOf('Escalation_Reason');
  const escalationCountCol = headers.indexOf('Escalation_Count');
  
  if (escalatedToCol !== -1) sheet.getRange(rowIndex, escalatedToCol + 1).setValue(payload.escalateTo);
  if (escalatedByCol !== -1) sheet.getRange(rowIndex, escalatedByCol + 1).setValue(payload.escalatedBy || 'النظام');
  if (escalationDateCol !== -1) sheet.getRange(rowIndex, escalationDateCol + 1).setValue(dateStr);
  if (escalationReasonCol !== -1) sheet.getRange(rowIndex, escalationReasonCol + 1).setValue(payload.reason || '');
  
  // زيادة عداد التصعيد
  const currentCount = parseInt(complaint.Escalation_Count) || 0;
  if (escalationCountCol !== -1) sheet.getRange(rowIndex, escalationCountCol + 1).setValue(currentCount + 1);
  
  addComplaintFollowup({
    complaintId: payload.complaintId,
    action: `تصعيد الشكوى إلى ${payload.escalateTo}`,
    actionBy: payload.escalatedBy || 'النظام',
    notes: payload.reason || ''
  });
  
  return { 
    success: true, 
    message: `تم تصعيد الشكوى إلى ${payload.escalateTo}`,
    escalatedTo: payload.escalateTo,
    escalationCount: currentCount + 1
  };
}

function closeComplaint(payload) {
  const sheet = getComplaintsSheet('Complaints_Log');
  const data = sheetToObjects(sheet);
  
  const complaint = data.find(c => c.Complaint_ID === payload.complaintId);
  if (!complaint) {
    return { success: false, error: 'الشكوى غير موجودة' };
  }
  
  const rowIndex = complaint._rowIndex;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  const statusCol = headers.indexOf('Status');
  const resolutionCol = headers.indexOf('Resolution');
  const resolutionDateCol = headers.indexOf('Resolution_Date');
  const closedByCol = headers.indexOf('Closed_By');
  const daysOpenCol = headers.indexOf('Days_Open');
  
  if (statusCol !== -1) sheet.getRange(rowIndex, statusCol + 1).setValue('closed');
  if (resolutionCol !== -1) sheet.getRange(rowIndex, resolutionCol + 1).setValue(payload.resolution || '');
  if (resolutionDateCol !== -1) sheet.getRange(rowIndex, resolutionDateCol + 1).setValue(dateStr);
  if (closedByCol !== -1) sheet.getRange(rowIndex, closedByCol + 1).setValue(payload.closedBy || '');
  
  if (daysOpenCol !== -1) {
    const submitDate = parseLogDate(complaint.Submit_Date);
    if (submitDate) {
      const days = Math.floor((now - submitDate) / (1000 * 60 * 60 * 24));
      sheet.getRange(rowIndex, daysOpenCol + 1).setValue(days);
    }
  }
  
  addComplaintFollowup({
    complaintId: payload.complaintId,
    action: 'إغلاق الشكوى',
    actionBy: payload.closedBy || 'النظام',
    notes: payload.resolution || ''
  });
  
  return { success: true, message: 'تم إغلاق الشكوى بنجاح' };
}

function ensureDeescalationColumns(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const requiredCols = ['Deescalated_By', 'Deescalation_Date', 'Deescalation_Reason'];
  
  requiredCols.forEach(col => {
    if (headers.indexOf(col) === -1) {
      const lastCol = sheet.getLastColumn();
      sheet.getRange(1, lastCol + 1).setValue(col);
    }
  });
}

function deescalateComplaint(payload) {
  const sheet = getComplaintsSheet('Complaints_Log');
  
  // إنشاء الأعمدة تلقائياً إذا لم تكن موجودة
  ensureDeescalationColumns(sheet);
  
  const data = sheetToObjects(sheet);
  
  const complaint = data.find(c => c.Complaint_ID === payload.complaintId);
  if (!complaint) {
    return { success: false, error: 'الشكوى غير موجودة' };
  }
  
  const rowIndex = complaint._rowIndex;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  // مسح بيانات التصعيد
  const escalatedToCol = headers.indexOf('Escalated_To');
  const deescalatedByCol = headers.indexOf('Deescalated_By');
  const deescalationDateCol = headers.indexOf('Deescalation_Date');
  const deescalationReasonCol = headers.indexOf('Deescalation_Reason');
  
  if (escalatedToCol !== -1) sheet.getRange(rowIndex, escalatedToCol + 1).setValue('');
  if (deescalatedByCol !== -1) sheet.getRange(rowIndex, deescalatedByCol + 1).setValue(payload.deescalatedBy || 'النظام');
  if (deescalationDateCol !== -1) sheet.getRange(rowIndex, deescalationDateCol + 1).setValue(dateStr);
  if (deescalationReasonCol !== -1) sheet.getRange(rowIndex, deescalationReasonCol + 1).setValue(payload.reason || '');
  
  // إعادة الأولوية إلى متوسطة
  const priorityCol = headers.indexOf('Priority');
  if (priorityCol !== -1) sheet.getRange(rowIndex, priorityCol + 1).setValue('medium');
  
  addComplaintFollowup({
    complaintId: payload.complaintId,
    action: `إنهاء التصعيد - الإجراء: ${payload.action || 'غير محدد'}`,
    actionBy: payload.deescalatedBy || 'النظام',
    notes: payload.reason || ''
  });
  
  return { 
    success: true, 
    message: 'تم إنهاء التصعيد بنجاح'
  };
}

/**
 * تعبئة Closed_By للشكاوى القديمة المغلقة
 * يمكن تشغيلها مرة واحدة فقط
 */
function fillMissingClosedBy(defaultValue = 'النظام') {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Complaints');
  if (!sheet) return { success: false, error: 'الشيت غير موجود' };
  
  const data = sheetToObjects(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusCol = headers.indexOf('Status');
  const closedByCol = headers.indexOf('Closed_By');
  
  if (closedByCol === -1) {
    return { success: false, error: 'عمود Closed_By غير موجود' };
  }
  
  let updated = 0;
  data.forEach(c => {
    const isClosed = c.Status === 'closed' || c.Status === 'مغلقة';
    const hasClosedBy = (c.Closed_By || '').trim() !== '';
    
    if (isClosed && !hasClosedBy) {
      sheet.getRange(c._rowIndex, closedByCol + 1).setValue(defaultValue);
      updated++;
    }
  });
  
  return { 
    success: true, 
    message: `تم تحديث ${updated} شكوى مغلقة بقيمة "${defaultValue}"` 
  };
}
