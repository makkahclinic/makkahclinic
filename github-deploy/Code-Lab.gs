/***********************************************************
 * بوابة المختبر الإلكترونية - مجمع مكة الطبي بالزاهر
 * CBAHI Laboratory Portal - Google Apps Script Backend
 *
 * الشيت المركزي: 22 ورقة (3 أصلية + 19 سجل CBAHI)
 * كل ورقة تُنشأ تلقائياً مع الترويسات عند أول تشغيل
 ***********************************************************/

const LAB_CONFIG = {
  TIMEZONE: 'Asia/Riyadh',
  PASS_THRESHOLD: 18,
  TOTAL_SAMPLES: 20
};

const SHEET_DEFS = {
  Tests:             ['testId','nameAr','nameEn','instrument','reagent','lot','unit','refLow','refHigh','population','ageRange','department','notes','status','sigPerformer','sigQuality','sigDirector','createdAt','verifiedAt','withinCount','outCount','passRate'],
  Samples:           ['testId','sampleIndex','sampleId','sex','age','result','withinRange','remarks','updatedAt'],
  Dashboard:         ['metric','value','updatedAt'],
  EvidenceTracker:   ['المعيار','المتطلب','الوثيقة الداعمة','المسؤول','الحالة','ملاحظات','updatedAt'],
  QCLog:             ['id','التاريخ','القسم','الجهاز','الفحص','مستوى QC','المجال المقبول','النتيجة','الحالة','الإجراء','المراجع','createdAt'],
  QC_CAPA:           ['id','التاريخ','القسم/الجهاز','الفحص','المشكلة','الاحتواء الفوري','السبب الجذري','الإجراء التصحيحي','التحقق من الفعالية','الحالة','اعتماد','createdAt'],
  PT_EQA:            ['id','المزود','الدورة','القسم','الفحص','تاريخ الاستلام','تاريخ الإرسال','النتيجة','مقبول','CAPA','مراجعة','createdAt'],
  SpecimenRejection: ['id','التاريخ','MRN','اسم المريض','القسم','نوع العينة','سبب الرفض','القرار','أُبلغت الجهة','الموظف','ملاحظات','createdAt'],
  CriticalValues:    ['id','التاريخ','MRN','اسم المريض','القسم','الفحص','النتيجة الحرجة','تأكيد','أُبلغ إلى','وسيلة الإبلاغ','Read-back','المبلّغ','ملاحظات','createdAt'],
  CorrectedReports:  ['id','التاريخ','MRN','اسم المريض','الفحص','النتيجة السابقة','النتيجة المصححة','سبب التصحيح','أُبلغ الطبيب','الموظف','ملاحظات','createdAt'],
  Maintenance:       ['id','الجهاز','رقم الأصل','الرقم التسلسلي','نوع النشاط','التاريخ المجدول','التاريخ المنفذ','المنفذ','النتيجة','التحقق بعد النشاط','الاعتماد','createdAt'],
  Temperature:       ['id','التاريخ','الوقت','الموقع','المدى المقبول','القراءة','داخل المدى','الإجراء','الموظف','المراجعة','createdAt'],
  StdChecks:         ['id','الأداة','رقم التعريف','المرجعي','التاريخ','النتيجة','Pass/Fail','الإجراء','المنفذ','اعتماد','createdAt'],
  LotVerify:         ['id','الفحص','اللوت القديم','اللوت الجديد','العينات','معيار القبول','النتيجة','Pass/Fail','التاريخ','المنفذ','الاعتماد','createdAt'],
  Correlation:       ['id','الفحص','الجهاز1','الطريقة1','الجهاز2','الطريقة2','عدد العينات','معيار القبول','النتيجة','القرار','التاريخ','المنفذ','الاعتماد','createdAt'],
  Training:          ['id','التاريخ','العنوان','الفئة المستهدفة','المدرب','طريقة التقييم','النتيجة','الحضور','ملاحظات','createdAt'],
  Competency:        ['id','اسم الموظف','القسم','التعيين','Initial','Annual','IQC','Safety','Phlebotomy','LIS','ملاحظات','updatedAt'],
  Indicators:        ['الشهر','إجمالي العينات','المرفوضة','نسبة الرفض','اختبارات TAT','ضمن TAT','التزام TAT','نتائج حرجة','Read-back','التزام Read-back','تقارير مصححة','أخطاء تعريف','ملاحظات','updatedAt'],
  CAPA_Log:          ['id','رقم CAPA','المصدر','المشكلة','الاحتواء','السبب الجذري','الإجراء التصحيحي','الإجراء الوقائي','المسؤول','التاريخ المستهدف','تاريخ الإغلاق','الحالة','التحقق','createdAt'],
  InternalAudit:     ['المعيار','نقطة التدقيق','الدليل المطلوب','نعم/لا/جزئي','الملاحظة','الإجراء','updatedAt'],
  SampleRetention:   ['id','التاريخ','رقم العينة','نوع العينة','الموقع','تاريخ الإتلاف المستحق','الإتلاف الفعلي','المنفذ','ملاحظات','createdAt'],
  SafetyRounds:      ['id','التاريخ','الموقع','البند','الحالة','الملاحظة','الإجراء التصحيحي','المسؤول','تاريخ الإغلاق','createdAt']
};

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'getAll';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureAllSheets_(ss);

    switch (action) {
      case 'getAll':         return ok(getAllData_(ss));
      case 'getTest':        return ok(getTestWithSamples_(ss, e.parameter.testId));
      case 'getDashboard':   return ok(getDashboardStats_(ss));
      case 'getSheet':       return ok(getSheetRows_(ss, e.parameter.sheet));
      default:               return err('Unknown action: ' + action);
    }
  } catch (ex) { return err(ex); }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Empty POST body');
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureAllSheets_(ss);

    switch (action) {
      case 'addTest':          return ok(addTest_(ss, body.data));
      case 'saveSamples':      return ok(saveSamples_(ss, body.testId, body.samples));
      case 'updateSignatures': return ok(updateSignatures_(ss, body.testId, body.signatures));
      case 'finalizeTest':     return ok(finalizeTest_(ss, body.testId));
      case 'deleteTest':       return ok(deleteTest_(ss, body.testId));
      case 'importBulk':       return ok(importBulkTests_(ss, body.tests));
      case 'addRow':           return ok(addRow_(ss, body.sheet, body.data));
      case 'updateRow':        return ok(updateRow_(ss, body.sheet, body.rowId, body.data));
      case 'deleteRow':        return ok(deleteRow_(ss, body.sheet, body.rowId));
      case 'bulkUpdate':       return ok(bulkUpdate_(ss, body.sheet, body.rows));
      default:                 return err('Unknown action: ' + action);
    }
  } catch (ex) { return err(ex); }
}

