// --- START OF CHIEF MEDICAL OFFICER (CMO) LEVEL CODE ---
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
    - [List each diagnosis on a new line, include codes like J02.9 if available]
- **Medications & Services:**
    - [List each item on a new line, noting any "WRONG CODE" remarks]

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

// --- FINAL ANALYSIS (STAGE 2 - CMO LEVEL) ---
async function getFinalConsultationReport(fullExtractedText, patientInfo, lang) {
  const langRule = "اللغة: يجب أن يكون التقرير بالكامل باللغة العربية الفصحى والمهنية.";
  const systemPrompt = `You are a Chief Medical Officer (CMO) with deep expertise in clinical governance and insurance auditing. You are reviewing a patient's full medical history from a series of "Visit Cards". Your report must be a masterclass in deep, actionable analysis.

**Mandatory Report Structure (Follow this precisely):**

**1. ملخص استشاري للحالة (Executive Case Summary):**
   - **الاسم:** [Extract Patient's Name]
   - **الأمراض الرئيسية والمتكررة:** [Synthesize all diagnoses into a professional summary of the patient's main health issues.]

**2. التحليل الزمني والأنماط السريرية (Timeline and Clinical Pattern Analysis):**
   - Provide a brief chronological summary of key visits.
   - **Crucially, provide deep analysis of the patterns.** Go beyond simple observation.
   - *Example:* "نلاحظ نمطًا واضحًا من التهابات الجهاز التنفسي العلوي المتكررة (5 زيارات خلال عام 2025). العلاج المتكرر بمضادات حيوية واسعة الطيف (Cefixime, Gloclav) دون توثيق لمعايير (FeverPAIN/Centor) أو اختبار مستضد سريع (RADT) يخالف إرشادات NICE NG84 ويمثل فرصة مهدرة لـ 'حوكمة المضادات الحيوية' (antibiotic stewardship)، كما يعرض المريض لمخاطر المقاومة البكتيرية."

**3. تحليل استراتيجي للدخل والتأمين (Strategic Revenue & Insurance Analysis):**
   - **This section must be sharp and actionable.**
   - **توثيق ناقص ذو أثر مالي (High-Impact Missing Documentation):** What documentation is missing that directly leads to claim rejection? Be specific.
     - *Example:* "غياب أشعة بانورامية (OPG) قبل الخلع الجراحي في 19/10/2020 هو سبب مباشر لرفض مطالبة بقيمة 250 ريال. يجب تطبيق سياسة إلزامية للتوثيق الإشعاعي."
   - **فرص الدخل المهدرة (Missed Revenue Opportunities):** What additional, medically justifiable services could have been billed?
     - *Example:* "في زيارة المغص الكلوي (N23)، كان من الممكن إجراء فحص بول (Urinalysis) وأشعة (KUB Ultrasound)، مما يضيف حوالي 380 ريال للدخل المبرر للزيارة."
   - **أخطاء الترميز (Coding Errors):** Explicitly list the medications with "WRONG CODE" and state that this is a direct cause for rejection.

**4. توصيات تنفيذية (Actionable Recommendations):**
   - Provide a prioritized list for both clinical and admin teams.
   - **للفريق الطبي (Clinical Team):** e.g., "**إجراء عاجل:** تطبيق بروتوكول NICE NG84 لعلاج التهاب الحلق، يبدأ بالعلاج العرضي واختبار RADT قبل وصف المضادات الحيوية."
   - **للفريق الإداري (Admin/Billing Team):** e.g., "**تحسين فوري:** مراجعة وتصحيح جميع أكواد الأدوية التي تم الإبلاغ عنها كـ 'WRONG CODE' في نظام الفوترة."

**CRITICAL RULES:**
- Your response must be a single, professional report in Markdown.
- Use an authoritative, expert tone. Your language should reflect deep knowledge of both medicine and medical billing (e.g., use terms like "clinical governance", "NICE guidelines", "claim rejection").
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
  console.log("--- New CMO LEVEL Request Received ---");
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
    console.error("---!!!--- An error occurred during the CMO level analysis ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    return bad(res, 500, `An internal server error occurred: ${err.message}`);
  }
}
// --- END OF CHIEF MEDICAL OFFICER (CMO) LEVEL CODE ---

