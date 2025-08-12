// /api/gpt.js — Ensemble Doctor Analyzer (Gemini + optional OpenAI OCR/Analysis)
// Runtime: Vercel / Next.js API Route (Node 18+)

// ========================= ENV (Vercel → Settings → Environment Variables) =========================
// GEMINI_API_KEY = sk-...   (required)
// OPENAI_API_KEY = sk-...   (optional → enables OCR & ensemble)
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

// =============== CITATIONS (links appear in the final HTML) ===============
const CITATIONS = {
  esc_esh_htn: {
    title: "ESC/ESH Guidelines for the management of arterial hypertension",
    url: "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Arterial-Hypertension-Management"
  },
  ada_soc: {
    title: "ADA Standards of Care (Metformin & CKD considerations)",
    url: "https://diabetesjournals.org/care"
  },
  fda_metformin: {
    title: "FDA — Metformin: renal impairment (eGFR) recommendations",
    url: "https://www.fda.gov/drugs/drug-safety-and-availability/fda-drug-safety-communication"
  },
  ada_older: {
    title: "ADA — Older Adults: hypoglycemia risk & therapy selection",
    url: "https://diabetesjournals.org/care"
  },
  acc_aha_chol: {
    title: "AHA/ACC Cholesterol Guideline — baseline liver enzymes",
    url: "https://www.acc.org/latest-in-cardiology/ten-points-to-remember"
  },
  medicare_smbg: {
    title: "Medicare Part B — Blood sugar monitors & test strips coverage",
    url: "https://www.medicare.gov/coverage/blood-sugar-monitors-test-strips"
  },
  duodart_label: {
    title: "Dutasteride/Tamsulosin (Duodart) — product information",
    url: "https://www.medicines.org.uk/emc/product/2512/smpc"
  },
  ada_b12: {
    title: "ADA — Vitamin B12 screening on long-term metformin",
    url: "https://diabetesjournals.org/care"
  },
  endo_vitd: {
    title: "Endocrine Society — Vitamin D guideline",
    url: "https://www.endocrine.org/clinical-practice-guidelines/vitamin-d"
  }
};

// =============== SYSTEM PROMPT FOR GEMINI ===============
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

[صياغة قرارات التأمين (إلزامية)]
- استخدم الصيغ الدقيقة التالية:
  - **Amlodipine:** "⚠️ قابل للمراجعة: يُلغى إذا استُخدم Triplixam (ازدواجية CCB)."
  - **Co-Taburan:** "❌ مرفوض إذا وُجد Triplixam (ACEI+ARB ممنوع)."
  - **Triplixam:** "⚠️ مشروط: يُعتمد فقط بعد إلغاء Co-Taburan وAmlodipine المنفصل."
  - **Metformin XR:** "⚠️ موافقة مشروطة: ابدأ بعد تأكيد eGFR ≥30؛ إن لزم فابدأ 500 mg وتدرّج."
  - **Diamicron MR:** "⚠️ موافقة بحذر: فكّر ببديل أقل إحداثًا لنقص السكر لدى كبار السن."
  - **E-core Strips/Lancets:** "⚠️ مقبول مع تبرير طبي للحاجة للقياس المتكرر."
  - **Duodart (لأنثى):** "❌ مرفوض ديموغرافيًا (دواء للرجال فقط)."

[التنسيق البصري (Visual Formatting) - إلزامي]
- قم بتضمين كتلة <style> التالية في بداية تقرير الـ HTML.
- لكل قرار تأمين، قم بتغليف النص والرمز داخل <span> مع الكلاس المناسب.

