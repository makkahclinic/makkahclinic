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

// --- المرحلة الأولى: تجميع البيانات السريرية باستخدام Gemini ---
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    console.log(`Uploading file to Gemini: ${file.name}`);
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "unnamed_file", mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
    console.log(`File uploaded successfully: ${file.name}`);
  }
  if (userParts.length === 0) userParts.push({ text: "لا يوجد نص أو ملفات لتحليلها." });
  const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every single piece of clinical information into a clean, comprehensive text block.
  **CRITICAL RULES:**
  1.  **DO NOT SUMMARIZE.** Transcribe everything.
  2.  For each document/file, first identify and state the **Date of Visit** clearly.
  3.  Under each date, list all patient details, complaints, vital signs, diagnoses, and every single lab test, medication, and procedure mentioned in that document.
  4.  This creates a chronological record of the patient's journey. Do not merge data from different dates.
  5.  Present the information in a clear, structured manner.`;
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

// --- المرحلة الثانية: تعليمات المدقق الخبير لـ GPT-4o ---
function getExpertAuditorInstructions(lang = 'ar') {
    // **التعديل هنا**
    return `You are an expert, evidence-based clinical pharmacist and medical auditor. Your mission is to deeply analyze the following case and respond with a valid JSON object.

**Primary Knowledge Base (Your analysis MUST conform to these guidelines):**
* **Cardiology:** AHA/ACC/ESC Guidelines. For a patient with risk factors (Age > 50, DM, HTN) presenting with epigastric pain, an ECG and Troponin are **Class 1 (Mandatory)** recommendations to rule out ACS.
* **Endocrinology:** ADA Standards of Care. Annual fundus exam is mandatory for all Type 2 diabetics.
* **Reimbursement & Utilization:** Focus on **Medical Necessity**. Duplicated services are always rejected. Repetition of tests requires strong clinical justification.

**Mandatory Analysis Rules & Reasoning Logic:**
1.  **Analyze the Timeline:** The provided data is a chronological record. Pay close attention to the dates.
2.  **Assess Repetition Over Time:**
    * For any lab test or procedure repeated within a short period (e.g., 7 days), you MUST assess its clinical justification.
    * **Unjustified Repetition:** If a routine test (e.g., CBC, Uric Acid, Lipid Panel) is repeated without a clear change in patient status or a specific monitoring protocol, flag it as **"تكرار يتطلب تبريرًا"**.
3.  **Assess Medical Necessity & Correctness:**
    * **Clinically Inappropriate Actions:** Identify actions that are directly contraindicated by the patient's diagnosis (e.g., Normal Saline in a hypertensive patient). Justification MUST be clinical: "إجراء يتعارض مع التشخيص (ارتفاع ضغط الدم)..."
    * **Incorrect Test Selection:** (e.g., Dengue IgG for acute symptoms). Explain why it's wrong AND what the correct test would be.
4.  **Detect Duplicates within a single visit:** If an item is listed multiple times on the SAME DAY, flag it as **"إجراء مكرر"**.
5.  **Proactive Standard of Care Analysis (Identify what is MISSING):**
    * Identify **Critical Omissions** (like missing ECG/Troponin).
    * Identify **Best Practice Omissions** (like missing referrals).
6.  **Generate DEEPLY DETAILED Recommendations:** Recommendations must be specific, actionable, and educational.

