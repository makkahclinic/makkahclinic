/***********************************************************
 * نظام أرشفة الطوابير - مجمع مكة الطبي بالزاهر
 * Patient Queue Archival System
 * Google Apps Script Backend
 *
 * الشيت: 3 أوراق:
 *   1) QueueLog     - سجل كل المرضى اليومي
 *   2) Doctors      - قائمة الأطباء والعيادات
 *   3) DailyStats   - إحصائيات يومية تلقائية
 ***********************************************************/

const Q_CONFIG = {
  SHEETS: {
    LOG: 'QueueLog',
    DOCTORS: 'Doctors',
    STATS: 'DailyStats',
    CLINICS: 'Clinics'
  },
  TIMEZONE: 'Asia/Riyadh'
};

const LOG_HEADERS = [
  'date', 'ticketNum', 'patientName', 'patientPhone',
  'doctorName', 'clinic', 'status',
  'addedAt', 'calledAt', 'completedAt',
  'waitMinutes', 'addedBy'
];

const DOCTORS_HEADERS = [
  'doctorName', 'clinic', 'active', 'addedAt', 'updatedAt'
];

const STATS_HEADERS = [
  'date', 'totalPatients', 'completedPatients', 'cancelledPatients',
  'avgWaitMinutes', 'maxWaitMinutes', 'activeDoctors', 'topDoctor', 'topDoctorCount'
];

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'getAll';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);

    switch (action) {
      case 'getAll':
        return respondOk_(getAllData_(ss, e.parameter));
      case 'getStats':
        return respondOk_(getStats_(ss, e.parameter));
      case 'getDoctors':
        return respondOk_(getDoctors_(ss));
      case 'getClinics':
        return respondOk_(getClinics_(ss));
      case 'getLog':
        return respondOk_(getLog_(ss, e.parameter));
      default:
        return respondErr_('Unknown action: ' + action);
    }
  } catch (err) {
    return respondErr_(err);
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Empty POST body');
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);

    switch (action) {
      case 'logPatient':
        return respondOk_(logPatient_(ss, body.data));
      case 'updateStatus':
        return respondOk_(updateStatus_(ss, body.data));
      case 'logBatch':
        return respondOk_(logBatch_(ss, body.patients));
      case 'saveDoctors':
        return respondOk_(saveDoctors_(ss, body.doctors));
      case 'calcDailyStats':
        return respondOk_(calcDailyStats_(ss, body.date));
      default:
        return respondErr_('Unknown action: ' + action);
    }
  } catch (err) {
    return respondErr_(err);
  }
}

function ensureSheets_(ss) {
  ensureSheet_(ss, Q_CONFIG.SHEETS.LOG, LOG_HEADERS);
  ensureSheet_(ss, Q_CONFIG.SHEETS.DOCTORS, DOCTORS_HEADERS);
  ensureSheet_(ss, Q_CONFIG.SHEETS.STATS, STATS_HEADERS);
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1e3a5f')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else {
    const existing = sh.getRange(1, 1, 1, sh.getLastColumn() || 1).getValues()[0];
    if (existing.join(',') !== headers.join(',')) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#1e3a5f')
        .setFontColor('#ffffff');
    }
  }
  return sh;
}

