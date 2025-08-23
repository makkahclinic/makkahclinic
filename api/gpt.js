// هذا الإعداد مخصص لـ Next.js لزيادة حجم الطلب المسموح به
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
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
            "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(binaryData.byteLength),
            "X-Goog-Upload-Header-Content-Type": mimeType, "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
    });
    if (!initRes.ok) throw new Error(`Gemini init failed: ${JSON.stringify(await parseJsonSafe(initRes))}`);
    const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
    if (!sessionUrl) throw new Error("Gemini upload session URL is missing");
    const uploadRes = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
            "Content-Type": mimeType, "X-Goog-Upload-Command": "upload, finalize",
            "X-Goog-Upload-Offset": "0", "Content-Length": String(binaryData.byteLength),
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
    
    const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs and extract clinical information into a clean text block. **CRITICAL RULES:**
1.  **DO NOT SUMMARIZE.** Transcribe everything.
2.  List all diagnoses, medications, and procedures.
3.  **For each medication, transcribe its name, dosage, frequency, and duration on a single line exactly as written (e.g., Amlopine 10 1x1x90).**
4.  Present the information clearly.`;
    
    const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: userParts }],
    };
    const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await parseJsonSafe(response);
    if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);
    return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
}

// --- المرحلة الثانية: تعليمات المدقق الخبير لـ GPT-4o ---
// --- تعديل جذري: تم تبسيط التعليمات بالكامل لتكون أكثر ذكاءً وموثوقية ---
function getExpertAuditorInstructions(lang = 'ar') {
    const langConfig = {
        ar: {
            rule: "**قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية.**",
            schema: {
                patientSummary: {"text": "ملخص تفصيلي لحالة المريض الحالية والتشخيصات."},
                overallAssessment: {"text": "رأيك الخبير الشامل حول جودة الرعاية، مع تسليط الضوء على القرارات الصحيحة والإغفالات والإجراءات الخاطئة."},
                table: [
                    {
                        "name": "string", "dosage_written": "string", "itemType": "lab|medication|procedure",
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

    return `You are an expert, evidence-based clinical pharmacist and medical auditor. Your mission is to analyze the provided clinical data and respond with a valid JSON object that follows the exact schema.

**Your Thought Process:**

1.  **Summarize:** Read all the provided data (diagnoses, patient info, etc.) and write a concise \`patientSummary\` and an \`overallAssessment\` of the care quality.

2.  **Analyze Line-by-Line:** Go through the transcribed medications and procedures one by one. For **EVERY SINGLE ITEM** listed, create a corresponding entry in the \`table\` array.
    * For each item, populate all fields: \`name\`, \`dosage_written\`, \`itemType\`, \`status\`, etc.
    * Apply your clinical knowledge to determine the \`analysisCategory\` and \`insuranceDecision\`. Use the following guiding principles:
        * **Standard & Correct:** If a drug like Amlopine 10mg is given once daily for Hypertension, it is "صحيح ومبرر" (Correct and Justified) and "مقبول" (Accepted).
        * **Dosing Errors:** A drug like Diamicron MR (Gliclazide MR) should be once daily. If prescribed twice daily, this is a "خطأ في الجرعة أو التكرار" (Dosing or Frequency Error) and must be "مرفوض" (Rejected).
        * **Quantity Review:** A 90-day supply for a chronic, stable condition is acceptable. If stability is not clear, or for certain medications, flag it as "الكمية تحتاج لمراجعة" (Quantity Requires Review).
        * **Medical Necessity:** If an item like 'Triplex' has unclear benefits for the patient's conditions, it is "غير مبرر طبياً" (Not Medically Justified).

3.  **Identify Omissions:** After analyzing all prescribed items, think about what is MISSING based on the patient's profile (age, diagnoses like HTN, DM).
    * For a 76-year-old with HTN and DM, are an ECG and Troponin test missing? Is a Fundus Exam missing?
    * Add these missing items to the \`table\` with a status of "مفقود ولكنه ضروري" (Missing but Necessary).

4.  **Recommend Actions:** Based on your findings (especially errors and omissions), create clear, actionable \`recommendations\`.

${selectedLang.rule}

**Your response must be ONLY the valid JSON object conforming to this exact schema. Do not include any other text or formatting.**
\`\`\`json
${JSON.stringify(selectedLang.schema, null, 2)}
\`\`\``;
}

