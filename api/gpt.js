// /api/gpt.js — Dynamic Medical Report (UCAF 1.0) with Conditional Sections
// Runtime: Vercel / Next.js API Route (Node 18+)

import { createHash } from "crypto";

const GEMINI_MODEL = "gemini-1.5-pro-latest";
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_FILES_PER_REQUEST = 30;
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024;

const fileCache = new Map();

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchWithRetry(url, options, { retries = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: c.signal });
    if (!r.ok && retries > 0 && RETRY_STATUS.has(r.status)) {
      await sleep((4 - retries) * 1000);
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return r;
  } finally {
    clearTimeout(t);
  }
}

function detectMimeFromB64(b64 = "") {
  const h = (b64 || "").slice(0, 32);
  if (h.includes("JVBERi0")) return "application/pdf";
  if (h.includes("iVBORw0")) return "image/png";
  if (h.includes("/9j/")) return "image/jpeg";
  if (h.includes("UklGR")) return "image/webp";
  return "image/jpeg";
}
function getFileHash(base64Data = "") {
  return createHash("sha256").update(base64Data).digest("hex");
}

function safeStr(x) { return (x ?? "").toString().trim(); }
function arrStr(a) { return Array.isArray(a) ? a.join(", ") : (a || "—"); }

// ======= Simple OCR Heuristics =======
function extractHeuristicsFromOCR(ocr = "") {
  const out = { diagnoses: [], meds: [] };

  if (/سكري|Diabetes|E11/i.test(ocr)) out.diagnoses.push("Diabetes");
  if (/ارتفاع ضغط|Hypertension|I10/i.test(ocr)) out.diagnoses.push("Hypertension");
  if (/اعتلال أعصاب|Neuropathy/i.test(ocr)) out.diagnoses.push("Neuropathy");

  const medsList = ["Metformin", "Insulin", "HbA1c", "Triplixam", "Valsartan", "Rosuvastatin", "Pantoprazole"];
  for (const m of medsList) {
    if (new RegExp(m, "i").test(ocr)) out.meds.push(m);
  }

  return out;
}

// ======= Compare Manual vs OCR =======
function compareManualVsOCR(manual = {}, ocrExtract = {}) {
  const diffs = [];
  if (manual.gender && ocrExtract.gender && manual.gender !== ocrExtract.gender) {
    diffs.push(`اختلاف الجنس: المدخل "${manual.gender}" مقابل OCR "${ocrExtract.gender}"`);
  }
  if (ocrExtract.diagnoses?.length) {
    const notInManual = ocrExtract.diagnoses.filter(d => !(manual.problems || []).includes(d));
    if (notInManual.length) diffs.push(`تشخيصات من OCR لم تُذكر: ${notInManual.join(", ")}`);
  }
  if (ocrExtract.meds?.length) {
    const notInManualMeds = ocrExtract.meds.filter(m => !(manual.medications || "").includes(m));
    if (notInManualMeds.length) diffs.push(`أدوية من OCR لم تُذكر: ${notInManualMeds.join(", ")}`);
  }
  return diffs;
}

// ======= Build Prompt with Conditional Sections =======
function buildSystemInstruction(data, diffs, hasDiabetes) {
  let sections = `
  <h3>ملخص الحالة</h3>
  <ul>
    <li>العمر: ${safeStr(data.age) || "غير محدد"}</li>
    <li>الجنس: ${safeStr(data.gender) || "غير محدد"}</li>
    <li>التشخيصات: ${arrStr(data.problems)}</li>
    <li>الأعراض: ${safeStr(data.notes) || "—"}</li>
  </ul>
  <h3>فروقات OCR</h3>
  <ul>${diffs.map(d => `<li>${d}</li>`).join("") || "<li>لا يوجد</li>"}</ul>
  `;

  sections += `
  <h3>الجدول الأول — فرز الطلبات</h3>
  <table><thead><tr><th>الإجراء</th><th>التقييم الطبي</th><th>قرار التأمين</th><th>التسبيب</th></tr></thead><tbody>{{TABLE_DONE}}</tbody></table>
  `;

  sections += `
  <h3>الجدول الثاني — إجراءات مبررة طبيًا ومقبولة تأمينيًا</h3>
  <table><thead><tr><th>الإجراء</th><th>المبرر الطبي</th><th>قرار التأمين</th><th>الأثر المالي</th></tr></thead><tbody>{{TABLE_MISSED}}</tbody></table>
  `;

  // Add eye referral only if diabetes is present
  if (hasDiabetes) {
    sections += `
    <h3>تفاصيل إحالة العيون</h3>
    <ul>
      <li>فحص شامل مع توسيع الحدقة + تصوير قاع العين</li>
      <li>تصوير OCT لوذمة البقعة</li>
      <li>قياس ضغط العين</li>
    </ul>
    `;
  }

  return sections;
}

// ======= Gemini API =======
async function geminiUpload(apiKey, base64Data, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64Data, "base64");
  const r = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": mime }, body: buf });
  const j = await r.json();
  return j?.file?.uri;
}

async function geminiAnalyze(apiKey, allParts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = { contents: [{ role: "user", parts: allParts }], generationConfig: { maxOutputTokens: 8192 } };
  const r = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ======= API Handler =======
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY || null;
    const body = req.body || {};
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES_PER_REQUEST) : [];

    // OCR (if OpenAI key present)
    let ocrText = "";
    if (openaiKey && files.length) {
      // OCR function call here if needed
    }

    const ocrExtract = extractHeuristicsFromOCR(ocrText);
    const diffs = compareManualVsOCR(body, ocrExtract);

    const hasDiabetes = (body.problems || []).some(p => /سكري|diabetes/i.test(p)) || ocrExtract.diagnoses.includes("Diabetes");

    const systemInstruction = buildSystemInstruction(body, diffs, hasDiabetes);

    const allParts = [{ text: systemInstruction }];
    for (const f of files) {
      const mimeType = f.type || detectMimeFromB64(f.data || "");
      const hash = getFileHash(f.data || "");
      if (fileCache.has(hash)) {
        allParts.push(fileCache.get(hash));
      } else {
        const uri = await geminiUpload(geminiKey, f.data, mimeType);
        const part = { file_data: { mime_type: mimeType, file_uri: uri } };
        fileCache.set(hash, part);
        allParts.push(part);
      }
    }

    const html = await geminiAnalyze(geminiKey, allParts);
    return res.status(200).json({ htmlReport: html });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };
