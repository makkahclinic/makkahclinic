// --- START OF PROFESSIONAL ANALYSIS CODE V2 ---
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

// --- PROFESSIONAL EXTRACTION (STAGE 1) ---
async function extractRichDataFromSingleFile(file) {
    const userParts = [];
    if (!file.data) return `Error processing ${file.name}: No data.`;
    
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file.name, mimeType: file.mimeType, base64: file.data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });

    const systemPrompt = `You are a highly precise medical OCR and data extraction agent. From the single document page provided, you MUST extract the following details and format them exactly as specified below using Markdown.

# Visit Details for ${file.name}

**Patient Name:** [Extract Patient Name, e.g., KAMAL MANSOUR MANSI]
**Date of Visit:** [Extract Date of Visit, e.g., 19/10/2020]

**Diagnoses:**
- [List each diagnosis on a new line]

**Medications & Services:**
- [List each medication or service on a new line]

If any field is not present, write "غير متوفر". Do not add any other text.`;
    
    const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: userParts }],
    };

    const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) throw new Error(`Gemini single file error: ${JSON.stringify(data)}`);
    return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || `Error processing ${file.name}.`;
}

// --- UPGRADED PROFESSIONAL ANALYSIS (STAGE 2) ---
async function getFinalProfessionalAnalysis(fullExtractedText, patientInfo, lang) {
  const langRule = "اللغة: يجب أن يكون التقرير بالكامل باللغة العربية الفصحى والمهنية.";
  const systemPrompt = `You are a dual-role expert: a senior clinical consultant AND a shrewd medical-biller/insurance auditor. Your analysis of the provided patient history must be exceptionally deep, covering both clinical excellence and the practicalities of billing and insurance.

**Mandatory Professional Report Structure:**

**1. معلومات المريض (Patient Information):**
   - **الاسم:** [Extract and state the patient's full name]
   - **العمر عند أول زيارة:** [Calculate age based on D.O.B and first visit date if available]
   - **ملخص التشخيصات الرئيسية:** [List the most significant and recurring diagnoses]

**2. الخط الزمني السريري (Clinical Timeline):**
   - Create a clear, chronological list of all visits. For each, list the **Date**, **Diagnoses**, and **Treatments**.

**3. التحليل السريري المتعمق (In-Depth Clinical Analysis):**
   - Analyze the timeline for clinical patterns. Why are conditions recurring? Is the treatment plan evolving correctly?
   - Discuss the management of chronic conditions. Is there evidence of consistent monitoring (e.g., regular BP checks for hypertension)?

**4. تحليل إداري وتأميني (Administrative & Insurance Analysis):**
   - **This is a CRITICAL section.** Based on the treatments, what documentation is likely missing for insurance claims?
   - **Example:** "For the surgical tooth extraction on 19/10/2020, a pre-operative panoramic x-ray is standard documentation required by most insurance providers. Its absence in the record could lead to claim rejection. The clinic should ensure this is documented for future similar procedures to guarantee reimbursement."
   - Are there opportunities to improve clinic revenue through proper documentation and coding? (e.g., recommending necessary but undocumented procedures).
   - Were there any potentially unnecessary services prescribed that could be flagged by an insurer?

**5. توصيات الخبراء (Expert Recommendations):**
   - Provide a final, prioritized list of recommendations covering BOTH clinical and administrative aspects.
   - **Clinical Example:** "**عاجل:** إحالة المريض إلى أخصائي أنف وأذن وحنجرة للتحقيق في سبب التهابات البلعوم المتكررة."
   - **Administrative Example:** "**ممارسة مثلى:** توثيق جميع الإجراءات التشخيصية (مثل الأشعة) قبل الإجراءات الجراحية لضمان قبول مطالبات التأمين."

**CRITICAL RULES:**
- Your entire response must be a single, narrative text report formatted with Markdown.
- Use the patient's name throughout the report.
- Your tone must be authoritative and expert-level.
- ${lang === 'ar' ? langRule : 'Language: The entire report must be in professional English.'}`;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Full Transcribed History:\n\n${fullExtractedText}` },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI Final Analysis error: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "No final analysis was returned.";
}

// --- Main API Handler ---
export default async function handler(req, res) {
  console.log("--- New PROFESSIONAL ANALYSIS V2 Request Received ---");
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
    
    const finalAnalysis = await getFinalProfessionalAnalysis(fullExtractedText, patientInfo, lang);

    const htmlReport = `<div style="white-space: pre-wrap; line-height: 1.7;">${finalAnalysis}</div>`;

    return ok(res, { html: htmlReport, structured: { analysis: finalAnalysis, extractedText: fullExtractedText } });

  } catch (err) {
    console.error("---!!!--- An error occurred during the professional analysis process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    return bad(res, 500, `An internal server error occurred: ${err.message}`);
  }
}
// --- END OF PROFESSIONAL ANALYSIS CODE V2 ---
