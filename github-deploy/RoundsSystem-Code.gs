/**
 * نظام جولات السلامة المستقل - Google Apps Script
 * مجمع مكة الطبي بالزاهر
 * 
 * ⚠️ هذا الكود منفصل تماماً عن النظام المركزي
 * يستخدم ملف إكسل خاص بالجولات فقط
 */

const SPREADSHEET_ID = '1JB-I7_r6MiafNFkqau4U7ZJFFooFodObSMVLLm8LRRc';

// ============================================
// نقطة الدخول الرئيسية
// ============================================

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const payload = body.payload || {};
    
    let result;
    
    switch (action) {
      case 'getHomeData':
        result = getHomeData();
        break;
      case 'getRoundsLog':
        result = getRoundsLog(payload.limit || 100, payload.todayOnly || false);
        break;
      case 'logRound':
        result = logRound(payload);
        break;
      case 'getMasterTasks':
        result = getMasterTasks();
        break;
      case 'getStaff':
        result = getStaff();
        break;
      case 'getStaffPasscodes':
        result = getStaffPasscodes();
        break;
      case 'getStaffSummary':
        result = getStaffSummary();
        break;
      case 'getDelayed':
        result = getDelayed();
        break;
      case 'getViolations':
        result = getViolations();
        break;
      case 'getHistory':
        result = getHistory(payload);
        break;
      case 'getMetrics':
        result = getMetrics(payload.days || 14);
        break;
      case 'getChecklist':
        result = getChecklist(payload.taskId, payload.roundName);
        break;
      case 'verifyPasscode':
        result = verifyPasscode(payload.staffName, payload.passcode);
        break;
      case 'resolveViolation':
        result = resolveViolation(payload);
        break;
      case 'addFollowUp':
        result = addFollowUp(payload);
        break;
      case 'getFollowUpsByRound':
        result = getFollowUpsByRound(payload);
        break;
      case 'archiveViolation':
        result = archiveViolation(payload);
        break;
      case 'unarchiveViolation':
        result = unarchiveViolation(payload);
        break;
      case 'archiveOldClosed':
        result = archiveOldClosedViolations();
        break;
      case 'setupArchiveTrigger':
        result = setupWeeklyArchiveTrigger();
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
  try {
    const action = e && e.parameter && e.parameter.action;
    const dataStr = e && e.parameter && e.parameter.data;
    const payload = dataStr ? JSON.parse(dataStr) : {};
    
    let result;
    
    switch (action) {
      case 'getHomeData':
        result = getHomeData();
        break;
      case 'getRoundsLog':
        result = getRoundsLog(payload.limit || 100, payload.todayOnly || false);
        break;
      case 'logRound':
        result = logRound(payload);
        break;
      case 'getMasterTasks':
        result = getMasterTasks();
        break;
      case 'getStaff':
        result = getStaff();
        break;
      case 'getStaffPasscodes':
        result = getStaffPasscodes();
        break;
      case 'getStaffSummary':
        result = getStaffSummary();
        break;
      case 'getDelayed':
        result = getDelayed();
        break;
      case 'getViolations':
        result = getViolations();
        break;
      case 'getHistory':
        result = getHistory(payload);
        break;
      case 'getMetrics':
        result = getMetrics(payload.days || 14);
        break;
      case 'getChecklist':
        result = getChecklist(payload.taskId, payload.roundName);
        break;
      case 'verifyPasscode':
        result = verifyPasscode(payload.staffName, payload.passcode);
        break;
      case 'resolveViolation':
        result = resolveViolation(payload);
        break;
      case 'addFollowUp':
        result = addFollowUp(payload);
        break;
      case 'getFollowUpsByRound':
        result = getFollowUpsByRound(payload);
        break;
      case 'archiveViolation':
        result = archiveViolation(payload);
        break;
      case 'unarchiveViolation':
        result = unarchiveViolation(payload);
        break;
      case 'archiveOldClosed':
        result = archiveOldClosedViolations();
        break;
      case 'setupArchiveTrigger':
        result = setupWeeklyArchiveTrigger();
        break;
      case 'debug':
        result = debugInfo();
        break;
      default:
        return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'Safety Rounds API is running' }))
          .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ ok: true, ...result }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// الدوال المساعدة الأساسية
// ============================================

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(name);
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

const ROUNDS_LOG_COLUMN_MAP = {
  'Date': 'Date', 'التاريخ': 'Date', 'تاريخ': 'Date',
  'Actual_Time': 'Actual_Time', 'Time': 'Actual_Time', 'الوقت': 'Actual_Time', 'وقت': 'Actual_Time',
  'TaskID': 'TaskID', 'Task_ID': 'TaskID', 'رقم المهمة': 'TaskID', 'معرف': 'TaskID',
  'Round_Name': 'Round_Name', 'اسم الجولة': 'Round_Name', 'الجولة': 'Round_Name', 'Round': 'Round_Name',
  'Area': 'Area', 'المنطقة': 'Area', 'الموقع': 'Area',
  'Responsible_Role': 'Responsible_Role', 'المسؤول': 'Responsible_Role', 'Staff': 'Responsible_Role', 'الموظف': 'Responsible_Role',
  'Execution_Responsible': 'Execution_Responsible', 'مسؤول التنفيذ': 'Execution_Responsible', 'المنفذ': 'Execution_Responsible',
  'Status': 'Status', 'الحالة': 'Status',
  'Positive_Notes': 'Positive_Notes', 'ملاحظات إيجابية': 'Positive_Notes', 'إيجابي': 'Positive_Notes',
  'Negative_Notes': 'Negative_Notes', 'ملاحظات سلبية': 'Negative_Notes', 'سلبي': 'Negative_Notes', 'ملخص الخلل': 'Negative_Notes',
  'Is_Violation': 'Is_Violation', 'مخالفة': 'Is_Violation', 'Violation': 'Is_Violation'
};

