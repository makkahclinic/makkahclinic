/***********************************************************
 * نظام التحقق من النطاقات المرجعية - مجمع مكة الطبي بالزاهر
 * Laboratory Reference Range Verification System
 * Google Apps Script Backend
 *
 * الشيت: 3 أوراق رئيسية:
 *   1) Tests       - بيانات الاختبارات
 *   2) Samples     - بيانات الـ 20 عينة لكل اختبار
 *   3) Dashboard   - إحصائيات محدثة تلقائياً
 *
 * الأوراق تُنشأ تلقائياً مع الترويسات عند أول تشغيل
 ***********************************************************/

const LAB_CONFIG = {
  SHEETS: {
    TESTS: 'Tests',
    SAMPLES: 'Samples',
    DASHBOARD: 'Dashboard'
  },
  TIMEZONE: 'Asia/Riyadh',
  PASS_THRESHOLD: 18,
  TOTAL_SAMPLES: 20
};

const TESTS_HEADERS = [
  'testId', 'nameAr', 'nameEn', 'instrument', 'reagent', 'lot',
  'unit', 'refLow', 'refHigh', 'population', 'ageRange', 'department',
  'notes', 'status', 'sigPerformer', 'sigQuality', 'sigDirector',
  'createdAt', 'verifiedAt', 'withinCount', 'outCount', 'passRate'
];

const SAMPLES_HEADERS = [
  'testId', 'sampleIndex', 'sampleId', 'sex', 'age',
  'result', 'withinRange', 'remarks', 'updatedAt'
];

const DASHBOARD_HEADERS = [
  'metric', 'value', 'updatedAt'
];

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'getAll';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);

    switch (action) {
      case 'getAll':
        return respondSuccess(getAllData_(ss));
      case 'getTest':
        return respondSuccess(getTestWithSamples_(ss, e.parameter.testId));
      case 'getDashboard':
        return respondSuccess(getDashboardStats_(ss));
      default:
        return respondError('Unknown action: ' + action);
    }
  } catch (err) {
    return respondError(err);
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Empty POST body');
    }

    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);

    switch (action) {
      case 'addTest':
        return respondSuccess(addTest_(ss, body.data));
      case 'saveSamples':
        return respondSuccess(saveSamples_(ss, body.testId, body.samples));
      case 'updateSignatures':
        return respondSuccess(updateSignatures_(ss, body.testId, body.signatures));
      case 'finalizeTest':
        return respondSuccess(finalizeTest_(ss, body.testId));
      case 'deleteTest':
        return respondSuccess(deleteTest_(ss, body.testId));
      case 'importBulk':
        return respondSuccess(importBulkTests_(ss, body.tests));
      default:
        return respondError('Unknown action: ' + action);
    }
  } catch (err) {
    return respondError(err);
  }
}

