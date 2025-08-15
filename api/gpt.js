// pages/api/gpt.js
// Medical Audit Orchestrator — Gemini primary + (optional) GPT OCR
// Next.js Pages Router / Vercel (Node 18+)
//
// ========================= ENV =========================
// GEMINI_API_KEY   = "sk-..."   (required)
// OPENAI_API_KEY   = "sk-..."   (optional → OCR for images)
// =======================================================
//
// Duplicate-denial policy references (why we reject duplicates):
// - CMS: "Repeat or Duplicate Services on the Same Day" → https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleId=53482
// - CMS: NCCI Policy Manual (general rationale for denials/edits) → https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-policy-manual
//
// Clinical references used in guidance sections (unchanged):
// - ADA SoC 2024 (Diabetes): https://diabetesjournals.org/care/issue/47/Supplement_1
// - NICE NG136 (Hypertension): https://www.nice.org.uk/guidance/ng136
// - NICE CG174 (IV Fluids): https://www.nice.org.uk/guidance/cg174
// - CDC (Dengue testing): https://www.cdc.gov/dengue/healthcare-providers/testing/diagnostic.html
// - GINA (Asthma): https://ginasthma.org/gina-reports/
// - ACR Appropriateness Criteria: https://www.acr.org/Clinical-Resources/ACR-Appropriateness-Criteria
// - ACG H. pylori 2022: https://gi.org/guideline/management-of-helicobacter-pylori-infection/
// - AGS Beers Criteria: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7109450/

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
function stripTags(s = "") { return s.replace(/<[^>]*>/g, " "); }
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

// =============== POLICY OVERRIDES & TABLE OPS ===============
const DENGUE_TRIGGERS = [
  "حمى","سخونة","ارتفاع الحرارة","fever",
  "سفر إلى","travel to","سافر","سفر",
  "منطقة موبوءة","endemic area",
  "إندونيسيا","الفلبين","تايلاند","ماليزيا","الهند","بنغلاديش",
  "البرازيل","المكسيك","بيرو","كولومبيا","فيتنام","سريلانكا","سنغافورة"
];
const RESP_TRIGGERS = ["سعال","صفير","ضيق تنفس","asthma","copd","wheeze","shortness of breath","dyspnea"];
const IV_TRIGGERS = ["جفاف","dehydration","قيء شديد","severe vomiting","تعذر فموي","npo","نزف","bleeding","هبوط ضغط","hypotension"];
const US_TRIGGERS = ["ألم بطني","epigastric pain","ruq pain","gallbladder","كبد","حوض","pelvic","umbilical","periumbilical","انتفاخ البطن","abdominal distension"];

const ACEI_WORDS = ["perindopril","enalapril","lisinopril","ramipril","acei"];
const ARB_WORDS  = ["valsartan","losartan","candesartan","irbesartan","arb","co-taburan"];
const SULF_WORDS = ["gliclazide","diamicron","glibenclamide","glyburide","glimepiride"];
const CCB_WORDS  = ["amlodipine","ccb"];
const TRIPLIXAM_WORDS = ["triplixam"];

function bagOfText({ body = {}, ocrText = "", facts = {}, modelHtml = "" } = {}) {
  return [
    body.notes || "",
    Array.isArray(body.problems) ? body.problems.join(" ") : "",
    ocrText || "",
    stripTags(modelHtml || ""),
  ].join(" ").toLowerCase();
}
function hasAny(text, arr) { const s = text.toLowerCase(); return arr.some(w => s.includes(w.toLowerCase())); }
function anyIn(text, words){ return hasAny(text, words); }

// ---- HTML helpers ----
function getRows(html) { return html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []; }
function replaceRows(html, rows) {
  return html.replace(/(<tbody\b[^>]*>)[\s\S]*?(<\/tbody>)/i, `$1${rows.join("\n")}$2`);
}
function firstTdText(row){ const m = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i); return m ? stripTags(m[1]).trim() : ""; }
function replaceLastTd(row, contentHtml){
  const tds = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);
  if (!tds || !tds.length) return row.replace(/<\/tr>/i, `<td>${contentHtml}</td></tr>`);
  const last = tds[tds.length-1];
  const repl = last.replace(/(<td\b[^>]*>)[\s\S]*?(<\/td>)/i, `$1${contentHtml}$2`);
  let idx = 0;
  return row.replace(/<td\b[^>]*>[\s\S]*?<\/td>/gi, (m)=> (idx++===tds.length-1?repl:m));
}

