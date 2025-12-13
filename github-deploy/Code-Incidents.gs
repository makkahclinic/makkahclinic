/**
 * نظام حوادث سلامة المرضى - Google Apps Script
 * مجمع مكة الطبي بالزاهر
 * 
 * ملف منفصل للحوادث فقط
 * API URL: https://script.google.com/macros/s/AKfycbz-vImcmRIh0M86i44V5Rm1C0m23lrN4q1aql9R7HNfQZUgShVyg7JlYlD5xLK2H9Gurg/exec
 */

const INCIDENTS_SPREADSHEET_ID = '12SS-Nn_TpvIsIoUfdOPRzC_tgLqmb2hfZZi53_dSyVI';

const INCIDENT_TYPES = {
  'medication_error': 'خطأ دوائي',
  'patient_fall': 'سقوط مريض',
  'infection': 'عدوى مكتسبة',
  'diagnosis_error': 'خطأ تشخيصي',
  'procedure_error': 'خطأ إجراءات',
  'near_miss': 'كاد يحدث (Near Miss)',
  'equipment_failure': 'عطل معدات',
  'communication': 'خطأ تواصل',
  'documentation': 'خطأ توثيق',
  'other': 'أخرى'
};

const SEVERITY_LEVELS = {
  'none': { name: 'بدون ضرر', color: '#28a745', priority: 1 },
  'minor': { name: 'ضرر بسيط', color: '#ffc107', priority: 2 },
  'moderate': { name: 'ضرر متوسط', color: '#fd7e14', priority: 3 },
  'severe': { name: 'ضرر جسيم', color: '#dc3545', priority: 4 },
  'death': { name: 'وفاة', color: '#000000', priority: 5 }
};

const INCIDENT_STATUS = {
  'new': 'جديد',
  'under_review': 'قيد المراجعة',
  'rca_required': 'يتطلب RCA',
  'in_progress': 'قيد المعالجة',
  'closed': 'مغلق'
};

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const payload = body.payload || {};
    
    let result;
    
    switch (action) {
      case 'submitIncident':
        result = submitIncident(payload);
        break;
      case 'getIncidents':
        result = getIncidents(payload);
        break;
      case 'getIncidentDetails':
        result = getIncidentDetails(payload.incidentId);
        break;
      case 'updateIncidentStatus':
        result = updateIncidentStatus(payload);
        break;
      case 'getIncidentStats':
        result = getIncidentStats(payload);
        break;
      case 'addIncidentFollowup':
        result = addIncidentFollowup(payload);
        break;
      case 'getIncidentStaff':
        result = getIncidentStaff();
        break;
      case 'assignIncident':
        result = assignIncident(payload);
        break;
      case 'escalateIncident':
        result = escalateIncident(payload);
        break;
      case 'closeIncident':
        result = closeIncident(payload);
        break;
      case 'saveRCA':
        result = saveRCA(payload);
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
  return ContentService.createTextOutput(JSON.stringify({ 
    ok: true, 
    message: 'Patient Safety Incidents API is running',
    version: '1.0'
  })).setMimeType(ContentService.MimeType.JSON);
}

// ==================== دوال مساعدة ====================

function getSaudiDate() {
  const now = new Date();
  const saudiOffset = 3 * 60;
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utcTime + (saudiOffset * 60000));
}

function getTodayString() {
  const today = getSaudiDate();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

function parseLogDate(dateValue) {
  if (!dateValue) return null;
  if (dateValue instanceof Date) return dateValue;
  
  const str = String(dateValue).trim();
  
  let match = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }
  
  match = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (match) {
    return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
  }
  
  const d = new Date(dateValue);
  return isNaN(d.getTime()) ? null : d;
}

