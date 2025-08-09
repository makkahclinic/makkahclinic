// pages/api/pharmacy-rx.js
// Smart bilingual Rx rules engine (AR/EN) — Next.js API Route
// No external deps

/* ===================== 0) Utilities ===================== */
function norm(s = "") {
  // Keep Arabic/Latin digits/units and a few symbols
  return (s || "")
    .toLowerCase()
    .replace(/[؛،]/g, " ")
    .replace(/[*•●▪️・]+/g, " ")
    .replace(/[^a-z\u0600-\u06FF0-9\s\-\/\.\+\(\)]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Tiny Levenshtein
function editDistance(a, b) {
  a = norm(a); b = norm(b);
  const dp = Array(b.length + 1).fill(0).map((_, i) => [i]);
  for (let j = 0; j <= a.length; j++) dp[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + (a[j-1] === b[i-1] ? 0 : 1)
      );
    }
  }
  return dp[b.length][a.length];
}

function tokenSet(s) {
  return new Set(
    norm(s)
      .split(/\s+/)
      .filter(Boolean)
  );
}

function similarity(a, b) {
  // mix of normalized edit distance + token overlap
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  const ed = editDistance(na, nb);
  const edScore = 1 - ed / Math.max(na.length, nb.length);
  const ta = tokenSet(na), tb = tokenSet(nb);
  let inter = 0; ta.forEach(t => tb.has(t) && inter++);
  const union = new Set([...ta, ...tb]).size || 1;
  const jacc = inter / union;
  return 0.65 * edScore + 0.35 * jacc; // 0..1
}

/* ===================== 1) Knowledge base ===================== */
// Expandable list: aliases (AR/EN/brands/OCR variants)
const DRUG_ENTRIES = [
  // --- CCB / ARB / ACEi
  { aliases: ["amlodipine","أملوديبين","amlodipin","norvasc","amlodipine 10"], generic: "amlodipine", class: "CCB (dihydropyridine)", indications: ["HTN","angina"] },
  { aliases: ["valsartan","فالسارتان"], generic: "valsartan", class: "ARB", indications: ["HTN","HF"] },
  { aliases: ["losartan","لوسارتان"], generic: "losartan", class: "ARB", indications: ["HTN"] },
  { aliases: ["olmesartan","أولميسارتان","olmi"], generic: "olmesartan", class: "ARB", indications: ["HTN"] },
  { aliases: ["candesartan","كانديسارتان"], generic: "candesartan", class: "ARB", indications: ["HTN","HF"] },
  { aliases: ["perindopril","بيريندوبريل"], generic: "perindopril", class: "ACEi", indications: ["HTN","CV"] },
  { aliases: ["lisinopril","ليزينوبريل"], generic: "lisinopril", class: "ACEi", indications: ["HTN","HF"] },

  // combos
  { aliases: ["co-taburan 160/12.5","co taburan","valsartan/hydrochlorothiazide","فالسارتان/هيدروكلوروثيازيد","hct","hctz"], generic: "valsartan/hydrochlorothiazide", class: "ARB + thiazide", indications: ["HTN"] },
  { aliases: ["exforge","exforge hct","amlodipine/valsartan","amlodipine/valsartan/hct","أملوديبين/فالسارتان"], generic: "amlodipine/valsartan(+/-HCT)", class: "CCB + ARB (+/- thiazide)", indications: ["HTN"] },
  { aliases: ["triplixam","تريپليكسام","perindopril/indapamide/amlodipine","triplex"], generic: "perindopril/indapamide/amlodipine", class: "ACEi + thiazide-like + CCB", indications: ["HTN"] },

  // --- BPH
  { aliases: ["duodart 0.5/0.4","duodart","ديوادارت","dutasteride/tamsulosin","jalyn"], generic: "dutasteride/tamsulosin", class: "5ARI + α1-blocker", indications: ["BPH"] },
  { aliases: ["tamsulosin","تامسولوسين","flomax"], generic: "tamsulosin", class: "α1-blocker", indications: ["BPH"] },

  // --- Statins
  { aliases: ["rosuvastatin","روزوفاستاتين","crestor","rozavi","rozavi 10"], generic: "rosuvastatin", class: "statin", indications: ["dyslipidemia"] },
  { aliases: ["atorvastatin","أتورفاستاتين","lipitor"], generic: "atorvastatin", class: "statin", indications: ["dyslipidemia"] },

  // --- Diabetes
  { aliases: ["metformin","ميتفورمين","glucophage","glucophage xr","formet xr 750","formot xr 750"], generic: "metformin XR/IR", class: "biguanide", indications: ["T2D"] },
  { aliases: ["gliclazide mr 30","diamicron mr 30","damicron mr 30","جليكلازايد ام ار"], generic: "gliclazide MR", class: "sulfonylurea", indications: ["T2D"] },
  { aliases: ["sitagliptin","سيتاجلبتين","januvia"], generic: "sitagliptin", class: "DPP-4 inhibitor", indications: ["T2D"] },

  // --- PPI
  { aliases: ["pantoprazole","بانتوبرازول","pantomax 40","pantomax","protonix"], generic: "pantoprazole", class: "PPI", indications: ["GERD","ulcer"] },
  { aliases: ["esomeprazole","إيزوميبرازول","nexium"], generic: "esomeprazole", class: "PPI", indications: ["GERD","ulcer"] },

  // --- Analgesic / NSAIDs
  { aliases: ["paracetamol","acetaminophen","باراسيتامول","أسيتامينوفين","adol","panadol"], generic: "paracetamol (acetaminophen)", class: "analgesic/antipyretic", indications: ["pain","fever"] },
  { aliases: ["ibuprofen","ايبوبروفين","brufen","advil"], generic: "ibuprofen", class: "NSAID", indications: ["pain","inflammation"] },
  { aliases: ["diclofenac","ديكلوفيناك","voltaren"], generic: "diclofenac", class: "NSAID", indications: ["pain","inflammation"] },

  // --- Devices
  { aliases: ["lancet","لنست"], generic: "lancets (device)", class: "device", indications: ["glucose monitoring"], device: true },
  { aliases: ["e-core strip","e care strip","glucose test strips","شرائط سكر"], generic: "glucose test strips", class: "device", indications: ["glucose monitoring"], device: true },

  // --- Unknowns seen
  { aliases: ["intras"], generic: "unknown", class: "unknown", indications: [], needsConfirm: true },
  { aliases: ["pika-ur eff","pika ur"], generic: "urinary alkalinizer? (effervescent)", class: "urology", indications: ["verify"], needsConfirm: true },
  { aliases: ["suden cream"], generic: "topical (verify)", class: "dermatology", indications: ["verify"], needsConfirm: true },
];

