// --- START OF FINAL CONSULTATION CODE ---
import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};

// --- Main Settings ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// --- Helper Functions ---
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) { return response.json(); }
  return { raw: await response.text() };
};

// --- Gemini File Uploader ---
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64.split(',')[1], "base64");
  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(binaryData.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType, "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
  });
  if (!initRes.ok) throw new Error(`Gemini init failed: ${JSON.stringify(await parseJsonSafe(initRes))}`);
  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload session URL is missing");
  const uploadRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType, "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0", "Content-Length": String(binaryData.byteLength) },
    body: binaryData,
  });
  const metadata = await parseJsonSafe(uploadRes);
  if (!uploadRes.ok) throw new Error(`Gemini finalize failed: ${JSON.stringify(metadata)}`);
  return { uri: metadata?.file?.uri, mime: metadata?.file?.mime_type || mimeType };
}

// --- FINAL EXTRACTION (STAGE 1) ---
async function extractRichDataFromSingleFile(file) {
    const userParts = [];
    if (!file.data) return `Error processing ${file.name}: No data.`;
    
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file.name, mimeType: file.mimeType, base64: file.data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });

    const systemPrompt = `You are a meticulous medical data extractor. From the single document provided, extract the following information and format it exactly as a Markdown block.

### Visit Card: ${file.name}
- **Patient Name:** [Extract Full Name, e.g., KAMAL MANSOUR MANSI]
- **Date of Visit:** [Extract Date, e.g., 19/10/2020]
- **Diagnoses:**
    - [List each diagnosis on a new line]
- **Medications & Services:**
    - [List each item on a new line]

If a field is missing, write "غير متوفر".`;
    
    const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: userParts }],
    };

    const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) throw new Error(`Gemini extraction error: ${JSON.stringify(data)}`);
    return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || `Error processing ${file.name}.`;
}

// --- FINAL ANALYSIS (STAGE 2) ---
async function getFinalConsultationReport(fullExtractedText, patientInfo, lang) {
  const langRule = "اللغة: يجب أن يكون التقرير بالكامل باللغة العربية الفصحى والمهنية.";
  const systemPrompt = `You are a senior clinical consultant with a secondary expertise in medical billing and insurance auditing. You are reviewing a patient's full medical history, provided as a series of "Visit Cards". Your task is to synthesize this information into a single, high-level, professional consultation report that provides deep insights for both clinical and administrative teams.

**Mandatory Report Structure (Follow this precisely):**

**1. ملخص شامل للحالة (Comprehensive Case Summary):**
   - **الاسم:** [Extract the patient's full name]
   - **العمر (عند أول زيارة موثقة):** [State age if available]
   - **الأمراض الرئيسية والمتكررة:** [Synthesize all diagnoses into a clear list of the patient's main health issues, noting which are chronic or recurrent]

**2. التحليل الزمني والأنماط السريرية (Timeline and Clinical Pattern Analysis):**
   - Provide a brief chronological summary of key visits.
   - **Crucially, analyze the patterns.** Don't just list facts. Connect the dots.
   - *Example:* "نلاحظ نمطًا واضحًا من التهابات الجهاز التنفسي العلوي المتكررة (5 زيارات خلال عام 2025)، والتي غالبًا ما تعالج بمضادات حيوية واسعة الطيف. هذا التكرار قد يشير إلى حساسية كامنة أو مقاومة بكتيرية، ويتطلب تحقيقًا أعمق بدلاً من العلاج العرضي المتكرر."
   - Comment on the management of chronic conditions like hypertension. Is there a clear, consistent treatment plan?

**3. تحليل فرص تحسين الدخل وتقليل الرفض (Analysis for Revenue Optimization & Rejection Reduction):**
   - **This is the most critical section.** Based on the extracted data, identify specific, actionable opportunities for the clinic.
   - **توثيق ناقص (Missing Documentation):** What standard documentation is missing that is required for insurance claims?
     - *Example:* "في زيارة خلع الضرس بتاريخ 19/10/2020، عدم وجود أشعة بانورامية (OPG) قبل الجراحة يمثل خطر رفض عالٍ للمطالبة. توصية: يجب جعل الأشعة إجراءً قياسيًا قبل جميع عمليات الخلع الجراحي."
   - **خدمات مقترحة (Suggested Services):** What additional, medically necessary tests or services could have been performed and billed for?
     - *Example:* "نظرًا لتكرار المغص الكلوي، كان من الممكن إجراء فحص بالموجات فوق الصوتية (KUB Ultrasound) وتبرير تكلفته بسهولة، مما يزيد من دقة التشخيص ودخل الزيارة."
   - **أخطاء الترميز (Coding Errors):** Point out any services with "WRONG CODE" mentioned in the extraction.

**4. توصيات استشارية نهائية (Final Consultant Recommendations):**
   - Provide a prioritized list of recommendations.
   - **للفريق الطبي (For the Clinical Team):** e.g., "إحالة المريض إلى أخصائي حساسية..."
   - **للفريق الإداري (For the Admin/Billing Team):** e.g., "تطبيق بروتوكول توثيق إلزامي للأشعة قبل الإجراءات الجراحية..."

**CRITICAL RULES:**
- Your response must be a single, professional report in Markdown.
- Your analysis must be insightful, connecting different visits to form a coherent narrative.
- ${lang === 'ar' ? langRule : 'Language: The entire report must be in professional English.'}`;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Patient History (Series of Visit Cards):\n\n${fullExtractedText}` },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI Final Consultation error: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "No final consultation was returned.";
}

// --- Main API Handler ---
export default async function handler(req, res) {
  console.log("--- New FINAL CONSULTATION Request Received ---");
  try {
    if (req.method !== "POST") { return bad(res, 405, "Method Not Allowed."); }
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
      console.error("CRITICAL ERROR: API Key is missing.");
      return bad(res, 500, "Server Configuration Error.");
    }

    const { files = [], patientInfo = null, lang = 'ar' } = req.body || {};
    
    const allPromises = files.map(file => extractRichDataFromSingleFile(file));
    const extractedTexts = await Promise.all(allPromises);
    const fullExtractedText = extractedTexts.join("\n\n---\n\n");
    
    const finalAnalysis = await getFinalConsultationReport(fullExtractedText, patientInfo, lang);

    const htmlReport = `<div style="white-space: pre-wrap; line-height: 1.7;">${finalAnalysis}</div>`;

    return ok(res, { html: htmlReport, structured: { analysis: finalAnalysis, extractedText: fullExtractedText } });

  } catch (err) {
    console.error("---!!!--- An error occurred during the final consultation process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    return bad(res, 500, `An internal server error occurred: ${err.message}`);
  }
}
// --- END OF FINAL CONSULTATION CODE ---