function normalizeRoundsLogObject(obj) {
  const normalized = { _rowIndex: obj._rowIndex };
  for (const key in obj) {
    if (key === '_rowIndex') continue;
    const normalizedKey = ROUNDS_LOG_COLUMN_MAP[key] || key;
    if (!normalized[normalizedKey]) {
      normalized[normalizedKey] = obj[key];
    }
  }
  return normalized;
}

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

function formatTime(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const h = String(value.getHours()).padStart(2, '0');
    const m = String(value.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const str = String(value);
  if (str.includes('T')) {
    const timePart = str.split('T')[1];
    if (timePart) return timePart.substring(0, 5);
  }
  return str;
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

function getDayNameAr() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[getSaudiDate().getDay()];
}

function getDayNameArDisplay() {
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return days[getSaudiDate().getDay()];
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

function parseClosureDateTime(dateValue) {
  if (!dateValue) return null;
  if (dateValue instanceof Date) return dateValue;
  
  const str = String(dateValue).trim();
  
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
  }
  
  let match = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\s+(\d{1,2}):(\d{2})/);
  if (match) {
    let hours = parseInt(match[4]);
    if (/PM/i.test(str) && hours < 12) hours += 12;
    if (/AM/i.test(str) && hours === 12) hours = 0;
    
    return new Date(
      parseInt(match[3]), 
      parseInt(match[2]) - 1, 
      parseInt(match[1]),
      hours,
      parseInt(match[5])
    );
  }
  
  match = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (match) {
    let hours = parseInt(match[4]);
    if (/PM/i.test(str) && hours < 12) hours += 12;
    if (/AM/i.test(str) && hours === 12) hours = 0;
    
    return new Date(
      parseInt(match[1]), 
      parseInt(match[2]) - 1, 
      parseInt(match[3]),
      hours,
      parseInt(match[5])
    );
  }
  
  const d = new Date(dateValue);
  if (!isNaN(d.getTime())) return d;
  
  const dateOnly = parseLogDate(dateValue);
  if (dateOnly) {
    dateOnly.setHours(23, 59, 59, 999);
  }
  return dateOnly;
}

function parseTime(timeStr) {
  if (!timeStr) return null;
  const str = String(timeStr);
  const match = str.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const d = new Date();
  d.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
  return d;
}

function extractFailedItems(notes) {
  if (!notes) return [];
  
  const items = String(notes)
    .split(/[|\n]/)
    .map(s => s.replace(/❌/g, '').replace(/نقاط الخلل[:\s]*/g, '').trim())
    .filter(s => s && s.length > 5);
  
  return items.map(item => 
    item.replace(/[\u064B-\u065F]/g, '')
        .replace(/[^\u0621-\u064Aa-zA-Z0-9\s]/g, '')
        .trim()
        .substring(0, 40)
  );
}

// ============================================
// محرك المخالفات
// ============================================

function isRealViolation(row) {
  const isViolationFlag = String(row.Is_Violation || '').toLowerCase();
  const status = String(row.Status || '').toLowerCase();
  const negativeNotes = String(row.Negative_Notes || '');
  const notes = String(row.Notes || '');
  const allNotes = negativeNotes + ' ' + notes;

  if (isViolationFlag === 'yes' || isViolationFlag === 'true' || isViolationFlag === '1') return true;
  if (status.includes('خلل') || status.includes('مخالفة') || status.includes('متأخر')) return true;
  if (allNotes.includes('❌') || allNotes.includes('نقاط الخلل')) return true;
  if (negativeNotes.trim().length > 3) return true;

  return false;
}

function buildFollowUpsIndex() {
  const followUpsSheet = getSheet('Rounds_FollowUps');
  const index = {};
  
  if (followUpsSheet) {
    const data = followUpsSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowIndex = Number(data[i][1]);
      if (rowIndex) {
        if (!index[rowIndex]) index[rowIndex] = [];
        index[rowIndex].push({
          date: data[i][2],
          notes: data[i][3],
          user: data[i][4]
        });
      }
    }
  }
  
  return index;
}

function getViolationState(row, followUpsIndex) {
  const rowIndex = Number(row._rowIndex);
  
  const isClosed =
    String(row.Closed_YN || '').toLowerCase() === 'yes' ||
    String(row.Is_Resolved || '').toLowerCase() === 'yes';

  const isArchived =
    String(row.Is_Archived || '').toLowerCase() === 'yes';

  const hasFollowUps = followUpsIndex && rowIndex && !isNaN(rowIndex) && 
    followUpsIndex[rowIndex] && followUpsIndex[rowIndex].length > 0;

  if (isArchived) return 'archived';
  if (isClosed) return 'closed';
  if (hasFollowUps) return 'followup';
  return 'open';
}

// ============================================
// دالة الإضافة الآمنة
// ============================================

function appendRowSafe(sheet, rowData) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn() || rowData.length;
  
  for (let r = 2; r <= Math.min(lastRow, 50); r++) {
    const range = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
    const isEmpty = range.every(v => v === '' || v === null);
    if (isEmpty) {
      sheet.getRange(r, 1, 1, rowData.length).setValues([rowData]);
      return;
    }
  }
  
  sheet.insertRowAfter(lastRow);
  sheet.getRange(lastRow + 1, 1, 1, rowData.length).setValues([rowData]);
}

// ============================================
// دوال نظام المتابعات
// ============================================

function getFollowUpsSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName('Rounds_FollowUps');
  if (!sh) {
    sh = ss.insertSheet('Rounds_FollowUps');
    sh.getRange(1, 1, 1, 8).setValues([[
      'FollowUp_ID',
      'Round_RowIndex',
      'Area',
      'Execution_Responsible',
      'Follower_Name',
      'FollowUp_Notes',
      'Created_At',
      'Created_Date'
    ]]);
  }
  return sh;
}

