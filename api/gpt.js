// هذا الإعداد مخصص لـ Next.js لزيادة حجم الطلب المسموح به، وهو ضروري لرفع ملفات كبيرة.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb", // السماح بطلبات تصل إلى 50 ميجابايت
    },
  },
};

// --- الإعدادات الرئيسية ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// --- دوال مساعدة ---
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (response) => (response.headers.get("content-type") || "").includes("application/json") ? response.json() : { raw: await response.text() };

// --- معالج رفع الملفات إلى Gemini ---
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

// --- المرحلة الأولى: تجميع البيانات السريرية (V18) ---
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "unnamed_file", mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }
  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  // **تحسين جوهري V18**: تعليمات متخصصة لاستخراج كل تفاصيل الوصفة الطبية بشكل منفصل.
  const systemPrompt = `You are an expert AI-powered OCR and transcription service specializing in deciphering difficult handwritten medical documents. Your task is to analyze the provided image(s) with forensic precision and transcribe ALL written information into a structured format.
  **CRITICAL RULES:**
  1.  **Full Transcription:** Transcribe everything you can read: patient information, diagnoses (Dx), and every single prescribed item.
  2.  **Look for EVERYTHING:** Pay close attention to and transcribe Medications (Rx), Medical Supplies (like test strips, lancets), and Supplements.
  3.  **Extract Granular Details for Each Item:** For every single item, you MUST extract and clearly label the following separate pieces of information:
      * **Item Name:** (e.g., Amlopine, E-core strips)
      * **Strength:** (e.g., 10mg, 0.5mg, 750mg, or 'Not specified')
      * **Frequency:** (e.g., 1x1, 1x2, tid, or 'Not specified')
      * **Duration:** (e.g., x90, x7, or 'Not specified')
  4.  **Format as a Detailed List:** Present the final transcription as a clear, structured list. This detailed transcription is critical for the next step of the analysis. Do not summarize or omit anything.`;
  
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
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
}

// --- المرحلة الثانية: تعليمات المدقق الخبير (V18) ---
function getExpertAuditorInstructions(lang = 'ar') {
  const langConfig = {
    ar: {
      rule: "**قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية.**",
      schema: {
        patientSummary: {"text": "ملخص تفصيلي لحالة المريض الحالية، التشخيصات، وقائمة الأدوية الكاملة."},
        overallAssessment: {"text": "رأيك الخبير الشامل حول جودة الرعاية، مع التركيز على تعدد الأدوية، التفاعلات الدوائية، الإغفالات الخطيرة، والأخطاء المحتملة."},
        table: [
          {
            "name": "string", "itemType": "medication|procedure|lab|supply",
            "doseStrength": "string", "doseFrequency": "string", "doseDuration": "string",
            "status": "موصوف|تم إجراؤه|مفقود ولكنه ضروري",
            "analysisCategory": "صحيح ومبرر|جرعة غير صحيحة|كمية عالية|إغفال خطير",
            "insuranceDecision": {"label": "مقبول|مرفوض|للمراجعة|لا ينطبق", "justification": "string"}
          }
        ],
        recommendations: [ { "priority": "عاجلة|أفضل ممارسة", "description": "string", "relatedItems": ["string"] } ]
      }
    },
    en: {
      rule: "**Language Rule: All outputs MUST be in clear, professional English.**",
      schema: {
        patientSummary: {"text": "A detailed summary of the patient's presentation, diagnoses, and full medication list."},
        overallAssessment: {"text": "Your expert overall opinion on the quality of care, focusing on polypharmacy, drug interactions, critical omissions, and potential errors."},
        table: [
          {
            "name": "string", "itemType": "medication|procedure|lab|supply",
            "doseStrength": "string", "doseFrequency": "string", "doseDuration": "string",
            "status": "Prescribed|Performed|Missing but Necessary",
            "analysisCategory": "Correct and Justified|Incorrect Dose|High Quantity|Critical Omission",
            "insuranceDecision": {"label": "Accepted|Rejected|For Review|Not Applicable", "justification": "string"}
          }
        ],
        recommendations: [ { "priority": "Urgent|Best Practice", "description": "string", "relatedItems": ["string"] } ]
      }
    }
  };
  const selectedLang = langConfig[lang] || langConfig['ar'];

  // **تحسين جوهري V18**: إضافة تحليل الجرعة والكمية بشكل مفصل.
  return `You are an expert, evidence-based clinical pharmacist and medical auditor. Your mission is to deeply analyze the following case and respond with a valid JSON object.

**Primary Knowledge Base (Your analysis MUST conform to these guidelines):**
* **Pharmacology:** Use official drug monographs and interaction databases.
* **Geriatrics:** Use Beers Criteria and STOPP/START criteria.
* **Cardiology, Endocrinology, Nephrology:** AHA/ACC/ADA/KDIGO Guidelines are mandatory.

**Mandatory Analysis Rules & Reasoning Logic (Pharmaceutical Focus):**
1.  **List EVERY SINGLE ITEM:** List each medication, supply, lab, and procedure as transcribed.
2.  **Populate Dose Fields:** For each item, you MUST populate the \`doseStrength\`, \`doseFrequency\`, and \`doseDuration\` fields from the transcribed data. If not specified, use "غير محدد".
3.  **Deep Pharmaceutical Review for EACH medication/supply:**
    * **Appropriateness:** Is the item appropriate for the given diagnosis?
    * **Dose & Frequency:** Is the dose specified and clear? Is the frequency correct for the formulation (e.g., once daily for Modified Release drugs like Diamicron MR)? If not, it's an **"جرعة غير صحيحة"** error.
    * **Duration/Quantity:** **Any prescription for a duration longer than 30 days is considered "High Quantity" (كمية عالية).** The justification must be: "وصف الدواء لمدة 90 يومًا يتطلب تقييمًا للاستقرار والمتابعة قبل صرف هذه الكمية الكبيرة."
4.  **Proactive Standard of Care Analysis (Identify what is MISSING):**
    * Identify **Critical Omissions** (like missing ECG/Troponin) and **Best Practice Omissions** (like missing referrals).
    * For missing items, the \`status\` is "مفقود ولكنه ضروري" and the \`insuranceDecision.label\` MUST be "لا ينطبق".
5.  **Generate DEEPLY DETAILED Recommendations:** Recommendations must be specific, actionable, and educational.

${selectedLang.rule}

**Your response must be ONLY the valid JSON object that conforms to the following exact schema. Do not include any other text or formatting.**
\`\`\`json
${JSON.stringify(selectedLang.schema, null, 2)}
\`\`\``;
}

