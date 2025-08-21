// api/analyze.js

// --- تكوين Next.js لرفع ملفات كبيرة ---
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};

// --- المتغيّرات الأساسية ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

// --- دوال مساعدة عامة ---
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

const parseJsonSafe = async (response) =>
  (response.headers.get("content-type") || "").includes("application/json")
    ? response.json()
    : { raw: await response.text() };

// يحوّل الأرقام العربية-الهندية إلى إنجليزية (مثال: ٩٠ → 90)
function toEnglishDigits(str = "") {
  const map = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
  return String(str).replace(/[٠-٩]/g, (d) => map[d] || d);
}

// استخراج أول كائن JSON من نص متّصل
function extractFirstJson(text = "") {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = s.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // محاولة تنظيف فاصلات زائدة
      try {
        const cleaned = candidate.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
        return JSON.parse(cleaned);
      } catch {
        return null;
      }
    }
  }
  return null;
}

// --- تحليل المدة والتكرار لتقدير أيام الصرف ---
function parseDurationToDays(duration = "") {
  if (!duration) return null;
  const d = toEnglishDigits(duration).toLowerCase();
  // أنماط شائعة: x90 / 90d / 3 months / 12 wk
  const m1 = d.match(/x\s*(\d{1,4})\b/);
  if (m1) return parseInt(m1[1], 10);
  const m2 = d.match(/(\d{1,4})\s*(d|day|days)\b/);
  if (m2) return parseInt(m2[1], 10);
  const m3 = d.match(/(\d{1,3})\s*(w|wk|wks|week|weeks)\b/);
  if (m3) return parseInt(m3[1], 10) * 7;
  const m4 = d.match(/(\d{1,2})\s*(m|mo|mos|month|months)\b/);
  if (m4) return parseInt(m4[1], 10) * 30;
  const m5 = d.match(/(\d{1,2})\s*(y|yr|year|years)\b/);
  if (m5) return parseInt(m5[1], 10) * 365;
  // أحيانًا تُكتب 90 فقط مع كلمة "صرف" أو "مدة"
  if (/\b90\b/.test(d)) return 90;
  return null;
}

function parseFrequencyPerDay(freq = "") {
  if (!freq) return null;
  const f = toEnglishDigits(freq).toLowerCase().replace(/\s+/g, "");
  // خرائط شائعة
  if (/(od|qd|once|1x1|q24h)\b/.test(f)) return 1;
  if (/(bid|2x1|1x2|q12h)/.test(f)) return 2;
  if (/(tid|3x1|1x3|q8h)/.test(f)) return 3;
  if (/(qid|4x1|1x4|q6h)/.test(f)) return 4;
  if (/(qhs|hs)/.test(f)) return 1; // مرة مساءً
  if (/(qam|am)/.test(f)) return 1; // مرة صباحًا
  if (/weekly|qw|qwk/.test(f)) return 1 / 7;
  if (/q2d/.test(f)) return 0.5;
  // صيغ مثل "1x1x90" لاستخراج الجزء الأوسط
  const m = f.match(/(\d)\s*x\s*(\d)/);
  if (m) return parseInt(m[2], 10);
  return null;
}

function estimateDaySupply({ doseDuration, doseFrequency, daySupplyEstimate }) {
  if (Number.isFinite(daySupplyEstimate)) return daySupplyEstimate;
  const d = parseDurationToDays(doseDuration);
  if (d) return d;
  // إذا توفر التكرار فقط بلا مدة، لا يمكن تقدير أيام الصرف بدقة
  return null;
}

const PREGNANCY_RISK_CLASSES = [
  // فئات دوائية نموذجية يجب تجنّبها غالبًا في الحمل
  "statin",
  "ace inhibitor",
  "arb",
  "renin inhibitor",
  "warfarin",
  "isotretinoin",
  "valproate",
];

const BPH_MEDS = ["tamsulosin", "dutasteride", "finasteride", "duodart"];

// أدوات مطابقة نصية بسيطة
function includesAny(hay = "", needles = []) {
  const s = String(hay || "").toLowerCase();
  return needles.some((n) => s.includes(n.toLowerCase()));
}