function addFollowUp(params) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  const roundsSheet = ss.getSheetByName('Rounds_Log');
  if (!roundsSheet) return { success: false, error: 'Rounds_Log not found' };
  
  const rowIndex = params.rowIndex;
  if (!rowIndex || rowIndex < 2) return { success: false, error: 'Invalid row index' };
  
  const headers = roundsSheet.getRange(1, 1, 1, roundsSheet.getLastColumn()).getValues()[0];
  const row = roundsSheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  
  const area = row[headers.indexOf('Area')] || row[headers.indexOf('Round_Name')] || '';
  const execResponsible = row[headers.indexOf('Execution_Responsible')] || row[headers.indexOf('Responsible_Role')] || '';
  
  const followUpsSheet = getFollowUpsSheet_();
  
  const now = getSaudiDate();
  const followUpId = 'FU-' + now.getTime() + '-' + Math.floor(Math.random() * 1000);
  
  const dateTimeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dateStr = getTodayString();
  
  appendRowSafe(followUpsSheet, [
    followUpId,
    rowIndex,
    area,
    execResponsible,
    params.followerName || '',
    params.followUpNotes || '',
    dateTimeStr,
    dateStr
  ]);
  
  return { 
    success: true, 
    message: 'تم حفظ المتابعة بنجاح',
    followUpId: followUpId
  };
}

function getFollowUpsByRound(payload) {
  const rowIndex = payload.rowIndex;
  if (!rowIndex || rowIndex < 2) return { followUps: [] };

  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Rounds_FollowUps');
  if (!sh) return { followUps: [] };

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { followUps: [] };
  
  const headers = data[0];
  const idxRowIndex = headers.indexOf('Round_RowIndex');
  const idxId = headers.indexOf('FollowUp_ID');
  const idxFollower = headers.indexOf('Follower_Name');
  const idxNotes = headers.indexOf('FollowUp_Notes');
  const idxCreatedAt = headers.indexOf('Created_At');

  const result = [];

  for (let i = 1; i < data.length; i++) {
    if (Number(data[i][idxRowIndex]) === Number(rowIndex)) {
      result.push({
        id: data[i][idxId],
        follower: data[i][idxFollower],
        notes: data[i][idxNotes],
        createdAt: data[i][idxCreatedAt]
      });
    }
  }

  result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return { followUps: result };
}

// ============================================
// دوال الصفحة الرئيسية والموظفين
// ============================================

function getHomeData() {
  const todayStr = getTodayString();
  const dayName = getDayNameAr();
  
  const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
  const roundsLogRaw = sheetToObjects(getSheet('Rounds_Log'));
  const roundsLog = roundsLogRaw.map(r => normalizeRoundsLogObject(r));
  
  const todayLog = roundsLog.filter(r => {
    const dateVal = r.Date || r['التاريخ'] || '';
    const logDate = parseLogDate(dateVal);
    if (!logDate) return false;
    const logStr = `${logDate.getFullYear()}-${String(logDate.getMonth()+1).padStart(2,'0')}-${String(logDate.getDate()).padStart(2,'0')}`;
    return logStr === todayStr;
  });
  
  function normalizeStaffName(name) {
    return String(name || '').trim()
      .replace(/^(أ\/|م\/|د\/|أ \/|م \/|د \/)\s*/g, '')
      .trim();
  }
  
  const staffMap = {};
  const taskToAssignee = {};
  const normalizedToOriginal = {};
  
  masterTasks.forEach(task => {
    const assignee = String(task.Assigned_To || '').trim();
    const normalizedAssignee = normalizeStaffName(assignee);
    const taskId = String(task.TaskID || '').trim();
    if (!assignee) return;
    
    const dayCol = task[dayName];
    if (dayCol !== 'Yes' && dayCol !== true && dayCol !== 'yes') return;
    
    if (taskId) {
      taskToAssignee[taskId] = normalizedAssignee;
    }
    
    normalizedToOriginal[normalizedAssignee] = assignee;
    
    if (!staffMap[normalizedAssignee]) {
      staffMap[normalizedAssignee] = {
        name: assignee,
        todayTasks: 0,
        todayDone: 0,
        todayRemaining: 0,
        weeklyTotal: 0,
        topRounds: []
      };
    }
    
    const rpd = parseInt(task.Rounds_Per_Day) || 1;
    staffMap[normalizedAssignee].todayTasks += rpd;
    
    staffMap[normalizedAssignee].topRounds.push({
      taskId: String(task.TaskID || '').trim(),
      name: task.Round_Name_AR || task.Round_Name_EN || task.TaskID || 'غير محدد',
      roundsRequired: rpd,
      done: 0,
      targetTime: formatTime(task.Target_Time)
    });
    
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    weekDays.forEach(d => {
      if (task[d] === 'Yes' || task[d] === true || task[d] === 'yes') {
        staffMap[normalizedAssignee].weeklyTotal += rpd;
      }
    });
  });
  
  todayLog.forEach(log => {
    const taskId = String(log.TaskID || '').trim();
    if (!taskId) return;
    
    const matchedStaff = taskToAssignee[taskId];
    
    if (matchedStaff && staffMap[matchedStaff]) {
      staffMap[matchedStaff].todayDone++;
      const round = staffMap[matchedStaff].topRounds.find(r => r.taskId === taskId);
      if (round) round.done++;
    }
  });
  
  Object.values(staffMap).forEach(s => {
    s.todayRemaining = Math.max(0, s.todayTasks - s.todayDone);
  });
  
  const staffList = Object.values(staffMap);
  const isHoliday = staffList.length === 0;
  const holidayMessage = isHoliday ? 'اليوم إجازة! 🎉 استمتع بيومك وارتح' : '';
  
  return {
    todayDate: todayStr,
    dayName: getDayNameArDisplay(),
    staff: staffList,
    isHoliday: isHoliday,
    holidayMessage: holidayMessage
  };
}