[البنية]
<style>
  .status-green { display: inline-block; background-color: #d4edda; color: #155724; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #c3e6cb; }
  .status-yellow { display: inline-block; background-color: #fff3cd; color: #856404; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #ffeeba; }
  .status-red { display: inline-block; background-color: #f8d7da; color: #721c24; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #f5c6cb; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: right; }
  thead th { background: #f9fafb; font-weight: 700; }
  h3,h4 { margin: 10px 0 6px; }
  ul { margin: 0 0 8px 0; padding: 0 16px; }
  .refs small a { color: #2563eb; text-decoration: none; }
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><h4>تحليل الملفات المرفوعة</h4><h4>التحليل السريري العميق</h4>
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

// =============== User Prompt Pack ===============
function buildUserPrompt(d = {}) {
  return `
**بيانات المريض:**
العمر: ${d.age ?? "غير محدد"} | الجنس: ${d.gender ?? "غير محدد"} | حمل: ${
    d.isPregnant === true ? "نعم" : d.isPregnant === false ? "لا" : "غير محدد"
  } | شهر الحمل: ${d.pregnancyMonth ?? "غير محدد"}
تدخين: ${d.isSmoker ? "مدخّن" : "غير مدخّن"} | باك-سنة: ${d.packYears ?? "غير محدد"}
أمراض مُدرجة: ${Array.isArray(d.problems) ? d.problems.join(", ") : "—"}

**وصف الحالة/ملاحظات:** ${d.notes || "—"}
**تشخيصات مبدئية:** ${d.diagnosis || "—"}
**تحاليل/أشعة (نصي):** ${d.labResults || "—"}
**أدوية/إجراءات مكتوبة:** ${d.medications || "—"}

**عدد الملفات المرفوعة:** ${Array.isArray(d.files) ? d.files.length : 0}
`;
}

// =============== OpenAI OCR + Analysis (optional) ===============
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
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "استخرج نصاً منظماً من هذه الصورة (عربي/إنجليزي). إن كان تقرير مختبر/وصفة فحوّل الجداول إلى عناصر {test,value,unit,ref_low,ref_high} حيثما أمكن، بدون تفسير."
                },
                { type: "image_url", image_url: { url: `data:${f.type || detectMimeFromB64(f.data)};base64,${f.data}` } }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });
      if (!res.ok) {
        console.warn(`OpenAI OCR fail for ${f.name}:`, await res.text().catch(() => ""));
        return null;
      }
      const j = await res.json();
      const text = j?.choices?.[0]?.message?.content || "";
      return text ? { filename: f.name, mime: f.type, text } : null;
    } catch (e) {
      console.error(`OCR promise failed for ${f.name}:`, e);
      return null;
    }
  });

  const results = await Promise.all(ocrPromises);
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
        { role: "system", content: "أنت استشاري باطني. أخرج JSON فقط بالمفاتيح: {summary, finds, meds, risks, plan}. لا HTML." },
        {
          role: "user",
          content: `حلّل الحالة التالية بعمق (differential/سلامة أدوية/فجوات بيانات).
           بيانات الحالة:\n${buildUserPrompt(caseData)}
           نصوص OCR:\n${ocrTextJoined || "—"}
           أعد JSON فقط.`
        }
      ]
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI analysis failed: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  const txt = j?.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(txt);
  } catch {
    return { summary: txt };
  }
}

// =============== Gemini Files ===============
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
    const t = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return (t || "").replace(/```html|```/g, "").trim();
  } catch {
    return raw;
  }
}

// =============== LIGHTWEIGHT RULES ENGINE ===============
function normName(s = "") { return (s || "").toLowerCase().replace(/[^\w]+/g, " ").trim(); }

function detectEntitiesFromText(text = "") {
  const n = normName(text);
  const found = new Set();

  const hits = [
    ["duodart", /duodart|tamsulosin|dutasteride/],
    ["triplixam", /triplixam|triplex\b|perindopril/],
    ["co_taburan", /co[ -]?tabu[rv]an|co[ -]?diovan|valsartan/],
    ["amlodipine", /\bamlodipine\b|amlopin|amlo/],
    ["metformin_xr", /metformin\s*(xr|er)|form\s*xr/],
    ["diamicron_mr", /diamicron|gliclazide/],
    ["pantomax", /pantomax|pantoprazole/],
    ["e_core_strips", /e[- ]?core.*strip|test\s*strip/],
    ["lancets", /lancet/],
    ["intrasite", /\bintrasite\b|intrasitab\b|intra[-\s]?site/],
    ["rozavi", /\brozavi\b|rosuvastatin/],
    ["bph_note", /\bBPH\b|prostat/i],
    ["sudocrem", /sudocrem|suden\s*cream/],
    ["jointace", /jointace|jontice/],
    ["pikaur", /pika[- ]?ur|ur\s*eff/],
    ["omnipaque", /omnipaque|iohexol/],
  ];

  for (const [key, rx] of hits) if (rx.test(n)) found.add(key);
  return found;
}

