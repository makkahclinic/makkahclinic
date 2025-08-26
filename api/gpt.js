// pages/api/gpt.js
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

/**
 * .env.local
 * ----------
 * OPENAI_API_KEY=sk-********************************
 * OPENAI_MODEL=gpt-4o
 * ALLOW_ORIGIN=https://m2020m.org    // غيّرها لنطاقك أو اتركها فارغة لتعطيل CORS
 */

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ALLOW_ORIGIN   = process.env.ALLOW_ORIGIN || "";

/* ------------------------- Helpers ------------------------- */
function withCors(res) {
  if (ALLOW_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
}
const ok  = (res, json) => { withCors(res); return res.status(200).json({ ok: true, ...json }); };
const bad = (res, code, msg) => { withCors(res); return res.status(code).json({ ok: false, error: msg }); };

async function parseJsonSafe(r) {
  const ct = r.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) return await r.json();
    const raw = await r.text();
    return { raw };
  } catch (e) {
    return { error: "parse_error", details: String(e) };
  }
}
const uniq = (arr = []) => Array.from(new Set(arr.filter(Boolean)));

/* ------------------------- Evidence DB (روابط رسمية) ------------------------- */
const EVIDENCE_DB = {
  blepharitis_first_line: {
    summary: "AAO PPP/StatPearls: نظافة الجفن والكمادات الدافئة نهج أولي؛ المضادات الموضعية لحالات مختارة.",
    urls: [
      "https://www.aao.org/Assets/92ce1735-7c83-45f0-8a58-72997bfc2375/638442007744570000/blepharitis-ppp-2-22-24-pdf",
      "https://www.ncbi.nlm.nih.gov/books/NBK459305/"
    ]
  },
  moxi_indication_conjunctivitis: {
    summary: "ملصق DailyMed: VIGAMOX® لعلاج التهاب الملتحمة الجرثومي.",
    urls: [
      // أحدث ملف ملصق متاح على DailyMed
      "https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?setid=12053b08-7e66-c6f3-e063-6394a90a9cd9&type=pdf"
    ]
  },
  dry_eye_guidance: {
    summary: "TFOS DEWS II/AAO PPP: المزلقات والتثقيف والتعديل البيئي خطوات مبكرة.",
    urls: [
      "https://www.aaojournal.org/article/S0161-6420%2824%2900012-5/pdf",
      "https://www.tearfilm.org/public/TFOSDEWSII-Executive.pdf"
    ]
  },
  refraction_policy_note: {
    summary: "CPT 92015 غالبًا غير مغطى كخدمة روتينية (مثال Medicare؛ يختلف حسب الدافع).",
    urls: [
      "https://palmettogba.com/rr/did/8eem5f7311",
      "https://www.aao.org/eyenet/article/back-to-basics-coding-for-refractions"
    ]
  },
  ada_diabetic_eye_exam: {
    summary: "ADA 2024: فحص عيني موسع مبدئيًا وسنويًا لمرضى السكري (وفق النتائج).",
    urls: [
      "https://diabetesjournals.org/care/article/47/Supplement_1/S231/153941/12-Retinopathy-Neuropathy-and-Foot-Care-Standards"
    ]
  }
};

/* ------------------------- JSON Schemas ------------------------- */
function extractionSchema(lang = "ar") {
  return {
    name: "clinical_extraction",
    strict: true,
    schema: {
      type: "object",
      properties: {
        meta: { type: "object", properties: { lang: { type: "string" } } },
        patient: {
          type: "object",
          properties: {
            name: { type: "string" }, age: { type: "string" }, gender: { type: "string" }
          }
        },
        diagnoses: { type: "array", items: { type: "string" } },
        symptoms:  { type: "array", items: { type: "string" } },
        signs:     { type: "array", items: { type: "string" } },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              itemType: { type: "string", enum: ["medication","procedure","lab","other"] },
              dosage_written:   { type: "string" },
              quantity_written: { type: "string" },
              notes:            { type: "string" }
            },
            required: ["name","itemType"]
          }
        }
      },
      required: ["diagnoses","items"]
    }
  };
}