function ensureAllSheets_(ss) {
  Object.keys(SHEET_DEFS).forEach(function(name) {
    ensureSheet_(ss, name, SHEET_DEFS[name]);
  });
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1e3a5f')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else {
    var existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
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

function getSheetRows_(ss, sheetName) {
  if (!SHEET_DEFS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);
  return { rows: getSheetData_(ss, sheetName), headers: SHEET_DEFS[sheetName] };
}

function addRow_(ss, sheetName, data) {
  if (!SHEET_DEFS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);
  var sh = ss.getSheetByName(sheetName);
  var headers = SHEET_DEFS[sheetName];
  var now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  var row = headers.map(function(h) {
    if (h === 'id') return 'R-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2,3).toUpperCase();
    if (h === 'createdAt' || h === 'updatedAt') return now;
    return data[h] !== undefined ? data[h] : '';
  });
  sh.appendRow(row);
  return { message: 'تم الإضافة بنجاح', id: row[headers.indexOf('id')] || '' };
}

function updateRow_(ss, sheetName, rowId, data) {
  if (!SHEET_DEFS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);
  var sh = ss.getSheetByName(sheetName);
  var allData = sh.getDataRange().getValues();
  var headers = allData[0];
  var idCol = headers.indexOf('id');
  var keyCol = idCol >= 0 ? idCol : 0;
  var now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][keyCol]) === String(rowId)) {
      headers.forEach(function(h, idx) {
        if (data[h] !== undefined) {
          sh.getRange(i + 1, idx + 1).setValue(data[h]);
        }
      });
      var tsCol = headers.indexOf('updatedAt');
      if (tsCol < 0) tsCol = headers.indexOf('createdAt');
      if (tsCol >= 0) sh.getRange(i + 1, tsCol + 1).setValue(now);
      return { message: 'تم التحديث' };
    }
  }
  throw new Error('Row not found: ' + rowId);
}

