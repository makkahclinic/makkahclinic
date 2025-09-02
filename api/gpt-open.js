// --- START OF FINAL BATCH PROCESSING CODE ---
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

// --- BATCH PROCESSING STAGE 1: Extract data from a SINGLE file/page ---
async function extractDataFromSingleFile(file) {
    const userParts = [];
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) return "";

    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file.name, mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });

    const systemPrompt = `You are an OCR expert. Transcribe all text from the single document page provided. Focus on diagnoses and medications. Format medications as: "- [Name] [Dosage] [Frequency] x [Duration]".`;
    
    const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: userParts }],
    };

    const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });

    const data = await parseJsonSafe(response);
    if (!response.ok) throw new Error(`Gemini single file error: ${JSON.stringify(data)}`);
    return `--- Visit Analysis for ${file.name} ---\n${data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || ""}`;
}


// --- BATCH PROCESSING STAGE 2: Get a final summary analysis from GPT-4o ---
async function getFinalComprehensiveAnalysis(fullExtractedText, patientInfo, lang) {
  const systemPrompt = `You are a world-class clinical auditor. You have been provided with a series of transcribed medical visits for a single patient. Your task is to synthesize ALL of this information into one final, comprehensive clinical audit report.

**Mandatory Report Structure:**
1.  **ملخص المريض (Patient Summary):** Synthesize all diagnoses from all visits to create a complete picture of the patient's health.
2.  **التقييم العام (Overall Assessment):** Comment on the patient's journey. Are there recurring issues? Is the care consistent? Are there major errors or good practices across the visits?
3.  **تحليل الزيارات الرئيسية (Key Visit Analysis):** Instead of listing all medications, highlight 3-5 of the MOST significant visits or findings. For each, explain the clinical reasoning, any errors, and the outcome.
4.  **التوصيات النهائية (Final Recommendations):** Provide a final, prioritized list of recommendations for the patient's future care.

**CRITICAL RULE:** Your entire response must be a single, well-written narrative text report in ${lang === 'ar' ? 'Arabic' : 'English'}.`;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Patient Info: ${JSON.stringify(patientInfo)}\n\nFull Transcribed History:\n${fullExtractedText}` },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI Final Analysis error: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "No final analysis was returned.";
}


// --- Main API Handler ---
export default async function handler(req, res) {
  console.log("--- New BATCH PROCESSING Request Received ---");
  try {
    if (req.method !== "POST") {
      return bad(res, 405, "Method Not Allowed.");
    }
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
      console.error("CRITICAL ERROR: API Key is missing.");
      return bad(res, 500, "Server Configuration Error: API Key is missing.");
    }

    const { files = [], patientInfo = null, lang = 'ar' } = req.body || {};
    
    // Step 1: Process each file individually to extract text
    console.log(`Starting batch processing for ${files.length} files...`);
    const allPromises = files.map(file => extractDataFromSingleFile(file));
    const extractedTexts = await Promise.all(allPromises);
    const fullExtractedText = extractedTexts.join("\n\n");
    console.log("All files processed. Full extracted text is ready.");

    // Step 2: Send the complete text to OpenAI for the final analysis
    console.log("Starting final comprehensive analysis with OpenAI...");
    const finalAnalysis = await getFinalComprehensiveAnalysis(fullExtractedText, patientInfo, lang);
    console.log("Final analysis successful.");

    const htmlReport = `<div style="white-space: pre-wrap; line-height: 1.7;">${finalAnalysis}</div>`;

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured: { analysis: finalAnalysis, extractedText: fullExtractedText } });

  } catch (err) {
    console.error("---!!!--- An error occurred during the batch process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    return bad(res, 500, `An internal server error occurred: ${err.message}`);
  }
}
// --- END OF FINAL BATCH PROCESSING CODE ---
