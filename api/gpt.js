// /api/medical-audit.js - النسخة النهائية المتكاملة والمطورة (تدعم العربية والإنجليزية)

/**
 * نظام متكامل للتدقيق الطبي الدوائي، يدمج التحليل العميق للذكاء الاصطناعي
 * مع قواعد بيانات داخلية للأدوية عالية الخطورة، ويدعم تحليل الصور والنصوص معاً
 * ويقدم تقارير طبية احترافية مع ضوابط أمان وخصوصية متقدمة.
 */

const systemInstruction = (language = 'ar') => {
    if (language === 'en') {
        return `
You are a "Chief Medical Claims Auditor" with deep clinical knowledge. Your mission is to analyze medical cases and produce a single, complete, and well-structured HTML report.

**Mandatory Rules of Conduct:**
1.  **Absolute Scientific Accuracy:** Do not invent medical information. Base your analysis only on recorded facts.
2.  **Proactive Investigation:** For unclear drug names, propose logical alternatives based on the clinical context.

**Critical Error & Clinical Insight Checklist (Must be strictly investigated):**
1.  **Logical Contradiction:** Male-specific drug (e.g., Duodart) for a female patient.
2.  **Dangerous Therapeutic Duplication:** Especially 3+ hypertension drugs (e.g., Triplex, Diovan).
3.  **Fatal Dosage Error:** Extended-release drugs (e.g., Diamicron MR) prescribed more than once daily.
4.  **High-Risk Drug Monitoring:**
    - **Xigduo XR:** Warn about the need for a baseline eGFR test.
    - **No-uric (Allopurinol):** Recommend checking Uric Acid levels and renal function.
    - **Vominore + Bertigo in Elderly:** Warn about excessive sedation risk.
5.  **Unjustified Supplements:** Identify and flag supplements (e.g., Pan check) as likely not covered.

**Mandatory Analysis & Reporting Methodology:**

**Step 1: Data Extraction and Initial Analysis**
-   The image is the primary source of truth. Extract all data from it: File No., Gender (from the ✓ mark), Age, Diagnoses, and all medications with their dosages.
-   If text data is provided, use it for comparison and report any discrepancies as a critical note.
-   Perform the deep analysis based on the "Critical Error & Clinical Insight Checklist".

**Step 2: Generate the Final HTML Report**
-   Your entire output must be a single HTML code block.
-   **Structure:**
    1.  **Title:** <h3>Medical Audit and Insurance Claims Report</h3>
    2.  **Case Summary:** Include basic data and any critical notes (like data discrepancies or missing essential info like Age/Gender).
    3.  **In-depth Clinical Analysis:** For each major finding from the checklist, write a detailed analytical paragraph.
    4.  **Table of Drugs and Procedures:** Create a table with these exact columns: "Drug/Procedure", "Dosage - Detail", "Presumed Medical Purpose", "Drug-Drug Interaction", "Insurance Status".
        -   **Insurance Status Column:** This is critical. Use an icon AND a clear, concise text explaining the assessment based on your analysis. Examples:
            -   `❌ Rejected (Critical Dosage Error)`
            -   `❌ Rejected (Therapeutic Duplication)`
            -   `⚠️ Needs Justification (eGFR test required)`
            -   `✅ Approved`
    5.  **Opportunities for Care Improvement:** A detailed bulleted list of missing tests, linking each test to the drug or diagnosis that justifies it.
    6.  **Action Plan:** A clear, numbered list of immediate correction priorities.
    7.  **Scientific References:** Cite reputable sources (UpToDate, Medscape, FDA, WHO, Mayo Clinic).
    8.  **Mandatory Disclaimer:** "This report is a preliminary analysis and does not substitute for a clinical review by a specialist physician."
`;
    }

    // Default to Arabic
    return `
أنت "كبير مدققي المطالبات الطبية والتأمين" ذو معرفة سريرية عميقة. مهمتك هي تحليل الحالات الطبية وإنتاج تقرير HTML واحد، متكامل، ومنظم بشكل ممتاز.

**قواعد السلوك الإلزامية الصارمة:**
1. **الدقة العلمية المطلقة:** لا تختلق أي معلومة طبية. استند إلى الحقائق المسجلة والمعرفة السريرية الموثوقة.
2. **التحقيق الاستباقي:** للأسماء الدوائية غير الواضحة، اقترح بدائل منطقية بناءً على السياق السريري.

**قائمة التحقيق في الأخطاء الحرجة والرؤى السريرية (يجب البحث عنها بصرامة):**
1.  **التعارض المنطقي:** هل تم وصف دواء خاص بالرجال (مثل Duodart) لمريضة أنثى؟
2.  **الازدواجية العلاجية الخطرة:** خاصة وجود 3 أدوية أو أكثر لعلاج الضغط (مثل Triplex, Diovan).
3.  **خطأ الجرعة القاتل:** هل تم وصف دواء ممتد المفعول (خاصة Diamicron MR) أكثر من مرة واحدة يومياً؟
4.  **مراقبة الأدوية عالية الخطورة:**
    - **Xigduo XR:** حذر من ضرورة إجراء فحص أساسي لوظائف الكلى (eGFR).
    - **No-uric (Allopurinol):** أوصي بفحص مستويات حمض اليوريك ووظائف الكلى.
    - **Vominore + Bertigo لكبار السن:** حذر من خطر التسكين المفرط.
5.  **المكملات الغذائية غير المبررة:** حدد المكملات (مثل Pan check) وصنفها كغير مغطاة تأمينياً على الأرجح.

**منهجية التحليل وإعداد التقرير الإلزامية:**

**الخطوة 1: استخلاص البيانات والتحليل الأولي**
-   الصورة هي المصدر الأساسي للحقيقة. استخرج كل البيانات منها: رقم الملف، الجنس (من الخانة ✓)، العمر، التشخيصات، وجميع الأدوية بجرعاتها.
-   إذا تم تقديم بيانات نصية، استخدمها للمقارنة وأبلغ عن أي تناقضات كملاحظة حرجة.
-   قم بإجراء التحليل العميق بناءً على "قائمة التحقيق في الأخطاء الحرجة".

**الخطوة 2: إنشاء التقرير النهائي (HTML فقط)**
-   يجب أن يكون مخرجك بالكامل عبارة عن كتلة كود HTML واحدة.
-   **الهيكل:**
    1.  **عنوان التقرير:** <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
    2.  **ملخص الحالة:** يتضمن البيانات الأساسية وأي ملاحظات حرجة (مثل تناقض البيانات أو نقص معلومات أساسية كالعمر/الجنس).
    3.  **التحليل السريري العميق:** لكل اكتشاف رئيسي من قائمة التحقيق، اكتب فقرة تحليلية مفصلة.
    4.  **جدول الأدوية والإجراءات:** أنشئ جدولاً بهذه الأعمدة بالضبط: "الدواء/الإجراء", "الجرعة - تفصيل الإجراء", "الغرض الطبي المرجح", "Drug-Drug Interaction", "الوضع التأميني".
        -   **عمود الوضع التأميني:** هذا العمود حاسم. استخدم أيقونة **بالإضافة إلى نص وصفي واضح وموجز** يوضح سبب التقييم. أمثلة:
            -   `❌ مرفوض (خطأ جسيم في الجرعة)`
            -   `❌ مرفوض (ازدواجية علاجية)`
            -   `⚠️ قابل للرفض (يتطلب فحص eGFR)`
            -   `✅ مقبول تأمينياً`
    5.  **فرص تحسين الرعاية:** قائمة نقطية مفصلة بالفحوصات الناقصة، مع ربط كل فحص بالدواء أو التشخيص الذي يبرره.
    6.  **خطة العمل:** قائمة مرقمة وواضحة بأولويات التصحيح الفوري.
    7.  **المراجع العلمية:** اذكر بعض المصادر الموثوقة (UpToDate, Medscape, FDA, WHO, Mayo Clinic).
    8.  **الخاتمة الإلزامية:** "هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص."
`;
};

