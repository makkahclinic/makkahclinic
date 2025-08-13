// /api/gpt.js — Hybrid Rules Engine Doctor Analyzer
// Runtime: Vercel / Next.js API Route (Node 18+)

// ========================= ENV (Vercel → Settings → Environment Variables) =========================
// GEMINI_API_KEY = sk-...   (required)
// OPENAI_API_KEY = sk-...   (optional → enables OCR)
// ==================================================================================================

import { createHash } from "crypto";

// =============== CONFIG ===============
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_FILES_PER_REQUEST = 30;
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

// =============== CACHE ===============
const fileCache = new Map();

// =============== UTILS ===============
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
  const h = (b64 || "").slice(0, 16);
  if (h.includes("JVBERi0")) return "application/pdf";
  if (h.includes("iVBORw0")) return "image/png";
  if (h.includes("/9j/")) return "image/jpeg";
  if (h.includes("UklGR")) return "image/webp";
  return "image/jpeg";
}
function getFileHash(base64Data) {
  return createHash("sha256").update(base64Data).digest("hex");
}

// =============== SYSTEM PROMPT FOR GEMINI (Narrative Only) ===============
const systemInstruction = `
أنت استشاري "تدقيق طبي وتشغيلي" خبير. مهمتك هي كتابة الأجزاء السردية من التقرير (الملخص، تحليل الملفات، التحليل السريري العميق، وجدول الأدوية) بأسلوب احترافي وموجز. سيتم تزويدك بالقرارات والقواعد المحددة مسبقًا من محرك قواعد خارجي، فلا تكررها. ركز على تقديم رؤى إضافية وسياق للحالة.
`;

// =============== User Prompt Pack ===============
function buildUserPrompt(d = {}) {
  return `
**بيانات المريض:**
العمر: ${d.age ?? "غير محدد"} | الجنس: ${d.gender ?? "غير محدد"}
هل المريض مدخن؟: ${d.isSmoker ? 'نعم' : 'لا'}
وصف الحالة: ${d.notes || "—"}
**أدوية/إجراءات مكتوبة:** ${d.medications || ""}
`;
}

