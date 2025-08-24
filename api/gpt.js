// pages/api/gpt.js

// توسيع حجم جسم الطلب للصور/الـPDF
export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

// --- الإعدادات الرئيسية ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// --- دوال مساعدة ---
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (response) =>
  (response.headers.get("content-type") || "").includes("application/json")
    ? response.json()
    : { raw: await response.text() };

// --- رفع ملف (Base64) إلى Gemini Files API (Resumable) ---
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, "base64");

  // 1) بدء جلسة الرفع
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

  // 2) الرفع ثم finalize
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

// --- المرحلة الأولى: تجميع البيانات السريرية (Gemini) ---
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });

  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "");
    if (!base64Data) continue;
    const { uri, mime: finalMime } = await geminiUploadBase64({
      name: file?.name || "file",
      mimeType: mime,
      base64: base64Data,
    });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }

  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every single piece of clinical information into a clean, comprehensive text block.
CRITICAL RULES:
1) DO NOT SUMMARIZE. Transcribe everything.
2) List all patient details, diagnoses, and every single lab test, medication, and procedure mentioned.
3) For medications, transcribe the name and, on the same line, state dosage, frequency, duration exactly as written (e.g., Amlodipine 10 - 1x1x90).
4) Present the information in a clear, structured manner.`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
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

// --- تعليمات المدقق الخبير (تم فتح التوصيات بلا حد) ---
function getExpertAuditorInstructions(lang = 'ar') {
  const langConfig = {
    ar: {
      rule: "**قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية.**",
      schema: {
        patientSummary: {"text": "ملخص تفصيلي لحالة المريض الحالية والتشخيصات."},
        overallAssessment: {"text": "رأيك الخبير الشامل حول جودة الرعاية، مع تسليط الضوء على القرارات الصحيحة والإغفالات والإجراءات الخاطئة."},
        table: [
          {
            "name": "string",
            "dosage_written": "string",
            "itemType": "lab|medication|procedure",
            "status": "تم إجراؤه|مفقود ولكنه ضروري",
            "analysisCategory": "صحيح ومبرر|إجراء مكرر|غير مبرر طبياً|إجراء يتعارض مع التشخيص|إغفال خطير|خطأ في الجرعة أو التكرار|الكمية تحتاج لمراجعة",
            "insuranceDecision": {"label": "مقبول|مرفوض|لا ينطبق", "justification": "string"}
          }
        ],
        recommendations: [ { "priority": "عاجلة|أفضل ممارسة", "description": "string", "relatedItems": ["string"] } ]
      }
    },
  };
  const selectedLang = langConfig[lang] || langConfig['ar'];

  return `You are an expert, evidence-based clinical pharmacist and medical auditor. Respond with a valid JSON object.

**Primary Knowledge Base (examples)**:
• Cardiology (AHA/ACC): ECG within ~10 minutes and serial high-sensitivity troponin for suspected ACS in appropriate settings.  
• Endocrinology (ADA): Retinal screening at diagnosis and at recommended intervals; often annually, possibly 1–2 years if no retinopathy and good control.  
• Pharmacology: Gliclazide MR (Diamicron MR) is generally dosed **once daily** (30–120 mg/day).

**Mandatory Analysis Rules:**

**Rule 0: Comprehensive Listing (MOST IMPORTANT):**
The final JSON \`table\` MUST contain one entry for EVERY SINGLE medication, lab, and procedure from the clinical data. DO NOT OMIT ANY ITEM.
• For correct items: \`analysisCategory\` = "صحيح ومبرر".
• For each medication: fill \`dosage_written\` exactly (e.g., "10 1x1x90", "30 1x2x90").

**Rule 1: Clinical Validity Analysis:** Flag dosing/frequency errors, medical unnecessity, contraindications—justify precisely.

**Rule 2: Prescription Duration (90-Day Rule):** If stability not documented for chronic meds, use "الكمية تحتاج لمراجعة" مع تبرير واضح.

**Rule 3: Standard of Care Omissions:** Identify and list Critical Omissions (e.g., ECG/Troponin/Fundus exam when indicated).

**Recommendations — NO CAP:** Produce one recommendation per issue or omission. There is NO maximum; include them all (0..50). Do NOT summarize down to top 3.

${selectedLang.rule}

**Your response must be ONLY the valid JSON object conforming to this exact schema. Do not include any other text.**
\`\`\`json
${JSON.stringify(selectedLang.schema, null, 2)}
\`\`\``;
}

