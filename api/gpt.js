// pages/api/gpt.js
// Final Stable Version - Correctly uses all data from the front-end.

import { createHash } from "crypto";

// --- Helper Functions (No changes needed) ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
async function fetchWithRetry(url, options, { retries = 3, timeoutMs = 180000 } = {}) {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
        if (!res.ok && retries > 0 && [429, 500, 502, 503, 504].includes(res.status)) {
            await sleep((4 - retries) * 1000);
            return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
        }
        return res;
    } catch (err) {
        if (retries > 0) {
            await sleep((4 - retries) * 1000);
            return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
        }
        throw err;
    }
}
function detectMimeFromB64(b64 = "") {
    const h = (b64 || "").slice(0, 24);
    if (h.includes("JVBERi0")) return "application/pdf";
    if (h.includes("iVBORw0")) return "image/png";
    if (h.includes("/9j/")) return "image/jpeg";
    return "application/octet-stream";
}
async function geminiUpload(apiKey, base64Data, mime) {
    const buf = Buffer.from(base64Data, "base64");
    const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`, { method: "POST", headers: { "Content-Type": mime }, body: buf });
    if (!res.ok) {
        throw new Error(`Gemini upload failed: ${await res.text()}`);
    }
    const j = await res.json();
    return j?.file?.uri;
}
// ----------------------------------------------------

// --- System Prompt (Stable & Concise) ---
const systemInstruction = `
You are an expert medical auditor. Your task is to generate a report in simple, clean HTML.
The report must have the following sections in order:
1.  \`<h4>Case Summary</h4>\` with a \`<p>\` paragraph.
2.  \`<h4>Analysis of Uploaded Files</h4>\` with a \`<p>\` paragraph.
3.  \`<h4>Deep Clinical Analysis</h4>\` with a \`<p>\` paragraph.
4.  \`<h4>Table of Medications and Procedures</h4>\` with a \`<table>\` containing the columns: "Service Item" and "Insurance Decision".
    - For each service, create one \`<tr>\` row.
    - For the insurance decision, use a \`<span>\` with the appropriate class ('status-green', 'status-yellow', 'status-red') and clearly state the reason for yellow and red cases.
5.  \`<h4>Detailed Analysis and Recommendations</h4>\` containing numbered \`<h5>\` subheadings (1. Essential Medical Services..., etc.) with a \`<p>\` for each.
    - Your analysis must be deep and evidence-based as trained.
6.  \`<h5>5. Conclusion and Final Recommendations</h5>\` with a \`<p>\` paragraph.
7.  A final paragraph with the legal disclaimer.

Stick to this simple, clean structure. Do NOT add any CSS, \`<style>\`, \`<html>\`, or \`<body>\` tags.
`;

// --- Gemini Content Generation ---
async function geminiGenerate(apiKey, parts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ role: "user", parts }],
        systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.2, topP: 0.95, maxOutputTokens: 8192 }
    };
    const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const raw = await res.text();
    if (!res.ok) {
        throw new Error(`Gemini API Error (${res.status}): ${raw}`);
    }
    const j = await res.json();
    const text = (j?.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/```(html|json)?/gi, "").trim();
    return text;
}

// --- Main API Handler ---
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) {
            throw new Error("GEMINI_API_KEY is not configured on the server.");
        }

        const body = req.body || {};
        const files = Array.isArray(body.files) ? body.files : [];

        // Prepare file parts for Gemini
        const filePartsPromises = files.map(async (f) => {
            try {
                if (!f.data) return null;
                const uri = await geminiUpload(geminiKey, f.data, f.type);
                return uri ? { fileData: { mimeType: f.type, fileUri: uri } } : null;
            } catch (e) {
                console.warn(`File processing failed for ${f.name}:`, e.message);
                return null;
            }
        });
        const processedFileParts = (await Promise.all(filePartsPromises)).filter(Boolean);

        // **CORRECTED: Build a rich user prompt with ALL data from the front-end**
        const userPrompt = `
        Please analyze the following medical case.

        **--- Patient Data ---**
        - **Age:** ${body.age || 'Not specified'}
        - **Gender:** ${body.gender || 'Not specified'}
        - **Smoker:** ${body.isSmoker ? `Yes (Pack-Years: ${body.packYears || 'N/A'})` : 'No'}
        
        **--- Clinical Notes & Details ---**
        ${body.notes || "No additional notes provided."}

        **--- Attached Files ---**
        ${files.length > 0 ? `${files.length} files are attached for your review.` : "No files were attached."}

        Please begin your detailed analysis now.
        `;
        
        const parts = [{ text: userPrompt }, ...processedFileParts];

        // Generate the report
        const htmlReport = await geminiGenerate(geminiKey, parts);

        // Send the final report
        return res.status(200).json({
            ok: true,
            at: nowIso(),
            htmlReport: htmlReport,
        });

    } catch (err) {
        console.error("--- SERVER ERROR ---", err);
        return res.status(500).json({
            ok: false,
            error: "An internal server error occurred.",
            detail: err.message,
        });
    }
}

export const config = {
    api: { bodyParser: { sizeLimit: "12mb" } },
};
