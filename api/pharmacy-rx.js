// pages/api/rx-genius.js
// ==================================================================
// ==        مُحلّل الوصفات الطبية "العين + العقل" (إصدار عبقري)   ==
// ==  OCR/Extraction → Rules (تنبيهات حتمية) → LLM تحليل + HTML   ==
// ==      SDK حديث (@google/genai) + Files API + JSON Mode         ==
// ==================================================================

import {
  GoogleGenAI,
  createUserContent,
  createPartFromBase64,
  createPartFromUri,
} from "@google/genai";

export const config = { api: { bodyParser: { sizeLimit: "25mb" } } };

// -------- إعدادات عامة --------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const MODELS = {
  EXTRACT: "gemini-2.5-flash", // سريع ورخيص للاستخراج
  ANALYZE: "gemini-2.5-pro",   // أعمق للتحليل السريري وإخراج HTML
};

const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // >4MB نرفع عبر Files API
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 120 * 1000;

// -------- CSS المطلوب + System Instruction موحّد --------
const REPORT_CSS = `
<style>
    .report-container { direction: rtl; font-family: 'Amiri', serif; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
    .report-title { font-size: 24px; font-weight: 700; color: #1e40af; margin-bottom: 12px; border-bottom: 2px solid #60a5fa; padding-bottom: 8px; }
    .report-subtitle { font-size: 18px; font-weight: 600; color: #1d4ed8; margin-top: 20px; margin-bottom: 10px; }
    .patient-summary p { font-size: 16px; line-height: 1.6; margin: 4px 0; }
    .meds-table { width: 100%; border-collapse: separate; border-spacing: 0 10px; margin-top: 10px; }
    .meds-table th { text-align: right; padding: 12px 15px; color: #374151; background-color: #f3f4f6; border-bottom: 2px solid #e5e7eb; font-size: 14px; }
    .meds-table td { text-align: right; padding: 14px 15px; background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); font-size: 15px; vertical-align: middle; }
    .dose-cell { font-weight: 600; color: #1e40af; background-color: #eff6ff; }
    .interaction-badge { display: inline-block; width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 50%; color: white; font-weight: 700; font-size: 12px; margin: 2px; }
    .interaction-badge.high { background-color: #ef4444; }
    .interaction-badge.moderate { background-color: #f97316; }
    .interaction-badge.low { background-color: #22c55e; }
    .interaction-badge.info { background-color: #3b82f6; }
    .findings-list { list-style-type: none; padding-right: 0; }
    .findings-list li { background: #fff; border-right: 5px solid; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.06); padding: 14px; margin-bottom: 12px; }
    .findings-list li[data-severity="high"] { border-color: #ef4444; }
    .findings-list li[data-severity="moderate"] { border-color: #f97316; }
    .findings-list li[data-severity="low"] { border-color: #22c55e; }
    .findings-list li[data-severity="info"] { border-color: #3b82f6; }
    .finding-title { font-size: 16px; font-weight: 700; }
    .finding-description { font-size: 15px; line-height: 1.7; color: #4b5563; margin-top: 8px; }
    .recommendations ol { padding-right: 20px; }
    .recommendations li { font-size: 15px; line-height: 1.8; margin-bottom: 8px; }
    .disclaimer { margin-top: 20px; font-size: 12px; text-align: center; color: #6b7280; }
</style>
`;