function deleteRow_(ss, sheetName, rowId) {
  if (!SHEET_DEFS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);
  var sh = ss.getSheetByName(sheetName);
  var allData = sh.getDataRange().getValues();
  var headers = allData[0];
  var idCol = headers.indexOf('id');
  var keyCol = idCol >= 0 ? idCol : 0;

  for (var i = allData.length - 1; i >= 1; i--) {
    if (String(allData[i][keyCol]) === String(rowId)) {
      sh.deleteRow(i + 1);
      return { message: 'تم الحذف' };
    }
  }
  throw new Error('Row not found: ' + rowId);
}

function bulkUpdate_(ss, sheetName, rows) {
  if (!SHEET_DEFS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);
  var sh = ss.getSheetByName(sheetName);
  var headers = SHEET_DEFS[sheetName];
  var now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), headers.length).clearContent();

  if (rows && rows.length > 0) {
    var dataRows = rows.map(function(r) {
      return headers.map(function(h) {
        if (h === 'updatedAt') return now;
        return r[h] !== undefined ? r[h] : '';
      });
    });
    sh.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);
  }
  return { message: 'تم تحديث ' + (rows ? rows.length : 0) + ' سجل' };
}

function getAllData_(ss) {
  var tests = getSheetData_(ss, 'Tests');
  var samples = getSheetData_(ss, 'Samples');

  var samplesByTest = {};
  samples.forEach(function(s) {
    if (!samplesByTest[s.testId]) samplesByTest[s.testId] = [];
    samplesByTest[s.testId].push(s);
  });

  var fullTests = tests.map(function(t) {
    var tSamples = samplesByTest[t.testId] || [];
    tSamples.sort(function(a, b) { return Number(a.sampleIndex) - Number(b.sampleIndex); });

    var samplesArr = [];
    for (var i = 0; i < LAB_CONFIG.TOTAL_SAMPLES; i++) {
      var found = tSamples.find(function(s) { return Number(s.sampleIndex) === i; });
      samplesArr.push(found || { sampleId:'', sex:'', age:'', result:'', withinRange:'', remarks:'' });
    }

    return {
      id: t.testId, nameAr: t.nameAr, nameEn: t.nameEn, instrument: t.instrument,
      reagent: t.reagent, lot: t.lot, unit: t.unit, refLow: Number(t.refLow), refHigh: Number(t.refHigh),
      population: t.population, ageRange: t.ageRange, department: t.department, notes: t.notes,
      status: t.status || 'new',
      signatures: { performer: t.sigPerformer||'', quality: t.sigQuality||'', director: t.sigDirector||'' },
      createdAt: t.createdAt, verifiedAt: t.verifiedAt || null, samples: samplesArr
    };
  });

  updateDashboardSheet_(ss, tests);
  return { tests: fullTests, count: fullTests.length };
}

function getTestWithSamples_(ss, testId) {
  var allData = getAllData_(ss);
  var test = allData.tests.find(function(t) { return t.id === testId; });
  if (!test) throw new Error('Test not found: ' + testId);
  return { test: test };
}

