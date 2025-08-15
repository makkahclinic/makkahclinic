// pages/api/gpt.js
// Unified Medical Auditor — Gemini (+ optional OpenAI OCR)
// Next.js Pages Router / Vercel (Node 18+)
//
// ========================= ENV =========================
// GEMINI_API_KEY   = "sk-..."   (required)
// OPENAI_API_KEY   = "sk-..."   (optional → OCR for images)
// =======================================================

import { createHash } from "crypto";

// ------------ CONFIG ------------
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRY_STATUS = new Set([408, 409, 413, 429, 500, 502, 503, 504]);

const MAX_FILES_PER_REQUEST = 30;
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_OCR_IMAGES = 20;
const OCR_MODEL = "gpt-4o-mini";

// ------------ IN-MEM CACHE ------------
const fileCache = new Map();

// ------------ UTILS ------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function abortableFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
}
async function fetchWithRetry(url, options, { retries = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const res = await abortableFetch(url, options, timeoutMs);
    if (!res.ok && retries > 0 && RETRY_STATUS.has(res.status)) {
      await sleep((4 - retries) * 1000);
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      await sleep((4 - retries) * 1000);
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    throw err;
  }
}

function detectMimeFromB64(b64 = "") {
  const h = (b64 || "").slice(0, 24);
  if (h.includes("JVBERi0")) return "application/pdf";
  if (h.includes("iVBORw0")) return "image/png";
  if (h.includes("/9j/")) return "image/jpeg";
  if (h.includes("UklGR")) return "image/webp";
  if (h.includes("R0lGOD")) return "image/gif";
  if (h.includes("AAAAIG")) return "video/mp4";
  return "application/octet-stream";
}
function getFileHash(base64Data = "") {
  return createHash("sha256").update(base64Data).digest("hex");
}
function asDataUrl(mime, b64) { return `data:${mime};base64,${b64}`; }
function stripFences(s = "") { return s.replace(/```html/gi, "").replace(/```/g, "").trim(); }
function escapeHtml(s = "") { return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function stripTags(s = "") { return s.replace(/<[^>]*>/g, " "); }

// ---- Date helpers ----
function normalizeDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let a = parseInt(m[1], 10), b = parseInt(m[2], 10), c = parseInt(m[3], 10);
  let Y, M, D;
  if (m[1].length === 4) { Y = a; M = b; D = c; }
  else if (m[3].length === 4) {
    Y = c;
    if (a > 12) { D = a; M = b; } else if (b > 12) { D = b; M = a; } else { D = a; M = b; }
  } else { return null; }
  const pad = (n) => String(n).padStart(2, "0");
  return `${Y}-${pad(M)}-${pad(D)}`;
}
function computeAgeFromDob(dobIso) {
  try {
    const today = new Date();
    const [y, m, d] = dobIso.split("-").map((n) => parseInt(n, 10));
    let age = today.getUTCFullYear() - y;
    const mToday = today.getUTCMonth() + 1;
    const dToday = today.getUTCDate();
    if (mToday < m || (mToday === m && dToday < d)) age -= 1;
    return age;
  } catch { return undefined; }
}

// =============== SYSTEM PROMPT (تحليل نهائي) ===============
const systemInstruction = `
أنت استشاري "تدقيق طبي وتشغيلي" خبير عالمي. هدفك: دقة 10/10. أخرج **كتلة HTML واحدة فقط** وفق القالب.

[قواعد أساسية (ملزمة)]
- **مصدر الحقيقة**: "بيانات المريض" أدناه هي المرجع النهائي. إذا خالفتها الملفات، اذكر التعارض في "تحليل الملفات" لكن اتّبع "بيانات المريض" في الاستنتاج.
- **Red Flags**: مدخن + سعال ⇒ Chest X-ray ضمن "خدمات ضرورية".
- **توافق ديموغرافي**: راقب أخطاء الجنس/التشخيص/الدواء.

[منهجية الدواء]
- **Triplex ⇒ Triplixam** عند الاشتباه؛ **Form XR ⇒ Metformin XR**.
- **كبار السن (>65)**: راقب نقص السكر مع Sulfonylurea وخطر السقوط مع ≥2 خافضات ضغط.
- **أمان محدد**:
  - **Metformin XR**: "مضاد استطباب إذا eGFR < 30".
  - **ACEI + ARB معًا**: **ممنوع**.
  - **ازدواجية المواد**: تحقّق من التكرار غير المباشر.

[قواعد الفحوص/الإجراءات (تأمينية)]
- أدخل كل عنصر يظهر من الملف/الـOCR كصف في الجدول.
- **Dengue Ab IgG**: إن **لم تُذكر** حمّى أو سفر لمنطقة موبوءة، فالقرار إلزاميًا: <span class='status-yellow'>⚠️ قابل للمراجعة: يحتاج NS1/NAAT أو IgM للتشخيص الحاد.</span>
- **Nebulizer/Inhaler (خارجي)**: <span class='status-yellow'>⚠️ قابل للمراجعة: لزوم أعراض تنفسية موثقة.</span>
- **Pantoprazole IV / Normal Saline IV / I.V infusion only / Primperan IV / Paracetamol IV** (حالات خارجية) ⇒ <span class='status-yellow'>⚠️ مؤشرات واضحة فقط.</span>
- فحوص السكري/الضغط الروتينية ⇒ <span class='status-green'>✅ مقبول</span>.

[قائمة تحاليل إلزامية عند تواجد الأدوية]
- **Metformin XR**: eGFR/Creatinine + **B12** للاستخدام الطويل.
- **Co-Taburan/Triplixam**: **K+** و **Creatinine** بعد 1–2 أسبوع.
- **Statin**: **ALT/AST** بدايةً وعند وجود أعراض.

[البنية]
<style>
  .status-green { display:inline-block;background:#d4edda;color:#155724;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #c3e6cb }
  .status-yellow{ display:inline-block;background:#fff3cd;color:#856404;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #ffeeba }
  .status-red   { display:inline-block;background:#f8d7da;color:#721c24;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #f5c6cb }
  .section-title{ color:#1e40af;font-weight:bold }
  .critical     { color:#991b1b;font-weight:bold }
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #e5e7eb;padding:8px}
  thead th{background:#f3f4f6}
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><h4>تحليل الملفات المرفوعة</h4><h4>التحليل السيريري العميق</h4>
<h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr>
<th>الدواء/الإجراء (مع درجة الثقة)</th><th>الجرعة الموصوفة</th><th>الجرعة الصحيحة المقترحة</th><th>التصنيف</th><th>الغرض الطبي</th><th>التداخلات</th><th>درجة الخطورة (%)</th><th>قرار التأمين</th>
</tr></thead><tbody></tbody></table>
<h4 class="section-title">خدمات طبية ضرورية ومقبولة تأمينياً (مدعومة بالأدلة العلمية)</h4>
<h5 class="critical">تعديلات دوائية حرجة (Urgent Medication Adjustments)</h5>
<ul></ul>
<h5>تحاليل مخبرية ضرورية (Essential Lab Tests)</h5>
<ul></ul>
<h5>متابعة وفحوصات دورية (Routine Monitoring & Tests)</h5>
<ul></ul>
<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>
`;

// =============== MINI-EXTRACTOR (facts) ===============
async function geminiExtractFacts(apiKey, fileParts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const extractionInstruction = `
أنت مستخرج حقائق من مستندات UCAF/طلبات طبية.
أخرج JSON فقط بالمفاتيح التالية:
{
  "patientName": string|null,
  "dob": "YYYY-MM-DD"|null,
  "gender": "ذكر"|"أنثى"|null,
  "hasReferralReason": boolean,
  "hasRespContext": boolean,
  "hasIVIndication": boolean,
  "hasUSIndication": boolean,
  "hasDengueAcuteContext": boolean,
  "hasLiverDisease": boolean,
  "hasRenalImpairment": boolean,
  "weightKg": number|null,
  "eGFR": number|null,
  "ALT": number|null,
  "AST": number|null
}
- إذا تعذر الاستخراج ضع null/false فقط.
- لا تضف أي شرح خارج JSON.`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: extractionInstruction }, ...fileParts] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          patientName: { type: "string" },
          dob: { type: "string" },
          gender: { type: "string", enum: ["ذكر", "أنثى"] },
          hasReferralReason: { type: "boolean" },
          hasRespContext: { type: "boolean" },
          hasIVIndication: { type: "boolean" },
          hasUSIndication: { type: "boolean" },
          hasDengueAcuteContext: { type: "boolean" },
          hasLiverDisease: { type: "boolean" },
          hasRenalImpairment: { type: "boolean" },
          weightKg: { type: "number" },
          eGFR: { type: "number" },
          ALT: { type: "number" },
          AST: { type: "number" }
        },
        additionalProperties: false,
      },
    },
  };

  const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini extractor error ${res.status}: ${raw.slice(0, 500)}`);

  try {
    const obj = JSON.parse(raw);
    const text = obj?.candidates?.[0]?.content?.parts?.map(p => p?.text || "").join("") || raw;
    const parsed = JSON.parse(text || "{}");
    if (parsed?.dob) parsed.dob = normalizeDate(parsed.dob) || parsed.dob;
    return parsed || {};
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return {};
    try {
      const parsed = JSON.parse(m[0]);
      if (parsed?.dob) parsed.dob = normalizeDate(parsed.dob) || parsed.dob;
      return parsed;
    } catch { return {}; }
  }
}

// =============== USER PROMPT BUILDER ===============
function buildUserPrompt(user = {}, facts = {}) {
  const dob = user.dob ?? facts.dob ?? null;
  const age = user.age ?? (dob ? computeAgeFromDob(dob) : undefined) ?? undefined;
  const gender = user.gender ?? facts.gender ?? "غير محدد";

  return `
