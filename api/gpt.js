// /pages/api/gpt.ts — Ensemble Doctor Analyzer (Gemini + optional OpenAI OCR/Analysis)
// Runtime: Vercel / Next.js API Route (Node 18+)

// ========================= ENV =========================
// GEMINI_API_KEY = sk-...   (required)
// OPENAI_API_KEY = sk-...   (optional → enables OCR & ensemble)
// =======================================================

import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "crypto";
import {
  buildDecisions,
  detectEntitiesFromText,
  type CaseData,
} from "../../lib/rules";

// =============== CONFIG ===============
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_FILES_PER_REQUEST = 30;
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

// =============== CACHE ===============
const fileCache = new Map<string, any>();

// =============== UTILS ===============
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  { retries = 3, timeoutMs = DEFAULT_TIMEOUT_MS }: { retries?: number; timeoutMs?: number } = {}
) {
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
function getFileHash(base64Data: string) {
  return createHash("sha256").update(base64Data).digest("hex");
}

// =============== CITATIONS (rendered as links in HTML) ===============
const CITATIONS = {
  esc_esh_htn: {
    title: "ESC/ESH Guidelines for the management of arterial hypertension",
    url: "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Arterial-Hypertension-Management",
  },
  ada_soc: {
    title: "ADA Standards of Care (Metformin & CKD, Older Adults)",
    url: "https://diabetesjournals.org/care",
  },
  fda_metformin: {
    title: "FDA — Metformin: renal impairment (eGFR) recommendations",
    url: "https://www.fda.gov/drugs/drug-safety-and-availability/fda-drug-safety-communication",
  },
  acc_aha_chol: {
    title: "AHA/ACC Cholesterol Guideline — baseline liver enzymes",
    url: "https://www.acc.org/latest-in-cardiology/ten-points-to-remember",
  },
  medicare_smbg: {
    title: "Medicare Part B — Blood sugar monitors & test strips coverage",
    url: "https://www.medicare.gov/coverage/blood-sugar-monitors-test-strips",
  },
  duodart_label: {
    title: "Dutasteride/Tamsulosin (Duodart) — product information",
    url: "https://www.medicines.org.uk/emc/product/2512/smpc",
  },
  endocrine_vitd: {
    title: "Endocrine Society — Vitamin D guideline",
    url: "https://www.endocrine.org/clinical-practice-guidelines/vitamin-d",
  },
};

// =============== SYSTEM PROMPT (for Gemini narrative HTML) ===============
const systemInstruction = `
أنت استشاري "تدقيق طبي وتشغيلي" خبير. هدفك دقة 10/10. أخرج HTML واحدًا فقط.
[قواعد إلزامية]
- التوافق الديموغرافي: Duodart للرجال فقط.
- Triplex=Triplixam عند ظهور (od ×90). Form XR=Metformin XR.
- كبار السن: خطر نقص سكر مع السلفونيل يوريا + خطر السقوط مع أدوية الضغط.
- Metformin XR: "مضاد استطباب عند eGFR < 30".
- ACEI + ARB: تعارض ممنوع (Perindopril مع Valsartan).
- ازدواجية Amlodipine: إذا Triplixam موجود فألغِ Amlodipine المفرد.
[قرارات التأمين]
- Amlodipine: "⚠️ قابل للمراجعة: يُلغى إذا استُخدم Triplixam (ازدواجية CCB)."
- Co-Taburan: "❌ مرفوض إذا وُجد Triplixam (ACEI+ARB ممنوع)."
- Triplixam: "⚠️ مشروط: يُعتمد فقط بعد إلغاء Co-Taburan وAmlodipine المنفصل."
- Metformin XR: "⚠️ موافقة مشروطة: ابدأ بعد تأكيد eGFR ≥30؛ إن لزم فابدأ 500 mg وتدرّج."
- Diamicron MR: "⚠️ موافقة بحذر: فكّر ببديل أقل إحداثًا لنقص السكر لدى كبار السن."
- E-core Strips/Lancets: "⚠️ مقبول مع تبرير طبي للحاجة للقياس المتكرر."
- Duodart (لأنثى): "❌ مرفوض ديموغرافيًا (دواء للرجال فقط)."
[هيكل]
<style>
  .status-green { display:inline-block; background:#d4edda; color:#155724; padding:4px 10px; border-radius:15px; font-weight:700; border:1px solid #c3e6cb }
  .status-yellow{ display:inline-block; background:#fff3cd; color:#856404; padding:4px 10px; border-radius:15px; font-weight:700; border:1px solid #ffeeba }
  .status-red   { display:inline-block; background:#f8d7da; color:#721c24; padding:4px 10px; border-radius:15px; font-weight:700; border:1px solid #f5c6cb }
  table{ width:100%; border-collapse:collapse; margin-top:8px }
  th,td{ border:1px solid #e5e7eb; padding:8px; text-align:right }
  thead th{ background:#f9fafb; font-weight:700 }
  h3,h4{ margin:10px 0 6px }
  ul{ margin:0 0 8px 0; padding:0 16px }
  .refs small a{ color:#2563eb; text-decoration:none }
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><h4>تحليل الملفات المرفوعة</h4><h4>التحليل السيريري العميق</h4>
<h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr>
<th>الدواء/الإجراء (مع درجة الثقة)</th><th>الجرعة الموصوفة</th><th>الجرعة الصحيحة المقترحة</th><th>التصنيف</th><th>الغرض الطبي</th><th>التداخلات</th><th>درجة الخطورة (%)</th><th>قرار التأمين</th>
</tr></thead><tbody></tbody></table>
<h4>خدمات طبية ضرورية ومبرَّرة للتأمين الطبي</h4><ul></ul>
<h4>خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات</h4><ul></ul>
<h4>تحاليل مبرَّرة بالتأمين</h4><ul></ul>
<h4>خطة العمل</h4><ol></ol>
<div class="refs"><h4>المراجع</h4><small></small></div>
<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>
`;

// =============== User Prompt ===============
function buildUserPrompt(d: any = {}) {
  return `
**بيانات المريض:**
العمر: ${d.age ?? "غير محدد"} | الجنس: ${d.gender ?? "غير محدد"} | حمل: ${
    d.isPregnant === true ? "نعم" : d.isPregnant === false ? "لا" : "غير محدد"
  }
أمراض مُدرجة: ${Array.isArray(d.problems) ? d.problems.join(", ") : "—"}

**وصف الحالة/ملاحظات:** ${d.notes || "—"}
**تشخيصات مبدئية:** ${d.diagnosis || "—"}
**تحاليل/أشعة (نصي):** ${d.labResults || "—"}
**أدوية/إجراءات مكتوبة:** ${d.medications || "—"}

**عدد الملفات المرفوعة:** ${Array.isArray(d.files) ? d.files.length : 0}
`;
}

// =============== OpenAI OCR + Analysis (optional) ===============
async function ocrWithOpenAI(openaiKey: string, files: Array<{ name: string; data: string; type?: string }>) {
  const IMG = new Set(["image/jpeg", "image/png", "image/webp"]);
  const eligible = files.filter((f) => IMG.has(f.type || detectMimeFromB64(f.data)));

  const tasks = eligible.map(async (f) => {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` , "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.1,
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "استخرج نصًا منظّمًا من هذه الصورة (عربي/إنجليزي). للروشتات/التقارير: حوّل الجداول إلى عناصر {test,value,unit,ref_low,ref_high} دون تفسير." },
              { type: "image_url", image_url: { url: `data:${f.type || detectMimeFromB64(f.data)};base64,${f.data}` } }
            ]
          }]
        })
      });
      if (!res.ok) { console.warn("OpenAI OCR fail:", await res.text().catch(() => "")); return null; }
      const j = await res.json();
      const text = j?.choices?.[0]?.message?.content || "";
      return text ? { filename: f.name, mime: f.type, text } : null;
    } catch (e: any) { console.error("OCR error", e?.message); return null; }
  });

  const results = await Promise.all(tasks);
  return results.filter(Boolean) as Array<{ filename: string; mime?: string; text: string }>;
}

async function analyzeWithOpenAI(openaiKey: string, caseData: any, ocrTextJoined: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 3000,
      messages: [
        { role: "system", content: "أنت استشاري باطني. أخرج JSON فقط بالمفاتيح: {summary, finds, meds, risks, plan}. لا HTML." },
        { role: "user", content: `حلّل الحالة التالية بعمق (differential/سلامة أدوية/فجوات بيانات).\n${buildUserPrompt(caseData)}\nنصوص OCR:\n${ocrTextJoined || "—"}\nأعد JSON فقط.` }
      ]
    })
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`OpenAI analysis failed: ${t.slice(0,200)}`); }
  const j = await res.json();
  const txt = j?.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(txt); } catch { return { summary: txt }; }
}

// =============== Gemini Files ===============
async function geminiUpload(apiKey: string, base64Data: string, mime: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64Data, "base64");
  const r = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": mime }, body: buf });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Gemini file upload failed (${r.status}): ${t.slice(0,200)}`); }
  const j = await r.json();
  return j?.file?.uri as string;
}

async function geminiAnalyze(apiKey: string, allParts: any[]) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ role: "user", parts: allParts }],
    generationConfig: { temperature: 0.2, topP: 0.9, topK: 40, maxOutputTokens: 8192 },
  };
  const r = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const raw = await r.text();
  if (!r.ok) throw new Error(`Gemini error ${r.status}: ${raw.slice(0, 500)}`);
  try {
    const j = JSON.parse(raw);
    const t = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return (t || "").replace(/```html|```/g, "").trim();
  } catch { return raw; }
}

