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
    try {
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
        
        if (!initRes.ok) {
            const errorData = await parseJsonSafe(initRes);
            throw new Error(`Gemini init failed: ${JSON.stringify(errorData)}`);
        }
        
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
    } catch (error) {
        console.error("Error in geminiUploadBase64:", error);
        throw new Error(`Failed to upload file to Gemini: ${error.message}`);
    }
}

// --- معالجة متقدمة للصور والنصوص ---
async function enhancedImageTextExtraction({ name, mimeType, base64 }) {
    try {
        const { uri } = await geminiUploadBase64({ name, mimeType, base64 });
        
        const enhancedPrompt = `You are a medical document expert. Extract ALL text from this medical document with extreme precision.

**CRITICAL INSTRUCTIONS:**
1. Extract EVERY single piece of text, including:
   - Medication names, strengths, dosages, frequencies, durations
   - Patient demographics, vital signs, diagnoses
   - Laboratory values, test results, procedures
   - Dates, times, medical record numbers

2. For medications, pay special attention to:
   - Name: Exact medication name
   - Strength: Numerical strength (e.g., 5mg, 10mg)
   - Dosage: How much to take
   - Frequency: How often (e.g., 1x daily, 2x daily)
   - Duration: How long (e.g., 30 days, 90 days)

3. PRESERVE EXACT FORMATTING and do not summarize or interpret.

4. If any text is unclear, mark it as [UNREADABLE] but still include it.

5. Organize the extracted text in structured sections.`;

        const body = {
            contents: [{
                role: "user",
                parts: [{
                    file_data: {
                        file_uri: uri,
                        mime_type: mimeType
                    }
                }]
            }],
            system_instruction: {
                parts: [{ text: enhancedPrompt }]
            }
        };

        const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await parseJsonSafe(response);
        if (!response.ok) {
            throw new Error(`Gemini extraction error: ${JSON.stringify(data)}`);
        }

        return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
    } catch (error) {
        console.error("Error in enhancedImageTextExtraction:", error);
        throw new Error(`Failed to extract text from image: ${error.message}`);
    }
}

// --- المرحلة الأولى: تجميع البيانات السريرية باستخدام Gemini ---
async function aggregateClinicalDataWithGemini({ text, files }) {
    try {
        let extractedText = text || "";
        
        // معالجة الملفات المرفقة
        for (const file of files || []) {
            const mime = file?.mimeType || "application/octet-stream";
            const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
            
            if (!base64Data) continue;
            
            let fileText = "";
            if (mime.startsWith("image/")) {
                // معالجة متقدمة للصور
                fileText = await enhancedImageTextExtraction({
                    name: file?.name || "unnamed_file",
                    mimeType: mime,
                    base64: base64Data
                });
            } else {
                // معالجة المستندات النصية
                const { uri } = await geminiUploadBase64({
                    name: file?.name || "unnamed_file",
                    mimeType: mime,
                    base64: base64Data
                });
                
                const body = {
                    contents: [{
                        role: "user",
                        parts: [{
                            file_data: {
                                file_uri: uri,
                                mime_type: mime
                            }
                        }]
                    }],
                    system_instruction: {
                        parts: [{
                            text: `Extract ALL text from this medical document exactly as written. Preserve formatting, dosages, frequencies, and all medical details. Do not summarize or interpret.`
                        }]
                    }
                };

                const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });

                const data = await parseJsonSafe(response);
                if (!response.ok) throw new Error(`Gemini extraction error: ${JSON.stringify(data)}`);

                fileText = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
            }
            
            extractedText += `\n\n--- Document: ${file.name} ---\n${fileText}`;
        }

        if (!extractedText.trim()) {
            throw new Error("No text could be extracted from the provided inputs");
        }

        // التحقق من جودة البيانات المستخرجة
        if (extractedText.length < 100) {
            console.warn("النص المستخرج قصير جداً:", extractedText);
            // لا نرمي خطأ هنا لأن بعض المستندات قد تكون قصيرة حقاً
        }

        return extractedText;
    } catch (error) {
        console.error("Error in aggregateClinicalDataWithGemini:", error);
        throw new Error(`فشل في استخراج البيانات: ${error.message}`);
    }
}