// ========== دالة معالجة البيانات والخصوصية ========== //
function buildUserPrompt(caseData, language = 'ar') {
    // تطبيق إجراءات الخصوصية
    const sanitizedData = {
        gender: caseData.gender || '',
        age: caseData.age || '',
        fileNumber: caseData.fileNumber ? '...' + caseData.fileNumber.slice(-4) : '', // إخفاء جزء من الرقم
        diagnosis: caseData.diagnosis || '',
        medications: caseData.medications || '',
        imageData: caseData.imageData || []
    };

    let textDataPrompt, hasTextData = false;
    
    if (language === 'en') {
        textDataPrompt = "**Submitted Text Data (for comparison):**\n";
        if (sanitizedData.fileNumber) { textDataPrompt += `- File No.: ${sanitizedData.fileNumber}\n`; hasTextData = true; }
        if (sanitizedData.gender) { textDataPrompt += `- Gender: ${sanitizedData.gender}\n`; hasTextData = true; }
        if (sanitizedData.age) { textDataPrompt += `- Age: ${sanitizedData.age}\n`; hasTextData = true; }
        if (sanitizedData.diagnosis) { textDataPrompt += `- Diagnoses: ${sanitizedData.diagnosis}\n`; hasTextData = true; }
        if (sanitizedData.medications) { textDataPrompt += `- Medications: ${sanitizedData.medications}\n`; hasTextData = true; }
    } else {
        textDataPrompt = "**البيانات النصية المدخلة (للمقارنة):**\n";
        if (sanitizedData.fileNumber) { textDataPrompt += `- رقم الملف: ${sanitizedData.fileNumber}\n`; hasTextData = true; }
        if (sanitizedData.gender) { textDataPrompt += `- الجنس: ${sanitizedData.gender}\n`; hasTextData = true; }
        if (sanitizedData.age) { textDataPrompt += `- العمر: ${sanitizedData.age}\n`; hasTextData = true; }
        if (sanitizedData.diagnosis) { textDataPrompt += `- التشخيصات: ${sanitizedData.diagnosis}\n`; hasTextData = true; }
        if (sanitizedData.medications) { textDataPrompt += `- الأدوية: ${sanitizedData.medications}\n`; hasTextData = true; }
    }

    const imageDataPrompt = language === 'en' ? `
**Uploaded Files:**
- ${sanitizedData.imageData.length > 0
        ? `${sanitizedData.imageData.length} image(s) uploaded for analysis. **The image is the primary source of truth.**`
        : "No images uploaded. **Relying on the text data above.**"}
    ` : `
**الملفات المرفوعة:**
- ${sanitizedData.imageData.length > 0
        ? `تم تحميل ${sanitizedData.imageData.length} صورة للتحليل. **الصورة هي المصدر الأساسي للحقيقة.**`
        : "لا يوجد صور مرفقة. **سيتم الاعتماد على البيانات النصية أعلاه.**"}
    `;
    
    const ageWarning = (sanitizedData.age && parseInt(sanitizedData.age) > 65)
        ? (language === 'en' ? `\n\n**Special Alert:** Patient is elderly (${sanitizedData.age} years) - requires careful dose review.` : `\n\n**تحذير خاص:** المريض كبير السن (${sanitizedData.age} سنة) - يتطلب مراجعة دقيقة للجرعات.`)
        : '';

    return `
${hasTextData ? textDataPrompt : (language === 'en' ? "**No text data submitted.**" : "**لا توجد بيانات نصية مدخلة.**")}
${imageDataPrompt}
${ageWarning}
    `;
}