**بيانات المريض (مرجِع التحليل):**
العمر: ${age ?? "غير محدد"}
الجنس: ${gender}
تاريخ الميلاد: ${dob ?? "—"}
هل المريض مدخن؟: ${user.isSmoker ? "نعم" : (user.isSmoker === false ? "لا" : "غير محدد")}
باك-سنة: ${user.packYears ?? "غير محدد"}
وصف الحالة/الأعراض: ${user.notes || "—"}
أمراض مُدرجة: ${Array.isArray(user.problems) ? user.problems.join(", ") : "—"}

**مؤشرات من الملف (استخراج آلي):**
سبب إحالة موجود؟ ${facts.hasReferralReason ? "نعم" : "لا"}
سياق تنفّسي؟ ${facts.hasRespContext ? "نعم" : "لا"}
مؤشرات سوائل وريدية؟ ${facts.hasIVIndication ? "نعم" : "لا"}
مبرر Ultrasound؟ ${facts.hasUSIndication ? "نعم" : "لا"}
سياق ضنك حاد (حمّى/سفر لمنطقة موبوءة)؟ ${facts.hasDengueAcuteContext ? "نعم" : "لا"}
قصور كبدي؟ ${facts.hasLiverDisease ? "نعم" : "لا"} | قصور كلوي؟ ${facts.hasRenalImpairment ? "نعم" : "لا"} | eGFR: ${facts.eGFR ?? "—"} | ALT: ${facts.ALT ?? "—"} | AST: ${facts.AST ?? "—"} | الوزن: ${facts.weightKg ?? "—"} كجم

