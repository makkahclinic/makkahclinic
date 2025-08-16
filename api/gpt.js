// pages/api/gpt.js
// Unified Expert Analyzer — Gemini + (optional) OpenAI OCR
// Next.js Pages Router / Vercel (Node 18+)

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
function hardHtmlEnforce(s = "") {
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
- **مصدر الحقيقة**: "بيانات المريض" المرسلة يدويًا هي المرجع النهائي. إذا خالفتها الملفات، اذكر التعارض في "تحليل الملفات" لكن ابنِ القرار النهائي على بيانات المريض.
- **Red Flags**: مدخن + سعال (خصوصًا مع دم) ⇒ أوصِ بـ **Chest X-ray** ضمن "خدمات ضرورية".
- **توافق ديموغرافي**: راقب أخطاء الجنس/التشخيص/الدواء.

[منهجية الدواء]
- **Triplex ⇒ Triplixam** عند الاشتباه؛ **Form XR ⇒ Metformin XR**.
- **كبار السن (>65)**: راقب نقص السكر مع Sulfonylurea وخطر السقوط مع ≥2 خافضات ضغط.
- **أمان محدد**:
  - **Metformin XR**: "مضاد استطباب إذا eGFR < 30".
  - **ACEI + ARB معًا**: **ممنوع**.
  - **ازدواجية المواد**: تحقّق من التكرار غير المباشر.

[قواعد الفحوص/الإجراءات (تأمينية)]
- أدخل كل عنصر يظهر من مستخلص OCR/الملف كصف في الجدول.
- **Dengue Ab IgG**: إن **لم تُذكر** حُمّى أو **سفر إلى منطقة موبوءة** في بيانات المريض/الأعراض، فالقرار **إلزاميًا**: <span class='status-yellow'>⚠️ الطلب مُعرّض للرفض: يحتاج مبرر سريري (حمّى/تعرض) ويفضّل NS1/NAAT أو IgM للتشخيص الحاد. ويجب مراجعته.</span>
- **Nebulizer/Inhaler (خارجي)**: <span class='status-yellow'>⚠️ الطلب مُعرّض للرفض: يلزم أعراض/تشخيص تنفّسي موثق، ويجب مراجعته.</span>
- **Pantoprazole IV / Normal Saline IV / I.V infusion only / Primperan IV / Paracetamol IV** (حالات خارجية) ⇒ <span class='status-yellow'>⚠️ الطلب مُعرّض للرفض: يتطلب مؤشرات واضحة فقط (جفاف/تعذّر فموي/نزف..)، ويجب مراجعته.</span>
- فحوص السكري/الضغط الروتينية ⇒ <span class='status-green'>✅ مقبول</span>.

[قائمة تحاليل إلزامية عند تواجد الأدوية]
- **Metformin XR**: eGFR/Creatinine + **B12** للاستخدام الطويل.
- **Co-Taburan/Triplixam/ACEI/ARB**: **K+** و **Creatinine** بعد 1–2 أسبوع من البدء/التعديل.
- **Statin**: **ALT/AST** بدايةً وعند الأعراض.

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

// =============== MINI-EXTRACTOR (Gemini JSON with responseMimeType) ===============
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
  "hasDengueAcuteContext": boolean
}
- إذا تعذر الاستخراج ضع null/false.
- لا تضف أي شرح خارج JSON.`;

  const responseSchema = {
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
    },
    additionalProperties: false,
  };

  const payload = {
    contents: [{
      role: "user",
      parts: [{ text: extractionInstruction }, ...fileParts],
    }],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini extractor error ${res.status}: ${raw.slice(0, 500)}`);

  try {
    const obj = JSON.parse(raw);
    const text = obj?.candidates?.[0]?.content?.parts?.map(p => p?.text || "").join("") || raw;
    const parsed = JSON.parse(text);
    if (parsed?.dob) parsed.dob = normalizeDate(parsed.dob) || parsed.dob;
    return parsed;
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
  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.0, topP: 0.9, topK: 40, maxOutputTokens: 8192, ...cfg },
  };
  const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${raw.slice(0, 600)}`);
  try {
    const j = JSON.parse(raw);
    const text = (j?.candidates?.[0]?.content?.parts || []).map((p) => p?.text || "").filter(Boolean).join("\n");
    return hardHtmlEnforce(text);
  } catch { return hardHtmlEnforce(raw); }
}

// =============== TEXT UTILS FOR POLICY OVERRIDES ===============
const DENGUE_TRIGGERS = [
  "حمى","سخونة","ارتفاع الحرارة","fever",
  "سفر إلى","travel to","منطقة موبوءة","endemic area",
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
    body.medications || "",
    ocrText || "",
    stripTags(modelHtml || ""),
  ].join(" ").toLowerCase();
}
function hasAny(text, arr) { const s = text.toLowerCase(); return arr.some(w => s.includes(w.toLowerCase())); }

// ---- Service key normalizer (ignores dose/brand so we detect duplicates) ----
function canonicalServiceKey(s = "") {
  const x = s.toLowerCase()
    .replace(/\d+(\.\d+)?\s*(mg|ml|mcg|g|iu|u|٪|%|mmol|l|amp|vial|tab|caps?)\b/gi, "")
    .replace(/\b(b\.?braun|pfizer|gsk|abbvie|sanofi|novartis|bayer|roche|merck)\b/gi, "")
    .replace(/\bsolution\b|\bfor infusion\b|\bpowder\b|\binjection\b|\bamp\b/gi, "")
    .replace(/[^a-z\u0600-\u06FF]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // synonyms
  if (/(cbc|complete blood.*count|صورة دم)/i.test(x)) return "cbc";
  if (/(creatinine|كرياتينين)/i.test(x)) return "creatinine";
  if (/(urea|يوريا)/i.test(x)) return "urea";
  if (/(uric acid|يورك|حمض اليوريك)/i.test(x)) return "uric acid";
  if (/(sgpt|alt|انزيم.*الكبد)/i.test(x)) return "alt/sgpt";
  if (/(hba1c|glycosylated)/i.test(x)) return "hba1c";
  if (/(ldl)/i.test(x)) return "ldl";
  if (/(cholesterol|كوليسترول(?!.*hdl))/i.test(x)) return "cholesterol";
  if (/(triglyceride|دهون ثلاثية)/i.test(x)) return "triglycerides";
  if (/(c[\- ]?reactive.*protein|crp|سي.*ريأكتف)/i.test(x)) return "crp";

  if (/(dengue.*igg|حمى الضنك.*igg)/i.test(x)) return "dengue igg";
  if (/(ultra.*sound|سونار|ألتراساوند)/i.test(x)) return "ultrasound";
  if (/(nebulizer|inhaler|استنشاق|نيبولايزر)/i.test(x)) return "nebulizer";

  if (/(normal\s*saline|nacl 0 ?\.?9%)/i.test(x)) return "normal saline iv";
  if (/(i\.?\s*v\.?\s*infusion.*only)/i.test(x)) return "iv infusion only";
  if (/(primperan|metoclopramide)/i.test(x)) return "primperan iv";
  if (/(paracetamol|acetaminophen).*infus/i.test(x)) return "paracetamol iv";
  if (/(pantozol|pantoprazole)/i.test(x)) return "pantoprazole iv";

  // meds from free text:
  if (/(metformin|glucophage|xigduo)/i.test(x)) return "metformin";
  if (/(triplixam|perindopril|amlodipine)/i.test(x)) return "acei/ccb mix";
  if (/(losartan|valsartan|irbesartan|candesartan)/i.test(x)) return "arb";
  if (/(atorvastatin|rosuvastatin|simvastatin|statin)/i.test(x)) return "statin";

  return x || "unknown";
}

// ---- HTML helpers ----
function getFirstTableCloseIndex(html="") {
  const m = html.match(/<\/table>/i);
  return m ? m.index + m[0].length : -1;
}
function safeInsertAfterFirstTable(html="", snippet="") {
  const idx = getFirstTableCloseIndex(html);
  if (idx === -1) return html + snippet;
  return html.slice(0, idx) + "\n" + snippet + "\n" + html.slice(idx);
}

// Remove duplicate header rows accidentally generated inside <tbody>
function pruneRepeatedHeaderRows(html="") {
  return html.replace(/<tr[^>]*>[\s\S]{0,400}?الدواء\/الإجراء\s*\(مع درجة الثقة\)[\s\S]{0,400}?<\/tr>/gi, "");
}

// Dedupe rows by canonical key
function dedupeServiceRows(html="") {
  const rowRegex = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowRegex) || [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const plain = stripTags(r);
    if (/الدواء\/الإجراء\s*\(مع درجة الثقة\)/.test(plain)) continue; // header clone
    const key = canonicalServiceKey(plain);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return html.replace(/<tbody>[\s\S]*?<\/tbody>/i, (tbody) => {
    const head = tbody.match(/<tbody>/i)?.[0] || "<tbody>";
    const tail = "</tbody>";
    return head + out.join("\n") + tail;
  });
}

// Build guideline block (constant, with conditionals)
function buildGuidelineBlock({ detectedKeys = new Set(), eGFR = null } = {}) {
  const hasMetformin = detectedKeys.has("metformin");
  const hasACE_ARB = detectedKeys.has("acei/ccb mix") || detectedKeys.has("arb");
  const hasStatin = detectedKeys.has("statin");

  const ada = 'https://diabetesjournals.org/care/issue/47/Supplement_1';
  const ada_ckd = 'https://diabetesjournals.org/care/article/47/Supplement_1/S219/153938/11-Chronic-Kidney-Disease-and-Risk-Management';
  const ada_inf = 'https://professional.diabetes.org/sites/dpro/files/2024-01/Screening-for-Diabetic-Related-Kidney-Disease-infographic_2024.pdf';
  const nice_htn = 'https://www.nice.org.uk/guidance/ng136';
  const nice_iv = 'https://www.nice.org.uk/guidance/cg174';

  const urgent = [];
  if (hasMetformin && eGFR !== null && eGFR < 30) {
    urgent.push(`إيقاف/تجنّب Metformin عند eGFR &lt; 30 (خطر حماض لبني). <a href="${ada_ckd}" target="_blank">[ADA]</a>`);
  }

  const labs = [
    `HbA1c للمتابعة الدورية. <a href="${ada}" target="_blank">[ADA]</a>`,
    `Creatinine/eGFR قبل وأثناء العلاج (خاصةً عند Metformin). <a href="${ada_ckd}" target="_blank">[ADA]</a>`,
    `Albumin-to-Creatinine Ratio (UACR) سنويًا. <a href="${ada_inf}" target="_blank">[ADA]</a>`,
    `Lipid profile لتقييم المخاطر القلبية الوعائية. <a href="${ada}" target="_blank">[ADA]</a>`,
  ];
  if (hasMetformin) labs.push(`فيتامين B12 عند الاستخدام الطويل لـ Metformin. <a href="${ada}" target="_blank">[ADA]</a>`);
  if (hasACE_ARB) labs.push(`Potassium و Creatinine بعد 1–2 أسبوع من بدء/رفع جرعة ACEI/ARB. <a href="${nice_htn}" target="_blank">[NICE NG136]</a>`);

  const routine = [
    `فحص قاع العين لاعتلال الشبكية السكري (سنويًا/حسب الخطورة). <a href="${ada}" target="_blank">[ADA]</a>`,
    `فحص القدمين والإحساس العصبي الطرفي. <a href="${ada}" target="_blank">[ADA]</a>`,
    `قياس ضغط الدم المنزلي والمتابعة على هدف علاجي مناسب. <a href="${nice_htn}" target="_blank">[NICE NG136]</a>`,
    `اتباع مبادئ العلاج الوريدي عند الحاجة فقط. <a href="${nice_iv}" target="_blank">[NICE CG174]</a>`,
  ];
  if (hasStatin) routine.push(`مراقبة ALT/AST عند البدء أو ظهور أعراض كبدية. <a href="${ada}" target="_blank">[ADA]</a>`);

  const li = (x) => x.map(i => `<li>${i}</li>`).join("");

  return `
