/**
 * Risk Register Backend - Google Apps Script
 * مجمع مكة الطبي بالزاهر
 * نظام سجل المخاطر مع التعليقات والقرارات
 */

const SPREADSHEET_ID = '12rii0-wE4jXD2NHS6n_6vutMiPOkTkv-A8WrCqlPo6A';
const RISK_SHEET_NAME = 'RiskRegister';
const COMMENTS_SHEET_NAME = 'Comments';
const DECISIONS_SHEET_NAME = 'Decisions';
const RISK_LIBRARY_SHEET_NAME = 'RiskLibrary';

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    let data;
    if (e.postData) {
      data = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.action) {
      data = e.parameter;
    } else {
      data = { action: 'getRisks' };
    }
    
    const action = data.action || 'getRisks';
    let result;
    
    switch (action) {
      case 'getRisks':
        result = getRisks();
        break;
      case 'saveRisk':
        result = saveRisk(data.payload || data);
        break;
      case 'updateRisk':
        result = updateRisk(data.payload || data);
        break;
      case 'deleteRisk':
        result = deleteRisk(data.payload?.id || data.id);
        break;
      case 'addComment':
        result = addComment(data.payload);
        break;
      case 'addDecision':
        result = addDecision(data.payload);
        break;
      case 'getComments':
        result = getComments(data.payload?.id || data.id);
        break;
      case 'getDecisions':
        result = getDecisions(data.payload?.id || data.id);
        break;
      case 'getManagers':
        result = getManagers();
        break;
      case 'master':
        result = getMasterData();
        break;
      case 'library':
        result = getLibraryData();
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateSheet(sheetName, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  
  return sheet;
}

function getRisks() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const riskSheet = ss.getSheetByName(RISK_SHEET_NAME);
  if (!riskSheet) {
    return { success: true, data: [] };
  }
  
  const data = riskSheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { success: true, data: [] };
  }
  
  const commentsMap = {};
  const decisionsMap = {};
  
  const commentsSheet = ss.getSheetByName(COMMENTS_SHEET_NAME);
  if (commentsSheet && commentsSheet.getLastRow() > 1) {
    const commentsData = commentsSheet.getDataRange().getValues();
    for (let i = 1; i < commentsData.length; i++) {
      const riskId = commentsData[i][0];
      if (!riskId) continue;
      if (!commentsMap[riskId]) commentsMap[riskId] = [];
      commentsMap[riskId].push({
        id: commentsData[i][1],
        text: commentsData[i][2],
        author: commentsData[i][3],
        date: commentsData[i][4]
      });
    }
  }
  
  const decisionsSheet = ss.getSheetByName(DECISIONS_SHEET_NAME);
  if (decisionsSheet && decisionsSheet.getLastRow() > 1) {
    const decisionsData = decisionsSheet.getDataRange().getValues();
    for (let i = 1; i < decisionsData.length; i++) {
      const riskId = decisionsData[i][0];
      if (!riskId) continue;
      if (!decisionsMap[riskId]) decisionsMap[riskId] = [];
      decisionsMap[riskId].push({
        id: decisionsData[i][1],
        text: decisionsData[i][2],
        type: decisionsData[i][3],
        author: decisionsData[i][4],
        date: decisionsData[i][5]
      });
    }
  }
  
  const headerRow = data[0];
  const risks = [];
  
  const headerMap = {
    'ID': 'id', 'Risk': 'risk', 'Category': 'category', 'Owner': 'owner',
    'Probability': 'probability', 'Impact': 'impact', 'Score': 'score', 'Level': 'level',
    'Mitigation': 'mitigation', 'Status': 'status', 'SourceEvidence': 'sourceEvidence',
    'ReviewDate': 'reviewDate', 'NegativeImpact': 'negativeImpact', 'LastUpdated': 'lastUpdated',
    'UpdatedBy': 'updatedBy'
  };
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    
    const risk = {};
    headerRow.forEach((header, idx) => {
      const key = headerMap[header] || header.toLowerCase();
      risk[key] = row[idx];
    });
    
    risk.comments = commentsMap[risk.id] || [];
    risk.decisions = decisionsMap[risk.id] || [];
    
    risks.push(risk);
  }
  
  return { success: true, data: risks };
}

