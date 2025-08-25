// pages/api/gpt.js

export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

/** بيئة الخادم (.env.local):
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-1.5-pro-latest
*/

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

const ok = (res, json) => { res.setHeader("Cache-Control", "no-store"); return res.status(200).json({ ok: true, ...json }); };
const bad = (res, code, msg) => { res.setHeader("Cache-Control", "no-store"); return res.status(code).json({ ok: false, error: msg }); };

async function parseJsonSafe(response) {
  const ct = response.headers.get("content-type") || "";
  return ct.includes("application/json") ? response.json() : { raw: await response.text() };
}

/** رفع ملفات Base64 إلى Gemini (Resumable Upload) */
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

/** المرحلة 1: تجميع محايد (Gemini) مع عزل الحالة */
async function aggregateClinicalDataWithGemini({ text, files, caseId, lang }) {
  const userParts = [];
  if (text) userParts.push({ text });

  for (const f of files || []) {
    if (!f?.data) continue;
    const { uri, mime } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: f?.mimeType || "application/octet-stream",
      base64: f.data,
    });
    userParts.push({ file_data: { file_uri: uri, mime_type: mime } });
  }
  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  const systemPrompt = `
You are a meticulous medical transcription engine.
STRICT CASE ISOLATION: Only use the inputs attached to CASE_ID=${caseId}. Ignore any prior cases.
Language: ${lang === "en" ? "English" : "Arabic"}.
Rules:
1) DO NOT summarize; transcribe ALL clinical details verbatim into structured text.
2) List every diagnosis, lab value, imaging, procedure, and each medication with dosage/frequency/duration exactly as written.
3) Produce clean, well-ordered ${lang === "en" ? "English" : "Arabic"} text blocks that are easy to parse downstream.
`.trim();

  const body = { system_instruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: userParts }] };

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);

  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
}