function logPatient_(ss, data) {
  const sh = ss.getSheetByName(Q_CONFIG.SHEETS.LOG);
  const now = Utilities.formatDate(new Date(), Q_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  const today = Utilities.formatDate(new Date(), Q_CONFIG.TIMEZONE, 'yyyy-MM-dd');

  const row = [
    today,
    data.ticketNum || '',
    data.patientName || '',
    data.patientPhone || '',
    data.doctorName || '',
    data.clinic || '',
    data.status || 'waiting',
    now,
    '',
    '',
    '',
    data.addedBy || ''
  ];

  sh.appendRow(row);
  return { message: 'تم تسجيل المريض', date: today, ticketNum: data.ticketNum };
}

function updateStatus_(ss, data) {
  const sh = ss.getSheetByName(Q_CONFIG.SHEETS.LOG);
  const allData = sh.getDataRange().getValues();
  const headers = allData[0];
  const dateCol = headers.indexOf('date');
  const ticketCol = headers.indexOf('ticketNum');
  const statusCol = headers.indexOf('status');
  const calledCol = headers.indexOf('calledAt');
  const completedCol = headers.indexOf('completedAt');
  const waitCol = headers.indexOf('waitMinutes');
  const addedAtCol = headers.indexOf('addedAt');
  const now = Utilities.formatDate(new Date(), Q_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  const today = Utilities.formatDate(new Date(), Q_CONFIG.TIMEZONE, 'yyyy-MM-dd');

  for (let i = allData.length - 1; i >= 1; i--) {
    const rowDate = String(allData[i][dateCol]).substring(0, 10);
    if (rowDate === today && String(allData[i][ticketCol]) === String(data.ticketNum)) {
      const rowNum = i + 1;
      sh.getRange(rowNum, statusCol + 1).setValue(data.status);

      if (data.status === 'called') {
        sh.getRange(rowNum, calledCol + 1).setValue(now);
      } else if (data.status === 'completed' || data.status === 'cancelled') {
        sh.getRange(rowNum, completedCol + 1).setValue(now);
        const addedAt = allData[i][addedAtCol];
        if (addedAt) {
          const addedTime = new Date(addedAt);
          const nowTime = new Date();
          const waitMin = Math.round((nowTime - addedTime) / 60000);
          sh.getRange(rowNum, waitCol + 1).setValue(waitMin);
        }
      }

      return { message: 'تم تحديث حالة المريض', status: data.status };
    }
  }

  return { message: 'لم يتم العثور على المريض' };
}

function logBatch_(ss, patients) {
  if (!patients || !patients.length) return { message: 'لا يوجد بيانات', count: 0 };

  const sh = ss.getSheetByName(Q_CONFIG.SHEETS.LOG);
  const today = Utilities.formatDate(new Date(), Q_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const now = Utilities.formatDate(new Date(), Q_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  let count = 0;

  const existingData = sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [LOG_HEADERS];
  const headers = existingData[0];
  const dateCol = headers.indexOf('date');
  const ticketCol = headers.indexOf('ticketNum');
  const existingTickets = new Set();
  for (let i = 1; i < existingData.length; i++) {
    if (String(existingData[i][dateCol]).substring(0, 10) === today) {
      existingTickets.add(String(existingData[i][ticketCol]));
    }
  }

  const rows = [];
  patients.forEach(p => {
    const ticket = String(p.ticketNum || p.ticket || '');
    if (ticket && !existingTickets.has(ticket)) {
      rows.push([
        today,
        ticket,
        p.patientName || p.name || '',
        p.patientPhone || p.phone || '',
        p.doctorName || p.doctor || '',
        p.clinic || '',
        p.status || 'waiting',
        p.addedAt || now,
        p.calledAt || '',
        p.completedAt || '',
        '',
        p.addedBy || ''
      ]);
      count++;
    }
  });

  if (rows.length > 0) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  return { message: 'تم أرشفة ' + count + ' مريض', count };
}

function saveDoctors_(ss, doctors) {
  const sh = ss.getSheetByName(Q_CONFIG.SHEETS.DOCTORS);
  const now = Utilities.formatDate(new Date(), Q_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, DOCTORS_HEADERS.length).clearContent();
  }

  const rows = doctors.map(d => [
    d.name || d.doctorName || '',
    d.clinic || '',
    d.active !== false ? 'Y' : 'N',
    now,
    now
  ]);

  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }

  return { message: 'تم حفظ ' + rows.length + ' طبيب', count: rows.length };
}

function calcDailyStats_(ss, dateStr) {
  const today = dateStr || Utilities.formatDate(new Date(), Q_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const logSh = ss.getSheetByName(Q_CONFIG.SHEETS.LOG);

  if (logSh.getLastRow() < 2) return { message: 'لا يوجد بيانات' };

  const allData = logSh.getDataRange().getValues();
  const headers = allData[0];
  const dateCol = headers.indexOf('date');
  const statusCol = headers.indexOf('status');
  const waitCol = headers.indexOf('waitMinutes');
  const doctorCol = headers.indexOf('doctorName');

  const dayRows = [];
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][dateCol]).substring(0, 10) === today) {
      dayRows.push(allData[i]);
    }
  }

  if (!dayRows.length) return { message: 'لا يوجد بيانات لهذا اليوم', date: today };

  const total = dayRows.length;
  const completed = dayRows.filter(r => r[statusCol] === 'completed').length;
  const cancelled = dayRows.filter(r => r[statusCol] === 'cancelled').length;

  const waitTimes = dayRows
    .map(r => Number(r[waitCol]))
    .filter(w => w > 0);
  const avgWait = waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0;
  const maxWait = waitTimes.length ? Math.max(...waitTimes) : 0;

  const doctorCounts = {};
  dayRows.forEach(r => {
    const doc = r[doctorCol];
    if (doc) doctorCounts[doc] = (doctorCounts[doc] || 0) + 1;
  });
  const activeDoctors = Object.keys(doctorCounts).length;
  let topDoctor = '';
  let topCount = 0;
  Object.entries(doctorCounts).forEach(([doc, cnt]) => {
    if (cnt > topCount) { topDoctor = doc; topCount = cnt; }
  });

  const statsSh = ss.getSheetByName(Q_CONFIG.SHEETS.STATS);
  const statsData = statsSh.getLastRow() > 1 ? statsSh.getDataRange().getValues() : [STATS_HEADERS];
  const statsDateCol = statsData[0].indexOf('date');
  let existingRow = -1;
  for (let i = 1; i < statsData.length; i++) {
    if (String(statsData[i][statsDateCol]).substring(0, 10) === today) {
      existingRow = i + 1;
      break;
    }
  }

  const statsRow = [today, total, completed, cancelled, avgWait, maxWait, activeDoctors, topDoctor, topCount];

  if (existingRow > 0) {
    statsSh.getRange(existingRow, 1, 1, statsRow.length).setValues([statsRow]);
  } else {
    statsSh.appendRow(statsRow);
  }

  return {
    date: today, total, completed, cancelled,
    avgWait, maxWait, activeDoctors, topDoctor, topCount
  };
}

