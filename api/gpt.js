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
- **مصدر الحقيقة**: "بيانات المريض" المرسلة يدويًا هي المرجع النهائي. إذا خالفتها الملفات، اذكر التعارض في "تحليل الملفات" لكن اتّبع "بيانات المريض" في الاستنتاج النهائي.
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
- **Dengue Ab IgG**: إن **لم تُذكر** حُمّى أو **سفر إلى منطقة موبوءة** في بيانات المريض/الأعراض، فالقرار **إلزاميًا**: <span class='status-yellow'>⚠️ قابل للمراجعة: يحتاج NS1/NAAT أو IgM للتشخيص الحاد.</span>
- **Nebulizer/Inhaler (خارجي)**: <span class='status-yellow'>⚠️ قابل للمراجعة: لزوم أعراض تنفسية موثقة.</span>
- **Pantoprazole IV / Normal Saline IV / I.V infusion only / Primperan IV / Paracetamol IV** (حالات خارجية) ⇒ <span class='status-yellow'>⚠️ قابل للمراجعة: مؤشرات واضحة فقط.</span>
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
  "hasDengueAcuteContext": boolean,
  "egfr": number|null,               // mL/min/1.73m2
  "creatinine_mg_dl": number|null,
  "alt_u_l": number|null,
  "ast_u_l": number|null,
  "potassium_mmol_l": number|null,
  "hba1c_percent": number|null,
  "renalSevere": boolean|null,       // Dialysis/CKD4-5/eGFR<30
  "hepaticSevere": boolean|null      // Severe hepatic impairment or active liver disease
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
      egfr: { type: "number" },
      creatinine_mg_dl: { type: "number" },
      alt_u_l: { type: "number" },
      ast_u_l: { type: "number" },
      potassium_mmol_l: { type: "number" },
      hba1c_percent: { type: "number" },
      renalSevere: { type: "boolean" },
      hepaticSevere: { type: "boolean" }
    },
    additionalProperties: false,
  };

  const payload = {
    contents: [{
      role: "user",
      parts: [{ text: extractionInstruction }, ...fileParts],
    }],
    generationConfig: {
      temperature: 0.1,
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

**مؤشرات مختبرية ملتقطة:**
eGFR: ${facts.egfr ?? "—"} | Creatinine: ${facts.creatinine_mg_dl ?? "—"} mg/dL | ALT: ${facts.alt_u_l ?? "—"} U/L | AST: ${facts.ast_u_l ?? "—"} U/L | K⁺: ${facts.potassium_mmol_l ?? "—"} mmol/L | HbA1c: ${facts.hba1c_percent ?? "—"} %

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
    return hardHtmlEnforce(text);
  } catch { return hardHtmlEnforce(raw); }
}

// =============== TEXT BAG + TRIGGERS ===============
const DENGUE_TRIGGERS = [
  "حمى","سخونة","ارتفاع الحرارة","fever",
  "سفر","travel","منطقة موبوءة","endemic","إندونيسيا","الفلبين","تايلاند","ماليزيا","الهند","بنغلاديش","البرازيل","المكسيك","بيرو","كولومبيا","فيتنام","سريلانكا","سنغافورة"
];
const RESP_TRIGGERS = ["سعال","صفير","ضيق تنفس","asthma","copd","wheeze","shortness of breath","dyspnea"];
const IV_TRIGGERS = ["جفاف","dehydration","قيء شديد","severe vomiting","تعذر فموي","npo","نزف","bleeding","هبوط ضغط","hypotension"];
const US_TRIGGERS = ["ألم بطني","epigastric","ruq pain","gallbladder","كبد","حوض","pelvic","umbilical","periumbilical"];

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
const toNum = (s) => s ? parseFloat(String(s).replace(",", ".").match(/-?\d+(\.\d+)?/)?.[0] ?? NaN) : NaN;

