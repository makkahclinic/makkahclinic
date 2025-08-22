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
   const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "unnamed_file", mimeType: mime, base64: base64Data });
   userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
 }
 if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });
 const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every single piece of clinical information into a clean, comprehensive text block.
 **CRITICAL RULES:**
 1.  **DO NOT SUMMARIZE.** Transcribe everything.
 2.  For each document/file, first identify and state the **Date of Visit** clearly.
 3.  Under each date, list all patient details, complaints, vital signs, diagnoses, and every single lab test, medication, and procedure mentioned in that document, including duplicates.
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


// --- المرحلة الثانية: تعليمات المدقق الخبير لـ GPT-4o (V11) ---
function getExpertAuditorInstructions(lang = 'ar') {
 const langConfig = {
   ar: {
     rule: "**قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية.**",
     schema: {
       patientSummary: {"text": "ملخص تفصيلي لحالة المريض الحالية، العلامات الحيوية، والتشخيصات."},
       overallAssessment: {"text": "رأيك الخبير الشامل حول جودة الرعاية، مع تسليط الضوء على القرارات الصحيحة، الإغفالات الخطيرة، والإجراءات الخاطئة."},
       table: [
         {
           "name": "string", "itemType": "lab|medication|procedure", "status": "تم إجراؤه|مفقود ولكنه ضروري",
           "analysisCategory": "صحيح ومبرر|إجراء مكرر|غير مبرر طبياً|إجراء يتعارض مع التشخيص|إغفال خطير",
           "insuranceDecision": {"label": "مقبول|مرفوض|لا ينطبق", "justification": "string"}
         }
       ],
       recommendations: [ { "priority": "عاجلة|أفضل ممارسة", "description": "string", "relatedItems": ["string"] } ]
     }
   },
   en: {
     rule: "**Language Rule: All outputs MUST be in clear, professional English.**",
     schema: {
       patientSummary: {"text": "A detailed summary of the patient's presentation, vitals, and diagnoses."},
       overallAssessment: {"text": "Your expert overall opinion on the quality of care, highlighting major correct decisions, critical omissions, and incorrect procedures."},
       table: [
         {
           "name": "string", "itemType": "lab|medication|procedure", "status": "Performed|Missing but Necessary",
           "analysisCategory": "Correct and Justified|Duplicate Procedure|Not Medically Justified|Procedure Contradicts Diagnosis|Critical Omission",
           "insuranceDecision": {"label": "Accepted|Rejected|Not Applicable", "justification": "string"}
         }
       ],
       recommendations: [ { "priority": "Urgent|Best Practice", "description": "string", "relatedItems": ["string"] } ]
     }
   }
 };
 const selectedLang = langConfig[lang] || langConfig['ar'];


 // **تحسين جوهري V11**: استعادة التحليل العميق مع المنطق الجديد.
 return `You are an expert, evidence-based clinical pharmacist and medical auditor. Your mission is to deeply analyze the following case and respond with a valid JSON object.


**Primary Knowledge Base (Your analysis MUST conform to these guidelines):**
* **Cardiology:** AHA/ACC/ESC Guidelines. For a patient with risk factors (Age > 50, DM, HTN) presenting with epigastric pain, an ECG and Troponin are **Class 1 (Mandatory)**.
* **Endocrinology:** ADA Standards of Care. Annual fundus exam is mandatory for all Type 2 diabetics.
* **Reimbursement & Utilization:** Focus on **Medical Necessity**, Duplication, and Contraindications.


**Mandatory Analysis Rules & Reasoning Logic (Multi-Layered Analysis):**
1.  **List EVERY SINGLE ITEM:** List each item as it appears in the source, including all correct procedures and all duplicates. If "Dengue AB IGG" appears twice, it must have two separate entries in the final table.
2.  **For each listed item, perform a two-layer analysis:**
   * **Layer 1: Core Clinical Validity:** Is this procedure/medication appropriate for the patient's diagnoses and symptoms?
       * **Contraindication:** (e.g., Normal Saline in HTN without hypotension). Justification must be clinical: "إجراء يتعارض مع التشخيص (ارتفاع ضغط الدم) لعدم وجود جفاف أو قيء."
       * **Medical Unnecessity:** (e.g., Dengue test without relevant symptoms). Justification must be clinical and educational: "غير مبرر طبياً لعدم وجود أعراض داعمة (مثل الحمى، الطفح الجلدي) أو سجل سفر. بالإضافة إلى أن فحص IgG يكشف العدوى السابقة وليس الحادة."
   * **Layer 2: Duplication:** Is this the second (or third, etc.) time this exact item has been listed for this visit?
3.  **Combine Findings for the Final Justification:**
   * **For the FIRST instance of a flawed item:** The justification must focus on the Layer 1 clinical error. The \`analysisCategory\` should reflect this primary error (e.g., "إجراء يتعارض مع التشخيص").
   * **For the SECOND (and subsequent) instances:** The justification should be concise: "إجراء مكرر للطلب السابق." The \`analysisCategory\` should be "إجراء مكرر".
4.  **Proactive Standard of Care Analysis (Identify what is MISSING):**
   * Identify **Critical Omissions** (like missing ECG/Troponin) and **Best Practice Omissions** (like missing referrals) and list them in the table.
   * **CRITICAL LOGIC:** For any item with a status of "Missing but Necessary" (مفقود ولكنه ضروري), the \`insuranceDecision.label\` MUST be "Not Applicable" (لا ينطبق).
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
       statusHeader: isArabic ? "الحالة" : "Status",
       decisionHeader: isArabic ? "قرار التأمين" : "Insurance Decision",
       justificationHeader: isArabic ? "التبرير" : "Justification",
       relatedTo: isArabic ? "مرتبط بـ" : "Related to",
       notAvailable: isArabic ? "غير متوفر." : "Not available."
   };


   const getDecisionStyle = (label) => {
       const normalizedLabel = (label || '').toLowerCase();
       if (normalizedLabel.includes('مقبول') || normalizedLabel.includes('accepted')) return 'background-color: #e6f4ea; color: #1e8e3e;';
       if (normalizedLabel.includes('مرفوض') || normalizedLabel.includes('rejected')) return 'background-color: #fce8e6; color: #d93025;';
       if (normalizedLabel.includes('لا ينطبق') || normalizedLabel.includes('not applicable')) return 'background-color: #e8eaed; color: #5f6368;';
       return 'background-color: #e8eaed; color: #3c4043;';
   };
  
   const getRiskClass = (category) => {
       const normalizedCategory = (category || '').toLowerCase();
       if (normalizedCategory.includes('إغفال') || normalizedCategory.includes('omission') || normalizedCategory.includes('يتعارض') || normalizedCategory.includes('contradicts')) return 'risk-critical';
       if (normalizedCategory.includes('مكرر') || normalizedCategory.includes('duplicate') || normalizedCategory.includes('غير مبرر') || normalizedCategory.includes('not justified')) return 'risk-warning';
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
       <table class="audit-table"><thead><tr><th>${text.itemHeader}</th><th>${text.statusHeader}</th><th>${text.decisionHeader}</th><th>${text.justificationHeader}</th></tr></thead><tbody>${tableRows}</tbody></table>
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



