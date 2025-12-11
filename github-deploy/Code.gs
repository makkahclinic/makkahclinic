/**
 * نظام جولات السلامة المطوّر - Google Apps Script
 * مجمع مكة الطبي
 */

const SPREADSHEET_ID = '1JB-I7_r6MiafNFkqau4U7ZJFFooFodObSMVLLm8LRRc';

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
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'Safety Rounds API is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

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

function getTodayString() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getDayNameAr() {
  // Sheet uses English day abbreviations: Sun, Mon, Tue, Wed, Thu, Fri, Sat
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[new Date().getDay()];
}

function getDayNameArDisplay() {
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return days[new Date().getDay()];
}

function getHomeData() {
  const todayStr = getTodayString();
  const dayName = getDayNameAr();
  
  const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
  
  const todayLog = roundsLog.filter(r => {
    const logDate = r.Date ? new Date(r.Date) : null;
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
      targetTime: task.Target_Time || ''
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
      // Update done count for the specific round
      const round = staffMap[staff].topRounds.find(r => r.taskId === taskId);
      if (round) round.done++;
    }
  });
  
  Object.values(staffMap).forEach(s => {
    s.todayRemaining = Math.max(0, s.todayTasks - s.todayDone);
  });
  
  return {
    todayDate: todayStr,
    dayName: getDayNameArDisplay(), // Return Arabic name for display
    staff: Object.values(staffMap)
  };
}