<h4 class="section-title">خدمات طبية ضرورية ومقبولة تأمينياً (مدعومة بالأدلة العلمية)</h4>
<h5 class="critical">تعديلات دوائية حرجة (Urgent Medication Adjustments)</h5>
<ul>${urgent.length ? li(urgent) : "<li>لا تعديلات حرجة بناءً على المعطيات الحالية.</li>"}</ul>
<h5>تحاليل مخبرية ضرورية (Essential Lab Tests)</h5>
<ul>${li(labs)}</ul>
<h5>متابعة وفحوصات دورية (Routine Monitoring & Tests)</h5>
<ul>${li(routine)}</ul>`;
}

// Extract eGFR number from free text (if any)
function extractEGFR(text="") {
  const m = text.match(/egfr[^0-9]{0,6}(\d{1,3}(?:\.\d+)?)/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isFinite(v) ? v : null;
}

// ---------- Policy Overrides with new phrasing ----------
function forceDengueRule(html = "", ctx = {}) {
  const txt = bagOfText(ctx);
  const hasAcute = ctx?.facts?.hasDengueAcuteContext || hasAny(txt, DENGUE_TRIGGERS);
  if (hasAcute) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const plain = stripTags(row).toLowerCase();
    if (!/(dengue|الضنك|حمى الضنك)/i.test(plain) || !/\bigg\b/i.test(plain)) return row;
    const caution = `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يحتاج مبرر سريري (حمّى/تعرض) ويفضّل NS1/NAAT أو IgM للتشخيص الحاد. ويجب مراجعته.</span>`;
    let cleaned = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    const tds = cleaned.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);
    if (tds && tds.length) cleaned = cleaned.replace(tds[tds.length - 1], tds[tds.length - 1].replace(/(<td\b[^>]*>)[\s\S]*?(<\/td>)/i, `$1${caution}$2`));
    else cleaned = cleaned.replace(/<\/tr>/i, `<td>${caution}</td></tr>`);
    return cleaned;
  });
}
function forceReferralRule(html = "", ctx = {}) {
  const hasReason = !!ctx?.facts?.hasReferralReason || hasAny(bagOfText(ctx), ["إحالة","referral for","refer to","تحويل إلى","سبب الإحالة"]);
  if (hasReason) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    if (!/referral/i.test(stripTags(row))) return row;
    const caution = `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يتطلب ذكر سبب إحالة واضح. ويجب مراجعته.</span>`;
    let cleaned = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    const tds = cleaned.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);
    if (tds && tds.length) cleaned = cleaned.replace(tds[tds.length - 1], tds[tds.length - 1].replace(/(<td\b[^>]*>)[\s\S]*?(<\/td>)/i, `$1${caution}$2`));
    else cleaned = cleaned.replace(/<\/tr>/i, `<td>${caution}</td></tr>`);
    return cleaned;
  });
}
function forceNebulizerRule(html = "", ctx = {}) {
  const hasResp = !!ctx?.facts?.hasRespContext || hasAny(bagOfText(ctx), RESP_TRIGGERS);
  if (hasResp) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const plain = stripTags(row).toLowerCase();
    if (!/(nebulizer|inhaler|نيبولايزر|استنشاق)/i.test(plain)) return row;
    const caution = `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يلزم أعراض/تشخيص تنفّسي موثق. ويجب مراجعته.</span>`;
    let cleaned = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    const tds = cleaned.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);
    if (tds && tds.length) cleaned = cleaned.replace(tds[tds.length - 1], tds[tds.length - 1].replace(/(<td\b[^>]*>)[\s\S]*?(<\/td>)/i, `$1${caution}$2`));
    else cleaned = cleaned.replace(/<\/tr>/i, `<td>${caution}</td></tr>`);
    return cleaned;
  });
}
function forceIVRule(html = "", ctx = {}) {
  const hasIV = !!ctx?.facts?.hasIVIndication || hasAny(bagOfText(ctx), IV_TRIGGERS);
  if (hasIV) return html;
  const IV_KEYS = /(normal\s*saline|i\.?v\.?\s*infusion\s*only|primperan|metoclopramide|paracetamol\s+.*infus|pantoprazole|pantozol)/i;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    if (!IV_KEYS.test(stripTags(row))) return row;
    const caution = `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: الاستعمال الوريدي يتطلب مؤشرات واضحة (جفاف/قيء شديد/تعذّر فموي...). ويجب مراجعته.</span>`;
    let cleaned = row = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    const tds = cleaned.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);
    if (tds && tds.length) cleaned = cleaned.replace(tds[tds.length - 1], tds[tds.length - 1].replace(/(<td\b[^>]*>)[\s\S]*?(<\/td>)/i, `$1${caution}$2`));
    else cleaned = cleaned.replace(/<\/tr>/i, `<td>${caution}</td></tr>`);
    return cleaned;
  });
}
function forceUSRule(html = "", ctx = {}) {
  const hasUS = !!ctx?.facts?.hasUSIndication || hasAny(bagOfText(ctx), US_TRIGGERS);
  if (hasUS) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const plain = stripTags(row).toLowerCase();
    if (!/(ultrasound|ultra\s*sound|سونار|ألتراساوند)/i.test(plain)) return row;
    const caution = `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يتطلب مبرر تصوير واضح (مثلاً ألم بطني موضع). ويجب مراجعته.</span>`;
    let cleaned = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    const tds = cleaned.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);
    if (tds && tds.length) cleaned = cleaned.replace(tds[tds.length - 1], tds[tds.length - 1].replace(/(<td\b[^>]*>)[\s\S]*?(<\/td>)/i, `$1${caution}$2`));
    else cleaned = cleaned.replace(/<\/tr>/i, `<td>${caution}</td></tr>`);
    return cleaned;
  });
}

// Ensure/replace guideline section with a canonical block
function ensureGuidelineSection(html="", ctx={}) {
  // Remove any existing "خدمات طبية ضرورية..." block to avoid duplicates
  const cleaned = html.replace(
    /<h4[^>]*>\s*خدمات طبية ضرورية[\s\S]*?(?=<p><strong>الخاتمة|<\/body|<\/html|$)/i,
    ""
  );

  // Detect keys from current table rows and user text
  const allText = [stripTags(cleaned), bagOfText(ctx)].join(" ");
  const keys = new Set();
  ["cbc","creatinine","urea","uric acid","alt/sgpt","hba1c","ldl","cholesterol","triglycerides","crp",
   "dengue igg","ultrasound","nebulizer","normal saline iv","iv infusion only","primperan iv","paracetamol iv","pantoprazole iv",
   "metformin","acei/ccb mix","arb","statin"
  ].forEach(k => { if (allText.toLowerCase().includes(k)) keys.add(k); });

  const egfr = extractEGFR(allText);
  const snippet = buildGuidelineBlock({ detectedKeys: keys, eGFR: egfr });

  return safeInsertAfterFirstTable(cleaned, snippet);
}

function applyPolicyOverrides(htmlReport, ctx) {
  let out = htmlReport;
  out = forceDengueRule(out, ctx);
  out = forceReferralRule(out, ctx);
  out = forceNebulizerRule(out, ctx);
  out = forceIVRule(out, ctx);
  out = forceUSRule(out, ctx);
  out = pruneRepeatedHeaderRows(out);
  out = dedupeServiceRows(out);
  out = ensureGuidelineSection(out, ctx);
  if (!/الخاتمة/.test(out)) {
    out += `<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>`;
  }
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

    // 1) OCR (اختياري للصور)
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

    // 3) استخراج حقائق منظّمة
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

    // 5) استدعاء Gemini لإنتاج التقرير HTML
    const htmlReportRaw = await geminiGenerate(geminiKey, parts);

    // 6) تطبيق القواعد والتثبيت
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