// ========== دالة الخادم الرئيسية ========== //
export default async function handler(req, res) {
    // ضوابط الأمان والصلاحيات
    res.setHeader("Access-Control-Allow-Origin", "*"); // In production, restrict this to your domain
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

        const { language = 'ar' } = req.body; // Extract language from request, default to Arabic

        // التحقق من حجم البيانات
        if (JSON.stringify(req.body).length > 5 * 1024 * 1024) { // 5MB limit
            return res.status(413).json({ error: "Payload size exceeds the 5MB limit." });
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

        const parts = [
            { text: systemInstruction(language) }, // Pass language to the instruction function
            { text: buildUserPrompt(req.body, language) } // Pass language to the prompt builder
        ];

        if (req.body.imageData && Array.isArray(req.body.imageData)) {
            req.body.imageData.forEach(imgData => {
                if (typeof imgData === 'string') {
                     parts.push({
                        inline_data: {
                            mimeType: 'image/jpeg',
                            data: imgData
                        }
                    });
                }
            });
        }

        const payload = {
            contents: [{ role: "user", parts }],
            generationConfig: {
                temperature: 0.2,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 8192
            },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            ]
        };

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Gemini API Error:", response.status, errorBody);
            throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        const candidate = result.candidates?.[0];
        if (!candidate?.content?.parts?.[0]?.text) {
            const finishReason = candidate?.finishReason || "UNKNOWN";
            const safetyReason = result.promptFeedback?.blockReason || "Not blocked";
            console.error("Invalid response structure from Gemini:", JSON.stringify(result, null, 2));
            throw new Error(`The model failed to generate a report. Reason: ${finishReason}. Safety reason: ${safetyReason}`);
        }

        const reportHtml = candidate.content.parts[0].text;

        console.log(`Audit report successfully generated for file: ${req.body.fileNumber?.slice(-4) || 'N/A'}`);

        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Error in handler:", {
            error: err.message,
            endpoint: "/api/medical-audit",
            timestamp: new Date().toISOString()
        });

        return res.status(500).json({
            error: "Failed to perform medical analysis",
            detail: err.message,
        });
    }
}