function getIncidentsSheet(name) {
  const ss = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  
  if (!sheet) {
    sheet = ss.insertSheet(name);
    
    if (name === 'Incidents_Log') {
      sheet.appendRow([
        'Incident_ID', 'Date', 'Time', 'Report_Date', 'Department',
        'Incident_Type', 'Severity', 'Description', 'Discovery_Method',
        'Immediate_Action', 'Doctor_Notified', 'Patient_Notified',
        'Anonymous', 'Reporter_Name', 'Status', 'Assigned_To',
        'RCA_Required', 'Closed_Date', 'Closed_By', 'Root_Cause',
        'Corrective_Actions', 'Lessons_Learned'
      ]);
    } else if (name === 'Incidents_Followup') {
      sheet.appendRow([
        'Followup_ID', 'Incident_ID', 'Date', 'Action', 'By', 'Notes', 'Status'
      ]);
    } else if (name === 'Incidents_Staff') {
      sheet.appendRow(['Staff_Name', 'Email', 'Role', 'Active', 'Added_Date']);
      sheet.appendRow(['د. خالد الخطيب', '', 'رئيس اللجنة', 'نعم', getTodayString()]);
      sheet.appendRow(['منسق الجودة', '', 'منسق', 'نعم', getTodayString()]);
      sheet.appendRow(['مسؤول السلامة', '', 'مسؤول', 'نعم', getTodayString()]);
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

function generateIncidentId() {
  const now = getSaudiDate();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `INC-${year}${month}-${random}`;
}

// ==================== APIs ====================

function submitIncident(payload) {
  if (!payload.incidentDate) {
    return { success: false, error: 'تاريخ الحادث مطلوب' };
  }
  if (!payload.department) {
    return { success: false, error: 'القسم مطلوب' };
  }
  if (!payload.incidentType) {
    return { success: false, error: 'نوع الحادث مطلوب' };
  }
  if (!payload.severity) {
    return { success: false, error: 'مستوى الخطورة مطلوب' };
  }
  
  const sheet = getIncidentsSheet('Incidents_Log');
  const now = getSaudiDate();
  
  const incidentId = generateIncidentId();
  const reportDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const reportTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  
  const isAnonymous = payload.anonymous === true || payload.anonymous === 'true';
  const severity = payload.severity || 'none';
  const requiresRCA = ['severe', 'death', 'moderate'].includes(severity);
  const isSentinel = ['severe', 'death'].includes(severity);
  
  sheet.appendRow([
    incidentId,
    payload.incidentDate || reportDate,
    payload.incidentTime || '',
    reportDate + ' ' + reportTime,
    payload.department || '',
    payload.incidentType || '',
    severity,
    payload.description || '',
    payload.discoveryMethod || '',
    payload.immediateAction || '',
    payload.doctorNotified || 'لا',
    payload.patientNotified || 'لا',
    isAnonymous ? 'نعم' : 'لا',
    isAnonymous ? '' : (payload.reporterName || ''),
    isSentinel ? 'rca_required' : 'new',
    '',
    requiresRCA ? 'نعم' : 'لا',
    '',
    '',
    '',
    '',
    ''
  ]);
  
  return {
    success: true,
    incidentId: incidentId,
    message: 'تم تسجيل البلاغ بنجاح',
    requiresRCA: requiresRCA
  };
}

function getIncidents(params) {
  const incidents = sheetToObjects(getIncidentsSheet('Incidents_Log'));
  
  let filtered = incidents;
  
  if (params.status && params.status !== 'all') {
    filtered = filtered.filter(i => i.Status === params.status);
  }
  
  if (params.department) {
    filtered = filtered.filter(i => i.Department === params.department);
  }
  
  if (params.severity) {
    filtered = filtered.filter(i => i.Severity === params.severity);
  }
  
  if (params.incidentType) {
    filtered = filtered.filter(i => i.Incident_Type === params.incidentType);
  }
  
  if (params.dateFrom) {
    filtered = filtered.filter(i => i.Date >= params.dateFrom);
  }
  
  if (params.dateTo) {
    filtered = filtered.filter(i => i.Date <= params.dateTo);
  }
  
  filtered.sort((a, b) => new Date(b.Report_Date) - new Date(a.Report_Date));
  
  const limit = params.limit || 100;
  filtered = filtered.slice(0, limit);
  
  return {
    incidents: filtered.map(i => ({
      id: i.Incident_ID,
      date: i.Date,
      time: i.Time,
      reportDate: i.Report_Date,
      department: i.Department,
      type: i.Incident_Type,
      typeName: INCIDENT_TYPES[i.Incident_Type] || i.Incident_Type,
      severity: i.Severity,
      severityName: SEVERITY_LEVELS[i.Severity]?.name || i.Severity,
      severityColor: SEVERITY_LEVELS[i.Severity]?.color || '#6c757d',
      description: i.Description,
      status: i.Status,
      statusName: INCIDENT_STATUS[i.Status] || i.Status,
      anonymous: i.Anonymous === 'نعم',
      rcaRequired: i.RCA_Required === 'نعم',
      rowIndex: i._rowIndex
    })),
    total: incidents.length,
    filtered: filtered.length
  };
}

function getIncidentDetails(incidentId) {
  const incidents = sheetToObjects(getIncidentsSheet('Incidents_Log'));
  const incident = incidents.find(i => i.Incident_ID === incidentId);
  
  if (!incident) {
    return { success: false, error: 'البلاغ غير موجود' };
  }
  
  const followups = sheetToObjects(getIncidentsSheet('Incidents_Followup'));
  const incidentFollowups = followups
    .filter(f => f.Incident_ID === incidentId)
    .sort((a, b) => new Date(b.Date) - new Date(a.Date));
  
  return {
    success: true,
    incident: {
      id: incident.Incident_ID,
      date: incident.Date,
      time: incident.Time,
      reportDate: incident.Report_Date,
      department: incident.Department,
      type: incident.Incident_Type,
      typeName: INCIDENT_TYPES[incident.Incident_Type] || incident.Incident_Type,
      severity: incident.Severity,
      severityName: SEVERITY_LEVELS[incident.Severity]?.name || incident.Severity,
      severityColor: SEVERITY_LEVELS[incident.Severity]?.color || '#6c757d',
      description: incident.Description,
      discoveryMethod: incident.Discovery_Method,
      immediateAction: incident.Immediate_Action,
      doctorNotified: incident.Doctor_Notified,
      patientNotified: incident.Patient_Notified,
      anonymous: incident.Anonymous === 'نعم',
      reporterName: incident.Reporter_Name,
      status: incident.Status,
      statusName: INCIDENT_STATUS[incident.Status] || incident.Status,
      assignedTo: incident.Assigned_To,
      rcaRequired: incident.RCA_Required === 'نعم',
      closedDate: incident.Closed_Date,
      closedBy: incident.Closed_By,
      rootCause: incident.Root_Cause,
      correctiveActions: incident.Corrective_Actions,
      lessonsLearned: incident.Lessons_Learned,
      rowIndex: incident._rowIndex
    },
    followups: incidentFollowups.map(f => ({
      id: f.Followup_ID,
      date: f.Date,
      action: f.Action,
      by: f.By,
      notes: f.Notes,
      status: f.Status
    }))
  };
}

function updateIncidentStatus(params) {
  const sheet = getIncidentsSheet('Incidents_Log');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const rowIndex = params.rowIndex;
  if (!rowIndex || rowIndex < 2) {
    return { success: false, error: 'صف غير صالح' };
  }
  
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  if (params.status) {
    const statusCol = headers.indexOf('Status');
    if (statusCol !== -1) {
      sheet.getRange(rowIndex, statusCol + 1).setValue(params.status);
    }
    
    if (params.status === 'closed') {
      const closedDateCol = headers.indexOf('Closed_Date');
      const closedByCol = headers.indexOf('Closed_By');
      if (closedDateCol !== -1) sheet.getRange(rowIndex, closedDateCol + 1).setValue(dateStr);
      if (closedByCol !== -1) sheet.getRange(rowIndex, closedByCol + 1).setValue(params.closedBy || '');
    }
  }
  
  if (params.assignedTo) {
    const col = headers.indexOf('Assigned_To');
    if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.assignedTo);
  }
  
  if (params.rootCause) {
    const col = headers.indexOf('Root_Cause');
    if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.rootCause);
  }
  
  if (params.correctiveActions) {
    const col = headers.indexOf('Corrective_Actions');
    if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.correctiveActions);
  }
  
  if (params.lessonsLearned) {
    const col = headers.indexOf('Lessons_Learned');
    if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.lessonsLearned);
  }
  
  return { success: true, message: 'تم تحديث البلاغ بنجاح' };
}

