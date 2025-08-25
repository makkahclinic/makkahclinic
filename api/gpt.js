// pages/api/gpt.js
// ملاحظة: Next.js Pages Router API Route
export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

/** .env.local:
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-1.5-pro-latest
*/

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL     = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

const ok  = (res, json) => res.status(200).json({ ok: true,  ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function parseJsonSafe(response) {
  const ct = response.headers.get("content-type") || "";
  return ct.includes("application/json") ? response.json() : { raw: await response.text() };
}

/* ------------ Gemini: resumable upload -------------- */
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, "base64");

  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(binaryData.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
  });
  if (!initRes.ok) throw new Error(`Gemini init failed: ${JSON.stringify(await parseJsonSafe(initRes))}`);

  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload session URL is missing");

  const uploadRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(binaryData.byteLength),
    },
    body: binaryData,
  });
  const metadata = await parseJsonSafe(uploadRes);
  if (!uploadRes.ok) throw new Error(`Gemini finalize failed: ${JSON.stringify(metadata)}`);

  return { uri: metadata?.file?.uri, mime: metadata?.file?.mime_type || mimeType };
}

/* ------------ المرحلة 1: تجميع محايد مع عزل الحالة -------------- */
async function aggregateClinicalDataWithGemini({ text, files, caseId, lang }) {
  const userParts = [];
  if (text) userParts.push({ text });

  for (const file of files || []) {
    const mime       = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").includes("base64,")
      ? file.data.split("base64,").pop()
      : (file?.data || "");
    if (!base64Data) continue;

    const { uri, mime: finalMime } = await geminiUploadBase64({
      name: file?.name || "unnamed_file",
      mimeType: mime,
      base64: base64Data,
    });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }

  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  const systemPrompt = `
You are a meticulous medical data transcriptionist.
STRICT CASE ISOLATION: Only use inputs that belong to CASE_ID=${caseId}. Ignore anything else.
Language: ${lang === "en" ? "English" : "Arabic"}.
CRITICAL RULES:
1) DO NOT summarize; transcribe ALL clinical details as-is.
2) List every diagnosis, lab value, imaging, procedure, AND every medication with exact dosage/frequency/duration if written.
3) If a medication's dosage/frequency/duration is NOT explicitly written, write "—" for that field (do NOT infer).
`.trim();

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
    // تثبيت الإخراج وتقليل التنوّع
    generationConfig: { temperature: 0, topP: 0.2, topK: 1 },
  };

  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);

  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
}