// --- معالج رفع الملفات إلى Gemini ---
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, "base64");
  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(binaryData.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
  });
  if (!initRes.ok) throw new Error(`Gemini init failed: ${JSON.stringify(await parseJsonSafe(initRes))}`);
  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload session URL is missing");
  const uploadRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(binaryData.byteLength),
    },
    body: binaryData,
  });
  const metadata = await parseJsonSafe(uploadRes);
  if (!uploadRes.ok) throw new Error(`Gemini finalize failed: ${JSON.stringify(metadata)}`);
  return { uri: metadata?.file?.uri, mime: metadata?.file?.mime_type || mimeType };
}

// --- المرحلة (أ): OCR منضبط يعيد JSON شامل (دواء + إجراءات) ---
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });

  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    const { uri, mime: finalMime } = await geminiUploadBase64({
      name: file?.name || "unnamed_file",
      mimeType: mime,
      base64: base64Data,
    });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }

  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  const systemPrompt = `
أنت نظام OCR طبي خبير يستخلص النص اليدوي والطباعي بدقة جنائية ويعيد **JSON** منظمًا فقط.
قواعد صارمة:
1) استخرج **كل ما هو مكتوب**: بيانات المريض (العمر، الجنس، الوزن، الضغط، النبض، eGFR إن وُجد)، التشخيصات، الأدوية (Rx)، الإجراءات، التحاليل، الصور الشعاعية، التحويلات، والمستلزمات.
2) لكل عنصر:
   - type: medication | procedure | lab | imaging | referral | supply | supplement
   - raw: السطر الأصلي كما قُرئ
   - name, form, route, strength, frequency, duration, quantity, indication
   - durationDays: رقم إن أمكن (لا تُخمّن)
   - confidence: بين 0 و 1 لكل حقل (confidence.{field})
   - ambiguities: بدائل محتملة لعبارات ملتبسة (مثل: amlodipine/amlopine)
   - source: {page, box: [x1,y1,x2,y2] إن أمكن}
   - handwritten: true|false
3) لا تُسقِط أي عنصر حتى لو الثقة منخفضة؛ اذكره بثقة منخفضة.
أعد كائن JSON فقط بالمخطط التالي:
{
  "patient": { "name": "", "gender": "", "age": "", "weight": "", "vitals": {"bp": "", "hr": ""}, "eGFR": "" },
  "diagnoses": [ "..."],
  "items": [ { ... كما أعلاه ... } ]
}
`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
  };

  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);

  const textOut = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
  const parsed = extractFirstJson(textOut) || { patient: {}, diagnoses: [], items: [] };

  // تطبيع أولي للمدد والتكرار لتسهيل التدقيق اللاحق
  for (const it of parsed.items || []) {
    it.duration = it.duration || "";
    it.frequency = it.frequency || "";
    it.durationDays = Number.isFinite(it.durationDays) ? it.durationDays : parseDurationToDays(it.duration);
  }

  return parsed;
}

// --- تعليمات المدقّق الخبير (توسيع مخطط JSON) ---
function getExpertAuditorInstructions(lang = "ar") {
  const schema = {
    patientSummary: { text: "..." },
    overallAssessment: { text: "..." },
    table: [
      {
        name: "string",
        itemType: "medication|procedure|lab|imaging|referral|supply|supplement",
        therapyType: "Maintenance|Acute|Unknown",
        doseStrength: "string",
        doseFrequency: "string",
        doseDuration: "string",
        daySupplyEstimate: 0,
        status: "موصوف|تم إجراؤه|مفقود ولكنه ضروري",
        analysisCategory:
          "صحيح ومبرر|جرعة غير صحيحة|كمية عالية|إغفال خطير|تكرار علاجي|غير مبرر طبياً|إجراء يتعارض مع التشخيص",
        safetySignals: [
          { type: "Renal|Hepatic|Pregnancy|Gender|HR|BP|Age|Interaction|Other", severity: "Critical|Major|Minor", detail: "string" },
        ],
        conflictsWithPatient: ["string"],
        insuranceDecision: { label: "مقبول|مرفوض|للمراجعة|لا ينطبق", justification: "string" },
      },
    ],
    recommendations: [{ priority: "عاجلة|أفضل ممارسة", description: "string", relatedItems: ["string"] }],
  };

  return `
أنت صيدلي سريري ومدقّق طبي قائم على الأدلة. حلّل الحالة بعمق وأعد **JSON صالحًا فقط** بهذا المخطط:

${JSON.stringify(schema, null, 2)}

قواعد إلزامية (اختصار شديد):
- التزم بإرشادات: ADA 2025 لسكري، KDIGO 2024 للـ CKD، معايير Beers 2023، STOPP/START v3 2023. لا تُخالفها.
- اذكر **كل عنصر** من OCR (دواء/إجراء/مختبر/صورة/تحويل/مستلزم).
- املأ doseStrength/doseFrequency/doseDuration من OCR، وإن غاب اكتب "غير محدد".
- استنتج therapyType لكل دواء: Maintenance (مثبّت ضغط/ستاتين/ليفوثيروكسين/إنسولين قاعدي… إلخ) أو Acute (مضاد حيوي قصير…)، أو Unknown.
- احسب daySupplyEstimate (إن تعذّر، اترك 0).
- تضارب الجرعة مع حالة المريض: تحقّق من الجنس/الحمل/العمر/ضغط/نبض/eGFR/التشخيص:
  * أمثلة حرجة: Metformin عند eGFR<30 (إشارة حرجة)، أدوية BPH لمريضة أنثى، ACEi/ARB/Statin في الحمل (عادةً يجب التوقف).
- المدد: أي وصفة >30 يوم = "كمية عالية". 90+ يوم: لا تُقبل إلا لدواء Maintenance وبشروط الاستقرار؛ إن غاب الدليل اكتب "للمراجعة".
- التكرار العلاجي: اكتشف الازدواج لنفس المؤشر (مثل مثبّط ACE + ARB، أو اثنان من نفس الفئة دون مبرر).
- omissions: أضف ما يلزم كـ "مفقود ولكنه ضروري" (status)، و"لا ينطبق" للتأمين لهذه العناصر.
- المخرجات بالعربية الفصحى، مختصرة ومهنية.
`;
}