**نص الأدوية/الإجراءات من المستخدم:** ${user.medications || "—"}
**عدد الملفات المرفوعة:** ${Array.isArray(user.files) ? user.files.length : 0}

[تعليمات المخرجات]
- أخرج HTML واحد فقط، دون كتل كود.
- إذا تعارضت بيانات الملفات مع "بيانات المريض" أعلاه فاذكر التعارض لكن اتّبع "بيانات المريض" في الاستنتاج النهائي.
`;
}

// =============== OPENAI OCR (اختياري للصور) ===============
async function ocrWithOpenAI(openaiKey, files) {
  const IMG = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const candidates = files.filter((f) => IMG.has(f.type || detectMimeFromB64(f.data))).slice(0, MAX_OCR_IMAGES);
  if (!candidates.length) return "";
  const images = candidates.map((f) => ({ type: "image_url", image_url: { url: asDataUrl(f.type || detectMimeFromB64(f.data), f.data) } }));

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OCR_MODEL,
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          { role: "system", content: "استخرج نصًا واضحًا سطرًا بسطر من صور طلبات/فواتير/وصفات طبية (الخدمات، التحاليل، الأدوية والجرعات). اكتب بالعربية قدر الإمكان وأبقِ الكلمات الإنجليزية كما هي." },
          { role: "user", content: images },
        ],
      }),
    });
    if (!res.ok) { console.warn("OpenAI OCR error:", res.status, await res.text()); return ""; }
    const j = await res.json();
    return (j?.choices?.[0]?.message?.content || "").trim();
  } catch (e) { console.warn("OpenAI OCR exception:", e.message); return ""; }
}

// =============== GEMINI FILES (inline or upload) ===============
async function geminiUploadSimple(apiKey, base64Data, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64Data, "base64");
  const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": mime }, body: buf });
  if (!res.ok) { throw new Error(`Gemini simple upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`); }
  const j = await res.json();
  return j?.file?.uri || j?.uri || null;
}
async function geminiUploadResumable(apiKey, base64Data, mime) {
  const buf = Buffer.from(base64Data, "base64");
  const start = await fetchWithRetry(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buf.byteLength),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ file: { mimeType: mime, displayName: "upload" } }),
  });
  if (!start.ok) { throw new Error(`Gemini resumable start failed (${start.status}): ${(await start.text()).slice(0, 300)}`); }
  const uploadUrl = start.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Missing X-Goog-Upload-URL");
  const up = await fetchWithRetry(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mime, "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: buf,
  });
  if (!up.ok) { throw new Error(`Gemini resumable upload failed (${up.status}): ${(await up.text()).slice(0, 300)}`); }
  const j = await up.json();
  return j?.file?.uri || j?.uri || null;
}
async function geminiUpload(apiKey, base64Data, mime) {
  try { return await geminiUploadSimple(apiKey, base64Data, mime); }
  catch (e1) { console.warn("Simple upload failed, trying resumable…", e1.message); return await geminiUploadResumable(apiKey, base64Data, mime); }
}

// =============== GEMINI CALL ===============
async function geminiGenerate(apiKey, parts, cfg = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = { contents: [{ role: "user", parts }], generationConfig: { temperature: 0.2, topP: 0.9, topK: 40, maxOutputTokens: 8192, ...cfg } };
  const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${raw.slice(0, 600)}`);
  try {
    const j = JSON.parse(raw);
    const text = (j?.candidates?.[0]?.content?.parts || []).map((p) => p?.text || "").filter(Boolean).join("\n");
    return enforceHtml(text);
  } catch { return enforceHtml(raw); }
}
function enforceHtml(s = "") {
  const t = stripFences(s);
  const looksHtml = /<\/?(html|body|table|tr|td|th|ul|ol|li|h\d|p|span|div|style)\b/i.test(t);
  if (looksHtml) return t;
  const skin = `
  <style>
    .status-green { display:inline-block;background:#d4edda;color:#155724;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #c3e6cb }
    .status-yellow{ display:inline-block;background:#fff3cd;color:#856404;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #ffeeba }
    .status-red   { display:inline-block;background:#f8d7da;color:#721c24;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #f5c6cb }
    .section-title{ color:#1e40af;font-weight:bold }
    .critical     { color:#991b1b;font-weight:bold }
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.65;padding:6px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #e5e7eb;padding:8px;font-size:14px}
    thead th{background:#f3f4f6}
  </style>`;
  return `${skin}<pre style="white-space:pre-wrap">${escapeHtml(t)}</pre>`;
}