/* ------------ المرحلة 2: تعليمات مدقق خبير مُهيكلة بصرامة -------------- */
function getExpertAuditorInstructions(lang = "ar", { caseId }) {
  const schema = {
    meta: { caseId: "string" },
    patientSummary: { text: lang === "en" ? "Detailed case summary." : "ملخّص تفصيلي للحالة." },
    overallAssessment: { text: lang === "en" ? "Global expert assessment." : "تقييم خبير شامل." },

    diagnoses: {
      primary: lang === "en" ? "Primary diagnosis" : "التشخيص الرئيسي",
      secondary: [],
      certaintyNotes: lang === "en" ? "Certainty/differentials." : "ملاحظات اليقين/الاحتمالات التفريقية",
    },

    risksAndConflicts: {
      redFlags: [],
      guidelineOmissions: [],
      drugDrugConflicts: [],
      doseOrDurationErrors: [],
      notMedicallyNecessary: [],
    },

    table: [
      {
        name: "string",
        dosage_written: "string",
        itemType: "lab|medication|procedure|omission",
        status: lang === "en" ? "done|missing but necessary" : "تم إجراؤه|مفقود ولكنه ضروري",
        analysisCategory:
          lang === "en"
            ? "correct & justified|duplicate order|not medically justified|contradicts diagnosis|drug-drug interaction|critical omission|dose/frequency error|quantity needs review"
            : "صحيح ومبرر|إجراء مكرر|غير مبرر طبياً|إجراء يتعارض مع التشخيص|تعارض دوائي|إغفال خطير|خطأ في الجرعة أو التكرار|الكمية تحتاج لمراجعة",
        insuranceDecision: { label: lang === "en" ? "Approved|Denied|N/A" : "مقبول|مرفوض|لا ينطبق", justification: "string" },
      },
    ],

    recommendations: [{ priority: lang === "en" ? "Urgent|Best practice" : "عاجلة|أفضل ممارسة", description: "string", relatedItems: ["string"] }],
  };

  const knowledgeAnchors = `
Primary Knowledge Base (illustrative, keep concise & neutral):
- Cardiology: AHA/ACC/ESC.
- Endocrinology: ADA Standards (e.g., annual fundus exam for T2DM; Gliclazide MR once daily).
- General: Medical necessity, duplication, contraindications, unusual quantities—reimbursement lens.
- If ophthalmology terms are present (e.g., blepharitis/dry eye/ocular drops), include standard-of-care steps (e.g., lid hygiene/warm compresses) before broad-spectrum antibiotics when appropriate.
`;

  return `
You are an evidence-based clinical auditor producing professional ${lang === "en" ? "English" : "Arabic"} outputs.
STRICT CASE ISOLATION: Analyze ONLY data for CASE_ID=${caseId}.

${knowledgeAnchors}

RULES:
0) Output ONLY valid JSON per the schema below.
1) Start with a clear case summary, then explicit diagnoses (primary/secondary).
2) Extract red flags, omissions, drug–drug conflicts, dose/quantity errors (apply 90‑day rule: "quantity needs review" if stability not documented).
3) Build a table that lists EVERY medication/lab/procedure mentioned AND important omissions. For every medication, fill "dosage_written" EXACTLY as transcribed—or "—" if not written (no guessing).
4) Keep language ${lang === "en" ? "English" : "Arabic"}; concise and professional.

Schema:
${JSON.stringify(schema, null, 2)}
`.trim();
}

/* ------------ OpenAI: JSON mode + temperature 0 -------------- */
async function getAuditFromOpenAI({ bundle, lang, caseId }) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: getExpertAuditorInstructions(lang, { caseId }) },
        { role: "user",   content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" }, // Structured outputs / JSON mode
    }),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

/* ------------ تحقّق بسيط بعد النموذج (منع “السعر بدل الجرعة”) -------------- */
function postProcess(structured) {
  try {
    const s = structured || {};
    if (Array.isArray(s.table)) {
      for (const row of s.table) {
        const d = (row?.dosage_written || "").toString();
        const looksLikePrice = /(\bSAR\b|ريال|AED|USD|\d+\s*x\s*\d+\.\d{2}\s*(?:ريال|SAR))/i.test(d);
        if (looksLikePrice) {
          row.analysisCategory = row.analysisCategory || "الكمية تحتاج لمراجعة";
          row.insuranceDecision = row.insuranceDecision || {};
          row.insuranceDecision.justification =
            row.insuranceDecision.justification ||
            "حقل الجرعة يحتوي قيمة مالية/سعر بدل الجرعة؛ الرجاء توثيق الجرعة/التكرار/المدة.";
          row.dosage_written = "—";
        }
      }
    }
    return s;
  } catch {
    return structured;
  }
}