// دالة للتواصل مع OpenAI والحصول على رد JSON منظم
async function getAuditFromOpenAI(bundle, lang) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
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

// --- عارض التقرير المتقدم (HTML Renderer) ---
function renderHtmlReport(structuredData, lang = 'ar') {
    const s = structuredData;
    const isArabic = lang === 'ar';
    const text = {
        summaryTitle: isArabic ? "ملخص الحالة والتقييم العام" : "Case Summary & Overall Assessment",
        detailsTitle: isArabic ? "التحليل التفصيلي للإجراءات" : "Detailed Analysis of Procedures",
        recommendationsTitle: isArabic ? "التوصيات والإجراءات المقترحة" : "Recommendations & Proposed Actions",
        itemHeader: isArabic ? "الإجراء" : "Item",
        strengthHeader: isArabic ? "القوة" : "Strength",
        frequencyHeader: isArabic ? "التكرار" : "Frequency",
        durationHeader: isArabic ? "المدة/الكمية" : "Duration/Qty",
        statusHeader: isArabic ? "الحالة" : "Status",
        decisionHeader: isArabic ? "قرار التأمين" : "Insurance Decision",
        justificationHeader: isArabic ? "التحليل والتبرير" : "Analysis & Justification",
        relatedTo: isArabic ? "مرتبط بـ" : "Related to",
        notAvailable: isArabic ? "غير متوفر." : "Not available."
    };

    const getDecisionStyle = (label) => {
        const normalizedLabel = (label || '').toLowerCase();
        if (normalizedLabel.includes('مقبول') || normalizedLabel.includes('accepted')) return 'background-color: #e6f4ea; color: #1e8e3e;';
        if (normalizedLabel.includes('مرفوض') || normalizedLabel.includes('rejected')) return 'background-color: #fce8e6; color: #d93025;';
        if (normalizedLabel.includes('للمراجعة') || normalizedLabel.includes('for review')) return 'background-color: #fff0e1; color: #e8710a;';
        if (normalizedLabel.includes('لا ينطبق') || normalizedLabel.includes('not applicable')) return 'background-color: #e8eaed; color: #5f6368;';
        return 'background-color: #e8eaed; color: #3c4043;';
    };
    
    const getRiskClass = (category) => {
        const normalizedCategory = (category || '').toLowerCase();
        if (normalizedCategory.includes('إغفال') || normalizedCategory.includes('omission') || normalizedCategory.includes('جرعة غير صحيحة')) return 'risk-critical';
        if (normalizedCategory.includes('كمية') || normalizedCategory.includes('quantity')) return 'risk-warning';
        if (normalizedCategory.includes('صحيح') || normalizedCategory.includes('correct')) return 'risk-ok';
        return '';
    };

    const tableRows = (s.table || []).map(r => `
        <tr class="${getRiskClass(r.analysisCategory)}">
        <td>
            <div class="item-name">${r.name || '-'}</div>
            <div class="item-category">
            <span>${r.analysisCategory || ''}</span>
            </div>
        </td>
        <td>${r.doseStrength || '-'}</td>
        <td>${r.doseFrequency || '-'}</td>
        <td>${r.doseDuration || '-'}</td>
        <td>${r.status || '-'}</td>
        <td><span class="decision-badge" style="${getDecisionStyle(r.insuranceDecision?.label)}">${r.insuranceDecision?.label || '-'}</span></td>
        <td>${r.insuranceDecision?.justification || '-'}</td>
        </tr>
    `).join("");

    const recommendationsList = (s.recommendations || []).map(rec => {
        const priorityClass = (rec.priority || '').toLowerCase();
        let borderClass = 'best-practice-border';
        if (priorityClass.includes('عاجلة') || priorityClass.includes('urgent')) borderClass = 'urgent-border';

        return `
        <div class="rec-item ${borderClass}">
        <span class="rec-priority ${priorityClass}">${rec.priority}</span>
        <div class="rec-content">
            <div class="rec-desc">${rec.description}</div>
            ${rec.relatedItems && rec.relatedItems.length > 0 ? `<div class="rec-related">${text.relatedTo}: ${rec.relatedItems.join(', ')}</div>` : ''}
        </div>
        </div>
    `}).join("");

    return `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
        body { direction: ${isArabic ? 'rtl' : 'ltr'}; font-family: 'Tajawal', sans-serif; background-color: #f8f9fa; color: #3c4043; }
        .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 24px; padding: 24px; background: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .report-section h2 { font-size: 22px; font-weight: 700; color: #0d47a1; margin: 0 0 20px; display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1a73e8; padding-bottom: 12px; }
        .audit-table { width: 100%; border-collapse: collapse; }
        .audit-table th, .audit-table td { padding: 16px 12px; text-align: ${isArabic ? 'right' : 'left'}; border-bottom: 1px solid #e9ecef; }
        .rec-item { border-${isArabic ? 'right' : 'left'}: 4px solid; }
        .item-name { font-weight: 700; color: #202124; font-size: 15px; margin-bottom: 6px; }
        .item-category { font-size: 13px; font-weight: 500; color: #5f6368; }
        .decision-badge { font-weight: 700; padding: 6px 12px; border-radius: 16px; font-size: 13px; display: inline-block; border: 1px solid; }
        .rec-item { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; padding: 14px; border-radius: 8px; background: #f8f9fa; }
        .rec-priority { flex-shrink: 0; font-weight: 700; padding: 5px 12px; border-radius: 8px; font-size: 12px; color: #fff; }
        .rec-priority.urgent, .rec-priority.عاجلة { background: #d93025; }
        .rec-priority.best-practice, .rec-priority.أفضل { background: #1e8e3e; }
        .rec-item.urgent-border { border-color: #d93025; }
        .rec-item.best-practice-border { border-color: #1e8e3e; }
        .rec-content { display: flex; flex-direction: column; }
        .rec-desc { color: #202124; font-size: 15px; }
        .rec-related { font-size: 12px; color: #5f6368; margin-top: 6px; }
        
        /* Risk Coloring */
        .audit-table tr.risk-critical { background-color: #fce8e6 !important; }
        .audit-table tr.risk-warning { background-color: #fff0e1 !important; }
        .audit-table tr.risk-ok { background-color: #e6f4ea !important; }
    </style>
    <div class="report-section">
        <h2>${text.summaryTitle}</h2>
        <p class="summary-text">${s.patientSummary?.text || text.notAvailable}</p>
        <p class="summary-text">${s.overallAssessment?.text || text.notAvailable}</p>
    </div>
    <div class="report-section">
        <h2>${text.detailsTitle}</h2>
        <table class="audit-table"><thead><tr><th>${text.itemHeader}</th><th>${text.strengthHeader}</th><th>${text.frequencyHeader}</th><th>${text.durationHeader}</th><th>${text.statusHeader}</th><th>${text.decisionHeader}</th><th>${text.justificationHeader}</th></tr></thead><tbody>${tableRows}</tbody></table>
    </div>
    <div class="report-section">
        <h2>${text.recommendationsTitle}</h2>
        ${recommendationsList}
    </div>
    `;
}


