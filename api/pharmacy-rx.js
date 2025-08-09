// pages/api/pharmacy-rx.js
// Bilingual (AR/EN) clinical rules engine for Rx OCR lists — Next.js API Route
// لا يحتاج مكتبات خارجية

// ========== 0) Utilities ==========
function norm(s = "") {
  // نحافظ على العربية + الإنجليزية + الأرقام وبعض الرموز
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z\u0600-\u06FF0-9\s\-\/\.\+]/g, " ")
    .replace(/\s+/g, " ")
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

function fuzzyFind(token, dictKeys, thresh = 0.34) {
  const t = norm(token);
  let best = null, bestScore = Infinity;
  for (const k of dictKeys) {
    const d = editDistance(t, k);
    const score = d / Math.max(k.length, t.length);
    if (score < bestScore) { bestScore = score; best = k; }
  }
  return bestScore <= thresh ? best : null;
}

// ========== 1) Knowledge base (extendable) ==========
// هيكل قابل للتوسيع: أضف ما تشاء من aliases عربي/إنجليزي/أسماء تجارية/اختصارات OCR
const DRUG_ENTRIES = [
  // --- Antihypertensives (CCB) ---
  {
    aliases: ["amlodipine", "أملوديبين", "amlodipin", "amlodipine 10", "norvasc"],
    generic: "amlodipine", class: "CCB (dihydropyridine)", indications: ["HTN","angina"]
  },

  // --- ARB / ACEi ---
  { aliases: ["valsartan", "فالسارتان"], generic: "valsartan", class: "ARB", indications: ["HTN","HF"] },
  { aliases: ["losartan", "لوسارتان"], generic: "losartan", class: "ARB", indications: ["HTN"] },
  { aliases: ["olmesartan", "أولميسارتان"], generic: "olmesartan", class: "ARB", indications: ["HTN"] },
  { aliases: ["candesartan", "كانديسارتان"], generic: "candesartan", class: "ARB", indications: ["HTN","HF"] },
  { aliases: ["perindopril", "بيريندوبريل"], generic: "perindopril", class: "ACEi", indications: ["HTN","CV"] },
  { aliases: ["lisinopril", "ليزينوبريل"], generic: "lisinopril", class: "ACEi", indications: ["HTN","HF"] },

  // --- ARB/Thiazide combos & misc combos ---
  {
    aliases: ["co-taburan 160/12.5", "co taburan", "valsartan/hydrochlorothiazide", "فالسارتان/هيدروكلوروثيازيد", "hct", "hctz"],
    generic: "valsartan/hydrochlorothiazide", class: "ARB + thiazide", indications: ["HTN"]
  },
  {
    aliases: ["exforge", "exforge hct", "amlodipine/valsartan", "amlodipine/valsartan/hct", "أملوديبين/فالسارتان"],
    generic: "amlodipine/valsartan(+/-HCT)", class: "CCB + ARB (+/- thiazide)", indications: ["HTN"]
  },
  {
    aliases: ["triplixam", "perindopril/indapamide/amlodipine", "تريپليكسام", "triplex"], // يشمل “triplex” الشائع بالمنطقة
    generic: "perindopril/indapamide/amlodipine", class: "ACEi + thiazide-like + CCB", indications: ["HTN"]
  },

  // --- BPH ---
  {
    aliases: ["duodart 0.5/0.4", "duodart", "ديوادارت", "dutasteride/tamsulosin", "jalyn"],
    generic: "dutasteride/tamsulosin", class: "5ARI + α1-blocker", indications: ["BPH"]
  },
  { aliases: ["tamsulosin", "تامسولوسين", "flomax"], generic: "tamsulosin", class: "α1-blocker", indications: ["BPH"] },

  // --- Lipids (statins) ---
  { aliases: ["rosuvastatin", "روزوفاستاتين", "crestor", "rozavi", "rozavi 10"], generic: "rosuvastatin", class: "statin", indications: ["dyslipidemia"] },
  { aliases: ["atorvastatin", "أتورفاستاتين", "lipitor"], generic: "atorvastatin", class: "statin", indications: ["dyslipidemia"] },

  // --- Diabetes ---
  { aliases: ["metformin", "ميتفورمين", "glucophage", "glucophage xr", "formet xr 750", "formot xr 750"], generic: "metformin XR/IR", class: "biguanide", indications: ["T2D"] },
  { aliases: ["gliclazide mr 30", "diamicron mr 30", "damicron mr 30", "جليكلازايد ام ار"], generic: "gliclazide MR", class: "sulfonylurea", indications: ["T2D"] },
  { aliases: ["sitagliptin", "سيتاجلبتين", "januvia"], generic: "sitagliptin", class: "DPP-4 inhibitor", indications: ["T2D"] },

  // --- GI (PPI) ---
  { aliases: ["pantoprazole", "بانتوبرازول", "pantomax 40", "pantomax", "protonix"], generic: "pantoprazole", class: "PPI", indications: ["GERD","ulcer"] },
  { aliases: ["esomeprazole", "إيزوميبرازول", "nexium"], generic: "esomeprazole", class: "PPI", indications: ["GERD","ulcer"] },

  // --- Analgesic ---
  { aliases: ["paracetamol", "acetaminophen", "باراسيتامول", "أسيتامينوفين", "adol", "panadol"], generic: "paracetamol (acetaminophen)", class: "analgesic/antipyretic", indications: ["pain","fever"] },

  // --- NSAIDs (مهم لسلامة الكلى/الضغط) ---
  { aliases: ["ibuprofen", "ايبوبروفين", "brufen", "advil"], generic: "ibuprofen", class: "NSAID", indications: ["pain","inflammation"] },
  { aliases: ["diclofenac", "ديكلوفيناك", "voltaren"], generic: "diclofenac", class: "NSAID", indications: ["pain","inflammation"] },

  // --- Devices / supplies ---
  { aliases: ["lancet", "لنست"], generic: "lancets (device)", class: "device", indications: ["glucose monitoring"], device: true },
  { aliases: ["e-core strip", "e care strip", "glucose test strips", "شرائط سكر"], generic: "glucose test strips", class: "device", indications: ["glucose monitoring"], device: true },

  // --- Unknowns from your case ---
  { aliases: ["intras"], generic: "unknown", class: "unknown", indications: [], needsConfirm: true },
  { aliases: ["pika-ur eff", "pika ur"], generic: "urinary alkalinizer? (effervescent)", class: "urology", indications: ["verify"], needsConfirm: true },
  { aliases: ["suden cream"], generic: "topical (verify)", class: "dermatology", indications: ["verify"], needsConfirm: true },
];

