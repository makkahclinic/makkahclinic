/**
 * ===========================================
 * نظام متابعة التعرض المهني (الوخز الإبري)
 * Backend - Google Apps Script
 * مجمع مكة الطبي بالزاهر
 * ===========================================
 * 
 * بروتوكول CDC 2025 لـ PEP
 * 
 * الأعمدة المطلوبة في Google Sheet:
 * ----------------------------------
 * - تاريخ الحادث
 * - وقت الحادث  
 * - القسم / الوحدة
 * - المهنة
 * - نوع التعرض (needle/blood/mucosal)
 * - الأداة المستخدمة
 * - عمق الجرح (سطحي/متوسط/عميق)
 * - سنوات الخبرة
 * - حالة تطعيم HBV
 * - هل كانت ملوثة؟ (نعم/لا/غير معروف)
 * - تم غسل المنطقة (نعم/لا)
 * - تم الإبلاغ (نعم/لا)
 * - تم التقييم الطبي (نعم/لا)
 * - PEP / تم البدء بالعلاج الوقائي (نعم/لا)
 * - حالة المتابعة (pending/active/completed)
 * - ملاحظات
 * - سجل المتابعة (JSON)
 * - تاريخ آخر متابعة
 * - الفحوصات المطلوبة
 * - نتائج الفحوصات
 */

// ===== الإعدادات =====
const SHEET_ID = 'YOUR_SHEET_ID_HERE'; // ضع معرف الشيت هنا
const SHEET_NAME = 'بلاغات الوخز';
const FOLLOWUP_SHEET_NAME = 'سجل المتابعة';

// ===== المعالج الرئيسي =====
function doGet(e) {
  const action = e.parameter.action || 'data';
  const callback = e.parameter.callback;
  
  let result;
  
  try {
    switch(action) {
      case 'data':
        result = getAllData();
        break;
      case 'case':
        result = getCaseDetails(e.parameter.id);
        break;
      case 'followups':
        result = getPendingFollowups();
        break;
      case 'stats':
        result = getStatistics();
        break;
      default:
        result = { status: 'error', message: 'Unknown action' };
    }
  } catch (error) {
    result = { status: 'error', message: error.toString() };
  }
  
  const jsonOutput = JSON.stringify(result);
  
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + jsonOutput + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  
  return ContentService.createTextOutput(jsonOutput)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const callback = e.parameter.callback;
  let result;
  
  try {
    const action = e.parameter.action;
    
    switch(action) {
      case 'report':
        result = submitReport(e.parameter);
        break;
      case 'addNote':
        result = addNote(e.parameter);
        break;
      case 'addFollowup':
        result = addFollowup(e.parameter);
        break;
      case 'updateStatus':
        result = updateCaseStatus(e.parameter);
        break;
      default:
        result = { status: 'error', message: 'Unknown action' };
    }
  } catch (error) {
    result = { status: 'error', message: error.toString() };
  }
  
  const jsonOutput = JSON.stringify(result);
  
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + jsonOutput + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  
  return ContentService.createTextOutput(jsonOutput)
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== جلب جميع البيانات =====
function getAllData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    return { status: 'error', message: 'Sheet not found' };
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return { status: 'success', rows: [] };
  }
  
  const headers = data[0];
  const rows = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    row._rowNum = i + 1;
    rows.push(row);
  }
  
  return { status: 'success', rows: rows };
}

// ===== جلب تفاصيل حالة =====
function getCaseDetails(id) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rowNum = parseInt(id);
  
  if (rowNum < 2 || rowNum > data.length) {
    return { status: 'error', message: 'Case not found' };
  }
  
  const row = {};
  for (let j = 0; j < headers.length; j++) {
    row[headers[j]] = data[rowNum - 1][j];
  }
  
  // جلب سجل المتابعة
  row.followupHistory = getFollowupHistory(rowNum);
  
  // حساب توصيات PEP
  row.pepRecommendation = calculatePEPRecommendation(row);
  
  // حساب الفحوصات المطلوبة
  row.requiredTests = calculateRequiredTests(row);
  
  return { status: 'success', case: row };
}

// ===== جلب الحالات المعلقة =====
function getPendingFollowups() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const statusCol = headers.indexOf('حالة المتابعة');
  const dateCol = headers.indexOf('تاريخ الحادث');
  
  const pending = [];
  const today = new Date();
  
  for (let i = 1; i < data.length; i++) {
    const status = data[i][statusCol] || 'pending';
    if (status === 'pending' || status === 'active') {
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = data[i][j];
      }
      row._rowNum = i + 1;
      
      // حساب الأيام منذ الحادث
      const incidentDate = new Date(data[i][dateCol]);
      row.daysSinceIncident = Math.floor((today - incidentDate) / (1000 * 60 * 60 * 24));
      row.nextAction = getNextFollowupAction(row.daysSinceIncident);
      row.urgency = calculateUrgency(row);
      
      pending.push(row);
    }
  }
  
  // ترتيب حسب الأولوية
  pending.sort((a, b) => b.urgency - a.urgency);
  
  return { status: 'success', cases: pending };
}

// ===== إحصائيات =====
function getStatistics() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const stats = {
    total: data.length - 1,
    byType: { needle: 0, blood: 0, mucosal: 0 },
    byRisk: { high: 0, medium: 0, low: 0 },
    byStatus: { pending: 0, active: 0, completed: 0 },
    pepStarted: 0,
    immediateWash: 0,
    immediateReport: 0,
    medicalEval: 0,
    thisMonth: 0,
    lastMonth: 0,
    byDepartment: {},
    monthlyTrend: {}
  };
  
  const today = new Date();
  const thisMonth = today.getMonth();
  const thisYear = today.getFullYear();
  
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    
    // نوع التعرض
    const type = (row['نوع التعرض'] || '').toLowerCase();
    if (type.includes('needle') || type.includes('وخز')) stats.byType.needle++;
    else if (type.includes('blood') || type.includes('دم')) stats.byType.blood++;
    else if (type.includes('mucos') || type.includes('مخاط')) stats.byType.mucosal++;
    else stats.byType.needle++;
    
    // الخطورة
    const contaminated = row['هل كانت ملوثة؟'] || '';
    if (contaminated === 'نعم') stats.byRisk.high++;
    else if (contaminated === 'لا') stats.byRisk.low++;
    else stats.byRisk.medium++;
    
    // الحالة
    const status = row['حالة المتابعة'] || 'pending';
    if (stats.byStatus.hasOwnProperty(status)) stats.byStatus[status]++;
    else stats.byStatus.pending++;
    
    // المؤشرات
    if ((row['PEP'] || row['تم البدء بالعلاج الوقائي'] || '').includes('نعم')) stats.pepStarted++;
    if ((row['تم غسل المنطقة'] || '').includes('نعم')) stats.immediateWash++;
    if ((row['تم الإبلاغ'] || '').includes('نعم')) stats.immediateReport++;
    if ((row['تم التقييم الطبي'] || '').includes('نعم')) stats.medicalEval++;
    
    // القسم
    const dept = row['القسم / الوحدة'] || row['القسم'] || 'غير محدد';
    stats.byDepartment[dept] = (stats.byDepartment[dept] || 0) + 1;
    
    // الشهر
    const dateStr = row['تاريخ الحادث'] || row['التاريخ'] || '';
    if (dateStr) {
      const parts = dateStr.toString().split(/[-/]/);
      if (parts.length >= 2) {
        const year = parseInt(parts[0]) || thisYear;
        const month = parseInt(parts[1]) - 1;
        
        if (year === thisYear && month === thisMonth) stats.thisMonth++;
        if (year === thisYear && month === thisMonth - 1) stats.lastMonth++;
        
        const monthKey = `${year}-${(month + 1).toString().padStart(2, '0')}`;
        stats.monthlyTrend[monthKey] = (stats.monthlyTrend[monthKey] || 0) + 1;
      }
    }
  }
  
  // حساب النسب
  stats.rates = {
    pep: stats.total > 0 ? Math.round((stats.pepStarted / stats.total) * 100) : 0,
    wash: stats.total > 0 ? Math.round((stats.immediateWash / stats.total) * 100) : 0,
    report: stats.total > 0 ? Math.round((stats.immediateReport / stats.total) * 100) : 0,
    eval: stats.total > 0 ? Math.round((stats.medicalEval / stats.total) * 100) : 0
  };
  
  return { status: 'success', stats: stats };
}

// ===== تسجيل بلاغ جديد =====
function submitReport(params) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const newRow = [];
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    newRow.push(params[header] || '');
  }
  
  // إضافة حالة المتابعة الافتراضية
  const statusCol = headers.indexOf('حالة المتابعة');
  if (statusCol >= 0 && !newRow[statusCol]) {
    newRow[statusCol] = 'pending';
  }
  
  sheet.appendRow(newRow);
  
  // حساب توصيات PEP وإرسال تنبيه إذا لزم
  const contaminated = params['هل كانت ملوثة؟'] || '';
  if (contaminated === 'نعم') {
    sendHighRiskAlert(params);
  }
  
  return { 
    status: 'success', 
    message: 'تم تسجيل البلاغ بنجاح',
    caseId: sheet.getLastRow(),
    pepRecommended: contaminated === 'نعم'
  };
}

