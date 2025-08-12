// pages/api/gpt.js
// Unified Expert Analyzer (Gemini + optional OpenAI OCR)
// Runtime: Next.js Pages Router (Node 18+ on Vercel)

// ========================= ENV =========================
// GEMINI_API_KEY   = "sk-... (Google AI for Developers)"
// OPENAI_API_KEY   = "sk-... (optional, enables OCR)"
// =======================================================

import { createHash } from "crypto";

// --------------- CONFIG ----------------
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRY_STATUS = new Set([408, 409, 413, 429, 500, 502, 503, 504]);
const MAX_FILES_PER_REQUEST = 30;
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4MB: safe with Next body limit
const MAX_OCR_IMAGES = 15; // hard cap to protect tokens
const OCR_MODEL = "gpt-4o-mini";
const USER_HTML_FALLBACK_FRAME = `
<style>
  .status-green { display:inline-block;background:#d4edda;color:#155724;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #c3e6cb }
  .status-yellow{ display:inline-block;background:#fff3cd;color:#856404;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #ffeeba }
  .status-red   { display:inline-block;background:#f8d7da;color:#721c24;padding:4px 10px;border-radius:15px;font-weight:bold;border:1px solid #f5c6cb }
  .section-title{ color:#1e40af;font-weight:bold }
  .critical     { color:#991b1b;font-weight:bold }
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;line-height:1.6}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #e5e7eb;padding:8px;font-size:14px}
  thead th{background:#f3f4f6}
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<p>تم توليد هذا التقرير تلقائيًا. في حال لم يُلتزم بالقالب بالكامل من النموذج، تمت إعادة تغليف المحتوى ضمن هيكل قياسي.</p>
`;

// --------------- LRU-ish FILE CACHE (process memory) ---------------
const fileCache = new Map();