function parseEGFR(labsText = "") {
  const m = labsText.match(/eGFR\s*[:=]?\s*(\d+(\.\d+)?)/i);
  if (!m) return null;
  return Number(m[1]);
}

function buildDecisions(caseData = {}) {
  const medsText = [caseData.medications || "", caseData.notes || "", caseData.labResults || ""].join("\n");
  const set = detectEntitiesFromText(medsText);
  const isFemale = (caseData.gender || "").toLowerCase().startsWith("f") || (caseData.gender || "").includes("أنث");
  const age = Number(caseData.age || 0) || null;
  const eGFR = parseEGFR(caseData.labResults || "");

  const necessary = [];
  const avoid = [];
  const labs = [];

  // --- Core rules ---
  if (isFemale && (set.has("duodart") || set.has("bph_note"))) {
    avoid.push("إيقاف Duodart وتصحيح تشخيص BPH: كلاهما لا ينطبق على الأنثى.");
  }

  const hasACEI = set.has("triplixam");
  const hasARB = set.has("co_taburan");
  if (hasACEI && hasARB) {
    avoid.push("منع الجمع ACEI + ARB (Triplixam مع Co-Taburan): خطر فرط بوتاسيوم/قصور كلوي.");
  }

  if (hasACEI && set.has("amlodipine")) {
    avoid.push("إزالة Amlodipine المنفصل إذا استُخدم Triplixam (ازدواجية CCB).");
  }

  if (set.has("metformin_xr")) {
    if (eGFR !== null && eGFR < 30) {
      avoid.push("إيقاف/عدم بدء Metformin XR: مضاد استطباب عند eGFR < 30.");
    } else {
      necessary.push("توثيق eGFR ≥30 قبل البدء/الاستمرار في Metformin XR، ومعايرة تدريجية.");
    }
  }
  
  if (set.has("intrasite")) {
    necessary.push("توضيح INTRASITE كجل/ضماد موضعي للجروح (Topical)، مع تحديد الموضع والاستخدام.");
  }

  if (age && age >= 65 && set.has("diamicron_mr")) {
    avoid.push("Sulfonylurea (Diamicron MR) لدى كبار السن: خطر نقص سكر—فكّر ببديل أقل خطورة.");
  }

  if (set.has("e_core_strips") || set.has("lancets")) {
    necessary.push("شرائط/لانست SMBG: الالتزام بحدود الدافع أو إرفاق مبرر طبي عند تجاوزها.");
  }

  if (hasACEI || hasARB || set.has("amlodipine")) {
    labs.push("قياس ضغط وضعي (استلقاء/وقوف) بعد ضبط أدوية الضغط لتقليل خطر السقوط.");
  }

  if (set.has("rozavi")) {
    labs.push("ALT/AST أساسًا قبل الستاتين، وتُعاد فقط عند ظهور أعراض.");
  }

  if (set.has("metformin_xr")) {
    labs.push("Creatinine/eGFR قبل البدء ثم دوريًا.");
    labs.push("فيتامين B12 على الاستعمال الطويل للميتفورمين.");
  }

  if (/هشاشة|osteoporosis|fragility/i.test(medsText)) {
    labs.push("فيتامين D (25-OH) عند هشاشة/عوامل خطورة عظمية.");
  }

  return { set, necessary, avoid, labs };
}