function saveRisk(riskData) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(RISK_SHEET_NAME);
  
  if (!sheet) {
    const headers = ['ID', 'Risk', 'Category', 'Owner', 'Probability', 'Impact', 'Score', 'Level', 
                     'Mitigation', 'Status', 'ReviewDate', 'SourceEvidence', 'NegativeImpact', 'LastUpdated', 'UpdatedBy'];
    sheet = ss.insertSheet(RISK_SHEET_NAME);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const id = riskData.id || 'R-' + new Date().getTime();
  const now = new Date().toISOString();
  
  const prob = parseInt(riskData.probability) || 3;
  const imp = parseInt(riskData.impact) || 3;
  const score = prob * imp;
  const level = score >= 20 ? 'حرج' : score >= 12 ? 'عالي' : score >= 6 ? 'متوسط' : 'منخفض';
  
  const dataMap = {
    'ID': id,
    'Risk': riskData.risk || '',
    'Category': riskData.category || '',
    'Owner': riskData.owner || '',
    'Probability': prob,
    'Impact': imp,
    'Score': score,
    'Level': level,
    'Mitigation': riskData.mitigation || '',
    'Status': riskData.status || 'مفتوح',
    'ReviewDate': riskData.reviewDate || '',
    'SourceEvidence': riskData.sourceEvidence || '',
    'NegativeImpact': riskData.negativeImpact || '',
    'LastUpdated': now,
    'UpdatedBy': 'user'
  };
  
  const row = headers.map(h => dataMap[h] || '');
  sheet.appendRow(row);
  
  return { success: true, id: id, message: 'تم حفظ الخطر بنجاح' };
}

function updateRisk(riskData) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(RISK_SHEET_NAME);
  if (!sheet) {
    return saveRisk(riskData);
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  let idIndex = headers.indexOf('ID');
  if (idIndex === -1) idIndex = headers.indexOf('id');
  if (idIndex === -1) {
    return { success: false, error: 'لم يتم العثور على عمود المعرف' };
  }
  
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIndex] === riskData.id) {
      rowIndex = i + 1;
      break;
    }
  }
  
  if (rowIndex === -1) {
    return saveRisk(riskData);
  }
  
  const now = new Date().toISOString();
  const prob = parseInt(riskData.probability) || 3;
  const imp = parseInt(riskData.impact) || 3;
  const score = prob * imp;
  const level = score >= 20 ? 'حرج' : score >= 12 ? 'عالي' : score >= 6 ? 'متوسط' : 'منخفض';
  
  const headerMap = {
    'ID': 'id', 'Risk': 'risk', 'Category': 'category', 'Owner': 'owner',
    'Probability': 'probability', 'Impact': 'impact', 'Score': 'score', 'Level': 'level',
    'Mitigation': 'mitigation', 'Status': 'status', 'SourceEvidence': 'sourceEvidence',
    'ReviewDate': 'reviewDate', 'NegativeImpact': 'negativeImpact', 'LastUpdated': 'lastUpdated'
  };
  
  const updates = {
    risk: riskData.risk,
    category: riskData.category,
    owner: riskData.owner,
    probability: prob,
    impact: imp,
    score: score,
    level: level,
    mitigation: riskData.mitigation,
    status: riskData.status,
    sourceEvidence: riskData.sourceEvidence,
    reviewDate: riskData.reviewDate,
    negativeImpact: riskData.negativeImpact,
    lastUpdated: now
  };
  
  headers.forEach((header, colIndex) => {
    const key = headerMap[header] || header.toLowerCase();
    if (updates.hasOwnProperty(key)) {
      sheet.getRange(rowIndex, colIndex + 1).setValue(updates[key]);
    }
  });
  
  return { success: true, id: riskData.id, message: 'تم تحديث الخطر بنجاح' };
}

function deleteRisk(id) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(RISK_SHEET_NAME);
  if (!sheet) {
    return { success: false, error: 'لم يتم العثور على الورقة' };
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  let idIndex = headers.indexOf('ID');
  if (idIndex === -1) idIndex = headers.indexOf('id');
  if (idIndex === -1) {
    return { success: false, error: 'لم يتم العثور على عمود المعرف' };
  }
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIndex] === id) {
      sheet.deleteRow(i + 1);
      deleteCommentsForRisk(id);
      deleteDecisionsForRisk(id);
      return { success: true, message: 'تم حذف الخطر بنجاح' };
    }
  }
  
  return { success: false, error: 'لم يتم العثور على الخطر' };
}

function addComment(payload) {
  const headers = ['riskId', 'commentId', 'text', 'author', 'date'];
  const sheet = getOrCreateSheet(COMMENTS_SHEET_NAME, headers);
  
  const commentId = 'C-' + new Date().getTime();
  const comment = payload.comment;
  
  const row = [
    payload.id,
    commentId,
    comment.text || '',
    comment.author || 'مستخدم',
    comment.date || new Date().toISOString()
  ];
  
  sheet.appendRow(row);
  
  return { success: true, commentId: commentId, message: 'تم إضافة التعليق بنجاح' };
}