// --------------- UTILS ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function abortableFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(t));
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
  if (h.includes("AAAAIG")) return "video/mp4";
  if (h.includes("R0lGOD")) return "image/gif";
  return "application/octet-stream";
}
function getFileHash(base64Data = "") {
  return createHash("sha256").update(base64Data).digest("hex");
}
function asBase64DataUrl(mime, b64) {
  return `data:${mime};base64,${b64}`;
}
function stripFences(s = "") {
  return s.replace(/```html/gi, "").replace(/```/g, "").trim();
}
function hardHtmlEnforce(s = "") {
  const t = stripFences(s);
  const looksHtml = /<html|<body|<\/?(table|tr|td|th|ul|ol|li|h\d|p|span|div|style)\b/i.test(t);
  if (looksHtml) return t;
  // Wrap any plain text into our fallback frame
  return `${USER_HTML_FALLBACK_FRAME}<pre style="white-space:pre-wrap">${escapeHtml(t)}</pre>`;
}
function escapeHtml(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function safeJson(v) {
  try { return JSON.stringify(v); } catch { return "{}"; }
}

// --------------- SYSTEM PROMPT ----------------
const systemInstruction = `
أنت استشاري "تدقيق طبي وتشغيلي" خبير عالمي. هدفك هو الوصول لدقة 10/10. أخرج كتلة HTML واحدة فقط.

[قواعد التحليل الأساسية (غير قابلة للتفاوض)]
- **قاعدة الأولوية المطلقة (مصدر الحقيقة):** البيانات التي يقدمها المستخدم يدويًا في قسم "بيانات المريض" هي **مصدر الحقيقة المطلق وغير القابل للنقاش**. إذا وجدت معلومة متضاربة في ملف مرفق، يجب عليك الإشارة إلى هذا التضارب في قسم "تحليل الملفات المرفوعة"، ولكن **يجب أن تبني تحليلك النهائي وقراراتك بالكامل على بيانات المستخدم اليدوية**.
- **قاعدة الأعراض الخطيرة (Red Flags):** إذا كان المريض **مدخنًا** ويعاني من **سعال** (خاصة مع دم)، فمن **الإلزامي** التوصية بإجراء **أشعة سينية على الصدر (Chest X-ray)** في قسم "خدمات طبية ضرورية".
- **قاعدة التوافق الديموغرافي المطلق:** بناءً على جنس المريض من بيانات المستخدم، تحقق من تطابق التشخيصات والأدوية. إذا كان المريض **ذكرًا**، فإن تشخيص BPH ووصف Duodart يكونان منطقيين. إذا كانت **أنثى**، فهما خطأ جوهري.

[منهجية التحليل التفصيلية]
- **قاعدة الاستنتاج الصيدلاني:**
  - **Triplex:** إذا تم تحديده كدواء (بسبب od x90)، افترضه **Triplixam**.
  - **Form XR:** استنتج أنه **Metformin XR**.
- **قاعدة كبار السن (Geriatrics):** لأي مريض عمره > 65 عامًا، قم بالتحقق الإجباري من:
  1. **خطر نقص السكر:** عند وجود أدوية Sulfonylurea (مثل Diamicron).
  2. **خطر السقوط:** عند وجود دوائين أو أكثر يخفضان الضغط.
- **قاعدة أمان الأدوية المحددة:**
  - **Metformin XR:** "**مضاد استطباب عند eGFR < 30**".
  - **التحالف المحظور (ACEI + ARB):** الجمع بين ACEI (مثل Perindopril في Triplixam) و ARB (مثل Valsartan في Co-Taburan) **تعارض خطير وممنوع**.
  - **الازدواجية العلاجية الخفية:** تحقق مما إذا كانت المادة الفعالة في دواء مفرد (مثل Amlodipine) موجودة أيضًا كجزء من دواء مركب في نفس الوصفة (مثل Triplixam).

[قاعدة التحاليل المخبرية الإلزامية → تُدمج مباشرة في "خطة العمل"]
- **Metformin XR:** eGFR/Creatinine قبل البدء ثم دوريًا + فيتامين B12 للاستخدام الطويل.
- **Co-Taburan/Triplixam:** K+ و Creatinine بعد 1–2 أسبوع من البدء أو تعديل الجرعة.
- **Rozavi (Statin):** ALT/AST عند البداية وعند ظهور أعراض.
- **هشاشة العظام:** 25-OH Vitamin D.

[صياغة قرارات التأمين (إلزامية)]
- Amlodipine: "<span class='status-yellow'>⚠️ قابل للمراجعة: يُلغى إذا استُخدم Triplixam (ازدواجية CCB).</span>"
- Co-Taburan: "<span class='status-red'>❌ مرفوض إذا وُجد Triplixam (ACEI+ARB ممنوع).</span>"
- Triplixam: "<span class='status-yellow'>⚠️ مشروط: يُعتمد فقط بعد إلغاء Co-Taburan وAmlodipine المنفصل.</span>"
- Metformin XR: "<span class='status-yellow'>⚠️ موافقة مشروطة: ابدأ بعد تأكيد eGFR ≥30؛ إن لزم فابدأ 500 mg وتدرّج.</span>"
- Diamicron MR: "<span class='status-yellow'>⚠️ موافقة بحذر: فكّر ببديل أقل إحداثًا لنقص السكر لدى كبار السن.</span>"
- E-core Strips/Lancets: "<span class='status-yellow'>⚠️ مقبول مع تبرير طبي للحاجة للقياس المتكرر.</span>"
- Duodart للأنثى: "<span class='status-red'>❌ مرفوض ديموغرافيًا (دواء للرجال فقط).</span>"
- أي دواء غير واضح: "<span class='status-yellow'>⚠️ قابل للمراجعة: يحتاج لتوضيح</span>"
- أي دواء سليم: "<span class='status-green'>✅ مقبول</span>"

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

// --------------- USER PROMPT BUILDER ----------------
function buildUserPrompt(d = {}) {
  return `
**بيانات المريض:**
العمر: ${d.age ?? "غير محدد"}
الجنس: ${d.gender ?? "غير محدد"}
هل المريض مدخن؟: ${d.isSmoker ? "نعم" : "لا"}
باك-سنة: ${d.packYears ?? "غير محدد"}
وصف الحالة (بما في ذلك الأعراض مثل السعال): ${d.notes || "—"}
أمراض مُدرجة: ${Array.isArray(d.problems) ? d.problems.join(", ") : "—"}

**أدوية/إجراءات مكتوبة (نص خام):** ${d.medications || "—"}
**عدد الملفات المرفوعة:** ${Array.isArray(d.files) ? d.files.length : 0}

[تعليمات التزام المخرجات]
- أخرج HTML واحد فقط، بدون أي كتل كود أو تعليقات.
- إذا وجدت تعارضًا بين ما ورد في الملفات وبيانات المريض أعلاه، فاذكر التعارض لكن اتبع بيانات المريض في الاستنتاج النهائي.
`;
}

// --------------- OPENAI OCR (optional) ----------------
async function ocrWithOpenAI(openaiKey, files) {
  const IMG = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const candidates = files
    .filter((f) => IMG.has(f.type || detectMimeFromB64(f.data)))
    .slice(0, MAX_OCR_IMAGES);

  if (!candidates.length) return "";

  const images = candidates.map((f) => ({
    type: "image_url",
    image_url: { url: asBase64DataUrl(f.type || detectMimeFromB64(f.data), f.data) },
  }));

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content:
              "Extract legible text and structured items (tests requested, drugs, doses, units) from medical photos. Respond in Arabic; keep it concise and line-separated.",
          },
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

// --------------- GEMINI FILE UPLOADS ----------------
// Path A: direct simple upload (works for small/straightforward cases)
async function geminiUploadSimple(apiKey, base64Data, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64Data, "base64");
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": mime },
    body: buf,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini simple upload failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  return j?.file?.uri || j?.uri || j?.file?.fileUri || null;
}

// Path B: resumable upload (official)
async function geminiUploadResumable(apiKey, base64Data, mime) {
  const buf = Buffer.from(base64Data, "base64");
  // 1) Start session
  const start = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(buf.byteLength),
        "X-Goog-Upload-Header-Content-Type": mime,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ file: { mimeType: mime, displayName: "upload" } }),
    }
  );
  if (!start.ok) {
    const t = await start.text().catch(() => "");
    throw new Error(`Gemini resumable start failed (${start.status}): ${t.slice(0, 300)}`);
  }
  const uploadUrl = start.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Missing X-Goog-Upload-URL");

  // 2) Upload bytes + finalize
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

// --------------- GEMINI ANALYZE ----------------
async function geminiAnalyze(apiKey, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 8192,
    },
    // safetySettings: [...]  // can be customized if needed
  };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${raw.slice(0, 600)}`);
  try {
    const j = JSON.parse(raw);
    const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n") || "";
    return hardHtmlEnforce(text);
  } catch {
    return hardHtmlEnforce(raw);
  }
}

