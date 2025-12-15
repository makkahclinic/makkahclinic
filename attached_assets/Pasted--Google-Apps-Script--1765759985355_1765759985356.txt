/**
 * نظام حوادث سلامة المرضى - Google Apps Script
 * مجمع مكة الطبي بالزاهر
 * 
 * ملف منفصل للحوادث فقط
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
  'escalated': 'تصعيد إداري',
  'rca_required': 'يتطلب RCA',
  'rca_in_progress': 'قيد التحليل العميق',
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
      case 'verifyIncidentPasscode':
        result = verifyIncidentPasscode(payload.staffName, payload.passcode);
        break;
      case 'getEscalationList':
        result = getEscalationList();
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
    version: '2.0'
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
        'Anonymous', 'Reporter_Name', 'Status', 'Assigned_To', 'Assigned_By', 'Assigned_Date',
        'Escalated_To', 'Escalated_By', 'Escalated_Date', 'Escalation_Reason',
        'RCA_Required', 'RCA_Method', 'RCA_FiveWhys', 'RCA_Fishbone',
        'Closed_Date', 'Closed_By', 'Root_Cause',
        'Corrective_Actions', 'Lessons_Learned'
      ]);
    } else if (name === 'Incidents_Followup') {
      sheet.appendRow([
        'Followup_ID', 'Incident_ID', 'Date', 'Action', 'By', 'Notes', 'Status'
      ]);
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

// ==================== نظام الموظفين - يقرأ من On_Charge ====================

function getIncidentStaff() {
  const ss = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('On_Charge');
  
  if (!sheet) {
    return { staff: [], escalationList: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return { staff: [], escalationList: [] };
  }
  
  const staff = [];
  const escalationList = [];
  
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();
    const code = String(data[i][1] || '').trim();
    const escalateTo = String(data[i][2] || '').trim();
    
    if (name) {
      staff.push({
        name: name,
        hasCode: code.length > 0
      });
      
      if (escalateTo) {
        escalationList.push({
          name: escalateTo,
          role: 'مسؤول تصعيد'
        });
      }
    }
  }
  
  const uniqueEscalation = [...new Map(escalationList.map(e => [e.name, e])).values()];
  
  return { staff, escalationList: uniqueEscalation };
}

function verifyIncidentPasscode(staffName, passcode) {
  const ss = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('On_Charge');
  
  if (!sheet) {
    return { verified: false, error: 'شيت On_Charge غير موجود' };
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return { verified: false, error: 'لا توجد بيانات' };
  }
  
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();
    const code = String(data[i][1] || '').trim();
    
    if (name === staffName && code === String(passcode).trim()) {
      return { verified: true, staffName: name };
    }
  }
  
  return { verified: false, error: 'الاسم أو الرمز غير صحيح' };
}

function getEscalationList() {
  const result = getIncidentStaff();
  return { escalationList: result.escalationList || [] };
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
    '', '', '',
    '', '', '', '',
    requiresRCA ? 'نعم' : 'لا',
    '', '', '',
    '', '',
    '', '', ''
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
    if (params.status === 'delayed_24') {
      const now = new Date();
      filtered = filtered.filter(i => {
        if (i.Status === 'closed') return false;
        const reportDate = parseLogDate(i.Report_Date);
        if (!reportDate) return false;
        const hoursDiff = (now - reportDate) / (1000 * 60 * 60);
        return hoursDiff >= 24 && hoursDiff < 48;
      });
    } else if (params.status === 'delayed_48') {
      const now = new Date();
      filtered = filtered.filter(i => {
        if (i.Status === 'closed') return false;
        const reportDate = parseLogDate(i.Report_Date);
        if (!reportDate) return false;
        const hoursDiff = (now - reportDate) / (1000 * 60 * 60);
        return hoursDiff >= 48;
      });
    } else {
      filtered = filtered.filter(i => i.Status === params.status);
    }
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
  
  const now = new Date();
  
  return {
    incidents: filtered.map(i => {
      const reportDate = parseLogDate(i.Report_Date);
      let delayHours = 0;
      if (reportDate && i.Status !== 'closed') {
        delayHours = Math.floor((now - reportDate) / (1000 * 60 * 60));
      }
      
      return {
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
        assignedTo: i.Assigned_To || '',
        escalatedTo: i.Escalated_To || '',
        delayHours: delayHours,
        rowIndex: i._rowIndex
      };
    }),
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
  
  const now = new Date();
  const reportDate = parseLogDate(incident.Report_Date);
  let delayHours = 0;
  if (reportDate && incident.Status !== 'closed') {
    delayHours = Math.floor((now - reportDate) / (1000 * 60 * 60));
  }
  
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
      assignedTo: incident.Assigned_To || '',
      assignedBy: incident.Assigned_By || '',
      assignedDate: incident.Assigned_Date || '',
      escalatedTo: incident.Escalated_To || '',
      escalatedBy: incident.Escalated_By || '',
      escalatedDate: incident.Escalated_Date || '',
      escalationReason: incident.Escalation_Reason || '',
      rcaRequired: incident.RCA_Required === 'نعم',
      rcaMethod: incident.RCA_Method || '',
      rcaFiveWhys: incident.RCA_FiveWhys || '',
      rcaFishbone: incident.RCA_Fishbone || '',
      closedDate: incident.Closed_Date,
      closedBy: incident.Closed_By,
      rootCause: incident.Root_Cause,
      correctiveActions: incident.Corrective_Actions,
      lessonsLearned: incident.Lessons_Learned,
      delayHours: delayHours,
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
  }
  
  return { success: true, message: 'تم تحديث الحالة' };
}

function getIncidentStats(params) {
  const incidents = sheetToObjects(getIncidentsSheet('Incidents_Log'));
  
  const currentYear = new Date().getFullYear();
  const yearIncidents = incidents.filter(i => {
    const date = parseLogDate(i.Date);
    return date && date.getFullYear() === currentYear;
  });
  
  const byType = {};
  for (const [code, name] of Object.entries(INCIDENT_TYPES)) {
    byType[code] = { name, count: 0 };
  }
  
  const bySeverity = {};
  for (const [code, info] of Object.entries(SEVERITY_LEVELS)) {
    bySeverity[code] = { name: info.name, color: info.color, count: 0 };
  }
  
  const byStatus = {};
  for (const [code, name] of Object.entries(INCIDENT_STATUS)) {
    byStatus[code] = { name, count: 0 };
  }
  
  let openIncidents = 0;
  
  yearIncidents.forEach(i => {
    if (byType[i.Incident_Type]) byType[i.Incident_Type].count++;
    if (bySeverity[i.Severity]) bySeverity[i.Severity].count++;
    if (byStatus[i.Status]) byStatus[i.Status].count++;
    if (i.Status !== 'closed') openIncidents++;
  });
  
  const nearMissCount = yearIncidents.filter(i => i.Incident_Type === 'near_miss').length;
  const nearMissPercentage = yearIncidents.length > 0 
    ? Math.round((nearMissCount / yearIncidents.length) * 100) 
    : 0;
  
  const monthlyStats = [];
  for (let m = 0; m < 12; m++) {
    const monthIncidents = yearIncidents.filter(i => {
      const date = parseLogDate(i.Date);
      return date && date.getMonth() === m;
    });
    monthlyStats.push({
      month: m + 1,
      count: monthIncidents.length,
      closed: monthIncidents.filter(i => i.Status === 'closed').length
    });
  }
  
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

function addIncidentFollowup(params) {
  const sheet = getIncidentsSheet('Incidents_Followup');
  const now = getSaudiDate();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  
  const followupId = `FU-${Date.now()}`;
  
  sheet.appendRow([
    followupId,
    params.incidentId,
    dateStr,
    params.action || '',
    params.by || '',
    params.notes || '',
    params.status || 'completed'
  ]);
  
  return { success: true, followupId: followupId };
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
  
  const cols = {
    assignedTo: headers.indexOf('Assigned_To'),
    assignedBy: headers.indexOf('Assigned_By'),
    assignedDate: headers.indexOf('Assigned_Date'),
    status: headers.indexOf('Status')
  };
  
  if (cols.assignedTo !== -1) sheet.getRange(rowIndex, cols.assignedTo + 1).setValue(params.assignedTo);
  if (cols.assignedBy !== -1) sheet.getRange(rowIndex, cols.assignedBy + 1).setValue(params.assignedBy || '');
  if (cols.assignedDate !== -1) sheet.getRange(rowIndex, cols.assignedDate + 1).setValue(dateStr);
  if (cols.status !== -1 && params.assignedTo) sheet.getRange(rowIndex, cols.status + 1).setValue('under_review');
  
  addIncidentFollowup({
    incidentId: params.incidentId,
    action: `تم تعيين المسؤول: ${params.assignedTo}`,
    by: params.assignedBy || 'النظام',
    notes: params.notes || '',
    status: 'completed'
  });
  
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
  
  const cols = {
    escalatedTo: headers.indexOf('Escalated_To'),
    escalatedBy: headers.indexOf('Escalated_By'),
    escalatedDate: headers.indexOf('Escalated_Date'),
    escalationReason: headers.indexOf('Escalation_Reason'),
    status: headers.indexOf('Status')
  };
  
  if (cols.escalatedTo !== -1) sheet.getRange(rowIndex, cols.escalatedTo + 1).setValue(params.escalatedTo);
  if (cols.escalatedBy !== -1) sheet.getRange(rowIndex, cols.escalatedBy + 1).setValue(params.escalatedBy || '');
  if (cols.escalatedDate !== -1) sheet.getRange(rowIndex, cols.escalatedDate + 1).setValue(dateStr);
  if (cols.escalationReason !== -1) sheet.getRange(rowIndex, cols.escalationReason + 1).setValue(params.reason || '');
  if (cols.status !== -1) sheet.getRange(rowIndex, cols.status + 1).setValue('escalated');
  
  addIncidentFollowup({
    incidentId: params.incidentId,
    action: `تم التصعيد إلى: ${params.escalatedTo}`,
    by: params.escalatedBy || 'النظام',
    notes: params.reason || '',
    status: 'completed'
  });
  
  return { success: true, message: 'تم التصعيد بنجاح' };
}

function saveRCA(params) {
  const sheet = getIncidentsSheet('Incidents_Log');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const rowIndex = params.rowIndex;
  if (!rowIndex || rowIndex < 2) {
    return { success: false, error: 'صف غير صالح' };
  }
  
  const cols = {
    rcaMethod: headers.indexOf('RCA_Method'),
    rcaFiveWhys: headers.indexOf('RCA_FiveWhys'),
    rcaFishbone: headers.indexOf('RCA_Fishbone'),
    rootCause: headers.indexOf('Root_Cause'),
    correctiveActions: headers.indexOf('Corrective_Actions'),
    lessonsLearned: headers.indexOf('Lessons_Learned'),
    status: headers.indexOf('Status')
  };
  
  if (cols.rcaMethod !== -1) sheet.getRange(rowIndex, cols.rcaMethod + 1).setValue(params.method || '');
  if (cols.rcaFiveWhys !== -1) sheet.getRange(rowIndex, cols.rcaFiveWhys + 1).setValue(JSON.stringify(params.fiveWhys || {}));
  if (cols.rcaFishbone !== -1) sheet.getRange(rowIndex, cols.rcaFishbone + 1).setValue(JSON.stringify(params.fishbone || {}));
  if (cols.rootCause !== -1) sheet.getRange(rowIndex, cols.rootCause + 1).setValue(params.rootCause || '');
  if (cols.correctiveActions !== -1) sheet.getRange(rowIndex, cols.correctiveActions + 1).setValue(params.correctiveActions || '');
  if (cols.lessonsLearned !== -1) sheet.getRange(rowIndex, cols.lessonsLearned + 1).setValue(params.lessonsLearned || '');
  
  if (cols.status !== -1) {
    const newStatus = params.isComplete ? 'in_progress' : 'rca_in_progress';
    sheet.getRange(rowIndex, cols.status + 1).setValue(newStatus);
  }
  
  addIncidentFollowup({
    incidentId: params.incidentId,
    action: params.isComplete ? 'تم إكمال التحليل العميق (RCA)' : 'تم حفظ مسودة التحليل العميق',
    by: params.savedBy || 'النظام',
    notes: `الطريقة: ${params.method || 'غير محدد'}`,
    status: 'completed'
  });
  
  return { success: true, message: 'تم حفظ التحليل' };
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
  
  const cols = {
    status: headers.indexOf('Status'),
    closedDate: headers.indexOf('Closed_Date'),
    closedBy: headers.indexOf('Closed_By'),
    correctiveActions: headers.indexOf('Corrective_Actions'),
    lessonsLearned: headers.indexOf('Lessons_Learned')
  };
  
  if (cols.status !== -1) sheet.getRange(rowIndex, cols.status + 1).setValue('closed');
  if (cols.closedDate !== -1) sheet.getRange(rowIndex, cols.closedDate + 1).setValue(dateStr);
  if (cols.closedBy !== -1) sheet.getRange(rowIndex, cols.closedBy + 1).setValue(params.closedBy || '');
  if (cols.correctiveActions !== -1 && params.correctiveActions) {
    sheet.getRange(rowIndex, cols.correctiveActions + 1).setValue(params.correctiveActions);
  }
  if (cols.lessonsLearned !== -1 && params.lessonsLearned) {
    sheet.getRange(rowIndex, cols.lessonsLearned + 1).setValue(params.lessonsLearned);
  }
  
  addIncidentFollowup({
    incidentId: params.incidentId,
    action: 'تم إغلاق البلاغ',
    by: params.closedBy || 'النظام',
    notes: params.closureNotes || '',
    status: 'completed'
  });
  
  return { success: true, message: 'تم إغلاق البلاغ بنجاح' };
}