// نحول الـ entries إلى قاموس aliases → data
const DRUG_DB = (() => {
  const map = {};
  for (const e of DRUG_ENTRIES) {
    for (const alias of e.aliases) {
      map[norm(alias)] = { generic: e.generic, class: e.class, indications: e.indications || [], device: !!e.device, needsConfirm: !!e.needsConfirm };
    }
  }
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

// ========== 2) Core mapping ==========
function mapItem(rawName, doseText = "") {
  const key = fuzzyFind(rawName, DB_KEYS) || norm(rawName);
  const base = DRUG_DB[key] || { generic: rawName, class: "unknown", indications: [], needsConfirm: true };
  return { original: rawName, doseText, ...base, keyMatched: key };
}

// ========== 3) Clinical rules ==========

// A) HTN overlap / justification
function checkHypertensionOverlap(items, patient) {
  const antiHTN = items.filter(x => CLASS_GROUPS.antihypertensive.includes(x.class));
  if (antiHTN.length >= 2) {
    return {
      id: "HTN_COMBO_JUSTIFY",
      level: "review",
      summary: "أكثر من خافض ضغط واحد",
      detail: "وجود أكثر من دواء خافض للضغط يستلزم تبرير سريري (هدف ضغط واضح، مقاومة علاجية، إلخ).",
      refs: ["ACC_AHA_2017"],
    };
  }
  return null;
}

// B) Dual RAS blockade (ACEi + ARB) — avoid
function checkDualRAS(items) {
  const hasACEi = items.some(x => x.class === "ACEi");
  const hasARB  = items.some(x => x.class === "ARB" || x.generic.includes("/hydrochlorothiazide") || x.class === "ARB + thiazide");
  if (hasACEi && hasARB) {
    return {
      id: "DUAL_RAS_AVOID",
      level: "high",
      summary: "تجنّب الجمع بين ACEi و ARB",
      detail: "الدمج يزيد مخاطر الفشل الكلوي وفرط بوتاسيوم الدم دون فائدة واضحة.",
      refs: ["ACC_AHA_2017"],
    };
  }
  return null;
}

// C) α1-blocker + BP drugs → orthostatic hypotension
function checkBPHWithBP(items, patient) {
  const hasAlpha1 = items.some(x => CLASS_GROUPS.alpha1.includes(x.class));
  const hasBPDrugs = items.some(x => CLASS_GROUPS.antihypertensive.includes(x.class));
  if (hasAlpha1 && hasBPDrugs) {
    return {
      id: "ORTHO_HYPOTENSION_RISK",
      level: (patient?.age >= 65 ? "high" : "caution"),
      summary: "خطر هبوط ضغط وضعي (خاصةً مع العمر)",
      detail: "محصرات ألفا (تامسولوسين/ديوادارت) قد تزيد الدوخة والسقوط مع خافضات الضغط الأخرى.",
      refs: ["JALYN_LABEL"],
    };
  }
  return null;
}

// D) Metformin renal rule (KDIGO)
function checkMetforminRenal(items, eGFR) {
  const hasMet = items.some(x => x.generic.startsWith("metformin"));
  if (!hasMet || eGFR == null) return null;
  if (eGFR < 30) {
    return { id: "METFORMIN_CONTRA", level: "high", summary: "الميتفورمين مُضاد استطباب عند eGFR < 30", detail: "أوقف/لا تبدأ الميتفورمين. بدائل أخرى.", refs: ["KDIGO_2022"] };
  } else if (eGFR >= 30 && eGFR < 45) {
    return { id: "METFORMIN_REDUCE", level: "review", summary: "تقليل جرعة الميتفورمين عند eGFR 30–44", detail: "حدّ الجرعة اليومية (≈≤1000مغ XR) ومراقبة وظائف الكلى وB12.", refs: ["KDIGO_2022"] };
  }
  return null;
}

// E) Sulfonylurea caution in elderly/CKD
function checkSU_Elderly_CKD(items, patient) {
  const hasSU = items.some(x => x.class === "sulfonylurea");
  if (!hasSU) return null;
  if ((patient?.age >= 65) || (patient?.eGFR != null && patient.eGFR < 60)) {
    return {
      id: "SU_HYPO_RISK",
      level: "review",
      summary: "السلفونيل يوريا: خطر هبوط سكر أعلى في الكِبار/CKD",
      detail: "فكّر ببدائل أو جرعات أقل ومراقبة لصيقة للجلوكوز.",
      refs: ["ADA_2025"],
    };
  }
  return null;
}

// F) Rosuvastatin renal max dose
function checkRosuvastatinRenal(items, eGFR, doseTextMap) {
  const rosu = items.find(x => x.generic.startsWith("rosuvastatin"));
  if (!rosu || eGFR == null) return null;
  if (eGFR < 30) {
    const txt = doseTextMap.get(rosu.original) || rosu.doseText || "";
    const mgMatch = txt.match(/(\d+)\s*mg/) || rosu.generic.match(/(\d+)\s*mg/);
    const mg = mgMatch ? parseInt(mgMatch[1], 10) : null;
    if (mg == null || mg > 10) {
      return {
        id: "ROSU_MAX10_SEVERE_CKD",
        level: "high",
        summary: "روزوفاستاتين: لا تتجاوز 10mg عند قصور كلوي شديد",
        detail: "يوصى ببدء 5mg ولا تتجاوز 10mg في القصور الكلوي الشديد.",
        refs: ["CRESTOR_LABEL"],
      };
    }
  }
  return null;
}

// G) Thiazide with gout / hyperuricemia
function checkThiazide_Gout(items, patient) {
  const hasThiazide = items.some(x => (x.class.includes("thiazide")));
  if (!hasThiazide) return null;
  if (patient?.gout === true || (patient?.uricAcid && patient.uricAcid > 7.0)) {
    return {
      id: "THIAZIDE_GOUT",
      level: "caution",
      summary: "الثيازايد قد ترفع حمض اليوريك",
      detail: "راجع خطة الضغط إذا المريض لديه نقرس/حمض يوريك مرتفع.",
      refs: ["ACC_AHA_2017"],
    };
  }
  return null;
}

// H) NSAID in CKD/HTN
function checkNSAID_CKD(items, patient) {
  const hasNSAID = items.some(x => CLASS_GROUPS.nsaid.includes(x.class));
  if (!hasNSAID) return null;
  if (patient?.eGFR != null && patient.eGFR < 60) {
    return {
      id: "NSAID_CKD",
      level: (patient.eGFR < 30 ? "high" : "review"),
      summary: "NSAID مع قصور كلوي",
      detail: "تجنّب NSAIDs في CKD (خصوصاً eGFR <30). قد ترفع الضغط وتضعف الكلى.",
      refs: ["KDIGO_2022"],
    };
  }
  return null;
}

// I) Acetaminophen daily cap
function checkAcetaminophenMax(items, totalDailyMg) {
  const apap = items.find(x => x.generic.includes("paracetamol") || x.generic.includes("acetaminophen"));
  if (!apap || totalDailyMg == null) return null;
  if (totalDailyMg > 4000) {
    return { id: "APAP_MAX_4G", level: "high", summary: "الباراسيتامول > 4 جم/يوم", detail: "تجاوز الحد الأقصى الموصى به للبالغين (4 جم/24 ساعة).", refs: ["APAP_ADULT_MAX"] };
  }
  return null;
}

// J) PPI long duration
function checkPPIDuration(items, durationDays) {
  const ppi = items.find(x => x.class === "PPI");
  if (!ppi || durationDays == null) return null;
  if (durationDays >= 90) {
    return { id: "PPI_LONG_DURATION", level: "caution", summary: "مدة PPI طويلة", detail: "الاستخدام المزمن يحتاج مبررات واضحة؛ 8 أسابيع شائعة ثم إعادة التقييم.", refs: ["PANTOPRAZOLE_LABEL"] };
  }
  return null;
}

// ========== 4) Analyzer ==========
function analyzePrescription({
  ocrList, // [{name, dose}]
  patient = {} // {age, sex, eGFR, gout, uricAcid, apapDailyMg, ppiDurationDays}
}) {
  const items = (ocrList || []).map(x => mapItem(x.name, x.dose || ""));
  const doseTextMap = new Map((ocrList || []).map(x => [x.name, x.dose || ""]));

  const findings = [];
  const push = f => { if (f) findings.push(f); };

  push(checkHypertensionOverlap(items, patient));
  push(checkDualRAS(items));
  push(checkBPHWithBP(items, patient));
  push(checkMetforminRenal(items, patient.eGFR));
  push(checkSU_Elderly_CKD(items, patient));
  push(checkRosuvastatinRenal(items, patient.eGFR, doseTextMap));
  push(checkThiazide_Gout(items, patient));
  push(checkNSAID_CKD(items, patient));

  if (patient.apapDailyMg != null) push(checkAcetaminophenMax(items, patient.apapDailyMg));
  if (patient.ppiDurationDays != null) push(checkPPIDuration(items, patient.ppiDurationDays));

  // Score بسيط
  let score = 100;
  for (const f of findings) {
    if (!f) continue;
    if (f.level === "high") score -= 25;
    else if (f.level === "review") score -= 15;
    else score -= 8;
  }
  score = Math.max(0, Math.min(100, score));

  const REF_MAP = {
    ACC_AHA_2017: {
      title: "2017 ACC/AHA Hypertension Guideline",
      url: "https://www.acc.org/~/media/Non-Clinical/Files-PDFs-Excel-MS-Word-etc/Guidelines/2017/Guidelines_Made_Simple_2017_HBP.pdf",
    },
    KDIGO_2022: {
      title: "KDIGO 2022 Diabetes in CKD",
      url: "https://kdigo.org/wp-content/uploads/2022/10/KDIGO-2022-Clinical-Practice-Guideline-for-Diabetes-Management-in-CKD.pdf",
    },
    CRESTOR_LABEL: {
      title: "CRESTOR (rosuvastatin) FDA label – renal dosing",
      url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/021366s043s044lbl.pdf",
    },
    JALYN_LABEL: {
      title: "JALYN (dutasteride/tamsulosin) FDA label – orthostatic hypotension",
      url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2011/022460s001lbl.pdf",
    },
    PANTOPRAZOLE_LABEL: {
      title: "Pantoprazole (PROTONIX) label – typical durations",
      url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2012/020987s045lbl.pdf",
    },
    ADA_2025: {
      title: "ADA Standards of Care (latest)",
      url: "https://diabetesjournals.org/care/issue",
    },
    APAP_ADULT_MAX: {
      title: "Adult paracetamol maximum daily dose (4g)",
      url: "https://www.nhs.uk/medicines/paracetamol-for-adults/how-and-when-to-take-paracetamol-for-adults/",
    },
  };

  const table = items.map(x => {
    let status = "✅ مقبول";
    if (x.needsConfirm) status = "⚠️ يحتاج تأكيد اسم/غرض";
    if (x.class === "unknown") status = "⚠️ غير واضح";
    if (x.device) status = "ℹ️ لوازم/أدوات";
    return {
      original: x.original,
      mapped: x.generic,
      class: x.class,
      indications: x.indications.join(", "),
      doseText: x.doseText || "",
      status,
    };
  });

  return {
    patient: { ...patient },
    summaryScore: score,
    items: table,
    findings: findings.filter(Boolean),
    references: REF_MAP,
  };
}

// ========== 5) Next.js API handler ==========
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "method_not_allowed" });
    }
    const { ocrList, patient } = req.body || {};
    const result = analyzePrescription({ ocrList, patient });
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "analysis_failed", message: e?.message });
  }
}

export { analyzePrescription };
