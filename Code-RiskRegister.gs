/**
 * Risk Register API - Makkah Medical Complex (Al Zaher)
 * Spreadsheet: 12rii0-wE4jXD2NHS6n_6vutMiPOkTkv-A8WrCqlPo6A
 * Sheets:
 *  - RiskRegister (Data)
 *  - RiskLibrary  (Risk templates: Risk | Category | DefaultOwner | DefaultMitigation)
 *  - Master       (Owners/Departments: Owner | Department)
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
const SHEET_NAME = 'RiskRegister';
const LIB_SHEET = 'RiskLibrary';
const MASTER_SHEET = 'Master';

const WRITE_TOKEN = '';

function doGet(e) {
  const action = String(e?.parameter?.action || '').toLowerCase();

  if (action === 'list') return jsonOutput(listRisks());
  if (action === 'metrics') return jsonOutput(getMetrics());
  if (action === 'library') return jsonOutput(getRiskLibrary());
  if (action === 'master') return jsonOutput(getMasterList());

  return jsonOutput({
    ok: true,
    message: 'Risk Register API. Use ?action=list | metrics | library | master'
  });
}

function doPost(e) {
  try {
    const body = e.postData?.contents ? JSON.parse(e.postData.contents) : {};
    const action = String(body.action || '').toLowerCase();
    const payload = body.payload || {};

    if (WRITE_TOKEN && String(payload.token || '') !== WRITE_TOKEN) {
      return jsonOutput({ ok: false, error: 'Unauthorized' });
    }

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
  if (!sh) sh = ss.insertSheet(SHEET_NAME);

  if (sh.getLastRow() === 0) {
    sh.appendRow([
      'ID', 'Risk', 'Category', 'Owner', 'Probability', 'Impact', 'Score', 'Level',
      'Mitigation', 'Status', 'ReviewDate', 'SourceEvidence', 'LastUpdated', 'UpdatedBy'
    ]);
    sh.getRange(1, 1, 1, 14)
      .setFontWeight('bold')
      .setBackground('#1e3a5f')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getLibSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(LIB_SHEET);
}

function getMasterSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(MASTER_SHEET);
}

function clamp_(n, min, max) {
  n = Number(n);
  if (Number.isNaN(n)) n = min;
  return Math.max(min, Math.min(max, n));
}

function levelFromScore_(score) {
  if (score >= 16) return { key: 'ext', label: 'حرج' };
  if (score >= 12) return { key: 'high', label: 'عالي' };
  if (score >= 6)  return { key: 'med', label: 'متوسط' };
  return { key: 'low', label: 'منخفض' };
}

function findRowById_(sh, id) {
  const finder = sh.createTextFinder(id).matchEntireCell(true).findNext();
  return finder ? finder.getRow() : -1;
}

function listRisks() {
  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };

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

function getMetrics() {
  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { ok: true, total: 0, ext: 0, high: 0, med: 0, low: 0, open: 0, progress: 0, closed: 0 };
  }

  const values = sh.getRange(2, 1, lastRow - 1, 14).getValues();
  const stats = { total: values.length, ext: 0, high: 0, med: 0, low: 0, open: 0, progress: 0, closed: 0 };

  values.forEach(r => {
    const level = String(r[7] || '').trim();
    const status = String(r[9] || '').trim();

    if (level === 'حرج') stats.ext++;
    else if (level === 'عالي') stats.high++;
    else if (level === 'متوسط') stats.med++;
    else stats.low++;

    if (status === 'مغلق') stats.closed++;
    else if (status === 'قيد المعالجة' || status === 'قيد التنفيذ') stats.progress++;
    else stats.open++;
  });

  return { ok: true, ...stats };
}

function getRiskLibrary() {
  const lib = getLibSheet_();
  if (!lib || lib.getLastRow() < 2) return { ok: true, items: [] };

  const values = lib.getRange(2, 1, lib.getLastRow() - 1, 4).getValues();
  const items = values
    .filter(r => String(r[0] || '').trim())
    .map(r => ({
      risk: String(r[0] || '').trim(),
      category: String(r[1] || '').trim(),
      defaultOwner: String(r[2] || '').trim(),
      defaultMitigation: String(r[3] || '').trim(),
    }));

  return { ok: true, items };
}

function getMasterList() {
  const sh = getMasterSheet_();
  if (!sh || sh.getLastRow() < 2) return { ok: true, owners: [], departments: [], pairs: [] };

  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  const pairs = values
    .filter(r => String(r[0] || '').trim())
    .map(r => ({ owner: String(r[0] || '').trim(), department: String(r[1] || '').trim() }));

  const owners = Array.from(new Set(pairs.map(p => p.owner))).sort();
  const departments = Array.from(new Set(pairs.map(p => p.department).filter(Boolean))).sort();

  return { ok: true, owners, departments, pairs };
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
    String(p.risk || ''),
    String(p.category || ''),
    String(p.owner || ''),
    prob,
    impact,
    score,
    lvl,
    String(p.mitigation || ''),
    String(p.status || 'مفتوح'),
    String(p.reviewDate || ''),
    String(p.sourceEvidence || ''),
    new Date().toISOString(),
    String(p.updatedBy || 'system')
  ]);

  return { ok: true, id };
}

function updateRisk(p) {
  const sh = getSheet_();
  const id = String(p.id || '').trim();
  if (!id) return { ok: false, error: 'Missing id' };

  const row = findRowById_(sh, id);
  if (row === -1) return { ok: false, error: 'ID not found' };

  const prob = clamp_(p.probability, 1, 5);
  const impact = clamp_(p.impact, 1, 5);
  const score = prob * impact;
  const lvl = levelFromScore_(score).label;

  sh.getRange(row, 2, 1, 13).setValues([[
    String(p.risk || ''),
    String(p.category || ''),
    String(p.owner || ''),
    prob,
    impact,
    score,
    lvl,
    String(p.mitigation || ''),
    String(p.status || 'مفتوح'),
    String(p.reviewDate || ''),
    String(p.sourceEvidence || ''),
    new Date().toISOString(),
    String(p.updatedBy || 'system')
  ]]);

  return { ok: true };
}

function deleteRisk(p) {
  const sh = getSheet_();
  const id = String(p.id || '').trim();
  if (!id) return { ok: false, error: 'Missing id' };

  const row = findRowById_(sh, id);
  if (row === -1) return { ok: false, error: 'ID not found' };

  sh.deleteRow(row);
  return { ok: true };
}