// دالة للتواصل مع OpenAI
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
        const normalizedCategory = (category || '').toLowerCase();
        if (normalizedCategory.includes('إغفال') || normalizedCategory.includes('omission') || normalizedCategory.includes('يتعارض') || normalizedCategory.includes('contradicts') || normalizedCategory.includes('خطأ في الجرعة') || normalizedCategory.includes('dosing error')) return 'risk-critical';
        if (normalizedCategory.includes('مكرر') || normalizedCategory.includes('duplicate') || normalizedCategory.includes('غير مبرر') || normalizedCategory.includes('not justified') || normalizedCategory.includes('تحتاج لمراجعة') || normalizedCategory.includes('requires review')) return 'risk-warning';
        if (normalizedCategory.includes('صحيح') || normalizedCategory.includes('correct')) return 'risk-ok';
        return '';
    };

    const sourceDocsHtml = (files || []).map(f => {
        const isImg = (f.mimeType || '').startsWith('image/');
        const src = `data:${f.mimeType};base64,${f.data}`;
        const filePreview = isImg ? `<img src="${src}" alt="${f.name}" />` : `<div class="pdf-placeholder">${f.name}</div>`;
        return `<div class="source-doc-card"><h3>${f.name}</h3>${filePreview}</div>`;
    }).join('');

    const tableRows = (s.table || []).map(r =>        `<tr class="${getRiskClass(r.analysisCategory)}">
        <td>
            <div class="cell-content">
                <span class="item-name">${r.name || '-'}</span>
                <span class="item-category">${r.analysisCategory || ''}</span>
            </div>
        </td>
        <td><div class="cell-content dosage-cell">${r.dosage_written || '-'}</div></td>
        <td><div class="cell-content">${r.status || '-'}</div></td>
        <td><div class="cell-content"><span class="decision-badge">${r.insuranceDecision?.label || '-'}</span></div></td>
        <td><div class="cell-content">${r.insuranceDecision?.justification || '-'}</div></td>
        </tr>`
    ).join("");

    const recommendationsList = (s.recommendations || []).map(rec => {
        const priorityClass = (rec.priority || '').toLowerCase();
        let borderClass = 'best-practice-border';
        if (priorityClass.includes('عاجلة') || priorityClass.includes('urgent')) borderClass = 'urgent-border';
        return `<div class="rec-item ${borderClass}">
        <span class="rec-priority ${priorityClass}">${rec.priority}</span>
        <div class="rec-content">
            <div class="rec-desc">${rec.description}</div>
            ${rec.relatedItems && rec.relatedItems.length > 0 ? `<div class="rec-related">${text.relatedTo}: ${rec.relatedItems.join(', ')}</div>` : ''}
        </div>
        </div>`;
    }).join("");

    return `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        body { direction: ${isArabic ? 'rtl' : 'ltr'}; font-family: 'Tajawal', sans-serif; background-color: #f8f9fa; color: #3c4043; line-height: 1.6; }
        .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 24px; padding: 24px; background: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.05); page-break-inside: avoid; }
        .report-section h2 { font-size: 22px; font-weight: 700; color: #0d4a1; margin: 0 0 20px; display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1a73e8; padding-bottom: 12px; }
        
        .audit-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 14px;
        }
        .audit-table th, .audit-table td {
            text-align: ${isArabic ? 'right' : 'left'};
            border-bottom: 1px solid #e9ecef;
            vertical-align: top;
            padding: 0;
        }
        .audit-table th .cell-content {
             padding: 12px;
             font-weight: 700;
             background-color: #f8f9fa;
        }
        .audit-table td .cell-content {
            padding: 12px;
        }
        .audit-table tr { page-break-inside: avoid; }

        .cell-content .item-name {
            font-weight: 700;
            color: #202124;
            font-size: 15px;
            display: block;
            margin-bottom: 4px;
        }
        .cell-content .item-category {
            font-size: 12px;
            font-weight: 500;
            color: #5f6368;
            display: block;
        }
        .dosage-cell {
            font-family: monospace, sans-serif;
            color: #3d3d3d;
            font-size: 14px;
            white-space: nowrap;
        }
        .decision-badge {
            font-weight: 700;
            padding: 5px 10px;
            border-radius: 16px;
            font-size: 13px;
            display: inline-block;
        }
        
        .rec-item { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; padding: 14px; border-radius: 8px; background: #f8f9fa; border-${isArabic ? 'right' : 'left'}: 4px solid; page-break-inside: avoid; }
        .rec-priority { flex-shrink: 0; font-weight: 700; padding: 5px 12px; border-radius: 8px; font-size: 12px; color: #fff; }
        .rec-priority.urgent, .rec-priority.عاجلة { background: #d93025; }
        .rec-priority.best-practice, .rec-priority.أفضل { background: #1e8e3e; }
        .rec-item.urgent-border { border-color: #d93025; }
        .rec-item.best-practice-border { border-color: #1e8e3e; }
        
        .audit-table tr.risk-critical td { background-color: #fce8e6; }
        .audit-table tr.risk-warning td { background-color: #fff0e1; }
        .audit-table tr.risk-ok td { background-color: #e6f4ea; }

        .pdf-placeholder { padding:20px; border:1px dashed #e5e7eb; border-radius:8px; background:#f9fbfc; color:#6b7280; text-align:center; }
        .source-doc-card { page-break-inside: avoid; }
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
        <div style="overflow-x: auto;">
            <table class="audit-table">
                <thead>
                    <tr>
                        <th style="width: 28%;"><div class="cell-content">${text.itemHeader}</div></th>
                        <th style="width: 15%;"><div class="cell-content">${text.dosageHeader}</div></th>
                        <th style="width: 15%;"><div class="cell-content">${text.statusHeader}</div></th>
                        <th style="width: 15%;"><div class="cell-content">${text.decisionHeader}</div></th>
                        <th style="width: 27%;"><div class="cell-content">${text.justificationHeader}</div></th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>
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
        const htmlReport = renderHtmlReport(structuredData, files, lang);
        console.log("Step 3: HTML rendering successful.");

        console.log("--- Request Processed Successfully ---");
        return ok(res, { html: htmlReport, structured: structuredAudit });
    } catch (err) {
        console.error("---!!!--- An error occurred during the process ---!!!---");
        console.error("Error Message:", err.message);
        console.error("Error Stack:", err.stack);
        return bad(res, 500, `An internal server error occurred. Check the server logs for details. Error: ${err.message}`);
    }
}
