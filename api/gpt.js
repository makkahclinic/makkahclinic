// pages/api/gpt.js
// ============================================================================
// Backend: Gemini OCR + OpenAI Clinical Reasoning + RxNorm + openFDA
// Author: Hussein’s AI backend
// Runtime: Next.js API Route (Node 18+ / Vercel)
// ============================================================================

/* ====== ENV ======
 * Required:
 * - OPENAI_API_KEY      : OpenAI API key
 * - GEMINI_API_KEY      : Google AI (Gemini) API key
 *
 * Optional:
 * - OPENAI_MODEL        : default "gpt-4o-mini"
 * - GEMINI_MODEL        : default "gemini-1.5-flash"
 * - DRUGBANK_API_KEY    : (اختياري) للتكامل المدفوع مع DrugBank؛ إن وُجد يستخدم بدلاً من تحليل التفاعل النصي
 * - BACKEND_MAX_MB      : حد أقصى لحجم الطلب (افتراضي 20MB)
 */

import OpenAI from "openai";
// FIX: Corrected import for Google Generative AI
import { GoogleGenerativeAI } from "@google/generative-ai";

// ------------------------------ CONFIG --------------------------------------
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash"; // Using 1.5 Flash for better capabilities
const MAX_TOTAL_BYTES = (parseInt(process.env.BACKEND_MAX_MB || "20", 10)) * 1024 * 1024;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// FIX: Corrected instantiation of the Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ------------------------------ HELPERS -------------------------------------
function jsonSafeParse(s, fallback = null) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function detectMimeTypeFromBase64(b64) {
  if (!b64) return "application/octet-stream";
  if (b64.startsWith("JVBERi0")) return "application/pdf";
  if (b64.startsWith("iVBORw0")) return "image/png";
  if (b64.startsWith("/9j/"))   return "image/jpeg";
  if (b64.startsWith("UklGR"))   return "image/webp";
  return "application/octet-stream";
}

function langStrings(lang = "ar") {
  const ar = {
    title: "تقرير التقييم السريري",
    traffic: { green:"🟢 مقبول تمامًا", yellow:"🟡 مقبول بشروط", red:"🔴 مرفوض" },
    sections: {
      summary: "الخلاصة",
      patient: "بيانات المريض",
      meds: "الأدوية وتحذيرات السلامة",
      interactions: "التداخلات الدوائية",
      gaps: "نواقص البيانات المطلوبة",
      plan: "خطة المتابعة والبدائل",
      refs: "المراجع وروابط التحقق"
    },
    disclaim: "تنبيه: هذا التقرير دعمٌ سريري آلي يعتمد على مصادر موثوقة لكنه لا يُعد بديلاً عن رأي الطبيب المعالج."
  };
  const en = {
    title: "Clinical Safety Assessment",
    traffic: { green:"🟢 Green: Acceptable", yellow:"🟡 Yellow: Conditional", red:"🔴 Red: Not acceptable" },
    sections: {
      summary: "Summary",
      patient: "Patient Data",
      meds: "Medications & Safety Warnings",
      interactions: "Drug–Drug Interactions",
      gaps: "Missing Data",
      plan: "Monitoring & Alternatives",
      refs: "References & Verification Links"
    },
    disclaim: "Disclaimer: This AI-generated report uses reputable sources but is not a substitute for clinician judgment."
  };
  return lang === "en" ? en : ar;
}

function sumBase64Bytes(files=[]) {
  let total = 0;
  for (const f of files) {
    if (f?.data) total += Buffer.byteLength(f.data, "base64");
  }
  return total;
}

function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))); }

function buildReferencesList() {
  return [
    { name: "openFDA Drug Labeling API", url: "https://open.fda.gov/apis/drug/label/" },
    { name: "FDA Pregnancy & Lactation Labeling (PLLR)", url: "https://www.fda.gov/drugs/labeling/pregnancy-and-lactation-labeling-drugs-final-rule" },
    { name: "LactMed (NLM/NIH)", url: "https://www.ncbi.nlm.nih.gov/books/NBK501922/" },
    { name: "LiverTox (NIDDK/NIH)", url: "https://www.ncbi.nlm.nih.gov/books/NBK547852/" },
    { name: "ADA Standards of Care 2025", url: "https://professional.diabetes.org/standards-of-care" },
    { name: "KDIGO CKD Guideline 2024 (PDF)", url: "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf" },
    { name: "2023 AGS Beers Criteria (overview/news)", url: "https://gwep.usc.edu/2023-ags-beers-criteria/" },
    { name: "AAO Preferred Practice Patterns", url: "https://www.aao.org/education/preferred-practice-patterns" }
  ];
}

