// --- START OF EXPERT WORKSHOP (HARDENED) ---
/**
 * ملاحظات:
 * - يعتمد على fetch المدمج في Node 18+ (لا حاجة لـ node-fetch).
 * - يستخدم Structured JSON من Gemini عبر response_mime_type/response_schema.
 * - يضيف إعادة المحاولة + مهلة زمنية لطلبات OpenAI/Gemini.
 * - يتجنب تسريب PHI في الـ logs.
 */

export const config = {
  api: {
    bodyParser: { sizeLimit: "50mb" }, // انتبه لحدود Vercel (4.5MB للطلب/الاستجابة)
    // بإمكانك ضبط responseLimit عند الحاجة حسب توثيق Next.js
    // responseLimit: '3mb'
  },
};

// --------- ENV / CONSTANTS ----------
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

// --------- UTILS ----------
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function parseJsonSafe(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { return await response.json(); } catch { /* no-op */ }
  }
  return { raw: await response.text() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new Error("Timeout")), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

async function fetchWithRetry(url, init = {}, { retries = 2, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const timer = withTimeout(timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: timer.signal });
      timer.clear();
      // أعد المحاولة على حدود المعدّل وأخطاء 5xx
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        if (attempt === retries) return res; // سلّمها للمستدعي ليتعامل مع رسالة الخطأ
        const backoff = 500 * Math.pow(2, attempt); // 0.5s, 1s, 2s
        await sleep(backoff);
        continue;
      }
      return res;
    } catch (err) {
      timer.clear();
      lastErr = err;
      if (attempt === retries) throw err;
      const backoff = 500 * Math.pow(2, attempt);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// احذر من حقن HTML لو أردت عرض الـ Markdown كـ HTML
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --------- GEMINI FILE UPLOAD ----------
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const base64Payload = base64.includes(",") ? base64.split(",")[1] : base64;
  const binaryData = Buffer.from(base64Payload, "base64");

  // 1) بدء جلسة الرفع (resumable)
  const initRes = await fetchWithRetry(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
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

  if (!initRes.ok) {
    const e = await parseJsonSafe(initRes);
    throw new Error(`Gemini init failed: ${JSON.stringify(e)}`);
  }

  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload session URL is missing");

  // 2) رفع + إنهاء
  const uploadRes = await fetchWithRetry(sessionUrl, {
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

// --------- STAGE 1: Structured Extraction (Gemini JSON) ----------
/**
 * نطلب من Gemini إخراج JSON مقنّن، ثم نحوّل JSON إلى Markdown محليًا.
 */
async function extractRichDataFromSingleFile(file) {
  if (!file?.data) return `Error processing ${file?.name || "unnamed"}: No data.`;

  const { uri, mime: finalMime } = await geminiUploadBase64({
    name: file.name,
    mimeType: file.mimeType,
    base64: file.data,
  });

  const userParts = [{ file_data: { file_uri: uri, mime_type: finalMime } }];

  const systemPrompt = `
أنت مُستخرِج بيانات طبي دقيق. أرجع **فقط JSON** يطابق المخطط أدناه دون أي نص زائد.
يجب محاولة استخراج:
- الاسم الكامل للمريض
- تاريخ الزيارة (كما يظهر)
- قائمة التشخيصات (يشمل أي أكواد ICD مثل J02.9 إن وجدت)
- قائمة الأدوية والخدمات (وضع علامة لِما حُدد كـ "WRONG CODE" إن ظهر)

إذا غاب حقل، استخدم "غير متوفر".
`.trim();

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
    generation_config: {
      response_mime_type: "application/json",
      response_schema: {
        type: "object",
        properties: {
          visitCard: {
            type: "object",
            properties: {
              sourceFile: { type: "string" },
              patientName: { type: "string" },
              visitDate: { type: "string" },
              diagnoses: { type: "array", items: { type: "string" } },
              medsAndServices: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    item: { type: "string" },
                    wrongCode: { type: "boolean" },
                  },
                  required: ["item"],
                },
              },
            },
            required: ["patientName", "visitDate"],
          },
        },
        required: ["visitCard"],
      },
    },
  };

  const response = await fetchWithRetry(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini extraction error: ${JSON.stringify(data)}`);

  // حاول قراءة JSON من النص المعاد
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n");
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // فشل تحليل JSON: أعد نصًا خطيًا كملاذ أخير
    return `### Visit Card: ${file.name}\n- **Patient Name:** غير متوفر\n- **Date of Visit:** غير متوفر\n- **Diagnoses:**\n    - غير متوفر\n- **Medications & Services:**\n    - غير متوفر`;
  }

  const vc = parsed?.visitCard || {};
  vc.sourceFile = file.name;

  // تحويل JSON إلى Markdown المطلوب
  const diagLines =
    (vc.diagnoses && vc.diagnoses.length
      ? vc.diagnoses.map((d) => `    - ${d}`).join("\n")
      : "    - غير متوفر");

  const medLines =
    (vc.medsAndServices && vc.medsAndServices.length
      ? vc.medsAndServices
          .map((m) => `    - ${m.item}${m.wrongCode ? " (WRONG CODE)" : ""}`)
          .join("\n")
      : "    - غير متوفر");

  const md = [
    `### Visit Card: ${escapeHtml(vc.sourceFile || file.name)}`,
    `- **Patient Name:** ${vc.patientName || "غير متوفر"}`,
    `- **Date of Visit:** ${vc.visitDate || "غير متوفر"}`,
    `- **Diagnoses:**`,
    diagLines,
    `- **Medications & Services:**`,
    medLines,
  ].join("\n");

  return md;
}