function getRoundsLog(limit, todayOnly) {
  const roundsLogRaw = sheetToObjects(getSheet('Rounds_Log'));
  let roundsLog = roundsLogRaw.map(r => normalizeRoundsLogObject(r));
  
  if (todayOnly) {
    const todayStr = getTodayString();
    roundsLog = roundsLog.filter(r => {
      const logDate = formatDate(r.Date);
      return logDate === todayStr;
    });
  }
  
  roundsLog.sort((a, b) => {
    const dateA = new Date((a.Date || '') + ' ' + (a.Actual_Time || ''));
    const dateB = new Date((b.Date || '') + ' ' + (b.Actual_Time || ''));
    return dateB - dateA;
  });
  
  const entries = roundsLog.slice(0, limit).map(r => ({
    Date: formatDate(r.Date),
    Actual_Time: formatTime(r.Actual_Time),
    TaskID: r.TaskID,
    Round: r.TaskID,
    Round_Name: r.Round_Name || r.Area || r.TaskID || '',
    Area: r.Area || r.Round_Name || '',
    Staff: r.Responsible_Role || '',
    Exec_Responsible: r.Execution_Responsible || '',
    Status: r.Status || '',
    Negative_Notes: r.Negative_Notes || '',
    Positive_Notes: r.Positive_Notes || '',
    Is_Violation: r.Is_Violation || '',
    Closed_YN: r.Closed_YN || ''
  }));
  
  return { entries };
}

function getMasterTasks() {
  return { tasks: sheetToObjects(getSheet('MASTER_TASKS')) };
}

function getStaff() {
  const passcodesSheet = getSheet('Staff_Passcodes');
  if (passcodesSheet) {
    const passcodeData = sheetToObjects(passcodesSheet);
    const staffFromPasscodes = passcodeData
      .map(row => row.Staff_Name || row.Name || '')
      .filter(name => name.trim());
    
    if (staffFromPasscodes.length > 0) {
      return { staff: staffFromPasscodes };
    }
  }
  
  const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
  const staffSet = new Set();
  masterTasks.forEach(t => {
    if (t.Assigned_To) staffSet.add(t.Assigned_To);
  });
  return { staff: Array.from(staffSet) };
}

function getStaffPasscodes() {
  const sheet = getSheet('Staff_Passcodes');
  if (!sheet) return { staff: [] };
  
  const data = sheetToObjects(sheet);
  const staffList = data.map(row => ({
    name: row.Staff_Name || row.Name || '',
    role: row.Role || ''
  })).filter(s => s.name);
  
  return { staff: staffList };
}

function getStaffSummary() {
  const homeData = getHomeData();
  return { 
    staff: homeData.staff,
    isHoliday: homeData.isHoliday,
    holidayMessage: homeData.holidayMessage,
    dayName: homeData.dayName
  };
}

// ============================================
// دوال المتأخرات والمخالفات
// ============================================

function getDelayed() {
  const todayStr = getTodayString();
  const dayName = getDayNameAr();
  const now = getSaudiDate();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
  const roundsLogRaw = sheetToObjects(getSheet('Rounds_Log'));
  const roundsLog = roundsLogRaw.map(r => normalizeRoundsLogObject(r));
  const schedule = sheetToObjects(getSheet('Round_Schedule'));
  
  const todayLog = roundsLog.filter(r => {
    const logDate = parseLogDate(r.Date);
    if (!logDate) return false;
    const logStr = `${logDate.getFullYear()}-${String(logDate.getMonth()+1).padStart(2,'0')}-${String(logDate.getDate()).padStart(2,'0')}`;
    return logStr === todayStr;
  });
  
  const delayed = [];
  
  masterTasks.forEach(task => {
    const dayCol = task[dayName];
    const dayVal = String(dayCol || '').toLowerCase().trim();
    if (dayVal !== 'yes' && dayVal !== 'true' && dayVal !== 'نعم' && dayVal !== '1') return;
    
    const taskId = task.TaskID;
    const rpd = parseInt(task.Rounds_Per_Day) || 1;
    
    const doneCount = todayLog.filter(l => l.TaskID === taskId).length;
    
    for (let roundNum = 1; roundNum <= rpd; roundNum++) {
      if (roundNum <= doneCount) continue;
      
      const scheduleRow = schedule.find(s => s.Task_ID === taskId || s.TaskID === taskId);
      if (!scheduleRow) continue;
      
      const endTimeStr = scheduleRow[`Round_${roundNum}_End`];
      if (!endTimeStr) continue;
      
      const [h, m] = String(endTimeStr).split(':').map(Number);
      const endMinutes = h * 60 + m;
      
      if (currentMinutes > endMinutes) {
        const delayMinutes = currentMinutes - endMinutes;
        
        delayed.push({
          taskId: taskId,
          roundName: task.Round_Name_AR || taskId,
          staff: task.Assigned_To || '',
          roundNumber: roundNum,
          expectedTime: endTimeStr,
          delayMinutes: delayMinutes,
          delayFormatted: Math.floor(delayMinutes / 60) + ':' + String(delayMinutes % 60).padStart(2, '0')
        });
      }
    }
  });
  
  return { delayed: delayed };
}

