// --- START OF EXPERT COMMITTEE CODE ---
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

// --- Gemini File Uploader (No changes) ---
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

// --- STAGE 1: Data Extraction (Same as before) ---
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

// --- STAGE 2A: Clinical Consultant Analysis ---
async function getClinicalAnalysis(fullExtractedText, lang) {
    const systemPrompt = `You are a Senior Clinical Physician. Your task is to analyze the provided patient history (a series of "Visit Cards") and write a **purely clinical** analysis. Focus ONLY on medical patterns, quality of care, and clinical recommendations.

**Mandatory Structure:**
1.  **ملخص التشخيصات الرئيسية:** [List the patient's main, recurring health issues.]
2.  **التحليل الزمني والأنماط السريرية:** [Provide a deep analysis of the clinical patterns. Example: "The recurrence of pharyngitis suggests a potential underlying issue..."]
3.  **توصيات طبية:** [Provide a prioritized list of purely medical recommendations.]`;

    const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Patient History:\n\n${fullExtractedText}` },
            ],
            max_tokens: 2000, // Give it more space
        }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`OpenAI Clinical Analysis error: ${JSON.stringify(data)}`);
    return data?.choices?.[0]?.message?.content || "No clinical analysis was returned.";
}

// --- STAGE 2B: Insurance Auditor Analysis ---
async function getInsuranceAnalysis(fullExtractedText, lang) {
    const systemPrompt = `You are a sharp Insurance Auditor and Medical Biller. Your task is to analyze the provided patient history (a series of "Visit Cards") and write a **purely administrative and financial** analysis. Focus ONLY on documentation gaps, missed revenue, and billing errors.

**Mandatory Structure:**
1.  **توثيق ناقص ذو أثر مالي:** [Identify missing documentation required for claims. Example: "The absence of a panoramic x-ray for the surgical extraction..."]
2.  **فرص الدخل المهدرة:** [Identify medically justifiable services that could have been billed.]
3.  **أخطاء الترميز:** [List all medications or services marked with "WRONG CODE".]
4.  **توصيات إدارية:** [Provide a prioritized list of recommendations for the billing team.]`;

    const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Patient History:\n\n${fullExtractedText}` },
            ],
            max_tokens: 2000, // Give it more space
        }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`OpenAI Insurance Analysis error: ${JSON.stringify(data)}`);
    return data?.choices?.[0]?.message?.content || "No insurance analysis was returned.";
}

// --- STAGE 3: Final CMO Synthesis ---
async function getFinalReport(clinicalAnalysis, insuranceAnalysis, patientName, lang) {
    const systemPrompt = `You are the Chief Medical Officer (CMO). You have received two reports: one from your top Clinical Physician and one from your best Insurance Auditor. Your task is to synthesize these two reports into a single, cohesive, and highly professional final report for the management team.

**Mandatory Final Report Structure:**
1.  **ملخص استشاري للحالة (Executive Case Summary):**
    - **الاسم:** ${patientName}
    - [Briefly summarize the key findings from the clinical report.]

2.  **التحليل السريري المتعمق (In-Depth Clinical Analysis):**
    - [Integrate and present the full clinical analysis here.]

3.  **التحليل الإداري والتأميني (Administrative & Insurance Analysis):**
    - [Integrate and present the full insurance analysis here.]

4.  **التوصيات النهائية المتكاملة (Final Integrated Recommendations):**
    - [Combine the recommendations from both reports into a final, prioritized list for both the clinical and administrative teams.]

Use clear Markdown formatting (headings, bold text, lists).`;

    const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `**Clinical Report:**\n${clinicalAnalysis}\n\n**Insurance Report:**\n${insuranceAnalysis}` },
            ],
            max_tokens: 4000, // Give it maximum space for the final report
        }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`OpenAI Final Synthesis error: ${JSON.stringify(data)}`);
    return data?.choices?.[0]?.message?.content || "The final report could not be generated.";
}


// --- Main API Handler ---
export default async function handler(req, res) {
  console.log("--- New EXPERT COMMITTEE Request Received ---");
  try {
    if (req.method !== "POST") { return bad(res, 405, "Method Not Allowed."); }
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
      console.error("CRITICAL ERROR: API Key is missing.");
      return bad(res, 500, "Server Configuration Error.");
    }

    const { files = [], patientInfo = null, lang = 'ar' } = req.body || {};
    
    // Stage 1: Extraction
    const allPromises = files.map(file => extractRichDataFromSingleFile(file));
    const extractedTexts = await Promise.all(allPromises);
    const fullExtractedText = extractedTexts.join("\n\n---\n\n");
    const patientNameMatch = fullExtractedText.match(/\*\*Patient Name:\*\*\s*(.*)/);
    const patientName = patientNameMatch ? patientNameMatch[1] : "غير محدد";

    // Stage 2: Parallel Analysis
    const [clinicalAnalysis, insuranceAnalysis] = await Promise.all([
        getClinicalAnalysis(fullExtractedText, lang),
        getInsuranceAnalysis(fullExtractedText, lang)
    ]);
    
    // Stage 3: Final Synthesis
    const finalReport = await getFinalReport(clinicalAnalysis, insuranceAnalysis, patientName, lang);

    const htmlReport = `<div style="white-space: pre-wrap; line-height: 1.7;">${finalReport}</div>`;

    return ok(res, { html: htmlReport, structured: { analysis: finalReport, extractedText: fullExtractedText } });

  } catch (err) {
    console.error("---!!!--- An error occurred during the expert committee process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    return bad(res, 500, `An internal server error occurred: ${err.message}`);
  }
}
// --- END OF EXPERT COMMITTEE CODE ---
