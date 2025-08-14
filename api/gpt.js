// pages/api/gpt.js
// Unified Expert Analyzer (Gemini + optional OpenAI OCR)
// Next.js Pages Router / Vercel (Node 18+)

// ========================= ENV =========================
// GEMINI_API_KEY   = "sk-..."   (required)
// OPENAI_API_KEY   = "sk-..."   (optional → enables OCR for images)
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
function asDataUrl(mime, b64) {
  return `data:${mime};base64,${b64}`;
}
function stripFences(s = "") {
  return s.replace(/```html/gi, "").replace(/```/g, "").trim();
}
function escapeHtml(s = "") {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
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

// ------------ SYSTEM PROMPT (مع قاعدة Dengue داخل البرومبت أيضاً) ------------
const systemInstruction = `
أنت استشاري "تدقيق طبي وتشغيلي" خبير عالمي. هدفك: دقة 10/10. أخرج **كتلة HTML واحدة فقط** وفق القالب.

[قواعد أساسية (ملزمة)]
- **مصدر الحقيقة**: "بيانات المريض" المرسلة يدويًا هي المرجع النهائي. إذا خالفتها الملفات، اذكر التعارض في "تحليل الملفات" لكن ابنِ القرار النهائي على بيانات المريض.
- **Red Flags**: مدخن + سعال (خصوصًا مع دم) ⇒ أوصِ بـ **Chest X-ray** ضمن "خدمات ضرورية".
- **توافق ديموغرافي**: راقب أخطاء الجنس/التشخيص/الدواء (مثل Duodart لأنثى ⇒ خطأ جوهري).

[منهجية الدواء]
- **Triplex ⇒ Triplixam** عند الاشتباه؛ **Form XR ⇒ Metformin XR**.
- **كبار السن (>65)**: راقب نقص السكر مع Sulfonylurea (مثل Diamicron) وخطر السقوط مع ≥2 خافضات ضغط.
- **أمان محدد**:
  - **Metformin XR**: "مضاد استطباب إذا eGFR < 30".
  - **ACEI + ARB معًا** (Perindopril في Triplixam + Valsartan في Co-Taburan): **ممنوع**.
  - **ازدواجية المواد**: إذا وُجد Amlodipine منفصلًا ومع Triplixam ⇒ ازدواجية.

[قواعد الفحوص/الإجراءات (تأمينية)]
- أدخل كل عنصر يظهر من مستخلص OCR كصف في الجدول.
- **Dengue Ab IgG**: إن **لم تُذكر** حُمّى أو **سفر إلى منطقة موبوءة** في بيانات المريض/الأعراض، فالقرار **إلزاميًا**: <span class='status-yellow'>⚠️ قابل للمراجعة: يحتاج NS1/NAAT أو IgM للتشخيص الحاد.</span>
- **Nebulizer/Inhaler (خارجية)**: <span class='status-yellow'>⚠️ قابل للمراجعة: لزوم أعراض تنفسية موثقة.</span>
- **Pantoprazole IV / Normal Saline IV / I.V infusion only / Primperan IV / Paracetamol IV** (حالات خارجية) ⇒ <span class='status-yellow'>⚠️ قابل للمراجعة: استخدم فقط مع مؤشرات واضحة.</span>
- تحاليل روتينية للسكري/الضغط (CBC, Creatinine/eGFR, Urea, ALT/SGPT, HbA1c, Lipids, CRP, Urine) ⇒ <span class='status-green'>✅ مقبول</span>.

[قائمة تحاليل إلزامية عند تواجد الأدوية المعيّنة]
- **Metformin XR**: eGFR/Creatinine قبل البدء ودوريًا + **B12** للاستخدام الطويل.
- **Co-Taburan/Triplixam**: **K+** و **Creatinine** بعد 1–2 أسبوع من البدء/تعديل الجرعة.
- **Statin (Rozavi)**: **ALT/AST** بدايةً وعند الأعراض.
- **هشاشة العظام**: **25-OH Vitamin D**.

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

// ------------ USER PROMPT BUILDER ------------
function buildUserPrompt(d = {}) {
  return `
**بيانات المريض (مرجِع التحليل):**
العمر: ${d.age ?? "غير محدد"}
الجنس: ${d.gender ?? "غير محدد"}
هل المريض مدخن؟: ${d.isSmoker ? "نعم" : (d.isSmoker === false ? "لا" : "غير محدد")}
باك-سنة: ${d.packYears ?? "غير محدد"}
وصف الحالة/الأعراض: ${d.notes || "—"}
أمراض مُدرجة: ${Array.isArray(d.problems) ? d.problems.join(", ") : "—"}

**نص الأدوية/الإجراءات من المستخدم:** ${d.medications || "—"}
**عدد الملفات المرفوعة:** ${Array.isArray(d.files) ? d.files.length : 0}

[تعليمات المخرجات]
- أخرج HTML واحد فقط، دون كتل كود.
- إذا تعارضت بيانات الملفات مع "بيانات المريض" أعلاه فاذكر التعارض لكن اتّبع "بيانات المريض" في الاستنتاج النهائي.
`;
}

// ------------ OPENAI OCR (اختياري) ------------
async function ocrWithOpenAI(openaiKey, files) {
  const IMG = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const candidates = files
    .filter((f) => IMG.has(f.type || detectMimeFromB64(f.data)))
    .slice(0, MAX_OCR_IMAGES);

  if (!candidates.length) return "";

  const images = candidates.map((f) => ({
    type: "image_url",
    image_url: { url: asDataUrl(f.type || detectMimeFromB64(f.data), f.data) },
  }));

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
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn("OpenAI OCR error:", res.status, t.slice(0, 200));
      return "";
    }
    const j = await res.json();
    return (j?.choices?.[0]?.message?.content || "").trim();
  } catch (e) {
    console.warn("OpenAI OCR exception:", e.message);
    return "";
  }
}

// ------------ GEMINI FILES (simple + resumable) ------------
async function geminiUploadSimple(apiKey, base64Data, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64Data, "base64");
  const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": mime }, body: buf });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini simple upload failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  return j?.file?.uri || j?.uri || null;
}

async function geminiUploadResumable(apiKey, base64Data, mime) {
  const buf = Buffer.from(base64Data, "base64");
  // Start session
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
  if (!start.ok) {
    const t = await start.text().catch(() => "");
    throw new Error(`Gemini resumable start failed (${start.status}): ${t.slice(0, 300)}`);
  }
  const uploadUrl = start.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Missing X-Goog-Upload-URL");

  // Upload bytes + finalize
  const up = await fetchWithRetry(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": mime,
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: buf,
  });
  if (!up.ok) {
    const t = await up.text().catch(() => "");
    throw new Error(`Gemini resumable upload failed (${up.status}): ${t.slice(0, 300)}`);
  }
  const j = await up.json();
  return j?.file?.uri || j?.uri || null;
}

async function geminiUpload(apiKey, base64Data, mime) {
  try {
    return await geminiUploadSimple(apiKey, base64Data, mime);
  } catch (e1) {
    console.warn("Simple upload failed, trying resumable…", e1.message);
    return await geminiUploadResumable(apiKey, base64Data, mime);
  }
}

// ------------ GEMINI ANALYZE ------------
async function geminiAnalyze(apiKey, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: { t
