// pages/api/gpt.js
// Unified Medical & Dental Assessor (Minimal, Copy-Paste Ready)
// Requires: GEMINI_API_KEY; Optional: OPENAI_API_KEY (for OCR)

const GEMINI_MODEL = "gemini-1.5-pro-latest"; // https://ai.google.dev/gemini-api/docs/models
const DEFAULT_TIMEOUT_MS = 180_000;

// ---------- small utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function abortableFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
}
function detectMimeFromB64(b64 = "") {
  const h = (b64 || "").slice(0, 24);
  if (h.includes("JVBERi0")) return "application/pdf";
  if (h.includes("iVBORw0")) return "image/png";
  if (h.includes("/9j/")) return "image/jpeg";
  if (h.includes("UklGR")) return "image/webp";
  if (h.includes("R0lGOD")) return "image/gif";
  return "application/octet-stream";
}
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4MB

// ---------- prompt (Arabic + English) ----------
function buildPrompt(caseData = {}) {
  const payload = JSON.stringify(caseData, null, 2);
  return `
SYSTEM ROLE:
You are a senior Medical & Dental consultant and insurance claims auditor. Be objective, critical, and concise. STRICTLY follow OUTPUT FORMAT.

المهمة / TASK:
- قدّم تقييماً طبياً وسنياً عميقاً للحالة المرسلة، شاملاً:
  1) ملخص الحالة الأساسي.
  2) التشخيصات مع ICD-10 إن أمكن.
  3) جدول لكل الأدوية والإجراءات (اسم، جرعة/تفاصيل، الغرض، تقييم نقدي، قرار التأمين وأسبابه، تداخلات/مخاطر، الثقة).
  4) المشكلات الحرجة.
  5) الإجراءات/الفحوصات/الإحالات التي كان يجب تنفيذها ولم تُنفّذ (Missing but Necessary Actions) مع سبب الأهمية والقيمة المتوقعة.
  6) التوصيات النهائية.
  7) تقييم الأسنان عند توفر بيانات سنية.
- استخدم عناوين ثنائية اللغة (عربي + English). كُن محدداً ومختصراً.

INPUT (JSON case data):
${payload}

STRICT OUTPUT FORMAT (must be EXACT):
1) First return ONE JSON object ONLY (no prose around it), schema:
{
  "summary": {
    "age": "string|number",
    "sex": "string",
    "key_history": ["string"],
    "chief_complaint": "string",
    "notable_symptoms": ["string"]
  },
  "diagnoses": [
    { "name": "string", "icd10": "string|null", "rationale": "string" }
  ],
  "items": [
    {
      "type": "medication|procedure|dental_procedure",
      "name": "string",
      "dose_or_details": "string",
      "purpose": "string",
      "clinical_assessment": "string",
      "insurance_decision": "Accepted|Conditional|Rejected",
      "insurance_reason": "string",
      "interactions_or_risks": ["string"],
      "confidence": "High|Moderate|Low"
    }
  ],
  "critical_issues": ["string"],
  "missing_actions": [
    { "action": "string", "why_important": "string", "expected_clinical_value": "string" }
  ],
  "recommendations": ["string"],
  "dental_assessment": {
    "present": true|false,
    "notes": "string",
    "eligibility_points": ["string"]
  }
}

2) After the JSON, output a human-readable Markdown report with bilingual section headings in this order:
- "ملخص الحالة | Case Summary"
- "التشخيصات | Diagnoses"
- "جدول الأدوية والإجراءات | Medications & Procedures Table"
- "المشكلات الحرجة | Critical Issues"
- "إجراءات/فحوصات مفقودة كان يجب القيام بها | Missing but Necessary Actions"
- "التوصيات النهائية | Final Recommendations"
- "تقييم الأسنان | Dental Assessment" (if present)

Table columns (exact): | Name | Type | Dosage/Details | Purpose | Clinical Assessment | Insurance Decision | Reason | Interactions/Risks | Confidence |

RULES:
- Accepted = واضح الضرورة الطبية ومتوافق مع التشخيص والإرشادات.
- Conditional = يحتاج توثيق/Step-therapy/تعديل جرعة/مراقبة.
- Rejected = تجميلي/غير ضروري/مكرر/غير آمن (حمل/كلية/كبد/تداخلات...).
- إذا نقصت معلومات، اذكر "Unknown" ولا تفترض بيانات.
`;
}

