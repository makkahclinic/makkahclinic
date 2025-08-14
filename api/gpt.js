// /api/gpt.js — Unified Expert Analyzer (Gemini + optional OpenAI OCR)
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

// =============== SYSTEM PROMPTS (KNOWLEDGE-BASE FINAL) ===============
const systemInstruction = `
أنت استشاري "تدقيق طبي وتشغيلي" خبير عالمي. هدفك هو الوصول لدقة 10/10. أخرج كتلة HTML واحدة فقط.

[منهجية التحليل الإلزامية]
- **قاعدة التوافق الديموغرافي المطلق:** تحقق من تطابق جنس المريض مع التشخيصات والأدوية. إذا كانت المريضة **أنثى**، فمن المستحيل أن يكون لديها تضخم البروستاتا (BPH) أو أن توصف لها أدوية مثل **Duodart**.
- **قاعدة الاستنتاج الصيدلاني:**
  - **Triplex:** إذا تم تحديده كدواء (بسبب od x90)، افترضه **Triplixam**.
  - **Form XR:** استنتج أنه **Metformin XR**.
- **قاعدة كبار السن (Geriatrics):** لأي مريض عمره > 65 عامًا، قم بالتحقق الإجباري من:
  1.  **خطر نقص السكر:** عند وجود أدوية Sulfonylurea (مثل Diamicron).
  2.  **خطر السقوط:** عند وجود دوائين أو أكثر يخفضان الضغط.
- **قاعدة أمان الأدوية المحددة:**
  - **Metformin XR:** اذكر بوضوح: "**مضاد استطباب عند eGFR < 30**".
  - **التحالف المحظور (ACEI + ARB):** الجمع بين ACEI (مثل Perindopril في Triplixam) و ARB (مثل Valsartan في Co-Taburan) هو **تعارض خطير وممنوع**.
  - **الازدواجية العلاجية الخفية:** تحقق مما إذا كانت المادة الفعالة في دواء مفرد (مثل Amlodipine) موجودة أيضًا كجزء من دواء مركب في نفس الوصفة (مثل Triplixam).

[قاعدة بيانات التوصيات - إلزامية]
- استخدم القائمة التالية **بالضبط** لتعبئة أقسام التوصيات. قم بتضمين النقطة فقط إذا كان محفزها موجودًا في الحالة.

**قائمة الخدمات الضرورية:**
1.  **اختيار نظام ضغطٍ واحد ومتابعة مخبرية:** اعتمد Triplixam أو Co-Taburan فقط (لا تجمع ACEI + ARB). بعد تثبيت النظام، اطلب كرياتينين/eGFR + بوتاسيوم بعد 1–2 أسبوع.
2.  **Metformin XR (Form XR):** الاستمرار أو البدء مشروط بتوثيق eGFR ≥30. البدء بين 30–45 غير موصى به؛ وهو مضاد استطباب إذا eGFR <30. إن لزم البدء: 500 mg مساءً مع الطعام ثم زيادة تدريجية.
3.  **كبار السن والـ Sulfonylurea (Diamicron MR):** إن استُخدمت، فبجرعات محافظة مع خطة رصد لصيقة لنقص السكر، أو فكّر ببدائل أقل إحداثًا لنقص السكر (DPP-4i / SGLT2i / GLP-1 RA).
4.  **Rosuvastatin (Rozavi 10 mg):** أجرِ ALT/AST قبل البدء، وأعد الفحص فقط عند وجود أعراض/اشتباه.
5.  **مستلزمات قياس السكر (E-core Strips / Lancets):** التزم بحدود Medicare Part B مرجعًا: حتى 300 شريط/لانست/90 يوم لمستخدمي الإنسولين، و100/90 يوم لغير المستخدمين، ويمكن صرف كميات أعلى إذا وُثِّقت ضرورة طبية.
6.  **قياس ضغط وضعي (Orthostatic BP):** يُنصح بقياس الضغط بالوضعيات بعد ضبط أدوية الضغط للحد من هبوط الضغط والسقوط لدى الكبار.

**قائمة الخدمات التي يجب تجنبها:**
A) **Duodart (تامسولوسين/دوتاستيريد):** يُرفَض ديموغرافيًا: دواء موجّه للرجال (BPH) ومضاد استطباب للنساء.
B) **تحالف محظور: ACEI + ARB:** لا تجمع Triplixam مع Co-Taburan. المخاطر: فرط بوتاسيوم/قصور كلوي/هبوط ضغط.
C) **ازدواجية Amlodipine:** إذا اعتُمد Triplixam، ألغِ Amlodipine المنفصل (الدواء مكرر داخل التركيبة).
D) **Metformin XR بجرعة بدء عالية دون eGFR:** تجنّب صرف 750 mg كجرعة بدء أو صرف طويل (×90) من دون توثيق eGFR وخطة معايرة تدريجية.
E) **Diamicron MR لدى كبار السن دون خطة أمان:** قلّل الجرعة أو اختر بديلًا أقل إحداثًا لنقص السكر، وأرفق خطة رصد.
F) **كميات SMBG غير المبرَّرة:** TID ×90 قد يتجاوز الحدود لغير مستخدمي الإنسولين؛ أرفق مبررًا طبيًا أو اضبط الكمية وفق السياسة.

[التنسيق البصري (Visual Formatting) - إلزامي]
- قم بتضمين كتلة <style> التالية في بداية تقرير الـ HTML.

[البنية]
<style>
  .status-green { display: inline-block; background-color: #d4edda; color: #155724; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #c3e6cb; }
  .status-yellow { display: inline-block; background-color: #fff3cd; color: #856404; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #ffeeba; }
  .status-red { display: inline-block; background-color: #f8d7da; color: #721c24; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #f5c6cb; }
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><h4>تحليل الملفات المرفوعة</h4><h4>التحليل السريري العميق</h4>
<h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr>
<th>الدواء/الإجراء (مع درجة الثقة)</th><th>الجرعة الموصوفة</th><th>الجرعة الصحيحة المقترحة</th><th>التصنيف</th><th>الغرض الطبي</th><th>التداخلات</th><th>درجة الخطورة (%)</th><th>قرار التأمين</th>
</tr></thead><tbody></tbody></table>
<h4>خدمات طبية ضرورية ومبرَّرة للتأمين الطبي</h4><ul></ul>
<h4>خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات</h4><ul></ul>
<h4>خطة العمل</h4><ol></ol>
<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>
`;

function buildUserPrompt(d = {}) {
  return `
**بيانات المريض:**
العمر: ${d.age ?? "غير محدد"} | الجنس: ${d.gender ?? "غير محدد"}
أمراض مُدرجة: ${Array.isArray(d.problems) ? d.problems.join(", ") : "—"}
**أدوية/إجراءات مكتوبة:** ${d.medications || "—"}
**عدد الملفات المرفوعة:** ${Array.isArray(d.files) ? d.files.length : 0}
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

// =============== API Handler ===============
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

    const html = await geminiAnalyze(geminiKey, allParts);
    
    const responsePayload = {
      htmlReport: html,
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