// --- معالج الطلبات الرئيسي (API Handler) ---
export default async function handler(req, res) {
  console.log("--- New Request Received ---");
  try {
    if (req.method !== "POST") {
      return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    }
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
        console.error("CRITICAL ERROR: API Key is missing.");
        return bad(res, 500, "Server Configuration Error: API Key is missing.");
    }

    const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body || {};
    
    console.log(`Processing request with language: ${lang}`);
    
    console.log("Step 1: Starting data aggregation with Gemini...");
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
    console.log("Step 1: Gemini aggregation successful.");
    
    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };

    console.log("Step 2: Starting expert audit with OpenAI...");
    const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);
    console.log("Step 2: OpenAI audit successful.");
    
    console.log("Step 3: Rendering HTML report...");
    const htmlReport = renderHtmlReport(structuredAudit, lang);
    console.log("Step 3: HTML rendering successful.");

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured: structuredAudit });

  } catch (err) {
    console.error("---!!!--- An error occurred during the process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    console.error("---!!!--- End of Error Report ---!!!---");
    return bad(res, 500, `An internal server error occurred. Check the server logs for details. Error: ${err.message}`);
  }
}





الكود التاني ممكن دا يكون اقوى ولكن في ضعف القراءه // هذا الإعداد مخصص لـ Next.js لزيادة حجم الطلب المسموح به، وهو ضروري لرفع ملفات كبيرة.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb", // السماح بطلبات تصل إلى 50 ميجابايت
    },
  },
};