// ------------------------------ RxNorm + openFDA ----------------------------
async function rxnormApproximateTerm(drugName) {
  const url = `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(drugName)}&maxEntries=1`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  const cand = data?.approximateGroup?.candidate?.[0];
  if (!cand?.rxcui) return null;
  return { rxcui: String(cand.rxcui), score: cand.score };
}

async function openfdaFetchLabelByName(drugName) {
  const q = `openfda.substance_name:"${drugName}" OR openfda.generic_name:"${drugName}"`;
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(q)}&limit=1`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  const rec = data?.results?.[0] || null;
  if (!rec) return null;
  const pick = (k) => (rec[k] && Array.isArray(rec[k]) ? rec[k][0] : null);
  return {
    pregnancy: pick("pregnancy") || pick("pregnancy_or_breast_feeding"),
    lactation: pick("lactation"),
    interactions_text: pick("drug_interactions"),
    warnings: pick("warnings") || pick("warnings_and_cautions") || pick("warnings_and_precautions"),
    renal_text: (pick("use_in_specific_populations") || pick("dosage_and_administration") || "").match(/renal|kidney/i) ? (pick("use_in_specific_populations") || pick("dosage_and_administration")) : null,
    hepatic_text: (pick("use_in_specific_populations") || pick("dosage_and_administration") || "").match(/hepatic|liver/i) ? (pick("use_in_specific_populations") || pick("dosage_and_administration")) : null,
    brand: rec?.openfda?.brand_name?.[0] || null,
    generic: rec?.openfda?.generic_name?.[0] || null
  };
}

// ------------------------------ Gemini OCR ----------------------------------
// FIX: Rewrote function to use the correct Gemini API syntax and send file data inline.
async function geminiUploadAndOcrFiles(files = []) {
  const ocrResults = [];
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  });

  for (const f of files) {
    const mimeType = f.type || detectMimeTypeFromBase64(f.data);

    const prompt = [
      "You are a clinical OCR specialist. Read this file (image/PDF/lab report/handwritten prescription).",
      "Return a STRICT JSON object with fields:",
      "{ extracted_text: string,",
      "  patient: { age?: number, sex?: 'male'|'female'|null, pregnant?: boolean|null, pregnancy_month?: number|null },",
      "  diagnoses: string[],",
      "  allergies: string[],",
      "  medications: [{ raw: string }],",
      "  labs: [{ name: string, value: string }],",
      "  imaging_findings: string[] }",
      "If handwriting is unclear, mark segments with '?'."
    ].join(" ");

    const imagePart = {
        inlineData: {
            data: f.data,
            mimeType: mimeType,
        },
    };

    const resp = await model.generateContent([prompt, imagePart]);
    const text = resp?.response?.text() || "{}";
    const parsed = jsonSafeParse(text, { extracted_text: "", diagnoses: [], medications: [], labs: [], imaging_findings: [], patient: {} });

    ocrResults.push({
      file_name: f.name || "file",
      mimeType,
      extracted: parsed
    });
  }

  return ocrResults;
}


// ------------------------------ DDI (pluggable) -----------------------------
// FIX: Rewrote function to use the correct OpenAI API method `chat.completions.create` and parameters.
async function deriveInteractionsViaLabelLLM(medsAnnotated, lang = "ar") {
  if (medsAnnotated.length < 2) return [];

  const labelSnippets = medsAnnotated.map(m => `### ${m.normalizedName}\n${m.label?.interactions_text || "No label interactions section found."}`).join("\n\n");

  const system = lang === "ar"
    ? "أنت صيدلي سريري. حلّل النصوص المأخوذة من drug_interactions في نشرات FDA واستخرج التداخلات الثنائية بشكل منظم."
    : "You are a clinical pharmacist. Analyze FDA label 'drug_interactions' snippets and extract pairwise interactions in structured form.";

  const userPrompt = `Return ONLY a valid JSON object with a "pairs" key. The schema for each pair is: {"drugA":"string","drugB":"string","mechanism":"string","severity":"contraindicated|major|moderate|minor","action":"string"}. If no interactions are found, return {"pairs":[]}.\n\nTexts:\n${labelSnippets}`;

  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" }
  });

  const content = resp?.choices?.[0]?.message?.content || "{}";
  const out = jsonSafeParse(content, { pairs: [] });
  return out.pairs || [];
}