function getViolations() {
  const roundsLogRaw = sheetToObjects(getSheet('Rounds_Log'));
  const roundsLog = roundsLogRaw.map(r => normalizeRoundsLogObject(r));
  
  const followUpsIndex = buildFollowUpsIndex();

  const allViolations = roundsLog
    .filter(r => isRealViolation(r))
    .map(r => {
      let area = r.Area || r.Round_Name || '';
      if (/^\d+$/.test(String(area).trim())) {
        area = r.Round_Name || 'منطقة غير محددة';
      }
      
      const failedItems = extractFailedItems(r.Negative_Notes);
      const state = getViolationState(r, followUpsIndex);
      
      return {
        _rowIndex: r._rowIndex,
        Date: formatDate(r.Date),
        Actual_Time: formatTime(r.Actual_Time),
        Area: area,
        Round_Name: r.Round_Name || area || '',
        Responsible_Role: r.Responsible_Role || '',
        Execution_Responsible: r.Execution_Responsible || '',
        Status: r.Status || '',
        Negative_Notes: r.Negative_Notes || r.Notes || '',
        Is_Resolved: String(r.Closed_YN || r.Is_Resolved || 'no').toLowerCase(),
        Is_Archived: String(r.Is_Archived || 'no').toLowerCase(),
        Resolved_By: r.Resolved_By || '',
        Resolved_Date: formatDate(r.Resolved_Date) || '',
        failedItems: failedItems,
        State: state,
        hasFollowUps: followUpsIndex[r._rowIndex] ? true : false,
        followUpsCount: followUpsIndex[r._rowIndex] ? followUpsIndex[r._rowIndex].length : 0
      };
    });

  const openViolations = allViolations.filter(v => v.State === 'open');
  const followupViolations = allViolations.filter(v => v.State === 'followup');
  const closedViolations = allViolations.filter(v => v.State === 'closed');
  const archivedViolations = allViolations.filter(v => v.State === 'archived');

  const repeatGroups = {};
  const activeViolations = allViolations.filter(v => v.State === 'open' || v.State === 'followup');
  
  activeViolations.forEach(v => {
    const area = v.Area || v.Round_Name || 'غير محدد';
    
    let foundGroup = null;
    
    for (const key in repeatGroups) {
      if (key.startsWith(area + '||')) {
        const existingItems = repeatGroups[key].allFailedItems;
        const overlap = v.failedItems.filter(item => existingItems.includes(item));
        
        if (overlap.length > 0) {
          foundGroup = repeatGroups[key];
          break;
        }
      }
    }
    
    if (foundGroup) {
      foundGroup.count++;
      if (v.Date && !foundGroup.dates.includes(v.Date)) foundGroup.dates.push(v.Date);
      if (v._rowIndex) foundGroup.rowIndices.push(v._rowIndex);
      v.failedItems.forEach(item => {
        if (!foundGroup.allFailedItems.includes(item)) {
          foundGroup.allFailedItems.push(item);
        }
      });
      foundGroup.issue = v.Negative_Notes || foundGroup.issue;
      foundGroup.assignedTo = v.Execution_Responsible || foundGroup.assignedTo;
    } else {
      const groupKey = `${area}||${v._rowIndex || Date.now()}`;
      repeatGroups[groupKey] = {
        area: area,
        issue: v.Negative_Notes || 'مخالفة',
        assignedTo: v.Execution_Responsible || 'غير محدد',
        detectedBy: v.Responsible_Role,
        count: 1,
        dates: v.Date ? [v.Date] : [],
        rowIndices: v._rowIndex ? [v._rowIndex] : [],
        allFailedItems: [...v.failedItems]
      };
    }
  });

  const repeated = Object.values(repeatGroups)
    .filter(x => x.count >= 2)
    .sort((a,b) => b.count - a.count);

  return {
    violations: allViolations,
    active: activeViolations,
    repeated,
    resolved: closedViolations,
    total: allViolations.length,
    pending: openViolations.length,
    open: openViolations.length,
    followup: followupViolations.length,
    closed: closedViolations.length,
    archived: archivedViolations.length,
    activeCount: activeViolations.length
  };
}

function resolveViolation(params) {
  const sheet = getSheet('Rounds_Log');
  if (!sheet) return { success: false, error: 'Sheet not found' };
  
  const rowIndex = params.rowIndex;
  if (!rowIndex || rowIndex < 2) return { success: false, error: 'Invalid row' };
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const closedCol = headers.indexOf('Closed_YN') + 1;
  const resolvedByCol = headers.indexOf('Resolved_By') + 1;
  const resolvedDateCol = headers.indexOf('Resolved_Date') + 1;
  
  if (closedCol > 0) {
    sheet.getRange(rowIndex, closedCol).setValue('Yes');
  }
  
  if (resolvedByCol > 0 && params.resolvedBy) {
    sheet.getRange(rowIndex, resolvedByCol).setValue(params.resolvedBy);
  }
  
  if (resolvedDateCol > 0) {
    sheet.getRange(rowIndex, resolvedDateCol).setValue(getTodayString());
  }
  
  return { success: true, message: 'تم معالجة المخالفة بنجاح' };
}

// ============================================
// دوال السجل والمقاييس
// ============================================

function getHistory(params) {
  const roundsLogRaw = sheetToObjects(getSheet('Rounds_Log'));
  const roundsLog = roundsLogRaw.map(r => normalizeRoundsLogObject(r));
  
  const followUpsIndex = buildFollowUpsIndex();
  
  let filtered = roundsLog;
  
  if (params.days && params.days > 0) {
    const cutoff = getSaudiDate();
    cutoff.setDate(cutoff.getDate() - parseInt(params.days));
    filtered = filtered.filter(r => {
      const logDate = parseLogDate(r.Date);
      return logDate && logDate >= cutoff;
    });
  }
  
  if (params.startDate) {
    filtered = filtered.filter(r => {
      const logDate = parseLogDate(r.Date);
      if (!logDate) return false;
      return logDate >= new Date(params.startDate);
    });
  }
  
  if (params.endDate) {
    filtered = filtered.filter(r => {
      const logDate = parseLogDate(r.Date);
      if (!logDate) return false;
      return logDate <= new Date(params.endDate + 'T23:59:59');
    });
  }
  
  if (params.staff) {
    filtered = filtered.filter(r => r.Responsible_Role === params.staff || r.Execution_Responsible === params.staff);
  }
  
  if (params.round) {
    filtered = filtered.filter(r => r.TaskID === params.round);
  }
  
  if (params.status) {
    filtered = filtered.filter(r => {
      if (!isRealViolation(r)) return false;
      const state = getViolationState(r, followUpsIndex);
      return state === params.status;
    });
  }
  
  filtered.sort((a, b) => {
    const dateA = parseLogDate(a.Date);
    const dateB = parseLogDate(b.Date);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB - dateA;
  });
  
  const entries = filtered.map(r => {
    let delayMin = 0;
    const status = String(r.Status || '').toLowerCase();
    if (status.includes('متأخر') || status.includes('تأخر')) {
      if (r.Planned_Time && r.Actual_Time) {
        try {
          const planned = parseTime(r.Planned_Time);
          const actual = parseTime(r.Actual_Time);
          if (planned && actual) {
            delayMin = Math.round((actual - planned) / 60000);
            if (delayMin < 0) delayMin = 0;
          }
        } catch(e) {}
      }
      if (delayMin === 0) delayMin = 15;
    }
    
    const violationState = getViolationState(r, followUpsIndex);
    const rowIndex = Number(r._rowIndex);
    const followUpsCount = (followUpsIndex[rowIndex] || []).length;
    
    return {
      _rowIndex: r._rowIndex,
      Date: formatDate(r.Date),
      Actual_Time: formatTime(r.Actual_Time),
      Time: formatTime(r.Actual_Time),
      Planned_Time: formatTime(r.Planned_Time) || '',
      Delay_Min: delayMin,
      TaskID: r.TaskID,
      Area: r.Area || r.Round_Name,
      Round_Name: r.Round_Name,
      Staff: r.Responsible_Role,
      Responsible_Role: r.Responsible_Role,
      Exec_Responsible: r.Execution_Responsible,
      Execution_Responsible: r.Execution_Responsible,
      Status: r.Status,
      Negative_Notes: r.Negative_Notes,
      Positive_Notes: r.Positive_Notes,
      Is_Violation: r.Is_Violation,
      Closed_YN: r.Closed_YN,
      Is_Resolved: r.Closed_YN,
      Resolved_By: r.Resolved_By,
      Resolved_Date: r.Resolved_Date,
      State: violationState,
      hasFollowUps: followUpsCount > 0,
      followUpsCount: followUpsCount
    };
  });
  
  return { entries };
}

