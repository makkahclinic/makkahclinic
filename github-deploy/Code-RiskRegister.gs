/**
 * سجل المخاطر - Risk Register Backend
 * مجمع مكة الطبي بالزاهر
 * 
 * تعليمات النشر:
 * 1. أنشئ مشروع جديد في Google Apps Script
 * 2. انسخ هذا الكود
 * 3. Deploy > New deployment > Web app
 * 4. Execute as: Me
 * 5. Who has access: Anyone
 * 6. انسخ الرابط الناتج واستخدمه في risk-register.html
 */

const SPREADSHEET_ID = '12rii0-wE4jXD2NHS6n_6vutMiPOkTkv-A8WrCqlPo6A';
const SHEET_NAME = 'RiskRegister';

function doGet(e) {
  const action = (e.parameter.action || '').toLowerCase();
  
  if (action === 'list') {
    return jsonOutput(listRisks());
  }
  
  if (action === 'library') {
    return jsonOutput(getRiskLibrary());
  }
  
  return jsonOutput({ ok: true, message: 'Risk Register API. Use ?action=list or ?action=library' });
}

function doPost(e) {
  try {
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = (body.action || '').toLowerCase();
    const payload = body.payload || {};

    if (action === 'add') return jsonOutput(addRisk(payload));
    if (action === 'update') return jsonOutput(updateRisk(payload));
    if (action === 'delete') return jsonOutput(deleteRisk(payload));

    return jsonOutput({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(SHEET_NAME);
  
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
  }

  if (sh.getLastRow() === 0) {
    sh.appendRow([
      'ID', 'Risk', 'Category', 'Owner', 'Probability', 'Impact', 'Score', 'Level',
      'Mitigation', 'Status', 'ReviewDate', 'SourceEvidence', 'LastUpdated', 'UpdatedBy'
    ]);
    sh.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff');
  }
  
  return sh;
}

function getRiskLibrary() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const libSheet = ss.getSheetByName('RiskLibrary');
  
  if (!libSheet || libSheet.getLastRow() < 2) {
    return { ok: true, items: [] };
  }
  
  const values = libSheet.getRange(2, 1, libSheet.getLastRow() - 1, 6).getValues();
  const items = values.map(r => ({
    owner: r[0] || '',
    department: r[1] || '',
    risk: r[2] || '',
    category: r[3] || '',
    defaultOwner: r[4] || '',
    defaultMitigation: r[5] || ''
  }));
  
  return { ok: true, items };
}

function levelFromScore_(score) {
  if (score >= 16) return { key: 'ext', label: 'حرج' };
  if (score >= 12) return { key: 'high', label: 'عالي' };
  if (score >= 6)  return { key: 'med', label: 'متوسط' };
  return { key: 'low', label: 'منخفض' };
}

function listRisks() {
  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  
  if (lastRow < 2) {
    return { ok: true, items: [] };
  }

  const values = sh.getRange(2, 1, lastRow - 1, 14).getValues();
  const items = values.map(r => ({
    id: r[0],
    risk: r[1],
    category: r[2],
    owner: r[3],
    probability: Number(r[4]) || 1,
    impact: Number(r[5]) || 1,
    score: Number(r[6]) || (Number(r[4]) || 1) * (Number(r[5]) || 1),
    level: r[7] || levelFromScore_((Number(r[4]) || 1) * (Number(r[5]) || 1)).label,
    mitigation: r[8],
    status: r[9],
    reviewDate: r[10],
    sourceEvidence: r[11],
    lastUpdated: r[12],
    updatedBy: r[13],
  }));

  return { ok: true, items };
}

function addRisk(p) {
  const sh = getSheet_();
  const prob = clamp_(p.probability, 1, 5);
  const impact = clamp_(p.impact, 1, 5);
  const score = prob * impact;
  const lvl = levelFromScore_(score).label;

  const id = 'R-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');

  sh.appendRow([
    id,
    p.risk || '',
    p.category || '',
    p.owner || '',
    prob,
    impact,
    score,
    lvl,
    p.mitigation || '',
    p.status || 'مفتوح',
    p.reviewDate || '',
    p.sourceEvidence || '',
    new Date().toISOString(),
    p.updatedBy || 'system'
  ]);

  return { ok: true, id };
}

function updateRisk(p) {
  const sh = getSheet_();
  const id = String(p.id || '').trim();
  
  if (!id) {
    return { ok: false, error: 'Missing id' };
  }

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { ok: false, error: 'No data' };
  }

  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(x => String(x).trim() === id);
  
  if (idx === -1) {
    return { ok: false, error: 'ID not found' };
  }

  const row = idx + 2;
  const prob = clamp_(p.probability, 1, 5);
  const impact = clamp_(p.impact, 1, 5);
  const score = prob * impact;
  const lvl = levelFromScore_(score).label;

  sh.getRange(row, 2, 1, 13).setValues([[
    p.risk || '',
    p.category || '',
    p.owner || '',
    prob,
    impact,
    score,
    lvl,
    p.mitigation || '',
    p.status || 'مفتوح',
    p.reviewDate || '',
    p.sourceEvidence || '',
    new Date().toISOString(),
    p.updatedBy || 'system'
  ]]);

  return { ok: true };
}

function deleteRisk(p) {
  const sh = getSheet_();
  const id = String(p.id || '').trim();
  
  if (!id) {
    return { ok: false, error: 'Missing id' };
  }

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { ok: false, error: 'No data' };
  }

  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(x => String(x).trim() === id);
  
  if (idx === -1) {
    return { ok: false, error: 'ID not found' };
  }

  sh.deleteRow(idx + 2);
  return { ok: true };
}

function clamp_(n, min, max) {
  n = Number(n);
  if (Number.isNaN(n)) n = min;
  return Math.max(min, Math.min(max, n));
}

function getMetrics() {
  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  
  if (lastRow < 2) {
    return { ok: true, total: 0, ext: 0, high: 0, med: 0, low: 0, open: 0, progress: 0, closed: 0 };
  }
  
  const values = sh.getRange(2, 1, lastRow - 1, 14).getValues();
  
  let stats = { total: values.length, ext: 0, high: 0, med: 0, low: 0, open: 0, progress: 0, closed: 0 };
  
  values.forEach(r => {
    const level = r[7];
    const status = r[9];
    
    if (level === 'حرج') stats.ext++;
    else if (level === 'عالي') stats.high++;
    else if (level === 'متوسط') stats.med++;
    else stats.low++;
    
    if (status === 'مغلق') stats.closed++;
    else if (status === 'قيد المعالجة') stats.progress++;
    else stats.open++;
  });
  
  return { ok: true, ...stats };
}