function getAllData_(ss, params) {
  const doctors = getDoctors_(ss);
  const stats = getStats_(ss, params);
  return { doctors, stats };
}

function getClinics_(ss) {
  const sh = ss.getSheetByName(Q_CONFIG.SHEETS.CLINICS);
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();
    const code = String(data[i][1] || '').trim();
    if (name) {
      result.push({ name, code, clinic: code ? 'عيادة ' + code : '' });
    }
  }
  return result;
}

function getDoctors_(ss) {
  const sh = ss.getSheetByName(Q_CONFIG.SHEETS.DOCTORS);
  if (sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = data[i][idx]; });
    result.push(obj);
  }
  return result;
}

function getStats_(ss, params) {
  const sh = ss.getSheetByName(Q_CONFIG.SHEETS.STATS);
  if (sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = data[i][idx]; });
    result.push(obj);
  }
  if (params && params.days) {
    const limit = parseInt(params.days);
    return result.slice(-limit);
  }
  return result;
}

function getLog_(ss, params) {
  const sh = ss.getSheetByName(Q_CONFIG.SHEETS.LOG);
  if (sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const dateCol = headers.indexOf('date');
  const filterDate = params && params.date ? params.date :
    Utilities.formatDate(new Date(), Q_CONFIG.TIMEZONE, 'yyyy-MM-dd');

  const result = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][dateCol]).substring(0, 10) === filterDate) {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = data[i][idx]; });
      result.push(obj);
    }
  }
  return result;
}

function respondOk_(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function respondErr_(err) {
  const msg = typeof err === 'string' ? err : (err.message || String(err));
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
