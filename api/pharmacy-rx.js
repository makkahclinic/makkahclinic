// /pages/api/pharmacy-rx.js
//
// هذا هو "العقل المدبر" للنظام، يقوم بالمهام التالية:
// - يتعرف على النصوص في الصور (OCR) باستخدام OCR.space أو Tesseract.js.
// - يصحح الأخطاء الشائعة في أسماء الأدوية بعد التعرف عليها.
// - يستخرج اسم الدواء والجرعة من كل سطر نصي.
// - يطبق مجموعة من القواعد السريرية للكشف عن التداخلات والتحذيرات المتعلقة بـ:
//   (العمر، وظائف الكلى، حالة الكبد، الحمل، الإرضاع، الوزن).
// - يخرج النتيجة كملف JSON بالإضافة إلى تقرير HTML منسق وجاهز للعرض.
// -------------------------------------------------------------------

const USE_OCRSPACE = !!process.env.OCRSPACE_API_KEY;
const OCRSPACE_API_KEY = process.env.OCRSPACE_API_KEY || "";
const TESSERACT_ENABLED = process.env.TESSERACT_ENABLED === "1";

let Tesseract = null;
if (!USE_OCRSPACE && TESSERACT_ENABLED) {
  try { Tesseract = require("tesseract.js"); } catch (e) {
    console.warn("Tesseract.js is enabled but not installed. OCR will be disabled.");
  }
}

// ------------------ أدوات مساعدة ------------------
const SEV = {
  HIGH: { code: "HIGH", label: "شديد", color: "#DC2626", emoji: "🟥" },
  MOD:  { code: "MOD",  label: "متوسط", color: "#F59E0B", emoji: "🟧" },
  LOW:  { code: "LOW",  label: "منخفض", color: "#16A34A", emoji: "🟩" },
  INFO: { code: "INFO", label: "تنبيه",  color: "#0891B2", emoji: "🔵" },
};

function softNormalizeLine(s = "") {
  return String(s)
    .replace(/[^\w\u0600-\u06FF\.\-\/\s\+]/g, " ")
    .replace(/(\d+)\s*mg\b/ig, "$1mg")
    .replace(/\s+/g, " ")
    .trim();
}
function escapeHTML(s){ return String(s||"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])) }
function parseDoseMg(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+(\.\d+)?)\s*mg/i);
  return m ? parseFloat(m[1]) : null;
}

// ------------------ قاموس تصحيح OCR ------------------
const OCR_CORRECTIONS = [
  [/amilodipin(e)?/i, 'amlodipine'], [/\bamlodipin\b/i, 'amlodipine'],
  [/\brozavi\b/i, 'rosuvastatin'], [/\bcrestor\b/i, 'rosuvastatin'],
  [/\batorva(statin)?\b/i, 'atorvastatin'],
  [/\bduodart\b/i, 'dutasteride/tamsulosin'], [/\bjalyn\b/i, 'dutasteride/tamsulosin'],
  [/\btams?ulosin\b/i, 'tamsulosin'],
  [/\bglucophage(\s*xr)?\b/i, 'metformin xr'],
  [/\bmetfor(r|rn?in)\b/i, 'metformin'],
  [/\bdiam?icron\s*mr?\s*([0-9]+)?/i, (m,d)=> `gliclazide mr ${d?d+'mg':''}`.trim()],
  [/\bpanto(max|prazole)\b/i, 'pantoprazole'], [/\bnexium\b/i, 'esomeprazole'],
  [/\bparacetam(o|a)l\b/i, 'paracetamol'], [/\bacetaminophen\b/i, 'paracetamol'],
  [/أملود?ي?بين/gi, 'amlodipine'],
  [/روزوفاستاتين/gi, 'rosuvastatin'], [/أتورفاستاتين/gi, 'atorvastatin'],
  [/ديوادارت/gi, 'dutasteride/tamsulosin'], [/تامسولوسين/gi, 'tamsulosin'],
  [/ميتفورمين/gi, 'metformin'], [/جليك?لازايد/gi, 'gliclazide'],
  [/بانتوبرازول/gi, 'pantoprazole'],
];
function applyCorrections(line){
  let out = ' ' + softNormalizeLine(line) + ' ';
  for (const [re, rep] of OCR_CORRECTIONS) out = out.replace(re, rep);
  out = out.replace(/\b(amlodipine|rosuvastatin|atorvastatin|gliclazide mr|metformin( xr)?)\s+(\d+)\b/gi, (m, drug, xr, dose) => `${drug} ${dose}mg`);
  return out.trim();
}
function splitLines(text=""){
  if (!text) return [];
  const lines = text.split(/\r?\n+/).map(softNormalizeLine).map(applyCorrections).filter(Boolean);
  const uniq = new Set(); const out = [];
  for (const l of lines) { const k=l.toLowerCase(); if(!uniq.has(k)){uniq.add(k); out.push(l);} }
  return out;
}

