// هذا الإعداد مخصص لـ Next.js لزيادة حجم الطلب المسموح به، وهو ضروري لرفع ملفات كبيرة.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb", // السماح بطلبات تصل إلى 50 ميجابايت
    },
  },
};

// --- الإعدادات الرئيسية ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// --- دوال مساعدة ---
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (response) => (response.headers.get("content-type") || "").includes("application/json") ? response.json() : { raw: await response.text() };

// --- معالج رفع الملفات إلى Gemini ---
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, "base64");
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

// --- المرحلة الأولى: تجميع البيانات السريرية باستخدام Gemini ---
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    console.log(`Uploading file to Gemini: ${file.name}`);
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "unnamed_file", mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
    console.log(`File uploaded successfully: ${file.name}`);
  }
  if (userParts.length === 0) userParts.push({ text: "لا يوجد نص أو ملفات لتحليلها." });
  const systemPrompt = `You are a meticulous medical data transcriptionist...`; // (Prompt remains the same)
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
  };
  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
}

// --- المرحلة الثانية: تعليمات المدقق الخبير لـ GPT-4o ---
function getExpertAuditorInstructions(lang = 'ar') {
    // The detailed prompt from V5 remains here...
    return `You are an expert, evidence-based clinical pharmacist and medical auditor...`;
}

// دالة للتواصل مع OpenAI والحصول على رد JSON منظم
async function getAuditFromOpenAI(bundle, lang) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: getExpertAuditorInstructions(lang) },
        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

// --- عارض التقرير المتقدم (HTML Renderer) ---
function renderHtmlReport(structuredData) {
    // The HTML rendering logic from V5 remains here...
    return `...`;
}

// --- معالج الطلبات الرئيسي (API Handler) مع تسجيل أخطاء مفصل ---
export default async function handler(req, res) {
  console.log("--- New Request Received ---");
  try {
    if (req.method !== "POST") {
      console.error("Error: Method not allowed. Received:", req.method);
      return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    }
    if (!OPENAI_API_KEY) {
        console.error("CRITICAL ERROR: OPENAI_API_KEY is missing from environment variables.");
        return bad(res, 500, "Server Configuration Error: Missing OPENAI_API_KEY");
    }
    if (!GEMINI_API_KEY) {
        console.error("CRITICAL ERROR: GEMINI_API_KEY is missing from environment variables.");
        return bad(res, 500, "Server Configuration Error: Missing GEMINI_API_KEY");
    }

    const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body || {};
    
    console.log("Step 1: Starting data aggregation with Gemini...");
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
    console.log("Step 1: Gemini aggregation successful.");
    
    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };

    console.log("Step 2: Starting expert audit with OpenAI...");
    const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);
    console.log("Step 2: OpenAI audit successful.");
    
    console.log("Step 3: Rendering HTML report...");
    const htmlReport = renderHtmlReport(structuredAudit);
    console.log("Step 3: HTML rendering successful.");

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured: structuredAudit });

  } catch (err) {
    // **هذا هو الجزء الأهم**: سيقوم بتسجيل الخطأ الحقيقي في سجلات الخادم
    console.error("---!!!--- An error occurred during the process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    console.error("---!!!--- End of Error Report ---!!!---");
    return bad(res, 500, `An internal server error occurred. Check the server logs for details. Error: ${err.message}`);
  }
}