const SYSTEM_INSTRUCTION = `
أنت "صيدلي إكلينيكي خبير" ومصمم واجهات معلومات طبية. أنشئ تقرير HTML تفاعليًا متقنًا يبدأ بوسم <style> (كما هو مذكور) ثم <div class="report-container"> بالترتيب التالي:
1) عنوان: <h3 class="report-title">تحليل الوصفة الطبية الشامل</h3>
2) ملخص المريض
3) جدول الأدوية (الدواء / الجرعة (أضف class="dose-cell") / طريقة الأخذ / التداخلات / التعارض مع الحالة)
4) تفاصيل التحليل السريري (قائمة مرقمة <ol class="findings-list">)
5) خطة العمل والتوصيات
6) إخلاء مسؤولية في النهاية

آلية الربط البصري (إلزامية):
- كل ملاحظة مُرقّمة (1,2,3,...) في قسم التحليل يجب أن تقابلها شارة مرقّمة <span class="interaction-badge {high|moderate|low|info}">N</span> داخل خلايا الأعمدة المناسبة في جدول الأدوية للأدوية المعنية.
- انقل أي "تنبيهات حتمية" (pre_flags) تُزوَّد لك إلى ملاحظات واضحة بنفس الأرقام والألوان، وادمجها مع تحليلك السريري.

مطلوب الدقة والوضوح واللغة العربية الفصيحة، ولا تُخرج أي نص خارج كتلة HTML واحدة تبدأ بـ <style>.
`;

// -------- مخطط JSON مُحكّم لمرحلة الاستخراج (JSON Mode) --------
const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    medications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          strength: { type: "string" },
          frequency: { type: "string" },
          route: { type: "string" },
        },
        required: ["name"],
      },
    },
    diagnoses: { type: "array", items: { type: "string" } },
  },
  required: ["medications"],
};

// -------- أدوات مساعدة --------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, { retries = 2, backoffMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      if (i < retries && (RETRY_STATUS.has(status) || !status)) {
        await sleep(backoffMs * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function stripCodeFences(s = "") {
  return (s || "").replace(/```html|```/g, "").trim();
}

function parseDataUrl(dataUrl) {
  // data:<mime>;base64,<data>
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return null;
  const mimeType = m[1];
  const base64 = m[2];
  const buffer = Buffer.from(base64, "base64");
  return { mimeType, base64, buffer };
}

async function buildFilePartsFromImages(images = []) {
  const parts = [];
  for (const url of images) {
    if (typeof url !== "string" || !url.startsWith("data:")) continue;
    const parsed = parseDataUrl(url);
    if (!parsed) continue;
    const { mimeType, base64, buffer } = parsed;

    if (buffer.byteLength > MAX_INLINE_FILE_BYTES) {
      // رفع عبر Files API (ملفات أكبر)
      const blob = new Blob([buffer], { type: mimeType }); // متاح في Node 18+
      const uploaded = await withRetry(() =>
        ai.files.upload({ file: blob, config: { mimeType } })
      );
      parts.push(createPartFromUri(uploaded.uri, uploaded.mimeType));
    } else {
      // تضمين مباشر Base64
      parts.push(createPartFromBase64(base64, mimeType));
    }
  }
  return parts;
}

// -------- طبقة تنبيهات حتمية (Rules) قبل الـ LLM --------
// تبسيط: تطبيع الاسم + مطابقة مجموعات أدوية شائعة
function normalizeDrugName(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9\s/.-]+/g, "").trim();
}

