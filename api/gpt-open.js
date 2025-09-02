// --- START OF UPGRADED CODE ---
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
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return { raw: await response.text() };
};

// --- Gemini File Uploader ---
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, "base64");
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
    headers: {
      "Content-Type": mimeType, "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0", "Content-Length": String(binaryData.byteLength),
    },
    body: binaryData,
  });
  const metadata = await parseJsonSafe(uploadRes);
  if (!uploadRes.ok) throw new Error(`Gemini finalize failed: ${JSON.stringify(metadata)}`);
  return { uri: metadata?.file?.uri, mime: metadata?.file?.mime_type || mimeType };
}

// --- UPGRADED: Stage 1: More Accurate Data Aggregation with Gemini ---
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });

  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "unnamed_file", mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }

  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  // --- NEW IMPROVED PROMPT ---
  const systemPrompt = `You are an expert medical transcriptionist with advanced OCR capabilities for handwritten notes. Your primary job is to extract ALL clinical information from the provided text and images with extreme precision.

**CRITICAL RULES:**
1.  **Exhaustive Transcription:** Transcribe EVERYTHING. Do not summarize or omit any detail, no matter how small. Pay close attention to handwritten text which may be difficult to read.
2.  **Medication Format:** For every medication, you MUST transcribe it in the following format on a new line: \`- [Medication Name] [Dosage] [Frequency] x [Duration]\`.
    * Example: \`- Amlopine 10 1x1x90\`
    * If any part is unclear, use your best judgment or mark it as \`[unclear]\`.
3.  **Comprehensive Lists:** Create distinct lists for:
    * **Diagnoses:** (e.g., HTN, DM, DPH)
    * **Medications:** (using the format above)
    * **Labs/Tests:** (if any are mentioned)
4.  **Structure:** Present the final output as a single, clean text block. Start with diagnoses, then medications, then any other findings.`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
  };

  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
}

// --- UPGRADED: Stage 2: More Detailed Analysis Instructions for GPT-4o ---
function getOpenEndedAuditorInstructions(lang = 'ar') {
  const langRule = "قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية، مع استخدام مصطلحات طبية دقيقة.";
  return `You are a world-class clinical pharmacist and medical auditor, reviewing a case for a major insurance provider. Your analysis must be evidence-based, meticulous, and professionally formatted as a narrative report.

**Primary Knowledge Base:**
- Cardiology: AHA/ACC/ESC Guidelines.
- Endocrinology: ADA Standards.
- Drug Interactions: Check for common and critical drug-drug interactions (e.g., risk of bleeding, electrolyte imbalance).
- Standard Dosing: Diamicron MR (Gliclazide MR) is dosed ONCE daily.

**Mandatory Report Structure (Follow this exactly):**

**1. ملخص المريض (Patient Summary):**
   - Start with a concise paragraph detailing the patient's age, gender, and all listed diagnoses.

**2. التقييم العام لجودة الرعاية (Overall Assessment of Care Quality):**
   - Provide your expert opinion.
   - What was done correctly? (e.g., appropriate medication for a diagnosis).
   - What are the major and minor gaps or errors in care? (e.g., dosing errors, missing standard tests, potential contraindications).

**3. التحليل التفصيلي (Detailed Item-by-Item Analysis):**
   - Create a list for every single medication transcribed.
   - For each medication, provide a sub-analysis covering:
     - **مبرر الاستخدام (Justification):** Is it appropriate for the patient's diagnoses?
     - **الجرعة والتكرار (Dosage & Frequency):** Is the prescribed dose correct according to standards? Highlight any errors clearly.
     - **مخاطر محتملة (Potential Risks):** Mention any significant side effects or potential drug interactions with other medications on the list.

**4. الإغفالات والتوصيات (Omissions & Recommendations):**
   - Based on the diagnoses, what standard-of-care tests or treatments are missing? (e.g., Annual fundus exam for a diabetic patient).
   - Conclude with a prioritized list of actionable recommendations (e.g., Urgent, Important, Best Practice).

**CRITICAL RULE:** Your entire response must be a single, well-written narrative text report. Do not use JSON. Write with the authority and clarity of a leading medical expert.
${lang === 'ar' ? langRule : ''}`;
}

// --- MODIFIED: Function to communicate with OpenAI for open-ended text ---
async function getAuditFromOpenAI(bundle, lang) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: getOpenEndedAuditorInstructions(lang) },
        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "No analysis was returned.";
}

// --- Main API Handler ---
export default async function handler(req, res) {
  console.log("--- New UPGRADED Request Received ---");
  try {
    if (req.method !== "POST") {
      return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    }
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
      console.error("CRITICAL ERROR: API Key is missing.");
      return bad(res, 500, "Server Configuration Error: API Key is missing.");
    }

    const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body || {};
    console.log(`Processing request with language: ${lang}`);

    console.log("Step 1: Starting ACCURATE data aggregation with Gemini...");
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
    console.log("Step 1: Gemini aggregation successful. Text extracted:\n", aggregatedClinicalText);

    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };

    console.log("Step 2: Starting DEEP expert audit with OpenAI...");
    const openEndedAnalysis = await getAuditFromOpenAI(auditBundle, lang);
    console.log("Step 2: OpenAI audit successful.");

    const htmlReport = `<div style="white-space: pre-wrap; line-height: 1.7;">${openEndedAnalysis}</div>`;

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured: { analysis: openEndedAnalysis, extractedText: aggregatedClinicalText } });

  } catch (err) {
    console.error("---!!!--- An error occurred during the process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    return bad(res, 500, `An internal server error occurred. Check the server logs for details. Error: ${err.message}`);
  }
}
// --- END OF UPGRADED CODE ---