// --- الإعدادات الرئيسية ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// --- دوال مساعدة ---
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (response) => (response.headers.get("content-type") || "").includes("application/json") ? response.json() : { raw: await response.text() };

// --- معالج رفع الملفات إلى Gemini ---
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

// --- المرحلة الأولى: تجميع البيانات السريرية (V18 Logic) ---
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "unnamed_file", mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }
  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  // **استخدام محرك القراءة الدقيق للجرعات**
  const systemPrompt = `You are an expert AI-powered OCR and transcription service specializing in deciphering difficult handwritten medical documents. Your task is to analyze the provided image(s) with forensic precision and transcribe ALL written information into a structured format.
  **CRITICAL RULES:**
  1.  **Full Transcription:** Transcribe everything you can read: patient information (including GENDER), diagnoses (Dx), and every single prescribed item.
  2.  **Look for EVERYTHING:** Pay close attention to and transcribe Medications (Rx), Medical Supplies (like test strips, lancets), and Supplements.
  3.  **Extract Granular Details for Each Item:** For every single item, you MUST extract and clearly label the following separate pieces of information:
      * **Item Name:** (e.g., Amlopine, E-core strips)
      * **Strength:** (e.g., 10mg, 0.5mg, 750mg, or 'Not specified')
      * **Frequency:** (e.g., 1x1, 1x2, tid, or 'Not specified')
      * **Duration:** (e.g., x90, x7, or 'Not specified')
  4.  **Format as a Detailed List:** Present the final transcription as a clear, structured list. This detailed transcription is critical for the next step of the analysis. Do not summarize or omit anything.`;
  
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
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
}

// --- المرحلة الثانية: تعليمات المدقق الخبير (V21) ---
function getExpertAuditorInstructions(lang = 'ar') {
  const langConfig = {
    ar: {
      rule: "**قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية.**",
      schema: {
        patientSummary: {"text": "ملخص تفصيلي لحالة المريض الحالية، التشخيصات، وقائمة الأدوية الكاملة."},
        overallAssessment: {"text": "رأيك الخبير الشامل حول جودة الرعاية، مع التركيز على تعدد الأدوية، التفاعلات الدوائية، الإغفالات الخطيرة، والأخطاء المحتملة."},
        table: [
          {
            "name": "string", "itemType": "medication|procedure|lab|supply",
            "doseStrength": "string", "doseFrequency": "string", "doseDuration": "string",
            "status": "موصوف|تم إجراؤه|مفقود ولكنه ضروري",
            "analysisCategory": "صحيح ومبرر|جرعة غير صحيحة|كمية عالية|إغفال خطير|تكرار علاجي|غير مبرر طبياً|إجراء يتعارض مع التشخيص",
            "insuranceDecision": {"label": "مقبول|مرفوض|للمراجعة|لا ينطبق", "justification": "string"}
          }
        ],
        recommendations: [ { "priority": "عاجلة|أفضل ممارسة", "description": "string", "relatedItems": ["string"] } ]
      }
    },
    en: {
      rule: "**Language Rule: All outputs MUST be in clear, professional English.**",
      schema: {
        patientSummary: {"text": "A detailed summary of the patient's presentation, diagnoses, and full medication list."},
        overallAssessment: {"text": "Your expert overall opinion on the quality of care, focusing on polypharmacy, drug interactions, critical omissions, and potential errors."},
        table: [
          {
            "name": "string", "itemType": "medication|procedure|lab|supply",
            "doseStrength": "string", "doseFrequency": "string", "doseDuration": "string",
            "status": "Prescribed|Performed|Missing but Necessary",
            "analysisCategory": "Correct and Justified|Incorrect Dose|High Quantity|Critical Omission|Therapeutic Duplication|Not Medically Justified|Procedure Contradicts Diagnosis",
            "insuranceDecision": {"label": "Accepted|Rejected|For Review|Not Applicable", "justification": "string"}
          }
        ],
        recommendations: [ { "priority": "Urgent|Best Practice", "description": "string", "relatedItems": ["string"] } ]
      }
    }
  };
  const selectedLang = langConfig[lang] || langConfig['ar'];

  // **تحسين جوهري V21**: استعادة التحليل العميق مع الحفاظ على شفافية الجرعة.
  return `You are an expert, evidence-based clinical pharmacist and medical auditor. Your mission is to deeply analyze the following case and respond with a valid JSON object.

**Primary Knowledge Base (Your analysis MUST conform to these guidelines):**
* **Pharmacology:** Use official drug monographs and interaction databases.
* **Geriatrics:** Use Beers Criteria and STOPP/START criteria.
* **Cardiology, Endocrinology, Nephrology:** AHA/ACC/ADA/KDIGO Guidelines are mandatory.

**Mandatory Analysis Rules & Reasoning Logic (Pharmaceutical Focus):**
1.  **List EVERY SINGLE ITEM:** List each medication, supply, lab, and procedure as transcribed.
2.  **Populate Dose Fields:** For each item, you MUST populate the \`doseStrength\`, \`doseFrequency\`, and \`doseDuration\` fields from the transcribed data. If not specified, use "غير محدد".
3.  **Deep Pharmaceutical Review for EACH medication/supply:**
    * **Drug-Gender Mismatch (CRITICAL):** First, check if the patient's gender is specified. If a gender-specific diagnosis (like BPH) or medication (like Duodart) is present for the wrong gender, this is a major error. Classify it as **"إجراء يتعارض مع التشخيص"** and the justification must be: "تم وصف دواء Duodart لعلاج تضخم البروستاتا لمريضة أنثى، وهو خطأ سريري فادح."
    * **Appropriateness:** Is the item appropriate for the given diagnosis?
    * **Dose & Frequency:** Is the dose specified and clear? Is the frequency correct for the formulation (e.g., once daily for Modified Release drugs like Diamicron MR)? If not, it's an **"جرعة غير صحيحة"** error.
    * **Duration/Quantity:** **Any prescription for a duration longer than 30 days is considered "High Quantity" (كمية عالية).**
    * **Therapeutic Duplication:** Identify if multiple drugs are prescribed for the same indication.
4.  **Proactive Standard of Care Analysis (Identify what is MISSING):**
    * Identify **Critical Omissions** (like missing ECG/Troponin) and **Best Practice Omissions** (like missing referrals).
    * For missing items, the \`status\` is "مفقود ولكنه ضروري" and the \`insuranceDecision.label\` MUST be "لا ينطبق".
5.  **Generate DEEPLY DETAILED Recommendations:** Recommendations must be specific, actionable, and educational.

${selectedLang.rule}

**Your response must be ONLY the valid JSON object that conforms to the following exact schema. Do not include any other text or formatting.**
\`\`\`json
${JSON.stringify(selectedLang.schema, null, 2)}
\`\`\``;
}