function getMetrics(days) {
  const roundsLogRaw = sheetToObjects(getSheet('Rounds_Log'));
  const roundsLog = roundsLogRaw.map(r => normalizeRoundsLogObject(r));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  const filtered = roundsLog.filter(r => {
    const logDate = parseLogDate(r.Date);
    return logDate && logDate >= cutoff;
  });
  
  const total = filtered.length;
  
  const COMPLETED_STATUS = ['تم', 'مكتمل', 'مكتملة', 'OK', 'في الوقت', 'done', 'complete'];
  const DELAYED_STATUS = ['متأخر', 'متأخرة', 'تأخر', 'delayed', 'late'];
  const VIOLATION_STATUS = ['خلل', 'مخالفة', 'violation'];
  
  let completed = 0;
  let delayed = 0;
  let violations = 0;
  
  const byDate = {};
  const byStaff = {};
  const byArea = {};
  
  filtered.forEach(r => {
    const status = String(r.Status || '').toLowerCase().trim();
    const notes = String(r.Negative_Notes || '').toLowerCase();
    const isViol = String(r.Is_Violation || '').toLowerCase();
    
    const isViolation = isViol === 'true' || isViol === 'yes' || 
        VIOLATION_STATUS.some(s => status.includes(s.toLowerCase())) ||
        notes.includes('نقاط الخلل') || notes.includes('❌');
    
    const isDelayed = DELAYED_STATUS.some(s => status.includes(s.toLowerCase()));
    const isCompleted = !isViolation && !isDelayed && COMPLETED_STATUS.some(s => status.includes(s.toLowerCase()));
    
    if (isViolation) {
      violations++;
    } else if (isCompleted) {
      completed++;
    } else if (isDelayed) {
      delayed++;
    } else {
      completed++;
    }
    
    const dateStr = formatDate(r.Date);
    if (dateStr) {
      if (!byDate[dateStr]) byDate[dateStr] = { completed: 0, delayed: 0, violations: 0, total: 0 };
      byDate[dateStr].total++;
      if (isViolation) byDate[dateStr].violations++;
      else if (isDelayed) byDate[dateStr].delayed++;
      else byDate[dateStr].completed++;
    }
    
    const staff = r.Responsible_Role || r.Execution_Responsible || '';
    if (staff) {
      if (!byStaff[staff]) byStaff[staff] = { completed: 0, delayed: 0, violations: 0, total: 0 };
      byStaff[staff].total++;
      if (isViolation) byStaff[staff].violations++;
      else if (isDelayed) byStaff[staff].delayed++;
      else byStaff[staff].completed++;
    }
    
    const area = r.Area || r.Round_Name || '';
    if (area) {
      if (!byArea[area]) byArea[area] = { completed: 0, delayed: 0, violations: 0, total: 0 };
      byArea[area].total++;
      if (isViolation) byArea[area].violations++;
      else if (isDelayed) byArea[area].delayed++;
      else byArea[area].completed++;
    }
  });
  
  const complianceRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  return {
    total,
    completed,
    delayed,
    violations,
    complianceRate,
    compliance: complianceRate,
    byDate,
    byStaff,
    byArea
  };
}

// ============================================
// دوال التسجيل والتحقق
// ============================================

function logRound(params) {
  const sheet = getSheet('Rounds_Log');
  if (!sheet) return { success: false, error: 'Rounds_Log sheet not found' };
  
  const taskId = String(params.taskId || '').trim();
  
  if (!taskId) {
    return { success: false, error: 'TaskID مطلوب لتسجيل الجولة' };
  }
  
  const now = getSaudiDate();
  const dateStr = getTodayString();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headerMap = {};
  headers.forEach((h, i) => { headerMap[String(h).trim()] = i; });
  
  const newRow = new Array(headers.length).fill('');
  
  const data = {
    'Date': dateStr,
    'TaskID': taskId,
    'RoundNo': '1',
    'Area': params.area || params.roundName || '',
    'Domain': params.roundName || '',
    'Planned_Time': '',
    'Actual_Time': timeStr,
    'Delay_Min': '',
    'MaxDelay_Min': '',
    'Status': params.status || 'في الوقت',
    'Alert': '',
    'Responsible_Role': params.responsibleRole || params.staff || '',
    'Execution_Responsible': params.executionResponsible || params.execResponsible || '',
    'Positive_Notes': params.positiveNotes || '',
    'Negative_Notes': params.negativeNotes || '',
    'Actions_Taken': '',
    'Closed_YN': '',
    'Closed_Date': '',
    'Is_Violation': params.isViolation || 'No',
    'Is_Resolved': '',
    'Resolved_By': '',
    'Resolved_Date': '',
    'FollowUp_Status': '',
    'FollowUp_By': '',
    'FollowUp_Notes': '',
    'FollowUp_At': '',
    'Is_Archived': ''
  };
  
  for (const key in data) {
    if (headerMap[key] !== undefined) {
      newRow[headerMap[key]] = data[key];
    }
  }
  
  appendRowSafe(sheet, newRow);
  
  return { success: true, message: 'تم تسجيل الجولة بنجاح' };
}