// ------------------------------ Final Clinical Synthesis --------------------
// FIX: Rewrote function to use the correct OpenAI API method `chat.completions.create` and parameters.
async function openaiClinicalDecision(payload) {
  const schema = {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["green","yellow","red"] },
      rationale_ar: { type: "string" },
      rationale_en: { type: "string" },
      missing_data: { type: "array", items: { type: "string" } },
      suggested_tests: { type: "array", items: { type: "string" } },
      monitoring_plan_ar: { type: "array", items: { type: "string" } },
      monitoring_plan_en: { type: "array", items: { type: "string" } },
      safer_alternatives_ar: { type: "array", items: { type: "string" } },
      safer_alternatives_en: { type: "array", items: { type: "string" } }
    },
    required: ["decision","rationale_ar","rationale_en"],
    additionalProperties: false
  };

  const sys = `You are a conservative internal medicine + clinical pharmacology assistant. Use ONLY the provided label snippets and guideline snippets to avoid hallucinations. Prefer safety (err on the side of RED/YELLOW if uncertain). Output should be guideline-grounded.`;

  const usr = `
Patient:
${JSON.stringify(payload.patient, null, 2)}

Medications (normalized):
${JSON.stringify(payload.medsAnnotated, null, 2)}

Label snippets (openFDA):
${JSON.stringify(payload.labelSnippets, null, 2)}

Known/parsed DDI pairs:
${JSON.stringify(payload.interactions, null, 2)}

Guideline snippets:
${payload.guidelineSnippets}

Return ONLY a valid JSON object that strictly follows the provided schema. Output should be bilingual (Arabic/English). Do not add any extra text or markdown.
Schema:
${JSON.stringify(schema, null, 2)}`;

  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr }
    ],
    response_format: { type: "json_object" }
  });

  const content = resp?.choices?.[0]?.message?.content || "{}";
  return jsonSafeParse(content, {});
}