/** المرحلة 2: تدقيق إكلينيكي عميق (OpenAI) */
function getExpertAuditorInstructions(lang, { caseId }) {
  const schema = {
    meta: { caseId: "string" },
    summary: {
      caseOverview: lang === "en" ? "Brief case overview with key evidence." : "ملخص موجز للحالة بالأدلة الأساسية.",
      keyFindings: [lang === "en" ? "Key point 1" : "نقطة أساسية 1"],
    },
    diagnoses: {
      primary: lang === "en" ? "Primary diagnosis" : "التشخيص الرئيسي",
      secondary: [lang === "en" ? "Secondary diagnoses (if any)" : "تشاخيص ثانوية (إن وجدت)"],
      certaintyNotes: lang === "en" ? "Notes on certainty/differentials." : "ملاحظات اليقين/التفريقي.",
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
    recommendations: [
      { priority: lang === "en" ? "Urgent|Best practice" : "عاجلة|أفضل ممارسة", description: "string", relatedItems: ["string"] },
    ],
  };

  return `
You are an evidence-based clinical auditor (clinical pharmacist + family medicine) producing professional ${lang === "en" ? "English" : "Arabic"} outputs.
STRICT CASE ISOLATION: Analyze ONLY data for CASE_ID=${caseId}.

Knowledge anchors to cite in reasoning (no need to output citations): Cardiology AHA/ACC/ESC; Diabetes ADA Standards (annual fundus exam for T2DM); Gliclazide MR once daily; reimbursement focuses: medical necessity, duplication, contraindications, unusual quantities.

Rules:
0) Output ONLY valid JSON per the schema below.
1) Start with a clear case summary then primary/secondary diagnoses.
2) Extract red flags, conflicts, omissions, dosing/quantity errors; apply the 90‑day rule ("quantity needs review" if stability not documented).
3) Build a table that lists EVERY medication/lab/procedure mentioned and important omissions. For every medication, fill "dosage_written" EXACTLY as transcribed.
4) Keep language ${lang === "en" ? "English" : "Arabic"}; concise and professional.

Schema:
${JSON.stringify(schema, null, 2)}
`.trim();
}

async function getAuditFromOpenAI({ bundle, lang, caseId }) {
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: getExpertAuditorInstructions(lang, { caseId }) },
        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

/** المرحلة 3: HTML موحّد من الخادم */
function tDict(lang) {
  return lang === "en"
    ? {
        summaryTitle: "Case Summary",
        diagnosisTitle: "Diagnosis",
        risksTitle: "Risks & Conflicts",
        detailsTitle: "Detailed Analysis of Items",
        recsTitle: "Clinical Recommendations",
        itemHeader: "Item",
        dosageHeader: "Written dosage",
        statusHeader: "Status",
        decisionHeader: "Insurance decision",
        justificationHeader: "Justification",
        none: "Not available.",
      }
    : {
        summaryTitle: "تلخيص الحالة",
        diagnosisTitle: "التشخيص",
        risksTitle: "المخاطر والتعارضات",
        detailsTitle: "التحليل التفصيلي للإجراءات/الأدوية",
        recsTitle: "التوصيات الإكلينيكية",
        itemHeader: "الإجراء",
        dosageHeader: "الجرعة المكتوبة",
        statusHeader: "الحالة",
        decisionHeader: "قرار التأمين",
        justificationHeader: "التبرير",
        none: "غير متوفر.",
      };
}

function riskClass(cat = "") {
  const s = (cat || "").toLowerCase();
  if (s.includes("omission") || s.includes("إغفال") || s.includes("conflict") || s.includes("تعارض") || s.includes("duplicate") || s.includes("خطأ"))
    return "risk-critical";
  if (s.includes("review") || s.includes("غير مبرر") || s.includes("تحتاج لمراجعة")) return "risk-warning";
  if (s.includes("correct") || s.includes("صحيح")) return "risk-ok";
  return "";
}
function decisionBadge(label) {
  const base =
    "font-weight:700;padding:5px 10px;border-radius:16px;font-size:13px;display:inline-block;border:1px solid transparent;";
  if (["Approved", "مقبول"].includes(label)) return base + "background:#e6f4ea;color:#1e8e3e";
  if (["Denied", "مرفوض"].includes(label)) return base + "background:#fce8e6;color:#d93025";
  return base + "background:#e8eaed;color:#5f6368";
}

function renderHtmlReport(structured, lang) {
  const s = structured || {};
  const tt = tDict(lang);

  const diagList = [
    s?.diagnoses?.primary ? `<li><b>${lang === "en" ? "Primary:" : "التشخيص الرئيسي:"}</b> ${s.diagnoses.primary}</li>` : "",
    ...(Array.isArray(s?.diagnoses?.secondary) ? s.diagnoses.secondary.map((d) => `<li>${d}</li>`) : []),
  ].join("");

  const rs = s?.risksAndConflicts || {};
  const riskBlock = (title, arr) =>
    Array.isArray(arr) && arr.length
      ? `<div style="margin-bottom:8px"><b>${title}:</b><ul style="margin:6px 18px">${arr.map((x) => `<li>${x}</li>`).join("")}</ul></div>`
      : "";
  const risks = [
    riskBlock(lang === "en" ? "Red flags" : "علامات إنذارية", rs.redFlags),
    riskBlock(lang === "en" ? "Guideline omissions" : "نواقص قياسية", rs.guidelineOmissions),
    riskBlock(lang === "en" ? "Drug–drug conflicts" : "تعارضات دوائية", rs.drugDrugConflicts),
    riskBlock(lang === "en" ? "Dose/Duration errors" : "أخطاء جرعة/مدة", rs.doseOrDurationErrors),
    riskBlock(lang === "en" ? "Not medically necessary" : "غير مبرّر طبياً", rs.notMedicallyNecessary),
  ].join("");

  const rows = (s.table || [])
    .map(
      (r) => `
      <tr class="${riskClass(r.analysisCategory)}">
        <td><div style="font-weight:700">${r.name || "-"}</div><small style="color:#5f6368">${r.analysisCategory || ""}</small></td>
        <td style="font-family:monospace">${r.dosage_written || "-"}</td>
        <td>${r.status || "-"}</td>
        <td><span style="${decisionBadge(r?.insuranceDecision?.label)}">${r?.insuranceDecision?.label || "-"}</span></td>
        <td>${(r?.insuranceDecision && r.insuranceDecision.justification) || "-"}</td>
      </tr>`
    )
    .join("");

  const recs =
    (s.recommendations || [])
      .map(
        (rec) => `
      <div style="display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:8px;background:#f8fafc;border-right:4px solid ${
        (rec.priority || "").toLowerCase().includes("urgent") || (rec.priority || "").includes("عاجلة") ? "#d93025" : "#1e8e3e"
      };margin-bottom:12px">
        <span style="font-weight:700;padding:4px 10px;border-radius:8px;font-size:12px;color:#fff;background:${
          (rec.priority || "").toLowerCase().includes("urgent") || (rec.priority || "").includes("عاجلة") ? "#d93025" : "#1e8e3e"
        }">${rec.priority || ""}</span>
        <div><div>${rec.description || ""}</div>${
          rec.relatedItems?.length
            ? `<div style="font-size:12px;color:#5f6368;margin-top:6px">${lang === "en" ? "Related to" : "مرتبط بـ"}: ${rec.relatedItems.join(", ")}</div>`
            : ""
        }</div>
      </div>`
      )
      .join("") || `<div style="color:#64748b">${tt.none}</div>`;

  return `
  <style>
    .audit-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
    .audit-table th,.audit-table td{padding:12px;text-align:${lang === "en" ? "left" : "right"};border-bottom:1px solid #e5e7eb;vertical-align:top;word-wrap:break-word}
    .audit-table th{background:#f8fafc}
    .risk-critical td{background:#fce8e6}.risk-warning td{background:#fff0e1}.risk-ok td{background:#e6f4ea}
  </style>

  <div class="report-section">
    <h2 style="font-size:20px;font-weight:700;color:#0d47a1;border-bottom:2px solid #1a73e8;padding-bottom:8px;margin-top:0">${tt.summaryTitle}</h2>
    <p>${s?.summary?.caseOverview || tt.none}</p>
    ${
      Array.isArray(s?.summary?.keyFindings) && s.summary.keyFindings.length
        ? `<ul style="margin:6px 18px">${s.summary.keyFindings.map((x) => `<li>${x}</li>`).join("")}</ul>`
        : ""
    }
  </div>

  <div class="report-section">
    <h2 style="font-size:20px;font-weight:700;color:#0d47a1;border-bottom:2px solid #1a73e8;padding-bottom:8px">${tt.diagnosisTitle}</h2>
    <ul style="margin:6px 18px">${diagList || `<li>${tt.none}</li>`}</ul>
    <div style="color:#475569">${s?.diagnoses?.certaintyNotes || ""}</div>
  </div>

  <div class="report-section">
    <h2 style="font-size:20px;font-weight:700;color:#0d47a1;border-bottom:2px solid #1a73e8;padding-bottom:8px">${tt.risksTitle}</h2>
    ${risks || `<div style="color:#64748b">${tt.none}</div>`}
  </div>

  <div class="report-section">
    <h2 style="font-size:20px;font-weight:700;color:#0d47a1;border-bottom:2px solid #1a73e8;padding-bottom:8px">${tt.detailsTitle}</h2>
    <div style="overflow-x:auto">
      <table class="audit-table">
        <thead><tr>
          <th style="width:28%">${tt.itemHeader}</th>
          <th style="width:15%">${tt.dosageHeader}</th>
          <th style="width:15%">${tt.statusHeader}</th>
          <th style="width:15%">${tt.decisionHeader}</th>
          <th style="width:27%">${tt.justificationHeader}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>

  <div class="report-section">
    <h2 style="font-size:20px;font-weight:700;color:#0d47a1;border-bottom:2px solid #1a73e8;padding-bottom:8px">${tt.recsTitle}</h2>
    ${recs}
  </div>
  `;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) return bad(res, 500, "Server configuration error: API keys are missing.");

    const { text = "", files = [], patientInfo = null, lang = "ar", caseId } = req.body || {};
    const safeCaseId = caseId || String(Date.now());
    const safeLang = ["ar", "en"].includes(lang) ? lang : "ar";

    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files, caseId: safeCaseId, lang: safeLang });

    const auditBundle = { caseId: safeCaseId, patientInfo, aggregatedClinicalText, originalUserText: text };
    const structured = await getAuditFromOpenAI({ bundle: auditBundle, lang: safeLang, caseId: safeCaseId });

    const html = renderHtmlReport(structured, safeLang);
    return ok(res, { html, structured, caseId: safeCaseId, lang: safeLang });
  } catch (err) {
    console.error("API /api/gpt error:", err);
    return bad(res, 500, `Internal error: ${err.message || "unknown"}`);
  }
}
