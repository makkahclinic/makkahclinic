// /api/gpt.js — Unified Expert Analyzer (Gemini primary + optional OpenAI OCR)
// Runtime: Vercel / Next.js API Route (Node 18+)
//
// ENV (Vercel → Settings → Environment Variables)
// GEMINI_API_KEY = sk-...   (required)
// OPENAI_API_KEY = sk-...   (optional → enables OCR)

import { createHash } from "crypto";

// ========================= CONFIG =========================
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_FILES_PER_REQUEST = 30;
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4 MB
const OCR_MAX_PREVIEW_CHARS = 4000; // لا نرسل OCR كامل إن كان ضخمًا

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

// ========================= SIMPLE OCR PARSER (HEURISTICS) =========================
// محاولة خفيفة لاستخلاص حقول شائعة من OCR لعمل مقارنة مبكرة (قبل LLM)
function extractHeuristicsFromOCR(ocr = "") {
  const out = { age: null, gender: null, bp: null, hr: null, t: null, diagnoses: [], meds: [] };

  const ageMatch = ocr.match(/(?:العمر|Age)\s*[:：]?\s*(\d{1,3})/i);
  if (ageMatch) out.age = ageMatch[1];

  const genderMatch = ocr.match(/(?:الجنس|Gender)\s*[:：]?\s*(ذكر|أنثى|Male|Female)/i);
  if (genderMatch) out.gender = genderMatch[1];

  const bpMatch = ocr.match(/(?:ضغط|BP)\s*[:：]?\s*(\d{2,3}\s*\/\s*\d{2,3})/i);
  if (bpMatch) out.bp = bpMatch[1];

  const hrMatch = ocr.match(/(?:نبض|HR|Pulse)\s*[:：]?\s*(\d{2,3})/i);
  if (hrMatch) out.hr = hrMatch[1];

  const tMatch = ocr.match(/(?:حرارة|Temp|T)\s*[:：]?\s*(\d{2}\.\d|\d{2})/i);
  if (tMatch) out.t = tMatch[1];

  // تشخيصات شائعة مختصرة (تجريبية)
  if (/I10|HTN|Hypertension|ارتفاع ضغط/i.test(ocr)) out.diagnoses.push("HTN/I10");
  if (/E11|T2DM|Type\s*2\s*Diabetes|سكري(?:\s*نوع\s*2)?/i.test(ocr)) out.diagnoses.push("T2DM/E11");
  if (/neuropathy|اعتلال\s*أعصاب/i.test(ocr)) out.diagnoses.push("Neuropathy");

  // أدوية محتملة بالاسم
  const medsCandidates = [];
  const medList = ["Amlodipine", "Triplixam", "Perindopril", "Indapamide", "Metformin XR", "Diamicron", "Gliclazide", "Valsartan", "Co-Taburan", "Rozavi", "Rosuvastatin", "Pantoprazole", "Primperan", "Metoclopramide"];
  for (const m of medList) {
    const re = new RegExp(m.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"), "i");
    if (re.test(ocr)) medsCandidates.push(m);
  }
  out.meds = medsCandidates;

  return out;
}

// مقارنة سريعة بين بيانات النموذج اليدوية و OCR المستخرج (هيوريستك)
function compareManualVsOCR(manual = {}, ocrExtract = {}) {
  const diffs = [];
  const mAge = safeStr(manual.age);
  const mGender = safeStr(manual.gender);
  const mVitals = manual.vitals || {};
  const oAge = safeStr(ocrExtract.age);
  const oGender = safeStr(ocrExtract.gender);

  if (mAge && oAge && mAge !== oAge) diffs.push(`- اختلاف العمر: المدخل "${mAge}" vs في الملفات/OCR "${oAge}"`);
  if (mGender && oGender && mGender !== oGender) diffs.push(`- اختلاف الجنس: المدخل "${mGender}" vs في الملفات/OCR "${oGender}"`);

  const mBP = safeStr(mVitals.bp); if (mBP && ocrExtract.bp && mBP !== ocrExtract.bp) diffs.push(`- اختلاف ضغط الدم: المدخل "${mBP}" vs في الملفات/OCR "${ocrExtract.bp}"`);
  const mHR = safeStr(mVitals.hr); if (mHR && ocrExtract.hr && mHR !== ocrExtract.hr) diffs.push(`- اختلاف النبض: المدخل "${mHR}" vs في الملفات/OCR "${ocrExtract.hr}"`);
  const mT  = safeStr(mVitals.t);  if (mT  && ocrExtract.t  && mT  !== ocrExtract.t ) diffs.push(`- اختلاف الحرارة: المدخل "${mT}" vs في الملفات/OCR "${ocrExtract.t}"`);

  // إشارات عامة للتشخيصات/الأدوية
  const mProblems = new Set((manual.problems || []).map(safeStr));
  const mMeds = safeStr(manual.medications || "");
  if (ocrExtract.diagnoses?.length) {
    const notInManual = ocrExtract.diagnoses.filter(d => ![...mProblems].some(p => p.toLowerCase().includes(d.toLowerCase())));
    if (notInManual.length) diffs.push(`- تشخيصات ظهرت في الملفات ولم تُذكر يدويًا: ${notInManual.join(", ")}`);
  }
  if (ocrExtract.meds?.length) {
    for (const med of ocrExtract.meds) {
      if (!mMeds.toLowerCase().includes(med.toLowerCase())) {
        diffs.push(`- دواء ظهر في الملفات ولم يُذكر يدويًا: ${med}`);
      }
    }
  }
  return diffs;
}

// ========================= SYSTEM PROMPT =========================
const systemInstruction = `
أنت استشاري "تدقيق طبي وتأميني تشغيلي" من الطراز الرفيع. أخرج كتلة HTML واحدة فقط — بدون أي شرح خارج HTML — وباللغة العربية الفصحى، وبأسلوب مهني. 
**مصدر الحقيقة**: البيانات اليدوية المدخلة في النموذج هي المرجع الأول. أظهر أي اختلافات بينها وبين ما استُخرج من الملفات/OCR في قسم خاص، لكن بنِ الأحكام النهائية على البيانات اليدوية ما لم تكن ناقصة بشكل صريح.

[هيكل التقرير الإلزامي (UCAF 1.0)]
<style>
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; line-height: 1.8; }
  .status-green { display:inline-block;background:#d4edda;color:#155724;padding:3px 10px;border-radius:14px;border:1px solid #c3e6cb;font-weight:600 }
  .status-yellow{ display:inline-block;background:#fff3cd;color:#856404;padding:3px 10px;border-radius:14px;border:1px solid #ffeeba;font-weight:600 }
  .status-red   { display:inline-block;background:#f8d7da;color:#721c24;padding:3px 10px;border-radius:14px;border:1px solid #f5c6cb;font-weight:600 }
  h3.section { color:#1e40af;margin:18px 0 8px;font-weight:800 }
  table { width:100%; border-collapse:collapse; margin:8px 0 14px; }
  th, td { border:1px solid #e5e7eb; padding:8px; text-align:center; vertical-align:middle; }
  thead th { background:#eef2ff; }
  .note { font-size: 12px; color:#444 }
  ul { margin: 6px 0 10px 18px; }
</style>

<h3 class="section">ملخص الحالة</h3>
<ul>
  <li><b>العمر:</b> {{AGE}} | <b>الجنس:</b> {{GENDER}} | <b>التشخيصات:</b> {{PROBLEMS}}</li>
  <li><b>الأعراض المختصرة:</b> {{NOTES}}</li>
  <li><b>العلامات الحيوية:</b> ضغط {{BP}} | نبض {{HR}} | حرارة {{TEMP}}</li>
</ul>

<h3 class="section">فروقات بين بيانات النموذج والملفات/OCR (للشفافية)</h3>
<ul>
  {{DIFFS_HTML}}
</ul>

<h3 class="section">الجدول الأول — فرز الطلبات التي نُفِّذت (طبيًا وتأمينياً)</h3>
<table>
  <thead>
    <tr><th>الإجراء</th><th>التقييم الطبي</th><th>قرار التأمين</th><th>التسبيب الطبي</th></tr>
  </thead>
  <tbody>
    {{TABLE_DONE_ROWS}}
  </tbody>
</table>
<p class="note">ملاحظة: جرى التقييم الطبي وفق المعايير الإكلينيكية العالمية الحديثة (ADA/AAO/ACG/KDIGO وغيرها).</p>

<h3 class="section">الجدول الثاني — إجراءات مبرَّرة طبيًا ومقبولة تأمينيًا لم تُنفّذ (مع التأثير المالي)</h3>
<table>
  <thead>
    <tr><th>الإجراء المقترح</th><th>المبرر الطبي</th><th>قرار التأمين</th><th>التأثير المالي</th></tr>
  </thead>
  <tbody>
    {{TABLE_MISSED_ROWS}}
  </tbody>
</table>

<h3 class="section">تفاصيل إحالة العيون (لمرضى السكري)</h3>
<ul>
  <li>فحص شامل مع توسيع الحدقة + تصوير قاع العين</li>
  <li>تصوير OCT لوذمة البقعة (إن وُجدت)</li>
  <li>قياس ضغط العين لاستبعاد الجلوكوما</li>
  <li>خطة علاجية حسب الشدة: ليزر شبكي/حقن Anti-VEGF عند اللزوم</li>
</ul>

<h3 class="section">خطة علاجية عملية وآمنة</h3>
<ul>
  <li>الأعراض الهضمية بعمر ≥60: تفضيل <b>تنظير علوي (EGD)</b> مبكر؛ يمكن PPI فموي مؤقتًا ريثما يتم التنظير.</li>
  <li>السكري مع اعتلال أعصاب: HbA1c دوري، <b>فحص عين</b> دوري، <b>فحص قدم</b> سنوي، وتقييم ألم العصبي بخيارات ملائمة.</li>
  <li>الكلى والقلب: <b>UACR + eGFR سنويًا</b>؛ الهدف ضغط <130/80 إن أمكن؛ ACEi/ARB عند ألبومين بول.</li>
  <li>الدهون: ستاتين وفق درجة الخطورة.</li>
</ul>

<h3 class="section">ملاحظات تأمينية دقيقة</h3>
<ul>
  <li>فحوص الدِّنج مقبولة فقط عند <b>حمّى + سفر/إقامة</b> بمنطقة خطورة؛ ويُفضّل NS1/PCR ± IgM حسب التوقيت.</li>
  <li>PPI وريدي لسيناريوهات النزف/تعذّر الفموي؛ الدسبسيا غير المعقدة تُدار بالفموي والتنظير حسب العمر/الإنذارات.</li>
  <li>CKD في السكري: إدراج eGFR + UACR سنويًا في ملف المتابعة.</li>
</ul>

<p class="note"><b>تنبيه خصوصية:</b> هذا التقرير لا يفصح عن أي مزوّد تقني مستخدم. جميع المخرجات تُعرض باسم النظام الطبي الخاص بكم.</p>

[قواعد التقييم المعيارية داخل الجدول الأول]
- استخدم هذه الدلالات:
  - <span class="status-green">✅ مقبول</span> — مبرَّر طبيًا ومتوافق مع المعايير.
  - <span class="status-yellow">⚠️ مراجعة</span> — يحتاج تبرير إضافي/تعديل.
  - <span class="status-red">❌ مرفوض</span> — غير مبرَّر لهذه الحالة.
- أمثلة توجيهية: 
  - HbA1c, Lipids, Creatinine/eGFR, ALT/SGPT, CBC: غالبًا مقبول.
  - UA: يفضَّل استبداله/إضافة UACR (مراجعة).
  - CRP: مراجعة (فقط عند اشتباه التهاب).
  - Nebulizer/Inhaler, Dengue IgG, Pantoprazole IV, NS IV/IV infusion, Paracetamol IV, Uric Acid بلا أعراض: غالبًا مرفوض.

[قواعد الجدول الثاني (المفقود + التأثير المالي)]
- ضَع عناصر مثل: EGD (≥60 مع عسر هضم)، UACR+eGFR سنويًا، إحالة عيون (Fundus+OCT+IOP)، فحص قدم سكري، تعليم سكري وتغذية (DSMES/MNT)، كهارل خاصة K+ عند ACEi/ARB، ليباز عند الاشتباه البنكرياس، فيتامين B12 مع استعمال Metformin طويل الأمد.
- قرار التأمين لهذه العناصر في العادة <span class="status-green">✅ مقبول</span>.
- التأثير المالي: صف بإيجاز كونه إجراء/خدمة مغطاة تزيد دخل العيادة/القسم.

[مهم]
- التزم بالمخرجات على شكل HTML واحد فقط، واملأ القوالب {{...}} بالقيم المناسبة المستنبطة.
`;

// ========================= PROMPT BUILDER =========================
function buildUserPrompt(d = {}, ocrPreview = "", diffs = []) {
  const vit = d.vitals || {};
  const diffsHtml = diffs.length ? diffs.map(x => `<li>${x}</li>`).join("") : "<li>لا توجد فروقات جوهرية ملحوظة.</li>";

  const headerFill = [
    { k: "AGE", v: safeStr(d.age) || "غير محدد" },
    { k: "GENDER", v: safeStr(d.gender) || "غير محدد" },
    { k: "PROBLEMS", v: arrStr(d.problems) || "—" },
    { k: "NOTES", v: safeStr(d.notes) || "—" },
    { k: "BP", v: safeStr(vit.bp) || "غير مسجل" },
    { k: "HR", v: safeStr(vit.hr) || "غير مسجل" },
    { k: "TEMP", v: safeStr(vit.t) || "غير مسجل" },
    { k: "DIFFS_HTML", v: diffsHtml },
  ];

  // نمرر أيضًا تلخيصًا خامًا للـ OCR ليستخدمه النموذج عند الحاجة
  const metaBlock = `
[بيانات النموذج اليدوية — مصدر الحقيقة]
العمر: ${safeStr(d.age)}
الجنس: ${safeStr(d.gender)}
العلامات الحيوية: BP=${safeStr(vit.bp)} | HR=${safeStr(vit.hr)} | T=${safeStr(vit.t)}
التشخيصات: ${arrStr(d.problems)}
الأعراض/الوصف: ${safeStr(d.notes)}
الأدوية/الإجراءات المكتوبة (إن وُجدت): ${safeStr(d.medications)}
عدد الملفات المرفوعة: ${Array.isArray(d.files) ? d.files.length : 0}

[نص OCR المختصر للاسترشاد فقط (ليس مصدر حقيقة)]
${ocrPreview || "—"}
`;

  return { headerFill, metaBlock };
}

// ========================= OpenAI OCR =========================
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
          messages: [{
            role: "user",
            content: [{ type: "image_url", image_url: { url: `data:${f.type || detectMimeFromB64(f.data)};base64,${f.data}` } }]
          }],
          temperature: 0.1, max_tokens: 2000
        })
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j?.choices?.[0]?.message?.content || "";
    } catch { return null; }
  });

  const results = await Promise.all(ocrPromises);
  return results.filter(Boolean).join("\n\n");
}