function addIncidentFollowup(params) {
  const sheet = getIncidentsSheet('Incidents_Followup');
  const now = getSaudiDate();
  
  const followupId = `FU-${Date.now()}`;
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  sheet.appendRow([
    followupId,
    params.incidentId,
    dateStr,
    params.action || '',
    params.by || '',
    params.notes || '',
    params.status || 'pending'
  ]);
  
  return { success: true, followupId: followupId };
}

function getIncidentStats(params) {
  const incidents = sheetToObjects(getIncidentsSheet('Incidents_Log'));
  const now = getSaudiDate();
  const currentYear = params.year || now.getFullYear();
  
  const yearIncidents = incidents.filter(i => {
    const date = i.Date || i.Report_Date;
    return date && String(date).includes(String(currentYear));
  });
  
  const byType = {};
  for (const [code, name] of Object.entries(INCIDENT_TYPES)) {
    byType[code] = {
      name: name,
      count: yearIncidents.filter(i => i.Incident_Type === code).length
    };
  }
  
  const bySeverity = {};
  for (const [code, config] of Object.entries(SEVERITY_LEVELS)) {
    bySeverity[code] = {
      name: config.name,
      color: config.color,
      count: yearIncidents.filter(i => i.Severity === code).length
    };
  }
  
  const byStatus = {};
  for (const [code, name] of Object.entries(INCIDENT_STATUS)) {
    byStatus[code] = {
      name: name,
      count: yearIncidents.filter(i => i.Status === code).length
    };
  }
  
  const byMonth = {};
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  
  yearIncidents.forEach(i => {
    const date = parseLogDate(i.Date || i.Report_Date);
    if (date) {
      const month = date.getMonth();
      if (!byMonth[month]) byMonth[month] = 0;
      byMonth[month]++;
    }
  });
  
  const monthlyStats = months.map((name, idx) => ({
    month: name,
    count: byMonth[idx] || 0
  }));
  
  const nearMissCount = yearIncidents.filter(i => i.Incident_Type === 'near_miss').length;
  const nearMissPercentage = yearIncidents.length > 0 ?
    Math.round((nearMissCount / yearIncidents.length) * 100) : 0;
  
  const openIncidents = yearIncidents.filter(i => i.Status !== 'closed').length;
  
  const closedIncidents = yearIncidents.filter(i => i.Status === 'closed' && i.Closed_Date);
  let avgClosureTime = 0;
  if (closedIncidents.length > 0) {
    const totalDays = closedIncidents.reduce((sum, i) => {
      const reportDate = parseLogDate(i.Report_Date);
      const closedDate = parseLogDate(i.Closed_Date);
      if (reportDate && closedDate) {
        return sum + Math.ceil((closedDate - reportDate) / (1000 * 60 * 60 * 24));
      }
      return sum;
    }, 0);
    avgClosureTime = Math.round(totalDays / closedIncidents.length);
  }
  
  return {
    year: currentYear,
    total: yearIncidents.length,
    open: openIncidents,
    closed: yearIncidents.length - openIncidents,
    nearMissPercentage: nearMissPercentage,
    avgClosureTime: avgClosureTime,
    byType,
    bySeverity,
    byStatus,
    monthlyStats
  };
}