const CLASS = {
  ACEI: ["lisinopril", "enalapril", "ramipril", "perindopril", "captopril", "benazepril"],
  ARB: ["losartan", "valsartan", "irbesartan", "candesartan", "olmesartan", "telmisartan"],
  NSAID: ["ibuprofen", "naproxen", "diclofenac", "indomethacin", "ketoprofen", "celecoxib", "etoricoxib", "meloxicam", "aspirin"], // ملاحظة: جرعات عالية من الأسبرين
  STATIN: ["simvastatin", "atorvastatin", "lovastatin", "pravastatin", "rosuvastatin", "pitavastatin", "fluvastatin"],
  STRONG_CYP3A4I: ["clarithromycin", "erythromycin", "ketoconazole", "itraconazole", "voriconazole", "posaconazole", "ritonavir", "cobicistat"],
  NITRATE: ["nitroglycerin", "isosorbide mononitrate", "isosorbide dinitrate"],
  PDE5: ["sildenafil", "tadalafil", "vardenafil", "avanafil"],
  BENZO: ["diazepam", "lorazepam", "clonazepam", "alprazolam", "temazepam", "chlordiazepoxide"],
  OPIOID: ["morphine", "oxycodone", "hydrocodone", "codeine", "fentanyl", "buprenorphine", "tramadol", "methadone"],
  SSRI: ["fluoxetine", "sertraline", "citalopram", "escitalopram", "paroxetine", "fluvoxamine"],
  SNRI: ["venlafaxine", "desvenlafaxine", "duloxetine"],
  MAOI: ["phenelzine", "tranylcypromine", "isocarboxazid", "selegiline"],
  TRIPTAN: ["sumatriptan", "rizatriptan", "zolmitriptan", "eletriptan", "almotriptan", "naratriptan", "frovatriptan"],
  WARFARIN: ["warfarin"],
  AMIODARONE: ["amiodarone"],
  MRA: ["spironolactone", "eplerenone"],
  K_SUPP: ["potassium chloride", "kcl", "potassium citrate"],
  METFORMIN: ["metformin"],
  NITROFURANTOIN: ["nitrofurantoin"],
  SGLT2: ["empagliflozin", "dapagliflozin", "canagliflozin", "ertugliflozin"],
  LITHIUM: ["lithium"],
  TETRACYCLINE: ["doxycycline", "minocycline", "tetracycline"],
  TRIMETHOPRIM: ["trimethoprim", "co-trimoxazole", "sulfamethoxazole/trimethoprim", "tmp/smx"],
};

function anyOf(list, bag) {
  const found = [];
  for (const n of list) if (bag.has(n)) found.push(n);
  return found;
}

