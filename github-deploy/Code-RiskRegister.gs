/**
 * سجل المخاطر - Risk Register Backend
 * مجمع مكة الطبي بالزاهر
 * 
 * ===== تعليمات النشر =====
 * 1. افتح: https://script.google.com
 * 2. ملف > مشروع جديد
 * 3. انسخ هذا الكود بالكامل
 * 4. Deploy > New deployment
 * 5. Type: Web app
 * 6. Execute as: Me
 * 7. Who has access: Anyone
 * 8. انسخ الرابط واستخدمه
 */

const SPREADSHEET_ID = '12rii0-wE4jXD2NHS6n_6vutMiPOkTkv-A8WrCqlPo6A';
const RISK_SHEET = 'RiskRegister';
const LIBRARY_SHEET = 'RiskLibrary';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  
  let result;
  switch (action.toLowerCase()) {
    case 'list':
      result = listRisks();
      break;
    case 'library':
      result = getRiskLibrary();
      break;
    case 'owners':
      result = getOwnersList();
      break;
    case 'test':
      result = testConnection();
      break;
    default:
      result = { message: 'Risk Register API v1.0', actions: ['list', 'library', 'owners', 'test'] };
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, ...result }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = (body.action || '').toLowerCase();
    const payload = body.payload || {};

    let result;
    switch (action) {
      case 'add':
        result = addRisk(payload);
        break;
      case 'update':
        result = updateRisk(payload);
        break;
      case 'delete':
        result = deleteRisk(payload);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: !result.error, ...result }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function testConnection() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets().map(s => s.getName());
    return {
      connected: true,
      spreadsheetName: ss.getName(),
      sheets: sheets,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

function getSheet_(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(name);
  
  if (!sh && name === RISK_SHEET) {
    sh = ss.insertSheet(RISK_SHEET);
    sh.appendRow([
      'ID', 'Risk', 'Category', 'Owner', 'Probability', 'Impact', 'Score', 'Level',
      'Mitigation', 'Status', 'ReviewDate', 'SourceEvidence', 'LastUpdated', 'UpdatedBy'
    ]);
    sh.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff');
  }
  
  return sh;
}

function levelFromScore_(score) {
  if (score >= 16) return 'حرج';
  if (score >= 12) return 'عالي';
  if (score >= 6) return 'متوسط';
  return 'منخفض';
}

function clamp_(n, min, max) {
  n = Number(n);
  if (Number.isNaN(n)) n = min;
  return Math.max(min, Math.min(max, n));
}

// ========== قراءة مكتبة المخاطر ==========
function getRiskLibrary() {
  const sh = getSheet_(LIBRARY_SHEET);
  if (!sh || sh.getLastRow() < 2) {
    return { items: [] };
  }
  
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const items = data.map(r => ({
    owner: String(r[0] || '').trim(),
    department: String(r[1] || '').trim(),
    risk: String(r[2] || '').trim(),
    category: String(r[3] || '').trim(),
    defaultOwner: String(r[4] || '').trim(),
    defaultMitigation: String(r[5] || '').trim()
  })).filter(item => item.risk);
  
  return { items };
}

// ========== قائمة المسؤولين ==========
function getOwnersList() {
  const sh = getSheet_(LIBRARY_SHEET);
  if (!sh || sh.getLastRow() < 2) {
    return { owners: [] };
  }
  
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  const ownerSet = new Set();
  
  data.forEach(r => {
    const owner = String(r[0] || '').trim();
    const defaultOwner = String(r[4] || '').trim();
    if (owner) ownerSet.add(owner);
    if (defaultOwner) ownerSet.add(defaultOwner);
  });
  
  return { owners: Array.from(ownerSet).sort() };
}

// ========== قراءة سجل المخاطر ==========
function listRisks() {
  const sh = getSheet_(RISK_SHEET);
  const lastRow = sh.getLastRow();
  
  if (lastRow < 2) {
    return { items: [] };
  }

  const data = sh.getRange(2, 1, lastRow - 1, 14).getValues();
  const items = data.map(r => ({
    id: r[0],
    risk: r[1],
    category: r[2],
    owner: r[3],
    probability: Number(r[4]) || 3,
    impact: Number(r[5]) || 3,
    score: Number(r[6]) || 9,
    level: r[7] || 'متوسط',
    mitigation: r[8],
    status: r[9] || 'مفتوح',
    reviewDate: formatDate_(r[10]),
    sourceEvidence: r[11],
    lastUpdated: r[12],
    updatedBy: r[13]
  })).filter(item => item.id);

  return { items };
}

function formatDate_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}

// ========== إضافة خطر جديد ==========
function addRisk(p) {
  const sh = getSheet_(RISK_SHEET);
  const prob = clamp_(p.probability, 1, 5);
  const impact = clamp_(p.impact, 1, 5);
  const score = prob * impact;
  const level = levelFromScore_(score);
  
  const id = 'R-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  
  sh.appendRow([
    id,
    p.risk || '',
    p.category || '',
    p.owner || '',
    prob,
    impact,
    score,
    level,
    p.mitigation || '',
    p.status || 'مفتوح',
    p.reviewDate || '',
    p.sourceEvidence || '',
    new Date().toISOString(),
    p.updatedBy || 'system'
  ]);
  
  return { id };
}

// ========== تحديث خطر ==========
function updateRisk(p) {
  const sh = getSheet_(RISK_SHEET);
  const id = String(p.id || '').trim();
  
  if (!id) return { error: 'Missing id' };
  
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { error: 'No data' };
  
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(x => String(x).trim() === id);
  
  if (idx === -1) return { error: 'ID not found' };
  
  const row = idx + 2;
  const prob = clamp_(p.probability, 1, 5);
  const impact = clamp_(p.impact, 1, 5);
  const score = prob * impact;
  const level = levelFromScore_(score);
  
  sh.getRange(row, 2, 1, 13).setValues([[
    p.risk || '',
    p.category || '',
    p.owner || '',
    prob,
    impact,
    score,
    level,
    p.mitigation || '',
    p.status || 'مفتوح',
    p.reviewDate || '',
    p.sourceEvidence || '',
    new Date().toISOString(),
    p.updatedBy || 'system'
  ]]);
  
  return { updated: true };
}

// ========== حذف خطر ==========
function deleteRisk(p) {
  const sh = getSheet_(RISK_SHEET);
  const id = String(p.id || '').trim();
  
  if (!id) return { error: 'Missing id' };
  
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { error: 'No data' };
  
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(x => String(x).trim() === id);
  
  if (idx === -1) return { error: 'ID not found' };
  
  sh.deleteRow(idx + 2);
  return { deleted: true };
}
