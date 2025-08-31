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

// --- التحقق من جودة البيانات المستخرجة ---
function validateExtractedData(clinicalText) {
    if (!clinicalText || clinicalText.trim().length < 50) {
        return { isValid: false, reason: "النص المستخرج قصير جداً أو غير كافٍ" };
    }
    
    // التحقق من وجود عناصر طبية أساسية
    const medicalPatterns = [
        /(دواء|دوية|علاج|علاجات|medication|drug|treatment)/i,
        /(جرعة|مقدار|كمية|dosage|dose|quantity)/i,
        /(فحص|تحليل|اختبار|test|lab|analysis)/i,
        /(تشخيص|diagnosis|condition|disease)/i
    ];
    
    const missingPatterns = medicalPatterns.filter(pattern => !pattern.test(clinicalText));
    
    if (missingPatterns.length > 2) {
        return { 
            isValid: false, 
            reason: "البيانات المستخرجة تفتقد إلى عناصر طبية أساسية" 
        };
    }
    
    return { isValid: true };
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
    
    // تحسين نظام الترجمة الطبية ليكون أكثر دقة
    const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every single piece of clinical information into a clean, comprehensive text block. 

**CRITICAL ENHANCEMENTS:**
1. **DO NOT SUMMARIZE.** Transcribe everything exactly as written.
2. **STRUCTURED EXTRACTION:** Organize information in clear sections:
   - Patient Demographics: Name, Age, Gender, Medical Record Number
   - Diagnoses: List all diagnoses with dates
   - Medications: For each medication, extract: Name, Strength, Dosage, Frequency, Duration, Route
   - Labs: Test Name, Value, Unit, Reference Range, Date
   - Procedures: Name, Date, Findings
   
3. **MEDICATION FORMAT:** For each medication, use this exact format:
   الاسم: [الدواء]
   القوة: [القوة]
   الجرعة: [المقدار]
   التكرار: [مرات الاستخدام]
   المدة: [فترة الاستخدام]
   الطريق: [طريق التعاطي]
   
4. **DO NOT MISS ANY DETAIL** no matter how small. If unsure, include it anyway.
5. Present the information in a clear, structured manner with appropriate headings.`;
    
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
    
    const extractedText = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
    
    // التحقق من جودة البيانات المستخرجة
    const validation = validateExtractedData(extractedText);
    if (!validation.isValid) {
        throw new Error(`استخراج البيانات غير مكتمل: ${validation.reason}`);
    }
    
    return extractedText;
}

// --- المرحلة الثانية: تعليمات المدقق الخبير لـ GPT-4o ---
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
                        "strength": "string",
                        "frequency": "string",
                        "duration": "string",
                        "itemType": "lab|medication|procedure",
                        "status": "تم إجراؤه|مفقود ولكنه ضروري",
                        "analysisCategory": "صحيح ومبرر|إجراء مكرر|غير مبرر طبياً|إجراء يتعارض مع التشخيص|إغفال خطير|خطأ في الجرعة أو التكرار|الكمية تحتاج لمراجعة",
                        "insuranceDecision": {"label": "مقبول|مرفوض|لا ينطبق", "justification": "string"}
                    }
                ],
                recommendations: [ 
                    { "priority": "عاجلة|أفضل ممارسة", "description": "string", "relatedItems": ["string"] } 
                ]
            }
        },
    };
    const selectedLang = langConfig[lang] || langConfig['ar'];

    return `You are an expert, evidence-based clinical pharmacist and medical auditor. Respond with a valid JSON object.

**Primary Knowledge Base:**
* **Cardiology:** AHA/ACC/ESC Guidelines. For patients with risk factors (Age > 50, DM, HTN), ECG and Troponin are mandatory for relevant symptoms.
* **Endocrinology:** ADA Standards. Annual fundus exam is mandatory for Type 2 diabetics. **Diamicron MR (Gliclazide MR)** is dosed **once daily**. Twice daily is a major dosing error.
* **Reimbursement:** Focus on Medical Necessity, Duplication, Contraindications, and unusual quantities.

**STRICTER ANALYSIS RULES:**

**Rule 0: Comprehensive Listing (MOST IMPORTANT):**
The final JSON \`table\` **MUST** contain one entry for **EVERY SINGLE** medication, lab, and procedure from the clinical data. **DO NOT OMIT ANY ITEM.**
* **For correct items:** List them with \`analysisCategory\` as "صحيح ومبرر" (Correct and Justified).
* **For each medication:** You **MUST** populate the \`dosage_written\`, \`strength\`, \`frequency\`, and \`duration\` fields with the exact text transcribed from the source.

**Rule 1: Clinical Validity Analysis:**
* **Dosing/Frequency Error:** Flag incorrect dosages (e.g., Diamicron MR twice daily). Justification: "خطأ في الجرعة/التكرار. الجرعة القياسية هي مرة واحدة يومياً."
* **Medical Unnecessity:** Flag items without supporting symptoms or diagnosis.
* **Contraindication:** Flag items that conflict with the patient's conditions.

**Rule 2: Prescription Duration Analysis (90-Day Rule):**
* If a medication is prescribed for a duration of 90 days, you must analyze its appropriateness.
* If the patient's condition is chronic and stable, this can be "صحيح ومبرر".
* However, if stability is not documented or for a first-time prescription, set the \`analysisCategory\` to **"الكمية تحتاج لمراجعة"** (Quantity Requires Review). Justification: "وصفة لمدة 90 يوماً تتطلب مبرراً واضحاً للاستقرار السريري، وهو غير متوفر."

**Rule 3: Proactive Standard of Care Analysis (Omissions):**
* Identify and list **Critical Omissions** (like missing ECG/Troponin/Fundus Exam).

**Rule 4: Medication Specific Analysis:**
* For each medication, verify: strength, dosage form, frequency, and duration
* Cross-check with known standard dosing guidelines
* Flag any discrepancies immediately

${selectedLang.rule}

**Your response must be ONLY the valid JSON object conforming to this exact schema. Do not include any other text.**
\`\`\`json
${JSON.stringify(selectedLang.schema, null, 2)}
\`\`\``;
}