function verifyPasscode(staffName, passcode, checkResolvePermission = false) {
  const sheet = getSheet('Staff_Passcodes');
  if (!sheet) return { valid: false, error: 'جدول الموظفين غير موجود' };
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const nameCol = headers.indexOf('Staff_Name');
  const passcodeCol = headers.indexOf('Passcode');
  const canResolveCol = headers.indexOf('Can_Resolve');
  
  let foundStaff = null;
  let foundRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    const rowPasscode = String(data[i][passcodeCol >= 0 ? passcodeCol : 1] || '').trim();
    if (rowPasscode === String(passcode).trim()) {
      foundStaff = {
        name: data[i][nameCol >= 0 ? nameCol : 0] || 'موظف',
        passcode: rowPasscode
      };
      foundRowIndex = i;
      break;
    }
  }
  
  if (!foundStaff) {
    return { valid: false, error: 'الرمز السري غير صحيح' };
  }
  
  if (staffName && staffName.trim()) {
    if (foundStaff.name.trim() !== staffName.trim()) {
      return { valid: false, error: 'الرمز السري لا يتطابق مع الاسم المختار' };
    }
  }
  
  if (checkResolvePermission && canResolveCol >= 0) {
    const allowed = String(data[foundRowIndex][canResolveCol] || '').toLowerCase();
    if (allowed !== 'yes' && allowed !== 'true' && allowed !== '1') {
      return { valid: false, error: 'غير مخوّل لإغلاق المخالفات' };
    }
  }
  
  return { valid: true, verified: true, staffName: foundStaff.name };
}

function getChecklist(taskId, roundName) {
  // Get task-specific responsibles from MASTER_TASKS
  const taskResponsibles = getTaskResponsibles(taskId, roundName);
  
  if (!taskId) return { items: [], responsibles: taskResponsibles.length ? taskResponsibles : getStaffList() };
  
  const roundPrefix = `R${String(taskId).padStart(2, '0')}_`;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const allSheets = ss.getSheets();
  
  let sheet = null;
  for (const s of allSheets) {
    if (s.getName().startsWith(roundPrefix)) {
      sheet = s;
      break;
    }
  }
  
  if (!sheet) {
    return getChecklistFromUnified(taskId, roundName);
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { items: [], responsibles: taskResponsibles.length ? taskResponsibles : getStaffList() };
  
  const headers = data[0].map(h => String(h || '').trim());
  
  const itemColNames = ['Item_Description_AR', 'Item_Description', 'Item_Desc', 'البند', 'نص البند', 'Description', 'Item', 'Text'];
  let itemCol = -1;
  for (const name of itemColNames) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
    if (idx >= 0) {
      itemCol = idx;
      break;
    }
  }
  
  if (itemCol === -1 && data.length > 1) {
    let maxLen = 0;
    for (let c = 0; c < headers.length; c++) {
      const val = String(data[1][c] || '');
      if (val.length > maxLen && isNaN(val)) {
        maxLen = val.length;
        itemCol = c;
      }
    }
  }
  
  if (itemCol === -1) itemCol = Math.min(3, headers.length - 1);
  
  const items = [];
  for (let i = 1; i < data.length; i++) {
    const text = String(data[i][itemCol] || '').trim();
    if (text && text.length > 2 && isNaN(text)) {
      items.push({
        id: i,
        text,
        item: text
      });
    }
  }
  
  return { items, responsibles: taskResponsibles.length ? taskResponsibles : getStaffList() };
}

// Helper function to get task-specific responsibles from Responsible_1 to Responsible_19
function getTaskResponsibles(taskId, roundName) {
  const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
  
  // Find matching task
  const task = masterTasks.find(t => {
    if (String(t.TaskID) === String(taskId)) return true;
    if (t.Round_Name_AR === roundName) return true;
    if (t.Round_Name_EN === roundName) return true;
    if (t.Round_Name === roundName) return true;
    return false;
  });
  
  if (!task) return [];
  
  // Extract Responsible_1 through Responsible_19
  const responsibles = [];
  for (let i = 1; i <= 19; i++) {
    const val = task['Responsible_' + i];
    if (val && typeof val === 'string' && val.trim()) {
      responsibles.push(val.trim());
    }
  }
  
  return responsibles;
}

function getChecklistFromUnified(taskId, roundName) {
  const taskResponsibles = getTaskResponsibles(taskId, roundName);
  const sheet = getSheet('Checklists');
  if (!sheet) return { items: [], responsibles: taskResponsibles.length ? taskResponsibles : getStaffList() };
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { items: [], responsibles: taskResponsibles.length ? taskResponsibles : getStaffList() };
  
  const headers = data[0];
  
  const textColNames = ['Item_Description_AR', 'Item_Description', 'Item_Desc', 'البند', 'نص البند', 'Description', 'Item', 'Text'];
  let textColIndex = -1;
  for (const name of textColNames) {
    const idx = headers.indexOf(name);
    if (idx >= 0) {
      textColIndex = idx;
      break;
    }
  }
  
  const searchKeys = [
    String(taskId || '').trim().toLowerCase(),
    String(roundName || '').trim().toLowerCase()
  ].filter(k => k.length > 0);
  
  const items = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowText = row.map(cell => String(cell || '').toLowerCase()).join(' ');
    
    const matched = searchKeys.some(key => rowText.includes(key));
    
    if (matched) {
      const itemText = textColIndex >= 0 
        ? row[textColIndex] 
        : row.find(v => v && String(v).length > 3) || '';
      
      items.push({
        id: i,
        text: String(itemText || '').trim(),
        item: String(itemText || '').trim()
      });
    }
  }
  
  return { items, responsibles: taskResponsibles.length ? taskResponsibles : getStaffList() };
}