// --------------- API HANDLER ----------------
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

    // Accept JSON or already-parsed object
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES_PER_REQUEST) : [];

    // Optional OCR for images
    let ocrText = "";
    if (openaiKey && files.length) {
      try { ocrText = await ocrWithOpenAI(openaiKey, files); }
      catch (e) { console.warn("OCR skipped:", e.message); }
    }

    // Prepare file parts (inline for small; Gemini Files API for large)
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
        // cache lightweight pointer only
        if (fileCache.size > 256) fileCache.clear();
        fileCache.set(hash, part);
        return part;
      } catch (e) {
        console.warn(`File processing failed (${f?.name || "file"}):`, e.message);
        return null;
      }
    });

    const processedFileParts = (await Promise.all(filePartsPromises)).filter(Boolean);

    // Compose parts
    const parts = [{ text: systemInstruction }, { text: buildUserPrompt(body) }];
    if (processedFileParts.length) parts.push(...processedFileParts);
    if (ocrText) parts.push({ text: `### OCR Extracted Texts\n${ocrText}` });

    // Call Gemini
    const htmlReport = await geminiAnalyze(geminiKey, parts);

    // Response
    const elapsedMs = Date.now() - startedAt;
    return res.status(200).json({
      ok: true,
      htmlReport,
      meta: {
        model: GEMINI_MODEL,
        filesReceived: files.length,
        filesAttachedToModel: processedFileParts.length,
        usedOCR: Boolean(ocrText),
        elapsedMs,
      },
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      ok: false,
      error: "Internal server error",
      detail: err?.message || String(err),
    });
  }
}

// Next.js API body size
export const config = {
  api: { bodyParser: { sizeLimit: "12mb" } },
};
