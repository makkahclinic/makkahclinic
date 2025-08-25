// pages/api/audit-onecall.js
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

/** .env.local (أضف إلى مشروعك):
OPENAI_API_KEY=sk-********************************
OPENAI_MODEL=gpt-4o
*/

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

/* ======== 1) SCHEMA الصارم (Structured Outputs) ======== */
function buildJsonSchema(lang = "ar") {
  const isArabic = lang !== "en";
  return {
    name: "clinical_audit",
    strict: true, // يفرض التطابق التام مع المخطط
    schema: {
      type: "object",
      properties: {
        meta: {
          type: "object",
          properties: { caseId: { type: "string" }, lang: { type: "string" } },
          required: ["caseId"]
        },
        patientSummary: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"]
        },
        diagnoses: {
          type: "object",
          properties: {
            primary: { type: "string" },
            secondary: { type: "array", items: { type: "string" } },
            certaintyNotes: { type: "string" }
          },
          required: ["primary"]
        },
        risksAndConflicts: {
          type: "object",
          properties: {
            redFlags: { type: "array", items: { type: "string" } },
            guidelineOmissions: { type: "array", items: { type: "string" } },
            drugDrugConflicts: { type: "array", items: { type: "string" } },
            doseOrDurationErrors: { type: "array", items: { type: "string" } },
            notMedicallyNecessary: { type: "array", items: { type: "string" } }
          }
        },
        table: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              dosage_written: { type: "string" }, // اكتب "—" إن لم تُذكر الجرعة
              itemType: { type: "string", enum: ["lab", "medication", "procedure", "omission"] },
              status: { type: "string" },
              analysisCategory: { type: "string" },
              insuranceDecision: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  justification: { type: "string" }
                }
              }
            },
            required: ["name", "itemType"]
          }
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              priority: { type: "string" }, // "عاجلة|أفضل ممارسة" أو "Urgent|Best practice"
              description: { type: "string" },
              relatedItems: { type: "array", items: { type: "string" } }
            },
            required: ["priority", "description"]
          }
        }
      },
      required: ["meta", "patientSummary", "diagnoses", "table"]
    }
  };
}

