/* eslint-disable */
// File: pages/api/pharmacy-rx.js
//
// Advanced Rx Analysis Engine (AR/EN) — Next.js API Route
// Features:
// - Optional OCR from images (OCR.space via API key, or Tesseract if enabled)
// - Robust drug name normalization (EN/AR), fuzzy matching, brand→generic mapping
// - Dose parsing (mg, g, mcg, IU; combos like 500/125 mg), once-daily etc. (light parsing)
// - Clinical rules with severities & inline reputable references (FDA/KDIGO/ADA/ACOG/NKF/LactMed)
// - CKD staging from eGFR, hepatic impairment flags, pregnancy (weeks), lactation
// - Class duplication/contraindication checks (e.g., ACEi+ARB, PDE5+nitrates)
// - Clean HTML report (RTL/LTR aware) returned under `html`
// - Safe-by-default: graceful failure if OCR unavailable
//
// IMPORTANT DISCLAIMER:
// This software is NOT a medical device and NOT a substitute for clinician judgment.
// Always verify with local guidelines/labels and the patient’s specific context.

/* ============================ Config ============================ */

export const config = {
  api: {
    bodyParser: { sizeLimit: '20mb' },
  },
};

// OCR providers
const USE_OCRSPACE = !!process.env.OCRSPACE_API_KEY;
const OCRSPACE_API_KEY = process.env.OCRSPACE_API_KEY || '';
const TESSERACT_ENABLED = process.env.TESSERACT_ENABLED === '1';

// Optional CORS (set PHARMACY_RX_ALLOW_ORIGIN="*")
const ALLOW_ORIGIN = process.env.PHARMACY_RX_ALLOW_ORIGIN || '';

/* ============================ Reputable Sources (inline citations) ============================ */
// Each rule attaches keys from here in `refs: ['FDA_NSAID_20W', ...]`.
// We keep titles concise and stable.

const SOURCES = {
  FDA_NSAID_20W: {
    title: 'FDA: Avoid NSAIDs ≥20 weeks of pregnancy (low amniotic fluid)',
    url: 'https://www.fda.gov/drugs/drug-safety-and-availability/fda-recommends-avoiding-use-nsaids-pregnancy-20-weeks-or-later-because-they-can-result-low-amniotic',
  }, // :contentReference[oaicite:0]{index=0}
  ADA_MET_EGFR_2025: {
    title: 'ADA Standards of Care (2025): Metformin contraindicated if eGFR <30',
    url: 'https://diabetesjournals.org/care/article/48/Supplement_1/S239/157554/11-Chronic-Kidney-Disease-and-Risk-Management',
  }, // :contentReference[oaicite:1]{index=1}
  DAILYMED_ROSU_RENAL: {
    title: 'DailyMed: Rosuvastatin — start 5 mg; max 10 mg in severe renal impairment',
    url: 'https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?setid=3bf80420-7482-44c0-a117-30793ba89544&type=pdf',
  }, // :contentReference[oaicite:2]{index=2}
  FDA_SILD_LABEL_NITRATES: {
    title: 'FDA label: Sildenafil — concomitant nitrates contraindicated',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/021845s025lbl.pdf',
  }, // :contentReference[oaicite:3]{index=3}
  FDA_SILD_LABEL_ALPHA: {
    title: 'FDA label: Sildenafil — caution with alpha-blockers (hypotension)',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2014/20895s039s042lbl.Pdf',
  }, // :contentReference[oaicite:4]{index=4}
  LACTMED_IBUPROFEN: {
    title: 'LactMed: Ibuprofen compatible with breastfeeding; preferred NSAID',
    url: 'https://www.ncbi.nlm.nih.gov/books/NBK500986/',
  }, // :contentReference[oaicite:5]{index=5}
  NKF_NSAID_CKD: {
    title: 'National Kidney Foundation: CKD patients should avoid NSAIDs (eGFR<60)',
    url: 'https://www.kidney.org/kidney-topics/pain-medicines-and-kidney-disease',
  }, // :contentReference[oaicite:6]{index=6}
  KDIGO_ACE_ARB_AVOID: {
    title: 'KDIGO: Avoid combination therapy ACEi + ARB (or + DRI) in CKD',
    url: 'https://kdigo.org/wp-content/uploads/2016/10/KDIGO_BP_Exec_Summary_final.pdf',
  }, // :contentReference[oaicite:7]{index=7}
  FDA_SPIRONOLACTONE_HYPERK: {
    title: 'FDA label: Spironolactone — hyperkalemia risk ↑ with ACEi/ARB & CKD',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2018/012151s075lbl.pdf',
  }, // :contentReference[oaicite:8]{index=8}
  NHS_APAP_MAX_4G: {
    title: 'NHS patient info: Paracetamol adult maximum 4,000 mg within 24h',
    url: 'https://www.royalberkshire.nhs.uk/media/vg0a2q1d/pain-relief-after-birth.pdf',
  }, // :contentReference[oaicite:9]{index=9}
  FDA_WARFARIN_BLEED: {
    title: 'FDA Coumadin label: drugs incl. antiplatelets ↑ bleeding risk with warfarin',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2011/009218s107lbl.pdf',
  }, // :contentReference[oaicite:10]{index=10}
  DOAC_BLEED_EDOX: {
    title: 'FDA Savaysa (edoxaban) label: bleeding risk; ↑ with antiplatelets/aspirin',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/206316Orig1s020lbl.pdf',
  }, // :contentReference[oaicite:11]{index=11}
  ACOG_LOWDose_ASP: {
    title: 'ACOG: Low‑dose aspirin 81 mg/day for preeclampsia prophylaxis (selected patients)',
    url: 'https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2018/07/low-dose-aspirin-use-during-pregnancy',
  }, // :contentReference[oaicite:12]{index=12}
  ACC_COMBO_NONSTATIN: {
    title: 'ACC: For further LDL‑C lowering, add nonstatin (ezetimibe/PCSK9) rather than dual statins',
    url: 'https://www.acc.org/Latest-in-Cardiology/Articles/2022/06/01/12/11/Why-Combination-Lipid-Lowering-Therapy-Should-be-Considered',
  }, // :contentReference[oaicite:13]{index=13}
  ADA_OLDER_HYPO: {
    title: 'ADA: Hypoglycemia risk is higher with sulfonylureas in older adults',
    url: 'https://diabetesjournals.org/care/article/47/Supplement_1/S244/153944/13-Older-Adults-Standards-of-Care-in-Diabetes-2024',
  }, // :contentReference[oaicite:14]{index=14}
};