// =============== TEXT UTILS (canon + dose parsing) ===============
const SYN_MAP = new Map([
  [/paracetamol|acetaminophen|ofirmev|b\.?braun/gi, "paracetamol-iv"],
  [/pantozol|protonix|pantoprazole/gi, "pantoprazole-iv"],
  [/primperan|metoclopramide/gi, "metoclopramide-iv"],
  [/normal\s*saline|nacl 0\.?9%/gi, "iv-fluids"],
  [/i\.?v\.?\s*infusion\s*only/gi, "iv-infusion-only"],
  [/nebulizer|\binhail?er\b|استنشاق|نيبول/gi, "nebulizer-inhaler"],
  [/ultra\s*sound|ultrasound|سونار|ألترا/gi, "ultrasound"],
  [/glycosylated.*(hemoglobin|haemoglobin)|\bhba1c\b/gi, "hba1c"],
  [/cholest?erol/gi, "cholesterol"],
  [/l\.?d\.?l/gi, "ldl"],
  [/triglycerides?/gi, "triglycerides"],
  [/sgpt|alt\b|liver enzyme/gi, "alt"],
  [/creatinine/gi, "creatinine"],
  [/urea\b/gi, "urea"],
  [/uric acid/gi, "uric-acid"],
  [/complete urine analysis|urinalysis/gi, "urinalysis"],
  [/cbc|complete blood (cell|count)/gi, "cbc"],
  [/c-?reactive protein|crp/gi, "crp"],
  [/dengue.*igg/gi, "dengue-igg"],
  [/referral|إحالة|تحويل/gi, "referral"]
]);

function canonicalServiceKey(raw = "") {
  let s = (raw || "").toLowerCase();
  // أزل الجرعات/الأحجام حتى لا تمنع كشف التكرار
  s = s.replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|units?)\b/gi, " ");
  s = s.replace(/\b\d+\s*(x|×|ml|amp|vial|bag)\b/gi, " ");
  s = s.replace(/[\(\)\[\]\.,\-_/]+/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, canon] of SYN_MAP) if (re.test(s)) return canon;
  return s;
}

// يحاول تقدير الجرعة بالـ mg من نص السطر نفسه
function extractDoseMgFromText(raw = "") {
  const s = String(raw);
  const mgOnly = s.match(/(\d+(?:\.\d+)?)\s*mg\b/i);
  const conc = s.match(/(\d+(?:\.\d+)?)\s*mg\/\s*ml/i);
  const vol = s.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (conc && vol) { return parseFloat(conc[1]) * parseFloat(vol[1]); }
  if (mgOnly) return parseFloat(mgOnly[1]);
  const mgPerMl = s.match(/(\d+(?:\.\d+)?)\s*mg[\-\/]?\s*ml/i);
  const vol2 = s.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mgPerMl && vol2) return parseFloat(mgPerMl[1]) * parseFloat(vol2[1]);
  return null;
}

// قواعد دوائية أساسية للفحص
const DOSE_RULES = {
  "paracetamol-iv": { maxSingleMg: 1000, maxDailyMg: 4000, maxDailyHepaticMg: 2000 }, // FDA Ofirmev
  "pantoprazole-iv": { typicalSingleMg: 40, maxDailyMg: 40 },                          // Protonix IV
  "metoclopramide-iv": { typicalSingleMg: 10, maxDailyMg: 40, renalReduce: true }      // StatPearls
};