// ---- Canonicalization for duplicate detection ----
const CANON_RULES = [
  { re: /(paracetamol|acetaminophen)/i, key: "paracetamol-iv" },
  { re: /(pantozol|pantoprazole)/i, key: "pantoprazole-iv" },
  { re: /(primperan|metoclopramide)/i, key: "metoclopramide-iv" },
  { re: /normal\s*saline/i, key: "normal-saline" },
  { re: /(cbc|complete.*blood.*count)/i, key: "cbc" },
  { re: /(c[-\s]?reactive.*protein|crp)/i, key: "crp" },
  { re: /(glycosylated.*(hae|hemo)globin|hb.?a1c)/i, key: "hba1c" },
  { re: /\bldl\b.*(cholest|cholestrol)?/i, key: "ldl" },
  { re: /\btriglycerides?\b/i, key: "triglycerides" },
  { re: /\bcholest(?:erol|rol)\b/i, key: "cholesterol" },
  { re: /(liver.*(sgpt|alt)|\bsgpt\b|\balt\b)/i, key: "alt" },
  { re: /uric\s*acid/i, key: "uric-acid" },
  { re: /\bcreatinine\b/i, key: "creatinine" },
  { re: /\burea\b/i, key: "urea" },
  { re: /(ultra\s*sound|ultrasound|سونار|ألتراساوند)/i, key: "ultrasound" },
  { re: /(nebulizer|inhaler|نيبول|استنشاق)/i, key: "nebulizer-inhaler" },
  { re: /dengue.*igg/i, key: "dengue-igg" },
  { re: /(referral|إحالة)/i, key: "referral" },
];

function canonicalServiceKey(sRaw = "") {
  let s = (sRaw || "").toLowerCase();
  // strip dosage/units/packaging/brands
  s = s
    .replace(/\b\d+([.,]\d+)?\s*(mg|ml|mcg|g|iu|%|mmol\/l)\b/gi, " ")
    .replace(/\b\d+([.,]\d+)?\s*(mg|ml)\/\s*\d+([.,]\d+)?\s*(mg|ml)\b/gi, " ")
    .replace(/\b(b\.?braun|bbraun|amp(?:oule)?|vial|solution|powder|for|injection|infus(?:ion)?|i\.?v\.?)\b/gi, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const { re, key } of CANON_RULES) {
    if (re.test(sRaw) || re.test(s)) return key;
  }
  return s; // fallback
}