function auditSchema(lang = "ar") {
  return {
    name: "clinical_audit",
    strict: true,
    schema: {
      type: "object",
      properties: {
        meta: { type: "object", properties: { caseId: { type: "string" }, lang: { type: "string" } }, required: ["caseId"] },
        patientSummary: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
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
              dosage_written: { type: "string" },
              itemType: { type: "string", enum: ["lab","medication","procedure","omission"] },
              status: { type: "string" },
              analysisCategory: { type: "string" },
              insuranceDecision: {
                type: "object",
                properties: { label: { type: "string" }, justification: { type: "string" } }
              },
              citations: { type: "array", items: { type: "string" } }
            },
            required: ["name","itemType"]
          }
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              priority: { type: "string" },
              description: { type: "string" },
              relatedItems: { type: "array", items: { type: "string" } },
              citations: { type: "array", items: { type: "string" } }
            },
            required: ["priority","description"]
          }
        }
      },
      required: ["meta","patientSummary","diagnoses","table"]
    }
  };
}

/* ------------------------- Builders ------------------------- */
function buildVisionContent({ text, files, lang, caseId }) {
  const content = [];
  const header = `
CASE_ID=${caseId}
STRICT CASE ISOLATION: Analyze ONLY inputs for this case.
Language: ${lang === "en" ? "English" : "Arabic"} (professional).
TASK: First, do a literal extraction ONLY (no inferences). Copy medication dosage/frequency/duration EXACTLY as written; if not explicitly written, put "—".
List every diagnosis, symptom/sign, and each medication/procedure/lab.
`.trim();
  content.push({ type: "text", text: header });
  if (text) content.push({ type: "text", text });

  for (const f of files || []) {
    const mime = f?.mimeType || "";
    const base64 = (f?.data || "").includes("base64,") ? f.data.split("base64,").pop() : (f?.data || "");
    if (mime.startsWith("image/") && base64) {
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } });
    } else if (f?.name) {
      content.push({ type: "text", text: `Attached (not previewed): ${f.name}` });
    }
  }
  return content;
}

function buildAnchorsText(extracted) {
  const dxText = (extracted?.diagnoses || []).join(" ").toLowerCase();
  const itemsText = (extracted?.items || []).map(i => i.name).join(" ").toLowerCase();

  const parts = [];
  parts.push(`General reimbursement lens: focus on medical necessity, duplication, contraindications, and unusual quantities.`);

  if (dxText.includes("blepharitis") || dxText.includes("h01") || itemsText.includes("vigamox") || itemsText.includes("moxifloxacin")) {
    parts.push(
      `Ophthalmology—Blepharitis PPP: first-line lid hygiene & warm compresses; topical antibiotics reserved for select cases. Evidence: ${EVIDENCE_DB.blepharitis_first_line.urls.join(" , ")}.`
    );
    parts.push(
      `Moxifloxacin ophthalmic (VIGAMOX) indication is bacterial conjunctivitis—if conjunctivitis isn't documented, flag as not medically justified. Evidence: ${EVIDENCE_DB.moxi_indication_conjunctivitis.urls.join(" , ")}.`
    );
  }
  if (dxText.includes("dry eye") || itemsText.includes("optifresh")) {
    parts.push(
      `Dry eye PPP/TFOS DEWS II: lubricants, education, environment changes as early steps; escalate per severity. Evidence: ${EVIDENCE_DB.dry_eye_guidance.urls.join(" , ")}.`
    );
  }
  if (itemsText.includes("refraction")) {
    parts.push(
      `Refraction (CPT 92015): coverage varies by payer; Medicare often excludes routine refraction. Evidence: ${EVIDENCE_DB.refraction_policy_note.urls.join(" , ")}.`
    );
  }
  if (dxText.includes("diabetes") || dxText.includes("dm") || dxText.includes("t2dm")) {
    parts.push(
      `ADA: annual dilated eye exam for diabetes (frequency individualized). Evidence: ${EVIDENCE_DB.ada_diabetic_eye_exam.urls.join(" , ")}.`
    );
  }
  return parts.join("\n");
}

/* ------------------------- Post-rules ------------------------- */
function enrichWithRules({ extracted, audit, patientInfo }) {
  const out = JSON.parse(JSON.stringify(audit || {}));
  const citationsFor = {
    blepharitis: EVIDENCE_DB.blepharitis_first_line.urls,
    moxi:        EVIDENCE_DB.moxi_indication_conjunctivitis.urls,
    dryeye:      EVIDENCE_DB.dry_eye_guidance.urls,
    refraction:  EVIDENCE_DB.refraction_policy_note.urls,
    ada:         EVIDENCE_DB.ada_diabetic_eye_exam.urls
  };

  const dxText = (out?.diagnoses?.primary || "") + " " + (extracted?.diagnoses || []).join(" ");
  const lowerAll = dxText.toLowerCase();

  const hasBleph = lowerAll.includes("blepharitis") || lowerAll.includes("h01");
  const tableNames = (out.table || []).map(r => (r.name || "").toLowerCase());
  const hygieneMentioned = tableNames.some(n => n.includes("lid hygiene") || n.includes("eyelid hygiene") || n.includes("نظافة") || n.includes("كمادات"));

  if (hasBleph && !hygieneMentioned) {
    out.table = out.table || [];
    out.table.push({
      name: "إرشادات نظافة الجفن والكمادات الدافئة",
      dosage_written: "—",
      itemType: "omission",
      status: "مفقود ولكنه ضروري",
      analysisCategory: "إغفال خطير",
      insuranceDecision: { label: "لا ينطبق", justification: "نهج أولي موصى به في إرشادات AAO PPP." },
      citations: citationsFor.blepharitis
    });
    out.risksAndConflicts = out.risksAndConflicts || {};
    out.risksAndConflicts.guidelineOmissions = uniq([...(out.risksAndConflicts.guidelineOmissions||[]), "Lid hygiene/warm compresses not documented"]);
  }

  const items = out.table || [];
  const hasConjunctivitis = (dxText.toLowerCase().includes("conjunctivitis"));

  for (const row of items) {
    const nm = (row.name || "").toLowerCase();
    if ((nm.includes("vigamox") || nm.includes("moxifloxacin")) && !hasConjunctivitis && hasBleph) {
      row.analysisCategory = row.analysisCategory || "غير مبرر طبياً";
      row.insuranceDecision = row.insuranceDecision || {};
      row.insuranceDecision.justification = row.insuranceDecision.justification || "الاستطباب الرسمي لـ VIGAMOX هو التهاب الملتحمة الجرثومي؛ لا يوجد توثيق كافٍ هنا.";
      row.citations = uniq([...(row.citations||[]), ...citationsFor.moxi, ...citationsFor.blepharitis]);
      out.risksAndConflicts = out.risksAndConflicts || {};
      out.risksAndConflicts.notMedicallyNecessary = uniq([...(out.risksAndConflicts.notMedicallyNecessary||[]), "Topical fluoroquinolone without documented bacterial conjunctivitis"]);
    }
    if (!row.dosage_written || row.dosage_written.trim() === "" || row.dosage_written === "Not specified" || row.dosage_written === "—") {
      row.dosage_written = "—";
      row.analysisCategory = row.analysisCategory || "خطأ في الجرعة أو التكرار";
      row.insuranceDecision = row.insuranceDecision || {};
      row.insuranceDecision.justification = row.insuranceDecision.justification || "الجرعة/التكرار/المدة غير موثّقة؛ مطلوب توثيق واضح.";
    }
    if (nm.includes("refraction")) {
      row.citations = uniq([...(row.citations||[]), ...citationsFor.refraction]);
      row.insuranceDecision = row.insuranceDecision || {};
      row.insuranceDecision.justification = row.insuranceDecision.justification || "التغطية تختلف حسب الدافع؛ كثير من السياسات تعتبرها خدمة روتينية غير مغطاة.";
    }
  }

  const hasDryEyeKeyword = lowerAll.includes("dry eye") || items.some(r => (r.name||"").toLowerCase().includes("optifresh"));
  if (hasDryEyeKeyword) {
    out.recommendations = out.recommendations || [];
    out.recommendations.push({
      priority: "أفضل ممارسة",
      description: "تعليمات استخدام المزلّقات وتعديل البيئة ومراجعة الأدوية المجفِّفة.",
      relatedItems: ["OPTIFRESH OPHTHALMIC SOLUTION"],
      citations: citationsFor.dryeye
    });
  }

  if (lowerAll.includes("diabetes") || lowerAll.includes("t2dm") || lowerAll.includes("dm")) {
    out.recommendations = out.recommendations || [];
    out.recommendations.push({
      priority: "أفضل ممارسة",
      description: "فحص قاع العين الموسع سنويًا لمرضى السكري (حسب التقييم).",
      relatedItems: [],
      citations: citationsFor.ada
    });
  }

  return out;
}

/* ------------------------- HTML Renderer ------------------------- */
function renderHtmlReport(structured, files, lang = "ar") {
  const s = structured || {};
  const isArabic = lang !== "en";
  const t = (ar, en) => (isArabic ? ar : en);
  const citeLinks = (arr=[]) => arr.map((u,i)=>`<a href="${u}" target="_blank" rel="noopener">[${i+1}]</a>`).join(" ");

  const sourceDocs = (files||[]).map(f=>{
    const isImg = (f.mimeType||"").startsWith("image/");
    const b64 = (f.data||"").replace(/^data:[^;]+;base64,/, "");
    const src = `data:${f.mimeType};base64,${b64}`;
    return `<div style="margin-bottom:12px">
      <h3 style="margin:0 0 8px 0">${f.name||""}</h3>
      ${isImg?`<img src="${src}" style="max-width:100%;height:auto;border-radius:8px" alt="${f.name||''}">`:`<div style="padding:16px;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc">${f.name||""}</div>`}
    </div>`;
  }).join("");

  const riskCls = (c="")=>{
    const s = c.toLowerCase();
    if (s.includes("omission")||s.includes("إغفال")||s.includes("conflict")||s.includes("تعارض")||s.includes("dose")||s.includes("جرعة")||s.includes("duplicate")) return "risk-critical";
    if (s.includes("review")||s.includes("غير مبرر")||s.includes("تحتاج")) return "risk-warning";
    if (s.includes("correct")||s.includes("صحيح")) return "risk-ok";
    return "";
  };

  const rows = (s.table||[]).map(r=>`
    <tr class="${riskCls(r.analysisCategory||"")}">
      <td><div style="font-weight:700">${r.name||"-"}</div><small style="color:#64748b">${r.analysisCategory||""}</small></td>
      <td style="font-family:monospace">${r.dosage_written||"—"}</td>
      <td>${r.status||"-"}</td>
      <td><span style="background:#e2e8f0;color:#0f172a;padding:4px 8px;border-radius:12px;font-weight:700">${r.insuranceDecision?.label||"-"}</span></td>
      <td>${r.insuranceDecision?.justification||"-"} ${citeLinks(r.citations)}</td>
    </tr>
  `).join("");

  const risks = s.risksAndConflicts ? [
    ["redFlags", t("علامات إنذارية","Red flags")],
    ["guidelineOmissions", t("نواقص قياسية","Guideline omissions")],
    ["drugDrugConflicts", t("تعارضات دوائية","Drug–drug conflicts")],
    ["doseOrDurationErrors", t("أخطاء جرعة/مدة","Dose/Duration errors")],
    ["notMedicallyNecessary", t("غير مبرّر طبيًا","Not medically necessary")]
  ].map(([k,title])=>{
    const arr = s.risksAndConflicts[k]||[];
    if(!arr.length) return "";
    return `<div style="margin-bottom:8px"><b>${title}:</b><ul style="margin:6px 18px">${arr.map(x=>`<li>${x}</li>`).join("")}</ul></div>`;
  }).join("") : "";

  const recs = (s.recommendations||[]).map(rec=>{
    const urgent = (rec.priority||"").toLowerCase().includes("urgent") || (rec.priority||"").includes("عاجلة");
    return `<div style="display:flex;gap:12px;padding:12px;border-radius:8px;background:#f8fafc;border-${isArabic?'right':'left'}:4px solid ${urgent?'#d93025':'#16a34a'};margin-bottom:10px">
      <span style="background:${urgent?'#d93025':'#16a34a'};color:#fff;font-weight:700;padding:4px 10px;border-radius:8px">${rec.priority||""}</span>
      <div>
        <div>${rec.description||""}</div>
        ${rec.relatedItems?.length?`<div style="font-size:12px;color:#64748b;margin-top:6px">${t("مرتبط بـ","Related to")}: ${rec.relatedItems.join(", ")}</div>`:""}
      </div>
    </div>`;
  }).join("");

  return `
  <style>
    .audit-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
    .audit-table th,.audit-table td{padding:12px;text-align:${isArabic?"right":"left"};border-bottom:1px solid #e5e7eb;vertical-align:top;word-wrap:break-word}
    .audit-table th{background:#f8fafc}
    .risk-critical td{background:#fef2f2}.risk-warning td{background:#fff7ed}.risk-ok td{background:#ecfdf5}
  </style>
  <div class="report-section">
    <h2>${t("المستندات المصدرية","Source Documents")}</h2>
    ${sourceDocs || `<div style="color:#64748b">${t("غير متوفر.","Not available.")}</div>`}
  </div>
  <div class="report-section">
    <h2>${t("ملخص الحالة والتقييم العام","Case Summary & Overall Assessment")}</h2>
    <p>${s.patientSummary?.text || t("غير متوفر.","Not available.")}</p>
  </div>
  <div class="report-section">
    <h2>${t("التشخيصات","Diagnoses")}</h2>
    <ul style="margin:6px 18px">
      ${s?.diagnoses?.primary ? `<li><b>${t("الرئيسي:","Primary:")}</b> ${s.diagnoses.primary}</li>`:""}
      ${Array.isArray(s?.diagnoses?.secondary)? s.diagnoses.secondary.map(d=>`<li>${d}</li>`).join(""):""}
    </ul>
    ${s?.diagnoses?.certaintyNotes?`<div style="color:#475569">${s.diagnoses.certaintyNotes}</div>`:""}
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

/* ------------------------- OpenAI Call ------------------------- */
async function callOpenAI({ messages, response_format, seed=null }) {
  const r = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0, ...(seed ? { seed } : {}), response_format, messages })
  });
  const data = await parseJsonSafe(r);
  if (!r.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  const content = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
}

/* ------------------------- Handler ------------------------- */
export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") { withCors(res); return res.status(204).end(); }
    if (req.method !== "POST")     return bad(res, 405, "Only POST is accepted.");
    if (!OPENAI_API_KEY)           return bad(res, 500, "Missing OPENAI_API_KEY.");

    const { text = "", files = [], patientInfo = null, lang = "ar", seed = null } = req.body || {};
    const safeLang = ["ar","en"].includes(lang) ? lang : "ar";
    const caseId   = String(Date.now());

    const extractionContent = buildVisionContent({ text, files, lang: safeLang, caseId });
    const extracted = await callOpenAI({
      messages: [
        { role: "system", content: safeLang === "en"
            ? "You are a precise medical transcription engine. Output JSON only per schema; no inferences."
            : "أنت محرك نسخ طبي دقيق. أخرج JSON فقط حسب المخطط؛ بلا استدلالات." },
        { role: "user", content: extractionContent }
      ],
      response_format: { type: "json_schema", json_schema: extractionSchema(safeLang) },
      seed
    });

    const anchors = buildAnchorsText(extracted);
    const auditMessages = [
      { role: "system", content:
        (safeLang === "en"
          ? `You are an evidence-based clinical auditor. Use the anchors below; return JSON only.
Anchors:
${anchors}
Rules:
- For each medication, copy dosage EXACTLY if present else "—" and mark a dose/frequency error.
- List every item (med/lab/procedure) AND important omissions as separate "omission" rows.
- Flag not medically justified items; add short payer coverage note for refraction.
- Keep language ${safeLang}.`
          : `أنت مدقق إكلينيكي مبني على الدليل. استخدم المراجع التالية؛ أعد JSON فقط.
Anchors:
${anchors}
قواعد:
- لكل دواء: إن وُثقت الجرعة/التكرار/المدة انسخها حرفيًا، وإلا اكتب "—" وعلّم خطأ جرعة/مدة.
- أدرج كل البنود (دواء/تحليل/إجراء) والإغفالات كبنود "omission".
- علّم البنود غير المبررة طبيًا؛ أضف ملاحظة تغطية مختصرة لفحص الانكسار.
- اكتب بلغة ${safeLang}.`)
      },
      { role: "user", content: `Patient info:\n${JSON.stringify(patientInfo || {}, null, 2)}\n\nExtracted data:\n${JSON.stringify(extracted, null, 2)}\n\nReturn ONLY JSON.` }
    ];
    const auditRaw = await callOpenAI({
      messages: auditMessages,
      response_format: { type: "json_schema", json_schema: auditSchema(safeLang) },
      seed
    });

    const audited = enrichWithRules({ extracted, audit: auditRaw, patientInfo });
    audited.meta = audited.meta || {}; audited.meta.caseId = caseId; audited.meta.lang = safeLang;

    const html = renderHtmlReport(audited, files, safeLang);
    return ok(res, { caseId, lang: safeLang, extracted, structured: audited, html, evidence: EVIDENCE_DB });
  } catch (err) {
    console.error("API /api/gpt error:", err);
    return bad(res, 500, `Internal error: ${err.message || "unknown"}`);
  }
}