function addTest_(ss, data) {
  var sh = ss.getSheetByName('Tests');
  var now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  var testId = 'LAB-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2,4).toUpperCase();

  var row = [
    testId, data.nameAr||'', data.nameEn||'', data.instrument||'', data.reagent||'', data.lot||'',
    data.unit||'', data.refLow||0, data.refHigh||0, data.population||'both', data.ageRange||'',
    data.department||'other', data.notes||'', 'new', '','','', now, '', 0, 0, 0
  ];
  sh.appendRow(row);

  var sampleSh = ss.getSheetByName('Samples');
  var sampleRows = [];
  for (var i = 0; i < LAB_CONFIG.TOTAL_SAMPLES; i++) {
    sampleRows.push([testId, i, '', '', '', '', '', '', now]);
  }
  sampleSh.getRange(sampleSh.getLastRow() + 1, 1, sampleRows.length, sampleRows[0].length).setValues(sampleRows);
  return { testId: testId, message: 'تم إضافة الاختبار بنجاح' };
}

function saveSamples_(ss, testId, samples) {
  var sh = ss.getSheetByName('Samples');
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var testIdCol = headers.indexOf('testId');
  var indexCol = headers.indexOf('sampleIndex');
  var now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  var testSh = ss.getSheetByName('Tests');
  var testData = testSh.getDataRange().getValues();
  var testHeaders = testData[0];
  var testIdColT = testHeaders.indexOf('testId');
  var refLowCol = testHeaders.indexOf('refLow');
  var refHighCol = testHeaders.indexOf('refHigh');

  var refLow = 0, refHigh = 0, testRow = -1;
  for (var i = 1; i < testData.length; i++) {
    if (String(testData[i][testIdColT]) === String(testId)) {
      refLow = Number(testData[i][refLowCol]);
      refHigh = Number(testData[i][refHighCol]);
      testRow = i + 1;
      break;
    }
  }

  var withinCount = 0, outCount = 0, filledCount = 0;

  samples.forEach(function(sample, idx) {
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][testIdCol]) === String(testId) && Number(data[i][indexCol]) === idx) {
        rowIdx = i + 1; break;
      }
    }

    var result = sample.result !== '' && sample.result !== null ? parseFloat(sample.result) : NaN;
    var withinRange = '';
    if (!isNaN(result)) {
      filledCount++;
      withinRange = (result >= refLow && result <= refHigh) ? 'Y' : 'N';
      if (withinRange === 'Y') withinCount++; else outCount++;
    }

    var rowData = [testId, idx, sample.sampleId||'', sample.sex||'', sample.age||'', isNaN(result)?'':result, withinRange, sample.remarks||'', now];
    if (rowIdx > 0) sh.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
    else sh.appendRow(rowData);
  });

  var status = 'new';
  if (filledCount > 0 && filledCount < LAB_CONFIG.TOTAL_SAMPLES) status = 'pending';
  else if (filledCount >= LAB_CONFIG.TOTAL_SAMPLES) status = withinCount >= LAB_CONFIG.PASS_THRESHOLD ? 'pass' : 'fail';

  var passRate = filledCount > 0 ? Math.round((withinCount / filledCount) * 100) : 0;

  if (testRow > 0) {
    testSh.getRange(testRow, testHeaders.indexOf('status') + 1).setValue(status);
    testSh.getRange(testRow, testHeaders.indexOf('withinCount') + 1).setValue(withinCount);
    testSh.getRange(testRow, testHeaders.indexOf('outCount') + 1).setValue(outCount);
    testSh.getRange(testRow, testHeaders.indexOf('passRate') + 1).setValue(passRate);
  }

  return { message: 'تم حفظ العينات بنجاح', withinCount:withinCount, outCount:outCount, filledCount:filledCount, status:status, passRate:passRate };
}

function updateSignatures_(ss, testId, signatures) {
  var sh = ss.getSheetByName('Tests');
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var testIdCol = headers.indexOf('testId');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][testIdCol]) === String(testId)) {
      var row = i + 1;
      sh.getRange(row, headers.indexOf('sigPerformer') + 1).setValue(signatures.performer || '');
      sh.getRange(row, headers.indexOf('sigQuality') + 1).setValue(signatures.quality || '');
      sh.getRange(row, headers.indexOf('sigDirector') + 1).setValue(signatures.director || '');
      return { message: 'تم حفظ التوقيعات' };
    }
  }
  throw new Error('Test not found: ' + testId);
}