// --- تحسين التواصل مع OpenAI مع إعادة المحاولة ---
async function getAuditFromOpenAI(bundle, lang, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(OPENAI_API_URL, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json", 
                    Authorization: `Bearer ${OPENAI_API_KEY}` 
                },
                body: JSON.stringify({
                    model: OPENAI_MODEL,
                    messages: [
                        { role: "system", content: getExpertAuditorInstructions(lang) },
                        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0.1, // تقليل العشوائية لتحسين الدقة
                    max_tokens: 4000  // زيادة الحد الأقصى لل tokens
                }),
            });
            
            const data = await response.json();
            if (!response.ok) {
                if (i === retries - 1) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
                continue;
            }
            
            const content = data?.choices?.[0]?.message?.content;
            if (!content) {
                if (i === retries - 1) throw new Error("OpenAI returned empty response");
                continue;
            }
            
            // التحقق من صحة JSON قبل الإرجاع
            try {
                const parsed = JSON.parse(content);
                
                // التحقق من وجود البيانات الأساسية في التقرير
                if (!parsed.table || parsed.table.length === 0) {
                    throw new Error("التقرير لا يحتوي على جدول التحليل");
                }
                
                return parsed;
            } catch (parseError) {
                if (i === retries - 1) {
                    throw new Error(`فشل تحليل JSON من OpenAI: ${parseError.message}`);
                }
            }
        } catch (err) {
            if (i === retries - 1) throw err;
            // الانتظار قبل إعادة المحاولة
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
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
        strengthHeader: isArabic ? "القوة" : "Strength",
        frequencyHeader: isArabic ? "التكرار" : "Frequency",
        durationHeader: isArabic ? "المدة" : "Duration",
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
        if (normalizedCategory.includes('إغفال') || normalizedCategory.includes('omission') || 
            normalizedCategory.includes('يتعارض') || normalizedCategory.includes('contradicts') || 
            normalizedCategory.includes('خطأ في الجرعة') || normalizedCategory.includes('dosing error')) {
            return 'risk-critical';
        }
        if (normalizedCategory.includes('مكرر') || normalizedCategory.includes('duplicate') || 
            normalizedCategory.includes('غير مبرر') || normalizedCategory.includes('not justified') || 
            normalizedCategory.includes('تحتاج لمراجعة') || normalizedCategory.includes('requires review')) {
            return 'risk-warning';
        }
        if (normalizedCategory.includes('صحيح') || normalizedCategory.includes('correct')) {
            return 'risk-ok';
        }
        return '';
    };

    const sourceDocsHtml = (files || []).map(f => {
        const isImg = (f.mimeType || '').startsWith('image/');
        const src = `data:${f.mimeType};base64,${f.data}`;
        const filePreview = isImg ? 
            `<img src="${src}" alt="${f.name}" style="max-width: 100%; max-height: 200px;" />` : 
            `<div style="padding:20px; border:1px dashed #e5e7eb; border-radius:8px; background:#f9fbfc; color:#6b7280; text-align:center;">${f.name}</div>`;
        return `<div class="source-doc-card"><h3>${f.name}</h3>${filePreview}</div>`;
    }).join('');

    const tableRows = (s.table || []).map(r => 
        `<tr class="${getRiskClass(r.analysisCategory)}">
            <td class="item-cell">
                <div class="item-name">${r.name || '-'}</div>
                <small class="item-category">${r.analysisCategory || ''}</small>
            </td>
            <td class="dosage-cell">${r.dosage_written || '-'}</td>
            <td class="strength-cell">${r.strength || '-'}</td>
            <td class="frequency-cell">${r.frequency || '-'}</td>
            <td class="duration-cell">${r.duration || '-'}</td>
            <td>${r.status || '-'}</td>
            <td><span class="decision-badge">${r.insuranceDecision?.label || '-'}</span></td>
            <td>${r.insuranceDecision?.justification || '-'}</td>
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
                ${rec.relatedItems && rec.relatedItems.length > 0 ? 
                    `<div class="rec-related">${text.relatedTo}: ${rec.relatedItems.join(', ')}</div>` : ''}
            </div>
        </div>`;
    }).join("");

    return `
    <!DOCTYPE html>
    <html dir="${isArabic ? 'rtl' : 'ltr'}">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>التقرير الطبي</title>
        <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
        <style>
            body { 
                direction: ${isArabic ? 'rtl' : 'ltr'}; 
                font-family: 'Tajawal', sans-serif; 
                background-color: #f8f9fa; 
                color: #3c4043; 
                line-height: 1.6; 
                padding: 20px;
            }
            .report-container { max-width: 1200px; margin: 0 auto; }
            .report-section { 
                border: 1px solid #dee2e6; 
                border-radius: 12px; 
                margin-bottom: 24px; 
                padding: 24px; 
                background: #fff; 
                box-shadow: 0 4px 6px rgba(0,0,0,0.05); 
                page-break-inside: avoid; 
            }
            .report-section h2 { 
                font-size: 22px; 
                font-weight: 700; 
                color: #0d47a1; 
                margin: 0 0 20px; 
                display: flex; 
                align-items: center; 
                gap: 12px; 
                border-bottom: 2px solid #1a73e8; 
                padding-bottom: 12px; 
            }
            
            .source-docs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }
            .source-doc-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; }
            .source-doc-card h3 { margin: 0 0 10px; font-size: 16px; }
            
            .audit-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 14px;
            }
            .audit-table th, .audit-table td {
                padding: 12px;
                text-align: ${isArabic ? 'right' : 'left'};
                border-bottom: 1px solid #e9ecef;
                vertical-align: top;
            }
            .audit-table th {
                background-color: #f8f9fa;
                font-weight: 700;
            }
            .audit-table tr { page-break-inside: avoid; }

            .item-cell .item-name {
                font-weight: 700;
                color: #202124;
                font-size: 15px;
                margin: 0 0 4px 0;
            }
            .item-cell .item-category {
                font-size: 12px;
                font-weight: 500;
                color: #5f6368;
                display: block;
            }
            .dosage-cell, .strength-cell, .frequency-cell, .duration-cell {
                font-family: monospace, sans-serif;
                color: #3d3d3d;
                font-size: 14px;
            }
            .decision-badge {
                font-weight: 700;
                padding: 5px 10px;
                border-radius: 16px;
                font-size: 13px;
                display: inline-block;
                border: 1px solid transparent;
            }
            
            .rec-item { 
                display: flex; 
                gap: 16px; 
                align-items: flex-start; 
                margin-bottom: 12px; 
                padding: 14px; 
                border-radius: 8px; 
                background: #f8f9fa; 
                border-${isArabic ? 'right' : 'left'}: 4px solid; 
                page-break-inside: avoid; 
            }
            .rec-priority { 
                flex-shrink: 0; 
                font-weight: 700; 
                padding: 5px 12px; 
                border-radius: 8px; 
                font-size: 12px; 
                color: #fff; 
            }
            .rec-priority.urgent, .rec-priority.عاجلة { background: #d93025; }
            .rec-priority.best-practice, .rec-priority.أفضل { background: #1e8e3e; }
            .rec-item.urgent-border { border-color: #d93025; }
            .rec-item.best-practice-border { border-color: #1e8e3e; }
            .rec-content { display: flex; flex-direction: column; }
            .rec-desc { color: #202124; font-size: 15px; }
            .rec-related { font-size: 12px; color: #5f6368; margin-top: 6px; }

            .audit-table tr.risk-critical td { background-color: #fce8e6 !important; }
            .audit-table tr.risk-warning td { background-color: #fff0e1 !important; }
            .audit-table tr.risk-ok td { background-color: #e6f4ea !important; }
            .audit-table tr td .decision-badge { background-color: #e8eaed; color: #5f6368; }
            .audit-table tr.risk-ok td .decision-badge { background-color: #e6f4ea; color: #1e8e3e; }
            .audit-table tr.risk-critical td .decision-badge { background-color: #fce8e6; color: #d93025; }
            
            @media print {
                body { background: white; }
                .report-section { box-shadow: none; border: 1px solid #ddd; }
                .rec-item { page-break-inside: avoid; }
            }
        </style>
    </head>
    <body>
        <div class="report-container">
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
                                <th>${text.itemHeader}</th>
                                <th>${text.dosageHeader}</th>
                                <th>${text.strengthHeader}</th>
                                <th>${text.frequencyHeader}</th>
                                <th>${text.durationHeader}</th>
                                <th>${text.statusHeader}</th>
                                <th>${text.decisionHeader}</th>
                                <th>${text.justificationHeader}</th>
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
        </div>
    </body>
    </html>`;
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
        
        if (!text && (!files || files.length === 0)) {
            return bad(res, 400, "No data provided: Please provide either text or files to analyze.");
        }

        console.log("Step 1: Starting data aggregation with Gemini...");
        const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
        console.log("Step 1: Gemini aggregation successful.");
        console.log("Extracted text length:", aggregatedClinicalText.length);
        
        const auditBundle = { 
            patientInfo, 
            aggregatedClinicalText, 
            originalUserText: text,
            extractionTimestamp: new Date().toISOString()
        };

        console.log("Step 2: Starting expert audit with OpenAI...");
        const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);
        console.log("Step 2: OpenAI audit successful.");
        console.log("Audit items count:", structuredAudit.table ? structuredAudit.table.length : 0);
        
        console.log("Step 3: Rendering HTML report...");
        const htmlReport = renderHtmlReport(structuredAudit, files, lang);
        console.log("Step 3: HTML rendering successful.");

        console.log("--- Request Processed Successfully ---");
        return ok(res, { 
            html: htmlReport, 
            structured: structuredAudit,
            extraction: {
                textLength: aggregatedClinicalText.length,
                itemsCount: structuredAudit.table ? structuredAudit.table.length : 0
            }
        });
    } catch (err) {
        console.error("---!!!--- An error occurred during the process ---!!!---");
        console.error("Error Message:", err.message);
        console.error("Error Stack:", err.stack);
        return bad(res, 500, `An internal server error occurred. Check the server logs for details. Error: ${err.message}`);
    }
}