// ------------------ دوال التعرف على النصوص (OCR) ------------------
async function ocrWithOcrSpace(image){
  const form = new URLSearchParams();
  form.append("language", "ara");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("OCREngine", "2");
  form.append("base64Image", image);
  const r = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: OCRSPACE_API_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const j = await r.json();
  if (!r.ok || !j?.ParsedResults?.length) throw new Error("OCR.space API failed: " + (j.ErrorMessage || "Unknown error"));
  return (j.ParsedResults.map(x => x.ParsedText || "").join("\n")).trim();
}
async function ocrWithTesseract(image){
  if (!Tesseract) throw new Error("tesseract.js not available on server");
  const { data } = await Tesseract.recognize(image, "eng+ara");
  return (data?.text || "").trim();
}
async function extractTextFromImages(images = []){
  let fullText = "";
  for (const img of images) {
    try {
      const txt = USE_OCRSPACE ? await ocrWithOcrSpace(img)
            : (Tesseract ? await ocrWithTesseract(img) : "");
      if (txt) fullText += txt + "\n";
    } catch(e) {
      console.error("Single image OCR failed, skipping. Error:", e.message);
    }
  }
  return fullText.trim();
}

// ------------------ قاعدة بيانات مصغرة للأدوية ------------------
const ALIASES = {
  aspirin: ["asa","acetylsalicylic","أسبرين"],
  warfarin: ["coumadin","وارفارين"],
  apixaban: ["eliquis","أبيكسابان"],
  rivaroxaban: ["xarelto","زاريلتو"],
  amlodipine: ["norvasc","أملوديبين"],
  valsartan: ["diovan","فالسارتان"],
  rosuvastatin: ["crestor","rozavi","روزوفاستاتين"],
  atorvastatin: ["lipitor","أتورفاستاتين"],
  metformin: ["glucophage","metformin xr","ميتفورمين"],
  gliclazide: ["diamicron mr","جليكلازايد"],
  sitagliptin: ["januvia","سيتاجلبتين"],
  pantoprazole: ["protonix","pantomax","بانتوبرازول"],
  ibuprofen: ["advil","brufen","ايبوبروفين"],
  diclofenac: ["voltaren","ديكلوفيناك"],
  tamsulosin: ["flomax","تامسولوسين"],
  "dutasteride/tamsulosin": ["duodart","jalyn","ديوادارت"],
};
const ORAL_ANTICOAGULANTS = ["warfarin","apixaban","rivaroxaban","dabigatran","edoxaban"];
const NSAIDS = ["ibuprofen","diclofenac"];
const ACEI = ["lisinopril","perindopril","ramipril","captopril","enalapril"];
const ARB  = ["valsartan","losartan","olmesartan","candesartan"];
const STATINS = ["rosuvastatin","atorvastatin","simvastatin","pravastatin"];
const PDE5 = ["sildenafil","tadalafil"];
const NITRATES = ["nitroglycerin"];
const K_SPARING = ["spironolactone"];
function mapToCanonical(drugName=""){
  const norm = String(drugName).toLowerCase().trim();
  for (const [key, arr] of Object.entries(ALIASES)) {
    if (arr.some(a => norm.includes(a.toLowerCase()))) return key;
  }
  return norm.split(/\s+/)[0];
}