// ---- Enforcement rules ----
function forceDengueRule(html = "", ctx = {}) {
  const txt = bagOfText(ctx);
  const hasAcute = ctx?.facts?.hasDengueAcuteContext || hasAny(txt, DENGUE_TRIGGERS);
  if (hasAcute) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const plain = stripTags(row).toLowerCase();
    if (!/(dengue|الضنك|حمى الضنك)/i.test(plain) || !/\bigg\b/i.test(plain)) return row;
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: يوصى باختبار NS1/NAAT أو IgM للتشخيص الحاد، وIgG يدل على عدوى سابقة <a href="https://www.cdc.gov/dengue/healthcare-providers/testing/diagnostic.html" target="_blank">[CDC]</a>.</span>`;
    let cleaned = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    return replaceLastTd(cleaned, caution);
  });
}
function forceReferralRule(html = "", ctx = {}) {
  const hasReason = !!ctx?.facts?.hasReferralReason || hasAny(bagOfText(ctx), ["إحالة","referral for","refer to","تحويل إلى","سبب الإحالة"]);
  if (hasReason) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    if (!/referral/i.test(stripTags(row))) return row;
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: يتطلب ذكر سبب إحالة واضح في النموذج.</span>`;
    let cleaned = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    return replaceLastTd(cleaned, caution);
  });
}
function forceNebulizerRule(html = "", ctx = {}) {
  const hasResp = !!ctx?.facts?.hasRespContext || hasAny(bagOfText(ctx), RESP_TRIGGERS);
  if (hasResp) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const plain = stripTags(row).toLowerCase();
    if (!/(nebulizer|inhaler|نيبولايزر|استنشاق)/i.test(plain)) return row;
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: لزوم أعراض/تشخيص تنفسي موثق <a href="https://ginasthma.org/gina-reports/" target="_blank">[GINA]</a>.</span>`;
    let cleaned = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    return replaceLastTd(cleaned, caution);
  });
}
function forceIVRule(html = "", ctx = {}) {
  const hasIV = !!ctx?.facts?.hasIVIndication || hasAny(bagOfText(ctx), IV_TRIGGERS);
  if (hasIV) return html;
  const IV_KEYS = /(normal\s*saline|i\.?v\.?\s*infusion\s*only|primperan|metoclopramide|paracetamol\s+.*infus|pantoprazole|pantozol)/i;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    if (!IV_KEYS.test(stripTags(row))) return row;
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: استعمال وريدي يحتاج مؤشرات واضحة (جفاف/تعذر فموي/نزف...) <a href="https://www.nice.org.uk/guidance/cg174" target="_blank">[NICE CG174]</a>.</span>`;
    let cleaned = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    return replaceLastTd(cleaned, caution);
  });
}
function forceUSRule(html = "", ctx = {}) {
  const hasUS = !!ctx?.facts?.hasUSIndication || hasAny(bagOfText(ctx), US_TRIGGERS);
  if (hasUS) return html;
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const plain = stripTags(row).toLowerCase();
    if (!/(ultrasound|ultra\s*sound|سونار|ألتراساوند)/i.test(plain)) return row;
    const caution = `<span class="status-yellow">⚠️ قابل للمراجعة: يتطلب مبرر تصوير واضح (مثلاً ألم موضَّع ربع علوي أيمن) <a href="https://www.acr.org/Clinical-Resources/ACR-Appropriateness-Criteria" target="_blank">[ACR]</a>.</span>`;
    let cleaned = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    return replaceLastTd(cleaned, caution);
  });
}

// ---- NEW: Duplicate detection → RED denial for every additional duplicate
const DUPLICATE_REF_LINK = `<a href="https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleId=53482" target="_blank">[CMS Duplicate]</a>`;
function rejectDuplicateServices(html = "") {
  const rows = getRows(html);
  if (!rows.length) return html;

  // Build normalized keys per row (by first <td>)
  const keys = rows.map((r) => canonicalServiceKey(firstTdText(r)));

  // Track first index of each key; all subsequent indices are duplicates
  const firstIndexMap = new Map();
  const duplicateIndices = [];
  keys.forEach((k, i) => {
    if (!k) return;
    if (!firstIndexMap.has(k)) firstIndexMap.set(k, i);
    else duplicateIndices.push(i);
  });

  if (!duplicateIndices.length) return html;

  const updated = rows.map((r, idx) => {
    if (!duplicateIndices.includes(idx)) return r;
    // Overwrite last cell with RED denial + reason
    const red = `<span class="status-red">❌ مرفوض: مكرر في الطلب ${DUPLICATE_REF_LINK}</span>`;
    // Remove any previous status chips before replacing
    let cleaned = r.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "");
    cleaned = cleaned.replace(/✅|⚠️|❌/g, ""); // strip emojis if present in last cell
    return replaceLastTd(cleaned, red);
  });

  return replaceRows(html, updated);
}