function computePreFlags(patient = {}, meds = []) {
  const flags = [];
  const names = meds.map((m) => normalizeDrugName(m.name));
  const bag = new Set(names);

  const eGFR = Number.isFinite(patient?.eGFR) ? Number(patient.eGFR) : null;
  const age = Number.isFinite(patient?.age) ? Number(patient.age) : null;
  const pregnant = !!(patient?.pregnancy?.pregnant);

  const present = (cls) => anyOf(CLASS[cls] || [], bag);

  // 1) PDE5 + Nitrate -> ممنوع
  if (present("PDE5").length && present("NITRATE").length) {
    flags.push({
      id: 1,
      severity: "high",
      title: "تعارض قاتل: مثبطات PDE5 مع النترات",
      medsInvolved: [...present("PDE5"), ...present("NITRATE")],
      description: "خطر هبوط شديد في الضغط. هذا مزيج مضاد للاستطباب.",
    });
  }

  // 2) Warfarin + NSAID
  if (present("WARFARIN").length && present("NSAID").length) {
    flags.push({
      id: 2,
      severity: "high",
      title: "خطر نزف: وارفارين مع NSAIDs",
      medsInvolved: [...present("WARFARIN"), ...present("NSAID")],
      description: "يزداد خطر النزف بشكل ملحوظ. فكّر ببدائل مسكّنة آمنة أو ضبط INR.",
    });
  }

  // 3) ACEI + ARB (ازدواج محور RAS)
  if (present("ACEI").length && present("ARB").length) {
    flags.push({
      id: 3,
      severity: "moderate",
      title: "ازدواجية علاجية: ACEI + ARB",
      medsInvolved: [...present("ACEI"), ...present("ARB")],
      description: "لا يوصى بالجمع الروتيني لزيادة خطر فرط بوتاسيوم الدم والضرر الكلوي.",
    });
  }

  // 4) ستاتين + مُثبط CYP3A4 قوي (خصوصًا سيمفاستاتين/لوفاستاتين)
  const stat = present("STATIN");
  const cypi = present("STRONG_CYP3A4I");
  if (stat.length && cypi.length) {
    const isSimOrLova = stat.some((s) => /simvastatin|lovastatin/.test(s));
    flags.push({
      id: 4,
      severity: isSimOrLova ? "high" : "moderate",
      title: "تداخل استقلابي: ستاتين + مثبط CYP3A4 قوي",
      medsInvolved: [...stat, ...cypi],
      description:
        "يزداد خطر الاعتلال العضلي/انحلال الربيدات؛ تجنّب سيمفاستاتين/لوفاستاتين تحديدًا مع هذه المضادات.",
    });
  }

  // 5) وارفارين + أميودارون
  if (present("WARFARIN").length && present("AMIODARONE").length) {
    flags.push({
      id: 5,
      severity: "high",
      title: "وارفارين + أميودارون",
      medsInvolved: [...present("WARFARIN"), ...present("AMIODARONE")],
      description: "يزداد INR وخطر النزف؛ يلزم ضبط جرعة ومراقبة لصيقة.",
    });
  }

  // 6) مهدئات بنزوديازيبين + أفيونات
  if (present("BENZO").length && present("OPIOID").length) {
    flags.push({
      id: 6,
      severity: "high",
      title: "كبت تنفّس: بنزوديازيبين + أفيون",
      medsInvolved: [...present("BENZO"), ...present("OPIOID")],
      description: "تحذير صندوق أسود؛ تجنّب المزج أو راقب بشدة وخفّض الجرعات.",
    });
  }

  // 7) SSRI/SNRI + MAOI (ممنوع) أو + Triptan (خطر متلازمة السيروتونين)
  if ((present("SSRI").length || present("SNRI").length) && present("MAOI").length) {
    flags.push({
      id: 7,
      severity: "high",
      title: "مضاد استطباب: SSRI/SNRI + MAOI",
      medsInvolved: [...present("SSRI"), ...present("SNRI"), ...present("MAOI")],
      description: "خطر مرتفع لمتلازمة السيروتونين.",
    });
  } else if ((present("SSRI").length || present("SNRI").length) && present("TRIPTAN").length) {
    flags.push({
      id: 8,
      severity: "moderate",
      title: "SSRI/SNRI + Triptan",
      medsInvolved: [...present("SSRI"), ...present("SNRI"), ...present("TRIPTAN")],
      description: "احتمال متلازمة السيروتونين؛ راقب الأعراض وخفّض الجرعات عند الحاجة.",
    });
  }

  // 8) اعتبارات الكُلى
  if (eGFR !== null) {
    if (present("METFORMIN").length && eGFR < 30) {
      flags.push({
        id: 9,
        severity: "high",
        title: "ميتفورمين مع eGFR < 30",
        medsInvolved: present("METFORMIN"),
        description: "خطر الحماض اللبني؛ مضاد للاستطباب تحت 30.",
      });
    } else if (present("METFORMIN").length && eGFR >= 30 && eGFR < 45) {
      flags.push({
        id: 10,
        severity: "moderate",
        title: "ميتفورمين مع eGFR بين 30–45",
        medsInvolved: present("METFORMIN"),
        description: "يلزم تقليل الجرعة ومراقبة لصيقة.",
      });
    }
    if (present("NITROFURANTOIN").length && eGFR < 30) {
      flags.push({
        id: 11,
        severity: "high",
        title: "نيتروفورانتوين مع قصور كلوي",
        medsInvolved: present("NITROFURANTOIN"),
        description: "فعالية منخفضة وتراكم دوائي؛ تجنّب عند eGFR < 30.",
      });
    }
    if (present("NSAID").length && eGFR < 60) {
      flags.push({
        id: 12,
        severity: "moderate",
        title: "NSAIDs ومرض كلوي",
        medsInvolved: present("NSAID"),
        description: "خطر تدهور الوظيفة الكلوية؛ استخدم أقل جرعة/أقصر مدة أو بدائل.",
      });
    }
    if (present("SGLT2").length && eGFR < 30) {
      flags.push({
        id: 13,
        severity: "moderate",
        title: "بدء/استمرار SGLT2 عند eGFR منخفض",
        medsInvolved: present("SGLT2"),
        description: "قيود بحسب الصنف والدواء؛ راجع الملصق الخاص بكل دواء.",
      });
    }
  }

  // 9) الحمل
  if (pregnant) {
    if (present("ACEI").length || present("ARB").length) {
      flags.push({
        id: 14,
        severity: "high",
        title: "الحمل: مانعات الإنزيم المحول/مضادات مستقبلات الأنجيوتنسين",
        medsInvolved: [...present("ACEI"), ...present("ARB")],
        description: "مضاد استطباب في الحمل (سمّية جنينية).",
      });
    }
    if (present("STATIN").length) {
      flags.push({
        id: 15,
        severity: "high",
        title: "الحمل: ستاتينات",
        medsInvolved: present("STATIN"),
        description: "يُتجنّب استعمالها أثناء الحمل.",
      });
    }
    if (present("WARFARIN").length) {
      flags.push({
        id: 16,
        severity: "high",
        title: "الحمل: وارفارين",
        medsInvolved: present("WARFARIN"),
        description: "تشوّهات جنينية؛ فكّر بالهيبارين منخفض الوزن الجزيئي.",
      });
    }
    if (present("TETRACYCLINE").length) {
      flags.push({
        id: 17,
        severity: "moderate",
        title: "الحمل: تتراسيكلين",
        medsInvolved: present("TETRACYCLINE"),
        description: "تلطيخ الأسنان/تثبيط نمو العظام؛ يُتجنّب.",
      });
    }
    if (present("TRIMETHOPRIM").length) {
      flags.push({
        id: 18,
        severity: "moderate",
        title: "الحمل: تريميثوبريم",
        medsInvolved: present("TRIMETHOPRIM"),
        description: "مثبّط حمض الفوليك؛ يُتوخّى الحذر خصوصًا بالثلث الأول.",
      });
    }
  }

  // 10) فرط بوتاسيوم الدم: ACEI/ARB + MRA ± مكمل بوتاسيوم
  if ((present("ACEI").length || present("ARB").length) && present("MRA").length) {
    flags.push({
      id: 19,
      severity: "high",
      title: "خطر فرط بوتاسيوم الدم: RAS + سبيرونولاكتون/إبليرينون",
      medsInvolved: [...present("ACEI"), ...present("ARB"), ...present("MRA")],
      description: "راقب البوتاسيوم/الكرياتينين عن كثب وتجنّب مكملات K.",
    });
  }
  if ((present("ACEI").length || present("ARB").length) && present("K_SUPP").length) {
    flags.push({
      id: 20,
      severity: "moderate",
      title: "RAS + مكملات بوتاسيوم",
      medsInvolved: [...present("ACEI"), ...present("ARB"), ...present("K_SUPP")],
      description: "احذر ارتفاع K خاصة في القصور الكلوي.",
    });
  }

  // 11) ليثيوم + (مدر/NSAID/ACEI/ARB)
  if (present("LITHIUM").length && (present("NSAID").length || present("ACEI").length || present("ARB").length)) {
    flags.push({
      id: 21,
      severity: "high",
      title: "ليثيوم وتداخلات ترفع مستوياته",
      medsInvolved: [...present("LITHIUM"), ...present("NSAID"), ...present("ACEI"), ...present("ARB")].filter(Boolean),
      description: "خطر سمّية الليثيوم؛ راقب المستويات وعدّل الجرعات.",
    });
  }

  // 12) شيخوخة + بنزوديازيبين
  if (age !== null && age >= 65 && present("BENZO").length) {
    flags.push({
      id: 22,
      severity: "moderate",
      title: "كبار السن: بنزوديازيبين وخطر السقوط",
      medsInvolved: present("BENZO"),
      description: "فضّل بدائل/أقل جرعة ومراقبة التهدئة والتوازن.",
    });
  }

  // أعد ترقيم الملاحظات تسلسليًا (1..N) حتى لو حُذِف بعضها
  return flags.map((f, idx) => ({ ...f, id: idx + 1 }));
}