/* ------------ عرض HTML (أبقينا أسلوبك مع توسيع الحقول) -------------- */
function renderHtmlReport(structuredData, files, lang = "ar") {
  const s = structuredData;
  const isArabic = lang === "ar";
  const text = {
    sourceDocsTitle: isArabic ? "المستندات المصدرية" : "Source Documents",
    summaryTitle: isArabic ? "ملخص الحالة والتقييم العام" : "Case Summary & Overall Assessment",
    diagnosisTitle: isArabic ? "التشخيصات" : "Diagnoses",
    risksTitle: isArabic ? "المخاطر والتعارضات" : "Risks & Conflicts",
    detailsTitle: isArabic ? "التحليل التفصيلي للإجراءات/الأدوية" : "Detailed Analysis of Items",
    recommendationsTitle: isArabic ? "التوصيات والإجراءات المقترحة" : "Recommendations & Proposed Actions",
    itemHeader: isArabic ? "البند" : "Item",
    dosageHeader: isArabic ? "الجرعة المكتوبة" : "Written Dosage",
    statusHeader: isArabic ? "الحالة" : "Status",
    decisionHeader: isArabic ? "قرار التأمين" : "Insurance Decision",
    justificationHeader: isArabic ? "التبرير" : "Justification",
    relatedTo: isArabic ? "مرتبط بـ" : "Related to",
    notAvailable: isArabic ? "غير متوفر." : "Not available.",
  };

  const getRiskClass = (category = "") => {
    const s = category.toLowerCase();
    if (s.includes("omission") || s.includes("إغفال") || s.includes("conflict") || s.includes("تعارض") || s.includes("dose") || s.includes("جرعة") || s.includes("duplicate"))
      return "risk-critical";
    if (s.includes("review") || s.includes("غير مبرر") || s.includes("تحتاج")) return "risk-warning";
    if (s.includes("correct") || s.includes("صحيح")) return "risk-ok";
    return "";
  };

  const sourceDocsHtml = (files || [])
    .map((f) => {
      const isImg = (f.mimeType || "").startsWith("image/");
      const src = `data:${f.mimeType};base64,${(f.data || "").replace(/^data:[^;]+;base64,/, "")}`;
      const filePreview = isImg
        ? `<img src="${src}" alt="${f.name}" style="max-width:100%;height:auto;display:block;border-radius:8px"/>`
        : `<div style="padding:20px;border:1px dashed #e5e7eb;border-radius:8px;background:#f9fbfc;color:#6b7280;text-align:center">${f.name}</div>`;
      return `<div class="source-doc-card" style="margin-bottom:12px"><h3>${f.name}</h3>${filePreview}</div>`;
    })
    .join("");

  const rows = (s.table || [])
    .map(
      (r) => `
      <tr class="${getRiskClass(r.analysisCategory)}">
        <td><div style="font-weight:700">${r.name || "-"}</div><small style="color:#5f6368">${r.analysisCategory || ""}</small></td>
        <td style="font-family:monospace">${r.dosage_written || "—"}</td>
        <td>${r.status || "-"}</td>
        <td><span class="decision-badge" style="background:#e8eaed;color:#5f6368">${r.insuranceDecision?.label || "-"}</span></td>
        <td>${(r.insuranceDecision && r.insuranceDecision.justification) || "-"}</td>
      </tr>`
    )
    .join("");

  const risks = s?.risksAndConflicts
    ? [
        ["redFlags", isArabic ? "علامات إنذارية" : "Red flags"],
        ["guidelineOmissions", isArabic ? "نواقص قياسية" : "Guideline omissions"],
        ["drugDrugConflicts", isArabic ? "تعارضات دوائية" : "Drug–drug conflicts"],
        ["doseOrDurationErrors", isArabic ? "أخطاء جرعة/مدة" : "Dose/Duration errors"],
        ["notMedicallyNecessary", isArabic ? "غير مبرّر طبياً" : "Not medically necessary"],
      ]
        .map(([key, title]) => {
          const arr = s.risksAndConflicts[key] || [];
          if (!arr.length) return "";
          return `<div style="margin-bottom:8px"><b>${title}:</b><ul style="margin:6px 18px">${arr.map((x) => `<li>${x}</li>`).join("")}</ul></div>`;
        })
        .join("")
    : "";

  const recs =
    (s.recommendations || [])
      .map(
        (rec) => `
      <div style="display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:8px;background:#f8f9fa;border-right:4px solid ${
        (rec.priority || "").toLowerCase().includes("urgent") || (rec.priority || "").includes("عاجلة") ? "#d93025" : "#1e8e3e"
      };margin-bottom:12px">
        <span style="font-weight:700;padding:4px 10px;border-radius:8px;font-size:12px;color:#fff;background:${
          (rec.priority || "").toLowerCase().includes("urgent") || (rec.priority || "").includes("عاجلة") ? "#d93025" : "#1e8e3e"
        }">${rec.priority || ""}</span>
        <div>
          <div>${rec.description || ""}</div>
          ${
            rec.relatedItems?.length
              ? `<div style="font-size:12px;color:#5f6368;margin-top:6px">${text.relatedTo}: ${rec.relatedItems.join(", ")}</div>`
              : ""
          }
        </div>
      </div>`
      )
      .join("") || `<div style="color:#64748b">${text.notAvailable}</div>`;

  return `
  <style>
    .audit-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
    .audit-table th,.audit-table td{padding:12px;text-align:${isArabic ? "right" : "left"};border-bottom:1px solid #e9ecef;vertical-align:top;word-wrap:break-word}
    .audit-table th{background:#f8f9fa}
    .risk-critical td{background:#fce8e6}.risk-warning td{background:#fff0e1}.risk-ok td{background:#e6f4ea}
  </style>

  <div class="report-section">
    <h2>${text.sourceDocsTitle}</h2>
    <div class="source-docs-grid">${sourceDocsHtml}</div>
  </div>

  <div class="report-section">
    <h2>${text.summaryTitle}</h2>
    <p>${s.patientSummary?.text || text.notAvailable}</p>
    <p>${s.overallAssessment?.text || ""}</p>
  </div>

  <div class="report-section">
    <h2>${text.diagnosisTitle}</h2>
    <ul style="margin:6px 18px">
      ${s?.diagnoses?.primary ? `<li><b>${isArabic ? "الرئيسي:" : "Primary:"}</b> ${s.diagnoses.primary}</li>` : ""}
      ${
        Array.isArray(s?.diagnoses?.secondary) && s.diagnoses.secondary.length
          ? s.diagnoses.secondary.map((d) => `<li>${d}</li>`).join("")
          : ""
      }
    </ul>
    ${s?.diagnoses?.certaintyNotes ? `<div style="color:#475569">${s.diagnoses.certaintyNotes}</div>` : ""}
  </div>

  <div class="report-section">
    <h2>${text.risksTitle}</h2>
    ${risks || `<div style="color:#64748b">${text.notAvailable}</div>`}
  </div>

  <div class="report-section">
    <h2>${text.detailsTitle}</h2>
    <div style="overflow-x:auto">
      <table class="audit-table">
        <thead>
          <tr>
            <th style="width:28%">${text.itemHeader}</th>
            <th style="width:15%">${text.dosageHeader}</th>
            <th style="width:15%">${text.statusHeader}</th>
            <th style="width:15%">${text.decisionHeader}</th>
            <th style="width:27%">${text.justificationHeader}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>

  <div class="report-section">
    <h2>${text.recommendationsTitle}</h2>
    ${recs}
  </div>
  `;
}

/* ------------ API Handler -------------- */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) return bad(res, 500, "Server Configuration Error: API keys are missing.");

    const { text = "", files = [], patientInfo = null, lang = "ar" } = req.body || {};
    const safeLang  = ["ar", "en"].includes(lang) ? lang : "ar";
    const caseId    = String(Date.now()); // أو استخدم UUID من الواجهة

    // 1) تجميع محايد صارم من Gemini
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files, caseId, lang: safeLang });

    // 2) تدقيق خبير منظَّم من OpenAI (JSON + temp=0)
    const bundle = { caseId, patientInfo, aggregatedClinicalText, originalUserText: text };
    const structuredRaw = await getAuditFromOpenAI({ bundle, lang: safeLang, caseId });

    // 3) Post-process (تنظيف الجرعات التي هي أسعار بالخطأ، إلخ)
    const structured = postProcess(structuredRaw);

    // 4) HTML
    const html = renderHtmlReport(structured, files, safeLang);

    return ok(res, { html, structured, caseId, lang: safeLang });
  } catch (err) {
    console.error("API /api/gpt error:", err);
    return bad(res, 500, `Internal error: ${err.message || "unknown"}`);
  }
}