/* ============================ Utilities ============================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickLang(req) {
  const bodyLang = (req.body && req.body.lang) || '';
  if (bodyLang === 'en' || bodyLang === 'ar') return bodyLang;
  const accept = String(req.headers['accept-language'] || '').toLowerCase();
  return accept.includes('ar') ? 'ar' : 'en';
}

const SEV = {
  CRIT: { code: 'CRIT', color: '#DC2626', emoji: '🟥' }, // Critical / Contraindicated
  HIGH: { code: 'HIGH', color: '#F97316', emoji: '🟧' }, // Major
  MOD:  { code: 'MOD',  color: '#059669', emoji: '🟩' }, // Moderate / Caution
  INFO: { code: 'INFO', color: '#0284C7', emoji: '🔵' }, // Info
};

function norm(s = '') {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\.\-\/\+\(\)\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function softNormalizeLine(s = '') {
  return String(s)
    .replace(/[^\w\u0600-\u06FF\.\-\/\s\+]/g, ' ')
    .replace(/(\d)\s*(mg|mcg|g|iu)\b/ig, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
    }
  }
  return m[a.length][b.length];
}
function sim(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

function parseDose(line) {
  // returns { doseText, mg, unit, combo:[{mg,unit},...]}  (light heuristic)
  const out = { doseText: '', mg: null, unit: '', combo: [] };
  const mgRe = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu)\b/ig;
  let m; const hits = [];
  while ((m = mgRe.exec(line))) hits.push({ val: parseFloat(m[1]), unit: m[2].toLowerCase(), raw: m[0] });
  if (!hits.length) return out;
  // handle combos like 500/125 mg
  const slash = line.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (slash && hits.length === 1) {
    const unit = hits[0].unit;
    out.combo = [
      { mg: toMg(parseFloat(slash[1]), unit), unit },
      { mg: toMg(parseFloat(slash[2]), unit), unit },
    ];
    out.mg = out.combo.reduce((a, b) => a + (b.mg || 0), 0);
    out.unit = 'mg';
  } else {
    // take the first mg-like value as primary
    const first = hits[0];
    out.mg = toMg(first.val, first.unit);
    out.unit = 'mg';
  }
  out.doseText = hits.map(h => h.raw).join(' / ');
  return out;
}
function toMg(val, unit) {
  unit = (unit || 'mg').toLowerCase();
  if (unit === 'mg') return val;
  if (unit === 'g') return val * 1000;
  if (unit === 'mcg') return val / 1000;
  return null; // IU varies per drug
}

/* ============================ Lexicon & Mapping ============================ */

const DRUGS = {
  // canonical: { synonyms:[], classes:[], notes }
  aspirin: { synonyms: ['asa', 'acetylsalicylic', 'أسبرين', 'اسبرين'], classes: ['ANTIPLATELET', 'NSAID'] },
  warfarin: { synonyms: ['coumadin', 'وارفارين', 'كومادين'], classes: ['OAC'] },
  apixaban: { synonyms: ['eliquis', 'أبيكسابان', 'إليكويس'], classes: ['OAC'] },
  rivaroxaban: { synonyms: ['xarelto', 'ريفاروكسابان', 'زاريلتو'], classes: ['OAC'] },
  dabigatran: { synonyms: ['pradaxa', 'دابيغاتران', 'براداكسا'], classes: ['OAC'] },
  edoxaban: { synonyms: ['savaysa', 'إدوكسابان', 'سافيسا'], classes: ['OAC'] },

  amlodipine: { synonyms: ['norvasc', 'أملوديبين'], classes: ['CCB'] },
  valsartan: { synonyms: ['فالسارتان'], classes: ['ARB'] },
  losartan: { synonyms: ['لوسارتان'], classes: ['ARB'] },
  olmesartan: { synonyms: ['أولميسارتان'], classes: ['ARB'] },
  candesartan: { synonyms: ['كانديسارتان'], classes: ['ARB'] },
  lisinopril: { synonyms: ['ليزينوبريل'], classes: ['ACEI'] },
  perindopril: { synonyms: ['بيريندوبريل'], classes: ['ACEI'] },
  ramipril: { synonyms: ['راميبريل'], classes: ['ACEI'] },

  hydrochlorothiazide: { synonyms: ['hct', 'hctz', 'هيدروكلوروثيازيد'], classes: ['DIURETIC'] },
  'amlodipine/valsartan': { synonyms: ['exforge', 'أملوديبين/فالسارتان'], classes: ['CCB','ARB'] },
  'amlodipine/valsartan/hydrochlorothiazide': { synonyms: ['exforge hct'], classes: ['CCB','ARB','DIURETIC'] },

  rosuvastatin: { synonyms: ['crestor', 'روزوفاستاتين', 'rozavi'], classes: ['STATIN'] },
  atorvastatin: { synonyms: ['lipitor', 'أتورفاستاتين'], classes: ['STATIN'] },
  simvastatin: { synonyms: ['زوكور', 'simva'], classes: ['STATIN'] },
  pravastatin: { synonyms: ['pravachol'], classes: ['STATIN'] },

  metformin: { synonyms: ['glucophage', 'ميتفورمين', 'metformin xr', 'glucophage xr'], classes: ['BIGUANIDE'] },
  'gliclazide mr': { synonyms: ['diamicron mr', 'جليكلازايد mr'], classes: ['SU'] },
  sitagliptin: { synonyms: ['januvia', 'سيتاجلبتين'], classes: ['DPP4'] },

  pantoprazole: { synonyms: ['protonix', 'بانتوبرازول', 'pantomax'], classes: ['PPI'] },
  esomeprazole: { synonyms: ['nexium', 'إيزوميبرازول'], classes: ['PPI'] },

  ibuprofen: { synonyms: ['advil', 'brufen', 'ايبوبروفين'], classes: ['NSAID'] },
  diclofenac: { synonyms: ['voltaren', 'ديكلوفيناك'], classes: ['NSAID'] },

  tamsulosin: { synonyms: ['flomax', 'تامسولوسين'], classes: ['ALPHA_BLOCKER'] },
  'dutasteride/tamsulosin': { synonyms: ['duodart', 'jalyn', 'ديوادارت'], classes: ['5ARI','ALPHA_BLOCKER'] },

  nitroglycerin: { synonyms: ['glyceryl trinitrate', 'نترات الغليسيريل'], classes: ['NITRATE'] },
  sildenafil: { synonyms: ['viagra', 'سيلدينافيل'], classes: ['PDE5'] },
  tadalafil: { synonyms: ['cialis', 'تادالافيل'], classes: ['PDE5'] },

  spironolactone: { synonyms: ['aldactone', 'سبيرونولاكتون'], classes: ['K_SPARING'] },

  paracetamol: { synonyms: ['acetaminophen', 'باراسيتامول', 'بنادول', 'panadol'], classes: ['ANALGESIC'] },
};