function ensureSheets_(ss) {
  ensureSheet_(ss, LAB_CONFIG.SHEETS.TESTS, TESTS_HEADERS);
  ensureSheet_(ss, LAB_CONFIG.SHEETS.SAMPLES, SAMPLES_HEADERS);
  ensureSheet_(ss, LAB_CONFIG.SHEETS.DASHBOARD, DASHBOARD_HEADERS);
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

function getAllData_(ss) {
  const tests = getSheetData_(ss, LAB_CONFIG.SHEETS.TESTS);
  const samples = getSheetData_(ss, LAB_CONFIG.SHEETS.SAMPLES);

  const samplesByTest = {};
  samples.forEach(s => {
    if (!samplesByTest[s.testId]) samplesByTest[s.testId] = [];
    samplesByTest[s.testId].push(s);
  });

  const fullTests = tests.map(t => {
    const tSamples = samplesByTest[t.testId] || [];
    tSamples.sort((a, b) => Number(a.sampleIndex) - Number(b.sampleIndex));

    const samplesArr = [];
    for (let i = 0; i < LAB_CONFIG.TOTAL_SAMPLES; i++) {
      const found = tSamples.find(s => Number(s.sampleIndex) === i);
      samplesArr.push(found || {
        sampleId: '', sex: '', age: '', result: '', withinRange: '', remarks: ''
      });
    }

    return {
      id: t.testId,
      nameAr: t.nameAr,
      nameEn: t.nameEn,
      instrument: t.instrument,
      reagent: t.reagent,
      lot: t.lot,
      unit: t.unit,
      refLow: Number(t.refLow),
      refHigh: Number(t.refHigh),
      population: t.population,
      ageRange: t.ageRange,
      department: t.department,
      notes: t.notes,
      status: t.status || 'new',
      signatures: {
        performer: t.sigPerformer || '',
        quality: t.sigQuality || '',
        director: t.sigDirector || ''
      },
      createdAt: t.createdAt,
      verifiedAt: t.verifiedAt || null,
      samples: samplesArr
    };
  });

  updateDashboardSheet_(ss, tests);

  return { tests: fullTests, count: fullTests.length };
}

function getTestWithSamples_(ss, testId) {
  const allData = getAllData_(ss);
  const test = allData.tests.find(t => t.id === testId);
  if (!test) throw new Error('Test not found: ' + testId);
  return { test };
}

function addTest_(ss, data) {
  const sh = ss.getSheetByName(LAB_CONFIG.SHEETS.TESTS);
  const now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  const testId = 'LAB-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();

  const row = [
    testId,
    data.nameAr || '',
    data.nameEn || '',
    data.instrument || '',
    data.reagent || '',
    data.lot || '',
    data.unit || '',
    data.refLow || 0,
    data.refHigh || 0,
    data.population || 'both',
    data.ageRange || '',
    data.department || 'other',
    data.notes || '',
    'new',
    '', '', '',
    now,
    '',
    0, 0, 0
  ];

  sh.appendRow(row);

  const sampleSh = ss.getSheetByName(LAB_CONFIG.SHEETS.SAMPLES);
  const sampleRows = [];
  for (let i = 0; i < LAB_CONFIG.TOTAL_SAMPLES; i++) {
    sampleRows.push([testId, i, '', '', '', '', '', '', now]);
  }
  if (sampleRows.length > 0) {
    sampleSh.getRange(sampleSh.getLastRow() + 1, 1, sampleRows.length, sampleRows[0].length)
      .setValues(sampleRows);
  }

  return { testId, message: 'تم إضافة الاختبار بنجاح' };
}

function saveSamples_(ss, testId, samples) {
  const sh = ss.getSheetByName(LAB_CONFIG.SHEETS.SAMPLES);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const testIdCol = headers.indexOf('testId');
  const indexCol = headers.indexOf('sampleIndex');
  const now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  const testSh = ss.getSheetByName(LAB_CONFIG.SHEETS.TESTS);
  const testData = testSh.getDataRange().getValues();
  const testHeaders = testData[0];
  const testIdColT = testHeaders.indexOf('testId');
  const refLowCol = testHeaders.indexOf('refLow');
  const refHighCol = testHeaders.indexOf('refHigh');

  let refLow = 0, refHigh = 0, testRow = -1;
  for (let i = 1; i < testData.length; i++) {
    if (String(testData[i][testIdColT]) === String(testId)) {
      refLow = Number(testData[i][refLowCol]);
      refHigh = Number(testData[i][refHighCol]);
      testRow = i + 1;
      break;
    }
  }

  let withinCount = 0;
  let outCount = 0;
  let filledCount = 0;

  samples.forEach((sample, idx) => {
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][testIdCol]) === String(testId) && Number(data[i][indexCol]) === idx) {
        rowIdx = i + 1;
        break;
      }
    }

    const result = sample.result !== '' && sample.result !== null ? parseFloat(sample.result) : NaN;
    let withinRange = '';

    if (!isNaN(result)) {
      filledCount++;
      withinRange = (result >= refLow && result <= refHigh) ? 'Y' : 'N';
      if (withinRange === 'Y') withinCount++;
      else outCount++;
    }

    const rowData = [
      testId, idx,
      sample.sampleId || '',
      sample.sex || '',
      sample.age || '',
      isNaN(result) ? '' : result,
      withinRange,
      sample.remarks || '',
      now
    ];

    if (rowIdx > 0) {
      sh.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
    } else {
      sh.appendRow(rowData);
    }
  });

  let status = 'new';
  if (filledCount > 0 && filledCount < LAB_CONFIG.TOTAL_SAMPLES) status = 'pending';
  else if (filledCount >= LAB_CONFIG.TOTAL_SAMPLES) status = withinCount >= LAB_CONFIG.PASS_THRESHOLD ? 'pass' : 'fail';

  const passRate = filledCount > 0 ? Math.round((withinCount / filledCount) * 100) : 0;

  if (testRow > 0) {
    const statusCol = testHeaders.indexOf('status') + 1;
    const withinCol = testHeaders.indexOf('withinCount') + 1;
    const outCol = testHeaders.indexOf('outCount') + 1;
    const rateCol = testHeaders.indexOf('passRate') + 1;
    testSh.getRange(testRow, statusCol).setValue(status);
    testSh.getRange(testRow, withinCol).setValue(withinCount);
    testSh.getRange(testRow, outCol).setValue(outCount);
    testSh.getRange(testRow, rateCol).setValue(passRate);
  }

  return {
    message: 'تم حفظ العينات بنجاح',
    withinCount, outCount, filledCount, status, passRate
  };
}

function updateSignatures_(ss, testId, signatures) {
  const sh = ss.getSheetByName(LAB_CONFIG.SHEETS.TESTS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const testIdCol = headers.indexOf('testId');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][testIdCol]) === String(testId)) {
      const row = i + 1;
      sh.getRange(row, headers.indexOf('sigPerformer') + 1).setValue(signatures.performer || '');
      sh.getRange(row, headers.indexOf('sigQuality') + 1).setValue(signatures.quality || '');
      sh.getRange(row, headers.indexOf('sigDirector') + 1).setValue(signatures.director || '');
      return { message: 'تم حفظ التوقيعات' };
    }
  }
  throw new Error('Test not found: ' + testId);
}

function finalizeTest_(ss, testId) {
  const sh = ss.getSheetByName(LAB_CONFIG.SHEETS.TESTS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const testIdCol = headers.indexOf('testId');
  const now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][testIdCol]) === String(testId)) {
      const row = i + 1;
      const withinCount = Number(data[i][headers.indexOf('withinCount')]);
      const status = withinCount >= LAB_CONFIG.PASS_THRESHOLD ? 'pass' : 'fail';

      sh.getRange(row, headers.indexOf('status') + 1).setValue(status);
      sh.getRange(row, headers.indexOf('verifiedAt') + 1).setValue(now);

      updateDashboardSheet_(ss, null);
      return { message: status === 'pass' ? 'تم اعتماد النطاق المرجعي' : 'لم يجتز - يتطلب إعادة التحقق', status };
    }
  }
  throw new Error('Test not found');
}

function deleteTest_(ss, testId) {
  const testSh = ss.getSheetByName(LAB_CONFIG.SHEETS.TESTS);
  const testData = testSh.getDataRange().getValues();
  const testIdCol = testData[0].indexOf('testId');

  for (let i = testData.length - 1; i >= 1; i--) {
    if (String(testData[i][testIdCol]) === String(testId)) {
      testSh.deleteRow(i + 1);
      break;
    }
  }

  const sampleSh = ss.getSheetByName(LAB_CONFIG.SHEETS.SAMPLES);
  const sampleData = sampleSh.getDataRange().getValues();
  const sTestIdCol = sampleData[0].indexOf('testId');

  for (let i = sampleData.length - 1; i >= 1; i--) {
    if (String(sampleData[i][sTestIdCol]) === String(testId)) {
      sampleSh.deleteRow(i + 1);
    }
  }

  updateDashboardSheet_(ss, null);
  return { message: 'تم حذف الاختبار' };
}

function importBulkTests_(ss, testsArr) {
  let added = 0;
  testsArr.forEach(t => {
    try {
      addTest_(ss, t);
      added++;
    } catch (e) {}
  });
  return { message: 'تم استيراد ' + added + ' اختبار', count: added };
}

function updateDashboardSheet_(ss, testsData) {
  if (!testsData) {
    testsData = getSheetData_(ss, LAB_CONFIG.SHEETS.TESTS);
  }

  const total = testsData.length;
  const passed = testsData.filter(t => t.status === 'pass').length;
  const failed = testsData.filter(t => t.status === 'fail').length;
  const pending = testsData.filter(t => t.status === 'pending' || t.status === 'new').length;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  const sh = ss.getSheetByName(LAB_CONFIG.SHEETS.DASHBOARD);

  sh.getRange(2, 1, sh.getMaxRows() - 1, 3).clearContent();

  const metrics = [
    ['totalTests', total, now],
    ['passedTests', passed, now],
    ['failedTests', failed, now],
    ['pendingTests', pending, now],
    ['passRate', rate + '%', now],
    ['lastUpdate', now, now]
  ];

  sh.getRange(2, 1, metrics.length, 3).setValues(metrics);
}

function getDashboardStats_(ss) {
  const tests = getSheetData_(ss, LAB_CONFIG.SHEETS.TESTS);
  const total = tests.length;
  const passed = tests.filter(t => t.status === 'pass').length;
  const failed = tests.filter(t => t.status === 'fail').length;
  const pending = tests.filter(t => t.status === 'pending' || t.status === 'new').length;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const deptStats = {};
  tests.forEach(t => {
    if (!deptStats[t.department]) deptStats[t.department] = { total: 0, pass: 0, fail: 0 };
    deptStats[t.department].total++;
    if (t.status === 'pass') deptStats[t.department].pass++;
    if (t.status === 'fail') deptStats[t.department].fail++;
  });

  return { total, passed, failed, pending, rate, deptStats };
}

function getSheetData_(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = data[i][idx]; });
    rows.push(obj);
  }
  return rows;
}

function respondSuccess(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function respondError(err) {
  const msg = typeof err === 'string' ? err : (err.message || String(err));
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
