// /api/analyzeRx.js
// Lightweight clinical rules engine for Rx OCR lists
// Usage (Node/Next): export default async function handler(req,res){...} أو استخدم analyzePrescription() مباشرة.

/////////////////////////////
// 0) Utilities
/////////////////////////////

function norm(s='') {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s\-\/\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// tiny Levenshtein for fuzzy match (optimized for short tokens)
function editDistance(a, b) {
  a = norm(a); b = norm(b);
  const dp = Array(b.length + 1).fill(0).map((_,i)=>[i]);
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

function fuzzyFind(token, dictKeys, thresh=0.34) {
  const t = norm(token);
  let best = null, bestScore = Infinity;
  for (const k of dictKeys) {
    const d = editDistance(t, k);
    const score = d / Math.max(k.length, t.length);
    if (score < bestScore) { bestScore = score; best = k; }
  }
  return bestScore <= thresh ? best : null;
}

/////////////////////////////
// 1) Knowledge base (extendable)
/////////////////////////////

// Minimal, region-aware map: brand/generic aliases → canonical generic + class + common indication
const DRUG_DB = {
  // antihypertensives
  "amlodipine": { generic:"amlodipine", class:"CCB (dihydropyridine)", indications:["HTN","angina"] },
  "co-taburan 160/12.5": { generic:"valsartan/hydrochlorothiazide", class:"ARB + thiazide", indications:["HTN"] },
  "co taburan": { generic:"valsartan/hydrochlorothiazide", class:"ARB + thiazide", indications:["HTN"] },
  "triplex": { generic:"(uncertain combo)", class:"possible HTN combo", indications:["HTN (verify)"], needsConfirm:true },

  // BPH
  "duodart 0.5/0.4": { generic:"dutasteride/tamsulosin", class:"5ARI + α1-blocker", indications:["BPH"] },
  "duodart": { generic:"dutasteride/tamsulosin", class:"5ARI + α1-blocker", indications:["BPH"] },

  // lipids
  "rozavi 10": { generic:"rosuvastatin 10 mg", class:"statin", indications:["dyslipidemia"] },
  "rozavi": { generic:"rosuvastatin", class:"statin", indications:["dyslipidemia"] },

  // GI
  "pantomax 40": { generic:"pantoprazole 40 mg", class:"PPI", indications:["GERD","ulcer"] },
  "pantomax": { generic:"pantoprazole", class:"PPI", indications:["GERD","ulcer"] },

  // diabetes
  "formet xr 750": { generic:"metformin XR 750 mg", class:"biguanide", indications:["T2D"] },
  "formot xr 750": { generic:"metformin XR 750 mg", class:"biguanide", indications:["T2D"], needsConfirm:true }, // OCR variant
  "diamicron mr 30": { generic:"gliclazide MR 30 mg", class:"sulfonylurea", indications:["T2D"] },
  "damicron mr 30": { generic:"gliclazide MR 30 mg", class:"sulfonylurea", indications:["T2D"], needsConfirm:true }, // OCR variant

  // analgesic
  "adol": { generic:"paracetamol (acetaminophen)", class:"analgesic/antipyretic", indications:["pain","fever"] },

  // supplies / misc (treat as devices unless clarified)
  "lancet": { generic:"lancets (device)", class:"device", indications:["glucose monitoring"], device:true },
  "e-core strip": { generic:"glucose test strips", class:"device", indications:["glucose monitoring"], device:true },
  "e care strip": { generic:"glucose test strips", class:"device", indications:["glucose monitoring"], device:true },

  // unknowns from your image
  "intras": { generic:"unknown", class:"unknown", indications:[], needsConfirm:true },
  "pika-ur eff": { generic:"uric acid/urinary alkalinizer? (effervescent)", class:"urology", indications:["verify"], needsConfirm:true },
  "suden cream": { generic:"topical (verify)", class:"dermatology", indications:["verify"], needsConfirm:true },
};

// canonical keys for fuzzy matching
const DB_KEYS = Object.keys(DRUG_DB);

// Rule helpers
const CLASS_GROUPS = {
  antihypertensive: ["CCB (dihydropyridine)", "ARB + thiazide", "possible HTN combo"],
  hypotension_riskers: ["α1-blocker","5ARI + α1-blocker","CCB (dihydropyridine)"],
  diabetes: ["biguanide","sulfonylurea"],
  statin: ["statin"],
  ppi: ["PPI"],
};

/////////////////////////////
// 2) Core analysis
/////////////////////////////

function mapItem(rawName, doseText="") {
  const key = fuzzyFind(rawName, DB_KEYS) || norm(rawName);
  const base = DRUG_DB[key] || { generic:rawName, class:"unknown", indications:[], needsConfirm:true };
  // keep original for audit
  return { original:rawName, doseText, ...base, keyMatched:key };
}

function checkHypertensionOverlap(items) {
  // Flag combo HTN without documented indication/targets (requires justification per ACC/AHA).
  const antiHTN = items.filter(x => CLASS_GROUPS.antihypertensive.includes(x.class));
  if (antiHTN.length >= 2) {
    return {
      id: "HTN_COMBO_JUSTIFY",
      level: "review",
      summary: "أكثر من خافض ضغط واحد",
      detail: "وجود أكثر من دواء لخفض الضغط يتطلب تبرير سريري وهدف قياس ضغط واضح.",
      refs: ["ACC_AHA_2017"]
    };
  }
  return null;
}

function checkBPHWithBP(items) {
  const hasDuodart = items.some(x => x.generic.startsWith("dutasteride/tamsulosin"));
  const hasBPDrugs = items.some(x => CLASS_GROUPS.antihypertensive.includes(x.class));
  if (hasDuodart && hasBPDrugs) {
    return {
      id: "ORTHO_HYPOTENSION_RISK",
      level: "caution",
      summary: "احتمال هبوط ضغط وضعي",
      detail: "مُحصرات ألفا (تامسولوسين في Duodart) قد تزيد الدوخة/هبوط الضغط مع خافضات الضغط الأخرى. راقب السقوط والضغط.",
      refs: ["JALYN_LABEL"]
    };
  }
  return null;
}

function checkMetforminRenal(items, eGFR) {
  const met = items.find(x => x.generic.startsWith("metformin"));
  if (!met || eGFR == null) return null;
  if (eGFR < 30) {
    return {
      id: "METFORMIN_CONTRA",
      level: "high",
      summary: "الميتفورمين مُضاد استطباب عند eGFR < 30",
      detail: "أوقف/لا تبدأ الميتفورمين. فكر ببدائل. ",
      refs: ["KDIGO_2022"]
    };
  } else if (eGFR >= 30 && eGFR < 45) {
    return {
      id: "METFORMIN_REDUCE",
      level: "review",
      summary: "تقليل جرعة الميتفورمين عند eGFR 30–44",
      detail: "حدّ الجرعة اليومية (عادة ≤1000مغ/يوم XR) وراقب وظائف الكلى وفيتامين B12.",
      refs: ["KDIGO_2022"]
    };
  }
  return null;
}

function checkGliclazideRenal(items, eGFR) {
  const glic = items.find(x => x.generic.includes("gliclazide"));
  if (!glic || eGFR == null) return null;
  if (eGFR < 30) {
    return {
      id: "GLICLAZIDE_AVOID_SEVERE_CKD",
      level: "review",
      summary: "تجنّب/خفض جرعة الجليكلازيد عند قصور كلوي شديد",
      detail: "خطر هبوط سكر؛ يُنصح بتجنّبه أو تقليل الجرعة عند eGFR <30 ومراقبة لصيقة.",
      refs: ["GLICLAZIDE_CKD"]
    };
  }
  return null;
}

function checkRosuvastatinRenal(items, eGFR, doseTextMap) {
  const rosu = items.find(x => x.generic.startsWith("rosuvastatin"));
  if (!rosu || eGFR == null) return null;
  if (eGFR < 30) {
    // if dose >10 mg flag high
    const txt = doseTextMap.get(rosu.original) || rosu.doseText || "";
    const mgMatch = txt.match(/(\d+)\s*mg/) || rosu.generic.match(/(\d+)\s*mg/);
    const mg = mgMatch ? parseInt(mgMatch[1],10) : null;
    if (mg == null || mg > 10) {
      return {
        id: "ROSU_MAX10_SEVERE_CKD",
        level: "high",
        summary: "روزوفاستاتين: لا تتجاوز 10mg عند قصور كلوي شديد",
        detail: "يوصى ببدء 5mg ولا تتجاوز 10mg في القصور الكلوي الشديد.",
        refs: ["CRESTOR_LABEL"]
      };
    }
  }
  return null;
}

function checkAcetaminophenMax(items, totalDailyMg) {
  const apap = items.find(x => x.generic.includes("paracetamol") || x.generic.includes("acetaminophen"));
  if (!apap || totalDailyMg == null) return null;
  if (totalDailyMg > 4000) {
    return {
      id: "APAP_MAX_4G",
      level: "high",
      summary: "الباراسيتامول > 4 جم/يوم",
      detail: "تجاوز الحد الأقصى الموصى به للبالغين (4 جم/24 ساعة).",
      refs: ["APAP_ADULT_MAX"]
    };
  }
  return null;
}

function checkPPIDuration(items, durationDays) {
  const ppi = items.find(x => x.class === "PPI");
  if (!ppi || durationDays == null) return null;
  if (durationDays >= 90) {
    return {
      id: "PPI_LONG_DURATION",
      level: "caution",
      summary: "مدة PPI طويلة",
      detail: "الاستمرار 8 أسابيع شائع لعلاج الارتجاع/التآكل ثم إعادة التقييم، أما الاستخدام المزمن فيلزم مبررات واضحة.",
      refs: ["PANTOPRAZOLE_LABEL"]
    };
  }
  return null;
}

function analyzePrescription({
  ocrList,              // [{name:"Duodart", dose:"0.5/0.4 mg 1x90"}, ...]
  patient = {}          // {age, sex, eGFR, smoker, visualSymptoms}
}) {
  // 1) Normalize & map
  const items = ocrList.map(x => mapItem(x.name, x.dose||""));

  // 2) Build dose map for some rules
  const doseTextMap = new Map(ocrList.map(x => [x.name, x.dose||""]));

  // 3) Rules
  const findings = [];
  const push = f => { if (f) findings.push(f); };

  push(checkHypertensionOverlap(items));
  push(checkBPHWithBP(items));
  push(checkMetforminRenal(items, patient.eGFR));
  push(checkGliclazideRenal(items, patient.eGFR));
  push(checkRosuvastatinRenal(items, patient.eGFR, doseTextMap));

  // optional inputs if متوفرة لديك
  if (patient.apapDailyMg != null) push(checkAcetaminophenMax(items, patient.apapDailyMg));
  if (patient.ppiDurationDays != null) push(checkPPIDuration(items, patient.ppiDurationDays));

  // 4) Score & output
  const score = (() => {
    // simple heuristic: start from 100, subtract per issue
    let s = 100;
    for (const f of findings) {
      if (f.level === "high") s -= 25;
      else if (f.level === "review") s -= 15;
      else s -= 8;
    }
    return Math.max(0, Math.min(100, s));
  })();

  // 5) References registry for front-end rendering
  const REF_MAP = {
    ACC_AHA_2017: {
      title: "2017 ACC/AHA Hypertension Guideline",
      url: "https://www.acc.org/~/media/Non-Clinical/Files-PDFs-Excel-MS-Word-etc/Guidelines/2017/Guidelines_Made_Simple_2017_HBP.pdf"
    },
    KDIGO_2022: {
      title: "KDIGO 2022 Diabetes in CKD – Metformin eGFR guidance",
      url: "https://kdigo.org/wp-content/uploads/2022/10/KDIGO-2022-Clinical-Practice-Guideline-for-Diabetes-Management-in-CKD.pdf"
    },
    CRESTOR_LABEL: {
      title: "CRESTOR (rosuvastatin) FDA label – renal dosing",
      url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/021366s043s044lbl.pdf"
    },
    JALYN_LABEL: {
      title: "JALYN (dutasteride/tamsulosin) FDA label – orthostatic hypotension",
      url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2011/022460s001lbl.pdf"
    },
    PANTOPRAZOLE_LABEL: {
      title: "Pantoprazole (PROTONIX) label – typical dosing durations",
      url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2012/020987s045lbl.pdf"
    },
    APAP_ADULT_MAX: {
      title: "Adult acetaminophen maximum daily dose (4g)",
      url: "https://www.nhs.uk/medicines/paracetamol-for-adults/how-and-when-to-take-paracetamol-for-adults/"
    },
    GLICLAZIDE_CKD: {
      title: "Gliclazide (Diamicron MR) – caution/avoid in severe CKD",
      url: "https://www.albertahealthservices.ca/assets/about/scn/ahs-scn-don-pccdm-diabetes-medication-titration-guideline.pdf"
    }
  };

  // 6) Build per-item table with acceptance suggestion
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
      status
    };
  });

  // 7) Return payload
  return {
    patient: { ...patient },
    summaryScore: score,
    items: table,
    findings,
    references: REF_MAP
  };
}

// Example HTTP handler (Next.js API route)
async function handler(req, res) {
  try {
    const { ocrList, patient } = req.body || {};
    const result = analyzePrescription({ ocrList, patient });
    res.status(200).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "analysis_failed", message: e?.message });
  }
}

// Export for both direct use and as API
module.exports = { analyzePrescription, handler };