const DRUG_DB = (() => {
  const map = {};
  for (const e of DRUG_ENTRIES) {
    for (const alias of e.aliases) {
      map[norm(alias)] = {
        generic: e.generic,
        class: e.class,
        indications: e.indications || [],
        device: !!e.device,
        needsConfirm: !!e.needsConfirm,
      };
    }
  }
  // Synonyms for OCR shortcuts
  map["hct"]  = map["valsartan/hydrochlorothiazide"];
  map["hctz"] = map["valsartan/hydrochlorothiazide"];
  return map;
})();

const DB_KEYS = Object.keys(DRUG_DB);

const CLASS_GROUPS = {
  antihypertensive: ["CCB (dihydropyridine)", "ARB", "ACEi", "ARB + thiazide", "CCB + ARB (+/- thiazide)", "ACEi + thiazide-like + CCB"],
  thiazide_like: ["thiazide", "thiazide-like"],
  alpha1: ["α1-blocker", "5ARI + α1-blocker"],
  diabetes: ["biguanide", "sulfonylurea", "DPP-4 inhibitor"],
  statin: ["statin"],
  ppi: ["PPI"],
  nsaid: ["NSAID"],
};

/* ===================== 2) Parsing helpers ===================== */
const UNIT_PAT = "(mg|mcg|µg|g|ml|iu|units|ملغ|مج|جم|مل)";
const FREQ_PAT = "(?:qd|od|bid|tid|qid|qhs|prn|once|twice|daily|every ?\\d+ ?h|مرة|مرتين|كل ?\\d+ ?ساعة)";
const REL_PAT  = "(?:xr|sr|cr|mr)";

function extractDoseText(s) {
  const re = new RegExp(
    `(?:\\b\\d+(?:\\.\\d+)?\\s*${UNIT_PAT}\\b(?:\\s*\\/\\s*\\d+(?:\\.\\d+)?\\s*${UNIT_PAT}\\b)?` +
    `(?:\\s*\\+\\s*\\d+(?:\\.\\d+)?\\s*${UNIT_PAT})*` +
    `(?:\\s*${REL_PAT})?` +
    `|\\b${REL_PAT}\\b)`,"i");
  const m = s.match(re);
  return m ? m[0].trim() : "";
}