// دالة للتواصل مع OpenAI والحصول على رد JSON منظم
async function getAuditFromOpenAI(bundle, lang) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
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

// --- عارض التقرير المتقدم (HTML Renderer) ---
function renderHtmlReport(structuredData, lang = 'ar') {
    const s = structuredData;
    const isArabic = lang === 'ar';
    const text = {
        summaryTitle: isArabic ? "ملخص الحالة والتقييم العام" : "Case Summary & Overall Assessment",
        detailsTitle: isArabic ? "التحليل التفصيلي للإجراءات" : "Detailed Analysis of Procedures",
        recommendationsTitle: isArabic ? "التوصيات والإجراءات المقترحة" : "Recommendations & Proposed Actions",
        itemHeader: isArabic ? "الإجراء" : "Item",
        strengthHeader: isArabic ? "القوة" : "Strength",
        frequencyHeader: isArabic ? "التكرار" : "Frequency",
        durationHeader: isArabic ? "المدة/الكمية" : "Duration/Qty",
        statusHeader: isArabic ? "الحالة" : "Status",
        decisionHeader: isArabic ? "قرار التأمين" : "Insurance Decision",
        justificationHeader: isArabic ? "التحليل والتبرير" : "Analysis & Justification",
        relatedTo: isArabic ? "مرتبط بـ" : "Related to",
        notAvailable: isArabic ? "غير متوفر." : "Not available."
    };

    const getDecisionStyle = (label) => {
        const normalizedLabel = (label || '').toLowerCase();
        if (normalizedLabel.includes('مقبول') || normalizedLabel.includes('accepted')) return 'background-color: #e6f4ea; color: #1e8e3e;';
        if (normalizedLabel.includes('مرفوض') || normalizedLabel.includes('rejected')) return 'background-color: #fce8e6; color: #d93025;';
        if (normalizedLabel.includes('للمراجعة') || normalizedLabel.includes('for review')) return 'background-color: #fff0e1; color: #e8710a;';
        if (normalizedLabel.includes('لا ينطبق') || normalizedLabel.includes('not applicable')) return 'background-color: #e8eaed; color: #5f6368;';
        return 'background-color: #e8eaed; color: #3c4043;';
    };
    
    const getRiskClass = (category) => {
        const normalizedCategory = (category || '').toLowerCase();
        if (normalizedCategory.includes('إغفال') || normalizedCategory.includes('omission') || normalizedCategory.includes('جرعة غير صحيحة') || normalizedCategory.includes('يتعارض')) return 'risk-critical';
        if (normalizedCategory.includes('كمية') || normalizedCategory.includes('quantity') || normalizedCategory.includes('تكرار علاجي')) return 'risk-warning';
        if (normalizedCategory.includes('صحيح') || normalizedCategory.includes('correct')) return 'risk-ok';
        return '';
    };

    const tableRows = (s.table || []).map(r => `
        <tr class="${getRiskClass(r.analysisCategory)}">
        <td>
            <div class="item-name">${r.name || '-'}</div>
            <div class="item-category">
            <span>${r.analysisCategory || ''}</span>
            </div>
        </td>
        <td>${r.doseStrength || '-'}</td>
        <td>${r.doseFrequency || '-'}</td>
        <td>${r.doseDuration || '-'}</td>
        <td>${r.status || '-'}</td>
        <td><span class="decision-badge" style="${getDecisionStyle(r.insuranceDecision?.label)}">${r.insuranceDecision?.label || '-'}</span></td>
        <td>${r.insuranceDecision?.justification || '-'}</td>
        </tr>
    `).join("");

    const recommendationsList = (s.recommendations || []).map(rec => {
        const priorityClass = (rec.priority || '').toLowerCase();
        let borderClass = 'best-practice-border';
        if (priorityClass.includes('عاجلة') || priorityClass.includes('urgent')) borderClass = 'urgent-border';

        return `
        <div class="rec-item ${borderClass}">
        <span class="rec-priority ${priorityClass}">${rec.priority}</span>
        <div class="rec-content">
            <div class="rec-desc">${rec.description}</div>
            ${rec.relatedItems && rec.relatedItems.length > 0 ? `<div class="rec-related">${text.relatedTo}: ${rec.relatedItems.join(', ')}</div>` : ''}
        </div>
        </div>
    `}).join("");

    return `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
        body { direction: ${isArabic ? 'rtl' : 'ltr'}; font-family: 'Tajawal', sans-serif; background-color: #f8f9fa; color: #3c4043; }
        .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 24px; padding: 24px; background: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .report-section h2 { font-size: 22px; font-weight: 700; color: #0d47a1; margin: 0 0 20px; display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1a73e8; padding-bottom: 12px; }
        .audit-table { width: 100%; border-collapse: collapse; }
        .audit-table th, .audit-table td { padding: 16px 12px; text-align: ${isArabic ? 'right' : 'left'}; border-bottom: 1px solid #e9ecef; }
        .rec-item { border-${isArabic ? 'right' : 'left'}: 4px solid; }
        .item-name { font-weight: 700; color: #202124; font-size: 15px; margin-bottom: 6px; }
        .item-category { font-size: 13px; font-weight: 500; color: #5f6368; }
        .decision-badge { font-weight: 700; padding: 6px 12px; border-radius: 16px; font-size: 13px; display: inline-block; border: 1px solid; }
        .rec-item { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; padding: 14px; border-radius: 8px; background: #f8f9fa; }
        .rec-priority { flex-shrink: 0; font-weight: 700; padding: 5px 12px; border-radius: 8px; font-size: 12px; color: #fff; }
        .rec-priority.urgent, .rec-priority.عاجلة { background: #d93025; }
        .rec-priority.best-practice, .rec-priority.أفضل { background: #1e8e3e; }
        .rec-item.urgent-border { border-color: #d93025; }
        .rec-item.best-practice-border { border-color: #1e8e3e; }
        .rec-content { display: flex; flex-direction: column; }
        .rec-desc { color: #202124; font-size: 15px; }
        .rec-related { font-size: 12px; color: #5f6368; margin-top: 6px; }
        
        /* Risk Coloring */
        .audit-table tr.risk-critical { background-color: #fce8e6 !important; }
        .audit-table tr.risk-warning { background-color: #fff0e1 !important; }
        .audit-table tr.risk-ok { background-color: #e6f4ea !important; }
    </style>
    <div class="report-section">
        <h2>${text.summaryTitle}</h2>
        <p class="summary-text">${s.patientSummary?.text || text.notAvailable}</p>
        <p class="summary-text">${s.overallAssessment?.text || text.notAvailable}</p>
    </div>
    <div class="report-section">
        <h2>${text.detailsTitle}</h2>
        <table class="audit-table"><thead><tr><th>${text.itemHeader}</th><th>${text.strengthHeader}</th><th>${text.frequencyHeader}</th><th>${text.durationHeader}</th><th>${text.statusHeader}</th><th>${text.decisionHeader}</th><th>${text.justificationHeader}</th></tr></thead><tbody>${tableRows}</tbody></table>
    </div>
    <div class="report-section">
        <h2>${text.recommendationsTitle}</h2>
        ${recommendationsList}
    </div>
    `;
}


// --- معالج الطلبات الرئيسي (API Handler) ---
export default async function handler(req, res) {
  console.log("--- New Request Received ---");
  try {
    if (req.method !== "POST") {
      return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    }
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
        console.error("CRITICAL ERROR: API Key is missing.");
        return bad(res, 500, "Server Configuration Error: API Key is missing.");
    }

    const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body || {};
    
    console.log(`Processing request with language: ${lang}`);
    
    console.log("Step 1: Starting data aggregation with Gemini...");
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
    console.log("Step 1: Gemini aggregation successful.");
    
    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };

    console.log("Step 2: Starting expert audit with OpenAI...");
    const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);
    console.log("Step 2: OpenAI audit successful.");
    
    console.log("Step 3: Rendering HTML report...");
    const htmlReport = renderHtmlReport(structuredAudit, lang);
    console.log("Step 3: HTML rendering successful.");

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured: structuredAudit });

  } catch (err) {
    console.error("---!!!--- An error occurred during the process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    console.error("---!!!--- End of Error Report ---!!!---");
    return bad(res, 500, `An internal server error occurred. Check the server logs for details. Error: ${err.message}`);
  }
}