// =============== ثوابت للكشف عن صفوف رأس/عناوين ===============
const COLUMN_TITLES_SET = new Set([
  "الدواء/الإجراء (مع درجة الثقة)",
  "الجرعة الموصوفة",
  "الجرعة الصحيحة المقترحة",
  "التصنيف",
  "الغرض الطبي",
  "التداخلات",
  "درجة الخطورة (%)",
  "قرار التأمين"
]);
const HEADER_TOKENS = [
  "الدواء","الإجراء","الجرعة","التصنيف",
  "الغرض","التداخلات","الخطورة","قرار","التأمين",
  "dose","classification","purpose","interactions","risk","insurance"
];

// =============== POLICY OVERRIDES (antes/post report) ===============
const DENGUE_TRIGGERS = [
  "حمى","سخونة","ارتفاع الحرارة","fever",
  "سفر إلى","travel to",
  "منطقة موبوءة","endemic area",
  "إندونيسيا","الفلبين","تايلاند","ماليزيا","الهند","بنغلاديش",
  "البرازيل","المكسيك","بيرو","كولومبيا","فيتنام","سريلانكا","سنغافورة"
];
const RESP_TRIGGERS = ["سعال","صفير","ضيق تنفس","asthma","copd","wheeze","shortness of breath","dyspnea"];
const IV_TRIGGERS = ["جفاف","dehydration","قيء شديد","severe vomiting","تعذر فموي","npo","نزف","bleeding","هبوط ضغط","hypotension"];
const US_TRIGGERS = ["ألم بطني","epigastric pain","ruq pain","gallbladder","كبد","حوض","pelvic","umbilical","periumbilical"];

function bagOfText({ body = {}, ocrText = "", facts = {}, modelHtml = "" } = {}) {
  return [
    body.notes || "",
    Array.isArray(body.problems) ? body.problems.join(" ") : "",
    ocrText || "",
    stripTags(modelHtml || ""),
  ].join(" ").toLowerCase();
}
function hasAny(text, arr) { const s = text.toLowerCase(); return arr.some(w => s.includes(w.toLowerCase())); }

// ====== Helpers: صف فارغ/رأس يشبه العناوين ======
function isEmptyRow(cells = []) {
  const plain = cells.map(c => stripTags(c || "").trim());
  if (!plain.length) return true;
  return plain.every(t => !t || /^[-–—\s]+$/.test(t));
}
function isHeaderLikeRow(rowHtml = "", cells = []) {
  const hasTh = /<th\b/i.test(rowHtml);
  const plain = cells.map(c => stripTags(c || "").trim());
  const joined = plain.join(" ").toLowerCase();
  const headerHits = HEADER_TOKENS.reduce((n, tok) => n + (joined.includes(tok) ? 1 : 0), 0);
  const allFromColumnSet = plain.length > 0 && plain.every(t => COLUMN_TITLES_SET.has(t));
  const looksLikeRealData = /\b(cbc|creatinine|pantoprazole|pantozol|paracetamol|metoclopramide|primperan|dengue|hba1c|cholest|ldl|triglycerid|uric|urea|crp|urinalysis|ultra\s*sound|nebulizer|inhaler|referral)\b/i.test(joined);
  return hasTh || allFromColumnSet || (!looksLikeRealData && headerHits >= 3);
}

// ====== محرّك تعديل الصفوف (يمرّ على <tbody> فقط) ======
function mutateRows(html = "", fn) {
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return html;
  const tbody = tbodyMatch[1];
  const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const newRows = [];
  for (const m of rows) {
    const rowHtml = m[0];
    const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x => x[1]);
    const res = fn(rowHtml, cells) || {};
    const keep = res.keep !== false;
    if (!keep) continue;
    if (res.newCells && Array.isArray(res.newCells)) {
      const tds = res.newCells.map(c => `<td>${c}</td>`).join("");
      newRows.push(`<tr>${tds}</tr>`);
    } else {
      newRows.push(rowHtml);
    }
  }
  const newTbody = newRows.join("");
  return html.replace(tbodyMatch[0], `<tbody>${newTbody}</tbody>`);
}