// ---- Guidance lists (unchanged with small safety) ----
function synthesizeActionLists(body = {}, facts = {}, bag = "") {
  const out = { urgent: [], labs: [], routine: [] };

  const dob = body.dob ?? facts.dob ?? null;
  const age = body.age ?? (dob ? computeAgeFromDob(dob) : undefined);
  const isOlder = typeof age === "number" ? age >= 65 : false;

  const txt = bag.toLowerCase();
  const hasDM = hasAny(txt, ["diabetes","hyperglycemia","e11","type 2","t2dm","hbA1c","سكر","السكري"]);
  const hasHTN = hasAny(txt, ["hypertension","i10","elevated blood pressure","high blood pressure","ضغط الدم","bp "]);
  const hasNeuro = hasAny(txt, ["neuropathy","اعتلال الأعصاب","polyneuropathy"]);
  const hasEpigastric = hasAny(txt, ["epigastric","periumbilical","dyspepsia","gastritis","ألم شرسوفي","حول السرة","انتفاخ البطن","عسر الهضم"]);
  const smoker = body.isSmoker === true;
  const cough = hasAny(txt, ["cough","سعال","hemoptysis","نفث دم"]);
  const hasACEI = anyIn(txt, ACEI_WORDS);
  const hasARB  = anyIn(txt, ARB_WORDS);
  const hasSU   = anyIn(txt, SULF_WORDS);
  const hasTriplixam = anyIn(txt, TRIPLIXAM_WORDS);
  const hasAmlodipine = anyIn(txt, CCB_WORDS) || txt.includes("amlodipine");

  if (smoker && cough) {
    out.urgent.push(`أشعة سينية للصدر (Chest X-ray) لتقييم السعال/النفث الدموي <a href="https://www.acr.org/Clinical-Resources/ACR-Appropriateness-Criteria" target="_blank">[ACR]</a>.`);
  }
  if (isOlder && hasSU) {
    out.urgent.push(`تقليل/إيقاف السلفونيل يوريا لدى كبار السن لتقليل نقص السكر؛ فكر ببدائل أقل خطورة <a href="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7109450/" target="_blank">[AGS Beers]</a>.`);
  }
  if (hasACEI && hasARB) {
    out.urgent.push(`منع الجمع بين ACEI وARB (خطر فرط بوتاسيوم/قصور كلوي) <a href="https://www.nice.org.uk/guidance/ng136" target="_blank">[NICE NG136]</a>.`);
  }
  if (hasTriplixam && hasAmlodipine) {
    out.urgent.push(`إلغاء Amlodipine المفرد عند استخدام Triplixam (تجنّب ازدواجية CCB).`);
  }

  if (hasDM) {
    out.labs.push(`HbA1c للمتابعة الدورية <a href="https://diabetesjournals.org/care/issue/47/Supplement_1" target="_blank">[ADA]</a>.`);
    out.labs.push(`Creatinine/eGFR قبل وأثناء العلاج بالمتفورمين، وB12 طويل الأمد <a href="https://diabetesjournals.org/care/issue/47/Supplement_1" target="_blank">[ADA]</a>.`);
    out.labs.push(`Albumin-to-Creatinine Ratio (UACR) سنويًا لاعتلال الكلى السكري <a href="https://diabetesjournals.org/care/issue/47/Supplement_1" target="_blank">[ADA]</a>.`);
    out.labs.push(`Lipid profile لتقييم المخاطر القلبية الوعائية <a href="https://diabetesjournals.org/care/issue/47/Supplement_1" target="_blank">[ADA]</a>.`);
  }
  if (hasHTN) {
    out.labs.push(`Potassium وCreatinine قبل وبعد بدء/رفع جرعة ACEI/ARB خلال 1–2 أسبوع <a href="https://www.nice.org.uk/guidance/ng136" target="_blank">[NICE NG136]</a>.`);
    out.labs.push(`Urinalysis + Creatinine/eGFR ضمن تقييم ضغط الدم <a href="https://www.nice.org.uk/guidance/ng136" target="_blank">[NICE NG136]</a>.`);
  }
  if (/dengue/i.test(txt) && !hasAny(txt, DENGUE_TRIGGERS)) {
    out.labs.push(`تجنّب طلب IgG وحده دون حُمّى/تعرض؛ استخدم NS1/NAAT أو IgM في الأيام الأولى <a href="https://www.cdc.gov/dengue/healthcare-providers/testing/diagnostic.html" target="_blank">[CDC]</a>.`);
  }
  if (hasEpigastric) {
    out.labs.push(`اختبار غير غازي لـ H. pylori (Urea breath أو Stool Ag) قبل الاستمرار في العلاج <a href="https://gi.org/guideline/management-of-helicobacter-pylori-infection/" target="_blank">[ACG]</a>.`);
  }

  if (hasDM) {
    out.routine.push(`فحص قاع العين لاعتلال الشبكية السكري (سنويًا/حسب الخطورة) <a href="https://diabetesjournals.org/care/issue/47/Supplement_1" target="_blank">[ADA]</a>.`);
    out.routine.push(`فحص القدمين واختبار الإحساس للاعتلال العصبي الطرفي <a href="https://diabetesjournals.org/care/issue/47/Supplement_1" target="_blank">[ADA]</a>.`);
  }
  if (hasHTN) {
    out.routine.push(`قياس ضغط الدم المنزلي والمتابعة على هدف علاجي مناسب سريريًا <a href="https://www.nice.org.uk/guidance/ng136" target="_blank">[NICE NG136]</a>.`);
  }
  if (hasEpigastric) {
    out.routine.push(`تجربة PPI قصيرة المدى مع مراجعة محرضات عسر الهضم وتجنب NSAIDs <a href="https://gi.org/guideline/management-of-helicobacter-pylori-infection/" target="_blank">[ACG]</a>.`);
  }
  if (out.labs.length < 3) {
    out.labs.push(`CBC, CRP حسب السياق السريري لتقييم التهاب/عدوى.`);
  }
  return out;
}