function getComments(riskId) {
  const headers = ['riskId', 'commentId', 'text', 'author', 'date'];
  const sheet = getOrCreateSheet(COMMENTS_SHEET_NAME, headers);
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { success: true, data: [] };
  }
  
  const comments = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === riskId) {
      comments.push({
        id: data[i][1],
        text: data[i][2],
        author: data[i][3],
        date: data[i][4]
      });
    }
  }
  
  return { success: true, data: comments };
}

function deleteCommentsForRisk(riskId) {
  const sheet = getOrCreateSheet(COMMENTS_SHEET_NAME, []);
  const data = sheet.getDataRange().getValues();
  
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === riskId) {
      sheet.deleteRow(i + 1);
    }
  }
}

function addDecision(payload) {
  const headers = ['riskId', 'decisionId', 'text', 'type', 'author', 'date'];
  const sheet = getOrCreateSheet(DECISIONS_SHEET_NAME, headers);
  
  const decisionId = 'D-' + new Date().getTime();
  const decision = payload.decision;
  
  const row = [
    payload.id,
    decisionId,
    decision.text || '',
    decision.type || 'آخر',
    decision.author || 'مستخدم',
    decision.date || new Date().toISOString()
  ];
  
  sheet.appendRow(row);
  
  return { success: true, decisionId: decisionId, message: 'تم إضافة القرار بنجاح' };
}

function getDecisions(riskId) {
  const headers = ['riskId', 'decisionId', 'text', 'type', 'author', 'date'];
  const sheet = getOrCreateSheet(DECISIONS_SHEET_NAME, headers);
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { success: true, data: [] };
  }
  
  const decisions = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === riskId) {
      decisions.push({
        id: data[i][1],
        text: data[i][2],
        type: data[i][3],
        author: data[i][4],
        date: data[i][5]
      });
    }
  }
  
  return { success: true, data: decisions };
}

function deleteDecisionsForRisk(riskId) {
  const sheet = getOrCreateSheet(DECISIONS_SHEET_NAME, []);
  const data = sheet.getDataRange().getValues();
  
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === riskId) {
      sheet.deleteRow(i + 1);
    }
  }
}

/**
 * جلب قائمة المسؤولين/المدراء من ورقة RiskLibrary
 * يقرأ العمود A (المالك/المسؤول) ويزيل التكرارات
 */
function getManagers() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(RISK_LIBRARY_SHEET_NAME);
  
  if (!sheet) {
    return { success: true, data: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { success: true, data: [] };
  }
  
  const managersSet = new Set();
  
  for (let i = 1; i < data.length; i++) {
    const manager = data[i][0];
    if (manager && manager.toString().trim()) {
      managersSet.add(manager.toString().trim());
    }
  }
  
  const managers = Array.from(managersSet).sort();
  
  return { success: true, data: managers };
}

/**
 * جلب البيانات الرئيسية للنظام (الأقسام والمسؤولين)
 */
function getMasterData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const ownersSet = new Set();
  const categoriesSet = new Set(['FMS', 'PSC', 'IPC', 'EOC', 'RM', 'QI', 'LD', 'PSC/FMS', 'EOC/FMS', 'PSC/LB', 'PSC/PH', 'RM/PH']);
  
  const libSheet = ss.getSheetByName(RISK_LIBRARY_SHEET_NAME);
  if (libSheet && libSheet.getLastRow() > 1) {
    const data = libSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const owner = data[i][0];
      const cat = data[i][3];
      if (owner && owner.toString().trim()) ownersSet.add(owner.toString().trim());
      if (cat && cat.toString().trim()) categoriesSet.add(cat.toString().trim());
    }
  }
  
  return {
    success: true,
    data: {
      owners: Array.from(ownersSet).sort(),
      categories: Array.from(categoriesSet).sort()
    }
  };
}

/**
 * جلب مكتبة المخاطر
 */
function getLibraryData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(RISK_LIBRARY_SHEET_NAME);
  
  if (!sheet || sheet.getLastRow() <= 1) {
    return { success: true, data: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  const items = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[2]) continue;
    items.push({
      risk: row[2] || '',
      category: row[3] || '',
      defaultOwner: row[4] || row[0] || '',
      defaultMitigation: row[5] || ''
    });
  }
  
  return { success: true, data: items };
}

function testConnection() {
  return { success: true, message: 'الاتصال يعمل بنجاح', timestamp: new Date().toISOString() };
}