// ---------- OCR (optional via OpenAI Chat Completions, vision) ----------
async function runOCRWithOpenAI(openaiKey, base64Images) {
  if (!openaiKey || !base64Images?.length) return "";
  const imageParts = base64Images.map((b64) => ({
    type: "image_url",
    image_url: { url: `data:${detectMimeFromB64(b64)};base64,${b64}` },
  }));
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 1200,
        messages: [
          { role: "system", content: "Extract clean, line-by-line text for medical requests/bills/prescriptions (services, labs, meds with doses). Keep Arabic; preserve English drug names." },
          { role: "user", content: imageParts },
        ],
      }),
    });
    if (!r.ok) return "";
    const j = await r.json();
    return (j?.choices?.[0]?.message?.content || "").trim();
  } catch {
    return "";
  }
}

// ---------- Gemini: attach files (inline ≤4MB or Files API upload) ----------
async function geminiUploadFile(apiKey, base64Data, mime) {
  // Simple upload via Files API (v1beta)
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64Data, "base64");
  const res = await abortableFetch(url, { method: "POST", headers: { "Content-Type": mime }, body: buf });
  if (!res.ok) throw new Error(`Gemini file upload failed: ${res.status}`);
  const j = await res.json();
  const uri = j?.file?.uri || j?.uri;
  if (!uri) throw new Error("No file URI from Gemini Files API");
  return { file_data: { mime_type: mime, file_uri: uri } };
}

async function buildModelParts({ geminiKey, filesB64 = [], ocrText = "" }) {
  const parts = [{ text: "" }]; // placeholder; we’ll replace index 0 with the prompt later
  // attach OCR text (if any)
  if (ocrText) parts.push({ text: `# OCR Extracted Text\n${ocrText}` });

  // attach files inline (≤4MB) or via Files API (>4MB)
  for (const b64 of filesB64) {
    if (!b64) continue;
    const mime = detectMimeFromB64(b64);
    const buf = Buffer.from(b64, "base64");
    if (buf.byteLength <= MAX_INLINE_FILE_BYTES) {
      parts.push({ inline_data: { mime_type: mime, data: b64 } });
    } else {
      parts.push(await geminiUploadFile(geminiKey, b64, mime));
    }
  }
  return parts;
}

// ---------- Gemini generateContent ----------
async function geminiGenerate({ geminiKey, parts, temperature = 0.2, maxOutputTokens = 8192 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`;
  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature, maxOutputTokens },
  };
  const res = await abortableFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${raw.slice(0, 400)}`);
  try {
    const j = JSON.parse(raw);
    const text = (j?.candidates?.[0]?.content?.parts || [])
      .map((p) => p?.text || "")
      .filter(Boolean)
      .join("\n");
    return text;
  } catch {
    return raw;
  }
}

// ---------- extract first JSON then Markdown ----------
function splitJsonAndMarkdown(s = "") {
  // capture the first top-level JSON object
  const m = s.match(/\{[\s\S]*?\}\s*(?=\n|$)/);
  let jsonBlock = null;
  let markdownBlock = s;
  if (m) {
    try { jsonBlock = JSON.parse(m[0]); } catch { jsonBlock = null; }
    markdownBlock = s.slice(m.index + m[0].length).trim();
  }
  return { jsonBlock, markdownBlock };
}

// ---------- API handler ----------
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.status(400).json({ ok: false, error: "GEMINI_API_KEY missing" });
    const openaiKey = process.env.OPENAI_API_KEY || null;

    // Accept JSON body: { caseData: {...}, files: [base64,...] }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const caseData = body.caseData || {};
    const files = Array.isArray(body.files) ? body.files : [];

    // Optional OCR over images only
    const imageB64s = files.filter((b64) => {
      const mt = detectMimeFromB64(b64);
      return mt.startsWith("image/");
    });
    const ocrText = await runOCRWithOpenAI(openaiKey, imageB64s);

    // Build model parts (prompt + files + OCR)
    const parts = await buildModelParts({ geminiKey, filesB64: files, ocrText });
    parts[0] = { text: buildPrompt(caseData) }; // set prompt at index 0

    // Call Gemini
    const modelText = await geminiGenerate({ geminiKey, parts });

    // Split outputs
    const { jsonBlock, markdownBlock } = splitJsonAndMarkdown(modelText);

    return res.status(200).json({
      ok: true,
      model: GEMINI_MODEL,
      jsonBlock,        // machine-readable
      markdownBlock,    // human-readable
      usedOCR: Boolean(ocrText),
    });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Internal error" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };
