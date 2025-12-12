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
      // Update done count for the specific round
      const round = staffMap[staff].topRounds.find(r => r.taskId === taskId);
      if (round) round.done++;
    }
  });
  
  Object.values(staffMap).forEach(s => {
    s.todayRemaining = Math.max(0, s.todayTasks - s.todayDone);
  });
  
  // تحقق إذا اليوم إجازة (لا توجد مهام مجدولة)
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
  
  // Map to frontend expected format with formatted date/time
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

  // استخراج جميع المخالفات مع معلوماتها
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
    
    // استخراج البنود الفاشلة كـ Set للمقارنة
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

  // فصل المخالفات: مفتوحة vs معالجة
  const openViolations = allViolations.filter(v => v.Is_Resolved !== 'yes');
  const resolvedViolations = allViolations.filter(v => v.Is_Resolved === 'yes');

  // حساب التكرار الذكي: نفس المنطقة + نفس البند الفاشل = تكرار
  // المفتاح: Area فقط - ونبحث عن تشابه في البنود
  const repeatGroups = {};
  
  openViolations.forEach(v => {
    const area = v.Area || v.Round_Name || 'غير محدد';
    
    // البحث عن مجموعة موجودة بنفس المنطقة وأي تشابه في البنود
    let foundGroup = null;
    
    // نبحث في كل المجموعات الموجودة بنفس المنطقة
    for (const key in repeatGroups) {
      if (key.startsWith(area + '||')) {
        const existingItems = repeatGroups[key].allFailedItems;
        const overlap = v.failedItems.filter(item => existingItems.includes(item));
        
        // أي تشابه = تكرار (حتى لو بند واحد)
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
      // دمج البنود الفاشلة
      v.failedItems.forEach(item => {
        if (!foundGroup.allFailedItems.includes(item)) {
          foundGroup.allFailedItems.push(item);
        }
      });
      foundGroup.issue = v.Negative_Notes || foundGroup.issue;
      // تحديث المكلف بآخر مخالفة
      foundGroup.assignedTo = v.Execution_Responsible || foundGroup.assignedTo;
    } else {
      // مجموعة جديدة بمفتاح المنطقة + timestamp للتفريق
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

  // المخالفات المتكررة = count >= 2 (نفس المنطقة + نفس البند مكرر)
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

// دالة مساعدة لاستخراج البنود الفاشلة من النص
function extractFailedItems(notes) {
  if (!notes) return [];
  
  const items = String(notes)
    .split(/[|\n]/)
    .map(s => s.replace(/❌/g, '').replace(/نقاط الخلل[:\s]*/g, '').trim())
    .filter(s => s && s.length > 5);
  
  // تطبيع النص (إزالة التشكيل والأحرف الخاصة)
  return items.map(item => 
    item.replace(/[\u064B-\u065F]/g, '') // إزالة التشكيل
        .replace(/[^\u0621-\u064Aa-zA-Z0-9\s]/g, '') // إبقاء الحروف فقط
        .trim()
        .substring(0, 40) // أول 40 حرف للمقارنة
  );
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
  
  // Map to frontend expected format - تضمين حقول المعالجة
  const entries = filtered.map(r => ({
    Date: formatDate(r.Date),
    Actual_Time: formatTime(r.Actual_Time),
    Time: formatTime(r.Actual_Time),
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
  
  // تصنيف الحالات بشكل صحيح
  const COMPLETED_STATUS = ['تم', 'مكتمل', 'مكتملة', 'OK', 'في الوقت', 'done', 'complete'];
  const DELAYED_STATUS = ['متأخر', 'متأخرة', 'تأخر', 'delayed', 'late'];
  const VIOLATION_STATUS = ['خلل', 'مخالفة', 'violation'];
  
  let completed = 0;
  let delayed = 0;
  let violations = 0;
  
  filtered.forEach(r => {
    const status = String(r.Status || '').toLowerCase().trim();
    const notes = String(r.Negative_Notes || '').toLowerCase();
    const isViol = String(r.Is_Violation || '').toLowerCase();
    
    // تحقق من المخالفات أولاً
    const isViolation = isViol === 'true' || isViol === 'yes' || 
        VIOLATION_STATUS.some(s => status.includes(s.toLowerCase())) ||
        notes.includes('نقاط الخلل') || notes.includes('❌');
    
    if (isViolation) {
      violations++;
      // المخالفات لا تُحسب كمكتملة
    } else if (COMPLETED_STATUS.some(s => status.includes(s.toLowerCase()))) {
      completed++;
    } else if (DELAYED_STATUS.some(s => status.includes(s.toLowerCase()))) {
      delayed++;
    } else {
      // جولة مسجلة بدون حالة واضحة = مكتملة
      completed++;
    }
  });
  
  const byDate = {};
  const byStaff = {};
  const byArea = {};
  const byStatus = {};
  
  filtered.forEach(r => {
    const dateKey = r.Date ? new Date(r.Date).toISOString().split('T')[0] : 'unknown';
    const status = String(r.Status || '').toLowerCase().trim();
    const notes = String(r.Negative_Notes || '').toLowerCase();
    const isViol = String(r.Is_Violation || '').toLowerCase();
    
    // تحديد التصنيف
    const isViolation = isViol === 'true' || isViol === 'yes' || 
        VIOLATION_STATUS.some(s => status.includes(s.toLowerCase())) ||
        notes.includes('نقاط الخلل') || notes.includes('❌');
    const isCompleted = !isViolation && COMPLETED_STATUS.some(s => status.includes(s.toLowerCase()));
    const isDelayed = !isViolation && DELAYED_STATUS.some(s => status.includes(s.toLowerCase()));
    
    // تجميع حسب التاريخ مع التفصيل
    if (!byDate[dateKey]) byDate[dateKey] = { total: 0, completed: 0, delayed: 0, violations: 0 };
    byDate[dateKey].total++;
    if (isViolation) byDate[dateKey].violations++;
    else if (isCompleted) byDate[dateKey].completed++;
    else if (isDelayed) byDate[dateKey].delayed++;
    else byDate[dateKey].completed++;
    
    // تجميع حسب الموظف مع التفصيل
    const staff = r.Responsible_Role || r.Execution_Responsible || 'غير محدد';
    if (!byStaff[staff]) byStaff[staff] = { total: 0, completed: 0, delayed: 0, violations: 0 };
    byStaff[staff].total++;
    if (isViolation) byStaff[staff].violations++;
    else if (isCompleted) byStaff[staff].completed++;
    else if (isDelayed) byStaff[staff].delayed++;
    else byStaff[staff].completed++;
    
    // تجميع حسب المنطقة مع التفصيل
    const area = r.Area || r.Round_Name || r.TaskID || 'غير محدد';
    if (!byArea[area]) byArea[area] = { total: 0, completed: 0, delayed: 0, violations: 0 };
    byArea[area].total++;
    if (isViolation) byArea[area].violations++;
    else if (isCompleted) byArea[area].completed++;
    else if (isDelayed) byArea[area].delayed++;
    else byArea[area].completed++;
    
    // تجميع حسب الحالة
    const statusKey = r.Status || 'غير محدد';
    byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;
  });
  
  return {
    total: total,
    completed: completed,
    violations: violations,
    delayed: delayed,
    compliance: total > 0 ? Math.round((completed / total) * 100) : 0,
    byDate: byDate,
    byStaff: byStaff,
    byArea: byArea,
    byStatus: byStatus
  };
}

function getChecklist(taskId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const id = String(taskId || '').trim();
  const pad = id.padStart(2, '0');
  const prefix = `R${pad}_`; // R01_, R02_ ...

  // دور على أي شيت اسمه يبدأ بـ R01_ مثلا
  const sheet = ss.getSheets().find(sh => sh.getName().startsWith(prefix));

  if (!sheet) {
    return { items: [], error: 'Checklist sheet not found for TaskID=' + id + ' (expected prefix ' + prefix + ')' };
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { items: [] };

  // هيكل الشيت الصحيح:
  // A: TaskID, B: Round_Name_AR, C: Item_No, D: Item_Description_AR (البند الحقيقي)
  const items = [];
  for (let i = 1; i < data.length; i++) {
    // العمود D (index 3) = Item_Description_AR = البند الفعلي
    const desc = data[i][3];
    if (desc && String(desc).trim()) {
      items.push({
        id: i,
        text: String(desc).trim(),
        item: String(desc).trim()
      });
    }
  }
  
  // جلب المسؤولين من MASTER_TASKS للمهمة المحددة
  const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
  const task = masterTasks.find(t => String(t.TaskID) === id);
  
  const responsibles = [];
  if (task) {
    for (let i = 1; i <= 5; i++) {
      const resp = task[`Responsible_${i}`];
      if (resp && String(resp).trim()) {
        responsibles.push(String(resp).trim());
      }
    }
  }

  return { items: items, sheetName: sheet.getName(), responsibles: responsibles };
}

function verifyPasscode(staffName, passcode) {
  const passcodes = sheetToObjects(getSheet('Staff_Passcodes'));
  
  // البحث عن أي موظف لديه هذا الرمز السري
  const staffByPasscode = passcodes.find(p => 
    String(p.Passcode) === String(passcode) || String(p.Code) === String(passcode)
  );
  
  if (staffByPasscode) {
    // الرمز صحيح - نرجع اسم الموظف صاحب الرمز
    return { 
      valid: true, 
      staffName: staffByPasscode.Staff_Name || staffByPasscode.Name || staffName 
    };
  }
  
  return { valid: false, error: 'الرمز السري غير صحيح' };
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
      case 'Actual_Time': return payload.time || timeStr;
      case 'Planned_Time': return payload.plannedTime || '';
      case 'TaskID': return payload.taskId || '';
      case 'RoundNo': return payload.roundNo || '';
      case 'Round_Name': return payload.roundName || payload.area || '';
      case 'Area': return payload.area || payload.roundName || '';
      case 'Domain': return payload.domain || '';
      case 'Responsible_Role': return payload.staff || '';
      case 'Execution_Responsible': return payload.execResponsible || '';
      case 'Status': return payload.status || 'تم';
      case 'Positive_Notes': return payload.positiveNotes || '';
      case 'Negative_Notes': return payload.negativeNotes || payload.notes || '';
      case 'Is_Violation': return payload.isViolation ? 'TRUE' : 'FALSE';
      case 'Closed_YN': return 'No';
      case 'Alert': return '';
      case 'Delay_Min': return '';
      case 'MaxDelay_Min': return '';
      default: return '';
    }
  });
  
  sheet.appendRow(row);
  
  return { success: true };
}