function injectActionListsIntoHtml(html = "", lists = { urgent:[], labs:[], routine:[] }) {
  function injectAfterHeading(headingRegex, items) {
    const m = html.match(headingRegex);
    if (!m) return html;
    const startIdx = m.index + m[0].length;
    const tail = html.slice(startIdx);
    const ulMatch = tail.match(/<ul\b[^>]*>[\s\S]*?<\/ul>/i);
    const newUl = `<ul>${[...new Set(items)].map(x => `<li>${x}</li>`).join("")}</ul>`;
    if (ulMatch) {
      const existingLis = (ulMatch[0].match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || []).map(li => stripTags(li).trim());
      const merged = [...existingLis, ...items].filter(Boolean);
      const unique = [...new Set(merged.map(t => t.trim()))];
      const mergedUl = `<ul>${unique.map(t => `<li>${t}</li>`).join("")}</ul>`;
      const replacedTail = tail.replace(ulMatch[0], mergedUl);
      html = html.slice(0, startIdx) + replacedTail;
    } else {
      html = html.slice(0, startIdx) + newUl + html.slice(startIdx);
    }
    return html;
  }

  html = injectAfterHeading(/<h5[^>]*class="[^"]*\bcritical\b[^"]*"[^>]*>[\s\S]*?Urgent[^<]*<\/h5>/i, lists.urgent);
  html = injectAfterHeading(/<h5[^>]*>\s*تحاليل مخبرية ضرورية[\s\S]*?<\/h5>/i, lists.labs);
  html = injectAfterHeading(/<h5[^>]*>\s*متابعة وفحوصات دورية[\s\S]*?<\/h5>/i, lists.routine);
  return html;
}

function applyPolicyOverrides(htmlReport, ctx) {
  let out = htmlReport;
  out = forceDengueRule(out, ctx);
  out = forceReferralRule(out, ctx);
  out = forceNebulizerRule(out, ctx);
  out = forceIVRule(out, ctx);
  out = forceUSRule(out, ctx);
  // NEW: Reject duplicates in RED
  out = rejectDuplicateServices(out);
  // synthesize and inject action guidance
  const bag = bagOfText(ctx);
  const lists = synthesizeActionLists(ctx.body, ctx.facts, bag);
  out = injectActionListsIntoHtml(out, lists);
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

    // 4) بناء الطلب النهائي والتحليل
    const parts = [{ text: systemInstruction }, { text: buildUserPrompt(body, facts) }];
    if (processedFileParts.length) parts.push(...processedFileParts);
    if (ocrText) parts.push({ text: `### OCR Extracted Texts\n${ocrText}` });

    // 5) استدعاء Gemini لإنتاج التقرير HTML
    const htmlReportRaw = await geminiGenerate(geminiKey, parts);

    // 6) تطبيق القواعد القسرية + رفض التكرارات + ملء القوائم
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