// ========================= Gemini Files & Analysis =========================
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
    // نحذف أسوار الكود لو حصل
    return (j?.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/```html|```/g, "").trim();
  } catch { return raw; }
}

// ========================= API Handler =========================
export default async function handler(req, res) {
  // CORS
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

    // (1) OCR اختياري
    let ocrTextRaw = "";
    if (openaiKey && files.length) {
      try {
        ocrTextRaw = await ocrWithOpenAI(openaiKey, files);
      } catch (e) {
        console.warn("OCR skipped:", e.message);
      }
    }
    const ocrPreview = ocrTextRaw ? ocrTextRaw.slice(0, OCR_MAX_PREVIEW_CHARS) : "";

    // (2) استخراج هيوريستك من OCR للمقارنة
    const ocrExtract = extractHeuristicsFromOCR(ocrTextRaw || "");
    const diffs = compareManualVsOCR(body, ocrExtract);

    // (3) تجهيز أجزاء الملفات لGemini (رفع/inline)
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
    const processedFileParts = (await Promise.all(fileProcessingPromises)).filter(Boolean);

    // (4) بناء الـ prompt: نحقن قيم العنوان في القالب داخل systemInstruction
    const { headerFill, metaBlock } = buildUserPrompt(body, ocrPreview, diffs);

    let filledSystemInstruction = systemInstruction;
    for (const { k, v } of headerFill) {
      filledSystemInstruction = filledSystemInstruction.replaceAll(`{{${k}}}`, v || "—");
    }

    const allParts = [{ text: filledSystemInstruction }, { text: metaBlock }];
    if (processedFileParts.length) allParts.push(...processedFileParts);

    // (5) الاستدعاء
    const html = await geminiAnalyze(geminiKey, allParts);

    // (6) لا نُظهر أي هوية مزود
    return res.status(200).json({ htmlReport: html });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "12mb" } }
};