// =============== LAB PARSER (fallback إذا ما استخرجها Gemini) ===============
function parseLabsFromText(raw) {
  const t = (raw || "").toLowerCase();
  const pick = (re) => {
    const m = t.match(re);
    return m ? toNum(m[1]) : null;
  };
  const egfr = pick(/egfr[^0-9]{0,10}(\d+(?:[.,]\d+)?)/i);
  const crea = pick(/(?:creatinine|creat\s*:?|cr\s*:?)\s*([0-9]+(?:[.,]\d+)?)/i);
  const alt  = pick(/(?:alt|sgpt)\s*[:=]?\s*([0-9]+(?:[.,]\d+)?)/i);
  const ast  = pick(/(?:ast|sgot)\s*[:=]?\s*([0-9]+(?:[.,]\d+)?)/i);
  const k    = pick(/(?:potassium|k\+?)\s*[:=]?\s*([0-9]+(?:[.,]\d+)?)/i);
  const a1c  = pick(/(?:hba1c|gly[co]s?ylated\s*ha?emoglobin)\s*[:=]?\s*([0-9]+(?:[.,]\d+)?)/i);
  return { egfr, creatinine_mg_dl: crea, alt_u_l: alt, ast_u_l: ast, potassium_mmol_l: k, hba1c_percent: a1c };
}

// =============== CANONICAL SERVICE KEY (لتجميع المكرر) ===============
// يطبع الاسم إلى مفتاح قياسي: يحذف الجرعات/الأحجام/العلامات التجارية والنِسب — الهدف كشف الازدواج وليس تصحيح الجرعة.
function canonicalKey(raw = "") {
  let s = (raw || "").toLowerCase();
  s = s.replace(/\b(b\.?braun|bbraun|pfizer|gsk|abbvie|teva|mylan|sandoz|hospira)\b/g, ""); // brands
  s = s.replace(/\b(\d+(\.\d+)?\s*(mg|ml|mcg|g|units|iu)\/?\s*(ml|amp|vial)?)\b/g, "");    // doses/units
  s = s.replace(/\b(\d+\s*(mg|ml)|\d+%|\d+(?:\/\d+)?\s*(mmol|u\/l))\b/g, "");              // numbers
  s = s.replace(/[\s\-_,.]+/g, " ").trim();

  // synonyms
  const map = [
    [/automated complete blood cell count|complete blood cell count|cbc/gi, "cbc"],
    [/complete urine analysis|urinalysis|urine analysis|urine test/gi, "urinalysis"],
    [/c[\- ]?reactive prot?i?ne?|crp/gi, "crp"],
    [/liver enzyme.*sgpt|alt/gi, "alt"],
    [/ldl.*chol/i, "ldl"],
    [/chol(e)?st(e)?rol/i, "cholesterol"],
    [/triglycerides|trigs?|tg/gi, "triglycerides"],
    [/nebulizer.*inhaler|nebulizer|inhaler|نيبولايزر|استنشاق/gi, "nebulizer-inhaler"],
    [/pantozol|pantoprazole|protonix/gi, "pantoprazole-iv"],
    [/paracetamol.*infus|acetaminophen.*iv|ofirmev/gi, "paracetamol-iv"],
    [/primperan|metoclopramide/gi, "metoclopramide-iv"],
    [/normal saline.*i\.?v\.?/gi, "normal-saline-iv"],
    [/i\.?v\.?\s*infusion\s*only/gi, "iv-infusion-only"],
    [/ultra\s*sound|ultrasound|سونار|التراسوند/gi, "ultrasound"],
    [/dengue.*igg/gi, "dengue-igg"],
    [/glycosylated he?amoglobin|hba1c/gi, "hba1c"],
  ];
  for (const [re, val] of map) s = s.replace(re, val);
  return s || raw.toLowerCase();
}

