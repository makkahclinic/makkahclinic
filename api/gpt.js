// /pages/api/gpt.js — One-file Medical Insurance Audit API (Gemini + optional OpenAI OCR)
// Node 18+ (Next.js API Route). Copy–paste as-is.

// ====== ENV ======
// GEMINI_API_KEY = sk-...   (required)
// OPENAI_API_KEY = sk-...   (optional → OCR & ensemble)

// --------- small utils ---------
import { createHash } from "crypto";

const GEMINI_MODEL = "gemini-1.5-pro-latest";
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4 MB
const fileCache = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchWithRetry(url, options, { retries = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: c.signal });
    if (!r.ok && retries > 0 && RETRY_STATUS.has(r.status)) {
      await sleep((4 - retries) * 1000);
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return r;
  } finally { clearTimeout(t); }
}
const detectMimeFromB64 = (b64 = "") => {
  const h = (b64 || "").slice(0, 16);
  if (h.includes("JVBERi0")) return "application/pdf";
  if (h.includes("iVBORw0")) return "image/png";
  if (h.includes("/9j/"))    return "image/jpeg";
  if (h.includes("UklGR"))   return "image/webp";
  return "image/jpeg";
};
const getFileHash = (base64Data) => createHash("sha256").update(base64Data || "").digest("hex");

// --------- citations (rendered as links) ---------
const CITATIONS = {
  esc_esh_htn: { title: "ESC/ESH Hypertension Guideline", url: "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Arterial-Hypertension-Management" },
  ada_soc:     { title: "ADA Standards of Care (CKD/Older Adults)", url: "https://diabetesjournals.org/care" },
  fda_met:     { title: "FDA — Metformin & eGFR", url: "https://www.fda.gov/drugs/drug-safety-and-availability/fda-drug-safety-communication" },
  acc_aha:     { title: "AHA/ACC — Statins & baseline LFTs", url: "https://www.acc.org/latest-in-cardiology/ten-points-to-remember" },
  medicare:    { title: "Medicare — Test strips coverage", url: "https://www.medicare.gov/coverage/blood-sugar-monitors-test-strips" },
  duodart:     { title: "Duodart (tamsulosin/dutasteride) label", url: "https://www.medicines.org.uk/emc/product/2512/smpc" },
  endo_vitd:   { title: "Endocrine Society — Vitamin D", url: "https://www.endocrine.org/clinical-practice-guidelines/vitamin-d" },
};

// --------- system instruction for Gemini (Arabic HTML) ---------
const systemInstruction = `
أنت استشاري "تدقيق طبي وتشغيلي". أخرج HTML واحدًا فقط وبالهيكل التالي.
[قواعد إلزامية]
- التوافق الديموغرافي: Duodart للرجال فقط (BPH).
- Triplex=Triplixam إذا ظهر (od ×90). Form XR=Metformin XR.
- كبار السن: خطر نقص سكر مع Sulfonylurea + خطر السقوط مع أدوية الضغط.
- Metformin XR: "مضاد استطباب عند eGFR < 30".
- ACEI + ARB ممنوع (Perindopril مع Valsartan).
- ازدواجية Amlodipine: احذف المفرد إذا استُخدم Triplixam.
[قرارات التأمين — صِغها كما يلي]
- Amlodipine: "⚠️ قابل للمراجعة: يُلغى إذا استُخدم Triplixam (ازدواجية CCB)."
- Co-Taburan: "❌ مرفوض إذا وُجد Triplixam (ACEI+ARB ممنوع)."
- Triplixam: "⚠️ مشروط: يُعتمد فقط بعد إلغاء Co-Taburan وAmlodipine المنفصل."
- Metformin XR: "⚠️ موافقة مشروطة: ابدأ بعد تأكيد eGFR ≥30؛ إن لزم فابدأ 500 mg وتدرّج."
- Diamicron MR: "⚠️ موافقة بحذر: فكّر ببديل أقل إحداثًا لنقص السكر لدى كبار السن."
- Strips/Lancets: "⚠️ مقبول مع تبرير الحاجة للقياس المتكرر."
- Duodart (لأنثى): "❌ مرفوض ديموغرافيًا (دواء للرجال فقط)."
[هيكل HTML]
<style>
.status-green{display:inline-block;background:#d4edda;color:#155724;padding:4px 10px;border-radius:15px;font-weight:700;border:1px solid #c3e6cb}
.status-yellow{display:inline-block;background:#fff3cd;color:#856404;padding:4px 10px;border-radius:15px;font-weight:700;border:1px solid #ffeeba}
.status-red{display:inline-block;background:#f8d7da;color:#721c24;padding:4px 10px;border-radius:15px;font-weight:700;border:1px solid #f5c6cb}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #e5e7eb;padding:8px;text-align:right}thead th{background:#f9fafb;font-weight:700}
h3,h4{margin:10px 0 6px}
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><h4>تحليل الملفات المرفوعة</h4><h4>التحليل السيريري العميق</h4>
<h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr>
<th>الدواء/الإجراء</th><th>الجرعة</th><th>جرعة مقترحة</th><th>التصنيف</th><th>الغرض</th><th>التداخلات</th><th>الخطورة%</th><th>قرار التأمين</th>
</tr></thead><tbody></tbody></table>
<h4>خدمات طبية ضرورية ومبرَّرة للتأمين الطبي</h4><ul></ul>
<h4>خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات</h4><ul></ul>
<h4>تحاليل مبرَّرة بالتأمين</h4><ul></ul>
<h4>خطة العمل</h4><ol></ol>
<div class="refs"><h4>المراجع</h4><small></small></div>
<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>
`;