// ===== إضافة ملاحظة =====
function addNote(params) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  const rowNum = parseInt(params.caseId);
  const noteType = params.noteType || 'عام';
  const noteText = params.noteText || '';
  const noteDate = new Date().toISOString();
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const notesCol = headers.indexOf('ملاحظات');
  
  if (notesCol >= 0) {
    const currentNotes = sheet.getRange(rowNum, notesCol + 1).getValue() || '';
    const newNote = `[${noteDate}] (${noteType}): ${noteText}`;
    const updatedNotes = currentNotes ? currentNotes + '\n' + newNote : newNote;
    sheet.getRange(rowNum, notesCol + 1).setValue(updatedNotes);
  }
  
  return { status: 'success', message: 'تم إضافة الملاحظة' };
}

// ===== إضافة متابعة =====
function addFollowup(params) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  const rowNum = parseInt(params.caseId);
  const followupType = params.followupType || '';
  const testResult = params.testResult || '';
  const adherence = params.adherence || '';
  const notes = params.notes || '';
  const followupDate = new Date().toISOString();
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // تحديث سجل المتابعة
  const historyCol = headers.indexOf('سجل المتابعة');
  if (historyCol >= 0) {
    let history = [];
    try {
      const currentHistory = sheet.getRange(rowNum, historyCol + 1).getValue();
      if (currentHistory) history = JSON.parse(currentHistory);
    } catch(e) {}
    
    history.push({
      date: followupDate,
      type: followupType,
      result: testResult,
      adherence: adherence,
      notes: notes
    });
    
    sheet.getRange(rowNum, historyCol + 1).setValue(JSON.stringify(history));
  }
  
  // تحديث تاريخ آخر متابعة
  const lastFollowupCol = headers.indexOf('تاريخ آخر متابعة');
  if (lastFollowupCol >= 0) {
    sheet.getRange(rowNum, lastFollowupCol + 1).setValue(followupDate);
  }
  
  // تحديث الحالة إذا اكتملت المتابعة
  if (followupType === 'month6' && testResult === 'negative') {
    const statusCol = headers.indexOf('حالة المتابعة');
    if (statusCol >= 0) {
      sheet.getRange(rowNum, statusCol + 1).setValue('completed');
    }
  } else {
    const statusCol = headers.indexOf('حالة المتابعة');
    if (statusCol >= 0) {
      sheet.getRange(rowNum, statusCol + 1).setValue('active');
    }
  }
  
  return { status: 'success', message: 'تم تسجيل المتابعة بنجاح' };
}

// ===== تحديث حالة الحالة =====
function updateCaseStatus(params) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  const rowNum = parseInt(params.caseId);
  const newStatus = params.status;
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusCol = headers.indexOf('حالة المتابعة');
  
  if (statusCol >= 0) {
    sheet.getRange(rowNum, statusCol + 1).setValue(newStatus);
  }
  
  return { status: 'success', message: 'تم تحديث الحالة' };
}

// ===== الدوال المساعدة =====

function getFollowupHistory(rowNum) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const historyCol = headers.indexOf('سجل المتابعة');
  
  if (historyCol >= 0) {
    try {
      const history = sheet.getRange(rowNum, historyCol + 1).getValue();
      if (history) return JSON.parse(history);
    } catch(e) {}
  }
  
  return [];
}

function calculatePEPRecommendation(caseData) {
  const contaminated = caseData['هل كانت ملوثة؟'] || '';
  const woundDepth = caseData['عمق الجرح'] || '';
  const hbvStatus = caseData['حالة تطعيم HBV'] || '';
  
  const recommendation = {
    hiv: { needed: false, regimen: '', duration: '' },
    hbv: { needed: false, regimen: '' },
    hcv: { monitoring: true, treatment: false }
  };
  
  if (contaminated === 'نعم') {
    // توصية HIV PEP
    recommendation.hiv.needed = true;
    recommendation.hiv.regimen = 'Bictegravir/FTC/TAF (قرص واحد يومياً)';
    recommendation.hiv.duration = '28 يوم';
    recommendation.hiv.startWithin = 'خلال 72 ساعة (الأفضل خلال ساعتين)';
    
    // توصية HBV
    if (hbvStatus !== 'مكتمل') {
      recommendation.hbv.needed = true;
      recommendation.hbv.regimen = 'HBIG 0.06 mL/kg IM + لقاح HBV';
      recommendation.hbv.startWithin = 'خلال 7 أيام (الأفضل خلال 24 ساعة)';
    }
  }
  
  // HCV - مراقبة فقط، لا يوجد PEP
  recommendation.hcv.testSchedule = [
    { week: '4-6', test: 'HCV RNA' },
    { month: '4-6', test: 'HCV Ab + ALT' }
  ];
  
  return recommendation;
}

