/* eslint-disable */
// File: pages/api/pharmacy-rx.js
//
// Rx Analysis API — Local rules + (optional) Gemini 2.5 integration
// - Proper Files API resumable upload (start -> upload,finalize)
// - JSON structured output via responseSchema/responseMimeType
// - Multilingual (ar/en) messages
// - Robust clinical rules (no medical device; informational only)

export const config = {
  api: { bodyParser: { sizeLimit: '40mb' } } // يسمح برفع صور/PDF متوسطة الحجم
};

/* ===================== Env & Config ===================== */
const ALLOW_ORIGIN = process.env.PHARMACY_RX_ALLOW_ORIGIN || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

function cors(res, reqMethod) {
  if (!ALLOW_ORIGIN) return;
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ===================== Helpers ===================== */
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const isDataUrl = (s)=> typeof s==='string' && /^data:/.test(s);
function parseDataUrl(dataUrl) {
  // data:[<mime>][;base64],<data>
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid data URL');
  const mime = m[1];
  const buf = Buffer.from(m[2], 'base64');
  return { buffer: buf, mimeType: mime };
}
function norm(s=''){
  return String(s).toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\.\-\/\+\(\)\s]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function escapeHTML(s){
  return String(s||'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

/* ===================== Files API (resumable upload) ===================== */
/**
 * يبدأ جلسة رفع Resumable ويعيد upload URL.
 * يطابق دليل Files API (REST قسم Upload) باستخدام /upload/v1beta/files
 * المراجع الرسمية: Files API + أمثلة REST.  :contentReference[oaicite:2]{index=2}
 */
async function startResumableUpload({ apiKey, bytesLength, mimeType, displayName }) {
  const url = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytesLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: displayName || 'upload' } })
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    throw new Error(`Gemini start upload failed: ${res.status} ${txt}`);
  }
  const uploadUrl = res.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Missing x-goog-upload-url header');
  return uploadUrl;
}