// =============== POST HTML MANIPULATION HELPERS ===============
function replaceLastTd(rowHtml, newContent) {
  const tds = rowHtml.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);
  if (tds && tds.length) {
    return rowHtml.replace(tds[tds.length - 1], tds[tds.length - 1].replace(/(<td\b[^>]*>)[\s\S]*?(<\/td>)/i, `$1${newContent}$2`));
  }
  return rowHtml.replace(/<\/tr>/i, `<td>${newContent}</td></tr>`);
}
function stripBadges(s) { return s.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, ""); }

// =============== POLICY OVERRIDES (Row-level) ===============
function forceDengueRule(html = "", ctx = {}) {
  const txt = bagOfText(ctx);
  const hasAcute = ctx?.facts?.hasDengueAcuteContext || hasAny(txt, DENGUE_TRIGGERS);
  if (hasAcute) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const plain = stripTags(row).toLowerCase();
    if (!/(dengue|الضنك)/i.test(plain)) return row;
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: يحتاج مبرر سريري (حمّى/تعرض) ويفضّل NS1/NAAT أو IgM للتشخيص الحاد.</span>`;
    return replaceLastTd(stripBadges(row), caution);
  });
}
function forceReferralRule(html = "", ctx = {}) {
  const hasReason = !!ctx?.facts?.hasReferralReason || hasAny(bagOfText(ctx), ["إحالة","referral for","تحويل إلى","سبب الإحالة"]);
  if (hasReason) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    if (!/referral/i.test(stripTags(row))) return row;
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: يتطلب ذكر سبب إحالة واضح في النموذج.</span>`;
    return replaceLastTd(stripBadges(row), caution);
  });
}
function forceNebulizerRule(html = "", ctx = {}) {
  const hasResp = !!ctx?.facts?.hasRespContext || hasAny(bagOfText(ctx), RESP_TRIGGERS);
  if (hasResp) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const plain = stripTags(row).toLowerCase();
    if (!/(nebulizer|inhaler|نيبولايزر|استنشاق)/i.test(plain)) return row;
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: لزوم أعراض/تشخيص تنفسي موثق.</span>`;
    return replaceLastTd(stripBadges(row), caution);
  });
}
function forceIVRule(html = "", ctx = {}) {
  const hasIV = !!ctx?.facts?.hasIVIndication || hasAny(bagOfText(ctx), IV_TRIGGERS);
  if (hasIV) return html;
  const IV_KEYS = /(normal\s*saline|i\.?v\.?\s*infusion\s*only|primperan|metoclopramide|paracetamol\s+.*infus|acetaminophen\s+.*iv|pantoprazole|pantozol)/i;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    if (!IV_KEYS.test(stripTags(row))) return row;
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: الاستعمال الوريدي يحتاج مؤشرات واضحة (جفاف/قيء شديد/تعذّر فموي...).</span>`;
    return replaceLastTd(stripBadges(row), caution);
  });
}
function forceUSRule(html = "", ctx = {}) {
  const hasUS = !!ctx?.facts?.hasUSIndication || hasAny(bagOfText(ctx), US_TRIGGERS);
  if (hasUS) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const plain = stripTags(row).toLowerCase();
    if (!/(ultrasound|ultra\s*sound|سونار|ألتراساوند)/i.test(plain)) return row;
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: يتطلب مبرر تصوير واضح (مثلاً ألم بطني موضع).</span>`;
    return replaceLastTd(stripBadges(row), caution);
  });
}

// =============== DUPLICATES (رفض أحمر) ===============
function markDuplicatesAsDenied(html = "") {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
  if (!rows) return html;

  const seen = new Map();
  const outRows = [];
  for (const row of rows) {
    const plain = stripTags(row);
    // نحاول أخذ اسم الخدمة من أول خلية
    const firstCell = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/i)?.[0] || plain;
    const key = canonicalKey(firstCell);
    if (!key) { outRows.push(row); continue; }

    if (seen.has(key)) {
      const denied = `<span class="status-red">❌ مرفوض: تكرار نفس الخدمة ضمن نفس المطالبة.</span>`;
      outRows.push(replaceLastTd(stripBadges(row), denied));
    } else {
      seen.set(key, true);
      outRows.push(row);
    }
  }

  // أعِد تركيب الجدول
  let i = 0;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, () => outRows[i++]);
}

// =============== DOSE INTERVAL GUARD (نَفَس خفيف) ===============
// رصد احتمالية تكدّس جرعات أسيتامينوفين IV في نفس المطالبة (تنبيه فقط)
function applyDoseIntervalHints(html = "") {
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const key = canonicalKey(stripTags(row));
    if (key.includes("paracetamol-iv")) {
      const note = `<span class="status-yellow">⚠️ تذكير: حد أقصى 1000mg/جرعة، فاصل ≥4 ساعات، و≤4000mg/24h (يشمل جميع المستحضرات المحتوية على أسيتامينوفين).</span>`;
      return replaceLastTd(stripBadges(row), note); // مبني على OFIRMEV label (FDA)
    }
    if (key.includes("pantoprazole-iv")) {
      const note = `<span class="status-yellow">⚠️ تذكير: الجرعة الشائعة 40mg IV مرة يومياً لمدة 7–10 أيام إذا كانت هناك ضرورة حقيقية للحقن.</span>`;
      return replaceLastTd(stripBadges(row), note);
    }
    if (key.includes("metoclopramide-iv")) {
      const note = `<span class="status-yellow">⚠️ جرعات نموذجية 10mg حتى 4 مرات/يوم للبالغين؛ لدى كبار السن يُفضَّل 5mg لتقليل الأعراض خارج الهرمية.</span>`;
      return replaceLastTd(stripBadges(row), note);
    }
    return row;
  });
}

// =============== LAB-AWARE GUARDS (كلوي/كبدي) ===============
function applyRenalHepaticGuards(html = "", ctx = {}) {
  const { facts = {} } = ctx;
  const bag = bagOfText(ctx);

  const egfr = facts.egfr ?? parseLabsFromText(bag).egfr;
  const alt = facts.alt_u_l ?? parseLabsFromText(bag).alt_u_l;
  const ast = facts.ast_u_l ?? parseLabsFromText(bag).ast_u_l;
  const hepaticSevereFlag = facts.hepaticSevere || (alt > 120 || ast > 120); // تقريب: >3x ULN

  // صفوف الجدول (لتعديل الخلية الأخيرة إن لزم)
  let out = html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const key = canonicalKey(stripTags(row));

    // حارس كبدي لأسيتامينوفين IV
    if (key.includes("paracetamol-iv") && hepaticSevereFlag) {
      const msg = `<span class="status-yellow">⚠️ حذر كبدي: ارتفاع ALT/AST أو مرض كبدي فعّال → راقب الجرعة الإجمالية وخفّض/تجنّب حسب الحالة (خطر سمّية كبدية).</span>`;
      return replaceLastTd(stripBadges(row), msg);
    }

    return row;
  });

  // تعديلات دوائية حرجة (قائمة أعلى التقرير)
  const urgent = [];

  // متفورمين: مضاد استطباب EGFR<30 — نضيف بند توجيهي حتى لو لم يظهر كصف
  const hasMetformin = /\bmetformin|glucophage|form\s*xr\b/i.test(bag);
  if (hasMetformin && egfr !== null && !Number.isNaN(egfr)) {
    if (egfr < 30) urgent.push("إيقاف <strong>Metformin</strong> فورًا: eGFR &lt; 30 mL/min/1.73m² (مضاد استطباب).");
    else if (egfr >= 30 && egfr < 45) urgent.push("خفض جرعة <strong>Metformin</strong> وتقييم الاستمرار: eGFR 30–45 (لا يُبدأ عادة، ويُراجع الاستمرار).");
  }

  // فرط بوتاسيوم مع ACEI/ARB (لو ذُكر دواء وK+ مرتفع)
  const hasRAAS = /(perindopril|lisinopril|enalapril|ramipril|valsartan|losartan|irbesartan|olmesartan|candesartan|sacubitril)/i.test(bag);
  const kVal = facts.potassium_mmol_l ?? parseLabsFromText(bag).potassium_mmol_l;
  if (hasRAAS && kVal && kVal >= 5.5) {
    urgent.push(`فرط بوتاسيوم (K⁺=${kVal} mmol/L) مع ACEI/ARB → راجع الأدوية وكرّر K⁺/Creatinine خلال 1–2 أسبوع.`);
  }

  // حقن وريدية خارجية بدون مؤشرات → تنبيه عام (لو لم يلتقطه الحارس الآخر)
  const ivMentioned = /(pantoprazole|metoclopramide|paracetamol).*iv|normal\s*saline/i.test(bag);
  const hasIVContext = ctx?.facts?.hasIVIndication || hasAny(bag, IV_TRIGGERS);
  if (ivMentioned && !hasIVContext) urgent.push("استخدام وريدي خارج الإقامة يحتاج مبررات واضحة (جفاف/تعذّر فموي…)، خلاف ذلك عرضة للرفض.");

  if (urgent.length) {
    // أدخل العناصر داخل أول <h5 class="critical">…</h5><ul>…</ul>
    out = out.replace(
      /(<h5 class="critical">[\s\S]*?<\/h5>\s*<ul>)([\s\S]*?)(<\/ul>)/i,
      (_, a, _mid, c) => `${a}${urgent.map(x => `<li>${x}</li>`).join("")}${c}`
    );
  }
  return out;
}

// =============== Dengue/Referral/Neb/IV/US + Duplicates + Dose hints + Guards ===============
function applyPolicyOverrides(htmlReport, ctx) {
  let out = htmlReport;
  out = forceDengueRule(out, ctx);
  out = forceReferralRule(out, ctx);
  out = forceNebulizerRule(out, ctx);
  out = forceIVRule(out, ctx);
  out = forceUSRule(out, ctx);
  out = markDuplicatesAsDenied(out);      // ❌ مرفوض عند التكرار
  out = applyDoseIntervalHints(out);      // تنبيهات فواصل الجرعات
  out = applyRenalHepaticGuards(out, ctx);// قواعد الكُلى/الكبد
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

    // 2) تجهيز ملفات Gemini (inline أو upload عبر Files API)
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

    // 3) استخراج حقائق منظّمة من الملف
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

    // 4) بناء الطلب النهائي للتحليل
    const parts = [{ text: systemInstruction }, { text: buildUserPrompt(body, facts) }];
    if (processedFileParts.length) parts.push(...processedFileParts);
    if (ocrText) parts.push({ text: `### OCR Extracted Texts\n${ocrText}` });

    // 5) استدعاء Gemini لإنتاج التقرير HTML
    const htmlReportRaw = await geminiGenerate(geminiKey, parts);

    // 6) تطبيق القواعد القسرية بعد-المخرجات (بما فيها: Dengue/IV/Neb/US + التكرار + جرعات + كلوي/كبدي)
    const textBag = bagOfText({ body, ocrText, facts, modelHtml: htmlReportRaw });
    // إذا ما طلّع المختبر، نحاول نسحب يدويًا
    const labsFallback = parseLabsFromText(textBag);
    facts = { ...labsFallback, ...facts };

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
        // مراجع مختصرة داخل الاستجابة (للتتبع)
        refs: {
          ofirmev: "FDA label (max 1g q6h or 650mg q4h; max 4g/24h)",
          protonix: "FDA label (pantoprazole IV 40mg daily 7–10 days)",
          metoclopramide: "Dosing ranges (StatPearls)",
          metforminEgfr: "FDA/ADA: contraindicated if eGFR<30; caution 30–45",
          dengue: "CDC acute testing: NAAT/NS1 + IgM",
          ivFluids: "NICE CG174 principles"
        }
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