**Your response must be ONLY the valid JSON object that conforms to the following exact schema. Do not include any other text or formatting.**
{
  "patientSummary": {"text": "A detailed summary of the patient's presentation, vitals, and diagnoses over the entire period."},
  "overallAssessment": {"text": "Your expert overall opinion on the quality of care, highlighting major correct decisions, critical omissions, and patterns of care like test repetition."},
  "table": [
    {
      "name": "string",
      "itemType": "lab"|"medication"|"procedure",
      "status": "تم إجراؤه"|"مفقود ولكنه ضروري",
      "analysisCategory": "صحيح ومبرر"|"إجراء مكرر"|"تكرار يتطلب تبريرًا"|"غير مبرر طبياً"|"إجراء يتعارض مع التشخيص"|"إغفال خطير",
      "insuranceDecision": {"label": "مقبول"|"مرفوض"|"معلق", "justification": "string"}
    }
  ],
  "recommendations": [
    { "priority": "عاجلة"|"أفضل ممارسة"|"للمراجعة", "description": "string", "relatedItems": ["string"] }
  ]
}`;
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
function renderHtmlReport(structuredData) {
    // The HTML rendering logic from V5 remains here...
    // No changes needed in this function.
    const s = structuredData;
    const getDecisionStyle = (label) => {
        switch (label) {
        case 'مقبول': return 'background-color: #e6f4ea; color: #1e8e3e;'; // Green
        case 'معلق': return 'background-color: #fff0e1; color: #e8710a;'; // Yellow
        case 'مرفوض': return 'background-color: #fce8e6; color: #d93025;'; // Red
        default: return 'background-color: #e8eaed; color: #3c4043;';
        }
    };
    const getCategoryIcon = (category) => {
        switch (category) {
            case 'صحيح ومبرر': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#1e8e3e"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
            case 'إجراء مكرر': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#e8710a"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`;
            case 'تكرار يتطلب تبريرًا': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#e8710a"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-5h2v2h-2zm0-8h2v6h-2z"/></svg>`;
            case 'غير مبرر طبياً': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#e8710a"><path d="M12 5.99L19.53 19H4.47L12 5.99M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z"/></svg>`;
            case 'إجراء يتعارض مع التشخيص': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#d93025"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
            case 'إغفال خطير': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#d93025"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`;
            default: return '';
        }
    }

    const tableRows = (s.table || []).map(r => `
        <tr>
        <td>
            <div class="item-name">${r.name || '-'}</div>
            <div class="item-category">
            ${getCategoryIcon(r.analysisCategory)}
            <span>${r.analysisCategory || ''}</span>
            </div>
        </td>
        <td>${r.status || '-'}</td>
        <td><span class="decision-badge" style="${getDecisionStyle(r.insuranceDecision?.label)}">${r.insuranceDecision?.label || '-'}</span></td>
        <td>${r.insuranceDecision?.justification || '-'}</td>
        </tr>
    `).join("");

    const recommendationsList = (s.recommendations || []).map(rec => `
        <div class="rec-item ${rec.priority === 'عاجلة' ? 'urgent-border' : (rec.priority === 'للمراجعة' ? 'review-border' : 'best-practice-border')}">
        <span class="rec-priority ${rec.priority === 'عاجلة' ? 'urgent' : (rec.priority === 'للمراجعة' ? 'review' : 'best-practice')}">${rec.priority}</span>
        <div class="rec-content">
            <div class="rec-desc">${rec.description}</div>
            ${rec.relatedItems && rec.relatedItems.length > 0 ? `<div class="rec-related">مرتبط بـ: ${rec.relatedItems.join(', ')}</div>` : ''}
        </div>
        </div>
    `).join("");

    return `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
        body { direction: rtl; font-family: 'Tajawal', sans-serif; background-color: #f8f9fa; color: #3c4043; }
        .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 24px; padding: 24px; background: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .report-section h2 { font-size: 22px; font-weight: 700; color: #0d47a1; margin: 0 0 20px; display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1a73e8; padding-bottom: 12px; }
        .report-section h2 svg { width: 28px; height: 28px; fill: #1a73e8; }
        .summary-text { font-size: 16px; line-height: 1.8; margin-bottom: 12px; }
        .audit-table { width: 100%; border-collapse: collapse; }
        .audit-table th, .audit-table td { padding: 16px 12px; text-align: right; border-bottom: 1px solid #e9ecef; vertical-align: top; }
        .audit-table th { background-color: #f1f3f5; color: #0d47a1; font-weight: 700; font-size: 14px; }
        .audit-table tr:last-child td { border-bottom: none; }
        .item-name { font-weight: 700; color: #202124; font-size: 15px; margin-bottom: 6px; }
        .item-category { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: #5f6368; }
        .decision-badge { font-weight: 700; padding: 6px 12px; border-radius: 16px; font-size: 13px; display: inline-block; border: 1px solid; }
        .rec-item { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; padding: 14px; border-radius: 8px; background: #f8f9fa; border-right: 4px solid; }
        .rec-priority { flex-shrink: 0; font-weight: 700; padding: 5px 12px; border-radius: 8px; font-size: 12px; color: #fff; }
        .rec-priority.urgent { background: #d93025; }
        .rec-priority.best-practice { background: #1e8e3e; }
        .rec-priority.review { background: #e8710a; }
        .rec-item.urgent-border { border-color: #d93025; }
        .rec-item.best-practice-border { border-color: #1e8e3e; }
        .rec-item.review-border { border-color: #e8710a; }
        .rec-content { display: flex; flex-direction: column; }
        .rec-desc { color: #202124; font-size: 15px; }
        .rec-related { font-size: 12px; color: #5f6368; margin-top: 6px; }
    </style>
    <div class="report-section">
        <h2><svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>ملخص الحالة والتقييم العام</h2>
        <p class="summary-text">${s.patientSummary?.text || 'غير متوفر.'}</p>
        <p class="summary-text">${s.overallAssessment?.text || 'غير متوفر.'}</p>
    </div>
    <div class="report-section">
        <h2><svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>التحليل التفصيلي للإجراءات</h2>
        <table class="audit-table"><thead><tr><th>الإجراء</th><th>الحالة</th><th>قرار التأمين</th><th>التبرير</th></tr></thead><tbody>${tableRows}</tbody></table>
    </div>
    <div class="report-section">
        <h2><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2h-2zm2-4h-2V7h2v6z"/></svg>التوصيات والإجراءات المقترحة</h2>
        ${recommendationsList}
    </div>
    `;
}


// --- معالج الطلبات الرئيسي (API Handler) مع تسجيل أخطاء مفصل ---
export default async function handler(req, res) {
  console.log("--- New Request Received ---");
  try {
    if (req.method !== "POST") {
      console.error("Error: Method not allowed. Received:", req.method);
      return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    }
    if (!OPENAI_API_KEY) {
        console.error("CRITICAL ERROR: OPENAI_API_KEY is missing from environment variables.");
        return bad(res, 500, "Server Configuration Error: Missing OPENAI_API_KEY");
    }
    if (!GEMINI_API_KEY) {
        console.error("CRITICAL ERROR: GEMINI_API_KEY is missing from environment variables.");
        return bad(res, 500, "Server Configuration Error: Missing GEMINI_API_KEY");
    }

    const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body || {};
    
    console.log("Step 1: Starting data aggregation with Gemini...");
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
    console.log("Step 1: Gemini aggregation successful.");
    
    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };

    console.log("Step 2: Starting expert audit with OpenAI...");
    const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);
    console.log("Step 2: OpenAI audit successful.");
    
    console.log("Step 3: Rendering HTML report...");
    const htmlReport = renderHtmlReport(structuredAudit);
    console.log("Step 3: HTML rendering successful.");

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured: structuredAudit });

  } catch (err) {
    // **هذا هو الجزء الأهم**: سيقوم بتسجيل الخطأ الحقيقي في سجلات الخادم
    console.error("---!!!--- An error occurred during the process ---!!!---");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    console.error("---!!!--- End of Error Report ---!!!---");
    return bad(res, 500, `An internal server error occurred. Check the server logs for details. Error: ${err.message}`);
  }
}