function getRoundsLog(limit) {
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
  
  roundsLog.sort((a, b) => {
    const dateA = new Date(a.Date + ' ' + (a.Actual_Time || ''));
    const dateB = new Date(b.Date + ' ' + (b.Actual_Time || ''));
    return dateB - dateA;
  });
  
  // Map to frontend expected format
  const entries = roundsLog.slice(0, limit).map(r => ({
    Date: r.Date,
    Time: r.Actual_Time,
    TaskID: r.TaskID,
    Round: r.TaskID,
    Area: r.Area,
    Staff: r.Responsible_Role,
    Exec_Responsible: r.Execution_Responsible,
    Status: r.Status,
    Negative_Notes: r.Negative_Notes,
    Positive_Notes: r.Positive_Notes,
    Is_Violation: r.Is_Violation,
    Closed_YN: r.Closed_YN
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
  return { staff: homeData.staff };
}

function getDelayed() {
  const todayStr = getTodayString();
  const dayName = getDayNameAr();
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
  const schedule = sheetToObjects(getSheet('Round_Schedule'));
  
  const todayLog = roundsLog.filter(r => {
    const logDate = r.Date ? new Date(r.Date) : null;
    if (!logDate) return false;
    const logStr = `${logDate.getFullYear()}-${String(logDate.getMonth()+1).padStart(2,'0')}-${String(logDate.getDate()).padStart(2,'0')}`;
    return logStr === todayStr;
  });
  
  const delayed = [];
  
  masterTasks.forEach(task => {
    const dayCol = task[dayName];
    if (dayCol !== 'Yes' && dayCol !== true && dayCol !== 'yes') return;
    
    const taskId = task.TaskID;
    const rpd = parseInt(task.Rounds_Per_Day) || 1;
    
    const doneCount = todayLog.filter(l => l.TaskID === taskId).length;
    
    for (let roundNum = 1; roundNum <= rpd; roundNum++) {
      if (roundNum <= doneCount) continue;
      
      const scheduleRow = schedule.find(s => s.Task_ID === taskId);
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

  const violations = roundsLog.filter(r => {
    const isViolation = String(r.Is_Violation || '').toLowerCase();
    if (isViolation === 'true' || isViolation === 'yes') return true;

    const status = String(r.Status || '').toLowerCase();
    const notes = String(r.Negative_Notes || '').toLowerCase();
    return status.includes('خلل') || notes.includes('نقاط الخلل') || notes.includes('❌');
  }).map(r => ({
    _rowIndex: r._rowIndex,
    Date: r.Date,
    Actual_Time: r.Actual_Time,
    Area: r.Area,
    Round_Name: r.TaskID,
    Responsible_Role: r.Responsible_Role,
    Execution_Responsible: r.Execution_Responsible,
    Status: r.Status,
    Negative_Notes: r.Negative_Notes,
    Is_Resolved: r.Closed_YN,
  }));

  const map = {};
  violations.forEach(v => {
    const key = `${v.Area}||${(v.Negative_Notes || '').substring(0,80)}`;
    if (!map[key]) {
      map[key] = {
        area: v.Area,
        issue: v.Negative_Notes,
        assignedTo: v.Responsible_Role,
        count: 0,
        dates: []
      };
    }
    map[key].count++;
    map[key].dates.push(v.Date);
  });

  const repeated = Object.values(map).filter(x => x.count >= 2);

  return {
    violations,
    repeated,
    resolved: violations.filter(v => String(v.Is_Resolved).toLowerCase() === 'yes'),
    total: violations.length,
    pending: violations.filter(v => String(v.Is_Resolved).toLowerCase() !== 'yes').length
  };
}

function getHistory(params) {
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
  
  let filtered = roundsLog;
  
  if (params.startDate) {
    filtered = filtered.filter(r => {
      const logDate = r.Date ? new Date(r.Date) : null;
      if (!logDate) return false;
      return logDate >= new Date(params.startDate);
    });
  }
  
  if (params.endDate) {
    filtered = filtered.filter(r => {
      const logDate = r.Date ? new Date(r.Date) : null;
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
    const dateA = new Date(a.Date + ' ' + (a.Actual_Time || ''));
    const dateB = new Date(b.Date + ' ' + (b.Actual_Time || ''));
    return dateB - dateA;
  });
  
  // Map to frontend expected format
  const entries = filtered.map(r => ({
    Date: r.Date,
    Time: r.Actual_Time,
    TaskID: r.TaskID,
    Area: r.Area,
    Staff: r.Responsible_Role,
    Exec_Responsible: r.Execution_Responsible,
    Status: r.Status,
    Negative_Notes: r.Negative_Notes,
    Positive_Notes: r.Positive_Notes,
    Is_Violation: r.Is_Violation,
    Closed_YN: r.Closed_YN
  }));
  
  return { entries };
}

function getMetrics(days) {
  const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  const filtered = roundsLog.filter(r => {
    const logDate = r.Date ? new Date(r.Date) : null;
    return logDate && logDate >= cutoff;
  });
  
  const total = filtered.length;
  const completed = filtered.filter(r => r.Status === 'تم' || r.Status === 'مكتمل' || r.Status === 'OK').length;
  const violations = filtered.filter(r => {
    const isViol = String(r.Is_Violation || '').toLowerCase();
    if (isViol === 'true' || isViol === 'yes') return true;
    const status = String(r.Status || '').toLowerCase();
    const notes = String(r.Negative_Notes || '').toLowerCase();
    return status.includes('خلل') || notes.includes('نقاط الخلل');
  }).length;
  
  const byDate = {};
  const byStaff = {};
  const byArea = {};
  const byStatus = {};
  
  filtered.forEach(r => {
    const dateKey = r.Date ? new Date(r.Date).toISOString().split('T')[0] : 'unknown';
    byDate[dateKey] = (byDate[dateKey] || 0) + 1;
    
    const staff = r.Responsible_Role || r.Execution_Responsible || 'غير محدد';
    byStaff[staff] = (byStaff[staff] || 0) + 1;
    
    const area = r.Area || r.TaskID || 'غير محدد';
    byArea[area] = (byArea[area] || 0) + 1;
    
    const status = r.Status || 'غير محدد';
    byStatus[status] = (byStatus[status] || 0) + 1;
  });
  
  return {
    total: total,
    completed: completed,
    violations: violations,
    delayed: total - completed,
    compliance: total > 0 ? Math.round((completed / total) * 100) : 0,
    byDate: byDate,
    byStaff: byStaff,
    byArea: byArea,
    byStatus: byStatus
  };
}

function getChecklist(taskId) {
  const sheet = getSheet(taskId);
  
  // إذا ما فيه شيت، نرجع بنود افتراضية للاختبار
  if (!sheet) {
    const defaultItems = [
      { id: 1, text: 'التأكد من نظافة المنطقة', category: 'نظافة' },
      { id: 2, text: 'فحص معدات السلامة', category: 'سلامة' },
      { id: 3, text: 'التأكد من التهوية المناسبة', category: 'بيئة' },
      { id: 4, text: 'فحص الإضاءة', category: 'بيئة' },
      { id: 5, text: 'التأكد من توفر مستلزمات النظافة', category: 'نظافة' }
    ];
    return { items: defaultItems, isDefault: true };
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    const defaultItems = [
      { id: 1, text: 'التأكد من نظافة المنطقة', category: 'نظافة' },
      { id: 2, text: 'فحص معدات السلامة', category: 'سلامة' },
      { id: 3, text: 'التأكد من التهوية المناسبة', category: 'بيئة' }
    ];
    return { items: defaultItems, isDefault: true };
  }
  
  const items = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      items.push({
        id: i,
        text: data[i][0],
        category: data[i][1] || ''
      });
    }
  }
  
  return { items: items, isDefault: false };
}

function verifyPasscode(staffName, passcode) {
  const passcodes = sheetToObjects(getSheet('Staff_Passcodes'));
  
  const staff = passcodes.find(p => p.Staff_Name === staffName || p.Name === staffName);
  
  if (!staff) {
    return { valid: false, error: 'الموظف غير موجود' };
  }
  
  if (String(staff.Passcode) === String(passcode) || String(staff.Code) === String(passcode)) {
    return { valid: true };
  }
  
  return { valid: false, error: 'رمز التحقق غير صحيح' };
}

function resolveViolation(params) {
  const sheet = getSheet('Rounds_Log');
  if (!sheet) return { success: false, error: 'Sheet not found' };
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const rowIndex = params.rowIndex;
  if (!rowIndex || rowIndex < 2) return { success: false, error: 'Invalid row' };
  
  // Use correct column names from Sheet
  const closedYNCol = headers.indexOf('Closed_YN');
  const closedDateCol = headers.indexOf('Closed_Date');
  const resolvedByCol = headers.indexOf('Resolved_By');
  
  if (closedYNCol === -1) return { success: false, error: 'Closed_YN column not found' };
  
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  sheet.getRange(rowIndex, closedYNCol + 1).setValue('Yes');
  
  if (closedDateCol !== -1) {
    sheet.getRange(rowIndex, closedDateCol + 1).setValue(dateStr);
  }
  
  if (resolvedByCol !== -1) {
    sheet.getRange(rowIndex, resolvedByCol + 1).setValue(params.resolvedBy || '');
  }
  
  return { success: true };
}

function logRound(payload) {
  const sheet = getSheet('Rounds_Log');
  if (!sheet) return { success: false, error: 'Rounds_Log sheet not found' };
  
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const row = headers.map(h => {
    switch(h) {
      case 'Date': return dateStr;
      case 'Actual_Time': return timeStr;
      case 'TaskID': return payload.taskId || '';
      case 'Area': return payload.area || '';
      case 'Responsible_Role': return payload.staff || '';
      case 'Execution_Responsible': return payload.execResponsible || '';
      case 'Status': return payload.status || 'تم';
      case 'Positive_Notes': return payload.positiveNotes || '';
      case 'Negative_Notes': return payload.negativeNotes || payload.notes || '';
      case 'Is_Violation': return payload.isViolation ? 'TRUE' : 'FALSE';
      case 'Closed_YN': return 'No';
      default: return '';
    }
  });
  
  sheet.appendRow(row);
  
  return { success: true };
}