function finalizeTest_(ss, testId) {
  var sh = ss.getSheetByName('Tests');
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var testIdCol = headers.indexOf('testId');
  var now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][testIdCol]) === String(testId)) {
      var row = i + 1;
      var withinCount = Number(data[i][headers.indexOf('withinCount')]);
      var status = withinCount >= LAB_CONFIG.PASS_THRESHOLD ? 'pass' : 'fail';
      sh.getRange(row, headers.indexOf('status') + 1).setValue(status);
      sh.getRange(row, headers.indexOf('verifiedAt') + 1).setValue(now);
      updateDashboardSheet_(ss, null);
      return { message: status === 'pass' ? 'تم اعتماد النطاق المرجعي' : 'لم يجتز', status: status };
    }
  }
  throw new Error('Test not found');
}

function deleteTest_(ss, testId) {
  var testSh = ss.getSheetByName('Tests');
  var testData = testSh.getDataRange().getValues();
  var testIdCol = testData[0].indexOf('testId');
  for (var i = testData.length - 1; i >= 1; i--) {
    if (String(testData[i][testIdCol]) === String(testId)) { testSh.deleteRow(i + 1); break; }
  }
  var sampleSh = ss.getSheetByName('Samples');
  var sampleData = sampleSh.getDataRange().getValues();
  var sTestIdCol = sampleData[0].indexOf('testId');
  for (var i = sampleData.length - 1; i >= 1; i--) {
    if (String(sampleData[i][sTestIdCol]) === String(testId)) sampleSh.deleteRow(i + 1);
  }
  updateDashboardSheet_(ss, null);
  return { message: 'تم حذف الاختبار' };
}

function importBulkTests_(ss, testsArr) {
  var added = 0;
  testsArr.forEach(function(t) { try { addTest_(ss, t); added++; } catch(e){} });
  return { message: 'تم استيراد ' + added + ' اختبار', count: added };
}

function updateDashboardSheet_(ss, testsData) {
  if (!testsData) testsData = getSheetData_(ss, 'Tests');
  var total = testsData.length;
  var passed = testsData.filter(function(t){return t.status==='pass'}).length;
  var failed = testsData.filter(function(t){return t.status==='fail'}).length;
  var pending = testsData.filter(function(t){return t.status==='pending'||t.status==='new'}).length;
  var rate = total > 0 ? Math.round((passed / total) * 100) : 0;
  var now = Utilities.formatDate(new Date(), LAB_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  var sh = ss.getSheetByName('Dashboard');
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 3).clearContent();
  var metrics = [['totalTests',total,now],['passedTests',passed,now],['failedTests',failed,now],['pendingTests',pending,now],['passRate',rate+'%',now],['lastUpdate',now,now]];
  sh.getRange(2, 1, metrics.length, 3).setValues(metrics);
}

function getDashboardStats_(ss) {
  var tests = getSheetData_(ss, 'Tests');
  var total = tests.length;
  var passed = tests.filter(function(t){return t.status==='pass'}).length;
  var failed = tests.filter(function(t){return t.status==='fail'}).length;
  var pending = tests.filter(function(t){return t.status==='pending'||t.status==='new'}).length;
  var rate = total > 0 ? Math.round((passed / total) * 100) : 0;
  var deptStats = {};
  tests.forEach(function(t) {
    if (!deptStats[t.department]) deptStats[t.department] = {total:0,pass:0,fail:0};
    deptStats[t.department].total++;
    if (t.status==='pass') deptStats[t.department].pass++;
    if (t.status==='fail') deptStats[t.department].fail++;
  });
  return { total:total, passed:passed, failed:failed, pending:pending, rate:rate, deptStats:deptStats };
}

function getSheetData_(ss, sheetName) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    headers.forEach(function(h, idx) { obj[h] = data[i][idx]; });
    rows.push(obj);
  }
  return rows;
}

function ok(data) {
  return ContentService.createTextOutput(JSON.stringify({status:'success',data:data})).setMimeType(ContentService.MimeType.JSON);
}

function err(e) {
  var msg = typeof e === 'string' ? e : (e.message || String(e));
  return ContentService.createTextOutput(JSON.stringify({status:'error',message:msg})).setMimeType(ContentService.MimeType.JSON);
}