// --- نظام التحليل المتقدم للأدوية والتفاعلات ---
function createAdvancedMedicationAnalysis(extractedData) {
    const analysis = {
        medications: [],
        missingInfo: [],
        potentialInteractions: [],
        dosingIssues: [],
        appropriateness: []
    };

    // قواعد الذكاء الاصطناعي للتحليل الدوائي
    const medicationRules = {
        // مضادات ارتفاع ضغط الدم
        'amlodipine': {
            standardDose: '5-10mg once daily',
            maxDose: '10mg daily',
            monitoring: ['BP', 'Edema'],
            interactions: ['strong CYP3A4 inhibitors']
        },
        'olmesartan': {
            standardDose: '20-40mg once daily',
            maxDose: '40mg daily',
            monitoring: ['BP', 'Renal function', 'Potassium'],
            interactions: ['ARBs', 'ACE inhibitors', 'diuretics']
        },
        'valsartan': {
            standardDose: '80-160mg once daily',
            maxDose: '320mg daily',
            monitoring: ['BP', 'Renal function', 'Potassium'],
            interactions: ['ARBs', 'ACE inhibitors', 'diuretics']
        },

        // علاجات السكري
        'metformin': {
            standardDose: '500-1000mg twice daily',
            maxDose: '2000mg daily',
            monitoring: ['Renal function', 'HbA1c', 'Lactic acidosis signs'],
            interactions: ['contrast media', 'alcohol']
        },
        'glimepiride': {
            standardDose: '1-4mg once daily',
            maxDose: '8mg daily',
            monitoring: ['Blood glucose', 'HbA1c', 'Hypoglycemia'],
            interactions: ['other hypoglycemics', 'beta-blockers']
        },
        'linagliptin': {
            standardDose: '5mg once daily',
            maxDose: '5mg daily',
            monitoring: ['HbA1c', 'Pancreatitis signs'],
            interactions: ['other DPP-4 inhibitors']
        },

        // أدوية البروستاتا
        'dutasteride': {
            standardDose: '0.5mg once daily',
            maxDose: '0.5mg daily',
            monitoring: ['PSA', 'Sexual function'],
            interactions: ['other 5-alpha-reductase inhibitors'],
            warnings: ['Pregnancy warning - women should not handle']
        },
        'tamsulosin': {
            standardDose: '0.4mg once daily',
            maxDose: '0.8mg daily',
            monitoring: ['BP', 'Dizziness', 'Retrograde ejaculation'],
            interactions: ['other alpha-blockers', 'CYP3A4 inhibitors'],
            warnings: ['First-dose hypotension risk']
        },

        // الستاتينات
        'rosuvastatin': {
            standardDose: '5-20mg once daily',
            maxDose: '40mg daily',
            monitoring: ['LFTs', 'CK', 'Lipid profile'],
            interactions: ['CYP3A4 inhibitors', 'gemfibrozil'],
            warnings: ['Asian patients - start with 5mg']
        },
        'atorvastatin': {
            standardDose: '10-20mg once daily',
            maxDose: '80mg daily',
            monitoring: ['LFTs', 'CK', 'Lipid profile'],
            interactions: ['CYP3A4 inhibitors', 'gemfibrozil']
        },

        // مضادات الالتهاب والمسكنات
        'diclofenac': {
            standardDose: '50mg 2-3 times daily',
            maxDose: '150mg daily',
            monitoring: ['Renal function', 'LFTs', 'GI symptoms'],
            interactions: ['other NSAIDs', 'anticoagulants', 'ACE inhibitors'],
            warnings: ['CV risk', 'GI bleeding risk']
        },
        'celecoxib': {
            standardDose: '100-200mg twice daily',
            maxDose: '400mg daily',
            monitoring: ['Renal function', 'CV symptoms', 'GI symptoms'],
            interactions: ['CYP2C9 inhibitors', 'anticoagulants'],
            warnings: ['CV risk', 'GI bleeding risk']
        }
    };

    // تحليل النص المستخرج للعثور على الأدوية
    const text = extractedData.toLowerCase();
    
    // البحث عن الأدوية الشائعة وأنماط الجرعات
    for (const [medName, rules] of Object.entries(medicationRules)) {
        if (text.includes(medName)) {
            const medAnalysis = {
                name: medName,
                found: true,
                doseInfo: {},
                issues: [],
                recommendations: []
            };

            // البحث عن معلومات الجرعة
            const dosePattern = new RegExp(`${medName}.*?(\\d+\\s*(mg|mcg|g))`, 'i');
            const doseMatch = text.match(dosePattern);
            if (doseMatch) {
                medAnalysis.doseInfo.strength = doseMatch[1];
            } else {
                medAnalysis.issues.push('القوة غير محددة');
                analysis.missingInfo.push(`${medName} - القوة`);
            }

            // البحث عن التكرار
            const freqPattern = new RegExp(`${medName}.*?(once|twice|daily|1x|2x|3x)`, 'i');
            const freqMatch = text.match(freqPattern);
            if (freqMatch) {
                medAnalysis.doseInfo.frequency = freqMatch[1];
            } else {
                medAnalysis.issues.push('التكرار غير محدد');
                analysis.missingInfo.push(`${medName} - التكرار`);
            }

            // البحث عن المدة
            const durationPattern = new RegExp(`${medName}.*?(\\d+\\s*(days|day|weeks|week|months|month))`, 'i');
            const durationMatch = text.match(durationPattern);
            if (durationMatch) {
                medAnalysis.doseInfo.duration = durationMatch[1];
            }

            analysis.medications.push(medAnalysis);
        }
    }

    return analysis;
}

// --- المرحلة الثانية: تعليمات المدقق الخبير لـ GPT-4o ---
function getExpertAuditorInstructions(lang = 'ar') {
    const langConfig = {
        ar: {
            rule: "**قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية.**",
            schema: {
                patientSummary: {
                    "text": "ملخص تفصيلي لحالة المريض الحالية والتشخيصات.",
                    "demographics": "string",
                    "vitalSigns": "string",
                    "diagnoses": "string[]",
                    "currentSymptoms": "string[]"
                },
                overallAssessment: {
                    "text": "رأيك الخبير الشامل حول جودة الرعاية، مع تسليط الضوء على القرارات الصحيحة والإغفالات والإجراءات الخاطئة.",
                    "careQuality": "ممتازة|جيدة|مقبولة|ضعيفة",
                    "missingElements": "string[]",
                    "strengths": "string[]"
                },
                medicationAnalysis: [
                    {
                        "name": "string",
                        "strength": "string",
                        "frequency": "string",
                        "duration": "string",
                        "appropriate": "boolean",
                        "issues": "string[]",
                        "recommendations": "string[]",
                        "interactions": "string[]"
                    }
                ],
                missingMedicationInfo: [
                    {
                        "medication": "string",
                        "missingField": "string",
                        "importance": "عالي|متوسط|منخفض"
                    }
                ],
                laboratoryAnalysis: [
                    {
                        "test": "string",
                        "status": "مطلوب|تم إجراؤه|مفقود",
                        "reason": "string",
                        "urgency": "عاجل|روتيني|غير مطلوب"
                    }
                ],
                recommendations: [
                    {
                        "priority": "عاجلة|عالية|متوسطة|منخفضة",
                        "category": "دوائية|مخبرية|تشخيصية|متابعة",
                        "description": "string",
                        "actionItems": "string[]",
                        "timeline": "string"
                    }
                ],
                criticalOmissions: [
                    {
                        "omission": "string",
                        "impact": "عالي|متوسط|منخفض",
                        "recommendation": "string"
                    }
                ]
            }
        },
    };
    const selectedLang = langConfig[lang] || langConfig['ar'];

    return `You are an expert, evidence-based clinical pharmacist and medical auditor with 20+ years of experience. Respond with a valid JSON object.

**DEEP ANALYSIS FRAMEWORK (MOST IMPORTANT):**

**Rule 0: Comprehensive Medication Analysis:**
For EACH medication, you MUST analyze:
- Appropriate dosing based on guidelines
- Potential drug-drug interactions
- Appropriateness for each diagnosis
- Monitoring requirements
- Duration appropriateness
- Missing information

**Rule 1: Context-Aware Laboratory Analysis:**
- Recommend tests based on ACTUAL clinical need for each condition
- Consider patient age, comorbidities, and current medications
- Prioritize tests based on urgency and importance

**Rule 2: Critical Omissions Identification:**
- Identify missing medications that should be prescribed
- Identify unnecessary medications that should be discontinued
- Identify required monitoring that is missing
- Identify potential adverse effects that need addressing

**Rule 3: Detailed Recommendations:**
- Provide SPECIFIC, ACTIONABLE recommendations
- Include timelines for follow-up
- Specify monitoring parameters
- Suggest alternative therapies when appropriate

**Rule 4: Interaction Analysis:**
- Analyze potential drug-drug interactions
- Analyze drug-disease interactions
- Analyze drug-age appropriateness
- Analyze duplicate therapy issues

**Rule 5: Quality Assessment:**
- Rate overall care quality with specific justification
- Highlight strengths and weaknesses of current management
- Provide concrete improvement suggestions

**SPECIFIC CLINICAL GUIDELINES TO FOLLOW:**
- Hypertension: JNC 8 Guidelines, target BP < 130/80 for diabetics
- Diabetes: ADA Standards, HbA1c target < 7% for most adults
- Dyslipidemia: ACC/AHA Guidelines, statin therapy based on risk
- BPH: AUA Guidelines, combination therapy assessment
- Arthritis: ACR Guidelines, NSAID risk assessment
- Geriatric: Beers Criteria, inappropriate medications in elderly

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
            // التحليل المسبق للبيانات
            const medicationAnalysis = createAdvancedMedicationAnalysis(bundle.aggregatedClinicalText);
            
            const enhancedBundle = {
                ...bundle,
                preliminaryAnalysis: medicationAnalysis,
                analysisTimestamp: new Date().toISOString()
            };

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
                        { role: "user", content: "Clinical Data for Deep Analysis:\n" + JSON.stringify(enhancedBundle, null, 2) },
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0.1,
                    max_tokens: 6000
                }),
            });
            
            const data = await response.json();
            if (!response.ok) {
                console.error(`OpenAI API error (attempt ${i + 1}):`, data);
                if (i === retries - 1) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
                continue;
            }
            
            const content = data?.choices?.[0]?.message?.content;
            if (!content) {
                if (i === retries - 1) throw new Error("OpenAI returned empty response");
                continue;
            }
            
            try {
                const parsed = JSON.parse(content);
                
                // التحقق من جودة التحليل
                if (!parsed.medicationAnalysis || parsed.medicationAnalysis.length === 0) {
                    console.warn("التقرير لا يحتوي على تحليل دوائي كافي");
                    // نستمر رغم ذلك لأن هناك可能是 تحليلات أخرى
                }
                
                return parsed;
            } catch (parseError) {
                console.error(`JSON parse error (attempt ${i + 1}):`, parseError);
                if (i === retries - 1) {
                    throw new Error(`فشل تحليل JSON من OpenAI: ${parseError.message}`);
                }
            }
        } catch (err) {
            console.error(`Error in getAuditFromOpenAI (attempt ${i + 1}):`, err);
            if (i === retries - 1) throw err;
            // الانتظار قبل إعادة المحاولة
            await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        }
    }
}

// --- عارض التقرير المتقدم (HTML Renderer) ---
function renderHtmlReport(structuredData, files, lang = 'ar') {
    // ... (نفس المحتوى السابق)
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

        // التحقق من وجود بيانات
        if (!req.body || (!req.body.text && (!req.body.files || req.body.files.length === 0))) {
            return bad(res, 400, "No data provided: Please provide either text or files to analyze.");
        }

        const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body;
        console.log(`Processing request with language: ${lang}`);
        console.log(`Text length: ${text?.length || 0}, Files count: ${files?.length || 0}`);

        console.log("Step 1: Starting advanced data aggregation with Gemini...");
        const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
        console.log("Step 1: Gemini aggregation successful.");
        console.log("Extracted text length:", aggregatedClinicalText.length);
        
        const auditBundle = { 
            patientInfo, 
            aggregatedClinicalText, 
            originalUserText: text,
            extractionTimestamp: new Date().toISOString()
        };

        console.log("Step 2: Starting deep expert audit with OpenAI...");
        const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);
        console.log("Step 2: OpenAI audit successful.");
        
        console.log("Step 3: Rendering comprehensive HTML report...");
        const htmlReport = renderHtmlReport(structuredAudit, files, lang);
        console.log("Step 3: HTML rendering successful.");

        console.log("--- Request Processed Successfully ---");
        return ok(res, { 
            html: htmlReport, 
            structured: structuredAudit,
            extraction: {
                textLength: aggregatedClinicalText.length,
                itemsCount: structuredAudit.medicationAnalysis ? structuredAudit.medicationAnalysis.length : 0,
                analysisDepth: "deep"
            }
        });
    } catch (err) {
        console.error("---!!!--- An error occurred during the process ---!!!---");
        console.error("Error Message:", err.message);
        console.error("Error Stack:", err.stack);
        return bad(res, 500, `An internal server error occurred. Check the server logs for details. Error: ${err.message}`);
    }
}