function calculateRequiredTests(caseData) {
  const dateStr = caseData['تاريخ الحادث'] || '';
  const today = new Date();
  let daysSince = 0;
  
  if (dateStr) {
    const parts = dateStr.toString().split(/[-/]/);
    if (parts.length >= 3) {
      const incidentDate = new Date(parts[0], parts[1] - 1, parts[2]);
      daysSince = Math.floor((today - incidentDate) / (1000 * 60 * 60 * 24));
    }
  }
  
  const tests = [];
  
  // اليوم 0
  if (daysSince === 0) {
    tests.push({
      timing: 'فوراً',
      tests: ['HIV Ag/Ab', 'HBsAg', 'HBsAb', 'HBcAb', 'HCV Ab', 'CBC', 'Creatinine', 'ALT/AST'],
      completed: false
    });
  }
  
  // الأسبوع 4-6
  if (daysSince >= 28 && daysSince < 42) {
    tests.push({
      timing: 'الأسبوع 4-6',
      tests: ['HIV Ag/Ab', 'HIV RNA (NAT)', 'HCV RNA'],
      completed: false
    });
  }
  
  // الأسبوع 12
  if (daysSince >= 84 && daysSince < 120) {
    tests.push({
      timing: 'الأسبوع 12 (نهائي HIV)',
      tests: ['HIV Ag/Ab', 'HIV RNA (NAT)'],
      completed: false
    });
  }
  
  // الشهر 4-6
  if (daysSince >= 120 && daysSince < 180) {
    tests.push({
      timing: 'الشهر 4-6 (نهائي HCV)',
      tests: ['HCV Ab', 'ALT'],
      completed: false
    });
  }
  
  return tests;
}

function getNextFollowupAction(daysSince) {
  if (daysSince < 3) return 'متابعة اليوم 3 - تقييم الأعراض الجانبية والالتزام';
  if (daysSince < 28) return 'مراقبة الالتزام بـ PEP (28 يوم)';
  if (daysSince < 42) return 'فحوصات الأسبوع 4-6: HIV Ag/Ab + HIV RNA + HCV RNA';
  if (daysSince < 84) return 'فحوصات الأسبوع 12: HIV Ag/Ab + HIV RNA (نهائي)';
  if (daysSince < 180) return 'فحوصات الشهر 4-6: HCV Ab + ALT (نهائي)';
  return 'اكتملت المتابعة - يمكن إغلاق الحالة';
}

function calculateUrgency(caseData) {
  let urgency = 0;
  
  // حالة ملوثة = أولوية عالية
  if (caseData['هل كانت ملوثة؟'] === 'نعم') urgency += 50;
  
  // عمق الجرح
  const depth = caseData['عمق الجرح'] || '';
  if (depth === 'عميق') urgency += 30;
  else if (depth === 'متوسط') urgency += 15;
  
  // الأيام منذ الحادث (أقل = أعلى أولوية)
  const days = caseData.daysSinceIncident || 0;
  if (days < 3) urgency += 40;
  else if (days < 7) urgency += 30;
  else if (days < 28) urgency += 20;
  
  // PEP لم يبدأ
  if (!(caseData['PEP'] || '').includes('نعم')) urgency += 25;
  
  return urgency;
}

function sendHighRiskAlert(caseData) {
  // يمكن إضافة إشعار بريد إلكتروني هنا
  // MailApp.sendEmail(...)
  Logger.log('High risk case reported: ' + JSON.stringify(caseData));
}

// ===== إنشاء جدول المتابعة التلقائي =====
function setupFollowupReminders() {
  // حذف المشغلات القديمة
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'checkPendingFollowups') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // إنشاء مشغل يومي
  ScriptApp.newTrigger('checkPendingFollowups')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
}

function checkPendingFollowups() {
  const result = getPendingFollowups();
  if (result.status === 'success' && result.cases.length > 0) {
    // إرسال تقرير بالحالات المعلقة
    Logger.log('Pending followups: ' + result.cases.length);
  }
}
