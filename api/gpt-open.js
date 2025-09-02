// --- START OF FINAL CORRECTED CODE ---
import fetch from 'node-fetch'; // <-- هذا هو السطر المهم الذي تم إضافته

// This configuration is for Next.js to increase the allowed request size
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

// --- Stage 1: Aggregate Clinical Data with Gemini ---
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

  const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every single piece of clinical information into a clean, comprehensive text block. CRITICAL RULES:
1. DO NOT SUMMARIZE. Transcribe everything.
2. List all patient details, diagnoses, and every single lab test, medication, and procedure mentioned.
3. For medications, transcribe the name, then on the same line, clearly state the dosage, frequency, and duration exactly as written (e.g., Amlopine 10 - 1x1x90).
4. Present the information in a clear, structured manner.`;

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

// --- MODIFIED: Stage 2: Instructions for the "Open-Ended Analyst" for GPT-4o ---
function getOpenEndedAuditorInstructions(lang = 'ar') {
  const langRule = "قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية.";
  return `You are an expert, evidence-based clinical pharmacist and medical auditor with decades of experience. Your task is to write a comprehensive, detailed, multi-paragraph narrative report based on the clinical data provided.

Primary Knowledge Base:
- Cardiology: AHA/ACC/ESC Guidelines. For patients with risk factors (Age > 50, DM, HTN), ECG and Troponin are mandatory for relevant symptoms.
- Endocrinology: ADA Standards. Annual fundus exam is mandatory for Type 2 diabetics. Diamicron MR (Gliclazide MR) is dosed once daily. Twice daily is a major dosing error.
- Reimbursement: Focus on Medical Necessity, Duplication, Contraindications, and unusual quantities.

Report Structure:
1.  **Patient Summary:** Begin with a detailed paragraph summarizing the patient's condition, diagnoses, and key clinical findings.
2.  **Overall Assessment:** Provide your expert opinion on the quality of care. Highlight correct decisions, critical omissions, and any incorrect procedures. Explain your reasoning in detail.
3.  **Detailed Analysis:** Discuss each significant medication, lab, and procedure. For each item, explain its justification (or lack thereof), potential risks, and alignment with the standard of care. If there are dosing errors or unnecessary prescriptions, explain why in detail.
4.  **Recommendations:** Conclude with a clear list of actionable recommendations, categorizing them by priority (e.g., Urgent, Best Practice).

CRITICAL RULE: Your response must be a well-written, narrative text report. DO NOT USE JSON or any structured format. Write as if you are explaining your findings to another medical professional.
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
  console.log("--- New OPEN-ENDED Request Received ---");
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

    console.log("Step 1: Starting data aggregation with Gemini...");
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
    console.log("Step 1: Gemini aggregation successful.");

    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };

    console.log("Step 2: Starting expert audit with OpenAI (Open-Ended)...");
    const openEndedAnalysis = await getAuditFromOpenAI(auditBundle, lang);
    console.log("Step 2: OpenAI audit successful.");

    // We will format the plain text into basic HTML for display
    const htmlReport = `<div style="white-space: pre-wrap; line-height: 1.7;">${openEndedAnalysis}</div>`;

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured: { analysis: openEndedAnalysis } });

  } catch (err) {
    console.error("---!!!--- An error occurred during the process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    return bad(res, 500, `An internal server error occurred. Check the server logs for details. Error: ${err.message}`);
  }
}
// --- END OF FINAL CORRECTED CODE ---