// ------------------------------ HTML Report Builder -------------------------
function buildHtmlReport({ langPref = "ar", patient, medsAnnotated, interactions, decision, synthesis, references }) {
  const L_ar = langStrings("ar");
  const L_en = langStrings("en");

  function medsTable(lang="ar") {
    const hdr = lang === "ar"
      ? `<tr><th>الدواء</th><th>Pregnancy/Lactation</th><th>Renal/Hepatic</th><th>تحذيرات</th></tr>`
      : `<tr><th>Drug</th><th>Pregnancy/Lactation</th><th>Renal/Hepatic</th><th>Warnings</th></tr>`;
    const rows = medsAnnotated.map(m => {
      const pl = [
        m.label?.pregnancy ? "Pregnancy: ✓" : "",
        m.label?.lactation ? "Lactation: ✓" : ""
      ].filter(Boolean).join(" / ") || "—";
      const rh = [
        m.label?.renal_text ? "Renal: ✓" : "",
        m.label?.hepatic_text ? "Hepatic: ✓" : ""
      ].filter(Boolean).join(" / ") || "—";
      const warn = (m.label?.warnings ? "✓" : "—");
      return `<tr><td>${m.normalizedName || m.inputName}</td><td>${pl}</td><td>${rh}</td><td>${warn}</td></tr>`;
    }).join("");
    return `<table>${hdr}${rows}</table>`;
  }

  const trafficBadge = (d, lang="ar") => {
    const L = lang === "ar" ? L_ar : L_en;
    const map = { green: L.traffic.green, yellow: L.traffic.yellow, red: L.traffic.red };
    const cls = d === "green" ? "risk-low" : d === "yellow" ? "risk-medium" : "risk-high";
    return `<span class="${cls}">${map[d] || d}</span>`;
  };

  const refsHtml = references.map(r => `<li><a href="${r.url}" target="_blank" rel="noopener">${r.name}</a></li>`).join("");

  const ar = `
  <h3>${L_ar.title} ${trafficBadge(decision,"ar")}</h3>
  <h4>• ${L_ar.sections.summary}</h4>
  <p>${synthesis.rationale_ar || ""}</p>

  <h4>• ${L_ar.sections.patient}</h4>
  <pre>${escapeHtml(JSON.stringify(patient, null, 2))}</pre>

  <h4>• ${L_ar.sections.meds}</h4>
  ${medsTable("ar")}

  <h4>• ${L_ar.sections.interactions}</h4>
  ${interactions?.length ? `<ul>${interactions.map(i => `<li>${i.drugA} + ${i.drugB} — ${i.severity} — ${i.action || ""}</li>`).join("")}</ul>` : "<p>—</p>"}

  <h4>• ${L_ar.sections.gaps}</h4>
  ${synthesis.missing_data?.length ? `<ul>${synthesis.missing_data.map(x => `<li>${x}</li>`).join("")}</ul>` : "<p>—</p>"}

  <h4>• ${L_ar.sections.plan}</h4>
  ${synthesis.monitoring_plan_ar?.length ? `<ul>${synthesis.monitoring_plan_ar.map(x => `<li>${x}</li>`).join("")}</ul>` : "<p>—</p>"}
  ${synthesis.safer_alternatives_ar?.length ? `<p><strong>بدائل أكثر أمانًا:</strong></p><ul>${synthesis.safer_alternatives_ar.map(x => `<li>${x}</li>`).join("")}</ul>` : ""}

  <h4>• ${L_ar.sections.refs}</h4>
  <ul>${refsHtml}</ul>
  <div class="muted-mini">${L_ar.disclaim}</div>
  `;

  const en = `
  <h3>${L_en.title} ${trafficBadge(decision,"en")}</h3>
  <h4>• ${L_en.sections.summary}</h4>
  <p>${synthesis.rationale_en || ""}</p>

  <h4>• ${L_en.sections.patient}</h4>
  <pre>${escapeHtml(JSON.stringify(patient, null, 2))}</pre>

  <h4>• ${L_en.sections.meds}</h4>
  ${medsTable("en")}

  <h4>• ${L_en.sections.interactions}</h4>
  ${interactions?.length ? `<ul>${interactions.map(i => `<li>${i.drugA} + ${i.drugB} — ${i.severity} — ${i.action || ""}</li>`).join("")}</ul>` : "<p>—</p>"}

  <h4>• ${L_en.sections.gaps}</h4>
  ${synthesis.missing_data?.length ? `<ul>${synthesis.missing_data.map(x => `<li>${x}</li>`).join("")}</ul>` : "<p>—</p>"}

  <h4>• ${L_en.sections.plan}</h4>
  ${synthesis.monitoring_plan_en?.length ? `<ul>${synthesis.monitoring_plan_en.map(x => `<li>${x}</li>`).join("")}</ul>` : "<p>—</p>"}
  ${synthesis.safer_alternatives_en?.length ? `<p><strong>Safer alternatives:</strong></p><ul>${synthesis.safer_alternatives_en.map(x => `<li>${x}</li>`).join("")}</ul>` : ""}

  <h4>• ${L_en.sections.refs}</h4>
  <ul>${refsHtml}</ul>
  <div class="muted-mini">${L_en.disclaim}</div>
  `;

  return `
  <style>
    .risk-high{color:#721c24;background:#f8d7da;padding:.18rem .5rem;border-radius:6px;border:1px solid #f5c6cb;font-weight:700;display:inline-block}
    .risk-medium{color:#856404;background:#fff3cd;padding:.18rem .5rem;border-radius:6px;border:1px solid #ffeeba;font-weight:700;display:inline-block}
    .risk-low{color:#155724;background:#d4edda;padding:.18rem .5rem;border-radius:6px;border:1px solid #c3e6cb;font-weight:700;display:inline-block}
    table{width:100%;border-collapse:collapse;margin-top:.5rem}
    th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:inherit}
    th{background:#eef6ff;color:#0b63c2}
    .muted-mini{color:#6b7280;font-size:.9rem;margin-top:.6rem}
    pre{white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px}
    h3,h4{color:#0b63c2}
  </style>
  <div dir="rtl" lang="ar">${ar}</div><hr/>
  <div dir="ltr" lang="en">${en}</div>`;
}

