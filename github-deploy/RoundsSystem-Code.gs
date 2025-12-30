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
        result = getRoundsLog(payload.limit || 100);
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
        result = getChecklist(payload.taskId);
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
  
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'Safety Rounds API is running' }))
    .setMimeType(ContentService.MimeType.JSON);
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
// دالة الإضافة الآمنة (تمنع خطأ 10M cells)
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
// دوال نظام المتابعات الجديد
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

/**
 * جلب متابعات مخالفة معينة
 */
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
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
  
  const todayLog = roundsLog.filter(r => {
    const logDate = parseLogDate(r.Date);
    if (!logDate) return false;
    const logStr = `${logDate.getFullYear()}-${String(logDate.getMonth()+1).padStart(2,'0')}-${String(logDate.getDate()).padStart(2,'0')}`;
    return logStr === todayStr;
  });
  
  const staffMap = {};
  masterTasks.forEach(task => {
    const assignee = task.Assigned_To || '';
    if (!assignee) return;
    
    const dayCol = task[dayName];
    if (dayCol !== 'Yes' && dayCol !== true && dayCol !== 'yes') return;
    
    if (!staffMap[assignee]) {
      staffMap[assignee] = {
        name: assignee,
        todayTasks: 0,
        todayDone: 0,
        todayRemaining: 0,
        weeklyTotal: 0,
        topRounds: []
      };
    }
    
    const rpd = parseInt(task.Rounds_Per_Day) || 1;
    staffMap[assignee].todayTasks += rpd;
    
    staffMap[assignee].topRounds.push({
      taskId: task.TaskID || '',
      name: task.Round_Name_AR || task.Round_Name_EN || task.TaskID || 'غير محدد',
      roundsRequired: rpd,
      done: 0,
      targetTime: formatTime(task.Target_Time)
    });
    
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    weekDays.forEach(d => {
      if (task[d] === 'Yes' || task[d] === true || task[d] === 'yes') {
        staffMap[assignee].weeklyTotal += rpd;
      }
    });
  });
  
  todayLog.forEach(log => {
    const staff = log.Responsible_Role || log.Execution_Responsible || '';
    const taskId = log.TaskID || '';
    if (staffMap[staff]) {
      staffMap[staff].todayDone++;
      const round = staffMap[staff].topRounds.find(r => r.taskId === taskId);
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

function getRoundsLog(limit) {
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
  
  roundsLog.sort((a, b) => {
    const dateA = new Date(a.Date + ' ' + (a.Actual_Time || ''));
    const dateB = new Date(b.Date + ' ' + (b.Actual_Time || ''));
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
  const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
  const staffSet = new Set();
  masterTasks.forEach(t => {
    if (t.Assigned_To) staffSet.add(t.Assigned_To);
  });
  return { staff: Array.from(staffSet) };
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
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
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
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));

  const allViolations = roundsLog.filter(r => {
    const isViolation = String(r.Is_Violation || '').toLowerCase();
    if (isViolation === 'true' || isViolation === 'yes') return true;

    const status = String(r.Status || '').toLowerCase();
    const notes = String(r.Negative_Notes || '').toLowerCase();
    return status.includes('خلل') || notes.includes('نقاط الخلل') || notes.includes('❌');
  }).map(r => {
    let area = r.Area || r.Round_Name || '';
    if (/^\d+$/.test(String(area).trim())) {
      area = r.Round_Name || 'منطقة غير محددة';
    }
    
    const failedItems = extractFailedItems(r.Negative_Notes);
    
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
      failedItems: failedItems
    };
  });

  const openViolations = allViolations.filter(v => v.Is_Resolved !== 'yes');
  const resolvedViolations = allViolations.filter(v => v.Is_Resolved === 'yes');

  const repeatGroups = {};
  
  openViolations.forEach(v => {
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
    repeated,
    resolved: resolvedViolations,
    total: allViolations.length,
    pending: openViolations.length
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
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
  
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
    
    return {
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
      Resolved_Date: r.Resolved_Date
    };
  });
  
  return { entries };
}

function getMetrics(days) {
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
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
    
    // تجميع حسب التاريخ
    const dateStr = formatDate(r.Date);
    if (dateStr) {
      if (!byDate[dateStr]) byDate[dateStr] = { completed: 0, delayed: 0, violations: 0, total: 0 };
      byDate[dateStr].total++;
      if (isViolation) byDate[dateStr].violations++;
      else if (isDelayed) byDate[dateStr].delayed++;
      else byDate[dateStr].completed++;
    }
    
    // تجميع حسب الموظف
    const staff = r.Responsible_Role || r.Execution_Responsible || '';
    if (staff) {
      if (!byStaff[staff]) byStaff[staff] = { completed: 0, delayed: 0, violations: 0, total: 0 };
      byStaff[staff].total++;
      if (isViolation) byStaff[staff].violations++;
      else if (isDelayed) byStaff[staff].delayed++;
      else byStaff[staff].completed++;
    }
    
    // تجميع حسب المنطقة
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
  
  const now = getSaudiDate();
  const dateStr = getTodayString();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  
  const newRow = [
    dateStr,
    timeStr,
    params.taskId || '',
    params.roundName || '',
    params.area || '',
    params.responsibleRole || '',
    params.executionResponsible || '',
    params.status || 'تم',
    params.positiveNotes || '',
    params.negativeNotes || '',
    params.isViolation || 'No'
  ];
  
  appendRowSafe(sheet, newRow);
  
  return { success: true, message: 'تم تسجيل الجولة بنجاح' };
}

function verifyPasscode(staffName, passcode) {
  const sheet = getSheet('Staff_Passcodes');
  if (!sheet) return { verified: false, error: 'Staff sheet not found' };
  
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === staffName && String(data[i][1]) === String(passcode)) {
      return { verified: true, staffName: staffName };
    }
  }
  
  return { verified: false, error: 'رمز الدخول غير صحيح' };
}

function getChecklist(taskId) {
  const sheet = getSheet('Checklists');
  if (!sheet) return { items: [] };
  
  const data = sheetToObjects(sheet);
  const items = data.filter(row => row.TaskID === taskId);
  
  return { items };
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
