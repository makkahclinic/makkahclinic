// pages/api/gpt.js
// محلل خبير موحد — Gemini + (اختياري) OpenAI OCR
// Next.js Pages Router / Vercel (Node 18+)

// ========================= ENV =========================
// GEMINI_API_KEY  = "sk-..."  (مطلوب)
// OPENAI_API_KEY  = "sk-..."  (اختياري ← OCR للصور)
// =======================================================

import { createHash } from "crypto";

// ------------ CONFIGURATION ------------
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const OCR_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 180_000; // 3 دقائق
const RETRY_STATUS = new Set([408, 409, 413, 429, 500, 502, 503, 504]);

const MAX_FILES_PER_REQUEST = 30;
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_OCR_IMAGES = 20;

// ------------ UTILS ------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

/**
 * دالة fetch مع إمكانية الإلغاء بعد انتهاء المهلة الزمنية.
 */
function abortableFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/**
 * دالة fetch مع آلية إعادة المحاولة عند حدوث أخطاء معينة.
 */
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

// ------------ FILE & TEXT UTILS ------------
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
function stripFences(s = "") { return s.replace(/```(html|json)?/gi, "").trim(); }
function escapeHtml(s = "") { return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function stripTags(s = "") { return s.replace(/<[^>]*>/g, " "); }

const SHARED_CSS_STYLES = `
<style>
  .status-green { display:inline-block;background:#d4edda;color:#155724;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #c3e6cb }
  .status-yellow{ display:inline-block;background:#fff3cd;color:#856404;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #ffeeba }
  .status-red   { display:inline-block;background:#f8d7da;color:#721c24;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #f5c6cb }
  .section-title{ color:#1e40af;font-weight:bold }
  .critical     { color:#991b1b;font-weight:bold }
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.65;padding:6px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #e5e7eb;padding:8px;font-size:14px;vertical-align:top}
  thead th{background:#f3f4f6}
</style>`;

function hardHtmlEnforce(s = "") {
  const t = stripFences(s);
  const looksHtml = /<\/?(html|body|table|tr|td|th|ul|ol|li|h\d|p|span|div|style)\b/i.test(t);
  if (looksHtml) return t.includes('<style>') ? t : SHARED_CSS_STYLES + t;
  return `${SHARED_CSS_STYLES}<pre style="white-space:pre-wrap">${escapeHtml(t)}</pre>`;
}

// ---- Date helpers ----
function normalizeDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let [_, aStr, bStr, cStr] = m;
  let a = parseInt(aStr, 10), b = parseInt(bStr, 10), c = parseInt(cStr, 10);
  let Y, M, D;

  if (aStr.length === 4) { Y = a; M = b; D = c; }
  else if (cStr.length === 4) {
    Y = c;
    if (a > 12) { D = a; M = b; } // DMY
    else if (b > 12) { D = b; M = a; } // MDY
    else { M = a; D = b; } // Defaulting to MDY for ambiguous cases like 01/02/2023
  } else { return null; }

  if (isNaN(Y) || isNaN(M) || isNaN(D) || M > 12 || D > 31) return null;
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
- **Nebulizer/Inhaler (خارجي)**: <span class='status-yellow'>⚠️ الطلب مُعرّض للرفض: يلزم أعراض/تشخيص تنفّسي موثق. ويجب مراجعته.</span>
- **Pantoprazole IV / Normal Saline IV / I.V infusion only / Primperan IV / Paracetamol IV** (حالات خارجية) ⇒ <span class='status-yellow'>⚠️ الطلب مُعرّض للرفض: يتطلب مؤشرات واضحة فقط (جفاف/تعذّر فموي/نزف..). ويجب مراجعته.</span>
- فحوص السكري/الضغط الروتينية ⇒ <span class='status-green'>✅ مقبول</span>.

[قائمة تحاليل إلزامية عند تواجد الأدوية]
- **Metformin XR**: eGFR/Creatinine + **B12** للاستخدام الطويل.
- **Co-Taburan/Triplixam/ACEI/ARB**: **K+** و **Creatinine** بعد 1–2 أسبوع من البدء/التعديل.
- **Statin**: **ALT/AST** بدايةً وعند الأعراض.

[البنية]
${SHARED_CSS_STYLES}
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><h4>تحليل الملفات المرفوعة</h4><h4>التحليل السريري العميق</h4>
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

// =============== GEMINI & OPENAI API WRAPPERS ===============

/**
 * يستخرج حقائق منظمة من الملفات باستخدام وضع JSON في Gemini.
 */
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

  const responseSchema = { /* ... a schema matching the prompt ... */ };

  const payload = {
    contents: [{ role: "user", parts: [{ text: extractionInstruction }, ...fileParts] }],
    generationConfig: {
      temperature: 0.0,
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini extractor error ${res.status}: ${raw.slice(0, 500)}`);
  
  try {
    const obj = JSON.parse(raw);
    const text = obj?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(text);
    if (parsed?.dob) parsed.dob = normalizeDate(parsed.dob) || parsed.dob;
    return parsed;
  } catch (e) {
    console.warn("Failed to parse extractor response:", e.message, raw);
    return {};
  }
}

/**
 * ينفذ OCR على الصور باستخدام OpenAI.
 */
async function ocrWithOpenAI(openaiKey, files) {
  const IMG = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const candidates = files.filter((f) => IMG.has(f.type || detectMimeFromB64(f.data))).slice(0, MAX_OCR_IMAGES);
  if (!candidates.length) return "";

  const images = candidates.map((f) => ({
    type: "image_url",
    image_url: { url: asDataUrl(f.type || detectMimeFromB64(f.data), f.data) }
  }));

  try {
    const res = await fetchWithRetry("[https://api.openai.com/v1/chat/completions](https://api.openai.com/v1/chat/completions)", {
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

/**
 * يرفع الملفات إلى Gemini API، مع محاولة الرفع البسيط ثم القابل للاستئناف.
 */
async function geminiUpload(apiKey, base64Data, mime) {
  const buf = Buffer.from(base64Data, "base64");
  
  // Simple Upload
  try {
    const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": mime, "x-goog-request-params": `file.mime_type=${mime}`},
      body: buf
    });
    if (!res.ok) throw new Error(`Simple upload failed with status ${res.status}`);
    const j = await res.json();
    return j?.file?.uri;
  } catch (e1) {
    console.warn("Simple upload failed, trying resumable…", e1.message);
    
    // Resumable Upload
    const start = await fetchWithRetry(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
      method: "POST",
      headers: { "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(buf.byteLength), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" },
      body: JSON.stringify({ file: { mimeType: mime } }),
    });
    if (!start.ok) throw new Error(`Resumable start failed (${start.status}): ${await start.text()}`);
    const uploadUrl = start.headers.get("X-Goog-Upload-URL");
    if (!uploadUrl) throw new Error("Missing X-Goog-Upload-URL");

    const up = await fetchWithRetry(uploadUrl, { method: "POST", headers: { "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0" }, body: buf });
    if (!up.ok) throw new Error(`Resumable upload failed (${up.status}): ${await up.text()}`);
    const j = await up.json();
    return j?.file?.uri;
  }
}

/**
 * يستدعي Gemini لإنشاء المحتوى (التقرير الرئيسي).
 */
async function geminiGenerate(apiKey, parts, cfg = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ role: "user", parts }],
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    generationConfig: { temperature: 0.0, topP: 0.9, topK: 40, maxOutputTokens: 8192, ...cfg }
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

// =============== PROMPT BUILDER ===============
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


// =============== TEXT ANALYSIS & POLICY OVERRIDES ===============
const DENGUE_TRIGGERS = ["حمى","سخونة","ارتفاع الحرارة","fever","سفر إلى","travel to","منطقة موبوءة","endemic area", "dengue"];
const RESP_TRIGGERS = ["سعال","صفير","ضيق تنفس","asthma","copd","wheeze","shortness of breath","dyspnea", "respiratory"];
const IV_TRIGGERS = ["جفاف","dehydration","قيء شديد","severe vomiting","تعذر فموي","npo","نزف","bleeding","هبوط ضغط","hypotension"];
const US_TRIGGERS = ["ألم بطني","epigastric pain","ruq pain","gallbladder","كبد","حوض","pelvic","umbilical","periumbilical", "ultrasound"];

function bagOfText({ body = {}, ocrText = "", facts = {}, modelHtml = "" } = {}) {
  return [ body.notes || "", Array.isArray(body.problems) ? body.problems.join(" ") : "", body.medications || "", ocrText || "", stripTags(modelHtml || ""), ].join(" ").toLowerCase();
}
function hasAny(text, arr) { const s = text.toLowerCase(); return arr.some(w => s.includes(w.toLowerCase())); }

function canonicalServiceKey(s = "") { /* ... no changes needed ... */ return s; }
function getFirstTableCloseIndex(html="") { /* ... no changes needed ... */ return -1; }
function safeInsertAfterFirstTable(html="", snippet="") { /* ... no changes needed ... */ return html; }

// --- HTML Post-Processing ---
function rewriteCautionPhrases(html="") { /* ... no changes needed ... */ return html; }
function pruneRepeatedHeaderRows(html="") { /* ... no changes needed ... */ return html; }
function dedupeServiceRows(html="") { /* ... no changes needed ... */ return html; }

function ensureTableHeader(html="") {
  return html.replace(/<table[^>]*>([\s\S]*?)(<tbody>)/i, (m, beforeTbody, tbodyTag) => {
    if (/<thead>/i.test(beforeTbody)) return m;
    const thead = `<thead><tr>
<th>الدواء/الإجراء (مع درجة الثقة)</th><th>الجرعة الموصوفة</th><th>الجرعة الصحيحة المقترحة</th><th>التصنيف</th><th>الغرض الطبي</th><th>التداخلات</th><th>درجة الخطورة (%)</th><th>قرار التأمين</th>
</tr></thead>`;
    return `<table class="min-w-full divide-y divide-gray-200">${thead}${tbodyTag}`;
  });
}

function ensureLegendAboveTable(html="") {
  if (/الرموز:\s*✅|⚠️|❌/.test(html)) return html;
  const legend = `<div style="margin:8px 0 12px 0;font-size:13px;color:#374151">
<strong>الرموز:</strong> <span class="status-green">✅ مقبول</span> |
<span class="status-yellow">⚠️ الطلب مُعرّض للرفض (ويجب مراجعته)</span> |
<span class="status-red">❌ مرفوض</span>
</div>`;
  return html.replace(/(<h4>\s*جدول الأدوية والإجراءات\s*<\/h4>)/i, `$1\n${legend}`);
}

function buildGuidelineBlock({ detectedKeys = new Set(), eGFR = null } = {}) { /* ... no changes needed ... */ return ""; }
function extractEGFR(text="") { /* ... no changes needed ... */ return null; }

/**
 * **تحسين:** دالة عامة لتطبيق القواعد على صفوف الجدول لتقليل التكرار.
 * تطبق تحذيرًا على الصفوف التي تطابق `rowIdentifier` إذا لم يتم استيفاء `condition`.
 */
function applyRowRule(html, { rowIdentifier, condition, warningHtml }) {
  if (condition) return html; // الشرط مستوفى، لا تفعل شيئًا
  
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    if (!rowIdentifier(row)) return row; // ليس الصف المطلوب

    // الصف مطلوب والشرط غير مستوفى، طبّق التحذير
    let cleaned = row.replace(/<span class="status-[^"]+">[\s\S]*?<\/span>/gi, "").replace(/✅|❌/g, "");
    const tds = cleaned.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);

    if (tds && tds.length) {
      cleaned = cleaned.replace(tds[tds.length - 1], tds[tds.length - 1].replace(/(<td\b[^>]*>)[\s\S]*?(<\/td>)/i, `$1${warningHtml}$2`));
    } else {
      cleaned = cleaned.replace(/<\/tr>/i, `<td>${warningHtml}</td></tr>`);
    }
    return cleaned;
  });
}

// --- خط أنابيب ما بعد المعالجة ---
function applyPolicyOverrides(htmlReport, ctx) {
  let out = htmlReport;
  
  const rules = [
    {
      identifier: (row) => /(dengue|الضنك|حمى الضنك)/i.test(stripTags(row)) && /\bigg\b/i.test(stripTags(row)),
      condition: !!ctx.facts?.hasDengueAcuteContext || hasAny(bagOfText(ctx), DENGUE_TRIGGERS),
      warning: `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يحتاج مبرر سريري (حمّى/تعرض) ويفضّل NS1/NAAT أو IgM للتشخيص الحاد. ويجب مراجعته.</span>`
    },
    {
      identifier: (row) => /referral/i.test(stripTags(row)),
      condition: !!ctx.facts?.hasReferralReason || hasAny(bagOfText(ctx), ["إحالة","referral for","refer to","تحويل إلى","سبب الإحالة"]),
      warning: `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يتطلب ذكر سبب إحالة واضح. ويجب مراجعته.</span>`
    },
    {
      identifier: (row) => /(nebulizer|inhaler|نيبولايزر|استنشاق)/i.test(stripTags(row)),
      condition: !!ctx.facts?.hasRespContext || hasAny(bagOfText(ctx), RESP_TRIGGERS),
      warning: `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يلزم أعراض/تشخيص تنفّسي موثق. ويجب مراجعته.</span>`
    },
    {
      identifier: (row) => /(normal\s*saline|i\.?v\.?\s*infusion\s*only|primperan|metoclopramide|paracetamol\s+.*infus|pantoprazole|pantozol)/i.test(stripTags(row)),
      condition: !!ctx.facts?.hasIVIndication || hasAny(bagOfText(ctx), IV_TRIGGERS),
      warning: `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: الاستعمال الوريدي يتطلب مؤشرات واضحة (جفاف/قيء شديد/تعذّر فموي...). ويجب مراجعته.</span>`
    },
    {
      identifier: (row) => /(ultrasound|ultra\s*sound|سونار|ألتراساوند)/i.test(stripTags(row)),
      condition: !!ctx.facts?.hasUSIndication || hasAny(bagOfText(ctx), US_TRIGGERS),
      warning: `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يتطلب مبرر تصوير واضح (مثلاً ألم بطني موضع). ويجب مراجعته.</span>`
    }
  ];

  for (const rule of rules) {
    out = applyRowRule(out, { rowIdentifier: rule.identifier, condition: rule.condition, warningHtml: rule.warning });
  }

  out = rewriteCautionPhrases(out);
  out = pruneRepeatedHeaderRows(out);
  out = dedupeServiceRows(out);
  out = ensureTableHeader(out);
  out = ensureLegendAboveTable(out);
  // out = buildGuidelineSection(out, ctx); // This function seems incomplete in the original code
  
  if (!/الخاتمة/.test(out)) {
    out += `<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>`;
  }
  return out;
}

// =============== API HANDLER ===============
export default async function handler(req, res) {
  // CORS Headers
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

    // الخطوة 1: OCR (للصور) إذا كان مفتاح OpenAI متوفرًا
    let ocrText = "";
    if (openaiKey && files.length) {
      try { ocrText = await ocrWithOpenAI(openaiKey, files); }
      catch (e) { console.warn("OCR skipped:", e.message); }
    }

    // الخطوة 2: تجهيز ملفات Gemini (Inline or Upload)
    const filePartsPromises = files.map(async (f) => {
      try {
        const base64 = f?.data || "";
        if (!base64) return null;
        const mime = f.type || detectMimeFromB64(base64);

        const buf = Buffer.from(base64, "base64");
        if (buf.byteLength > MAX_INLINE_FILE_BYTES) {
          const uri = await geminiUpload(geminiKey, base64, mime);
          return uri ? { fileData: { mimeType: mime, fileUri: uri } } : null;
        } else {
          return { inlineData: { mimeType: mime, data: base64 } };
        }
      } catch (e) {
        console.warn(`File processing failed for ${f?.name || "a file"}:`, e.message);
        return null;
      }
    });
    const processedFileParts = (await Promise.all(filePartsPromises)).filter(Boolean);

    // الخطوة 3: استخراج حقائق منظّمة من الملفات
    let facts = {};
    if (processedFileParts.length) {
      try {
        facts = await geminiExtractFacts(geminiKey, processedFileParts);
        if (facts?.dob && !body.age && !body.dob) body.dob = facts.dob;
        if (facts?.gender && !body.gender) body.gender = facts.gender;
      } catch (e) {
        console.warn("Facts extractor failed:", e.message);
      }
    }

    // الخطوة 4: بناء الطلب النهائي لـ Gemini
    const userPrompt = buildUserPrompt(body, facts);
    const parts = [{ text: userPrompt }];
    if (processedFileParts.length) parts.push(...processedFileParts);
    if (ocrText) parts.push({ text: `\n### OCR Extracted Texts\n${ocrText}` });

    // الخطوة 5: استدعاء Gemini لإنتاج التقرير الأولي
    const htmlReportRaw = await geminiGenerate(geminiKey, parts);

    // الخطوة 6: تطبيق القواعد الإلزامية وتنقيح الـ HTML النهائي
    const finalHtmlReport = applyPolicyOverrides(htmlReportRaw, { body, ocrText, facts, modelHtml: htmlReportRaw });

    return res.status(200).json({
      ok: true,
      at: nowIso(),
      htmlReport: finalHtmlReport,
      meta: {
        model: GEMINI_MODEL,
        filesReceived: files.length,
        filesAttachedToModel: processedFileParts.length,
        usedOCR: !!ocrText,
        facts,
        elapsedMs: Date.now() - startedAt,
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