async function finalizeUpload({ uploadUrl, buffer }) {
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(buffer.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: buffer
  });
  const json = await res.json().catch(()=> ({}));
  if (!res.ok || !json?.file?.uri) {
    throw new Error(`Gemini finalize upload failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.file; // { name, uri, mimeType, ... }
}

/** يرفع Buffer واحد ويعيد {uri,mimeType,name} */
async function uploadBufferToGemini({ apiKey, buffer, mimeType, displayName }) {
  const uploadUrl = await startResumableUpload({
    apiKey, bytesLength: buffer.length, mimeType, displayName
  });
  const fileMeta = await finalizeUpload({ uploadUrl, buffer });
  return { uri: fileMeta.uri, mimeType: fileMeta.mimeType || mimeType, name: fileMeta.name };
}

/** يرفع DataURL */
async function uploadDataUrlToGemini({ apiKey, dataUrl, displayName }) {
  const { buffer, mimeType } = parseDataUrl(dataUrl);
  return uploadBufferToGemini({ apiKey, buffer, mimeType, displayName });
}

/* ===================== Gemini generateContent (Structured Output) ===================== */
/**
 * نطلب من Gemini استخراج الأدوية من النصوص/الملفات (PDF/صور)
 * باستخدام responseSchema/responseMimeType JSON Mode (موثّق رسميًا). :contentReference[oaicite:3]{index=3}
 */
async function geminiExtractMeds({ apiKey, model, textBlocks = [], fileParts = [], lang='ar' }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const instruction = (lang==='ar')
    ? 'حلّل الوصفات/المرفقات واستخرج قائمة أدوية منظّمة. أعد JSON فقط دون أي نص إضافي.'
    : 'Analyze the prescriptions/attachments and extract a normalized medication list. Return JSON only, no extra prose.';

  // هيكل JSON المطلوب (مقتبس من Structured Output docs)
  const responseSchema = {
    type: 'OBJECT',
    properties: {
      meds: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            original: { type: 'STRING' },
            name:     { type: 'STRING' },           // الاسم كما يظهر
            generic:  { type: 'STRING' },           // إن أمكن
            strength: { type: 'STRING' },           // 500 mg أو 500/125 mg
            unit:     { type: 'STRING' },           // mg/mcg/g/IU
            doseText: { type: 'STRING' },           // النص الجرعي الكامل
            route:    { type: 'STRING' },           // PO/IV/IM/...
            freq:     { type: 'STRING' },           // مرة يومياً، bid، tid...
            prn:      { type: 'BOOLEAN' },
          },
          propertyOrdering: ['original','name','generic','strength','unit','doseText','route','freq','prn']
        }
      },
      notes: { type: 'ARRAY', items: { type: 'STRING' } }
    },
    propertyOrdering: ['meds','notes']
  };

  // نبني parts: الملفات أولاً ثم النص والتعليمات
  const fileDataParts = fileParts.map(p => ({
    file_data: { mime_type: p.mimeType, file_uri: p.uri }
  }));
  const textPart = { text: [instruction].concat(textBlocks).join('\n\n') };

  const body = {
    contents: [{ role:'user', parts: [...fileDataParts, textPart] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema
    }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(()=> ({}));
  if (!res.ok) {
    throw new Error(`Gemini generateContent failed: ${res.status} ${JSON.stringify(json)}`);
  }
  // القيمة عادة داخل candidates[0].content.parts[].text
  const text = json?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('') || '';
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  return parsed; // { meds: [...], notes: [...] }
}

/* ===================== Minimal lexicon + rules (مختصر) ===================== */
const DRUGS = {
  aspirin: { synonyms: ['asa','acetylsalicylic','أسبرين','اسبرين'], classes:['ANTIPLATELET','NSAID'] },
  warfarin: { synonyms: ['coumadin','وارفارين','كومادين'], classes:['OAC'] },
  apixaban: { synonyms: ['eliquis','أبيكسابان'], classes:['OAC'] },
  rivaroxaban: { synonyms: ['xarelto','ريفاروكسابان'], classes:['OAC'] },
  dabigatran: { synonyms: ['pradaxa','دابيغاتران'], classes:['OAC'] },
  edoxaban: { synonyms: ['savaysa','إدوكسابان'], classes:['OAC'] },

  amlodipine: { synonyms: ['norvasc','أملوديبين'], classes:['CCB'] },
  valsartan: { synonyms: ['فالسارتان'], classes:['ARB'] },
  losartan: { synonyms: ['لوسارتان'], classes:['ARB'] },
  lisinopril: { synonyms: ['ليزينوبريل'], classes:['ACEI'] },
  hydrochlorothiazide: { synonyms:['hct','hctz','هيدروكلوروثيازيد'], classes:['DIURETIC'] },
  'amlodipine/valsartan': { synonyms:['exforge','أملوديبين/فالسارتان'], classes:['CCB','ARB'] },

  rosuvastatin: { synonyms:['crestor','روزوفاستاتين'], classes:['STATIN'] },
  atorvastatin: { synonyms:['lipitor','أتورفاستاتين'], classes:['STATIN'] },

  metformin: { synonyms:['glucophage','ميتفورمين','metformin xr','glucophage xr'], classes:['BIGUANIDE'] },
  'gliclazide mr': { synonyms:['diamicron mr','جليكلازايد mr'], classes:['SU'] },
  sitagliptin: { synonyms:['januvia','سيتاجلبتين'], classes:['DPP4'] },

  pantoprazole: { synonyms:['protonix','بانتوبرازول'], classes:['PPI'] },
  esomeprazole: { synonyms:['nexium','إيزوميبرازول'], classes:['PPI'] },

  ibuprofen: { synonyms:['advil','brufen','ايبوبروفين'], classes:['NSAID'] },
  diclofenac: { synonyms:['voltaren','ديكلوفيناك'], classes:['NSAID'] },

  tamsulosin: { synonyms:['flomax','تامسولوسين'], classes:['ALPHA_BLOCKER'] },
  'dutasteride/tamsulosin': { synonyms:['duodart','jalyn','ديوادارت'], classes:['5ARI','ALPHA_BLOCKER'] },

  nitroglycerin: { synonyms:['glyceryl trinitrate','نترات الغليسيريل'], classes:['NITRATE'] },
  sildenafil: { synonyms:['viagra','سيلدينافيل'], classes:['PDE5'] },
  spironolactone: { synonyms:['aldactone','سبيرونولاكتون'], classes:['K_SPARING'] },

  paracetamol: { synonyms:['acetaminophen','باراسيتامول','panadol','بنادول'], classes:['ANALGESIC'] }
};
const CANON = Object.keys(DRUGS);
function mapToCanonical(s){
  const n = norm(s);
  for (const k of CANON) if (n.includes(k)) return k;
  for (const k of CANON) if (DRUGS[k].synonyms.some(x=> n.includes(norm(x)))) return k;
  return null;
}
function classOf(k){ return k && DRUGS[k] ? DRUGS[k].classes : []; }
function toMg(str){
  if(!str) return null;
  const m = String(str).match(/(\d+(?:\.\d+)?)\s*(mg|g|mcg)\b/i);
  if(!m) return null;
  const val = parseFloat(m[1]); const unit = m[2].toLowerCase();
  if (unit==='mg') return val;
  if (unit==='g') return val*1000;
  if (unit==='mcg') return val/1000;
  return null;
}

/* === مصادر طبية للاقتباس في التقرير (اختصار) === */
const SOURCES = {
  FDA_NSAID_20W: {
    title: 'FDA: Avoid NSAIDs ≥20 weeks pregnancy',
    url: 'https://www.fda.gov/drugs/drug-safety-and-availability/fda-recommends-avoiding-use-nsaids-pregnancy-20-weeks-or-later-because-they-can-result-low-amniotic'
  }, // NSAIDs ≥20w. :contentReference[oaicite:4]{index=4}
  ADA_MET_EGFR_2025: {
    title: 'ADA Standards: Metformin & eGFR',
    url: 'https://diabetesjournals.org/care/article/48/Supplement_1/S239/157554/11-Chronic-Kidney-Disease-and-Risk-Management'
  }, // Metformin <30. :contentReference[oaicite:5]{index=5}
  DAILYMED_ROSU_RENAL: {
    title: 'DailyMed: Rosuvastatin dosing in severe renal impairment',
    url: 'https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?setid=3bf80420-7482-44c0-a117-30793ba89544&type=pdf'
  }, // Rosuvastatin max 10mg severe renal. :contentReference[oaicite:6]{index=6}
  FDA_SILD_NIT: {
    title: 'FDA label: Sildenafil + nitrates contraindicated',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/021845s025lbl.pdf'
  }, // Contraindicated. :contentReference[oaicite:7]{index=7}
  NKF_NSAID_CKD: {
    title: 'National Kidney Foundation: Avoid NSAIDs in CKD',
    url: 'https://www.kidney.org/kidney-topics/pain-medicines-and-kidney-disease'
  }, // NSAIDs in CKD. :contentReference[oaicite:8]{index=8}
  KDIGO_ACE_ARB_AVOID: {
    title: 'KDIGO: Avoid ACEi + ARB combo',
    url: 'https://kdigo.org/wp-content/uploads/2016/10/KDIGO_BP_Exec_Summary_final.pdf'
  } // ACEi+ARB. :contentReference[oaicite:9]{index=9}
};

const SEV = {
  CRIT: { code: 'CRIT', color: '#DC2626', emoji:'🟥' },
  HIGH: { code: 'HIGH', color: '#F97316', emoji:'🟧' },
  MOD:  { code: 'MOD',  color: '#059669', emoji:'🟩' },
  INFO: { code: 'INFO', color: '#0284C7', emoji:'🔵' },
};

function sevBadge(sev){ return `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:9999px;font-weight:700;color:#fff;background:${sev.color};font-size:12px;">${sev.emoji} ${sev.code}</span>`; }

/* ===================== Rules (نماذج رئيسية) ===================== */
function hasAny(meds, keys){ return meds.some(m => keys.includes(m.canonical)); }
function findOne(meds, key){ return meds.find(m => m.canonical === key); }

function R_aspirin_with_OAC(ctx, lang){
  const oac = ['warfarin','apixaban','rivaroxaban','dabigatran','edoxaban'];
  if (hasAny(ctx.meds, ['aspirin']) && hasAny(ctx.meds, oac)) {
    return {
      sev: SEV.HIGH,
      title: lang==='ar'?'تداخل مهم: أسبرين + مضاد تخثر':'Major interaction: Aspirin + OAC',
      message: lang==='ar'?'يزيد خطر النزف؛ راجع الاستطباب والجرعة والمراقبة.':'Bleeding risk increased; reassess indication, dose, monitoring.',
      refs: ['FDA_WARFARIN_BLEED'] // (اختصار: نفس المصدر العام)
    };
  }
  return null;
}
function R_pregnancy_nsaids(ctx, lang){
  const preg = ctx.conditions?.pregnancy;
  const weeks = preg?.weeks;
  const hasNSAID = ctx.meds.some(m => m.classes.includes('NSAID'));
  if (preg?.pregnant && weeks!=null && weeks>=20 && hasNSAID){
    return {
      sev: SEV.CRIT,
      title: lang==='ar'?'حمل ≥20 أسبوعاً + NSAIDs (تجنّب)':'Pregnancy ≥20w + NSAIDs (avoid)',
      message: lang==='ar'?'مخاطر كلوية جنينية ونقص السائل الأمنيوسي.':'Fetal renal/oligohydramnios risk.',
      refs: ['FDA_NSAID_20W']
    };
  }
  return null;
}
function R_ckd_nsaids(ctx, lang){
  const egfr = ctx.conditions?.eGFR;
  const stage = egfr==null? null : (egfr<15?5: egfr<30?4: egfr<60?3:2);
  const hasNsaid = ctx.meds.some(m => m.classes.includes('NSAID'));
  if (stage && stage>=3 && hasNsaid){
    return {
      sev: stage>=4? SEV.HIGH : SEV.MOD,
      title: lang==='ar'?'CKD وNSAIDs':'CKD + NSAIDs',
      message: lang==='ar'?'تُتجنّب NSAIDs في CKD خاصة المراحل المتقدمة.':'Avoid NSAIDs in CKD, esp. advanced.',
      refs: ['NKF_NSAID_CKD']
    };
  }
  return null;
}
function R_metformin_egfr(ctx, lang){
  const hasMet = hasAny(ctx.meds, ['metformin']);
  const egfr = ctx.conditions?.eGFR;
  if (!hasMet || egfr==null) return null;
  if (egfr<30) return {
    sev: SEV.CRIT,
    title: lang==='ar'?'ميتفورمين: eGFR < 30 (ممنوع)':'Metformin: eGFR <30 (contraindicated)',
    message: lang==='ar'?'أوقف/لا تبدأ.':'Stop/Do not initiate.',
    refs: ['ADA_MET_EGFR_2025']
  };
  if (egfr>=30 && egfr<45) return {
    sev: SEV.HIGH,
    title: lang==='ar'?'ميتفورمين: تقليل الجرعة (30–44)':'Metformin: reduce dose (30–44)',
    message: lang==='ar'?'حدّ الجرعة وراقب الوظائف.':'Limit dose, monitor renal function.',
    refs: ['ADA_MET_EGFR_2025']
  };
  return null;
}
function R_rosu_renal(ctx, lang){
  const r = findOne(ctx.meds,'rosuvastatin');
  const egfr = ctx.conditions?.eGFR;
  if (r && egfr!=null && egfr<30 && (!r.doseMg || r.doseMg>10)){
    return {
      sev: SEV.HIGH,
      title: lang==='ar'?'روزوفاستاتين والقصور الكلوي':'Rosuvastatin in severe renal impairment',
      message: lang==='ar'?'ابدأ 5 mg ولا تتجاوز 10 mg يومياً.':'Start 5 mg, do not exceed 10 mg/day.',
      refs: ['DAILYMED_ROSU_RENAL']
    };
  }
  return null;
}
function R_pde5_nitrates(ctx, lang){
  const hasPDE5 = ctx.meds.some(m => m.classes.includes('PDE5'));
  const hasNit  = ctx.meds.some(m => m.classes.includes('NITRATE'));
  if (hasPDE5 && hasNit){
    return {
      sev: SEV.CRIT,
      title: lang==='ar'?'نترات + PDE5 (ممنوع)':'Nitrates + PDE5 (contraindicated)',
      message: lang==='ar'?'خطر هبوط ضغط شديد.':'Severe hypotension risk.',
      refs: ['FDA_SILD_NIT']
    };
  }
  return null;
}
const RULES = [ R_aspirin_with_OAC, R_pregnancy_nsaids, R_ckd_nsaids, R_metformin_egfr, R_rosu_renal, R_pde5_nitrates ];

/* ===================== Render HTML ===================== */
function renderHTML({ lang, meds, findings, patient, refs }){
  const rtl = lang==='ar';
  const t = (ar,en)=> (lang==='ar'?ar:en);
  const css = `
  <style>
    .rx-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,'Amiri',serif;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:16px;direction:${rtl?'rtl':'ltr'}}
    .rx-title{font-size:20px;font-weight:800;margin:12px 0;color:#0b63c2}
    .rx-table{width:100%;border-collapse:separate;border-spacing:0 8px}
    .rx-row{background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,0.06)}
    .rx-cell{padding:12px 14px;vertical-align:top}
    .rx-head{font-size:12px;color:#6b7280}
    .rx-drug{font-weight:800}
    .rx-note{font-size:14px;line-height:1.55}
    .pill{display:inline-block;background:#eef2ff;color:#334155;border:1px solid #e5e7eb;padding:4px 8px;border-radius:999px;font-weight:700;font-size:12px}
    .refs a{color:#0b63c2;text-decoration:none;border-bottom:1px dashed #93c5fd}
  </style>`;
  const pt = patient||{};
  const patientGrid = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:6px 0 14px">
      <div><span class="pill">${t('العمر','Age')}:</span> ${pt.age ?? '—'}</div>
      <div><span class="pill">${t('الجنس','Sex')}:</span> ${pt.sex || '—'}</div>
      <div><span class="pill">eGFR:</span> ${pt.eGFR ?? '—'}</div>
      <div><span class="pill">${t('الحمل','Pregnancy')}:</span> ${pt.pregnancy?.pregnant ? t('نعم','Yes') : t('لا','No')}</div>
    </div>`;
  const medsRows = (meds||[]).map(m => `
    <tr class="rx-row">
      <td class="rx-cell rx-drug">${escapeHTML(m.canonical || m.name)}${m.doseText?` — <span style="color:#475569">${escapeHTML(m.doseText)}</span>`:''}</td>
      <td class="rx-cell rx-note">${escapeHTML(m.original||'')}</td>
    </tr>`).join('');
  const fxRows = (findings||[]).map(f => {
    const links = (f.refs||[]).map(k => refs[k]? `<a target="_blank" rel="noopener" href="${refs[k].url}">${escapeHTML(refs[k].title)}</a>` : '').filter(Boolean).join(' • ');
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
      <thead><tr><th class="rx-cell rx-head">${t('الدواء','Drug')}</th><th class="rx-cell rx-head">${t('السطر الأصلي/ملاحظة','Original Line / Note')}</th></tr></thead>
      <tbody>${medsRows || `<tr class="rx-row"><td class="rx-cell" colspan="2">—</td></tr>`}</tbody>
    </table>

    <div class="rx-title" style="margin-top:18px">⚠️ ${t('التحذيرات والتداخلات','Alerts & Interactions')}</div>
    <table class="rx-table">
      <thead><tr><th class="rx-cell rx-head">${t('العنوان','Title')}</th><th class="rx-cell rx-head">${t('التفاصيل / المستوى','Details / Severity')}</th></tr></thead>
      <tbody>${fxRows || `<tr class="rx-row"><td class="rx-cell" colspan="2">${t('لا توجد ملاحظات حرجة بناءً على القواعد الحالية.','No critical findings based on current rules.')}</td></tr>`}</tbody>
    </table>

    <div class="rx-note" style="margin-top:8px">${t('* هذا التقرير مرجعي ولا يُعد نصيحة طبية.','* Informational only; not medical advice.')}</div>
  </div>`;
}

/* ===================== Main Handler ===================== */
export default async function handler(req, res) {
  try {
    cors(res, req.method);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'method_not_allowed' });

    const {
      useGemini = false,     // شغّل التكامل مع Gemini
      texts = [],            // array of strings (قد تكون أسطر أدوية)
      images = [],           // DataURLs (صور/‏PDF) أو URLs عامة
      patient = {},          // { age, sex, eGFR, pregnancy:{pregnant,weeks}, liver?, apapDailyMg? ... }
      lang = 'ar'
    } = req.body || {};

    // 1) تجهيز خطوط/مرفقات للـGemini (اختياري)
    let fileParts = [];
    if (useGemini && images?.length) {
      if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
      for (let i=0;i<images.length;i++){
        const item = images[i];
        try {
          if (isDataUrl(item)) {
            const meta = await uploadDataUrlToGemini({ apiKey: GEMINI_API_KEY, dataUrl: item, displayName: `rx_${i}` });
            fileParts.push(meta);
          } else if (typeof item === 'string' && /^https?:\/\//.test(item)) {
            // fetch الصورة/الـPDF ورفعها كـ buffer
            const rr = await fetch(item); const buf = Buffer.from(await rr.arrayBuffer());
            // تقدير mime من الهيدر أو URL
            const mime = rr.headers.get('content-type') || (item.endsWith('.pdf')?'application/pdf':'image/jpeg');
            const meta = await uploadBufferToGemini({ apiKey: GEMINI_API_KEY, buffer: buf, mimeType: mime, displayName: `rx_${i}` });
            fileParts.push(meta);
          }
          await sleep(50);
        } catch (e) {
          // نتجاوز الملف الفاشل ونكمل
          console.warn('Gemini upload failed for item', i, e.message);
        }
      }
    }

    // 2) استخراج قائمة الأدوية
    let extracted = { meds: [], notes: [] };
    if (useGemini) {
      // generateContent مع schema (JSON Mode). راجع توثيق generateContent/structured output. :contentReference[oaicite:10]{index=10}
      extracted = await geminiExtractMeds({
        apiKey: GEMINI_API_KEY,
        model: GEMINI_MODEL,
        textBlocks: texts,
        fileParts,
        lang
      });
    } else {
      // تحليل بسيط من النصوص مباشرة (بدون LLM)
      const lines = (texts||[]).join('\n').split(/\r?\n+/).map(s=>s.trim()).filter(Boolean);
      extracted.meds = lines.map(line => ({
        original: line,
        name: line.replace(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu)\b/ig,'').trim(),
        strength: (line.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu)\b/i)?.[0]||''),
        doseText: (line.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu)\b(.*)$/i)?.[0]||'')
      }));
    }

    // 3) تطبيع للأدوية + حساب mg + الفئات
    const meds = (extracted.meds||[]).map(m => {
      const nm = m.generic || m.name || m.original || '';
      const canonical = mapToCanonical(nm);
      return {
        original: m.original || m.name || '',
        name: nm,
        canonical,
        classes: canonical? classOf(canonical) : [],
        doseText: m.doseText || m.strength || '',
        doseMg: toMg(m.strength || m.doseText)
      };
    }).filter(m => m.name);

    // 4) بناء السياق وتطبيق القواعد
    const conditions = {
      pregnancy: patient?.pregnancy || null,
      eGFR: typeof patient?.eGFR==='number' ? patient.eGFR : null
    };
    const ctx = { meds, conditions };
    const findings = [];
    for (const rule of RULES){
      const r = rule(ctx, lang);
      if (r) findings.push(r);
    }

    // 5) HTML
    const html = renderHTML({
      lang,
      meds,
      findings,
      patient: { age: patient?.age, sex: patient?.sex, eGFR: conditions.eGFR, pregnancy: conditions.pregnancy },
      refs: SOURCES
    });

    return res.status(200).json({
      ok: true,
      provider: useGemini ? 'gemini' : 'local',
      model: useGemini ? GEMINI_MODEL : null,
      meds, findings, html,
      refs: SOURCES,
      filesUsed: fileParts
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:'analysis_failed', message: e?.message || 'Internal error' });
  }
}