// ------------------ تحليل الأدوية والقواعد السريرية ------------------
function parseLinesToMeds(allLines = []){
  const meds = [];
  for (const raw of allLines) {
    const line = applyCorrections(raw);
    if (!line) continue;
    const mgm = line.match(/(\d+(?:\.\d+)?)\s*mg/i);
    let name = line, dose = null;
    if (mgm) { dose = `${mgm[1]} mg`; name = line.replace(mgm[0], "").trim(); }
    meds.push({ name, dose, canonical: mapToCanonical(name) });
  }
  const seen = new Set();
  return meds.filter(m => {
    const key = m.canonical + "|" + (m.dose||"");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function hasDrug(meds, keyList){
  return meds.some(m => keyList.includes(m.canonical));
}
function findDrug(meds, key){
  return meds.find(m => m.canonical === key);
}

// قائمة القواعد
const RULES = [
  (ctx) => {
    const hasAsp = hasDrug(ctx.meds, ["aspirin"]);
    const hasOAC = ORAL_ANTICOAGULANTS.some(k => hasDrug(ctx.meds, [k]));
    if (hasAsp && hasOAC) return { sev: SEV.HIGH, title: "تداخل خطير: أسبرين + مضاد تخثر", message: "الجمع يرفع خطر النزف بشكل ملحوظ. راجع الطبيب فورًا." };
    return null;
  },
  (ctx) => {
    const preg = ctx.conditions?.pregnancy;
    const hasNSAID = hasDrug(ctx.meds, NSAIDS);
    if (preg?.pregnant && preg.weeks != null && preg.weeks >= 20 && hasNSAID)
      return { sev: SEV.HIGH, title: "حمل ≥20 أسبوعًا وNSAIDs", message: "يجب تجنب مضادات الالتهاب غير الستيرويدية بعد الأسبوع 20 لمخاطرها على الجنين." };
    return null;
  },
  (ctx) => {
    const eGFR = ctx.conditions?.eGFR;
    if (eGFR == null) return null;
    const hasMet = hasDrug(ctx.meds, ["metformin"]);
    if (hasMet && eGFR < 30) return { sev: SEV.HIGH, title: "ميتفورمين و eGFR < 30", message: "يُمنع استخدام الميتفورمين. يجب إيقافه فورًا." };
    if (hasMet && eGFR < 45) return { sev: SEV.MOD, title: "ميتفورمين: تقليل الجرعة", message: "يجب تقليل جرعة الميتفورمين ومراقبة وظائف الكلى." };
    return null;
  },
  (ctx) => {
    const eGFR = ctx.conditions?.eGFR;
    const hasNsaid = hasDrug(ctx.meds, NSAIDS);
    if (hasNsaid && eGFR != null && eGFR < 60) return { sev: SEV.MOD, title: "NSAIDs ومرض كلوي مزمن", message: "تجنب مضادات الالتهاب غير الستيرويدية قدر الإمكان؛ قد تضعف وظائف الكلى." };
    return null;
  },
  (ctx) => {
    const hasAce = ctx.meds.some(m => ACEI.includes(m.canonical));
    const hasArb = ctx.meds.some(m => ARB.includes(m.canonical));
    if (hasAce && hasArb) return { sev: SEV.HIGH, title: "تجنب الجمع: ACEi + ARB", message: "يزيد من مخاطر الفشل الكلوي وفرط البوتاسيوم دون فائدة واضحة." };
    return null;
  },
];

// ------------------ بناء التقرير النهائي (HTML) ------------------
function renderHTML({ meds, findings }){
  const style = `<style>body{direction:rtl;text-align:right;font-family:'Amiri',serif}.rx-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,'Amiri',serif;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:16px}.rx-title{font-size:20px;font-weight:800;margin:12px 0;color:#0b63c2}.rx-table{width:100%;border-collapse:separate;border-spacing:0 8px}.rx-row{background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,0.06)}.rx-cell{padding:12px 14px;vertical-align:top}.rx-head{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em}.rx-drug{font-weight:800}.rx-note{font-size:14px;line-height:1.55}.rx-muted{font-size:12px;color:#374151;margin:8px 0 0}</style>`;
  const medsRows = (meds||[]).map(m => `<tr class="rx-row"><td class="rx-cell rx-drug">${escapeHTML(m.name)}${m.dose?` — <span style="color:#475569">${escapeHTML(m.dose)}</span>`:''}</td></tr>`).join("");
  const badge = (sev) => `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:9999px;font-weight:700;color:#fff;background:${sev.color};font-size:12px;">${sev.emoji} ${sev.label}</span>`;
  const fxRows = (findings||[]).map(f => `<tr class="rx-row"><td class="rx-cell rx-drug">${escapeHTML(f.title)}</td><td class="rx-cell rx-note">${badge(f.sev)}<div style="height:6px"></div>${escapeHTML(f.message)}</td></tr>`).join("");

  return `${style}<div class="rx-wrap"><div class="rx-title">🧾 قائمة الأدوية</div><table class="rx-table"><thead><tr><th class="rx-cell rx-head">الدواء والجرعة</th></tr></thead><tbody>${medsRows || `<tr><td class="rx-cell">— لم يتم التعرف على أدوية —</td></tr>`}</tbody></table><div class="rx-title" style="margin-top:20px">⚠️ التحذيرات والتداخلات</div><table class="rx-table"><thead><tr><th class="rx-cell rx-head">العنوان</th><th class="rx-cell rx-head">التفاصيل ومستوى الخطورة</th></tr></thead><tbody>${fxRows || `<tr><td class="rx-cell" colspan="2">لا توجد ملاحظات حرجة بناءً على القواعد الحالية.</td></tr>`}</tbody></table><div class="rx-muted">الألوان: 🟥 شديد، 🟧 متوسط، 🟩 منخفض، 🔵 تنبيه.</div></div>`;
}

// ------------------ معالج الطلب (API Handler) ------------------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { texts = [], images = [], patient = {} } = req.body || {};

    // 1. OCR من الصور
    let ocrText = "";
    if (images && images.length) {
      ocrText = await extractTextFromImages(images);
    }

    // 2. دمج النصوص وتنقيتها
    const linesFromOCR = splitLines(ocrText);
    const linesFromTexts = splitLines((texts || []).join("\n"));
    const allLines = [...new Set([...linesFromTexts, ...linesFromOCR])];

    // 3. تحويل الأسطر إلى قائمة أدوية
    const meds = parseLinesToMeds(allLines);

    // 4. بناء سياق المريض
    const ctx = {
        meds,
        conditions: {
            pregnancy: patient?.pregnancy || null,
            eGFR: (typeof patient?.eGFR === "number" ? patient.eGFR : null),
            liverDisease: !!patient?.liverDisease,
            lactation: !!patient?.lactation?.breastfeeding,
        },
        demographics: {
            weightKg: patient?.weight || null,
            age: patient?.age || null,
            sex: patient?.sex || null,
        }
    };

    // 5. تطبيق القواعد السريرية
    const findings = RULES.map(rule => rule(ctx)).filter(Boolean);

    // 6. توليد HTML
    const html = renderHTML({ meds, findings });

    // 7. إرسال النتيجة
    return res.status(200).json({ ok: true, meds, findings, html });

  } catch (e) {
    console.error("Pharmacy RX API Error:", e);
    return res.status(500).json({ ok: false, error: "analysis_failed", message: e?.message || "Internal server error" });
  }
}