// --------- prompt builder ---------
function buildUserPrompt(d = {}) {
  return `
**بيانات المريض:** العمر: ${d.age ?? "غير محدد"} | الجنس: ${d.gender ?? "غير محدد"}
**وصف الحالة/ملاحظات:** ${d.notes || "—"}
**تحاليل/أشعة (نصي):** ${d.labResults || "—"}
**أدوية/إجراءات مكتوبة:** ${d.medications || "—"}
**عدد الملفات المرفوعة:** ${Array.isArray(d.files) ? d.files.length : 0}
`;
}

// --------- tiny rules engine (inline) ---------
const normName = (s = "") => (s || "").toLowerCase().replace(/[\W_]+/g, " ").trim();
function detectEntitiesFromText(text = "") {
  const n = normName(text);
  const found = new Set();
  const hits = [
    ["duodart", /\bduodart\b|tamsulosin|dutasteride/],
    ["triplixam", /\btriplixam\b|\btriplex\b|perindopril/],
    ["co_taburan", /co[ -]?tabu[rv]an|co[ -]?diovan|\bvalsartan\b/],
    ["amlodipine", /\bamlodipine\b|\bamlopin\b|\bamlo\b/],
    ["metformin_xr", /metformin\s*(xr|er)|form\s*xr/],
    ["diamicron_mr", /\bdiamicron\b|gliclazide/],
    ["pantomax", /pantomax|pantoprazole/],
    ["e_core_strips", /e[- ]?core.*strip|test\s*strip/],
    ["lancets", /\blancet\b|\blancets\b/],
    ["intrasite", /intrasite|intrasitab/],
    ["rozavi", /rozavi|rosuvastatin/],
    ["bph_note", /\bBPH\b|prostat/i],
  ];
  for (const [key, rx] of hits) if (rx.test(n)) found.add(key);
  return found;
}
const parseEGFR = (labs = "") => {
  const m = (labs || "").match(/eGFR\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : null;
};
function buildDecisions(caseData = {}) {
  const medsText = [caseData.medications || "", caseData.notes || "", caseData.labResults || ""].join("\n");
  const set = detectEntitiesFromText(medsText);
  const isFemale = (caseData.gender || "").toLowerCase().startsWith("f") || (caseData.gender || "").includes("أنث");
  const ageNum = Number(caseData.age || 0) || undefined;
  const eGFR = parseEGFR(caseData.labResults || "");

  const necessary = [];
  const avoid = [];
  const labs = [];

  if (isFemale && set.has("duodart")) avoid.push("إيقاف Duodart فورًا: موجّه للرجال فقط (BPH). [Duodart]");
  const hasACEI = set.has("triplixam");
  const hasARB = set.has("co_taburan");
  if (hasACEI && hasARB) avoid.push("منع الجمع ACEI+ARB (Triplixam + Co-Taburan): خطر فرط بوتاسيوم/قصور كلوي/هبوط ضغط. [ESC/ESH]");
  if (hasACEI && set.has("amlodipine")) avoid.push("إزالة Amlodipine المفرد إذا استُخدم Triplixam (ازدواجية CCB).");

  if (set.has("metformin_xr")) {
    if (eGFR !== null && eGFR < 30) {
      avoid.push("Metformin XR مضاد استطباب عند eGFR < 30. [ADA/FDA]");
    } else {
      necessary.push("توثيق eGFR ≥30 قبل/أثناء Metformin XR، ويفضل البدء 500 mg مساءً ثم التدرّج. [ADA/FDA]");
      labs.push("Creatinine/eGFR قبل البدء ثم دوريًا.");
      labs.push("Vitamin B12 إذا استعمال طويل أو أعراض عصبية. [ADA]");
    }
  }
  if (ageNum && ageNum >= 65 && set.has("diamicron_mr")) {
    avoid.push("Diamicron MR لدى كبار السن: خطر نقص سكر—فكّر ببديل أقل خطورة أو خفض الجرعة مع خطة رصد لصيقة. [ADA]");
  }
  if (set.has("e_core_strips") || set.has("lancets")) {
    necessary.push("شرائط/لانست SMBG: الالتزام بحدود الدافع (مثال Medicare: 300/90 يوم مع الإنسولين و100/90 يوم بدون) أو إرفاق مبرر طبي للتجاوز. [Medicare]");
  }
  if (hasACEI || hasARB || set.has("amlodipine")) {
    labs.push("ضغط وضعي (استلقاء/وقوف) بعد تعديل أدوية الضغط لتقليل السقوط. [ESC/ESH]");
  }
  if (set.has("rozavi")) labs.push("ALT/AST أساسًا قبل الستاتين وتكرر فقط عند وجود أعراض. [AHA/ACC]");
  if (/هشاشة|osteoporosis|fragility/i.test(medsText)) labs.push("Vitamin D (25-OH) عند هشاشة/عوامل خطورة عظمية. [Endocrine Society]");

  return { set, necessary, avoid, labs };
}

// --------- OpenAI (optional) ---------
async function ocrWithOpenAI(openaiKey, files = []) {
  const IMG = new Set(["image/jpeg", "image/png", "image/webp"]);
  const eligible = files.filter((f) => IMG.has(f.type || detectMimeFromB64(f.data)));
  const tasks = eligible.map(async (f) => {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.1,
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "استخرج نصًا منظّمًا من هذه الصورة (عربي/إنجليزي). للروشتات/التقارير: حول الجداول إلى {test,value,unit,ref_low,ref_high} بدون تفسير." },
              { type: "image_url", image_url: { url: `data:${f.type || detectMimeFromB64(f.data)};base64,${f.data}` } }
            ]
          }]
        })
      });
      if (!res.ok) return null;
      const j = await res.json();
      const text = j?.choices?.[0]?.message?.content || "";
      return text ? { filename: f.name, text } : null;
    } catch { return null; }
  });
  const results = await Promise.all(tasks);
  return results.filter(Boolean);
}
async function analyzeWithOpenAI(openaiKey, caseData, ocrTextJoined) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 3000,
      messages: [
        { role: "system", content: "أنت استشاري باطني. أخرج JSON فقط بالمفاتيح: {summary, finds, meds, risks, plan}." },
        { role: "user", content: `حلّل الحالة:\n${buildUserPrompt(caseData)}\nنصوص OCR:\n${ocrTextJoined || "—"}\nأعد JSON فقط.` }
      ]
    })
  });
  if (!res.ok) return null;
  const j = await res.json();
  try { return JSON.parse(j?.choices?.[0]?.message?.content || "{}"); } catch { return null; }
}