function getIncidentStaff() {
  let sheet = getIncidentsSheet('Incidents_Staff');
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return { staff: [] };
  }
  
  const headers = data[0];
  const staff = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    if (row.Active === 'نعم' || row.Active === 'yes' || row.Active === true) {
      staff.push({
        name: row.Staff_Name || '',
        email: row.Email || '',
        role: row.Role || ''
      });
    }
  }
  
  return { staff };
}

function assignIncident(params) {
  const sheet = getIncidentsSheet('Incidents_Log');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const rowIndex = params.rowIndex;
  if (!rowIndex || rowIndex < 2) {
    return { success: false, error: 'صف غير صالح' };
  }
  
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  const assignedCol = headers.indexOf('Assigned_To');
  const statusCol = headers.indexOf('Status');
  
  if (assignedCol !== -1) {
    sheet.getRange(rowIndex, assignedCol + 1).setValue(params.assignedTo);
  }
  
  if (statusCol !== -1 && params.assignedTo) {
    sheet.getRange(rowIndex, statusCol + 1).setValue('under_review');
  }
  
  const followupSheet = getIncidentsSheet('Incidents_Followup');
  const followupId = `FU-${Date.now()}`;
  followupSheet.appendRow([
    followupId,
    params.incidentId,
    dateStr,
    `تم تعيين المسؤول: ${params.assignedTo}`,
    params.assignedBy || 'النظام',
    params.notes || '',
    'completed'
  ]);
  
  return { success: true, message: 'تم تعيين المسؤول بنجاح' };
}