function normalizeLine(line) {
  return norm(line)
    .replace(/^(?:-|\+|•|\*|\d+\.)\s*/,'')
    .replace(/\s{2,}/g,' ')
    .trim();
}

function splitFreeText(text="") {
  const raw = text
    .replace(/\r/g,"\n")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  // أيضاً نفصل على الفواصل
  const out = [];
  raw.forEach(s=>{
    s.split(/[،,;]/).forEach(p=>{
      const t = p.trim();
      if (t.length>1) out.push(t);
    });
  });
  return out;
}

/* ===================== 3) Mapping / fuzzy ===================== */
function fuzzyFindBest(token, dictKeys, threshold = 0.68) {
  const t = normalizeLine(token);
  let bestKey = null, bestScore = 0;
  for (const k of dictKeys) {
    const sc = similarity(t, k);
    if (sc > bestScore) { bestScore = sc; bestKey = k; }
  }
  return bestScore >= threshold ? { key: bestKey, score: bestScore } : { key: null, score: 0 };
}

function mapItem(rawName, doseText = "") {
  const { key, score } = fuzzyFindBest(rawName, DB_KEYS);
  const base = key ? DRUG_DB[key] : { generic: rawName, class: "unknown", indications: [], needsConfirm: true };
  return { original: rawName, doseText, confidence: Number(score.toFixed(2)), ...base, keyMatched: key || norm(rawName) };
}

/* ===================== 4) Clinical rules ===================== */
function checkHypertensionOverlap(items) {
  const antiHTN = items.filter(x => CLASS_GROUPS.antihypertensive.includes(x.class));
  if (antiHTN.length >= 2) {
    return { id:"HTN_COMBO_JUSTIFY", level:"review", summary:"أكثر من خافض ضغط واحد", detail:"وجود أكثر من دواء خافض للضغط يستلزم تبرير سريري (هدف ضغط واضح/مقاومة).", refs:["ACC_AHA_2017"] };
  }
  return null;
}
function checkDualRAS(items) {
  const hasACEi = items.some(x => x.class === "ACEi");
  const hasARB  = items.some(x => x.class === "ARB" || x.class === "ARB + thiazide" || (x.generic||"").includes("/hydrochlorothiazide"));
  if (hasACEi && hasARB) {
    return { id:"DUAL_RAS_AVOID", level:"high", summary:"تجنّب الجمع بين ACEi و ARB", detail:"يزيد مخاطر الكلى وفرط بوتاسيوم دون فائدة.", refs:["ACC_AHA_2017"] };
  }
  return null;
}
function checkBPHWithBP(items, patient) {
  const hasAlpha1 = items.some(x => CLASS_GROUPS.alpha1.includes(x.class));
  const hasBPDrugs = items.some(x => CLASS_GROUPS.antihypertensive.includes(x.class));
  if (hasAlpha1 && hasBPDrugs) {
    return { id:"ORTHO_HYPOTENSION_RISK", level:(patient?.age>=65?"high":"caution"), summary:"خطر هبوط ضغط وضعي", detail:"تامسولوسين/ديوادارت مع خافضات الضغط قد يزيد الدوخة والسقوط.", refs:["JALYN_LABEL"] };
  }
  return null;
}
function checkMetforminRenal(items, eGFR) {
  const hasMet = items.some(x => x.generic.startsWith("metformin"));
  if (!hasMet || eGFR == null) return null;
  if (eGFR < 30) return { id:"METFORMIN_CONTRA", level:"high", summary:"ميتفورمين مضاد استطباب عند eGFR < 30", detail:"أوقف/لا تبدأ. بدائل أخرى.", refs:["KDIGO_2022"] };
  if (eGFR < 45) return { id:"METFORMIN_REDUCE", level:"review", summary:"تقليل جرعة الميتفورمين عند eGFR 30–44", detail:"حدّ الجرعة اليومية≈≤1000mg XR ومراقبة.", refs:["KDIGO_2022"] };
  return null;
}
function checkSU_Elderly_CKD(items, patient) {
  const hasSU = items.some(x => x.class === "sulfonylurea");
  if (!hasSU) return null;
  if ((patient?.age>=65) || (patient?.eGFR!=null && patient.eGFR<60)) {
    return { id:"SU_HYPO_RISK", level:"review", summary:"السلفونيل يوريا: خطر هبوط سكر أعلى في الكِبار/CKD", detail:"فكّر ببدائل أو جرعات أقل ومراقبة.", refs:["ADA_2025"] };
  }
  return null;
}
function checkRosuvastatinRenal(items, eGFR, doseTextMap) {
  const rosu = items.find(x => x.generic.startsWith("rosuvastatin"));
  if (!rosu || eGFR == null) return null;
  if (eGFR < 30) {
    const txt = doseTextMap.get(rosu.original) || rosu.doseText || "";
    const mgMatch = txt.match(/(\d+)\s*mg/);
    const mg = mgMatch ? parseInt(mgMatch[1],10) : null;
    if (mg == null || mg > 10) {
      return { id:"ROSU_MAX10_SEVERE_CKD", level:"high", summary:"روزوفاستاتين: لا تتجاوز 10mg عند قصور شديد", detail:"يوصى ببدء 5mg ولا تتجاوز 10mg.", refs:["CRESTOR_LABEL"] };
    }
  }
  return null;
}
function checkThiazide_Gout(items, patient) {
  const hasThiazide = items.some(x => (x.class||"").includes("thiazide"));
  if (!hasThiazide) return null;
  if (patient?.gout === true || (patient?.uricAcid && patient.uricAcid > 7.0)) {
    return { id:"THIAZIDE_GOUT", level:"caution", summary:"الثيازايد قد ترفع حمض اليوريك", detail:"راجع خطة الضغط عند النقرس/حمض يوريك مرتفع.", refs:["ACC_AHA_2017"] };
  }
  return null;
}
function checkNSAID_CKD(items, patient) {
  const hasNSAID = items.some(x => CLASS_GROUPS.nsaid.includes(x.class));
  if (!hasNSAID) return null;
  if (patient?.eGFR != null && patient.eGFR < 60) {
    return { id:"NSAID_CKD", level:(patient.eGFR<30?"high":"review"), summary:"NSAID مع قصور كلوي", detail:"تجنب NSAIDs في CKD، قد ترفع الضغط وتضعف الكلى.", refs:["KDIGO_2022"] };
  }
  return null;
}
function checkAcetaminophenMax(items, totalDailyMg) {
  const apap = items.find(x => x.generic.includes("paracetamol") || x.generic.includes("acetaminophen"));
  if (!apap || totalDailyMg == null) return null;
  if (totalDailyMg > 4000) return { id:"APAP_MAX_4G", level:"high", summary:"الباراسيتامول > 4 جم/يوم", detail:"تجاوز الحد الأقصى للبالغين (4 جم/24 ساعة).", refs:["APAP_ADULT_MAX"] };
  return null;
}
function checkPPIDuration(items, durationDays) {
  const ppi = items.find(x => x.class === "PPI");
  if (!ppi || durationDays == null) return null;
  if (durationDays >= 90) return { id:"PPI_LONG_DURATION", level:"caution", summary:"مدة PPI طويلة", detail:"الاستخدام المزمن يحتاج تبرير؛ عادة 8 أسابيع ثم إعادة تقييم.", refs:["PANTOPRAZOLE_LABEL"] };
  return null;
}