// --------- Gemini ---------
async function geminiUpload(apiKey, base64Data, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64Data || "", "base64");
  const r = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": mime }, body: buf });
  if (!r.ok) throw new Error(`Gemini upload failed: ${await r.text().catch(()=> "")}`);
  const j = await r.json();
  return j?.file?.uri;
}
async function geminiAnalyze(apiKey, allParts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = { contents: [{ role: "user", parts: allParts }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192 } };
  const r = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const raw = await r.text();
  if (!r.ok) throw new Error(`Gemini error ${r.status}: ${raw.slice(0,400)}`);
  try {
    const j = JSON.parse(raw);
    const t = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return (t || "").replace(/```html|```/g, "").trim();
  } catch { return raw; }
}

// --------- HTML helpers ---------
const escapeHtml = (s = "") => s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const buildRefsHTML = () => Object.values(CITATIONS).map(c => `<div>• <a href="${c.url}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a></div>`).join("");

function renderDeterministicHTML(caseData, rulesOut) {
  const { necessary = [], avoid = [], labs = [] } = rulesOut || {};
  const found = detectEntitiesFromText(`${caseData.medications || ""}\n${caseData.notes || ""}`);
  const badge = (txt, kind) => {
    const cls = kind === "red" ? "status-red" : kind === "yellow" ? "status-yellow" : "status-green";
    return `<span class="${cls}">${escapeHtml(txt)}</span>`;
  };
  const rows = [];

  if (found.has("amlodipine")) rows.push(`<tr><td>Amlodipine</td><td>—</td><td>—</td><td>CCB</td><td>HTN</td><td>ازدواجية مع Triplixam</td><td>—</td><td>${badge("⚠️ قابل للمراجعة: يُلغى إذا استُخدم Triplixam (ازدواجية CCB).","yellow")}</td></tr>`);
  if (found.has("co_taburan")) rows.push(`<tr><td>Co-Taburan (Valsartan/HCTZ)</td><td>—</td><td>—</td><td>ARB+Thiazide</td><td>HTN</td><td>تحالف ممنوع مع Triplixam</td><td>—</td><td>${badge("❌ مرفوض إذا وُجد Triplixam (ACEI+ARB ممنوع).","red")}</td></tr>`);
  if (found.has("triplixam")) rows.push(`<tr><td>Triplixam</td><td>—</td><td>—</td><td>ACEI+CCB+Thiazide-like</td><td>HTN</td><td>تحالف ممنوع مع Co-Taburan + ازدواجية Amlodipine</td><td>—</td><td>${badge("⚠️ مشروط: يُعتمد فقط بعد إلغاء Co-Taburan وAmlodipine.","yellow")}</td></tr>`);
  if (found.has("metformin_xr")) rows.push(`<tr><td>Metformin XR</td><td>—</td><td>بدء 500 mg مساءً ثم التدرّج</td><td>Biguanide</td><td>T2DM</td><td>سلامة كلوية مطلوبة</td><td>—</td><td>${badge("⚠️ موافقة مشروطة: توثيق eGFR ≥30 قبل البدء/الاستمرار.","yellow")}</td></tr>`);
  if (found.has("diamicron_mr")) rows.push(`<tr><td>Diamicron MR</td><td>—</td><td>—</td><td>Sulfonylurea</td><td>T2DM</td><td>خطر نقص سكر لدى كبار السن</td><td>—</td><td>${badge("⚠️ موافقة بحذر: فكّر ببديل أقل إحداثًا لنقص السكر.","yellow")}</td></tr>`);
  if (found.has("duodart") && ((caseData.gender||"").includes("أنث")||String(caseData.gender||"").toLowerCase().startsWith("f")))
    rows.push(`<tr><td>Duodart</td><td>—</td><td>—</td><td>BPH (للرجال)</td><td>BPH</td><td>تعارض ديموغرافي (أنثى)</td><td>—</td><td>${badge("❌ مرفوض ديموغرافيًا (دواء للرجال فقط).","red")}</td></tr>`);
  if (found.has("pantomax")) rows.push(`<tr><td>Pantoprazole (Pantomax)</td><td>—</td><td>—</td><td>PPI</td><td>GERD</td><td>—</td><td>—</td><td>${badge("✅ مقبول","green")}</td></tr>`);
  if (found.has("e_core_strips") || found.has("lancets"))
    rows.push(`<tr><td>E-core Strips / Lancets</td><td>TID × 90 (إن وجدت)</td><td>—</td><td>SMBG</td><td>Glucose Monitoring</td><td>—</td><td>—</td><td>${badge("⚠️ مقبول مع تبرير طبي للحاجة للقياس المتكرر.","yellow")}</td></tr>`);

  const list = (arr) => (arr && arr.length ? arr.map((x) => `<li>${escapeHtml(x)}</li>`).join("") : "<li>—</li>");
  const refsHTML = Object.values(CITATIONS).map(c => `<div>• <a href="${c.url}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a></div>`).join("");

  return `
<style>
.status-green{display:inline-block;background:#d4edda;color:#155724;padding:4px 10px;border-radius:15px;font-weight:700;border:1px solid #c3e6cb}
.status-yellow{display:inline-block;background:#fff3cd;color:#856404;padding:4px 10px;border-radius:15px;font-weight:700;border:1px solid #ffeeba}
.status-red{display:inline-block;background:#f8d7da;color:#721c24;padding:4px 10px;border-radius:15px;font-weight:700;border:1px solid #f5c6cb}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #e5e7eb;padding:8px;text-align:right}thead th{background:#f9fafb;font-weight:700}
h3,h4{margin:10px 0 6px}
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><p>${escapeHtml(caseData.notes || "—")}</p>
<h4>تحليل الملفات المرفوعة</h4><p>عدد الملفات: ${Array.isArray(caseData.files) ? caseData.files.length : 0}</p>
<h4>التحليل السيريري العميق</h4><p>تطبيق قواعد السلامة الدوائية والتغطية (ACEI+ARB، ازدواجية CCB، Metformin/eGFR، كبار السن/SU، SMBG..).</p>
<h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr><th>الدواء/الإجراء</th><th>الجرعة</th><th>جرعة مقترحة</th><th>التصنيف</th><th>الغرض</th><th>التداخلات</th><th>الخطورة%</th><th>قرار التأمين</th></tr></thead><tbody>${rows.join("")}</tbody></table>
<h4>خدمات طبية ضرورية ومبرَّرة للتأمين الطبي</h4><ul>${list(necessary)}</ul>
<h4>خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات</h4><ul>${list(avoid)}</ul>
<h4>تحاليل مبرَّرة بالتأمين</h4><ul>${list(labs)}</ul>
<h4>خطة العمل</h4>
<ol>
<li>تثبيت نظام ضغط واحد فقط ثم إعادة فحص الكرياتينين/البوتاسيوم خلال 1–2 أسبوع.</li>
<li>توثيق eGFR ≥30 قبل Metformin XR ومعايرة الجرعة تدريجيًا.</li>
<li>تقليل خطر نقص السكر لدى كبار السن (بدائل للسلفونيل يوريا عند الحاجة).</li>
<li>مواءمة صرف الشرائط/اللانست مع حدود التغطية أو إرفاق مبرر طبي.</li>
</ol>
<div class="refs"><h4>المراجع</h4><small>${refsHTML}</small></div>
<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>`;
}