// --- تواصل مع OpenAI (JSON Mode + حدود أعلى) ---
async function getAuditFromOpenAI(bundle, lang) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [
        { role: "system", content: getExpertAuditorInstructions(lang) },
        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

// --- عارض التقرير (يُعيد HTML داخل CSS خاص) ---
function renderHtmlReport(structuredData, files, lang = 'ar') {
  const s = structuredData;
  const isArabic = lang === 'ar';
  const text = {
    sourceDocsTitle: isArabic ? "المستندات المصدرية" : "Source Documents",
    summaryTitle: isArabic ? "ملخص الحالة والتقييم العام" : "Case Summary & Overall Assessment",
    detailsTitle: isArabic ? "التحليل التفصيلي للإجراءات" : "Detailed Analysis of Procedures",
    recommendationsTitle: isArabic ? "التوصيات والإجراءات المقترحة" : "Recommendations & Proposed Actions",
    itemHeader: isArabic ? "الإجراء" : "Item",
    dosageHeader: isArabic ? "الجرعة المكتوبة" : "Written Dosage",
    statusHeader: isArabic ? "الحالة" : "Status",
    decisionHeader: isArabic ? "قرار التأمين" : "Insurance Decision",
    justificationHeader: isArabic ? "التبرير" : "Justification",
    relatedTo: isArabic ? "مرتبط بـ" : "Related to",
    notAvailable: isArabic ? "غير متوفر." : "Not available."
  };

  const getRiskClass = (category) => {
    const c = (category || '').toLowerCase();
    if (c.includes('إغفال') || c.includes('omission') || c.includes('يتعارض') || c.includes('contradict') || c.includes('خطأ في الجرعة') || c.includes('dosing')) return 'risk-critical';
    if (c.includes('مكرر') || c.includes('duplicate') || c.includes('غير مبرر') || c.includes('not justified') || c.includes('تحتاج لمراجعة') || c.includes('requires review')) return 'risk-warning';
    if (c.includes('صحيح') || c.includes('correct')) return 'risk-ok';
    return '';
  };

  const rows = (s.table || []).map(r => `
    <tr class="${getRiskClass(r.analysisCategory)}">
      <td class="item-cell">
        <div class="item-name">${r.name || '-'}</div>
        <small class="item-category">${r.analysisCategory || ''}</small>
      </td>
      <td class="dosage-cell">${r.dosage_written || '-'}</td>
      <td>${r.status || '-'}</td>
      <td><span class="decision-badge">${r.insuranceDecision?.label || '-'}</span></td>
      <td>${r.insuranceDecision?.justification || '-'}</td>
    </tr>
  `).join("");

  const sourceDocsHtml = (files || []).map(f => {
    const isImg = (f.mimeType || '').startsWith('image/');
    const src = `data:${f.mimeType};base64,${f.data}`;
    const filePreview = isImg
      ? `<a href="${src}" target="_blank" rel="noopener" title="عرض بالحجم الكامل"><img class="doc-thumb" src="${src}" alt="${f.name}" loading="lazy" /></a>`
      : `<div class="doc-nonimg">${f.name}</div>`;
    return `<div class="source-doc-card"><div class="source-doc-name">${f.name}</div>${filePreview}</div>`;
  }).join('');

  const recs = (s.recommendations || []).map(rec => {
    const pr = (rec.priority || '').toLowerCase();
    const urgent = pr.includes('urgent') || pr.includes('عاجلة');
    return `<div class="rec-item ${urgent ? 'urgent-border' : 'best-practice-border'}">
      <span class="rec-priority ${urgent ? 'urgent' : 'best-practice'}">${rec.priority || ''}</span>
      <div class="rec-content">
        <div class="rec-desc">${rec.description || ''}</div>
        ${rec.relatedItems?.length ? `<div class="rec-related">${text.relatedTo}: ${rec.relatedItems.join(', ')}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
    body { direction: ${isArabic ? 'rtl' : 'ltr'}; font-family: 'Tajawal', sans-serif; background-color: #f8f9fa; color: #3c4043; line-height: 1.6; }

    .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 24px; padding: 24px; background: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.05); page-break-inside: avoid; }
    .report-section h2 { font-size: 22px; font-weight: 700; color: #0d47a1; margin: 0 0 20px; display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1a73e8; padding-bottom: 12px; }

    /* شبكة مصغّرات للملفات المصدرية */
    .source-docs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
    .source-doc-card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; background:#fcfdff; }
    .source-doc-name { font-size: 12px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:6px }
    .doc-thumb { display:block; width:100%; height:180px; object-fit:contain; background:#f1f5f9; border-radius:8px }
    .doc-nonimg { padding:20px; border:1px dashed #e5e7eb; border-radius:8px; background:#f9fbfc; color:#6b7280; text-align:center; }
    @media print { .doc-thumb { max-height:120mm; height:auto; object-fit:contain } }

    .audit-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:14px; }
    .audit-table th, .audit-table td { padding:12px; text-align:${isArabic ? 'right' : 'left'}; border-bottom:1px solid #e9ecef; vertical-align:top; word-wrap:break-word; }
    .audit-table th { background:#f8f9fa; font-weight:700; }
    .audit-table tr { page-break-inside:avoid; }
    .item-cell .item-name { font-weight:700; color:#202124; font-size:15px; margin:0 0 4px 0; }
    .item-cell .item-category { font-size:12px; font-weight:500; color:#5f6368; display:block; }
    .dosage-cell { font-family: monospace, sans-serif; color:#3d3d3d; font-size:14px; white-space:nowrap; }
    .decision-badge { font-weight:700; padding:5px 10px; border-radius:16px; font-size:13px; display:inline-block; border:1px solid transparent; background:#e8eaed; color:#5f6368; }

    .rec-item { display:flex; gap:16px; align-items:flex-start; margin-bottom:12px; padding:14px; border-radius:8px; background:#f8f9fa; border-${isArabic ? 'right' : 'left'}:4px solid; page-break-inside:avoid; }
    .rec-priority { flex-shrink:0; font-weight:700; padding:5px 12px; border-radius:8px; font-size:12px; color:#fff; }
    .rec-priority.urgent { background:#d93025; }
    .rec-priority.best-practice { background:#1e8e3e; }
    .rec-item.urgent-border { border-color:#d93025; }
    .rec-item.best-practice-border { border-color:#1e8e3e; }
    .rec-content { display:flex; flex-direction:column; }
    .rec-desc { color:#202124; font-size:15px; }
    .rec-related { font-size:12px; color:#5f6368; margin-top:6px; }

    .audit-table tr.risk-critical td { background:#fce8e6 !important; }
    .audit-table tr.risk-warning td { background:#fff0e1 !important; }
    .audit-table tr.risk-ok td { background:#e6f4ea !important; }
    .audit-table tr.risk-ok td .decision-badge { background:#e6f4ea; color:#1e8e3e; }
    .audit-table tr.risk-critical td .decision-badge { background:#fce8e6; color:#d93025; }
  </style>

  <div class="report-section">
    <h2>${text.sourceDocsTitle}</h2>
    <div class="source-docs-grid">${sourceDocsHtml}</div>
  </div>

  <div class="report-section">
    <h2>${text.summaryTitle}</h2>
    <p class="summary-text">${s.patientSummary?.text || text.notAvailable}</p>
    <p class="summary-text">${s.overallAssessment?.text || text.notAvailable}</p>
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

// --- معالج الطلبات ---
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed: Only POST");

    if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
      return bad(res, 500, "Server Configuration Error: Missing API keys.");
    }

    const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body || {};

    // 1) تجميع بيانات سريرية من الصور/النص (Gemini)
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });

    // 2) تدقيق خبير (OpenAI) مع JSON منضبط
    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };
    const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);

    // 3) بناء HTML التقرير (مع مصغّرات للصور)
    const htmlReport = renderHtmlReport(structuredAudit, files, lang);

    return ok(res, { html: htmlReport, structured: structuredAudit });
  } catch (err) {
    console.error("API ERROR /api/gpt:", err);
    return bad(res, 500, `Internal Error: ${err.message}`);
  }
}
