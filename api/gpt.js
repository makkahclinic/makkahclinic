// /api/gpt.js — Unified Expert Analyzer (Gemini primary + optional OpenAI OCR)
// Runtime: Vercel / Next.js API Route (Node 18+)

import { createHash } from "crypto";

// ========================= CONFIG =========================
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_FILES_PER_REQUEST = 30;
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024;
const OCR_MAX_PREVIEW_CHARS = 4000;

// ========================= CACHE =========================
const fileCache = new Map();

// ========================= UTILS =========================
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

// ========================= SIMPLE OCR PARSER =========================
function extractHeuristicsFromOCR(ocr = "") {
  const out = { age: null, gender: null, diagnoses: [], meds: [] };

  const ageMatch = ocr.match(/(?:العمر|Age)\s*[:：]?\s*(\d{1,3})/i);
  if (ageMatch) out.age = ageMatch[1];
  const genderMatch = ocr.match(/(?:الجنس|Gender)\s*[:：]?\s*(ذكر|أنثى|Male|Female)/i);
  if (genderMatch) out.gender = genderMatch[1];
  if (/سكري|Diabetes|E11/i.test(ocr)) out.diagnoses.push("Diabetes");

  return out;
}

function compareManualVsOCR(manual = {}, ocrExtract = {}) {
  const diffs = [];
  if (manual.gender && ocrExtract.gender && manual.gender !== ocrExtract.gender) {
    diffs.push(`- اختلاف الجنس: المدخل "${manual.gender}" vs OCR "${ocrExtract.gender}"`);
  }
  return diffs;
}

// ========================= SYSTEM PROMPT =========================
const systemInstruction = `
<h3>ملخص الحالة</h3>
<ul>
  <li><b>العمر:</b> {{AGE}} | <b>الجنس:</b> {{GENDER}} | <b>التشخيصات:</b> {{PROBLEMS}}</li>
  <li><b>الأعراض المختصرة:</b> {{NOTES}}</li>
</ul>
<h3>فروقات OCR</h3>
<ul>{{DIFFS_HTML}}</ul>
<h3>الجدول الأول — فرز الطلبات</h3>
<table><thead><tr><th>الإجراء</th><th>التقييم الطبي</th><th>قرار التأمين</th><th>التسبيب</th></tr></thead><tbody>{{TABLE_DONE_ROWS}}</tbody></table>
<h3>الجدول الثاني — إجراءات مبررة طبيًا ومقبولة تأمينيًا</h3>
<table><thead><tr><th>الإجراء</th><th>المبرر الطبي</th><th>قرار التأمين</th><th>الأثر المالي</th></tr></thead><tbody>{{TABLE_MISSED_ROWS}}</tbody></table>
{{EYE_SECTION}}
`;

// ========================= PROMPT BUILDER =========================
function buildUserPrompt(d = {}, ocrPreview = "", diffs = [], hasDiabetes = false) {
  const headerFill = [
    { k: "AGE", v: safeStr(d.age) || "غير محدد" },
    { k: "GENDER", v: safeStr(d.gender) || "غير محدد" },
    { k: "PROBLEMS", v: arrStr(d.problems) || "—" },
    { k: "NOTES", v: safeStr(d.notes) || "—" },
    { k: "DIFFS_HTML", v: diffs.length ? diffs.map(x => `<li>${x}</li>`).join("") : "<li>لا توجد</li>" }
  ];
  let filled = systemInstruction;
  for (const { k, v } of headerFill) filled = filled.replaceAll(`{{${k}}}`, v);

  const eyeSection = hasDiabetes ? `
  <h3>تفاصيل إحالة العيون</h3>
  <ul>
    <li>فحص شامل مع توسيع الحدقة + تصوير قاع العين</li>
    <li>تصوير OCT لوذمة البقعة</li>
    <li>قياس ضغط العين</li>
  </ul>` : "";
  filled = filled.replace("{{EYE_SECTION}}", eyeSection);

  const metaBlock = `
[بيانات النموذج اليدوية]
العمر: ${safeStr(d.age)}
الجنس: ${safeStr(d.gender)}
التشخيصات: ${arrStr(d.problems)}
[OCR مختصر]
${ocrPreview || "—"}
`;
  return { filledSystemInstruction: filled, metaBlock };
}

// ========================= OCR =========================
async function ocrWithOpenAI(openaiKey, files) {
  const IMG = new Set(["image/jpeg", "image/png", "image/webp"]);
  const eligibleFiles = files.filter(f => IMG.has(f.type || detectMimeFromB64(f.data)));
  const results = await Promise.all(eligibleFiles.map(async (f) => {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:${f.type};base64,${f.data}` } }] }],
          temperature: 0.1, max_tokens: 2000
        })
      });
      const j = await res.json();
      return j?.choices?.[0]?.message?.content || "";
    } catch { return ""; }
  }));
  return results.filter(Boolean).join("\n\n");
}

// ========================= GEMINI =========================
async function geminiUpload(apiKey, base64Data, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64Data, "base64");
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": mime }, body: buf });
  const j = await r.json();
  return j?.file?.uri;
}
async function geminiAnalyze(apiKey, allParts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = { contents: [{ role: "user", parts: allParts }] };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ========================= HANDLER =========================
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY || null;
    const body = req.body || {};
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES_PER_REQUEST) : [];

    let ocrText = "";
    if (openaiKey && files.length) ocrText = await ocrWithOpenAI(openaiKey, files);
    const ocrExtract = extractHeuristicsFromOCR(ocrText);
    const diffs = compareManualVsOCR(body, ocrExtract);
    const hasDiabetes = (body.problems || []).some(p => /سكري|diabetes/i.test(p)) || ocrExtract.diagnoses.includes("Diabetes");

    const { filledSystemInstruction, metaBlock } = buildUserPrompt(body, ocrText.slice(0, OCR_MAX_PREVIEW_CHARS), diffs, hasDiabetes);

    const allParts = [{ text: filledSystemInstruction }, { text: metaBlock }];
    for (const f of files) {
      const mimeType = f.type || detectMimeFromB64(f.data);
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