// ====== قواعد إلزامية خاصة بالخدمات ======
function forceDengueRule(html = "", ctx = {}) {
  const txt = bagOfText(ctx);
  const hasAcute = ctx?.facts?.hasDengueAcuteContext || hasAny(txt, DENGUE_TRIGGERS);
  if (hasAcute) return html;
  return mutateRows(html, (row, cells) => {
    const name = stripTags(cells[0] || "");
    if (!/(dengue|الضنك)/i.test(name)) return { keep: true };
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: يحتاج مبرر سريري (حمّى/تعرض) ويفضّل NS1/NAAT أو IgM للتشخيص الحاد.</span>`;
    cells[cells.length - 1] = caution;
    return { keep: true, newCells: cells };
  });
}
function forceReferralRule(html = "", ctx = {}) {
  const hasReason = !!ctx?.facts?.hasReferralReason || hasAny(bagOfText(ctx), ["إحالة","referral for","تحويل"]);
  if (hasReason) return html;
  return mutateRows(html, (row, cells) => {
    const name = stripTags(cells[0] || "");
    if (!/referral|إحالة|تحويل/i.test(name)) return { keep: true };
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: يتطلب ذكر سبب إحالة واضح.</span>`;
    cells[cells.length - 1] = caution;
    return { keep: true, newCells: cells };
  });
}
function forceNebulizerRule(html = "", ctx = {}) {
  const hasResp = !!ctx?.facts?.hasRespContext || hasAny(bagOfText(ctx), RESP_TRIGGERS);
  if (hasResp) return html;
  return mutateRows(html, (row, cells) => {
    const name = stripTags(cells[0] || "");
    if (!/(nebulizer|inhail|inhaler|استنشاق|نيبول)/i.test(name)) return { keep: true };
    cells[cells.length - 1] = `<span class="status-yellow">⚠️ قابل للمراجعة: لزوم أعراض/تشخيص تنفسي موثق.</span>`;
    return { keep: true, newCells: cells };
  });
}
function forceIVRule(html = "", ctx = {}) {
  const hasIV = !!ctx?.facts?.hasIVIndication || hasAny(bagOfText(ctx), IV_TRIGGERS);
  if (hasIV) return html;
  const IV_KEYS = /(normal\s*saline|i\.?v\.?\s*infusion\s*only|primperan|metoclopramide|paracetamol\s+.*infus|pantoprazole|pantozol)/i;
  return mutateRows(html, (row, cells) => {
    const plain = stripTags(cells[0] || "");
    if (!IV_KEYS.test(plain)) return { keep: true };
    cells[cells.length - 1] = `<span class="status-yellow">⚠️ قابل للمراجعة: استعمال وريدي يحتاج مؤشرات واضحة (جفاف/تعذّر فموي/نزف...).</span>`;
    return { keep: true, newCells: cells };
  });
}
function forceUSRule(html = "", ctx = {}) {
  const hasUS = !!ctx?.facts?.hasUSIndication || hasAny(bagOfText(ctx), US_TRIGGERS);
  if (hasUS) return html;
  return mutateRows(html, (row, cells) => {
    const name = stripTags(cells[0] || "");
    if (!/(ultra\s*sound|ultrasound|سونار|ألترا)/i.test(name)) return { keep: true };
    cells[cells.length - 1] = `<span class="status-yellow">⚠️ قابل للمراجعة: يتطلب مبرر تصوير واضح.</span>`;
    return { keep: true, newCells: cells };
  });
}

// =============== جرعات/سلامة (تحليل بعدي) ===============
function doseSafetyGuard(html = "", ctx = {}) {
  const { facts = {} } = ctx;
  const hepatic = Boolean(facts.hasLiverDisease) || (facts.ALT > 3 || facts.AST > 3);
  const renal = Boolean(facts.hasRenalImpairment) || (facts.eGFR && facts.eGFR < 60);

  return mutateRows(html, (row, cells) => {
    const nameCell = stripTags(cells[0] || "");
    const key = canonicalServiceKey(nameCell);
    const doseCellText = [cells[1], cells[0]].map(c => stripTags(c || "")).join(" ");
    const mg = extractDoseMgFromText(doseCellText);

    if (!DOSE_RULES[key]) return { keep: true };

    let notes = [];

    if (key === "paracetamol-iv") {
      if (mg && mg > DOSE_RULES[key].maxSingleMg) {
        cells[cells.length - 1] = `<span class="status-red">❌ مرفوض: جرعة فردية ${mg}mg تتجاوز الحد الأقصى ${DOSE_RULES[key].maxSingleMg}mg (OFIRMEV).</span>`;
        return { keep: true, newCells: cells };
      }
      if (hepatic) {
        notes.push(`⚠️ حد يومي مخفض في القصور الكبدي ≤ ${DOSE_RULES[key].maxDailyHepaticMg}mg/يوم.`);
      } else {
        notes.push(`⚠️ تأكد ألّا يتجاوز إجمالي اليوم ${DOSE_RULES[key].maxDailyMg}mg/يوم.`);
      }
    }

    if (key === "pantoprazole-iv") {
      if (mg && mg !== DOSE_RULES[key].maxDailyMg) {
        notes.push(`⚠️ الجرعة المعتادة 40mg IV مرة يوميًا لمدة 7–10 أيام.`);
      }
    }

    if (key === "metoclopramide-iv") {
      const typical = DOSE_RULES[key].typicalSingleMg;
      if (mg && mg > typical) {
        notes.push(`⚠️ الجرعة المعتادة 10mg للبالغين؛ تحقّق من سبب التجاوز.`);
      }
      if (renal) {
        notes.push(`⚠️ قصور كلوي: فكّر بتقليل الجرعة (قد تصل 5mg مرتين/يوم في الديال).`);
      }
    }

    if (notes.length) {
      cells[cells.length - 1] = `<span class="status-yellow">${notes.join(" ")}</span>`;
      return { keep: true, newCells: cells };
    }
    return { keep: true };
  });
}

// =============== إزالة العناوين/الفراغات ثم إزالة المكررات ===============
function dedupeAndPrune(html = "") {
  const seen = new Set();
  const removed = [];

  // 1) احذف الصفوف الفارغة وصفوف العناوين الشبيهة بالرأس داخل tbody
  let cleaned = mutateRows(html, (rowHtml, cells) => {
    if (isEmptyRow(cells)) return { keep: false };
    if (isHeaderLikeRow(rowHtml, cells)) return { keep: false };
    return { keep: true };
  });

  // 2) إزالة التكرار بالاعتماد على المفتاح الموحّد للخدمة
  cleaned = mutateRows(cleaned, (rowHtml, cells) => {
    const firstCell = stripTags(cells[0] || "");
    if (!firstCell) return { keep: false };
    const key = canonicalServiceKey(firstCell);
    if (seen.has(key)) {
      removed.push(firstCell);
      return { keep: false };
    }
    seen.add(key);
    return { keep: true };
  });

  // 3) أضف ملخصًا أسفل الجدول عند وجود إزالة
  if (removed.length) {
    cleaned = cleaned.replace(/<\/table>\s*<h4\b/i,
      `</table><div style="margin:8px 0"><span class="status-red">❌ تمت إزالة ${removed.length} صف(وف) مكررة/غير صالحة من الجدول.</span></div><h4`);
  }
  return cleaned;
}

// =============== APPLY ALL OVERRIDES ===============
function applyPolicyOverrides(htmlReport, ctx) {
  let out = htmlReport;
  out = forceDengueRule(out, ctx);
  out = forceReferralRule(out, ctx);
  out = forceNebulizerRule(out, ctx);
  out = forceIVRule(out, ctx);
  out = forceUSRule(out, ctx);
  out = doseSafetyGuard(out, ctx);
  out = dedupeAndPrune(out);
  return out;
}

// =============== API HANDLER ===============
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const startedAt = Date.now();

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error("GEMINI_API_KEY missing");
    const openaiKey = process.env.OPENAI_API_KEY || null;

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES_PER_REQUEST) : [];

    // 1) OCR (اختياري)
    let ocrText = "";
    if (openaiKey && files.length) {
      try { ocrText = await ocrWithOpenAI(openaiKey, files); }
      catch (e) { console.warn("OCR skipped:", e.message); }
    }

    // 2) تجهيز ملفات Gemini
    const filePartsPromises = files.map(async (f) => {
      try {
        const base64 = f?.data || "";
        if (!base64) return null;
        const mime = f.type || detectMimeFromB64(base64);
        const hash = getFileHash(base64);
        if (fileCache.has(hash)) return fileCache.get(hash);
        const buf = Buffer.from(base64, "base64");
        let part;
        if (buf.byteLength > MAX_INLINE_FILE_BYTES) {
          const uri = await geminiUpload(geminiKey, base64, mime);
          part = { file_data: { mime_type: mime, file_uri: uri } };
        } else {
          part = { inline_data: { mime_type: mime, data: base64 } };
        }
        if (fileCache.size > 256) fileCache.clear();
        fileCache.set(hash, part);
        return part;
      } catch (e) {
        console.warn(`File processing failed (${f?.name || "file"}):`, e.message);
        return null;
      }
    });
    const processedFileParts = (await Promise.all(filePartsPromises)).filter(Boolean);

    // 3) حقائق منظّمة
    let facts = {};
    if (processedFileParts.length) {
      try {
        const rawFacts = await geminiExtractFacts(geminiKey, processedFileParts);
        facts = { ...rawFacts };
        if (facts?.dob && !body.age && !body.dob) body.dob = facts.dob;
        if (facts?.gender && !body.gender) body.gender = facts.gender;
      } catch (e) {
        console.warn("facts extractor failed:", e.message);
      }
    }

    // 4) بناء الطلب النهائي
    const parts = [{ text: systemInstruction }, { text: buildUserPrompt(body, facts) }];
    if (processedFileParts.length) parts.push(...processedFileParts);
    if (ocrText) parts.push({ text: `### OCR Extracted Texts\n${ocrText}` });

    // 5) استدعاء Gemini للتقرير
    const htmlReportRaw = await geminiGenerate(geminiKey, parts);

    // 6) تطبيق القواعد القسرية + إزالة المكررات + فحص الجرعات
    const htmlReport = applyPolicyOverrides(htmlReportRaw, { body, ocrText, facts, modelHtml: htmlReportRaw });

    const elapsedMs = Date.now() - startedAt;
    return res.status(200).json({
      ok: true,
      at: nowIso(),
      htmlReport,
      meta: {
        model: GEMINI_MODEL,
        filesReceived: files.length,
        filesAttachedToModel: processedFileParts.length,
        usedOCR: Boolean(ocrText),
        facts,
        elapsedMs,
      },
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      ok: false,
      at: nowIso(),
      error: "Internal server error",
      detail: err?.message || String(err),
    });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "12mb" } },
};
// --- أدخِل هذه الدالّة: حقن آمن بعد أول جدول بدون لمس بقية الصفحة ---
function safeInsertAfterFirstTable(html, fragment) {
  if (!html) return html;
  const lower = html.toLowerCase();
  const endIdx = lower.indexOf('</table>');
  if (endIdx === -1) return html; // لا يوجد جدول
  return html.slice(0, endIdx + 8) + fragment + html.slice(endIdx + 8);
}