// --------- STAGE 2A: Clinical Consultant Analysis (OpenAI) ----------
async function getClinicalAnalysis(fullExtractedText) {
  const systemPrompt = `
You are a Senior Clinical Physician. Analyze the provided patient history (a series of "Visit Cards") and write a **purely clinical** analysis focusing on patterns, care quality, and prioritized recommendations.
**IMPORTANT:** After each clinical recommendation or assertion, add a short citation with a reputable link (e.g., NICE, IDSA, AAO, ADA).
`.trim();

  const response = await fetchWithRetry(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Patient History:\n\n${fullExtractedText}` },
      ],
      max_tokens: 2000,
      temperature: 0.2,
    }),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`OpenAI Clinical Analysis error: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "No clinical analysis.";
}

// --------- STAGE 2B: Insurance Auditor Analysis (OpenAI) ----------
async function getInsuranceAnalysis(fullExtractedText) {
  const systemPrompt = `
You are a ruthless Insurance Auditor and Medical Biller. Identify documentation gaps, missed revenue, coding errors, and give prioritized admin recommendations.
**IMPORTANT:** Include guideline or payer-policy citations (when relevant) with reputable links.
`.trim();

  const response = await fetchWithRetry(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Patient History:\n\n${fullExtractedText}` },
      ],
      max_tokens: 2000,
      temperature: 0.2,
    }),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`OpenAI Insurance Analysis error: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "No insurance analysis.";
}

// --------- STAGE 3: Final CMO Synthesis (Arabic by default) ----------
async function getFinalReport(clinicalAnalysis, insuranceAnalysis, patientName, lang = "ar") {
  const langBlock =
    lang === "ar"
      ? {
          rule: "**CRITICAL RULE:** Your entire response must be in Arabic.",
          headings: {
            h1: "ملخص استشاري للحالة (Executive Case Summary)",
            h2: "التحليل السريري المتعمق (In-Depth Clinical Analysis)",
            h3: "التحليل الإداري والتأميني (Administrative & Insurance Analysis)",
            h4: "التوصيات النهائية المتكاملة (Final Integrated Recommendations)",
          },
        }
      : {
          rule: "**CRITICAL RULE:** Your entire response must be in English.",
          headings: {
            h1: "Executive Case Summary",
            h2: "In-Depth Clinical Analysis",
            h3: "Administrative & Insurance Analysis",
            h4: "Final Integrated Recommendations",
          },
        };

  const systemPrompt = `
You are the Chief Medical Officer (CMO). You received two reports: clinician and insurance auditor. Synthesize them into one cohesive, professional Markdown report.
${langBlock.rule}

**Mandatory Structure:**
1.  **${langBlock.headings.h1}:**
    - **الاسم/Name:** ${patientName}
    - Opening paragraph summarizing the most critical clinical + admin findings.

2.  **${langBlock.headings.h2}:**
    - Integrate, rephrase, and present the full clinical analysis.

3.  **${langBlock.headings.h3}:**
    - Integrate, rephrase, and present the full insurance analysis.

4.  **${langBlock.headings.h4}:**
    - Prioritized list for both the **الفريق الطبي / Medical Team** and **الفريق الإداري / Admin Team**.
`.trim();

  const response = await fetchWithRetry(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `**CLINICAL REPORT DRAFT:**\n${clinicalAnalysis}\n\n**INSURANCE REPORT DRAFT:**\n${insuranceAnalysis}`,
        },
      ],
      max_tokens: 4000,
      temperature: 0.2,
    }),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`OpenAI Final Synthesis error: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "The final report could not be generated.";
}

// --------- MAIN HANDLER ----------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed.");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) return bad(res, 500, "Server Configuration Error.");

    const { files = [], lang = "ar" } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) return bad(res, 400, "No files provided.");

    // Stage 1: Extract from all files (parallel)
    const extractedTexts = await Promise.all(files.map((file) => extractRichDataFromSingleFile(file)));
    const fullExtractedText = extractedTexts.join("\n\n---\n\n");

    // استخرج اسم المريض بطريقة أكثر موثوقية من أول بطاقة تحتوي الاسم
    let patientName = "غير محدد";
    for (const md of extractedTexts) {
      const match = md.match(/\*\*Patient Name:\*\*\s*(.+)\s*$/m);
      if (match?.[1]) {
        patientName = match[1].trim();
        break;
      }
    }

    // Stage 2: Analyses (parallel)
    const [clinicalAnalysis, insuranceAnalysis] = await Promise.all([
      getClinicalAnalysis(fullExtractedText),
      getInsuranceAnalysis(fullExtractedText),
    ]);

    // Stage 3: Final report (lang-aware)
    const finalReport = await getFinalReport(clinicalAnalysis, insuranceAnalysis, patientName, lang);
    const htmlReport = `<div style="white-space: pre-wrap; line-height: 1.7;">${escapeHtml(finalReport)}</div>`;

    // التعامل الحذر مع حدود الحجم (تحذير مبكّر/تقصير)
    const approxSizeBytes = Buffer.byteLength(htmlReport, "utf-8");
    let payload = { html: htmlReport, structured: { analysis: finalReport, extractedText: fullExtractedText } };

    // لو تجاوزنا ~3.8MB نُخفّف الحمولة (تجنب 4MB Next.js و4.5MB Vercel)
    if (approxSizeBytes > 3.8 * 1024 * 1024) {
      payload = {
        structured: {
          analysis: finalReport.slice(0, 750000) + "\n\n[...truncated due to size...]",
          extractedText: fullExtractedText.slice(0, 500000) + "\n\n[...truncated due to size...]",
        },
        note: "تم تقصير الاستجابة لتفادي حدود الحجم. ننصح بحفظ التقرير كملف في التخزين ثم تقديم رابط تنزيل.",
      };
    }

    return ok(res, payload);
  } catch (err) {
    // مهم: لا تطبع نصوص طبية أو ملفات خام في السجلات
    console.error("Expert Workshop Error:", err?.message);
    return bad(res, 500, `An internal server error occurred: ${err?.message}`);
  }
}
// --- END OF EXPERT WORKSHOP (HARDENED) ---