// --- استدعاء OpenAI للحصول على JSON مُنظّم ---
async function getAuditFromOpenAI(bundle) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      messages: [
        { role: "system", content: getExpertAuditorInstructions("ar") },
        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

// --- طبقة تدقيق حتمية بعدية لمعالجة النقاط الحرجة (90 يوم/التضارب) ---
function postProcessPolicyAndSafety(structured, patientInfo) {
  const gender = (patientInfo?.gender || patientInfo?.sex || "").toLowerCase();
  const pregnant = Boolean(patientInfo?.pregnant);
  const hr = Number(toEnglishDigits(patientInfo?.vitals?.hr || patientInfo?.hr || "")) || null;
  const eGFR = Number(toEnglishDigits(patientInfo?.eGFR || patientInfo?.renal?.eGFR || "")) || null;

  structured.table = (structured.table || []).map((row) => {
    const r = { ...row };

    // تقدير أيام الصرف
    const estimatedDays = estimateDaySupply({
      doseDuration: r.doseDuration,
      doseFrequency: r.doseFrequency,
      daySupplyEstimate: r.daySupplyEstimate,
    });
    r.daySupplyEstimate = Number.isFinite(estimatedDays) ? estimatedDays : 0;

    // وسم "كمية عالية" تلقائيًا
    if (r.daySupplyEstimate > 30 && !/كمية عالية/.test(r.analysisCategory || "")) {
      r.analysisCategory = r.analysisCategory || "كمية عالية";
    }

    // سياسة 90+ يوم
    if (r.daySupplyEstimate >= 90 && r.itemType === "medication") {
      const tt = (r.therapyType || "Unknown").toLowerCase();
      if (tt !== "maintenance") {
        r.insuranceDecision = r.insuranceDecision || {};
        r.insuranceDecision.label = "مرفوض";
        r.insuranceDecision.justification =
          r.insuranceDecision.justification ||
          "صرف لمدة 90 يومًا لدواء غير صيانـي؛ السياسات عادةً تقصر الكميات الكبيرة على أدوية الصيانة وتتطلّب مبررات/موافقة مسبقة.";
      } else {
        // Maintenance ولكن بلا دليل استقرار
        if (!/مستقر|ثابت|متابع/.test((structured.patientSummary?.text || "") + " " + (r.justification || ""))) {
          r.insuranceDecision = r.insuranceDecision || {};
          if (!r.insuranceDecision.label || r.insuranceDecision.label === "مقبول")
            r.insuranceDecision.label = "للمراجعة";
          r.insuranceDecision.justification =
            r.insuranceDecision.justification ||
            "صرف 90 يومًا لدواء صيانـي: يُفضّل التأكد من استقرار الجرعة وسياسة الخطة/الصيدلية (غالبًا عبر بريد/توريد ممتد).";
        }
      }
    }

    // إشارات سلامة حتمية
    r.safetySignals = r.safetySignals || [];
    r.conflictsWithPatient = r.conflictsWithPatient || [];

    // جنس أنثى + أدوية BPH
    if (gender === "female" && includesAny(r.name, BPH_MEDS)) {
      r.safetySignals.push({ type: "Gender", severity: "Critical", detail: "دواء لعلاج تضخّم البروستاتا وُصف لمريضة." });
      r.analysisCategory = "إجراء يتعارض مع التشخيص";
      r.conflictsWithPatient.push("عدم اتساق الدواء مع جنس المريضة");
      r.insuranceDecision = { label: "مرفوض", justification: "وصف دواء خاص بـ BPH لمريضة أنثى." };
    }

    // حمل + أدوية غالبًا مجتنبة
    if (pregnant && includesAny(r.name, PREGNANCY_RISK_CLASSES)) {
      r.safetySignals.push({
        type: "Pregnancy",
        severity: "Critical",
        detail: "دواء يُنصح غالبًا بتجنّبه أثناء الحمل؛ يلزم تقييم فائدة/مخاطر وإيقافه غالبًا.",
      });
      r.conflictsWithPatient.push("خطر على الحمل");
      if (!r.insuranceDecision?.label) r.insuranceDecision = { label: "للمراجعة", justification: "حمل قائم." };
    }

    // Metformin + eGFR<30
    if (eGFR !== null && eGFR < 30 && /metformin|glucophage|kazano|segluro/i.test(r.name || "")) {
      r.safetySignals.push({
        type: "Renal",
        severity: "Critical",
        detail: `eGFR=${eGFR} ml/min/1.73m²؛ الميتفورمين مُضاد استطباب عند eGFR<30.`,
      });
      r.analysisCategory = "غير مبرر طبياً";
      r.conflictsWithPatient.push("قصور كلوي شديد مع Metformin");
      r.insuranceDecision = { label: "مرفوض", justification: "مخاطر حماض لبني؛ بدائل آمنة مطلوبة." };
    }

    // بطء قلب شديد + حاصرات بيتا/Non-DHP (تحذير)
    if (hr !== null && hr < 50 && /(bisoprolol|metoprolol|atenolol|propranolol|carvedilol|verapamil|diltiazem)/i.test(r.name || "")) {
      r.safetySignals.push({
        type: "HR",
        severity: "Major",
        detail: `نبض منخفض (HR=${hr}); راجع ملاءمة الجرعة/الدواء.`,
      });
      if (!r.insuranceDecision?.label) r.insuranceDecision = { label: "للمراجعة", justification: "بطء قلب ملحوظ." };
    }

    return r;
  });

  return structured;
}

// --- عارض التقرير المتقدم (HTML Renderer) ---
function renderHtmlReport(structuredData, lang = "ar") {
  const s = structuredData;
  const isArabic = lang === "ar";
  const text = {
    summaryTitle: isArabic ? "ملخص الحالة والتقييم العام" : "Case Summary & Overall Assessment",
    detailsTitle: isArabic ? "التحليل التفصيلي للإجراءات" : "Detailed Analysis of Items",
    recommendationsTitle: isArabic ? "التوصيات والإجراءات المقترحة" : "Recommendations & Proposed Actions",
    itemHeader: isArabic ? "العنصر" : "Item",
    therapyTypeHeader: isArabic ? "نوع العلاج" : "Therapy Type",
    strengthHeader: isArabic ? "القوة" : "Strength",
    frequencyHeader: isArabic ? "التكرار" : "Frequency",
    durationHeader: isArabic ? "المدة" : "Duration",
    daysHeader: isArabic ? "أيام الصرف" : "Day Supply",
    statusHeader: isArabic ? "الحالة" : "Status",
    decisionHeader: isArabic ? "قرار التأمين" : "Insurance Decision",
    justificationHeader: isArabic ? "التحليل والتبرير" : "Analysis & Justification",
    signalsHeader: isArabic ? "تنبيهات الأمان" : "Safety Signals",
    relatedTo: isArabic ? "مرتبط بـ" : "Related to",
    notAvailable: isArabic ? "غير متوفر." : "Not available.",
  };

  const getDecisionStyle = (label) => {
    const normalizedLabel = (label || "").toLowerCase();
    if (normalizedLabel.includes("مقبول") || normalizedLabel.includes("accepted")) return "background-color:#e6f4ea;color:#1e8e3e;";
    if (normalizedLabel.includes("مرفوض") || normalizedLabel.includes("rejected")) return "background-color:#fce8e6;color:#d93025;";
    if (normalizedLabel.includes("للمراجعة") || normalizedLabel.includes("for review")) return "background-color:#fff0e1;color:#e8710a;";
    if (normalizedLabel.includes("لا ينطبق") || normalizedLabel.includes("not applicable")) return "background-color:#e8eaed;color:#5f6368;";
    return "background-color:#e8eaed;color:#3c4043;";
  };

  const getRiskClass = (category) => {
    const normalizedCategory = (category || "").toLowerCase();
    if (normalizedCategory.includes("إغفال") || normalizedCategory.includes("omission") || normalizedCategory.includes("جرعة غير صحيحة") || normalizedCategory.includes("يتعارض"))
      return "risk-critical";
    if (normalizedCategory.includes("كمية") || normalizedCategory.includes("quantity") || normalizedCategory.includes("تكرار علاجي"))
      return "risk-warning";
    if (normalizedCategory.includes("صحيح") || normalizedCategory.includes("correct")) return "risk-ok";
    return "";
  };

  const formatSignals = (signals = []) =>
    signals.length
      ? `<ul style="margin:0;padding-inline-start:18px">${signals
          .map((s) => `<li><b>${s.type}</b>: ${s.detail} (${s.severity})</li>`)
          .join("")}</ul>`
      : "-";

  const tableRows = (s.table || [])
    .map(
      (r) => `
      <tr class="${getRiskClass(r.analysisCategory)}">
        <td>
          <div class="item-name">${r.name || "-"}</div>
          <div class="item-category"><span>${r.itemType || ""}</span> — <span>${r.analysisCategory || ""}</span></div>
        </td>
        <td>${r.therapyType || "-"}</td>
        <td>${r.doseStrength || "-"}</td>
        <td>${r.doseFrequency || "-"}</td>
        <td>${r.doseDuration || "-"}</td>
        <td>${Number.isFinite(r.daySupplyEstimate) && r.daySupplyEstimate > 0 ? r.daySupplyEstimate : "-"}</td>
        <td>${r.status || "-"}</td>
        <td><span class="decision-badge" style="${getDecisionStyle(r.insuranceDecision?.label)}">${r.insuranceDecision?.label || "-"}</span></td>
        <td>${r.insuranceDecision?.justification || "-"}</td>
        <td>${formatSignals(r.safetySignals)}</td>
      </tr>`
    )
    .join("");

  const recommendationsList = (s.recommendations || [])
    .map((rec) => {
      const priorityClass = (rec.priority || "").toLowerCase();
      let borderClass = "best-practice-border";
      if (priorityClass.includes("عاجلة") || priorityClass.includes("urgent")) borderClass = "urgent-border";
      return `
        <div class="rec-item ${borderClass}">
          <span class="rec-priority ${priorityClass}">${rec.priority}</span>
          <div class="rec-content">
            <div class="rec-desc">${rec.description}</div>
            ${rec.relatedItems && rec.relatedItems.length > 0 ? `<div class="rec-related">${text.relatedTo}: ${rec.relatedItems.join(", ")}</div>` : ""}
          </div>
        </div>`;
    })
    .join("");

  return `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
    body { direction: ${isArabic ? "rtl" : "ltr"}; font-family: 'Tajawal', sans-serif; background-color: #f8f9fa; color: #3c4043; }
    .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 24px; padding: 24px; background: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .report-section h2 { font-size: 22px; font-weight: 700; color: #0d47a1; margin: 0 0 20px; display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1a73e8; padding-bottom: 12px; }
    .audit-table { width: 100%; border-collapse: collapse; }
    .audit-table th, .audit-table td { padding: 12px 10px; text-align: ${isArabic ? "right" : "left"}; border-bottom: 1px solid #e9ecef; vertical-align: top; }
    .audit-table th { font-size: 12px; color: #5f6368; text-transform: uppercase; letter-spacing: .4px; }
    .rec-item { border-${isArabic ? "right" : "left"}: 4px solid; }
    .item-name { font-weight: 700; color: #202124; font-size: 15px; margin-bottom: 6px; }
    .item-category { font-size: 12px; font-weight: 500; color: #5f6368; }
    .decision-badge { font-weight: 700; padding: 4px 10px; border-radius: 14px; font-size: 12px; display: inline-block; border: 1px solid; }
    .rec-item { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; padding: 14px; border-radius: 8px; background: #f8f9fa; }
    .rec-priority { flex-shrink: 0; font-weight: 700; padding: 5px 12px; border-radius: 8px; font-size: 12px; color: #fff; }
    .rec-priority.urgent, .rec-priority.عاجلة { background: #d93025; }
    .rec-priority.best-practice, .rec-priority.أفضل { background: #1e8e3e; }
    .rec-item.urgent-border { border-color: #d93025; }
    .rec-item.best-practice-border { border-color: #1e8e3e; }
    .rec-content { display: flex; flex-direction: column; }
    .rec-desc { color: #202124; font-size: 15px; }
    .rec-related { font-size: 12px; color: #5f6368; margin-top: 6px; }
    /* تلوين المخاطر */
    .audit-table tr.risk-critical { background-color: #fce8e6 !important; }
    .audit-table tr.risk-warning { background-color: #fff0e1 !important; }
    .audit-table tr.risk-ok { background-color: #e6f4ea !important; }
    /* رأس الجدول */
    .audit-table thead th { position: sticky; top: 0; background: #fff; z-index: 1; }
  </style>

  <div class="report-section">
    <h2>${text.summaryTitle}</h2>
    <p class="summary-text">${s.patientSummary?.text || text.notAvailable}</p>
    <p class="summary-text">${s.overallAssessment?.text || text.notAvailable}</p>
  </div>

  <div class="report-section">
    <h2>${text.detailsTitle}</h2>
    <table class="audit-table">
      <thead>
        <tr>
          <th>${text.itemHeader}</th>
          <th>${text.therapyTypeHeader}</th>
          <th>${text.strengthHeader}</th>
          <th>${text.frequencyHeader}</th>
          <th>${text.durationHeader}</th>
          <th>${text.daysHeader}</th>
          <th>${text.statusHeader}</th>
          <th>${text.decisionHeader}</th>
          <th>${text.justificationHeader}</th>
          <th>${text.signalsHeader}</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <div class="report-section">
    <h2>${text.recommendationsTitle}</h2>
    ${recommendationsList}
  </div>
  `;
}

// --- المعالج الرئيسي ---
export default async function handler(req, res) {
  console.log("--- New Request Received ---");
  try {
    if (req.method !== "POST") {
      return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    }
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
      console.error("CRITICAL ERROR: API Key is missing.");
      return bad(res, 500, "Server Configuration Error: API Key is missing.");
    }

    const { text = "", files = [], patientInfo = null, lang = "ar" } = req.body || {};
    console.log(`Processing request with language: ${lang}`);

    // الخطوة 1: OCR شامل كـ JSON
    console.log("Step 1: Starting OCR+Aggregation with Gemini...");
    const ocrBundle = await aggregateClinicalDataWithGemini({ text, files });
    console.log("Step 1: Gemini OCR aggregation successful.");

    // نمرر معلومات المريض مع OCR إلى المدقق
    const auditBundle = { patientInfo, diagnoses: ocrBundle?.diagnoses || [], ocrItems: ocrBundle?.items || [], ocrPatient: ocrBundle?.patient || {}, originalUserText: text };

    // الخطوة 2: تدقيق خبير عبر OpenAI
    console.log("Step 2: Starting expert audit with OpenAI...");
    const structuredAudit = await getAuditFromOpenAI(auditBundle);
    console.log("Step 2: OpenAI audit successful.");

    // الخطوة 2-ب: طبقة سياسات/سلامة حتمية بعدية
    console.log("Step 2b: Applying deterministic policy & safety checks...");
    const structuredWithPolicies = postProcessPolicyAndSafety(structuredAudit, patientInfo || ocrBundle?.patient || {});

    // الخطوة 3: عرض HTML
    console.log("Step 3: Rendering HTML report...");
    const htmlReport = renderHtmlReport(structuredWithPolicies, lang);
    console.log("Step 3: HTML rendering successful.");

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured: structuredWithPolicies, ocr: ocrBundle });
  } catch (err) {
    console.error("---!!!--- An error occurred during the process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    console.error("---!!!--- End of Error Report ---!!!---");
    return bad(res, 500, `An internal server error occurred. Check the server logs for details. Error: ${err.message}`);
  }
}
