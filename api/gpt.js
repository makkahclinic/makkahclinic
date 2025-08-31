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
   - Vital Signs: BP, Pulse, Temp, etc.
   - Chief Complaint & Symptoms
   - Diagnoses: List all diagnoses with codes
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

// --- تحليل التشخيص لتحديد الفحوصات المناسبة ---
function analyzeDiagnosisForRelevantTests(diagnosis, vitalSigns, age) {
    const diagnosisLower = diagnosis.toLowerCase();
    const tests = [];
    
    // تحليل التشخيص لتحديد الفحوصات المناسبة
    if (diagnosisLower.includes('dermatitis') || diagnosisLower.includes('جلد') || diagnosisLower.includes('طفح')) {
        // حالات جلدية - لا تحتاج تخطيط قلب أو تروبونين
        tests.push({
            name: "Complete Blood Count (CBC)",
            relevant: true,
            reason: "مطلوب لتقييم الالتهاب في الحالات الجلدية"
        });
        
        tests.push({
            name: "Inflammatory Markers (CRP, ESR)",
            relevant: true,
            reason: "مفيد في تقييم شدة الالتهاب الجلدي"
        });
    } 
    else if (diagnosisLower.includes('cardiac') || diagnosisLower.includes('heart') || 
             diagnosisLower.includes('chest pain') || diagnosisLower.includes('قلب')) {
        // حالات قلبية - تحتاج تخطيط قلب وتروبونين
        tests.push({
            name: "ECG",
            relevant: true,
            reason: "إجباري لأي مريض مع أعراض قلبية"
        });
        
        tests.push({
            name: "Troponin",
            relevant: true,
            reason: "إجباري لتقييم احتشاء العضلة القلبية"
        });
    }
    else {
        // حالات عامة - تقييم حسب العوامل
        const needsCardiacTesting = (vitalSigns?.bp && parseInt(vitalSigns.bp.split('/')[0]) > 160) || 
                                  (age > 50 && vitalSigns?.bp && parseInt(vitalSigns.bp.split('/')[0]) > 140);
        
        if (needsCardiacTesting) {
            tests.push({
                name: "ECG",
                relevant: true,
                reason: "مطلوب بسبب ارتفاع ضغط الدم وعمر المريض"
            });
        } else {
            tests.push({
                name: "ECG",
                relevant: false,
                reason: "غير مطلوب لعدم وجود مؤشرات قلبية"
            });
        }
    }
    
    return tests;
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
                ],
                relevantTests: [
                    {"name": "string", "relevant": "boolean", "reason": "string"}
                ]
            }
        },
    };
    const selectedLang = langConfig[lang] || langConfig['ar'];

    return `You are an expert, evidence-based clinical pharmacist and medical auditor. Respond with a valid JSON object.

**CONTEXT-AWARE ANALYSIS RULES (MOST IMPORTANT):**

**Rule 0: Diagnosis-Driven Analysis:**
You MUST analyze the clinical context before recommending tests. NOT all patients need ECG/Troponin.

**Cardiac tests (ECG/Troponin) are ONLY required when:**
- Chief complaint includes cardiac symptoms (chest pain, palpitations, shortness of breath)
- Diagnosis indicates cardiac condition
- Severe hypertension (BP > 160/100) WITH symptoms
- History of cardiac disease WITH current symptoms

**Rule 1: Comprehensive Listing:**
The final JSON \`table\` MUST contain one entry for EVERY SINGLE medication, lab, and procedure from the clinical data.

**Rule 2: Clinical Validity Analysis:**
* **Dosing/Frequency Error:** Flag incorrect dosages.
* **Medical Unnecessity:** Flag items without supporting symptoms or diagnosis.
* **Contraindication:** Flag items that conflict with the patient's conditions.

**Rule 3: Context-Aware Omissions Analysis:**
* Identify omissions based on ACTUAL clinical need, not just protocols
* For dermatological cases: focus on skin-related tests, not cardiac
* For cardiac cases: emphasize cardiac workup

**Rule 4: Medication Specific Analysis:**
* For each medication, verify: strength, dosage form, frequency, and duration
* Cross-check with known standard dosing guidelines

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
                    temperature: 0.1,
                    max_tokens: 4000
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
            
            try {
                const parsed = JSON.parse(content);
                
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
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
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
        
        const auditBundle = { 
            patientInfo, 
            aggregatedClinicalText, 
            originalUserText: text,
            extractionTimestamp: new Date().toISOString()
        };

        console.log("Step 2: Starting expert audit with OpenAI...");
        const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);
        console.log("Step 2: OpenAI audit successful.");
        
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