const CANON_KEYS = Object.keys(DRUGS);

function mapToCanonical(raw) {
  const n = norm(raw);
  // Exact contains canonical key?
  for (const key of CANON_KEYS) {
    if (n.includes(key)) return key;
  }
  // Contains any synonym?
  for (const key of CANON_KEYS) {
    for (const syn of DRUGS[key].synonyms) {
      if (n.includes(norm(syn))) return key;
    }
  }
  // Fuzzy to canonical keys
  let best = { key: null, score: 0 };
  for (const key of CANON_KEYS) {
    const score = sim(n, key);
    if (score > best.score) best = { key, score };
  }
  return best.score >= 0.82 ? best.key : null;
}

function classOf(key) {
  return key && DRUGS[key] ? DRUGS[key].classes || [] : [];
}

function splitLines(text = '') {
  if (!text) return [];
  const lines = text
    .split(/\r?\n+/)
    .map(softNormalizeLine)
    .map(applyCorrections)
    .filter(Boolean);
  // unique
  const seen = new Set(); const out = [];
  for (const l of lines) { const k = l.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(l); } }
  return out;
}

/* ============================ OCR corrections & brand fixes ============================ */
const OCR_CORRECTIONS = [
  [/^amilodipin(e)?\b/i, 'amlodipine'], [/\bamlodipin\b/i, 'amlodipine'],
  [/\brozavi\b/i, 'rosuvastatin'], [/\bcrestor\b/i, 'rosuvastatin'],
  [/\batorva(statin)?\b/i, 'atorvastatin'],
  [/\bduodart\b/i, 'dutasteride/tamsulosin'], [/\bjalyn\b/i, 'dutasteride/tamsulosin'],
  [/\btams?ulosin\b/i, 'tamsulosin'],
  [/\bglucophage(\s*xr)?\b/i, 'metformin xr'],
  [/\b(formet|formot)\s*xr?\s*([0-9]+)\b/i, (m,_,d)=> `metformin xr ${d} mg`],
  [/\bmetfor(r|rn?in)\b/i, 'metformin'],
  [/\bdiam?icron\s*mr?\s*([0-9]+)?\b/i, (m,d)=> `gliclazide mr ${d?d+' mg':''}`.trim()],
  [/\bgliclazide\s*m(r)?\b/i, 'gliclazide mr'],
  [/\bsita(gliptin)?\b/i, 'sitagliptin'],
  [/\bpanto(max|prazole)\b/i, 'pantoprazole'], [/\bnexium\b/i, 'esomeprazole'],
  [/\bparacetam(o|a)l\b/i, 'paracetamol'], [/\bacetaminophen\b/i, 'paracetamol'],
  [/\bibu(profen)?\b/i, 'ibuprofen'], [/\bdiclofenac\b/i, 'diclofenac'],
  [/\b(hct|hctz)\b/i, 'hydrochlorothiazide'],
  [/\bexforge(\s*hct)?\b/i, (m,h)=> h? 'amlodipine/valsartan/hydrochlorothiazide' : 'amlodipine/valsartan'],

  // Arabic
  [/أملود?ي?بين/gi, 'amlodipine'],
  [/روزوفاستاتين/gi, 'rosuvastatin'], [/أتورفاستاتين/gi, 'atorvastatin'],
  [/ديوادارت/gi, 'dutasteride/tamsulosin'], [/تامسولوسين/gi, 'tamsulosin'],
  [/ميتفورمين/gi, 'metformin'], [/جليك?لازايد\s*ام\s*ار/gi, 'gliclazide mr'],
  [/بانتوبرازول/gi, 'pantoprazole'], [/اي?بوبروفين/gi, 'ibuprofen'],
  [/ديكلوفيناك/gi, 'diclofenac'],
  [/فالسارتان\s*\/?\s*ه?ي?در?و?كلوروثيازيد/gi, 'amlodipine/valsartan/hydrochlorothiazide'],
];