// =============== OpenAI OCR ===============
async function ocrWithOpenAI(openaiKey, files) {
  const IMG = new Set(["image/jpeg", "image/png", "image/webp"]);
  const eligibleFiles = files.filter((f) => IMG.has(f.type || detectMimeFromB64(f.data)));

  const ocrPromises = eligibleFiles.map(async (f) => {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:${f.type || detectMimeFromB64(f.data)};base64,${f.data}` } }] }],
          temperature: 0.1, max_tokens: 2000
        })
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j?.choices?.[0]?.message?.content || "";
    } catch (e) { return null; }
  });

  const results = await Promise.all(ocrPromises);
  return results.filter(Boolean).join("\n\n");
}


// =============== Gemini Files & Analysis ===============
async function geminiUpload(apiKey, base64Data, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64Data, "base64");
  const r = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": mime }, body: buf });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Gemini file upload failed (${r.status}): ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j?.file?.uri;
}

async function geminiAnalyze(apiKey, allParts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ role: "user", parts: allParts }],
    generationConfig: { temperature: 0.2, topP: 0.9, topK: 40, maxOutputTokens: 8192 }
  };
  const r = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const raw = await r.text();
  if (!r.ok) throw new Error(`Gemini error ${r.status}: ${raw.slice(0, 500)}`);
  try {
    const j = JSON.parse(raw);
    return (j?.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/```html|```/g, "").trim();
  } catch { return raw; }
}

// =============== HYBRID RULES ENGINE ===============
function buildDecisions(caseData = {}, ocrText = "") {
  const combinedText = [caseData.medications, caseData.notes, caseData.labResults, ocrText].join("\n");
  const set = new Set();
  
  const hits = [
    ["duodart", /duodart|tamsulosin|dutasteride/i],
    ["triplixam", /triplixam|triplex/i],
    ["co_taburan", /co-?taburan|co-?diovan|valsartan/i],
    ["amlodipine", /amlodipine|amlopin/i],
    ["metformin_xr", /metformin xr|form xr/i],
    ["diamicron_mr", /diamicron|gliclazide/i],
    ["rozavi", /rozavi|rosuvastatin/i],
    ["e_core_strips", /e-?core strips?/i],
    ["lancets", /lancets?/i],
    ["bph_note", /bph|prostat/i],
  ];
  
  for (const [key, rx] of hits) {
    if (rx.test(combinedText)) set.add(key);
  }

  const isFemale = (caseData.gender || "").toLowerCase().startsWith("f") || (caseData.gender || "").includes("أنث");
  const age = Number(caseData.age || 0) || null;
  const eGFR = parseEGFR(caseData.labResults || ocrText);

  const necessary = [];
  const avoid = [];
  const labs = [];
  const actionPlan = [];

  const hasACEI = set.has("triplixam");
  const hasARB = set.has("co_taburan");

  if (isFemale && (set.has("duodart") || set.has("bph_note"))) {
    avoid.push("Duodart (تامسولوسين/دوتاستيريد): يُرفَض ديموغرافيًا: دواء موجّه للرجال (BPH) ومضاد استطباب للنساء.");
    actionPlan.push("إيقاف Duodart وتصحيح تشخيص BPH.");
  }

  if (hasACEI && hasARB) {
    avoid.push("تحالف محظور: ACEI + ARB: لا تجمع Triplixam مع Co-Taburan. المخاطر: فرط بوتاسيوم/قصور كلوي/هبوط ضغط.");
    actionPlan.push("اختيار نظام ضغط واحد فقط (إما Triplixam أو Co-Taburan) وإيقاف الآخر فورًا.");
  }

  if (hasACEI && set.has("amlodipine")) {
    avoid.push("ازدواجية Amlodipine: إذا اعتُمد Triplixam، ألغِ Amlodipine المنفصل (الدواء مكرر داخل التركيبة).");
    actionPlan.push("إيقاف Amlodipine المنفصل إذا تم الاستمرار على Triplixam.");
  }

  if (set.has("metformin_xr")) {
    necessary.push("Metformin XR (Form XR): الاستمرار أو البدء مشروط بتوثيق eGFR ≥30. البدء بين 30–45 غير موصى به. إن لزم البدء: 500 mg مساءً مع الطعام ثم زيادة تدريجية.");
    labs.push("eGFR/Creatinine قبل البدء بـ Metformin XR، ثم دوريًا.");
    labs.push("فيتامين B12 على الاستعمال الطويل للميتفورمين.");
    actionPlan.push("طلب فحص eGFR قبل صرف Metformin XR.");
  }

  if (age && age >= 65 && set.has("diamicron_mr")) {
    necessary.push("كبار السن والـ Sulfonylurea (Diamicron MR): إن استُخدمت، فبجرعات محافظة مع خطة رصد لصيقة لنقص السكر، أو فكّر ببدائل أقل إحداثًا لنقص السكر.");
  }

  if (set.has("e_core_strips") || set.has("lancets")) {
    necessary.push("مستلزمات قياس السكر (E-core Strips / Lancets): التزم بحدود التغطية التأمينية (كمية TID x90 قد تتطلب تبريرًا طبيًا).");
  }

  if(set.has("rozavi")) {
    labs.push("Rosuvastatin (Rozavi 10 mg): أجرِ ALT/AST قبل البدء، وأعد الفحص فقط عند وجود أعراض/اشتباه.");
  }
  
  if(caseData.isSmoker && /سعال|cough/i.test(caseData.notes || '')) {
      labs.push("أشعة سينية على الصدر (Chest X-ray): ضرورية بسبب السعال مع تاريخ التدخين الطويل.");
  }

  return { necessary, avoid, labs, actionPlan };
}

function renderHTML(geminiNarrative, rulesOut) {
  const { necessary = [], avoid = [], labs = [], actionPlan = [] } = rulesOut;

  const necList = necessary.map((x) => `<li>${x}</li>`).join("") || "<li>لا توجد توصيات محددة.</li>";
  const avoidList = avoid.map((x) => `<li>${x}</li>`).join("") || "<li>لا توجد تحذيرات محددة.</li>";
  const labsList = labs.map((x) => `<li>${x}</li>`).join("") || "<li>لا توجد توصيات محددة.</li>";
  const planList = actionPlan.map((x) => `<li>${x}</li>`).join("") || "<li>مراجعة الطبيب المعالج.</li>";

  const summaryMatch = geminiNarrative.match(/<h4>ملخص الحالة<\/h4>([\s\S]*?)(?=<h4>)/i);
  const tableMatch = geminiNarrative.match(/<h4>جدول الأدوية والإجراءات<\/h4>([\s\S]*?)(?=<h4>|<h4 class="section-title">)/i);
  
  const summary = summaryMatch ? summaryMatch[1] : "<p>لم يتمكن النموذج من توليد ملخص.</p>";
  const table = tableMatch ? tableMatch[1] : "<table></table>";

  return `
<style>
  .status-green { display: inline-block; background-color: #d4edda; color: #155724; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #c3e6cb; }
  .status-yellow { display: inline-block; background-color: #fff3cd; color: #856404; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #ffeeba; }
  .status-red { display: inline-block; background-color: #f8d7da; color: #721c24; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #f5c6cb; }
  .section-title { color: #1e40af; font-weight: bold; }
  .critical { color: #991b1b; font-weight: bold; }
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4>
${summary}
<h4>جدول الأدوية والإجراءات</h4>
${table}
<h4 class="section-title">خدمات طبية ضرورية ومبرَّرة للتأمين الطبي</h4>
<ul>${necList}</ul>
<h4 class="section-title">خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات</h4>
<ul>${avoidList}</ul>
<h4 class="section-title">تحاليل مبرَّرة بالتأمين</h4>
<ul>${labsList}</ul>
<h4 class="section-title">خطة العمل</h4>
<ol>${planList}</ol>
<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>
  `.trim();
}

// =============== API Handler ===============
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type", "Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error("GEMINI_API_KEY missing.");
    const openaiKey = process.env.OPENAI_API_KEY || null;

    const body = req.body || {};
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES_PER_REQUEST) : [];

    let ocrText = "";
    if (openaiKey && files.length) {
      try {
        ocrText = await ocrWithOpenAI(openaiKey, files);
      } catch (e) {
        console.warn("OCR skipped:", e.message);
      }
    }
    
    // Always run the rules engine first
    const rulesOut = buildDecisions(body, ocrText);

    const fileProcessingPromises = files.map((f) => {
      return new Promise(async (resolve) => {
        try {
          const mimeType = f.type || detectMimeFromB64(f.data || "");
          const fileBuffer = Buffer.from(f.data || "", "base64");
          const hash = getFileHash(f.data || "");

          if (fileCache.has(hash)) {
            resolve(fileCache.get(hash));
            return;
          }

          let part;
          if (fileBuffer.byteLength > MAX_INLINE_FILE_BYTES) {
            const uri = await geminiUpload(geminiKey, f.data, mimeType);
            part = { file_data: { mime_type: mimeType, file_uri: uri } };
          } else {
            part = { inline_data: { mime_type: mimeType, data: f.data } };
          }

          fileCache.set(hash, part);
          resolve(part);
        } catch (e) {
          console.warn(`File processing failed for ${f.name || "file"}:`, e.message);
          resolve(null);
        }
      });
    });

    const processedFileParts = (await Promise.all(fileProcessingPromises)).filter((p) => p);

    const allParts = [{ text: systemInstruction }, { text: buildUserPrompt(body) }];
    if (processedFileParts.length) allParts.push(...processedFileParts);
    if (ocrText) allParts.push({ text: `### OCR Extracted Texts\n${ocrText}` });

    let geminiNarrative = "";
    try {
      geminiNarrative = await geminiAnalyze(geminiKey, allParts);
    } catch (e) {
      console.warn("Gemini narrative generation failed:", e.message);
    }
    
    const finalHTML = renderHTML(geminiNarrative, rulesOut);

    const responsePayload = {
      htmlReport: finalHTML,
    };

    return res.status(200).json(responsePayload);
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "12mb" } }
};