// -------- بناء مطالبات المستخدم --------
function buildExtractionPrompt(patient = {}, texts = []) {
  return [
    "أنت خبير OCR. استخرج JSON صالحًا فقط وفق المخطط المطلوب (medications/diagnoses).",
    "",
    "**نص الوصفة/الملاحظات:**",
    texts.join("\n").slice(0, 20000),
  ].join("\n");
}

function buildAnalysisUserPrompt(patient = {}, extracted = {}, preFlags = []) {
  return [
    `**بيانات المريض:**`,
    `- العمر: ${patient?.age ?? "غير محدد"}`,
    `- الجنس: ${patient?.sex ?? "غير محدد"}`,
    `- وظائف الكلى (eGFR): ${patient?.eGFR ?? "غير محدد"}`,
    `- الحمل: ${patient?.pregnancy?.pregnant ? `نعم${patient?.pregnancy?.weeks ? `، ${patient.pregnancy.weeks} أسابيع` : ""}` : "لا"}`,
    `- حالة الكبد: ${patient?.liverDisease ? "يوجد مرض كبدي" : "طبيعي"}`,
    "",
    `**البيانات المستخرجة (JSON):**`,
    JSON.stringify(extracted || {}, null, 2),
    "",
    `**تنبيهات حتمية (pre_flags) - دمجها إلزامي في التحليل والشارات:**`,
    JSON.stringify(preFlags || [], null, 2),
  ].join("\n");
}

// ==================== معالج الطلب الرئيسي ====================
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");

    const { texts = [], images = [], patient = {} } = req.body || {};

    // 0) تجهيز أجزاء الملفات (inline أو upload)
    const fileParts = await buildFilePartsFromImages(images);

    // 1) الخبير الأول (العين): استخراج منظم بصيغة JSON
    const extractionContents = [
      createUserContent([buildExtractionPrompt(patient, texts), ...fileParts]),
    ];

    const extractResp = await withRetry(() =>
      ai.models.generateContent({
        model: MODELS.EXTRACT,
        contents: extractionContents,
        config: {
          responseMimeType: "application/json",
          responseSchema: EXTRACTION_SCHEMA,
          temperature: 0.1,
        },
      })
    );

    let extracted;
    try {
      extracted = JSON.parse(extractResp.text || "{}");
    } catch {
      extracted = { medications: [], diagnoses: [] };
    }

    // 1.5) قواعد حتمية (preFlags) على البيانات المستخرجة
    const preFlags = computePreFlags(patient, extracted.medications || []);

    // 2) الخبير الثاني (العقل): تحليل سريري + تقرير HTML موحّد
    const analysisContents = [
      createUserContent([buildAnalysisUserPrompt(patient, extracted, preFlags), ...fileParts]),
    ];

    const analyzeResp = await withRetry(() =>
      ai.models.generateContent({
        model: MODELS.ANALYZE,
        contents: analysisContents,
        config: {
          systemInstruction: `${REPORT_CSS}\n${SYSTEM_INSTRUCTION}`,
          maxOutputTokens: 8192,
          temperature: 0.2,
        },
      })
    );

    let html = stripCodeFences(analyzeResp.text || "");

    // Fallback ذكي: لو النموذج نسي <style>، نُعيد الطلب ككتلة HTML مُباشرة
    if (!/^<style>/i.test(html)) {
      const fallbackResp = await ai.models.generateContent({
        model: MODELS.ANALYZE,
        contents: analysisContents,
        config: {
          systemInstruction: `${REPORT_CSS}\n${SYSTEM_INSTRUCTION}`,
          maxOutputTokens: 8192,
          temperature: 0.1,
        },
      });
      html = stripCodeFences(fallbackResp.text || "");
    }

    // ضمان إدراج الـ CSS في البداية
    if (!/^<style>/i.test(html)) {
      html = `${REPORT_CSS}\n${html}`;
    }

    return res.status(200).json({
      ok: true,
      html,
      extracted,     // للمراجعة/الديباغ (اختياري في الواجهة)
      preFlags,      // التنبيهات الحتمية التي استُخدمت في الربط البصري
      modelInfo: MODELS,
    });
  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({
      ok: false,
      error: "Internal Server Error",
      message: err?.message || "Unknown error",
    });
  }
}