function applyCorrections(line) {
  let out = ' ' + softNormalizeLine(line) + ' ';
  for (const [re, rep] of OCR_CORRECTIONS) out = out.replace(re, rep);
  // Add missing "mg" for common drugs when number present
  out = out.replace(/\b(amlodipine|rosuvastatin|atorvastatin|gliclazide mr|metformin( xr)?)\s+(\d+)\b/gi,
    (m,drug, xr, dose)=> `${drug} ${dose} mg`);
  return out.trim();
}

/* ============================ OCR (optional) ============================ */

let Tesseract = null;
try {
  if (!USE_OCRSPACE && TESSERACT_ENABLED) {
    // Lazy load only if enabled
    // Note: in Node, tesseract.js may require extra native deps for best performance.
    Tesseract = await import('tesseract.js').then(m => m.default || m).catch(() => null);
  }
} catch { /* ignore */ }

async function ocrWithOcrSpace(image) {
  // image: base64 dataURL or HTTP(S) URL
  const isUrl = /^https?:\/\//i.test(image);
  const form = new URLSearchParams();
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'false');
  form.append('scale', 'true');
  form.append('OCREngine', '2');
  if (isUrl) form.append('url', image);
  else form.append('base64Image', image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { apikey: OCRSPACE_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ParsedResults?.length) throw new Error('OCR.space failed');
    return (j.ParsedResults.map(x => x.ParsedText || '').join('\n')).trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function ocrWithTesseract(image) {
  if (!Tesseract) return '';
  let img = image;
  if (!/^data:/.test(img) && /^https?:\/\//.test(img)) {
    const rr = await fetch(img); const buf = Buffer.from(await rr.arrayBuffer());
    img = 'data:image/jpeg;base64,' + buf.toString('base64');
  }
  const { data } = await Tesseract.recognize(img, 'eng+ara', { tessedit_pageseg_mode: 6 });
  return (data?.text || '').trim();
}

async function extractTextFromImages(images = []) {
  const chunks = [];
  for (const img of images) {
    try {
      const txt = USE_OCRSPACE ? await ocrWithOcrSpace(img) : await ocrWithTesseract(img);
      if (txt) chunks.push(txt);
      await sleep(80);
    } catch { /* ignore failed image and continue */ }
  }
  return chunks.join('\n').trim();
}

/* ============================ Parsing meds from lines ============================ */

function parseLinesToMeds(allLines = []) {
  const meds = [];
  for (const raw of allLines) {
    const line = applyCorrections(raw);
    if (!line) continue;

    const dose = parseDose(line);
    const namePart = line.replace(dose.doseText, '').trim().replace(/[–—-]+$/, '').trim();
    const canonical = mapToCanonical(namePart);

    meds.push({
      original: raw,
      line: line,
      name: namePart || raw,
      canonical: canonical,
      classes: canonical ? classOf(canonical) : [],
      dose: dose.doseText || null,
      doseMg: dose.mg,
    });
  }
  // de-duplicate by canonical+mg if canonical known, else by normalized line
  const seen = new Set(); const out = [];
  for (const m of meds) {
    const key = m.canonical ? `${m.canonical}|${m.doseMg||''}` : `raw|${norm(m.line)}`;
    if (!seen.has(key)) { seen.add(key); out.push(m); }
  }
  return out;
}

/* ============================ CKD staging & helpers ============================ */

function ckdStageFromEgfr(e) {
  if (typeof e !== 'number' || isNaN(e)) return null;
  if (e < 15) return 5;
  if (e < 30) return 4;
  if (e < 60) return 3;
  if (e < 90) return 2;
  return 1;
}
const hasAny = (arr, keys) => arr.some(m => keys.includes(m.canonical));
const findOne = (arr, key) => arr.find(m => m.canonical === key);
const totalDailyApapMg = (patient) => (typeof patient?.apapDailyMg === 'number' ? patient.apapDailyMg : null);

/* ============================ Rules Engine ============================ */
// Each rule returns either null or { code, sev, title, message, refs:[keys], tags:[...]}.
// Language-aware titles/messages.

function R_aspirin_with_OAC(ctx, lang) {
  const hasAsp = hasAny(ctx.meds, ['aspirin']);
  const hasOAC = hasAny(ctx.meds, ['warfarin','apixaban','rivaroxaban','dabigatran','edoxaban']);
  if (!hasOAC) return null;
  if (hasAsp) {
    return {
      code: 'ASPIRIN_OAC',
      sev: SEV.HIGH,
      refs: ['FDA_WARFARIN_BLEED','DOAC_BLEED_EDOX'],
      title: lang==='ar' ? 'تداخل مهم: أسبرين + مضاد تخثر' : 'Major interaction: Aspirin + Oral Anticoagulant',
      message: lang==='ar'
        ? 'الاشتراك يزيد خطر النزف بشكل ملحوظ؛ راجع الضرورة/الجرعة وخطّة الوقاية والمتابعة.'
        : 'Combination substantially increases bleeding risk; reassess indication/dose and monitoring plan.',
      tags: ['bleeding']
    };
  }
  return {
    code: 'OAC_NO_ASP_INFO',
    sev: SEV.INFO,
    refs: ['FDA_WARFARIN_BLEED'],
    title: lang==='ar' ? 'تنبيه: مضاد تخثر فموي' : 'Info: Patient on OAC',
    message: lang==='ar'
      ? 'تجنّب إضافة الأسبرين بدون استطباب واضح (يزيد خطر النزف).'
      : 'Avoid adding aspirin without a clear indication (bleeding risk).',
    tags: ['bleeding']
  };
}

function R_pregnancy_nsaids(ctx, lang) {
  const preg = ctx.conditions?.pregnancy;
  if (!preg?.pregnant) return null;
  const weeks = typeof preg.weeks === 'number' ? preg.weeks : null;
  const hasNSAID = ctx.meds.some(m => m.classes.includes('NSAID'));
  const asp = findOne(ctx.meds, 'aspirin');
  const aspMg = asp?.doseMg || null;

  if (weeks != null && weeks >= 20 && hasNSAID) {
    return {
      code: 'PREG_NSAID_20W',
      sev: SEV.CRIT,
      refs: ['FDA_NSAID_20W'],
      title: lang==='ar' ? 'حمل ≥20 أسبوعًا وNSAIDs (تجنُّب)' : 'Pregnancy ≥20 weeks + NSAIDs (avoid)',
      message: lang==='ar'
        ? 'تجنّب NSAIDs بعد الأسبوع 20 بسبب مخاطر كلوية جنينية ونقص السائل الأمنيوسي.'
        : 'Avoid NSAIDs at ≥20 weeks due to fetal renal injury/oligohydramnios risk.',
      tags: ['pregnancy','nsaids']
    };
  }
  if (asp) {
    if (aspMg && aspMg > 150) {
      return {
        code: 'PREG_ASP_HIGH',
        sev: SEV.HIGH,
        refs: ['FDA_NSAID_20W'],
        title: lang==='ar' ? 'أسبرين عالي الجرعة أثناء الحمل' : 'High‑dose aspirin in pregnancy',
        message: lang==='ar'
          ? 'جرعات الأسبرين العالية غير مفضلة عموماً أثناء الحمل؛ راجع الإيقاف/التعديل.'
          : 'High‑dose aspirin is generally undesirable in pregnancy; consider stopping/adjusting.',
        tags: ['pregnancy','bleeding']
      };
    }
    return {
      code: 'PREG_ASP_LOW',
      sev: SEV.MOD,
      refs: ['ACOG_LOWDose_ASP'],
      title: lang==='ar' ? 'أسبرين منخفض الجرعة أثناء الحمل' : 'Low‑dose aspirin in pregnancy',
      message: lang==='ar'
        ? 'قد يُستعمل 81 mg/يوم في حالات مختارة للوقاية من ما قبل تسمم الحمل وتحت إشراف نسائي.'
        : '81 mg/day may be used in selected patients for preeclampsia prophylaxis under obstetric guidance.',
      tags: ['pregnancy']
    };
  }
  return null;
}

function R_ckd_nsaids_asp(ctx, lang) {
  const eGFR = ctx.conditions?.eGFR;
  const stage = ctx.conditions?.ckdStage || ckdStageFromEgfr(eGFR);
  if (!stage || stage < 3) return null;
  const hasNSAID = ctx.meds.some(m => m.classes.includes('NSAID'));
  if (hasNSAID) {
    return {
      code: 'CKD_NSAID',
      sev: stage >= 4 ? SEV.HIGH : SEV.MOD,
      refs: ['NKF_NSAID_CKD'],
      title: lang==='ar' ? 'مرض كلوي مزمن وNSAIDs' : 'CKD + NSAIDs',
      message: lang==='ar'
        ? 'تُتجنب NSAIDs في CKD خصوصاً المراحل المتقدمة؛ قد ترفع الضغط وتضعف وظائف الكلى.'
        : 'Avoid NSAIDs in CKD (especially advanced); they may worsen renal function and raise BP.',
      tags: ['ckd','nsaids']
    };
  }
  const asp = findOne(ctx.meds,'aspirin'); const d = asp?.doseMg;
  if (asp && d && d > 81) {
    return {
      code: 'CKD_ASP_DOSE',
      sev: SEV.MOD,
      refs: ['NKF_NSAID_CKD'],
      title: lang==='ar' ? 'أسبرين وCKD' : 'Aspirin in CKD',
      message: lang==='ar'
        ? 'الجرعات الأعلى من المنخفضة قد لا تُفضل في CKD؛ راجع الجرعة/البدائل ومراقبة النزف.'
        : 'Above‑low doses may be undesirable in CKD; consider dose reduction/alternatives with bleeding monitoring.',
      tags: ['ckd','bleeding']
    };
  }
  return null;
}

function R_liver(ctx, lang) {
  if (!ctx.conditions?.liverDisease) return null;
  const hasAsp = hasAny(ctx.meds, ['aspirin']);
  if (hasAsp) {
    return {
      code: 'LIVER_ASP',
      sev: SEV.HIGH,
      refs: [],
      title: lang==='ar' ? 'أسبرين ومرض كبدي' : 'Aspirin with hepatic disease',
      message: lang==='ar'
        ? 'خطر النزف قد يرتفع مع اضطراب التخثر؛ أكّد الضرورة والجرعة والمراقبة.'
        : 'Bleeding risk may increase with coagulopathy—verify indication, dose, and monitoring.',
      tags: ['liver','bleeding']
    };
  }
  return {
    code: 'LIVER_INFO',
    sev: SEV.INFO,
    refs: [],
    title: lang==='ar' ? 'تنبيه كبدي عام' : 'General hepatic caution',
    message: lang==='ar'
      ? 'مع المرض الكبدي، استخدم أقل جرعة ومدة ممكنة وفكّر ببدائل أكثر أماناً.'
      : 'In liver disease, prefer the lowest effective dose and consider safer alternatives.',
    tags: ['liver']
  };
}

function R_dual_RAS(ctx, lang) {
  const medsCanon = ctx.meds.map(m => m.canonical).filter(Boolean);
  const hasACE = medsCanon.some(k => DRUGS[k]?.classes?.includes('ACEI'));
  const hasARB = medsCanon.some(k => DRUGS[k]?.classes?.includes('ARB'));
  if (hasACE && hasARB) {
    return {
      code: 'ACEI_ARB_AVOID',
      sev: SEV.HIGH,
      refs: ['KDIGO_ACE_ARB_AVOID'],
      title: lang==='ar' ? 'تجنّب الجمع بين ACEi وARB' : 'Avoid ACEi + ARB combination',
      message: lang==='ar'
        ? 'الجمع يزيد مخاطر فرط بوتاسيوم والفشل الكلوي دون فائدة واضحة.'
        : 'Combination increases hyperkalemia/renal risk without clear benefit.',
      tags: ['ckd','hyperkalemia']
    };
  }
  return null;
}

function R_hyperK_risk(ctx, lang) {
  const medsCanon = ctx.meds.map(m => m.canonical).filter(Boolean);
  const hasRAS = medsCanon.some(k => DRUGS[k]?.classes?.includes('ACEI') || DRUGS[k]?.classes?.includes('ARB'));
  const hasSpir = medsCanon.includes('spironolactone');
  const egfr = ctx.conditions?.eGFR;
  if (hasRAS && hasSpir && egfr != null && egfr < 60) {
    return {
      code: 'HYPERK_RISK',
      sev: SEV.HIGH,
      refs: ['FDA_SPIRONOLACTONE_HYPERK'],
      title: lang==='ar' ? 'خطر فرط بوتاسيوم الدم' : 'Hyperkalemia risk',
      message: lang==='ar'
        ? 'الجمع مع قصور كلوي يزيد خطر فرط بوتاسيوم؛ راجع الضرورة والجرعات ومراقبة K+ مبكراً ومتكرراً.'
        : 'RAS blocker + spironolactone in CKD raises hyperkalemia risk; reassess need/doses and monitor K+ closely.',
      tags: ['hyperkalemia','ckd']
    };
  }
  return null;
}

function R_pde5_nitrates(ctx, lang) {
  const hasPDE5 = ctx.meds.some(m => m.classes.includes('PDE5'));
  const hasNit = ctx.meds.some(m => m.classes.includes('NITRATE'));
  if (hasPDE5 && hasNit) {
    return {
      code: 'PDE5_NITRATES',
      sev: SEV.CRIT,
      refs: ['FDA_SILD_LABEL_NITRATES'],
      title: lang==='ar' ? 'تداخل خطير: نترات + مثبّط PDE5' : 'Contraindication: Nitrates + PDE5 inhibitor',
      message: lang==='ar'
        ? 'هبوط ضغط شديد/إغماء: يُمنع الجمع تماماً.'
        : 'Severe hypotension risk: concomitant use is contraindicated.',
      tags: ['hypotension']
    };
  }
  // alpha-blocker caution
  const hasAlpha = ctx.meds.some(m => m.classes.includes('ALPHA_BLOCKER'));
  if (hasPDE5 && hasAlpha) {
    return {
      code: 'PDE5_ALPHA_CAUT',
      sev: SEV.MOD,
      refs: ['FDA_SILD_LABEL_ALPHA'],
      title: lang==='ar' ? 'حذر: PDE5 مع حاصرات ألفا' : 'Caution: PDE5 with alpha‑blocker',
      message: lang==='ar'
        ? 'خطر هبوط ضغط ودوخة؛ ابدأ بجرعات منخفضة وتباعد التناول عند اللزوم.'
        : 'Orthostatic hypotension possible; start low and separate dosing if needed.',
      tags: ['hypotension']
    };
  }
  return null;
}

function R_metformin_egfr(ctx, lang) {
  const hasMet = ctx.meds.some(m => m.canonical && m.canonical.startsWith('metformin'));
  const egfr = ctx.conditions?.eGFR;
  if (!hasMet || egfr == null) return null;
  if (egfr < 30) {
    return {
      code: 'MET_CONTRA_EGFR',
      sev: SEV.CRIT,
      refs: ['ADA_MET_EGFR_2025'],
      title: lang==='ar' ? 'ميتفورمين: eGFR < 30 (مضاد استطباب)' : 'Metformin: eGFR <30 (contraindicated)',
      message: lang==='ar'
        ? 'أوقف/لا تبدأ الميتفورمين؛ اتبع بدائل مناسبة ومراقبة.'
        : 'Stop/Do not initiate metformin; consider alternatives and monitoring.',
      tags: ['ckd','metformin']
    };
  }
  if (egfr >= 30 && egfr < 45) {
    return {
      code: 'MET_REDUCE_EGFR',
      sev: SEV.HIGH,
      refs: ['ADA_MET_EGFR_2025'],
      title: lang==='ar' ? 'ميتفورمين: خفّض الجرعة (eGFR 30–44)' : 'Metformin: reduce dose (eGFR 30–44)',
      message: lang==='ar'
        ? 'حدّ الجرعة وراقب الوظائف ونقص B12 على المدى البعيد.'
        : 'Limit dose and monitor renal function and B12 longer‑term.',
      tags: ['ckd','metformin']
    };
  }
  return null;
}

function R_rosu_renal(ctx, lang) {
  const rosu = findOne(ctx.meds, 'rosuvastatin');
  const egfr = ctx.conditions?.eGFR;
  if (!rosu || egfr == null) return null;
  if (egfr < 30 && (!rosu.doseMg || rosu.doseMg > 10)) {
    return {
      code: 'ROSU_MAX10',
      sev: SEV.HIGH,
      refs: ['DAILYMED_ROSU_RENAL'],
      title: lang==='ar' ? 'روزوفاستاتين والقصور الكلوي' : 'Rosuvastatin in severe renal impairment',
      message: lang==='ar'
        ? 'يوصى بالبدء 5 mg وألا تتجاوز 10 mg يومياً.'
        : 'Start 5 mg and do not exceed 10 mg/day in severe renal impairment.',
      tags: ['ckd','statin']
    };
  }
  return null;
}

function R_su_elderly(ctx, lang) {
  const hasSU = ctx.meds.some(m => m.classes.includes('SU'));
  if (!hasSU) return null;
  const age = ctx.demographics?.age || null;
  const egfr = ctx.conditions?.eGFR;
  if ((age && age >= 65) || (egfr != null && egfr < 60)) {
    return {
      code: 'SU_HYPO',
      sev: SEV.HIGH,
      refs: ['ADA_OLDER_HYPO'],
      title: lang==='ar' ? 'سلفونيل يوريا وكبار السن/CKD' : 'Sulfonylurea in older adults/CKD',
      message: lang==='ar'
        ? 'خطر هبوط سكر أعلى؛ فكّر ببدائل أقل خطراً وتخفيض الجرعات ومراقبة لصيقة.'
        : 'Higher hypoglycemia risk; consider safer alternatives, dose reduction, and close monitoring.',
      tags: ['hypoglycemia']
    };
  }
  return null;
}

function R_dual_statins(ctx, lang) {
  const statins = ctx.meds.filter(m => m.classes.includes('STATIN'));
  if (statins.length >= 2) {
    return {
      code: 'DUAL_STATINS',
      sev: SEV.MOD,
      refs: ['ACC_COMBO_NONSTATIN'],
      title: lang==='ar' ? 'تنبيه: استعمال مُثبتين للدهون (Statins) معاً' : 'Alert: Dual statins in regimen',
      message: lang==='ar'
        ? 'عادةً لا يُفضّل دمج استاتينين؛ إن لزم خفض LDL أكثر فالتوصيات تميل لإضافة دواء غير استاتيني (مثل إيزيتيمايب/PCSK9).'
        : 'Using two statins together is generally not recommended; guidelines favor adding a nonstatin (ezetimibe/PCSK9) for additional LDL‑C lowering.',
      tags: ['statin']
    };
  }
  return null;
}

function R_apap_daily(ctx, lang) {
  const total = totalDailyApapMg(ctx.demographicsRaw); // we keep original patient object for this
  if (total && total > 4000) {
    return {
      code: 'APAP_MAX_EXCEEDED',
      sev: SEV.HIGH,
      refs: ['NHS_APAP_MAX_4G'],
      title: lang==='ar' ? 'جرعة باراسيتامول اليومية تتجاوز 4000 mg' : 'Paracetamol daily dose > 4000 mg',
      message: lang==='ar'
        ? 'تجاوز الحد الأعلى المعتاد للبالغين (قد يضرّ الكبد). راجع الجرعات والمستحضرات المشتركة.'
        : 'Exceeds typical adult maximum; hepatotoxicity risk—review dosing and combination products.',
      tags: ['liver','paracetamol']
    };
  }
  return null;
}

// Collect rules
const RULES = [
  R_aspirin_with_OAC,
  R_pregnancy_nsaids,
  R_ckd_nsaids_asp,
  R_liver,
  R_dual_RAS,
  R_hyperK_risk,
  R_pde5_nitrates,
  R_metformin_egfr,
  R_rosu_renal,
  R_su_elderly,
  R_dual_statins,
  R_apap_daily,
];

/* ============================ HTML rendering ============================ */

function sevBadge(sev) {
  return `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:9999px;font-weight:700;color:#fff;background:${sev.color};font-size:12px;">${sev.emoji} ${sev.code}</span>`;
}

function renderHTML({ lang, meds, findings, patient, sources }) {
  const rtl = lang === 'ar';
  const t = (ar, en) => (lang==='ar' ? ar : en);
  const css = `
  <style>
  .rx-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,'Amiri',serif;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:16px;direction:${rtl?'rtl':'ltr'}}
  .rx-title{font-size:20px;font-weight:800;margin:12px 0;color:#0b63c2}
  .rx-table{width:100%;border-collapse:separate;border-spacing:0 8px}
  .rx-row{background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,0.06)}
  .rx-cell{padding:12px 14px;vertical-align:top}
  .rx-head{font-size:12px;color:#6b7280;letter-spacing:.02em}
  .rx-drug{font-weight:800}
  .rx-note{font-size:14px;line-height:1.55}
  .rx-muted{font-size:12px;color:#374151;margin:8px 0 0}
  .pill{display:inline-block;background:#eef2ff;color:#334155;border:1px solid #e5e7eb;padding:4px 8px;border-radius:999px;font-weight:700;font-size:12px}
  .refs a{color:#0b63c2;text-decoration:none;border-bottom:1px dashed #93c5fd}
  </style>`;

  const pt = patient || {};
  const patientGrid = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:10px 0">
      <div><span class="pill">${t('العمر','Age')}:</span> ${pt.age ?? '—'}</div>
      <div><span class="pill">${t('الجنس','Sex')}:</span> ${pt.sex || '—'}</div>
      <div><span class="pill">eGFR:</span> ${pt.eGFR ?? '—'}</div>
      <div><span class="pill">${t('وظائف الكبد','Liver')}:</span> ${pt.liverDisease? t('قصور/مرض','Impaired') : t('سليم','Normal')}</div>
      ${pt.pregnancy? `<div><span class="pill">${t('الحمل','Pregnancy')}:</span> ${pt.pregnancy.pregnant?t('نعم','Yes'):t('لا','No')} ${pt.pregnancy.weeks?`(${pt.pregnancy.weeks} ${t('أسبوع','wk')})`:''}</div>`:''}
    </div>
  `;

  const medsRows = (meds||[]).map(m => `
    <tr class="rx-row">
      <td class="rx-cell rx-drug">${escapeHTML(m.canonical || m.name)}${m.dose?` — <span style="color:#475569">${escapeHTML(m.dose)}</span>`:''}</td>
      <td class="rx-cell rx-note">${escapeHTML(m.original)}</td>
    </tr>`).join('');

  const fxRows = (findings||[]).map(f => {
    const links = (f.refs||[]).map(k => sources[k] ? `<a href="${sources[k].url}" target="_blank" rel="noopener">${escapeHTML(sources[k].title)}</a>` : '').filter(Boolean).join(' • ');
    return `
      <tr class="rx-row">
        <td class="rx-cell rx-drug">${escapeHTML(f.title)}</td>
        <td class="rx-cell rx-note">${sevBadge(f.sev)}<div style="height:6px"></div>${escapeHTML(f.message)}${links?`<div class="refs" style="margin-top:6px">${links}</div>`:''}</td>
      </tr>`;
  }).join('');

  return `
  ${css}
  <div class="rx-wrap">
    <div class="rx-title">${t('🧾 قائمة الأدوية','🧾 Medication List')}</div>
    ${patientGrid}
    <table class="rx-table">
      <thead>
        <tr><th class="rx-cell rx-head">${t('الدواء','Drug')}</th><th class="rx-cell rx-head">${t('السطر الأصلي/ملاحظة','Original Line / Note')}</th></tr>
      </thead>
      <tbody>${medsRows || `<tr class="rx-row"><td class="rx-cell" colspan="2">—</td></tr>`}</tbody>
    </table>

    <div class="rx-title" style="margin-top:20px">⚠️ ${t('التحذيرات والتداخلات','Alerts & Interactions')}</div>
    <table class="rx-table">
      <thead>
        <tr><th class="rx-cell rx-head">${t('العنوان','Title')}</th><th class="rx-cell rx-head">${t('التفاصيل / المستوى','Details / Severity')}</th></tr>
      </thead>
      <tbody>${fxRows || `<tr class="rx-row"><td class="rx-cell" colspan="2">${t('لا توجد ملاحظات حرجة بناءً على القواعد الحالية.','No critical findings based on current rules.')}</td></tr>`}</tbody>
    </table>

    <div class="rx-muted">${t('الأساطير اللونية:','Severity legend:')} 🟥 ${t('شديد جداً','Critical')}, 🟧 ${t('عالٍ','High')}, 🟩 ${t('متوسط/حذر','Moderate/Caution')}, 🔵 ${t('تنبيه','Info')}.</div>
    <div class="rx-muted" style="margin-top:6px">${t('* هذا التقرير مرجعي ولا يغني عن حكم الطبيب.','* This report is informational and not a substitute for clinical judgment.')}</div>
  </div>`;
}

/* ============================ API Handler ============================ */

export default async function handler(req, res) {
  try {
    if (ALLOW_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
      res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const lang = pickLang(req);

    const {
      texts = [],          // array of strings (each line or paragraph)
      images = [],         // array of dataURLs or URLs
      patient = {},        // { age, sex:'M|F', eGFR, ckdStage, liverDisease:bool, pregnancy:{pregnant:true,weeks}, lactation:{breastfeeding:true}, apapDailyMg }
      demographics = {},   // legacy alias
      labs = {},           // optional structured labs { K, ALT, AST, INR, ... }  (reserved for future rules)
    } = req.body || {};

    // 1) OCR from images (optional)
    let ocrText = '';
    if (Array.isArray(images) && images.length) {
      ocrText = await extractTextFromImages(images);
    }

    // 2) Collect lines (text + OCR), normalize & deduplicate
    const linesFromOCR = splitLines(ocrText);
    const linesFromTexts = splitLines((texts || []).join('\n'));
    const allLines = [...linesFromOCR, ...linesFromTexts];

    // 3) Parse to meds
    const meds = parseLinesToMeds(allLines);

    // 4) Build context
    const eGFR = (typeof patient?.eGFR === 'number' ? patient.eGFR : null);
    const conditions = {
      pregnancy: patient?.pregnancy || null,
      eGFR,
      ckdStage: patient?.ckdStage || (eGFR!=null ? ckdStageFromEgfr(eGFR) : null),
      liverDisease: !!patient?.liverDisease || (patient?.liver && patient.liver !== 'normal'),
      lactation: !!(patient?.lactation?.breastfeeding || patient?.lactation === true),
    };
    const demo = {
      age: patient?.age || demographics?.age || null,
      sex: patient?.sex || demographics?.sex || null,
      weightKg: patient?.weight || demographics?.weightKg || null,
    };

    const ctx = { meds, conditions, demographics: demo, demographicsRaw: patient };

    // 5) Apply rules
    const findings = [];
    for (const rule of RULES) {
      try {
        const r = rule(ctx, lang);
        if (r) findings.push(r);
      } catch { /* continue */ }
    }

    // 6) Report HTML
    const html = renderHTML({
      lang,
      meds,
      findings,
      patient: { age: demo.age, sex: demo.sex, eGFR: conditions.eGFR, liverDisease: conditions.liverDisease, pregnancy: conditions.pregnancy },
      sources: SOURCES
    });

    // 7) Build response
    const resp = {
      ok: true,
      lang,
      meds,
      findings,
      patient: { ...patient, ckdStage: conditions.ckdStage },
      refs: SOURCES,
      html,
      raw: { ocrText, linesFromOCR, linesFromTexts, labsUsed: labs }
    };

    return res.status(200).json(resp);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'analysis_failed', message: e?.message || 'Internal error' });
  }
}