// =============== HTML Helpers ===============
function escapeHtml(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildRefsHTML() {
  return Object.values(CITATIONS)
    .map((c) => `<div>• <a href="${c.url}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a></div>`)
    .join("");
}

// Deterministic renderer (table + lists)
function renderDeterministicHTML(caseData: any, rulesOut: ReturnType<typeof buildDecisions>) {
  const { necessary = [], avoid = [], labs = [] } = rulesOut;

  const decisions: string[][] = [];
  const medsText = `${caseData.medications || ""}\n${caseData.notes || ""}`;
  const found = detectEntitiesFromText(medsText);

  const tag = (txt: string, kind: "green"|"yellow"|"red") => {
    const cls = kind === "red" ? "status-red" : kind === "yellow" ? "status-yellow" : "status-green";
    return `<span class="${cls}">${escapeHtml(txt)}</span>`;
  };

  if (found.has("amlodipine")) {
    decisions.push([
      "Amlodipine (ثقة)",
      "—",
      "—",
      "CCB",
      "ارتفاع ضغط الدم",
      "ازدواجية محتملة مع Triplixam",
      "—",
      tag("⚠️ قابل للمراجعة: يُلغى إذا استُخدم Triplixam (ازدواجية CCB).", "yellow"),
    ]);
  }
  if (found.has("co_taburan")) {
    decisions.push([
      "Co-Taburan (Valsartan/HCTZ) (ثقة)",
      "—",
      "—",
      "ARB + Thiazide",
      "ارتفاع ضغط الدم",
      "تحالف محظور مع Triplixam",
      "—",
      tag("❌ مرفوض إذا وُجد Triplixam (ACEI+ARB ممنوع).", "red"),
    ]);
  }
  if (found.has("triplixam")) {
    decisions.push([
      "Triplixam (Perindopril/Indapamide/Amlodipine) (ثقة)",
      "—",
      "—",
      "ACEI + CCB + thiazide-like",
      "ارتفاع ضغط الدم",
      "تحالف محظور مع Co-Taburan + ازدواجية Amlodipine",
      "—",
      tag("⚠️ مشروط: يُعتمد فقط بعد إلغاء Co-Taburan وAmlodipine المنفصل.", "yellow"),
    ]);
  }
  if (found.has("metformin_xr")) {
    decisions.push([
      "Metformin XR (ثقة)",
      "—",
      "ابدأ 500 mg مساءً ثم زيادة تدريجية",
      "Biguanide",
      "داء السكري النوع 2",
      "سلامة كلوية مطلوبة",
      "—",
      tag("⚠️ موافقة مشروطة: ابدأ بعد تأكيد eGFR ≥30؛ إن لزم فابدأ 500 mg وتدرّج.", "yellow"),
    ]);
  }
  if (found.has("diamicron_mr")) {
    decisions.push([
      "Diamicron MR (Gliclazide) (ثقة)",
      "—",
      "—",
      "Sulfonylurea",
      "داء السكري النوع 2",
      "خطر نقص سكر لدى كبار السن",
      "—",
      tag("⚠️ موافقة بحذر: فكّر ببديل أقل إحداثًا لنقص السكر لدى كبار السن.", "yellow"),
    ]);
  }
  const isFemale = (caseData.gender || "").toLowerCase().startsWith("f") || (caseData.gender || "").includes("أنث");
  if (isFemale && found.has("duodart")) {
    decisions.push([
      "Duodart (Tamsulosin/Dutasteride) (ثقة)",
      "—",
      "—",
      "BPH — للرجال",
      "تضخم البروستاتا",
      "تعارض ديموغرافي (أنثى)",
      "—",
      tag("❌ مرفوض ديموغرافيًا (دواء للرجال فقط).", "red"),
    ]);
  }
  if (found.has("pantomax")) {
    decisions.push([
      "Pantoprazole (Pantomax) (ثقة)",
      "—",
      "—",
      "PPI",
      "حموضة/ارتجاع",
      "—",
      "—",
      tag("✅ مقبول", "green"),
    ]);
  }
  if (found.has("e_core_strips") || found.has("lancets")) {
    decisions.push([
      "E-core Strips / Lancets (ثقة)",
      "TID × 90 (إن وُجدت)",
      "—",
      "SMBG",
      "مراقبة سكر الدم",
      "—",
      "—",
      tag("⚠️ مقبول مع تبرير طبي للحاجة للقياس المتكرر.", "yellow"),
    ]);
  }
  if (found.has("intrasite")) {
    decisions.push([
      "INTRASITE (ثقة)",
      "—",
      "—",
      "Topical wound gel",
      "عناية بالجروح",
      "—",
      "—",
      tag("⚠️ التوضيح مطلوب: منتج موضعي للعناية بالجروح (ليس أقراص).", "yellow"),
    ]);
  }

  const rows = decisions
    .map(
      (r) =>
        `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td><td>${r[6]}</td><td>${r[7]}</td></tr>`
    )
    .join("");

  const necList = (rulesOut.necessary || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>—</li>";
  const avoidList = (rulesOut.avoid || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>—</li>";
  const labsList = (rulesOut.labs || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>—</li>";

  const refsHTML = buildRefsHTML();

  return `
<style>
  .status-green { display:inline-block; background:#d4edda; color:#155724; padding:4px 10px; border-radius:15px; font-weight:700; border:1px solid #c3e6cb }
  .status-yellow{ display:inline-block; background:#fff3cd; color:#856404; padding:4px 10px; border-radius:15px; font-weight:700; border:1px solid #ffeeba }
  .status-red   { display:inline-block; background:#f8d7da; color:#721c24; padding:4px 10px; border-radius:15px; font-weight:700; border:1px solid #f5c6cb }
  table{ width:100%; border-collapse:collapse; margin-top:8px }
  th,td{ border:1px solid #e5e7eb; padding:8px; text-align:right }
  thead th{ background:#f9fafb; font-weight:700 }
  h3,h4{ margin:10px 0 6px }
  ul{ margin:0 0 8px 0; padding:0 16px }
  .refs small a{ color:#2563eb; text-decoration:none }
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4>
<p>${escapeHtml(caseData.notes || "—")}</p>
<h4>تحليل الملفات المرفوعة</h4>
<p>عدد الملفات: ${Array.isArray(caseData.files) ? caseData.files.length : 0}</p>
<h4>التحليل السيريري العميق</h4>
<p>تم تطبيق قواعد السلامة الدوائية والتغطية التأمينية (ACEI+ARB، ازدواجية CCB، Metformin/eGFR، كبار السن/SU، SMBG، إلخ).</p>
<h4>جدول الأدوية والإجراءات</h4>
<table>
  <thead><tr>
    <th>الدواء/الإجراء (مع درجة الثقة)</th>
    <th>الجرعة الموصوفة</th>
    <th>الجرعة الصحيحة المقترحة</th>
    <th>التصنيف</th>
    <th>الغرض الطبي</th>
    <th>التداخلات</th>
    <th>درجة الخطورة (%)</th>
    <th>قرار التأمين</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<h4>خدمات طبية ضرورية ومبرَّرة للتأمين الطبي</h4>
<ul>${necList}</ul>
<h4>خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات</h4>
<ul>${avoidList}</ul>
<h4>تحاليل مبرَّرة بالتأمين</h4>
<ul>${labsList}</ul>
<h4>خطة العمل</h4>
<ol>
  <li>تثبيت نظام ضغط واحد فقط (وإلغاء الازدواجية)، ثم إعادة فحص الكرياتينين/البوتاسيوم خلال 1–2 أسبوع.</li>
  <li>توثيق eGFR ≥30 قبل Metformin XR ومعايرة الجرعة تدريجيًا.</li>
  <li>تعديل علاج السكري لتقليل نقص السكر لدى كبار السن عند الحاجة.</li>
  <li>مواءمة صرف شرائط/لانست مع حدود التغطية أو إرفاق مبرر طبي.</li>
</ol>
<div class="refs"><h4>المراجع</h4><small>${refsHTML}</small></div>
<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>
  `.trim();
}

// =============== NEW: Force-merge deterministic sections into Gemini HTML ===============
function mergeReports(geminiHtml: string, detHtml: string) {
  if (!geminiHtml || geminiHtml.trim().length < 100) return detHtml;
  const pick = (label: string) => {
    const rx = new RegExp(`<h4>${label}</h4>[\\s\\S]*?(?=<h4>|<div class=\\"refs\\"|</p>\\s*$)`, "i");
    return detHtml.match(rx)?.[0] || "";
  };
  const secNecessary = pick("خدمات طبية ضرورية ومبرَّرة للتأمين الطبي");
  const secAvoid     = pick("خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات");
  const secLabs      = pick("تحاليل مبرَّرة بالتأمين");
  const replaceOrAppend = (html: string, label: string, block: string) => {
    const rx = new RegExp(`<h4>${label}</h4>[\\s\\S]*?(?=<h4>|<div class=\\"refs\\"|</p>\\s*$)`, "i");
    return rx.test(html) ? html.replace(rx, block) : html + "\n" + block;
  };
  let out = geminiHtml;
  if (secNecessary) out = replaceOrAppend(out, "خدمات طبية ضرورية ومبرَّرة للتأمين الطبي", secNecessary);
  if (secAvoid)     out = replaceOrAppend(out, "خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات", secAvoid);
  if (secLabs)      out = replaceOrAppend(out, "تحاليل مبرَّرة بالتأمين", secLabs);
  return out;
}

// =============== API Handler ===============
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const geminiKey = process.env.GEMINI_API_KEY as string | undefined;
    if (!geminiKey) throw new Error("GEMINI_API_KEY missing.");
    const openaiKey = process.env.OPENAI_API_KEY || null;

    const body: any = req.body || {};
    const files: Array<{ name: string; data: string; type?: string }> = Array.isArray(body.files)
      ? body.files.slice(0, MAX_FILES_PER_REQUEST)
      : [];

    const defaultMode = openaiKey ? "ensemble" : "gemini-only";
    const analysisMode = String(body.analysisMode || defaultMode).toLowerCase();

    // 1) Optional OCR (Parallel)
    let ocrBlocks: Array<{ filename: string; mime?: string; text: string }> = [];
    if (openaiKey && (analysisMode === "ocr+gemini" || analysisMode === "ensemble") && files.length) {
      try { ocrBlocks = await ocrWithOpenAI(openaiKey, files); } catch (e: any) { console.warn("OCR skipped:", e?.message); }
    }
    const ocrJoined = ocrBlocks.length ? ocrBlocks.map((b) => `### ${b.filename}\n${b.text}`).join("\n\n") : "";

    // 2) Process ALL files for Gemini (Parallel + Cache)
    const fileProcessingPromises = files.map((f) => new Promise(async (resolve) => {
      try {
        const mimeType = f.type || detectMimeFromB64(f.data || "");
        const fileBuffer = Buffer.from(f.data || "", "base64");
        const hash = getFileHash(f.data || "");
        if (fileCache.has(hash)) return resolve(fileCache.get(hash));

        let part: any;
        if (fileBuffer.byteLength > MAX_INLINE_FILE_BYTES) {
          const uri = await geminiUpload(geminiKey, f.data, mimeType);
          part = { file_data: { mime_type: mimeType, file_uri: uri } };
        } else {
          part = { inline_data: { mime_type: mimeType, data: f.data } };
        }
        fileCache.set(hash, part);
        resolve(part);
      } catch (e: any) {
        console.warn(`File processing failed for ${f.name || "file"}:`, e?.message);
        resolve(null);
      }
    }));

    const processedFileParts = (await Promise.all(fileProcessingPromises)).filter(Boolean) as any[];

    // 3) Build all parts for Gemini
    const allParts: any[] = [{ text: systemInstruction }, { text: buildUserPrompt(body) }];
    if (processedFileParts.length) allParts.push(...processedFileParts);
    if (ocrJoined) allParts.push({ text: `### OCR Extracted Texts\n${ocrJoined}` });

    // 4) Optional OpenAI ensemble JSON (context only)
    let ensembleJson: any = null;
    if (openaiKey && analysisMode === "ensemble") {
      try {
        ensembleJson = await analyzeWithOpenAI(openaiKey, body, ocrJoined);
        if (ensembleJson) allParts.push({ text: `[تحليل أولي من نموذج مساعد]\n${JSON.stringify(ensembleJson)}` });
      } catch (e: any) {
        console.warn("Ensemble OpenAI analysis failed:", e?.message);
      }
    }

    // 5) Deterministic rules output
    const rulesOut = buildDecisions(body as CaseData);
    const deterministicHTML = renderDeterministicHTML(body, rulesOut);

    // 6) Gemini narrative (optional)
    let html = "";
    try { html = await geminiAnalyze(geminiKey, allParts); } catch (e: any) { console.warn("Gemini narrative failed:", e?.message); }

    // 7) NEW MERGE: force deterministic sections into Gemini HTML
    const finalHTML = mergeReports(html, deterministicHTML);

    // 8) Response
    return res.status(200).json({
      htmlReport: finalHTML,
      deterministic: false,
      ocrUsed: !!ocrBlocks.length,
      ensembleUsed: !!ensembleJson,
    });
  } catch (err: any) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

// Increase body size limit for Base64 files
export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };
