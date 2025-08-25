// هذا الإعداد مخصص لـ Next.js لزيادة حجم الطلب المسموح به
export const config = {
    api: {
        bodyParser: {
            sizeLimit: "50mb",
        },
    },
};

// استيراد Puppeteer - يجب تثبيته: npm install puppeteer
import puppeteer from 'puppeteer';

// --- الإعدادات الرئيسية ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_GEN_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// --- دوال مساعدة ---
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
// دالة مساعدة للحصول على JSON من الرد بطريقة آمنة
const parseJsonSafe = async (response) => {
    try {
        const text = await response.text();
        return JSON.parse(text);
    } catch (e) {
        return { error: 'Failed to parse JSON response', raw: text };
    }
};

// --- المرحلة الأولى: تجميع البيانات السريرية باستخدام Gemini (تم التعديل) ---
// **هذه الدالة تم إعادة كتابتها بالكامل لحل مشكلة الـ 500**
// **تجنبنا هنا استخدام `geminiUploadBase64` الذي كان يسبب المشكلة**
async function aggregateClinicalDataWithGemini({ text, files }) {
    const parts = [];
    if (text) {
        parts.push({ text });
    }
    // نقوم الآن بوضع محتوى الملفات مباشرة في الـ payload (inline_data)
    for (const file of files || []) {
        if (file?.data && file?.mimeType) {
            parts.push({
                inline_data: {
                    data: file.data,
                    mime_type: file.mimeType,
                },
            });
        }
    }
    
    if (parts.length === 0) {
        throw new Error("No text or files provided for analysis.");
    }
    
    const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every single piece of clinical information into a clean, comprehensive text block. **CRITICAL RULES:**
1.  **DO NOT SUMMARIZE.** Transcribe everything.
2.  List all patient details, diagnoses, and every single lab test, medication, and procedure mentioned.
3.  **For medications, transcribe the name, then on the same line, clearly state the dosage, frequency, and duration exactly as written (e.g., Amlopine 10 - 1x1x90).**
4.  Present the information in a clear, structured manner.`;
    
    const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts }],
    };
    
    const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    
    const data = await parseJsonSafe(response);
    if (!response.ok) {
        console.error("Gemini API Error Response:", data);
        const errorDetail = data.error?.message || data.raw || JSON.stringify(data);
        throw new Error(`Gemini generateContent failed. Details: ${errorDetail}`);
    }
    return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
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
                        "name": "string", "dosage_written": "string", "itemType": "lab|medication|procedure|omission",
                        "status": "تم إجراؤه|مفقود ولكنه ضروري",
                        "analysisCategory": "صحيح ومبرر|إجراء مكرر|غير مبرر طبياً|إجراء يتعارض مع التشخيص|تعارض دوائي|إغفال خطير|خطأ في الجرعة أو التكرار|الكمية تحتاج لمراجعة",
                        "insuranceDecision": {"label": "مقبول|مرفوض|لا ينطبق", "justification": "string"}
                    }
                ],
                recommendations: [ { "priority": "عاجلة|أفضل ممارسة", "description": "string", "relatedItems": ["string"] } ]
            }
        },
    };
    const selectedLang = langConfig[lang] || langConfig['ar'];

    return `You are an expert, evidence-based clinical pharmacist and medical auditor. Your ONLY response must be a valid JSON object.

**Primary Knowledge Base:**
* **Cardiology:** AHA/ACC/ESC Guidelines. For patients with risk factors (Age > 50, DM, HTN), ECG and Troponin are mandatory for relevant symptoms.
* **Endocrinology:** ADA Standards. Annual fundus exam is mandatory for Type 2 diabetics. **Diamicron MR (Gliclazide MR)** is dosed **once daily**. Twice daily is a major dosing error.
* **Reimbursement:** Focus on Medical Necessity, Duplication, Contraindications, and unusual quantities.

**Mandatory Analysis Rules:**

**Rule 0: Comprehensive Listing (MOST IMPORTANT):**
The final JSON \`table\` **MUST** contain one entry for **EVERY SINGLE** medication, lab, and procedure from the clinical data, including crucial omissions. **DO NOT OMIT ANY ITEM.**
* **For correct items:** List them with \`analysisCategory\` as "صحيح ومبرر" (Correct and Justified).
* **For each medication:** You **MUST** populate the \`dosage_written\` field with the exact text transcribed from the source (e.g., "10 1x1x90", "30 1x2x90").

**Rule 1: Clinical Validity Analysis:**
* **Dosing/Frequency Error:** Flag incorrect dosages (e.g., Diamicron MR twice daily). Justification: "خطأ في الجرعة/التكرار. الجرعة القياسية هي مرة واحدة يومياً."
* **Medical Unnecessity:** Flag items without supporting symptoms or diagnosis.
* **Drug-Diagnosis Conflict:** Flag items that conflict with the patient's diagnosed or suspected conditions.
* **Drug-Drug Conflict:** Explicitly identify and flag conflicts between two or more medications.
* **Duplicate Order:** Identify and flag any medication or procedure ordered more than once. Justification: "إجراء مكرر."

**Rule 2: Prescription Duration Analysis (90-Day Rule):**
* If a medication is prescribed for a duration of 90 days, you must analyze its appropriateness.
* If the patient's condition is chronic and stable, this can be "صحيح ومبرر".
* However, if stability is not documented or for a first-time prescription, set the \`analysisCategory\` to **"الكمية تحتاج لمراجعة"** (Quantity Requires Review). Justification: "وصفة لمدة 90 يوماً تتطلب مبرراً واضحاً للاستقرار السريري، وهو غير متوفر."

**Rule 3: Proactive Standard of Care Analysis (Omissions):**
* Identify and list **Critical Omissions** (like missing ECG/Troponin/Fundus Exam). Set \`itemType\` to "omission" and \`status\` to "مفقود ولكنه ضروري".

${selectedLang.rule}

**Your response must be ONLY the valid JSON object conforming to this exact schema. Do not include any other text.**
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
        itemHeader: isArabic ? "الإجراء" : "Item", dosageHeader: isArabic ? "الجرعة المكتوبة" : "Written Dosage",
        statusHeader: isArabic ? "الحالة" : "Status", decisionHeader: isArabic ? "قرار التأمين" : "Insurance Decision",
        justificationHeader: isArabic ? "التبرير" : "Justification", relatedTo: isArabic ? "مرتبط بـ" : "Related to",
        notAvailable: isArabic ? "غير متوفر." : "Not available."
    };
    const getRiskClass = (category) => {
        const normalizedCategory = (category || '').toLowerCase();
        if (normalizedCategory.includes('إغفال') || normalizedCategory.includes('omission') || normalizedCategory.includes('يتعارض') || normalizedCategory.includes('contradicts') || normalizedCategory.includes('خطأ في الجرعة') || normalizedCategory.includes('dosing error') || normalizedCategory.includes('تعارض دوائي') || normalizedCategory.includes('duplicate order') || normalizedCategory.includes('مكرر')) return 'risk-critical';
        if (normalizedCategory.includes('غير مبرر') || normalizedCategory.includes('not justified') || normalizedCategory.includes('تحتاج لمراجعة') || normalizedCategory.includes('requires review')) return 'risk-warning';
        if (normalizedCategory.includes('صحيح') || normalizedCategory.includes('correct')) return 'risk-ok';
        return '';
    };

    const sourceDocsHtml = (files || []).map(f => {
        const isImg = (f.mimeType || '').startsWith('image/');
        const src = `data:${f.mimeType};base64,${f.data}`;
        const filePreview = isImg ? `<img src="${src}" alt="${f.name}" style="max-width:100%; height:auto; display:block; border-radius:8px;"/>` : `<div style="padding:20px; border:1px dashed #e5e7eb; border-radius:8px; background:#f9fbfc; color:#6b7280; text-align:center;">${f.name}</div>`;
        return `<div class="source-doc-card" style="margin-bottom:12px;"><h3>${f.name}</h3>${filePreview}</div>`;
    }).join('');
    
    const tableRows = (s.table || []).map(r => `
        <tr class="${getRiskClass(r.analysisCategory)}">
            <td class="item-cell">
                <div class="item-name">${r.name || '-'}</div>
                <small class="item-category">${r.analysisCategory || ''}</small>
            </td>
            <td class="dosage-cell">${r.dosage_written || '-'}</td>
            <td>${r.status || '-'}</td>
            <td><span class="decision-badge" style="${getDecisionStyle(r.insuranceDecision?.label)}">${r.insuranceDecision?.label || '-'}</span></td>
            <td>${r.insuranceDecision?.justification || '-'}</td>
        </tr>`
    ).join("");

    const recommendationsList = (s.recommendations || []).map(rec => {
        const priorityClass = (rec.priority || '').toLowerCase();
        return `
            <div class="rec-item">
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
        body { direction: ${isArabic ? 'rtl' : 'ltr'}; font-family: 'Tajawal', sans-serif; background-color: #f8f9fa; color: #3c4043; line-height: 1.6; }
        .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 24px; padding: 24px; background: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.05); page-break-inside: avoid; }
        .report-section h2 { font-size: 22px; font-weight: 700; color: #0d47a1; margin: 0 0 20px; display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1a73e8; padding-bottom: 12px; }
        .audit-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 14px; }
        .audit-table th, .audit-table td { padding: 12px; text-align: ${isArabic ? 'right' : 'left'}; border-bottom: 1px solid #e9ecef; vertical-align: top; word-wrap: break-word; }
        .audit-table th { background-color: #f8f9fa; font-weight: 700; }
        .audit-table tr { page-break-inside: avoid; }
        .item-cell .item-name { font-weight: 700; color: #202124; font-size: 15px; margin: 0 0 4px 0; }
        .item-cell .item-category { font-size: 12px; font-weight: 500; color: #5f6368; display: block; }
        .dosage-cell { font-family: monospace, sans-serif; color: #3d3d3d; font-size: 14px; white-space: nowrap; }
        .decision-badge { font-weight: 700; padding: 5px 10px; border-radius: 16px; font-size: 13px; display: inline-block; border: 1px solid transparent; }
        .rec-item { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; padding: 14px; border-radius: 8px; background: #f8f9fa; border-right: 4px solid; margin-bottom: 12px; page-break-inside: avoid; }
        .rec-priority { flex-shrink: 0; font-weight: bold; padding: 5px 12px; border-radius: 8px; font-size: 12px; color: #fff; }
        .rec-priority.urgent, .rec-priority.عاجلة { background: #d93025; }
        .rec-priority.best-practice, .rec-priority.أفضل { background: #1e8e3e; }
        .rec-content { display: flex; flex-direction: column; }
        .rec-desc { color: #202124; font-size: 15px; }
        .rec-related { font-size: 12px; color: #5f6368; margin-top: 6px; }
        .audit-table tr.risk-critical td { background-color: #fce8e6 !important; }
        .audit-table tr.risk-warning td { background-color: #fff0e1 !important; }
        .audit-table tr.risk-ok td { background-color: #e6f4ea !important; }
        .audit-table tr td .decision-badge { background-color: #e8eaed; color: #5f6368; }
        .audit-table tr.risk-ok td .decision-badge { background-color: #e6f4ea; color: #1e8e3e; }
        .audit-table tr.risk-critical td .decision-badge { background-color: #fce8e6; color: #d93025; }
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
                        <th style="width: 28%;">${text.itemHeader}</th>
                        <th style="width: 15%;">${text.dosageHeader}</th>
                        <th style="width: 15%;">${text.statusHeader}</th>
                        <th style="width: 15%;">${text.decisionHeader}</th>
                        <th style="width: 27%;">${text.justificationHeader}</th>
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
    try {
        if (req.method !== "POST") {
            return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
        }
        
        // **هذا هو الفحص الإضافي الذي تم إضافته**
        if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
            const missingKey = !OPENAI_API_KEY ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
            console.error(`CRITICAL ERROR: The API key for ${missingKey} is missing.`);
            return bad(res, 500, `Server Configuration Error: The API key for ${missingKey} is missing or not configured correctly. Please check your .env.local file.`);
        }

        const { pathname } = new URL(req.url, `http://${req.headers.host}`);

        // Handle the /api/pdf route
        if (pathname === '/api/pdf') {
            const { html, lang = 'ar' } = req.body;
            if (!html) {
                return bad(res, 400, "Missing HTML content for PDF generation.");
            }
            try {
                console.log("Starting server-side PDF generation...");
                const browser = await puppeteer.launch({
                    args: ['--no-sandbox', '--disable-setuid-sandbox'],
                    headless: true,
                });
                const page = await browser.newPage();
                // Apply the HTML and CSS
                await page.setContent(html, { waitUntil: 'networkidle0' });
                // Ensure correct RTL rendering
                await page.evaluate(l => { document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'; }, lang);
                const pdfBuffer = await page.pdf({
                    format: 'A4',
                    margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
                    printBackground: true,
                });
                await browser.close();
                console.log("PDF generated successfully.");
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'attachment; filename="Medical_Audit_Report.pdf"');
                res.send(pdfBuffer);
            } catch (pdfError) {
                console.error("PDF generation error:", pdfError);
                return bad(res, 500, `PDF generation failed: ${pdfError.message}`);
            }
            return;
        }

        // Handle the /api/gpt route (analysis)
        const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body || {};
        console.log(`Processing analysis request with language: ${lang}`);

        console.log("Step 1: Starting data aggregation with Gemini...");
        const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
        console.log("Step 1: Gemini aggregation successful.");
        
        const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };

        console.log("Step 2: Starting expert audit with OpenAI...");
        const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);
        console.log("Step 2: OpenAI audit successful.");
        
        console.log("Step 3: Rendering HTML report...");
        const htmlReport = renderHtmlReport(structuredAudit, files, lang);
        console.log("Step 3: HTML rendering successful.");

        console.log("--- Request Processed Successfully ---");
        return ok(res, { html: htmlReport, structured: structuredAudit });

    } catch (err) {
        console.error("---!!!--- An error occurred during the process ---!!!---");
        console.error("Error Message:", err.message);
        console.error("Error Stack:", err.stack);
        const errorMessage = `An internal server error occurred. Please check the server logs. Details: ${err.message || 'No specific error message provided.'}`;
        return bad(res, 500, errorMessage);
    }
}