function escalateIncident(params) {
  const sheet = getIncidentsSheet('Incidents_Log');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const rowIndex = params.rowIndex;
  if (!rowIndex || rowIndex < 2) {
    return { success: false, error: 'صف غير صالح' };
  }
  
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  const statusCol = headers.indexOf('Status');
  const rcaCol = headers.indexOf('RCA_Required');
  
  if (statusCol !== -1) {
    sheet.getRange(rowIndex, statusCol + 1).setValue('rca_required');
  }
  
  if (rcaCol !== -1) {
    sheet.getRange(rowIndex, rcaCol + 1).setValue('نعم');
  }
  
  const followupSheet = getIncidentsSheet('Incidents_Followup');
  const followupId = `FU-${Date.now()}`;
  followupSheet.appendRow([
    followupId,
    params.incidentId,
    dateStr,
    `تم تصعيد الحادث - يتطلب تحليل السبب الجذري (RCA)`,
    params.escalatedBy || 'النظام',
    params.reason || '',
    'pending'
  ]);
  
  return { success: true, message: 'تم تصعيد الحادث بنجاح' };
}

function closeIncident(params) {
  const sheet = getIncidentsSheet('Incidents_Log');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const rowIndex = params.rowIndex;
  if (!rowIndex || rowIndex < 2) {
    return { success: false, error: 'صف غير صالح' };
  }
  
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  const statusCol = headers.indexOf('Status');
  const closedDateCol = headers.indexOf('Closed_Date');
  const closedByCol = headers.indexOf('Closed_By');
  const correctiveCol = headers.indexOf('Corrective_Actions');
  
  if (statusCol !== -1) sheet.getRange(rowIndex, statusCol + 1).setValue('closed');
  if (closedDateCol !== -1) sheet.getRange(rowIndex, closedDateCol + 1).setValue(dateStr);
  if (closedByCol !== -1) sheet.getRange(rowIndex, closedByCol + 1).setValue(params.closedBy || '');
  if (correctiveCol !== -1 && params.correctiveActions) {
    sheet.getRange(rowIndex, correctiveCol + 1).setValue(params.correctiveActions);
  }
  
  const followupSheet = getIncidentsSheet('Incidents_Followup');
  const followupId = `FU-${Date.now()}`;
  followupSheet.appendRow([
    followupId,
    params.incidentId,
    dateStr,
    `تم إغلاق البلاغ`,
    params.closedBy || 'النظام',
    params.summary || '',
    'completed'
  ]);
  
  return { success: true, message: 'تم إغلاق البلاغ بنجاح' };
}

function saveRCA(params) {
  const sheet = getIncidentsSheet('Incidents_Log');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const rowIndex = params.rowIndex;
  if (!rowIndex || rowIndex < 2) {
    return { success: false, error: 'صف غير صالح' };
  }
  
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  const rootCauseCol = headers.indexOf('Root_Cause');
  const correctiveCol = headers.indexOf('Corrective_Actions');
  const lessonsCol = headers.indexOf('Lessons_Learned');
  const statusCol = headers.indexOf('Status');
  
  if (rootCauseCol !== -1) sheet.getRange(rowIndex, rootCauseCol + 1).setValue(params.rootCause || '');
  if (correctiveCol !== -1) sheet.getRange(rowIndex, correctiveCol + 1).setValue(params.correctiveActions || '');
  if (lessonsCol !== -1) sheet.getRange(rowIndex, lessonsCol + 1).setValue(params.lessonsLearned || '');
  
  if (statusCol !== -1) {
    sheet.getRange(rowIndex, statusCol + 1).setValue('in_progress');
  }
  
  const followupSheet = getIncidentsSheet('Incidents_Followup');
  const followupId = `FU-${Date.now()}`;
  followupSheet.appendRow([
    followupId,
    params.incidentId,
    dateStr,
    `تم إكمال تحليل السبب الجذري (RCA)`,
    params.analyzedBy || 'النظام',
    `السبب: ${(params.rootCause || '').substring(0, 100)}...`,
    'completed'
  ]);
  
  return { success: true, message: 'تم حفظ تحليل السبب الجذري بنجاح' };
}