function buildRefsHTML() {
  const items = Object.values(CITATIONS)
    .map((c) => `<div>• <a href="${c.url}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a></div>`)
    .join("");
  return items || "";
}

function escapeHtml(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderDeterministicHTML(caseData = {}, rulesOut = {}) {
  const { necessary = [], avoid = [], labs = [] } = rulesOut;

  const decisions = [];

  const addDecision = (decisionText, status) => {
    const cls = status === "red" ? "status-red" : status === "yellow" ? "status-yellow" : "status-green";
    return `<span class="${cls}">${escapeHtml(decisionText)}</span>`;
  };

  const medsText = (caseData.medications || "") + "\n" + (caseData.notes || "");
  const found = detectEntitiesFromText(medsText);

  if (found.has("amlodipine")) {
    decisions.push(["Amlodipine", addDecision("⚠️ قابل للمراجعة: يُلغى إذا استُخدم Triplixam (ازدواجية CCB).", "yellow")]);
  }
  if (found.has("co_taburan")) {
    decisions.push(["Co-Taburan", addDecision("❌ مرفوض إذا وُجد Triplixam (ACEI+ARB ممنوع).", "red")]);
  }
  if (found.has("triplixam")) {
    decisions.push(["Triplixam", addDecision("⚠️ مشروط: يُعتمد فقط بعد إلغاء Co-Taburan وAmlodipine المنفصل.", "yellow")]);
  }
  if (found.has("metformin_xr")) {
    decisions.push(["Metformin XR", addDecision("⚠️ موافقة مشروطة: ابدأ بعد تأكيد eGFR ≥30؛ إن لزم فابدأ 500 mg وتدرّج.", "yellow")]);
  }
  if (found.has("diamicron_mr")) {
    decisions.push(["Diamicron MR", addDecision("⚠️ موافقة بحذر: فكّر ببديل أقل إحداثًا لنقص السكر لدى كبار السن.", "yellow")]);
  }
  const isFemale = (caseData.gender || "").toLowerCase().startsWith("f") || (caseData.gender || "").includes("أنث");
  if (isFemale && found.has("duodart")) {
    decisions.push(["Duodart", addDecision("❌ مرفوض ديموغرافيًا (دواء للرجال فقط).", "red")]);
  }
  if (found.has("e_core_strips") || found.has("lancets")) {
    decisions.push(["E-core Strips / Lancets", addDecision("⚠️ مقبول مع تبرير طبي للحاجة للقياس المتكرر.", "yellow")]);
  }
  
  const rows = decisions.map(r => `<tr><td>${escapeHtml(r[0])}</td><td>${r[1]}</td></tr>`).join("");

  const necList = necessary.map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>—</li>";
  const avoidList = avoid.map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>—</li>";
  const labsList = labs.map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>—</li>";

  const refsHTML = buildRefsHTML();

  return `
<style>
  .status-green { display: inline-block; background-color: #d4edda; color: #155724; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #c3e6cb; }
  .status-yellow { display: inline-block; background-color: #fff3cd; color: #856404; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #ffeeba; }
  .status-red { display: inline-block; background-color: #f8d7da; color: #721c24; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #f5c6cb; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: right; }
  thead th { background: #f9fafb; font-weight: 700; }
  h3,h4 { margin: 10px 0 6px; }
  ul { margin: 0 0 8px 0; padding: 0 16px; }
  .refs small a { color: #2563eb; text-decoration: none; }
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4>
<p>${escapeHtml(caseData.notes || "—")}</p>
<h4>جدول الأدوية والإجراءات</h4>
<table>
  <thead><tr><th>الدواء/الإجراء</th><th>قرار التأمين</th></tr></thead>
  <tbody>${rows || ""}</tbody>
</table>
<h4>خدمات طبية ضرورية ومبرَّرة للتأمين الطبي</h4>
<ul>${necList}</ul>
<h4>خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات</h4>
<ul>${avoidList}</ul>
<h4>تحاليل مبرَّرة بالتأمين</h4>
<ul>${labsList}</ul>
<div class="refs"><h4>المراجع</h4><small>${refsHTML}</small></div>
<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>
  `.trim();
}

// =============== MERGE LOGIC (Robust Version) ===============
function mergeReports(geminiHtml, detHtml) {
  if (!geminiHtml || geminiHtml.trim().length < 100) return detHtml;

  const pick = (label) => {
    // Regex to find a section: <h4>label</h4> followed by its content until the next <h4> or specific terminators
    const rx = new RegExp(`<h4>${label}</h4>[\\s\\S]*?(?=<h4>|<div class="refs"|</p>\\s*$)`, "i");
    return detHtml.match(rx)?.[0] || "";
  };
  const secNecessary = pick("خدمات طبية ضرورية ومبرَّرة للتأمين الطبي");
  const secAvoid     = pick("خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات");
  const secLabs      = pick("تحاليل مبرَّرة بالتأمين");

  const replaceOrAppend = (html, label, block) => {
    // More robust regex, allows for whitespace variations
    const rx = new RegExp(`<h4>\\s*${label.trim()}\\s*</h4>[\\s\\S]*?(?=<h4>|<div class="refs"|</p>\\s*$)`, "i");
    if (rx.test(html)) {
        return html.replace(rx, block);
    }
    // If the section doesn't exist in Gemini's output, append it before the references/footer
    const insertionPoint = html.search(/<div class="refs"|<h4>خطة العمل/i);
    if (insertionPoint !== -1) {
        return html.slice(0, insertionPoint) + block + "\n" + html.slice(insertionPoint);
    }
    return html + "\n" + block;
  };

  let out = geminiHtml;
  if (secNecessary) out = replaceOrAppend(out, "خدمات طبية ضرورية ومبرَّرة للتأمين الطبي", secNecessary);
  if (secAvoid)     out = replaceOrAppend(out, "خدمات يجب تجنُّبها/مراجعتها لتقليل رفض المطالبات", secAvoid);
  if (secLabs)      out = replaceOrAppend(out, "تحاليل مبرَّرة بالتأمين", secLabs);

  return out;
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

    const defaultMode = openaiKey ? "ensemble" : "gemini-only";
    const analysisMode = (body.analysisMode || defaultMode).toLowerCase();

    let ocrBlocks = [];
    if (openaiKey && (analysisMode === "ocr+gemini" || analysisMode === "ensemble") && files.length) {
      try {
        ocrBlocks = await ocrWithOpenAI(openaiKey, files);
      } catch (e) {
        console.warn("OCR skipped:", e.message);
      }
    }
    const ocrJoined = ocrBlocks.length ? ocrBlocks.map((b) => `### ${b.filename}\n${b.text}`).join("\n\n") : "";

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
    if (ocrJoined) allParts.push({ text: `### OCR Extracted Texts\n${ocrJoined}` });

    let ensembleJson = null;
    if (openaiKey && analysisMode === "ensemble") {
      try {
        ensembleJson = await analyzeWithOpenAI(openaiKey, body, ocrJoined);
        if (ensembleJson) {
          allParts.push({ text: `[تحليل أولي من نموذج مساعد]\n${JSON.stringify(ensembleJson)}` });
        }
      } catch (e) {
        console.warn("Ensemble OpenAI analysis failed:", e.message);
      }
    }

    const rulesOut = buildDecisions(body);
    const deterministicHTML = renderDeterministicHTML(body, rulesOut);

    let html = "";
    try {
      html = await geminiAnalyze(geminiKey, allParts);
    } catch (e) {
      console.warn("Gemini narrative failed, falling back to deterministic HTML only:", e.message);
    }
    
    const finalHTML = mergeReports(html, deterministicHTML);

    const responsePayload = {
      htmlReport: finalHTML,
      deterministic: /خدمات طبية ضرورية/.test(finalHTML) && !/التحليل السريري العميق/.test(finalHTML),
      ocrUsed: !!ocrBlocks.length,
      ensembleUsed: !!ensembleJson
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