function escapeHtml(s="") {
  return s.replace(/[&<>'"]/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}

// ------------------------------ MAIN HANDLER --------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, detail: "Method not allowed" });
  }
  try {
    const body = req.body || {};
    const {
      age, gender,
      isPregnant, pregnancyMonth,
      isSmoker, packYears,
      coughDurationWeeks, visualSymptoms, lastEyeExamDate, visualAcuity,
      notes, diagnosis, labResults, medications,
      files = []
    } = body;

    // Payload size guard
    const totalBytes = sumBase64Bytes(files);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return res.status(413).json({ ok:false, detail:"Payload too large", maxMB: MAX_TOTAL_BYTES/1024/1024 });
    }

    // 1) OCR via Gemini (images/PDFs), extract structured hints
    const ocrResults = files?.length ? await geminiUploadAndOcrFiles(files) : [];

    // 2) Merge patient data (front-end + OCR hints)
    const patient = {
      age: Number(age) || null,
      sex: gender || null,
      pregnant: !!isPregnant || null,
      pregnancy_month: Number(pregnancyMonth) || null,
      smoker: !!isSmoker || null,
      pack_years: packYears || null,
      cough_weeks: Number(coughDurationWeeks) || null,
      eye_symptoms: visualSymptoms || null,
      last_eye_exam: lastEyeExamDate || null,
      visual_acuity: visualAcuity || null,
      notes: notes || "",
      diagnosis_text: diagnosis || "",
      labs_text: labResults || "",
      allergies_text: (ocrResults?.[0]?.extracted?.allergies || []).join(", ") || ""
    };

    // 3) Candidate med list (front-end text + OCR meds)
    const medsRaw = uniq([
      ...(String(medications||"").split(/\n|,|;|\r/).map(s=>s.trim()).filter(Boolean)),
      ...ocrResults.flatMap(r => (r.extracted?.medications||[]).map(m=> (m.raw||"").trim()).filter(Boolean))
    ]);

    // 4) Normalize names via RxNorm + fetch openFDA label
    const medsAnnotated = [];
    for (const raw of medsRaw) {
      const cleaned = raw.replace(/\s{2,}/g, " ").replace(/[\.\,]$/,"");
      const baseName = cleaned.split(/\s+\d+/)[0].replace(/[^A-Za-z\s\-]/g," ").trim();
      let rxcuiObj = null;
      if (baseName) {
        try { rxcuiObj = await rxnormApproximateTerm(baseName); } catch {}
      }
      let label = null;
      try { label = await openfdaFetchLabelByName(baseName || cleaned); } catch {}
      medsAnnotated.push({
        inputName: raw,
        normalizedName: label?.generic || baseName || raw,
        rxcui: rxcuiObj?.rxcui || null,
        label,
        lactmed_url: baseName ? `https://www.ncbi.nlm.nih.gov/books/?term=${encodeURIComponent(baseName)}+lactmed` : null
      });
    }

    // 5) Interactions (label-derived + LLM structuring)
    const interactions = await deriveInteractionsViaLabelLLM(medsAnnotated, "ar");

    // 6) Provide compact guideline snippets
    const guidelineSnippets = `
[ADA 2025] Use current ADA Standards for glycemic treatment, CKD risk, and older adults.
[KDIGO 2024] eGFR-based adjustments & CKD risk stratification; avoid nephrotoxins; RAASi/SGLT2 use per albuminuria/eGFR.
[PLLR] Use 'Pregnancy' & 'Lactation' sections rather than letter categories.
[Beers 2023] Flag potentially inappropriate meds in older adults (anticholinergics, certain sulfonylureas, long-acting benzos, etc.).
[LiverTox] Check hepatotoxicity profiles for each agent if abnormal LFTs / CLD.`;

    // 7) Final clinical synthesis with OpenAI
    const labelSnippets = medsAnnotated.map(m => ({
      drug: m.normalizedName,
      pregnancy: m?.label?.pregnancy || null,
      lactation: m?.label?.lactation || null,
      warnings: m?.label?.warnings || null,
      renal: m?.label?.renal_text || null,
      hepatic: m?.label?.hepatic_text || null,
      interactions_text: m?.label?.interactions_text || null
    }));

    const synthesis = await openaiClinicalDecision({
      patient, medsAnnotated, interactions, labelSnippets, guidelineSnippets
    });

    const decision = synthesis?.decision || "yellow";
    const references = buildReferencesList();

    // 8) HTML + JSON output
    const htmlReport = buildHtmlReport({
      langPref: "ar",
      patient, medsAnnotated, interactions, decision, synthesis, references
    });

    return res.status(200).json({
      ok: true,
      decision,
      patient,
      medications: medsAnnotated,
      interactions,
      missingData: synthesis?.missing_data || [],
      suggestedTests: synthesis?.suggested_tests || [],
      monitoringPlan: {
        ar: synthesis?.monitoring_plan_ar || [],
        en: synthesis?.monitoring_plan_en || []
      },
      saferAlternatives: {
        ar: synthesis?.safer_alternatives_ar || [],
        en: synthesis?.safer_alternatives_en || []
      },
      references,
      ocrResults,
      htmlReport
    });
  } catch (err) {
    console.error("API error:", err);
    // Add more details to the error message for better debugging
    const errorMessage = err instanceof Error ? err.message : "An unknown server error occurred";
    return res.status(500).json({ ok: false, detail: errorMessage });
  }
}
