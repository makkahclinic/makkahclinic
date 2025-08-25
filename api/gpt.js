// pages/api/gpt.js

export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function parseJsonSafe(response) {
  const ct = response.headers.get("content-type") || "";
  return ct.includes("application/json") ? response.json() : { raw: await response.text() };
}

/** ————— Gemini: رفع ملف Base64 على جلسة Resumable ————— */
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, "base64");

  // بدء جلسة الرفع
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

  // رفع وإنهاء
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

/** ————— المرحلة 1: تجميع سريري بواسطة Gemini ————— */
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });

  // نرفع الملفات (إن وجدت) ثم نضيفها للأجزاء
  for (const f of files || []) {
    if (!f?.data) continue;
    const { uri, mime } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: f?.mimeType || "application/octet-stream",
      base64: f.data,
    });
    userParts.push({ file_data: { file_uri: uri, mime_type: mime } });
  }
  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  const systemPrompt = `
You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every single piece of clinical information into a clean, comprehensive text block.
CRITICAL RULES:
1) DO NOT SUMMARIZE — transcribe everything.
2) List all patient details, diagnoses, and every single lab, medication, and procedure.
3) For medications, transcribe name then dosage, frequency, duration exactly (e.g., "Amlodipine 10 — 1x1x90").
4) Present the information in a clear, structured manner.
`.trim();

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
  };

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);

  // نقرأ النص من الأجزاء
  const textOut = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
  return textOut;
}

/** ————— قواعد المدقق الخبير لـ GPT ————— */
function getExpertAuditorInstructions(lang = "ar") {
  const schema = {
    patientSummary: { text: "ملخص تفصيلي لحالة المريض الحالية والتشخيصات." },
    overallAssessment: { text: "رأيك الخبير الشامل حول جودة الرعاية." },
    table: [
      {
        name: "string",
        dosage_written: "string",
        itemType: "lab|medication|procedure|omission",
        status: "تم إجراؤه|مفقود ولكنه ضروري",
        analysisCategory:
          "صحيح ومبرر|إجراء مكرر|غير مبرر طبياً|إجراء يتعارض مع التشخيص|تعارض دوائي|إغفال خطير|خطأ في الجرعة أو التكرار|الكمية تحتاج لمراجعة",
        insuranceDecision: { label: "مقبول|مرفوض|لا ينطبق", justification: "string" },
      },
    ],
    recommendations: [{ priority: "عاجلة|أفضل ممارسة", description: "string", relatedItems: ["string"] }],
  };

  return `
You are an expert, evidence-based clinical pharmacist and medical auditor. Your ONLY response must be a valid JSON object.

Primary Knowledge Base:
* Cardiology: AHA/ACC/ESC Guidelines.
* Endocrinology: ADA Standards. Annual fundus exam is mandatory for Type 2 diabetics. Diamicron MR (Gliclazide MR) is dosed once daily.
* Reimbursement: Focus on Medical Necessity, Duplication, Contraindications, and unusual quantities.

Mandatory Analysis Rules:
0) List EVERY medication, lab, and procedure. For each medication, always fill "dosage_written" EXACTLY as transcribed (e.g., "10 1x1x90").
1) Flag dosing/frequency errors (e.g., Diamicron MR BID), duplicates, medical unnecessity, conflicts.
2) 90-day duration rule: if stability not documented, set analysisCategory = "الكمية تحتاج لمراجعة".
3) Add critical omissions (ECG/Troponin/Fundus Exam) with itemType="omission" and status="مفقود ولكنه ضروري".

قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة.
Your response must be ONLY the valid JSON object conforming to this exact schema:

${JSON.stringify(schema, null, 2)}
`.trim();
}

/** ————— OpenAI: الحصول على JSON من Chat Completions ————— */
async function getAuditFromOpenAI(bundle, lang) {
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: getExpertAuditorInstructions(lang) },
        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

/** ————— API Route ————— */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) return bad(res, 500, "Server configuration error: API keys are missing.");

    const { text = "", files = [], patientInfo = null, lang = "ar" } = req.body || {};

    // 1) Gemini aggregation
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });

    // 2) OpenAI expert audit
    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };
    const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);

    return ok(res, { structured: structuredAudit });
  } catch (err) {
    console.error("API /api/gpt error:", err);
    return bad(
      res,
      500,
      `An internal server error occurred. Check the server logs for details. Error: ${err.message || "unknown"}`
    );
  }
}