/* ======== 2) HTML Renderer (اختياري—لترجيع HTML جاهز) ======== */
function renderHtmlReport(structured, files, lang = "ar") {
  const s = structured || {};
  const isArabic = lang !== "en";
  const t = (ar, en) => (isArabic ? ar : en);

  const getRiskClass = (category = "") => {
    const a = category.toLowerCase();
    if (a.includes("omission") || a.includes("إغفال") || a.includes("conflict") || a.includes("تعارض") || a.includes("dose") || a.includes("جرعة") || a.includes("duplicate")) return "risk-critical";
    if (a.includes("review") || a.includes("غير مبرر") || a.includes("تحتاج")) return "risk-warning";
    if (a.includes("correct") || a.includes("صحيح")) return "risk-ok";
    return "";
  };

  const srcDocs = (files || []).map(f => {
    const isImg = (f.mimeType || "").startsWith("image/");
    const b64 = (f.data || "").replace(/^data:[^;]+;base64,/, "");
    const src = `data:${f.mimeType};base64,${b64}`;
    return `
      <div style="margin-bottom:12px">
        <h3 style="margin:0 0 8px 0">${f.name || ""}</h3>
        ${isImg ? `<img src="${src}" alt="${f.name}" style="max-width:100%;height:auto;display:block;border-radius:8px"/>`
                : `<div style="padding:20px;border:1px dashed #e5e7eb;border-radius:8px;background:#f9fbfc;color:#6b7280;text-align:center">${f.name || ""}</div>`}
      </div>`;
  }).join("");

  const rows = (s.table || []).map(r => `
    <tr class="${getRiskClass(r.analysisCategory)}">
      <td><div style="font-weight:700">${r.name || "-"}</div><small style="color:#5f6368">${r.analysisCategory || ""}</small></td>
      <td style="font-family:monospace">${r.dosage_written || "—"}</td>
      <td>${r.status || "-"}</td>
      <td><span style="background:#e8eaed;color:#5f6368;padding:4px 8px;border-radius:12px;font-weight:700">${r.insuranceDecision?.label || "-"}</span></td>
      <td>${r.insuranceDecision?.justification || "-"}</td>
    </tr>
  `).join("");

  const risks = s.risksAndConflicts ? [
    ["redFlags", t("علامات إنذارية", "Red flags")],
    ["guidelineOmissions", t("نواقص قياسية", "Guideline omissions")],
    ["drugDrugConflicts", t("تعارضات دوائية", "Drug–drug conflicts")],
    ["doseOrDurationErrors", t("أخطاء جرعة/مدة", "Dose/Duration errors")],
    ["notMedicallyNecessary", t("غير مبرّر طبيًا", "Not medically necessary")]
  ].map(([k, title]) => {
    const arr = s.risksAndConflicts[k] || [];
    if (!arr.length) return "";
    return `<div style="margin-bottom:8px"><b>${title}:</b><ul style="margin:6px 18px">${arr.map(x=>`<li>${x}</li>`).join("")}</ul></div>`;
  }).join("") : "";

  const recs = (s.recommendations || []).map(rec => {
    const urgent = (rec.priority||"").toLowerCase().includes("urgent") || (rec.priority||"").includes("عاجلة");
    return `
      <div style="display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:8px;background:#f8f9fa;border-${isArabic?'right':'left'}:4px solid ${urgent?'#d93025':'#1e8e3e'};margin-bottom:12px">
        <span style="font-weight:700;padding:4px 10px;border-radius:8px;font-size:12px;color:#fff;background:${urgent?'#d93025':'#1e8e3e'}">${rec.priority||""}</span>
        <div>
          <div>${rec.description||""}</div>
          ${rec.relatedItems?.length ? `<div style="font-size:12px;color:#5f6368;margin-top:6px">${t("مرتبط بـ","Related to")}: ${rec.relatedItems.join(", ")}</div>` : ""}
        </div>
      </div>`;
  }).join("");

  return `
  <style>
    .audit-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
    .audit-table th,.audit-table td{padding:12px;text-align:${isArabic?"right":"left"};border-bottom:1px solid #e9ecef;vertical-align:top;word-wrap:break-word}
    .audit-table th{background:#f8f9fa}
    .risk-critical td{background:#fce8e6}.risk-warning td{background:#fff0e1}.risk-ok td{background:#e6f4ea}
  </style>
  <div class="report-section">
    <h2>${t("المستندات المصدرية","Source Documents")}</h2>
    ${srcDocs || `<div style="color:#64748b">${t("غير متوفر.","Not available.")}</div>`}
  </div>
  <div class="report-section">
    <h2>${t("ملخص الحالة والتقييم العام","Case Summary & Overall Assessment")}</h2>
    <p>${s.patientSummary?.text || t("غير متوفر.","Not available.")}</p>
    ${s.overallAssessment?.text ? `<p>${s.overallAssessment.text}</p>` : ""}
  </div>
  <div class="report-section">
    <h2>${t("التشخيصات","Diagnoses")}</h2>
    <ul style="margin:6px 18px">
      ${s?.diagnoses?.primary ? `<li><b>${t("الرئيسي:","Primary:")}</b> ${s.diagnoses.primary}</li>` : ""}
      ${Array.isArray(s?.diagnoses?.secondary)? s.diagnoses.secondary.map(d=>`<li>${d}</li>`).join("") : ""}
    </ul>
    ${s?.diagnoses?.certaintyNotes ? `<div style="color:#475569">${s.diagnoses.certaintyNotes}</div>`:""}
  </div>
  <div class="report-section">
    <h2>${t("المخاطر والتعارضات","Risks & Conflicts")}</h2>
    ${risks || `<div style="color:#64748b">${t("غير متوفر.","Not available.")}</div>`}
  </div>
  <div class="report-section">
    <h2>${t("التحليل التفصيلي للإجراءات/الأدوية","Detailed Analysis of Items")}</h2>
    <div style="overflow-x:auto">
      <table class="audit-table">
        <thead>
          <tr>
            <th style="width:28%">${t("البند","Item")}</th>
            <th style="width:15%">${t("الجرعة المكتوبة","Written Dosage")}</th>
            <th style="width:15%">${t("الحالة","Status")}</th>
            <th style="width:15%">${t("قرار التأمين","Insurance Decision")}</th>
            <th style="width:27%">${t("التبرير","Justification")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
  <div class="report-section">
    <h2>${t("التوصيات والإجراءات المقترحة","Recommendations & Proposed Actions")}</h2>
    ${recs || `<div style="color:#64748b">${t("غير متوفر.","Not available.")}</div>`}
  </div>`;
}

