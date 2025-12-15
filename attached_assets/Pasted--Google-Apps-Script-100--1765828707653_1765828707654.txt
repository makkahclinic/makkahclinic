/**
 * نظام الشكاوى المستقل - Google Apps Script
 * مجمع مكة الطبي بالزاهر
 * 
 * ملف مستقل 100% - لا يتأثر بالأنظمة الأخرى
 * Spreadsheet: 1d4BRDY6qAa2u7zKRwwhtXKHIjDn16Yf0NuWA0FWLdMQ
 */

const COMPLAINTS_SPREADSHEET_ID = '1d4BRDY6qAa2u7zKRwwhtXKHIjDn16Yf0NuWA0FWLdMQ';
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
  const action = e && e.parameter && e.parameter.action;
  
  if (action === 'debug') {
    const result = debugInfo();
    return ContentService.createTextOutput(JSON.stringify({ ok: true, ...result }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'Complaints API is running', version: '1.0' }))
    .setMimeType(ContentService.MimeType.JSON);
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

function getComplaintsSheet(sheetName) {
  const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === 'Complaints_Log') {
      sheet.appendRow([
        'Complaint_ID', 'Submit_Date', 'Submit_Time', 'Complaint_Type', 'Complainant_Name',
        'Complainant_Phone', 'Complainant_Email', 'Complaint_DateTime', 'Locations',
        'Description', 'Complaint_Against', 'Attachments', 'Additional_Notes',
        'Status', 'Priority', 'Assigned_To', 'Assigned_Date', 'Resolution',
        'Resolution_Date', 'Closed_By', 'Response_Sent', 'Days_Open'
      ]);
    } else if (sheetName === 'Complaints_Followup') {
      sheet.appendRow(['Followup_ID', 'Complaint_ID', 'Date', 'Action', 'Action_By', 'Notes', 'Status']);
    }
  }
  
  return sheet;
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
// دوال رفع الملفات
// ============================================

function uploadFilesToDrive(files, complaintId) {
  if (!files || files.length === 0) return [];
  
  const folder = DriveApp.getFolderById(COMPLAINTS_DRIVE_FOLDER_ID);
  const complaintFolder = folder.createFolder(complaintId);
  const uploadedFiles = [];
  
  files.forEach((file, index) => {
    try {
      let base64Data = file.data;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      
      const blob = Utilities.newBlob(
        Utilities.base64Decode(base64Data),
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
      console.error('File upload error:', err);
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
  const assignment = [];
  const escalation = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0] && String(row[0]).trim()) {
      staff.push({
        name: String(row[0]).trim(),
        hasCode: row[1] ? true : false
      });
    }
    if (row[2] && String(row[2]).trim()) {
      const assignName = String(row[2]).trim();
      if (!assignment.includes(assignName)) {
        assignment.push(assignName);
      }
    }
    if (row[3] && String(row[3]).trim()) {
      const escalateName = String(row[3]).trim();
      if (!escalation.includes(escalateName)) {
        escalation.push(escalateName);
      }
    }
  }
  
  return { staff, assignment, escalation };
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
  
  const locations = Array.isArray(payload.locations) ? payload.locations.join(', ') : (payload.locations || '');
  
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
  
  sheet.appendRow([
    complaintId,
    dateStr,
    timeStr,
    payload.complaintType || '',
    payload.complainantName || '',
    payload.complainantPhone || '',
    payload.complainantEmail || '',
    payload.complaintDateTime || '',
    locations,
    payload.description || '',
    payload.complaintAgainst || '',
    attachmentsInfo,
    payload.additionalNotes || '',
    'new',
    payload.priority || 'medium',
    '',
    '',
    '',
    '',
    '',
    'no',
    0
  ]);
  
  return { 
    success: true, 
    complaintId: complaintId,
    message: 'تم استلام شكواك بنجاح'
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
    complainant: c.Complainant_Name || 'مجهول',
    phone: c.Complainant_Phone || '',
    location: c.Locations || '',
    description: (c.Description || '').substring(0, 100),
    status: c.Status || 'new',
    priority: c.Priority || 'medium',
    assignedTo: c.Assigned_To || '',
    daysOpen: c.Days_Open || 0
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
      complainantName: complaint.Complainant_Name || '',
      complainantPhone: complaint.Complainant_Phone || '',
      complainantEmail: complaint.Complainant_Email || '',
      complaintDateTime: complaint.Complaint_DateTime || '',
      locations: complaint.Locations || '',
      description: complaint.Description || '',
      complaintAgainst: complaint.Complaint_Against || '',
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
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const followupId = `CF-${Date.now()}`;
  
  sheet.appendRow([
    followupId,
    payload.complaintId,
    dateStr,
    payload.action || '',
    payload.actionBy || '',
    payload.notes || '',
    'completed'
  ]);
  
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
  
  const priorityCol = headers.indexOf('Priority');
  if (priorityCol !== -1) sheet.getRange(rowIndex, priorityCol + 1).setValue('high');
  
  addComplaintFollowup({
    complaintId: payload.complaintId,
    action: `تصعيد الشكوى إلى ${payload.escalateTo}`,
    actionBy: payload.escalatedBy || 'النظام',
    notes: payload.reason || ''
  });
  
  return { success: true, message: `تم تصعيد الشكوى إلى ${payload.escalateTo}` };
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
