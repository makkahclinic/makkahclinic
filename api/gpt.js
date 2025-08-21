// --- Next.js body size for large payloads ---
export const config = {
  api: {
    bodyParser: { sizeLimit: "50mb" },
  },
};

// --- ENV & Endpoints ---
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

// --- helpers ---
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (response) =>
  (response.headers.get("content-type") || "").includes("application/json")
    ? response.json()
    : { raw: await response.text() };

function toEnglishDigits(str = "") {
  const map = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9" };
  return String(str).replace(/[٠-٩]/g, (d) => map[d] || d);
}

function extractFirstJson(text = "") {
  const s = String(text || "");
  const start = s.indexOf("{"); const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = s.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch {
      try { return JSON.parse(candidate.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")); } catch { return null; }
    }
  }
  return null;
}

function parseDurationToDays(duration = "") {
  if (!duration) return null;
  const d = toEnglishDigits(duration).toLowerCase();
  const m1 = d.match(/x\s*(\d{1,4})\b/); if (m1) return parseInt(m1[1], 10);
  const m2 = d.match(/(\d{1,4})\s*(d|day|days)\b/); if (m2) return parseInt(m2[1], 10);
  const m3 = d.match(/(\d{1,3})\s*(w|wk|wks|week|weeks)\b/); if (m3) return parseInt(m3[1], 10) * 7;
  const m4 = d.match(/(\d{1,2})\s*(m|mo|mos|month|months)\b/); if (m4) return parseInt(m4[1], 10) * 30;
  const m5 = d.match(/(\d{1,2})\s*(y|yr|year|years)\b/); if (m5) return parseInt(m5[1], 10) * 365;
  if (/\b90\b/.test(d)) return 90;
  return null;
}

function parseFrequencyPerDay(freq = "") {
  if (!freq) return null;
  const f = toEnglishDigits(freq).toLowerCase().replace(/\s+/g, "");
  if (/(od|qd|once|1x1|q24h)\b/.test(f)) return 1;
  if (/(bid|2x1|1x2|q12h)/.test(f)) return 2;
  if (/(tid|3x1|1x3|q8h)/.test(f)) return 3;
  if (/(qid|4x1|1x4|q6h)/.test(f)) return 4;
  if (/(qhs|hs|qam|am)\b/.test(f)) return 1;
  if (/weekly|qw|qwk/.test(f)) return 1 / 7;
  if (/q2d/.test(f)) return 0.5;
  const m = f.match(/(\d)\s*x\s*(\d)/); if (m) return parseInt(m[2], 10);
  return null;
}

function estimateDaySupply({ doseDuration, daySupplyEstimate }) {
  if (Number.isFinite(daySupplyEstimate)) return daySupplyEstimate;
  const d = parseDurationToDays(doseDuration);
  return d || 0;
}

function includesAny(hay = "", needles = []) {
  const s = String(hay || "").toLowerCase();
  return needles.some((n) => s.includes(String(n).toLowerCase()));
}

// --- simple string normalization & similarity (token Jaccard) ---
function normalizeText(x = "") {
  return toEnglishDigits(x).toLowerCase().replace(/[^a-z\u0621-\u064A0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenSet(str = "") {
  return new Set(normalizeText(str).split(" ").filter(Boolean));
}
function jaccard(a = "", b = "") {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size && !B.size) return 1;
  const inter = new Set([...A].filter((x) => B.has(x)));
  const uni = new Set([...A, ...B]);
  return inter.size / uni.size;
}

// --- Gemini upload ---
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

// --- (A) OCR via Gemini -> Structured JSON ---
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
أنت نظام OCR طبي خبير يعيد **JSON فقط** وفق المخطط أدناه، دون أي نص آخر.
قواعد:
- استخرج كل ما كُتب (بيانات المريض/التشخيصات/الأدوية/الإجراءات/المختبر/التصوير/التحويل/المستلزمات) حتى لو الثقة منخفضة.
- لكل عنصر: { type, raw, name, form, route, strength, frequency, duration, quantity, indication, durationDays, handwritten, confidence:{...}, ambiguities:[...], source:{page, box:[x1,y1,x2,y2]} }
- لا تُخمن أرقامًا؛ اترك الحقول غير المعروفة فارغة أو confidence منخفض.
- أعد JSON مطابقًا تمامًا للهيكل التالي:
{
  "patient": { "name":"", "gender":"", "age":"", "weight":"", "vitals":{"bp":"","hr":""}, "eGFR": "" },
  "diagnoses": [ "..." ],
  "items": [ { /* كما أعلاه */ } ]
}`;

  const body = { system_instruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: userParts }] };
  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);

  const textOut = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
  const parsed = extractFirstJson(textOut) || { patient: {}, diagnoses: [], items: [] };

  // normalize durations
  for (const it of parsed.items || []) {
    it.duration = it.duration || "";
    it.frequency = it.frequency || "";
    it.durationDays = Number.isFinite(it.durationDays) ? it.durationDays : parseDurationToDays(it.duration);
  }
  return parsed;
}

// --- (B) Expert Auditor Prompt with Hallucination Guard ---
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
          { type: "Renal|Hepatic|Pregnancy|Gender|HR|BP|Age|Interaction|Other", severity: "Critical|Major|Minor", detail: "string" }
        ],
        conflictsWithPatient: ["string"],
        evidenceRef: null,           // index in ocrItems
        inferred: false,             // true only for omissions/Best Practice items
        insuranceDecision: { label: "مقبول|مرفوض|للمراجعة|لا ينطبق", justification: "string" }
      }
    ],
    recommendations: [{ priority: "عاجلة|أفضل ممارسة", description: "string", relatedItems: ["string"] }]
  };

  return `
أنت صيدلي سريري ومدقّق طبي قائم على الأدلة. أعِد **JSON صالحًا فقط** بهذا المخطط (دون نص إضافي).

- **حارس الهلوسة:** أي عنصر حالته "موصوف" أو "تم إجراؤه" يجب أن يرتبط بعنصر فعلي من ocrItems عبر evidenceRef (فهرس). لا يُسمح بالعناصر المخترعة. العناصر المقترحة معيار رعاية تُوسَم inferred=true وstatus="مفقود ولكنه ضروري".
- التزم بإرشادات: ACC/AHA 2021 للصدر، ADA (سكري)، KDIGO (كلية)، Beers/STOPP-START للشيخوخة.
- معدّل إطلاق معدّل (MR): Gliclazide/DIAMICRON MR يجب أن يكون "مرة يوميًا". أي تكرار أعلى = "جرعة غير صحيحة".
- أي مدة >30 يوم = "كمية عالية". 90+ يوم: مقبول غالبًا لأدوية الصيانة فقط وبشروط الاستقرار؛ وإلا "للمراجعة"/"مرفوض".
- املأ doseStrength/doseFrequency/doseDuration مما في OCR، وإن غاب اكتب "غير محدد".
- أدرج الإغفالات الحرجة (مثل ECG وhs‑cTn في ألم صدري) كـ inferred=true و"لا ينطبق" للتأمين.

اللغة: العربية الفصحى، موجزة، مهنية.

المخطط:
${JSON.stringify(schema, null, 2)}
`;
}

// --- (C) Call OpenAI ---
async function getAuditFromOpenAI(bundle) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0, // تشديد الحسم وتقليل الهلوسة
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

// --- (D) Deterministic Policy & Safety Checks (incl. Diamicron MR) ---
const PREGNANCY_RISK_CLASSES = ["statin","ace inhibitor","arb","renin inhibitor","warfarin","isotretinoin","valproate"];
const BPH_MEDS = ["tamsulosin","dutasteride","finasteride","duodart"];
function postProcessPolicyAndSafety(structured, patientInfo) {
  const gender = (patientInfo?.gender || patientInfo?.sex || "").toLowerCase();
  const pregnant = Boolean(patientInfo?.pregnant);
  const hr = Number(toEnglishDigits(patientInfo?.vitals?.hr || patientInfo?.hr || "")) || null;
  const eGFR = Number(toEnglishDigits(patientInfo?.eGFR || patientInfo?.renal?.eGFR || "")) || null;

  structured.table = (structured.table || []).map((row) => {
    const r = { ...row };
    r.daySupplyEstimate = estimateDaySupply({ doseDuration: r.doseDuration, daySupplyEstimate: r.daySupplyEstimate });

    // High quantity auto-tag
    if (r.daySupplyEstimate > 30 && !/كمية عالية/.test(r.analysisCategory || "")) {
      r.analysisCategory = r.analysisCategory || "كمية عالية";
    }

    // 90+ day supply policy
    if (r.itemType === "medication" && r.daySupplyEstimate >= 90) {
      const tt = (r.therapyType || "Unknown").toLowerCase();
      if (tt !== "maintenance") {
        r.insuranceDecision = { label: "مرفوض", justification: "صرف 90 يومًا لدواء غير صيانـي؛ يُقيَّد عادةً بأدوية الصيانة مع مبررات/موافقة." };
      } else if (!r.insuranceDecision?.label) {
        r.insuranceDecision = { label: "للمراجعة", justification: "صرف ممتد لدواء صيانـي يتطلب دليل استقرار وسياسة خطة/صيدلية." };
      }
    }

    // Gender/BPH meds
    if (gender === "female" && includesAny(r.name, BPH_MEDS)) {
      r.safetySignals = [...(r.safetySignals || []), { type: "Gender", severity: "Critical", detail: "دواء لعلاج تضخّم البروستاتا وُصف لمريضة." }];
      r.analysisCategory = "إجراء يتعارض مع التشخيص";
      r.insuranceDecision = { label: "مرفوض", justification: "وصف خاص بـ BPH لمريضة أنثى." };
    }

    // Pregnancy risk classes
    if (pregnant && includesAny(r.name, PREGNANCY_RISK_CLASSES)) {
      r.safetySignals = [...(r.safetySignals || []), { type: "Pregnancy", severity: "Critical", detail: "دواء يُنصح بتجنّبه أثناء الحمل." }];
      r.insuranceDecision = r.insuranceDecision?.label ? r.insuranceDecision : { label: "للمراجعة", justification: "حمل قائم؛ راجع الفوائد/المخاطر." };
    }

    // Metformin + eGFR<30
    if (eGFR !== null && eGFR < 30 && /metformin|glucophage|kazano|segluro/i.test(r.name || "")) {
      r.safetySignals = [...(r.safetySignals || []), { type: "Renal", severity: "Critical", detail: `eGFR=${eGFR}؛ الميتفورمين مُضاد استطباب عند eGFR<30.` }];
      r.analysisCategory = "غير مبرر طبياً";
      r.insuranceDecision = { label: "مرفوض", justification: "خطر الحماض اللبني؛ يلزم بديل آمن." };
    }

    // *** Diamicron MR (Gliclazide MR) must be once daily ***
    const isGliclazideMR = /(diamicron|gliclazide).*(mr|modified\s*release|sr|xr)/i.test(String(r.name || ""));
    const freq = parseFrequencyPerDay(r.doseFrequency || "");
    if (r.itemType === "medication" && isGliclazideMR && freq && freq > 1) {
      r.analysisCategory = "جرعة غير صحيحة";
      r.safetySignals = [...(r.safetySignals || []), {
        type: "Other", severity: "Major",
        detail: "Gliclazide MR (DIAMICRON MR) يُؤخذ مرة واحدة يوميًا؛ زيادة التكرار قد ترفع خطر نقص سكر الدم."
      }];
      r.insuranceDecision = r.insuranceDecision?.label ? r.insuranceDecision : { label: "للمراجعة", justification: "تكرار غير مطابق للنشرة الرسمية." };
    }

    // Bradycardia + beta-blocker/Non-DHP CCB
    if (hr !== null && hr < 50 && /(bisoprolol|metoprolol|atenolol|propranolol|carvedilol|verapamil|diltiazem)/i.test(r.name || "")) {
      r.safetySignals = [...(r.safetySignals || []), { type: "HR", severity: "Major", detail: `نبض منخفض (HR=${hr}); راجع الجرعة/الملاءمة.` }];
      r.insuranceDecision = r.insuranceDecision?.label ? r.insuranceDecision : { label: "للمراجعة", justification: "بطء قلب ملحوظ." };
    }

    return r;
  });

  return structured;
}

// --- (E) Grounding to OCR to prevent hallucinations ---
function groundAuditRowsToOCR(structured, ocrItems = []) {
  const table = structured.table || [];
  const normalizedOCR = ocrItems.map((it, idx) => ({
    idx, type: String(it.type || ""), name: String(it.name || it.raw || ""),
    norm: normalizeText(it.name || it.raw || "")
  }));

  structured.table = table.map((r) => {
    const out = { ...r };
    const rNorm = normalizeText(r.name || "");
    let best = { score: -1, idx: -1, name: "", type: "" };

    for (const it of normalizedOCR) {
      const score = jaccard(rNorm, it.norm);
      if (score > best.score) best = { score, idx: it.idx, name: it.name, type: it.type };
    }

    // attach grounding info
    out.grounding = { matched: best.score >= 0.35, score: Number(best.score.toFixed(2)), evidenceRaw: best.idx >= 0 ? ocrItems[best.idx]?.raw || "" : "" };
    if (out.status && (out.status.includes("موصوف") || out.status.includes("تم إجراؤه"))) {
      if (!out.evidenceRef && out.grounding.matched) out.evidenceRef = best.idx;
      if (!out.grounding.matched) {
        out.safetySignals = [...(out.safetySignals || []), { type: "Other", severity: "Major", detail: "⚠️ عنصر غير موثق في OCR (احتمال هلوسة)."}];
        out.insuranceDecision = out.insuranceDecision?.label ? out.insuranceDecision : { label: "للمراجعة", justification: "تحقق من التوثيق الأصلي." };
      }
    }
    return out;
  });

  return structured;
}

// --- (F) Add Standard-of-Care Omissions: ECG + hs‑cTn when chest pain/ACS context ---
function hasACSOrChestPainContext({ diagnoses = [], text = "" }) {
  const ctx = normalizeText([...(diagnoses || []), text].join(" "));
  const keys = [
    "chest pain","angina","acs","nstemi","stemi","unstable angina",
    "الم صدري","ألم صدري","ذبحة","ذبحة صدرية","احتشاء","جلطة قلبية","متلازمة الشريان التاجي الحادة"
  ];
  return includesAny(ctx, keys);
}

function ensureECGAndTroponin(structured, context) {
  if (!hasACSOrChestPainContext(context)) return structured;

  const names = (structured.table || []).map((r) => normalizeText(r.name || ""));
  const hasECG = names.some((n) => includesAny(n, ["ecg","electrocardiogram","تخطيط القلب","رسم القلب","12-lead"]));
  const hasTroponin = names.some((n) => includesAny(n, ["troponin","hs-ctn","تروبونين","troponine","high sensitivity troponin"]));

  const mkMissing = (name, itemType) => ({
    name, itemType, therapyType: "Unknown",
    doseStrength: "-", doseFrequency: "-", doseDuration: "-",
    daySupplyEstimate: 0, status: "مفقود ولكنه ضروري",
    analysisCategory: "إغفال خطير",
    safetySignals: [{ type: "Other", severity: "Major", detail: "عنصر تشخيصي أساسي في تقييم ألم صدري/ACS حسب الإرشادات." }],
    conflictsWithPatient: [], evidenceRef: null, inferred: true,
    insuranceDecision: { label: "لا ينطبق", justification: "عنصر تقييم/تشخيص." }
  });

  if (!hasECG) structured.table.push(mkMissing("ECG 12‑lead (تخطيط القلب)", "procedure"));
  if (!hasTroponin) structured.table.push(mkMissing("High‑Sensitivity Troponin (hs‑cTn)", "lab"));
  return structured;
}

// --- (G) HTML Renderer (adds OCR verification badge) ---
function renderHtmlReport(structuredData, lang = "ar") {
  const s = structuredData;
  const isArabic = lang === "ar";
  const text = {
    summaryTitle: isArabic ? "ملخص الحالة والتقييم العام" : "Case Summary & Overall Assessment",
    detailsTitle: isArabic ? "التحليل التفصيلي للعناصر" : "Detailed Analysis of Items",
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
    ocrHeader: isArabic ? "توثيق OCR" : "OCR Evidence",
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

  const ocrBadge = (g) => {
    if (!g) return "-";
    return g.matched
      ? `<span title="Grounded (score=${g.score})" style="background:#e6f4ea;color:#137333;padding:3px 8px;border-radius:8px;font-size:12px;">موثق</span>`
      : `<span title="Not grounded (score=${g.score})" style="background:#fce8e6;color:#d93025;padding:3px 8px;border-radius:8px;font-size:12px;">⚠️ غير موثق</span>`;
  };

  const formatSignals = (signals = []) =>
    signals?.length
      ? `<ul style="margin:0;padding-inline-start:18px">${signals.map((s) => `<li><b>${s.type}</b>: ${s.detail} (${s.severity})</li>`).join("")}</ul>`
      : "-";

  const rows = (s.table || []).map((r) => `
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
      <td>${ocrBadge(r.grounding)}</td>
    </tr>
  `).join("");

  return `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
    body { direction: ${isArabic ? "rtl" : "ltr"}; font-family: 'Tajawal', sans-serif; background-color: #f8f9fa; color: #3c4043; }
    .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 24px; padding: 24px; background: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .report-section h2 { font-size: 22px; font-weight: 700; color: #0d47a1; margin: 0 0 20px; border-bottom: 2px solid #1a73e8; padding-bottom: 12px; }
    .audit-table { width: 100%; border-collapse: collapse; }
    .audit-table th, .audit-table td { padding: 12px 10px; text-align: ${isArabic ? "right" : "left"}; border-bottom: 1px solid #e9ecef; vertical-align: top; }
    .audit-table th { font-size: 12px; color: #5f6368; text-transform: uppercase; letter-spacing: .4px; position: sticky; top: 0; background: #fff; }
    .item-name { font-weight: 700; color: #202124; font-size: 15px; margin-bottom: 6px; }
    .item-category { font-size: 12px; font-weight: 500; color: #5f6368; }
    .decision-badge { font-weight: 700; padding: 4px 10px; border-radius: 14px; font-size: 12px; display: inline-block; border: 1px solid; }
    .rec-item { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; padding: 14px; border-radius: 8px; background: #f8f9fa; border-${isArabic ? "right" : "left"}: 4px solid; }
    .rec-priority.urgent, .rec-priority.عاجلة { background: #d93025; color:#fff; padding:5px 12px; border-radius:8px; font-weight:700; font-size:12px; }
    .rec-priority.best-practice, .rec-priority.أفضل { background: #1e8e3e; color:#fff; padding:5px 12px; border-radius:8px; font-weight:700; font-size:12px; }
    .audit-table tr.risk-critical { background-color: #fce8e6 !important; }
    .audit-table tr.risk-warning { background-color: #fff0e1 !important; }
    .audit-table tr.risk-ok { background-color: #e6f4ea !important; }
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
          <th>${text.ocrHeader}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="report-section">
    <h2>${text.recommendationsTitle}</h2>
    ${(s.recommendations || []).map(rec => `
      <div class="rec-item ${/عاجلة|urgent/i.test(rec.priority||"") ? "urgent-border" : "best-practice-border"}">
        <span class="rec-priority ${rec.priority}">${rec.priority}</span>
        <div class="rec-content">
          <div class="rec-desc">${rec.description}</div>
          ${rec.relatedItems?.length ? `<div class="rec-related">${isArabic?"مرتبط بـ":"Related to"}: ${rec.relatedItems.join(", ")}</div>` : ""}
        </div>
      </div>`).join("")}
  </div>
  `;
}

// --- Main handler ---
export default async function handler(req, res) {
  console.log("--- New Request Received ---");
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
      console.error("CRITICAL ERROR: API Key is missing.");
      return bad(res, 500, "Server Configuration Error: API Key is missing.");
    }

    const { text = "", files = [], patientInfo = null, lang = "ar" } = req.body || {};
    console.log(`Processing request with language: ${lang}`);

    // 1) OCR
    console.log("Step 1: OCR+Aggregation (Gemini)...");
    const ocrBundle = await aggregateClinicalDataWithGemini({ text, files });
    console.log("Step 1: OK.");

    // 2) LLM Audit
    console.log("Step 2: Expert Audit (OpenAI)...");
    const auditBundle = { patientInfo, diagnoses: ocrBundle?.diagnoses || [], ocrItems: ocrBundle?.items || [], ocrPatient: ocrBundle?.patient || {}, originalUserText: text };
    const structuredAudit = await getAuditFromOpenAI(auditBundle);
    console.log("Step 2: OK.");

    // 2b) Policy & Safety (deterministic)
    console.log("Step 2b: Policies & Safety...");
    let structured = postProcessPolicyAndSafety(structuredAudit, patientInfo || ocrBundle?.patient || {});

    // 2c) Ground to OCR to prevent hallucinations
    console.log("Step 2c: Grounding to OCR...");
    structured = groundAuditRowsToOCR(structured, ocrBundle?.items || []);

    // 2d) Ensure ECG+hs‑cTn omissions when chest pain context
    console.log("Step 2d: Ensuring ECG+Troponin omissions when appropriate...");
    const contextText = [text, JSON.stringify(patientInfo||{}), ...(ocrBundle?.diagnoses||[])].join(" ");
    structured = ensureECGAndTroponin(structured, { diagnoses: ocrBundle?.diagnoses || [], text: contextText });

    // 3) HTML
    console.log("Step 3: Rendering HTML...");
    const htmlReport = renderHtmlReport(structured, lang);

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured: structured, ocr: ocrBundle });

  } catch (err) {
    console.error("---!!!--- ERROR ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    return bad(res, 500, `Internal server error: ${err.message}`);
  }
}