/* ===================== 5) Ingestion / dedupe ===================== */
function parseFreeTextMeds(freeText="") {
  const lines = splitFreeText(freeText);
  const meds = [];
  for (const raw of lines) {
    const cleaned = normalizeLine(raw);
    if (!cleaned) continue;
    // استخرج جرعة/شكل/إطلاق
    const dose = extractDoseText(raw);
    // اسم بدون الجرعة
    const nameOnly = cleaned.replace(dose ? norm(dose) : "", "").trim();
    if (nameOnly) meds.push({ name: nameOnly, dose: dose || "" });
  }
  return meds;
}

function dedupeByGeneric(mappedItems) {
  const byGen = new Map();
  for (const it of mappedItems) {
    const k = it.generic || it.original;
    if (!byGen.has(k)) byGen.set(k, it);
    else {
      // احتفظ بالأعلى ثقة، وادمج النصوص
      const prev = byGen.get(k);
      if ((it.confidence||0) > (prev.confidence||0)) prev.confidence = it.confidence;
      const parts = new Set([prev.doseText, it.doseText].filter(Boolean));
      prev.doseText = Array.from(parts).join(" + ");
      prev.original = prev.original === it.original ? prev.original : `${prev.original} | ${it.original}`;
      byGen.set(k, prev);
    }
  }
  return Array.from(byGen.values());
}