/* ======== 3) POST-PROCESS بسيط (منع السعر بدل الجرعة) ======== */
function sanitizeStructured(structured) {
  try {
    const s = structured || {};
    if (Array.isArray(s.table)) {
      for (const row of s.table) {
        const d = (row?.dosage_written || "").toString();
        const looksLikePrice = /(\bSAR\b|ريال|AED|USD|\d+\s*x\s*\d+\.\d{2}\s*(?:ريال|SAR))/i.test(d);
        if (looksLikePrice || d.trim() === "" ) {
          row.dosage_written = "—";
          row.analysisCategory = row.analysisCategory || "الكمية تحتاج لمراجعة";
          row.insuranceDecision = row.insuranceDecision || {};
          row.insuranceDecision.justification = row.insuranceDecision.justification || "الجرعة غير موثّقة أو تحتوي سعرًا؛ الرجاء توثيق الجرعة/التكرار/المدة.";
        }
      }
    }
    return s;
  } catch {
    return structured;
  }
}

/* ======== 4) HANDLER ======== */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Only POST is accepted.");
    if (!OPENAI_API_KEY)       return bad(res, 500, "Missing OPENAI_API_KEY.");
    const { text = "", files = [], patientInfo = null, lang = "ar", seed = null } = req.body || {};

    const safeLang = ["ar","en"].includes(lang) ? lang : "ar";
    const caseId   = String(Date.now()); // عزل الحالة

    // نبني محتوى الرسالة (نص + صور Base64)
    const content = [];
    const header = `
CASE_ID=${caseId}
STRICT CASE ISOLATION: Analyze ONLY inputs for this case.
Language: ${safeLang === "en" ? "English" : "Arabic"} (write professionally).
TASK: Read the images/text and produce the clinical audit JSON per schema. 
RULES:
1) For medications, copy dosage/frequency/duration exactly as written; if not explicitly written, put "—" (no guessing).
2) List EVERY medication/lab/procedure; add important "omission" rows for critical standard-of-care gaps.
3) Apply 90-day quantity rule when relevant (mark "quantity needs review" if stability not documented).
`.trim();

    content.push({ type: "text", text: header });
    if (text) content.push({ type: "text", text });

    for (const f of files || []) {
      const mime = f?.mimeType || "";
      const base64 = (f?.data || "").includes("base64,")
        ? f.data.split("base64,").pop()
        : (f?.data || "");
      if (mime.startsWith("image/") && base64) {
        content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } });
      } else if (f?.name) {
        content.push({ type: "text", text: `Attached (not previewed): ${f.name}` });
      }
    }

    const response_format = {
      type: "json_schema",
      json_schema: buildJsonSchema(safeLang)
    };

    const r = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        ...(seed ? { seed } : {}), // اختياري: تحسين القابلية للتكرار (غير مضمون بالكامل)
        response_format,
        messages: [
          {
            role: "system",
            content: safeLang === "en"
              ? "You are an evidence-based clinical auditor. Output JSON only per schema."
              : "أنت مدقق إكلينيكي أدلّي. أخرج JSON فقط حسب المخطط."
          },
          { role: "user", content }
        ]
      })
    });

    const data = await r.json();
    if (!r.ok) return bad(res, r.status, `OpenAI error: ${JSON.stringify(data)}`);

    const structuredRaw = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    // ضمان meta
    structuredRaw.meta = structuredRaw.meta || {};
    structuredRaw.meta.caseId = caseId;
    structuredRaw.meta.lang   = safeLang;

    // تنظيف بسيط
    const structured = sanitizeStructured(structuredRaw);

    // HTML جاهز (اختياري)
    const html = renderHtmlReport(structured, files, safeLang);

    return ok(res, { caseId, lang: safeLang, structured, html });
  } catch (err) {
    console.error("API /api/audit-onecall error:", err);
    return bad(res, 500, `Internal error: ${err.message || "unknown"}`);
  }
}