function getStaffList() {
  const passcodes = getSheet('Staff_Passcodes');
  if (passcodes) {
    const rows = passcodes.getDataRange().getValues();
    if (rows.length > 1) {
      const headers = rows[0];
      const nameColNames = ['Staff_Name', 'Name', 'الاسم', 'اسم الموظف', 'Staff'];
      let idx = -1;
      for (const name of nameColNames) {
        const found = headers.indexOf(name);
        if (found >= 0) { idx = found; break; }
      }
      if (idx === -1) idx = 0;
      
      const names = rows.slice(1).map(r => String(r[idx] || '').trim()).filter(Boolean);
      if (names.length > 0) return names;
    }
  }

  const tasks = sheetToObjects(getSheet('MASTER_TASKS'));
  return [...new Set(tasks.map(t => t.Assigned_To).filter(Boolean))];
}

function debugInfo() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets().map(s => s.getName());
  
  return {
    spreadsheetId: SPREADSHEET_ID,
    sheets: sheets,
    timestamp: getSaudiDate().toISOString()
  };
}

// ============================================
// نظام الأرشفة التلقائية
// ============================================

function archiveOldClosedViolations() {
  const sheet = getSheet('Rounds_Log');
  if (!sheet) return { success: false, error: 'Rounds_Log sheet not found' };
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const colDate = headers.indexOf('Date');
  const colResolvedDate = headers.indexOf('Resolved_Date');
  const colClosedOn = headers.indexOf('Closed_On');
  const colStatusDate = headers.indexOf('Status_Date');
  const colIsViolation = headers.indexOf('Is_Violation');
  const colIsResolved = headers.indexOf('Is_Resolved');
  const colClosedYN = headers.indexOf('Closed_YN');
  let colIsArchived = headers.indexOf('Is_Archived');
  
  if (colIsArchived === -1) {
    colIsArchived = headers.length;
    sheet.getRange(1, colIsArchived + 1).setValue('Is_Archived');
  }
  
  const now = getSaudiDate();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let archivedCount = 0;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    if (!row[colDate]) continue;
    
    const isViolation = String(row[colIsViolation] || '').toLowerCase() === 'yes' ||
                        String(row[colIsViolation] || '').toLowerCase() === 'true';
    
    const resolvedVal = colIsResolved >= 0 ? String(row[colIsResolved] || '').toLowerCase() : '';
    const closedVal = colClosedYN >= 0 ? String(row[colClosedYN] || '').toLowerCase() : '';
    const isResolved = resolvedVal === 'yes' || resolvedVal === 'true' ||
                       closedVal === 'yes' || closedVal === 'true';
    
    const archivedVal = colIsArchived >= 0 ? String(row[colIsArchived] || '').toLowerCase() : '';
    const isArchived = archivedVal === 'yes' || archivedVal === 'true';
    
    if (!isViolation || !isResolved || isArchived) continue;
    
    let closedDate = null;
    
    const closureCols = [colResolvedDate, colClosedOn, colStatusDate];
    for (const col of closureCols) {
      if (col >= 0 && row[col]) {
        const cellValue = row[col];
        if (cellValue instanceof Date) {
          closedDate = cellValue;
          break;
        }
        const parsed = parseClosureDateTime(cellValue);
        if (parsed) {
          closedDate = parsed;
          break;
        }
      }
    }
    
    if (!closedDate) continue;
    
    if (closedDate.getTime() < oneWeekAgo.getTime()) {
      sheet.getRange(i + 1, colIsArchived + 1).setValue('Yes');
      archivedCount++;
    }
  }
  
  return { 
    success: true, 
    archivedCount: archivedCount,
    message: `تمت أرشفة ${archivedCount} مخالفة مغلقة`
  };
}

function setupWeeklyArchiveTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'archiveOldClosedViolations') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  ScriptApp.newTrigger('archiveOldClosedViolations')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(2)
    .create();
  
  return { success: true, message: 'تم إعداد الأرشفة التلقائية كل يوم أحد الساعة 2 صباحاً' };
}

function archiveViolation(params) {
  const sheet = getSheet('Rounds_Log');
  if (!sheet) return { success: false, error: 'Rounds_Log sheet not found' };
  
  const rowIndex = parseInt(params.rowIndex);
  if (!rowIndex || rowIndex < 2) return { success: false, error: 'Invalid row index' };
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let colIsArchived = headers.indexOf('Is_Archived');
  
  if (colIsArchived === -1) {
    colIsArchived = headers.length;
    sheet.getRange(1, colIsArchived + 1).setValue('Is_Archived');
  }
  
  sheet.getRange(rowIndex, colIsArchived + 1).setValue('Yes');
  
  return { success: true, message: 'تمت أرشفة المخالفة بنجاح' };
}

function unarchiveViolation(params) {
  const sheet = getSheet('Rounds_Log');
  if (!sheet) return { success: false, error: 'Rounds_Log sheet not found' };
  
  const rowIndex = parseInt(params.rowIndex);
  if (!rowIndex || rowIndex < 2) return { success: false, error: 'Invalid row index' };
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIsArchived = headers.indexOf('Is_Archived');
  
  if (colIsArchived === -1) return { success: false, error: 'Is_Archived column not found' };
  
  sheet.getRange(rowIndex, colIsArchived + 1).setValue('No');
  
  return { success: true, message: 'تم إلغاء الأرشفة بنجاح' };
}