/* ===================== 6) Analyzer ===================== */
function analyzePrescription({
  ocrList = [],       // [{ name, dose }]
  freeText = "",      // string — optional
  patient = {}        // {age, sex, eGFR, gout, uricAcid, apapDailyMg, ppiDurationDays}
}) {
  // Combine sources
  const fromFree = parseFreeTextMeds(freeText);
  const allRaw = []
    .concat(ocrList || [])
    .concat(fromFree || [])
    .filter(x => (x?.name||"").trim().length > 0);

  // Map and dedupe
  const mapped = allRaw.map(x => mapItem(x.name, x.dose || extractDoseText(x.name)));
  const itemsMapped = dedupeByGeneric(mapped);

  // Build dose map using original names
  const doseTextMap = new Map(allRaw.map(x => [x.name, x.dose || extractDoseText(x.name)]));

  const findings = [];
  const push = f => { if (f) findings.push(f); };
  push(checkHypertensionOverlap(itemsMapped, patient));
  push(checkDualRAS(itemsMapped));
  push(checkBPHWithBP(itemsMapped, patient));
  push(checkMetforminRenal(itemsMapped, patient.eGFR));
  push(checkSU_Elderly_CKD(itemsMapped, patient));
  push(checkRosuvastatinRenal(itemsMapped, patient.eGFR, doseTextMap));
  push(checkThiazide_Gout(itemsMapped, patient));
  push(checkNSAID_CKD(itemsMapped, patient));
  if (patient.apapDailyMg != null) push(checkAcetaminophenMax(itemsMapped, patient.apapDailyMg));
  if (patient.ppiDurationDays != null) push(checkPPIDuration(itemsMapped, patient.ppiDurationDays));

  // Score
  let score = 100;
  for (const f of findings) {
    if (!f) continue;
    if (f.level === "high") score -= 25;
    else if (f.level === "review") score -= 15;
    else score -= 8;
  }
  score = Math.max(0, Math.min(100, score));

  const REF_MAP = {
    ACC_AHA_2017: { title: "2017 ACC/AHA Hypertension Guideline", url: "https://www.acc.org/~/media/Non-Clinical/Files-PDFs-Excel-MS-Word-etc/Guidelines/2017/Guidelines_Made_Simple_2017_HBP.pdf" },
    KDIGO_2022: { title: "KDIGO 2022 Diabetes in CKD", url: "https://kdigo.org/wp-content/uploads/2022/10/KDIGO-2022-Clinical-Practice-Guideline-for-Diabetes-Management-in-CKD.pdf" },
    CRESTOR_LABEL: { title: "CRESTOR (rosuvastatin) FDA label – renal dosing", url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/021366s043s044lbl.pdf" },
    JALYN_LABEL: { title: "JALYN (dutasteride/tamsulosin) FDA label – orthostatic hypotension", url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2011/022460s001lbl.pdf" },
    PANTOPRAZOLE_LABEL: { title: "Pantoprazole label – typical durations", url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2012/020987s045lbl.pdf" },
    ADA_2025: { title: "ADA Standards of Care (latest)", url: "https://diabetesjournals.org/care/issue" },
    APAP_ADULT_MAX: { title: "Adult paracetamol max daily dose (4g)", url: "https://www.nhs.uk/medicines/paracetamol-for-adults/how-and-when-to-take-paracetamol-for-adults/" },
  };

  const table = itemsMapped.map(x => {
    let status = "✅ مقبول";
    if (x.needsConfirm) status = "⚠️ يحتاج تأكيد اسم/غرض";
    if (x.class === "unknown") status = "⚠️ غير واضح";
    if (x.device) status = "ℹ️ لوازم/أدوات";
    return {
      original: x.original,
      mapped: x.generic,
      class: x.class,
      indications: (x.indications||[]).join(", "),
      doseText: x.doseText || "",
      status,
      confidence: x.confidence ?? undefined
    };
  });

  const notes = [];
  if (!table.length) notes.push("لم نلتقط أدوية واضحة — جرّب تحسين جودة OCR أو اكتب أسماء تقريبية.");
  if (table.some(x=>x.class==="unknown")) notes.push("بعض الأسماء غير واضحة؛ تأكيد الصياغة أو الاسم التجاري يساعد.");

  return {
    patient: { ...patient },
    summaryScore: score,
    items: table,
    findings: findings.filter(Boolean),
    references: REF_MAP,
    notes,
    debug: { parsedFromFreeText: fromFree, totalInput: allRaw.length }
  };
}

/* ===================== 7) Next.js API handler ===================== */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "method_not_allowed" });
    }
    const { ocrList, patient, freeText } = req.body || {};
    const result = analyzePrescription({ ocrList, patient, freeText });
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "analysis_failed", message: e?.message });
  }
}

export { analyzePrescription };