// --- استبدِل دالة dedupeAndPrune بهذه النسخة الآمنة ---
function dedupeAndPrune(html) {
  if (!html) return html;

  // 1) نظّف صفوف العناوين المكررة داخل tbody (أحيانًا النموذج يولّد "رأس" كصف بيانات)
  const HEADER_PAT = /(الدواء\/?الإجراء|الجرعة الموصوفة|الجرعة الصحيحة المقترحة|التصنيف|الغرض الطبي|التداخلات|درجة الخطورة|قرار التأمين)/i;
  html = html.replace(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi, (m, body) => {
    // افصل الصفوف ثم أعد بناء tbody مع إسقاط الصفوف الرأسية أو الفارغة
    const rows = body.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const cleanedRows = [];
    const seenKeys = new Set();

    for (const row of rows) {
      // استخرج أول خلية كاسم خدمة
      const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
      const plain = cells.map(c => c.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      if (!plain.length) continue;

      // أسقط الصف إذا كان رؤوس جدول متنكرة كبيانات
      const looksHeader = plain.some(txt => HEADER_PAT.test(txt));
      if (looksHeader) continue;

      // طبّع الاسم لتقليل التكرار (تجاهل الجرعات والعلامات التجارية)
      const k = (plain[0] || '')
        .toLowerCase()
        .replace(/[()،,.-]/g, ' ')
        .replace(/\b(\d+(\.\d+)?)\s*(mg|g|ml|mcg|iu)\b/gi, '') // تجاهل الجرعات
        .replace(/\b(b\.?braun|pfizer|abbvie|gsk|novartis|roche|sanofi)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (k && seenKeys.has(k)) {
        // صف مكرر: حوّل قرار التأمين إلى "❌ مرفوض (تكرار)"
        const rej = `<span class="status-red">❌ مرفوض: تكرار الخدمة في نفس الزيارة.</span>`;
        const rebuilt = row.replace(/<td[^>]*>[\s\S]*?<\/td>\s*<\/tr>\s*$/i, (lastCell) =>
          lastCell.replace(/(<td[^>]*>)[\s\S]*?(<\/td>)/i, `$1${rej}$2`)
        );
        cleanedRows.push(rebuilt);
        continue;
      }

      seenKeys.add(k);
      cleanedRows.push(row);
    }

    return `<tbody>${cleanedRows.join('')}</tbody>`;
  });

  // 2) احقن ملخص “التكرارات المكتشفة” بعد أول جدول بشكل آمن بدون المساس ببقية الصفحة
  const summaryBox = `
    <div style="background:#fff3cd;border:1px solid #ffeeba;border-radius:10px;padding:10px;margin:12px 0">
      <strong>ملاحظة تشغيلية:</strong> تمت إزالة/وسم الصفوف المكررة آليًا لتجنّب الازدواجية في المطالبة.
      إذا كان التكرار مقصودًا (خدمتان منفصلتان بزمن/سبب مختلف)، أضِف التبرير في النموذج.
    </div>
  `;
  html = safeInsertAfterFirstTable(html, summaryBox);

  // 3) سدّ أي وسوم جدول مفتوحة قد تكسر ما بعدها (حماية خفيفة)
  html = html
    .replace(/(<tr[^>]*>(?:(?!<\/tr>)[\s\S])*)$/i, '$1</tr>')
    .replace(/(<tbody[^>]*>(?:(?!<\/tbody>)[\s\S])*)$/i, '$1</tbody>')
    .replace(/(<table[^>]*>(?:(?!<\/table>)[\s\S])*)$/i, '$1</table>');

  return html;
}