// --------- API handler ---------
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
    const files = Array.isArray(body.files) ? body.files : [];

    // 1) Optional OCR (OpenAI)
    let ocrBlocks = [];
    if (openaiKey && files.length) {
      try { ocrBlocks = await ocrWithOpenAI(openaiKey, files); } catch {}
    }
    const ocrJoined = ocrBlocks.length ? ocrBlocks.map(b => `### ${b.filename}\n${b.text}`).join("\n\n") : "";

    // 2) Prepare file parts for Gemini (inline or upload)
    const fileParts = await Promise.all((files || []).map(async f => {
      try {
        const mime = f.type || detectMimeFromB64(f.data || "");
        const buf = Buffer.from(f.data || "", "base64");
        const hash = getFileHash(f.data || "");
        if (fileCache.has(hash)) return fileCache.get(hash);
        let part;
        if (buf.byteLength > MAX_INLINE_FILE_BYTES) {
          const uri = await geminiUpload(geminiKey, f.data, mime);
          part = { file_data: { mime_type: mime, file_uri: uri } };
        } else {
          part = { inline_data: { mime_type: mime, data: f.data } };
        }
        fileCache.set(hash, part);
        return part;
      } catch { return null; }
    }));
    const parts = [{ text: systemInstruction }, { text: buildUserPrompt(body) }];
    fileParts.filter(Boolean).forEach(p => parts.push(p));
    if (ocrJoined) parts.push({ text: `### OCR Extracted\n${ocrJoined}` });

    // 3) Deterministic sections
    const rulesOut = buildDecisions(body);
    const deterministicHTML = renderDeterministicHTML(body, rulesOut);

    // 4) Gemini narrative (best-effort)
    let html = "";
    try { html = await geminiAnalyze(geminiKey, parts); } catch {}
    const hasMarkers = /خدمات طبية ضرورية|خدمات يجب تجن|جدول الأدوية|المراجع/.test(html || "");
    const finalHTML = hasMarkers ? html : deterministicHTML;

    return res.status(200).json({ htmlReport: finalHTML, deterministic: !hasMarkers, ocrUsed: !!ocrBlocks.length });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Internal server error", detail: e?.message || "unknown" });
  }
}

// Increase body size limit for Base64 uploads
export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };
