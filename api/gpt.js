// pages/api/gpt.js
// محلل خبير موحد — النهج الهجين (Hybrid Approach)
// 1. Gemini كخبير طبي للتحليل الأساسي.
// 2. قواعد مبرمجة كطبقة أمان أخيرة لفرض السياسات الإلزامية.
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

async function fetchWithRetry(url, options, { retries = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));

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

function stripFences(s = "") { return s.replace(/```(html|json)?/gi, "").trim(); }
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
  return `${SHARED_CSS_STYLES}<pre style="white-space:pre-wrap">${s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>`;
}

// =============== SYSTEM PROMPT (شخصية الخبير ومنهجية التحليل العميق) ===============
const systemInstruction = `
أنت "كبير مستشاري التدقيق الطبي والسريري" (Lead Clinical Auditor). مهمتك ليست فقط تلخيص البيانات، بل تقديم تحليل نقدي وعميق يربط بين جميع النقاط، ويحدد المخاطر، ويكشف الفجوات في الخطة العلاجية. مخرجك النهائي يجب أن يكون **كتلة HTML واحدة فقط**.

// --- START: EXPERT ANALYSIS METHODOLOGY ---
[منهجية التحليل السريري العميق (Your Expert Methodology)]
عند كتابة الأقسام التحليلية ("التحليل السريري العميق" و "خدمات طبية ضرورية")، اتبع هذه المنهجية الفكرية:

1.  **الربط والتركيب (Synthesize, Don't Just List):**
    - لا تلخص كل معلومة بشكل منفصل. اربط بين التشخيص (سكري، ضغط)، الأعراض (ألم بطني، اعتلال عصبي)، والطلبات (تحاليل، أدوية وريدية).
    - مثال: "وجود ألم بطني مع تشخيص السكري يرفع احتمالية وجود خزل المعدة السكري (Gastroparesis)، مما يبرر استخدام Primperan IV مؤقتاً."

2.  **تقييم المخاطر والفجوات (Assess Risks & Gaps):**
    - ما هي أكبر المخاطر الحالية والمستقبلية لهذا المريض؟ (مثال: خطر الإصابة بأزمة ارتفاع ضغط الدم، أو قصور كلوي حاد بسبب الجفاف المحتمل مع السكري).
    - **الأهم: ما هي الفحوصات أو الإجراءات الرئيسية المفقودة؟** هل هناك تحليل ناقص بناءً على حالته؟ (مثال: لم يتم طلب تحليل نسبة الألبومين إلى الكرياتينين في البول (UACR) وهو تحليل أساسي للكشف المبكر عن أمراض الكلى السكرية).

3.  **التبرير العميق (Provide Deep Justification):**
    - لكل توصية، قدم مبرراً سريرياً قوياً.
    - بدلاً من قول "متابعة وظائف الكلى"، قل: "يجب مراقبة الكرياتينين بدقة، خاصة وأن المريض يعاني من السكري والضغط، مما يضعه في خانة الخطر العالي لأمراض الكلى المزمنة (CKD)".

4.  **تقديم توصيات قابلة للتنفيذ (Give Actionable Recommendations):**
    - قدم خطوات تالية واضحة ومحددة.
    - بدلاً من قول "يجب مراجعة الأدوية الوريدية"، قل: "توصية حرجة: تقييم حالة المريض للقدرة على البلع وتحمل السوائل الفموية. في حال استقرار الحالة، يجب وضع خطة واضحة للانتقال من العلاج الوريدي (IV) إلى الأدوية الفموية (PO) خلال 24 ساعة لتقليل مخاطر العدوى وتكاليف العلاج."
// --- END: EXPERT ANALYSIS METHODOLOGY ---


[دليل قرار التأمين (Insurance Decision Logic)]
عند ملء عمود "قرار التأمين"، اتبع القواعد التالية بدقة واستخدم التنسيق المحدد... (هذا الجزء يبقى كما هو من الإصدار السابق)
...

[تعليمات صارمة لجدول الأدوية والإجراءات]
مهمتك الأساسية هي استخراج كل بند على حدة... (هذا الجزء يبقى كما هو من الإصدار السابق)
...

[هيكل HTML المطلوب]
... (الهيكل يبقى كما هو) ...
`;
// =============== GEMINI & OPENAI API WRAPPERS ===============

async function geminiExtractFacts(apiKey, fileParts) {
  // This function remains useful for the hardcoded "Safety Net" rules
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const extractionInstruction = `You are a fact extractor. Output ONLY JSON with these keys: "hasReferralReason": boolean, "hasRespContext": boolean, "hasIVIndication": boolean, "hasUSIndication": boolean, "hasDengueAcuteContext": boolean. Default to false if unsure.`;
  const responseSchema = { type: "object", properties: { hasReferralReason: { type: "boolean" }, hasRespContext: { type: "boolean" }, hasIVIndication: { type: "boolean" }, hasUSIndication: { type: "boolean" }, hasDengueAcuteContext: { type: "boolean" } } };
  const payload = { contents: [{ role: "user", parts: [{ text: extractionInstruction }, ...fileParts] }], generationConfig: { temperature: 0.0, responseMimeType: "application/json", responseSchema } };
  const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) { console.warn("Extractor failed:", await res.text()); return {}; }
  const j = await res.json();
  return JSON.parse(j?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
}

async function ocrWithOpenAI(openaiKey, files) {
    const IMG = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    const candidates = files.filter((f) => IMG.has(f.type || detectMimeFromB64(f.data))).slice(0, MAX_OCR_IMAGES);
    if (!candidates.length) return "";
    const images = candidates.map((f) => ({ type: "image_url", image_url: { url: `data:${f.type || detectMimeFromB64(f.data)};base64,${f.data}` } }));

    try {
        const res = await fetchWithRetry("[https://api.openai.com/v1/chat/completions](https://api.openai.com/v1/chat/completions)", {
            method: "POST",
            headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: OCR_MODEL, messages: [{ role: "system", content: "Extract all text from these medical documents line-by-line. Transcribe in Arabic where possible but keep English terms as they are." }, { role: "user", content: images }] }),
        });
        if (!res.ok) { console.warn("OpenAI OCR error:", res.status, await res.text()); return ""; }
        const j = await res.json();
        return (j?.choices?.[0]?.message?.content || "").trim();
    } catch (e) { console.warn("OpenAI OCR exception:", e.message); return ""; }
}

async function geminiUpload(apiKey, base64Data, mime) {
    const buf = Buffer.from(base64Data, "base64");
    const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`, { method: "POST", headers: { "Content-Type": mime }, body: buf });
    if (!res.ok) throw new Error(`Gemini upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return j?.file?.uri;
}

async function geminiGenerate(apiKey, parts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ role: "user", parts }],
        systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.1, topP: 0.95, maxOutputTokens: 8192 }
    };
    const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${raw.slice(0, 600)}`);
    const j = JSON.parse(raw);
    const text = (j?.candidates?.[0]?.content?.parts || []).map((p) => p?.text || "").join("");
    return hardHtmlEnforce(text);
}

// =============== PROMPT BUILDER ===============
function buildUserPrompt(user = {}, facts = {}, ocrText = "") {
  // Simplified user prompt since the main instructions are in the system prompt
  return `
---
**بيانات المريض (مصدر الحقيقة)**
- العمر: ${user.age ?? "غير محدد"}
- الجنس: ${user.gender ?? "غير محدد"}
- هل المريض مدخن؟: ${user.isSmoker ? "نعم" : "لا"}
- وصف الحالة/الأعراض: ${user.notes || "—"}
- أمراض مُدرجة: ${Array.isArray(user.problems) ? user.problems.join(", ") : "—"}
- الأدوية والإجراءات المذكورة: ${user.medications || "—"}
- عدد الملفات المرفوعة: ${Array.isArray(user.files) ? user.files.length : 0}
---
**النص المستخرج من الملفات (OCR)**
${ocrText || "لا يوجد نص مستخرج."}
---
الرجاء البدء بالتحليل الآن.
`;
}


// =============== SAFETY NET & HTML CLEANUP ===============
const DENGUE_TRIGGERS = ["حمى", "سخونة", "fever", "سفر إلى", "travel to", "منطقة موبوءة", "endemic area"];
const RESP_TRIGGERS = ["سعال", "صفير", "ضيق تنفس", "asthma", "copd", "wheeze", "dyspnea"];
const IV_TRIGGERS = ["جفاف", "dehydration", "قيء شديد", "severe vomiting", "تعذر فموي", "npo"];
const US_TRIGGERS = ["ألم بطني", "epigastric pain", "ruq pain", "gallbladder", "pelvic"];

function bagOfText({ body = {}, ocrText = "" } = {}) {
  return [body.notes || "", Array.isArray(body.problems) ? body.problems.join(" ") : "", body.medications || "", ocrText || ""].join(" ").toLowerCase();
}

function hasAny(text, arr) { return arr.some(w => text.toLowerCase().includes(w.toLowerCase())); }

function applyRowRule(html, { rowIdentifier, condition, warningHtml }) {
    if (condition) return html;
    return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
        if (!rowIdentifier(row)) return row;
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

function dedupeServiceRows(html) { /* ... implementation from previous version ... */ return html; }
function ensureTableHeader(html) { /* ... implementation from previous version ... */ return html; }

function applySafetyNet(htmlReport, ctx) {
    let out = htmlReport;
    const textContext = bagOfText(ctx);

    const rules = [
        {
            identifier: (row) => /(dengue|الضنك)/i.test(stripTags(row)) && /\bigg\b/i.test(stripTags(row)),
            condition: !!ctx.facts?.hasDengueAcuteContext || hasAny(textContext, DENGUE_TRIGGERS),
            warning: `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يحتاج مبرر سريري (حمّى/تعرض) ويفضّل NS1 أو IgM للتشخيص الحاد. ويجب مراجعته.</span>`
        },
        {
            identifier: (row) => /referral/i.test(stripTags(row)),
            condition: !!ctx.facts?.hasReferralReason,
            warning: `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يتطلب ذكر سبب إحالة واضح. ويجب مراجعته.</span>`
        },
        {
            identifier: (row) => /(nebulizer|inhaler|استنشاق)/i.test(stripTags(row)),
            condition: !!ctx.facts?.hasRespContext || hasAny(textContext, RESP_TRIGGERS),
            warning: `<span class="status-yellow">⚠️ الطلب مُعرّض للرفض: يلزم أعراض/تشخيص تنفّسي موثق. ويجب مراجعته.</span>`
        },
        // Add more safety rules here as needed...
    ];

    for (const rule of rules) {
        out = applyRowRule(out, { rowIdentifier: rule.identifier, condition: rule.condition, warningHtml: rule.warning });
    }
    
    // Final cleanup
    out = dedupeServiceRows(out);
    out = ensureTableHeader(out);

    if (!/الخاتمة/.test(out)) {
        out += `<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>`;
    }
    return out;
}


// =============== API HANDLER ===============
export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const startedAt = Date.now();
    try {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) throw new Error("GEMINI_API_KEY missing");
        const openaiKey = process.env.OPENAI_API_KEY || null;

        const body = req.body || {};
        const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES_PER_REQUEST) : [];

        // 1. OCR (Optional)
        let ocrText = "";
        if (openaiKey && files.length) {
            try { ocrText = await ocrWithOpenAI(openaiKey, files); }
            catch (e) { console.warn("OCR skipped:", e.message); }
        }

        // 2. Prepare Gemini file parts
        const filePartsPromises = files.map(async (f) => {
            try {
                const base64 = f?.data || "";
                if (!base64) return null;
                const mime = f.type || detectMimeFromB64(base64);
                if (Buffer.from(base64, "base64").byteLength > MAX_INLINE_FILE_BYTES) {
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

        // 3. Extract structured facts (for the safety net)
        let facts = {};
        if (processedFileParts.length) {
            try { facts = await geminiExtractFacts(geminiKey, processedFileParts); }
            catch (e) { console.warn("Facts extractor failed:", e.message); }
        }

        // 4. Build the final prompt parts
        const userPrompt = buildUserPrompt(body, facts, ocrText);
        const parts = [{ text: userPrompt }, ...processedFileParts];

        // 5. Generate initial report using AI as the expert
        const htmlReportRaw = await geminiGenerate(geminiKey, parts);

        // 6. Apply hardcoded safety net and cleanup functions
        const finalHtmlReport = applySafetyNet(htmlReportRaw, { body, ocrText, facts });
        
        return res.status(200).json({
            ok: true,
            at: nowIso(),
            htmlReport: finalHtmlReport,
            meta: {
                model: GEMINI_MODEL,
                filesProcessed: processedFileParts.length,
                usedOCR: !!ocrText,
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
