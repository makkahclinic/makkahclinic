// --- Next.js body size for large payloads ---
export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

// --- ENV & Endpoints ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

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

// --- duration / frequency parsing ---
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

// robust frequency parser: handles 1x2x90 / 1×2×90 / 1 x 2 x 90 / od x 90 / bd/tid...
function parseFrequencyDetailed(freq = "") {
  if (!freq) return { perDose: null, perDay: null, durationDays: null };
  let t = toEnglishDigits(freq).toLowerCase();
  t = t.replace(/[×*]/g, "x").replace(/\s+/g, "");

  // 1x2x90
  let m = t.match(/(\d+)[x](\d+)[x](\d{1,4})/);
  if (m) return { perDose: +m[1], perDay: +m[2], durationDays: +m[3] };

  // od x 90 / odx90
  m = t.match(/\bodx?(\d{1,4})\b/); // odx90
  if (m) return { perDose: 1, perDay: 1, durationDays: +m[1] };
  m = t.match(/\bod[x]?(\d)?x?(\d{1,4})/); // odx90 variants
  if (m && m[2]) return { perDose: 1, perDay: 1, durationDays: +m[2] };

  // 1x90
  m = t.match(/(\d+)[x](\d{1,4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (b <= 8) return { perDose: a, perDay: b, durationDays: null };
    return { perDose: a, perDay: 1, durationDays: b };
  }

  // textual frequency
  if (/(od|qd|once|q24h)\b/.test(t)) return { perDose: 1, perDay: 1, durationDays: null };
  if (/(bd|bid|q12h)/.test(t)) return { perDose: 1, perDay: 2, durationDays: null };
  if (/(tid|q8h)/.test(t)) return { perDose: 1, perDay: 3, durationDays: null };
  if (/(qid|q6h)/.test(t)) return { perDose: 1, perDay: 4, durationDays: null };

  return { perDose: null, perDay: null, durationDays: null };
}

function estimateDaySupply({ doseDuration, freqText, existing }) {
  if (Number.isFinite(existing) && existing > 0) return existing;
  const d1 = parseDurationToDays(doseDuration || "");
  if (d1) return d1;
  const { durationDays } = parseFrequencyDetailed(freqText || "");
  return durationDays || 0;
}

function normalizeText(x = "") {
  return toEnglishDigits(x).toLowerCase().replace(/[^a-z\u0621-\u064A0-9\s/\.]/g, " ").replace(/\s+/g, " ").trim();
}
function includesAny(hay = "", needles = []) {
  const s = String(hay || "").toLowerCase();
  return needles.some((n) => s.includes(String(n).toLowerCase()));
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
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "unnamed_file", mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }
  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  const systemPrompt = `
أنت نظام OCR طبي خبير يعيد **JSON فقط** وفق المخطط أدناه، دون أي نص آخر.
- استخرج كل ما كُتب (بيانات المريض/التشخيصات/الأدوية/الإجراءات/المختبر/التصوير/التحويل/المستلزمات) حتى لو الثقة منخفضة.
- لكل عنصر: { type, raw, name, form, route, strength, frequency, duration, quantity, indication, durationDays, handwritten, confidence:{...}, ambiguities:[...], source:{page, box:[x1,y1,x2,y2]} }
- لا تُخمن؛ اترك الحقول المجهولة فارغة مع confidence منخفض.
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

  for (const it of parsed.items || []) {
    it.duration = it.duration || "";
    it.frequency = it.frequency || "";
    it.durationDays = Number.isFinite(it.durationDays) ? it.durationDays : parseDurationToDays(it.duration);
  }
  return parsed;
}

// --- (A2) تطبيع/تصحيح شائع لهذه الوصفة ---
const LEX = {
  supply: [/strip/i, /strips/i, /e[- ]?core/i, /lancet/i, /test\s*strips/i],
  lab: [/\bhba1c\b/i, /\bfbc\b/i, /tsh\b/i, /\bcreatinine\b/i, /\btroponin\b/i],
  procedure: [/ecg/i, /echo/i, /\bholter\b/i],
  medication: [
    /diamicron|gliclazide.*(mr|sr|xr|modified\s*release)/i,
    /formet|formut|metformin/i,
    /rozavi|rosuva|rosuvastatin/i,
    /amlodi|amlopine|amlodipine/i,
    /duodart|tamsulosin|dutasteride/i,
    /panto|max|pantoprazole|pantomax/i,
    /co[-\s]?tabu|co[-\s]?tareg|valsartan|irbesartan|losartan|olmesartan/i,
    /triplix|triplixam|triplex/i,
    /adol|paracetamol|acetaminophen/i
  ]
};
function reclassifyAndClean(ocrItems = []) {
  return (ocrItems || []).map((it) => {
    const name = String(it.name || it.raw || "").trim();
    const norm = normalizeText(name);
    let itemType = it.type || "medication";
    if (LEX.supply.some((r) => r.test(name))) itemType = "supply";
    else if (LEX.lab.some((r) => r.test(name))) itemType = "lab";
    else if (LEX.procedure.some((r) => r.test(name))) itemType = "procedure";
    else if (LEX.medication.some((r) => r.test(name))) itemType = "medication";

    const cleanedName =
      norm.includes("e core") && norm.includes("strip") ? "E‑core strips (glucose test strips)" :
      norm.includes("lancet") ? "Lancets (finger prick)" :
      norm.includes("diamicron") ? "Diamicron MR (gliclazide MR)" :
      norm.includes("formet") || norm.includes("formut") ? "Formet XR (metformin XR)" :
      norm.includes("rozavi") ? "Rozavi (rosuvastatin)" :
      norm.includes("pantomax") ? "Pantomax (pantoprazole)" :
      norm.includes("amlodipine") || norm.includes("amlopine") ? "Amlodipine" :
      norm.includes("duodart") ? "Duodart (dutasteride/tamsulosin)" :
      norm.includes("triplix") || norm.includes("triplex") ? "Triplix/Triplex (fixed-dose combo)" :
      name;

    return { ...it, name: cleanedName, itemType };
  });
}

// --- (B) Expert Auditor Prompt (JSON) ---
function getExpertAuditorInstructions() {
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
        evidenceRef: null,
        inferred: false,
        insuranceDecision: { label: "مقبول|مرفوض|للمراجعة|لا ينطبق", justification: "string" }
      }
    ],
    recommendations: [{ priority: "عاجلة|أفضل ممارسة", description: "string", relatedItems: ["string"] }]
  };

  return `
أنت صيدلي سريري ومدقّق طبي قائم على الأدلة. أعد **JSON صالحًا فقط** بهذا المخطط.
- لا عناصر مخترعة: أي عنصر "موصوف/تم" يجب أن يرتبط بعنصر OCR عبر evidenceRef، والإغفالات فقط تُوَسَّم inferred=true.
- **Gliclazide MR (Diamicron MR):** يجب أن يكون مرة واحدة يوميًا؛ أي تكرار >1/يوم = "جرعة غير صحيحة".
- >30 يوم = "كمية عالية". 90+ يوم: غالبًا لأدوية الصيانة فقط؛ دون دليل استقرار → "للمراجعة".
- لا تضف ECG/hs‑cTn إلا بوجود مؤشرات ألم صدري/ACS صريحة.
- اكتب بالعربية الفصحى، مختصرة ومهنيّة.

المخطط:
${JSON.stringify(schema, null, 2)}
`;
}

async function getAuditFromOpenAI(bundle) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: getExpertAuditorInstructions() },
        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

// --- (C) Grounding (مخفي عن الواجهة) ---
function normalizeTextTokens(str = "") {
  return toEnglishDigits(str).toLowerCase().replace(/[^a-z\u0621-\u064A0-9\s]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}
function jaccard(s1 = "", s2 = "") {
  const A = new Set(normalizeTextTokens(s1)), B = new Set(normalizeTextTokens(s2));
  if (!A.size && !B.size) return 1;
  const inter = new Set([...A].filter(x => B.has(x)));
  const uni = new Set([...A, ...B]);
  return inter.size / uni.size;
}
function groundAuditRowsToOCR(structured, ocrItems = []) {
  const table = structured.table || [];
  const normalizedOCR = ocrItems.map((it, idx) => ({ idx, name: String(it.name || it.raw || ""), norm: normalizeText(it.name || it.raw || "") }));

  structured.table = table.map((r) => {
    const out = { ...r };
    const rNorm = normalizeText(r.name || "");
    let best = { score: -1, idx: -1 };
    for (const it of normalizedOCR) {
      const score = jaccard(rNorm, it.norm);
      if (score > best.score) best = { score, idx: it.idx };
    }
    out.grounding = { matched: best.score >= 0.35, score: Number(best.score.toFixed(2)) };

    // إن لم يتطابق عنصر موثّق → ادفعه للمراجعة
    if ((out.status || "").match(/موصوف|تم/)) {
      if (!out.evidenceRef && out.grounding.matched) out.evidenceRef = best.idx;
      if (!out.grounding.matched) {
        out.insuranceDecision = out.insuranceDecision?.label ? out.insuranceDecision : { label: "للمراجعة", justification: "التحقق من التوثيق الأصلي مطلوب (OCR لا يؤكد العنصر)." };
      }
    }
    return out;
  });

  return structured;
}

// --- (D) إنقاذ التردد من الـ RAW لضبط 1×2×90 في MR ---
function rescueFrequencyFromRaw(structured, ocrItems = []) {
  structured.table = (structured.table || []).map((r) => {
    const isMR = /(diamicron|gliclazide).*(mr|modified\s*release|sr|xr)/i.test(String(r.name || ""));
    if (r.itemType !== "medication" || !isMR) return r;

    const srcs = [];
    if (r.doseFrequency) srcs.push(r.doseFrequency);
    if (r.doseDuration) srcs.push(r.doseDuration);
    if (Number.isInteger(r.evidenceRef) && ocrItems[r.evidenceRef]?.raw) srcs.push(ocrItems[r.evidenceRef].raw);
    // fallback: أي سطر OCR يذكر Diamicron
    const fb = ocrItems.find((it) => /(diamicron|gliclazide)/i.test(String(it.name || it.raw || "")));
    if (fb) srcs.push(fb.raw || fb.name);

    const merged = srcs.filter(Boolean).join(" ");
    const parsed = parseFrequencyDetailed(merged);
    if (parsed.durationDays && (!r.daySupplyEstimate || r.daySupplyEstimate === 0)) r.daySupplyEstimate = parsed.durationDays;

    const { perDay } = parsed;
    if (perDay && perDay > 1) {
      // عدّل الحقول ووسم الخطأ
      if (!r.doseFrequency || !/\d/.test(r.doseFrequency)) r.doseFrequency = `1x${perDay}`;
      r.analysisCategory = "جرعة غير صحيحة";
      r.safetySignals = [...(r.safetySignals || []), {
        type: "Other", severity: "Major",
        detail: "Gliclazide MR (DIAMICRON MR) يُؤخذ مرة واحدة يوميًا؛ تكرار أعلى يزيد خطر نقص سكر الدم."
      }];
      if (!r.insuranceDecision?.label) r.insuranceDecision = { label: "للمراجعة", justification: "تواتر لا يطابق النشرة الرسمية." };
    }
    return r;
  });
  return structured;
}

// --- (E) سياسات/سلامة حتمية ---
const PREGNANCY_RISK_CLASSES = ["statin","ace inhibitor","arb","renin inhibitor","warfarin","isotretinoin","valproate"];
const BPH_MEDS = ["tamsulosin","dutasteride","finasteride","duodart"];

function postProcessPolicyAndSafety(structured, patientInfo) {
  const gender = (patientInfo?.gender || patientInfo?.sex || "").toLowerCase();
  const pregnant = Boolean(patientInfo?.pregnant);
  const hr = Number(toEnglishDigits(patientInfo?.vitals?.hr || patientInfo?.hr || "")) || null;
  const eGFR = Number(toEnglishDigits(patientInfo?.eGFR || patientInfo?.renal?.eGFR || "")) || null;

  structured.table = (structured.table || []).map((row) => {
    const r = { ...row };

    r.daySupplyEstimate = estimateDaySupply({ doseDuration: r.doseDuration, freqText: r.doseFrequency, existing: r.daySupplyEstimate });

    if (r.daySupplyEstimate > 30 && !/كمية عالية/.test(r.analysisCategory || "")) {
      r.analysisCategory = r.analysisCategory || "كمية عالية";
    }

    if (r.itemType === "medication" && r.daySupplyEstimate >= 90) {
      const tt = (r.therapyType || "Unknown").toLowerCase();
      if (tt !== "maintenance") {
        r.insuranceDecision = { label: "مرفوض", justification: "صرف 90 يومًا لدواء غير صيانـي؛ غالبًا يُقصر على أدوية الصيانة وفق سياسة الخطة." };
      } else if (!r.insuranceDecision?.label) {
        r.insuranceDecision = { label: "للمراجعة", justification: "صرف ممتد لدواء صيانـي يتطلب دليل استقرار وسياسة خطة/صيدلية." };
      }
    }

    if (gender === "female" && includesAny(r.name, BPH_MEDS)) {
      r.safetySignals = [...(r.safetySignals || []), { type: "Gender", severity: "Critical", detail: "دواء لعلاج تضخّم البروستاتا وُصف لمريضة." }];
      r.analysisCategory = "إجراء يتعارض مع التشخيص";
      r.insuranceDecision = { label: "مرفوض", justification: "BPH دواء خاص بالذكور." };
    }

    if (pregnant && includesAny(r.name, PREGNANCY_RISK_CLASSES)) {
      r.safetySignals = [...(r.safetySignals || []), { type: "Pregnancy", severity: "Critical", detail: "دواء يُنصح بتجنّبه أثناء الحمل." }];
      if (!r.insuranceDecision?.label) r.insuranceDecision = { label: "للمراجعة", justification: "حمل قائم؛ راجع الفوائد/المخاطر." };
    }

    if (eGFR !== null && eGFR < 30 && /metformin|glucophage|kazano|segluro|formet/i.test(r.name || "")) {
      r.safetySignals = [...(r.safetySignals || []), { type: "Renal", severity: "Critical", detail: `eGFR=${eGFR}؛ الميتفورمين مُضاد استطباب عند eGFR<30.` }];
      r.analysisCategory = "غير مبرر طبياً";
      r.insuranceDecision = { label: "مرفوض", justification: "خطر الحماض اللبني؛ بديل آمن مطلوب." };
    }

    // ملاحظة: فحص BID لِـ MR سيُطبّق قبل هذا (rescueFrequencyFromRaw)

    if (hr !== null && hr < 50 && /(bisoprolol|metoprolol|atenolol|propranolol|carvedilol|verapamil|diltiazem)/i.test(r.name || "")) {
      r.safetySignals = [...(r.safetySignals || []), { type: "HR", severity: "Major", detail: `نبض منخفض (HR=${hr}); راجع الجرعة/الملاءمة.` }];
      if (!r.insuranceDecision?.label) r.insuranceDecision = { label: "للمراجعة", justification: "بطء قلب ملحوظ." };
    }

    return r;
  });

  return structured;
}

// --- (F) ECG/hs‑cTn فقط عند سياق ألم صدري واضح ---
function hasACSOrChestPainContext({ diagnoses = [], text = "" }) {
  const ctx = normalizeText([...(diagnoses || []), text].join(" "));
  const keys = [
    "chest pain","الام صدري","ألم صدري","angina","unstable angina","acs","nstemi","stemi","mi","heart attack","ذبحة","جلطة قلبية","متلازمة الشريان التاجي"
  ];
  return keys.some((k) => ctx.includes(k));
}
function ensureECGAndTroponin(structured, context) {
  if (!hasACSOrChestPainContext(context)) return structured;

  const names = (structured.table || []).map((r) => normalizeText(r.name || ""));
  const hasECG = names.some((n) => n.includes("ecg") || n.includes("تخطيط القلب") || n.includes("electrocardiogram"));
  const hasTroponin = names.some((n) => n.includes("troponin") || n.includes("hs ctn") || n.includes("تروبونين"));

  const mkMissing = (name, itemType) => ({
    name, itemType, therapyType: "Unknown",
    doseStrength: "-", doseFrequency: "-", doseDuration: "-",
    daySupplyEstimate: 0, status: "مفقود ولكنه ضروري",
    analysisCategory: "إغفال خطير",
    safetySignals: [{ type: "Other", severity: "Major", detail: "عنصر تشخيصي أساسي حسب إرشادات ACC/AHA 2021." }],
    conflictsWithPatient: [], evidenceRef: null, inferred: true,
    insuranceDecision: { label: "لا ينطبق", justification: "عنصر تقييم/تشخيص." }
  });

  if (!hasECG) structured.table.push(mkMissing("ECG 12‑lead (تخطيط القلب)", "procedure"));
  if (!hasTroponin) structured.table.push(mkMissing("High‑Sensitivity Troponin (hs‑cTn)", "lab"));
  return structured;
}

// --- (G) HTML Renderer — بدون عمود "أيام الصرف" ---
function renderHtmlReport(structuredData, lang = "ar") {
  const s = structuredData;
  const isArabic = lang === "ar";
  const text = {
    summaryTitle: isArabic ? "ملخص الحالة والتقييم العام" : "Case Summary & Overall Assessment",
    detailsTitle: isArabic ? "التحليل التفصيلي" : "Detailed Analysis",
    recommendationsTitle: isArabic ? "التوصيات والإجراءات المقترحة" : "Recommendations & Proposed Actions",
    headers: {
      item: isArabic ? "العنصر" : "Item",
      type: isArabic ? "نوع العلاج" : "Therapy",
      strength: isArabic ? "القوة" : "Strength",
      freq: isArabic ? "التكرار" : "Frequency",
      dur: isArabic ? "المدة" : "Duration",
      status: isArabic ? "الحالة" : "Status",
      decision: isArabic ? "قرار التأمين" : "Insurance",
      note: isArabic ? "التحليل والتبرير" : "Analysis & Rationale",
    },
    notAvailable: isArabic ? "غير متوفر." : "Not available.",
  };

  const getDecisionStyle = (label) => {
    const normalizedLabel = (label || "").toLowerCase();
    if (normalizedLabel.includes("مقبول") || normalizedLabel.includes("accepted")) return "background:#e6f4ea;color:#1e8e3e;border:1px solid #a1d8b5;";
    if (normalizedLabel.includes("مرفوض") || normalizedLabel.includes("rejected")) return "background:#fce8e6;color:#d93025;border:1px solid #f2b8b5;";
    if (normalizedLabel.includes("للمراجعة") || normalizedLabel.includes("for review")) return "background:#fff0e1;color:#c75b08;border:1px solid #ffd3ad;";
    if (normalizedLabel.includes("لا ينطبق") || normalizedLabel.includes("not applicable")) return "background:#e8eaed;color:#5f6368;border:1px solid #d2d5da;";
    return "background:#e8eaed;color:#3c4043;border:1px solid #d2d5da;";
  };

  const riskClass = (cat = "") => {
    const c = (cat || "").toLowerCase();
    if (c.includes("إغفال") || c.includes("omission") || c.includes("جرعة غير صحيحة") || c.includes("يتعارض")) return "risk-critical";
    if (c.includes("كمية") || c.includes("quantity") || c.includes("تكرار علاجي")) return "risk-warning";
    if (c.includes("صحيح") || c.includes("correct")) return "risk-ok";
    return "";
  };

  const displayDuration = (r) => {
    if (r.doseDuration && r.doseDuration.trim() !== "") return r.doseDuration;
    if (Number.isFinite(r.daySupplyEstimate) && r.daySupplyEstimate > 0) return `${r.daySupplyEstimate} يوم`;
    return "-";
  };

  const rows = (s.table || []).map((r) => `
    <tr class="${riskClass(r.analysisCategory)}">
      <td><div class="item-name">${r.name || "-"}</div><div class="item-meta">${r.itemType || ""} — <span class="cat">${r.analysisCategory || ""}</span></div></td>
      <td>${r.therapyType || "-"}</td>
      <td>${r.doseStrength || "-"}</td>
      <td>${r.doseFrequency || "-"}</td>
      <td>${displayDuration(r)}</td>
      <td>${r.status || "-"}</td>
      <td><span class="badge" style="${getDecisionStyle(r.insuranceDecision?.label)}">${r.insuranceDecision?.label || "-"}</span></td>
      <td>${r.insuranceDecision?.justification || "-"}</td>
    </tr>
  `).join("");

  return `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
    body { direction:${isArabic ? "rtl" : "ltr"}; font-family:'Tajawal',sans-serif; background:#f6f8fa; color:#23262a; }
    .section { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:20px; margin:18px 0; box-shadow:0 2px 10px rgba(0,0,0,0.04); }
    .section h2 { font-size:20px; margin:0 0 14px; color:#0d47a1; border-bottom:2px solid #1a73e8; padding-bottom:10px; }
    table { width:100%; border-collapse:separate; border-spacing:0; }
    thead th { font-size:12px; text-transform:uppercase; letter-spacing:.4px; color:#6b7280; background:#f9fafb; position:sticky; top:0; z-index:1; }
    th, td { padding:12px 10px; border-bottom:1px solid #edf0f2; vertical-align:top; }
    tr:hover { background:#fbfbfd; }
    .item-name { font-weight:700; color:#111827; margin-bottom:4px; }
    .item-meta { font-size:12px; color:#6b7280; }
    .badge { padding:4px 10px; border-radius:12px; font-weight:700; font-size:12px; display:inline-block; }
    .risk-critical { background:#fff5f5; }
    .risk-warning  { background:#fff8eb; }
    .risk-ok       { background:#f3faf3; }
    .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:14px; }
    @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
  </style>

  <div class="section">
    <h2>${text.summaryTitle}</h2>
    <div class="grid">
      <p>${s.patientSummary?.text || text.notAvailable}</p>
      <p>${s.overallAssessment?.text || text.notAvailable}</p>
    </div>
  </div>

  <div class="section">
    <h2>${text.detailsTitle}</h2>
    <table>
      <thead>
        <tr>
          <th>${text.headers.item}</th>
          <th>${text.headers.type}</th>
          <th>${text.headers.strength}</th>
          <th>${text.headers.freq}</th>
          <th>${text.headers.dur}</th>
          <th>${text.headers.status}</th>
          <th>${text.headers.decision}</th>
          <th>${text.headers.note}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>${text.recommendationsTitle}</h2>
    ${(s.recommendations || []).map(rec => `
      <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;">
        <span style="background:${/عاجلة|urgent/i.test(rec.priority||"") ? "#d93025" : "#1e8e3e"};color:#fff;padding:4px 10px;border-radius:10px;font-weight:700;font-size:12px;">${rec.priority}</span>
        <div>
          <div>${rec.description}</div>
          ${rec.relatedItems?.length ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">${isArabic?"مرتبط بـ":"Related"}: ${rec.relatedItems.join(", ")}</div>` : ""}
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
    const ocrBundleRaw = await aggregateClinicalDataWithGemini({ text, files });
    const ocrItems = reclassifyAndClean(ocrBundleRaw?.items || []);
    const ocrBundle = { ...ocrBundleRaw, items: ocrItems };
    console.log("Step 1: OK.");

    // 2) LLM Audit
    console.log("Step 2: Expert Audit (OpenAI)...");
    const auditBundle = { patientInfo, diagnoses: ocrBundle?.diagnoses || [], ocrItems, ocrPatient: ocrBundle?.patient || {}, originalUserText: text };
    let structured = await getAuditFromOpenAI(auditBundle);
    console.log("Step 2: OK.");

    // 2b) Grounding و إنقاذ التردد من RAW (قبل السياسات)
    console.log("Step 2b: Grounding & Frequency Rescue...");
    structured = groundAuditRowsToOCR(structured, ocrItems);
    structured = rescueFrequencyFromRaw(structured, ocrItems);

    // 2c) سياسات/سلامة
    console.log("Step 2c: Policies & Safety...");
    structured = postProcessPolicyAndSafety(structured, patientInfo || ocrBundle?.patient || {});

    // 2d) ECG/hs‑cTn عند اللزوم فقط
    console.log("Step 2d: Conditional ECG/Troponin...");
    const contextText = [text, JSON.stringify(patientInfo||{}), ...(ocrBundle?.diagnoses||[])].join(" ");
    structured = ensureECGAndTroponin(structured, { diagnoses: ocrBundle?.diagnoses || [], text: contextText });

    // 3) HTML
    console.log("Step 3: Rendering HTML...");
    const htmlReport = renderHtmlReport(structured, lang);

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured, ocr: ocrBundle });

  } catch (err) {
    console.error("---!!!--- ERROR ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    return bad(res, 500, `Internal server error: ${err.message}`);
  }
}
