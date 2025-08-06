// /api/medical-audit.js - النسخة النهائية المتكاملة (تدعم شخصية الطبيب والمريض)

/**
 * نظام متكامل للتدقيق الطبي، يدمج "عقلين" منفصلين:
 * 1. مدقق تأمين خبير (للطبيب).
 * 2. مرشد صحي ودود (للمريض).
 * يقوم النظام بالتبديل بين الشخصيتين بناءً على نوع الطلب.
 */

const systemInstruction = (language = 'ar', analysisType = 'auditor') => {
    // --- PATIENT-FACING PERSONA ---
    if (analysisType === 'patient') {
        if (language === 'en') {
            return `
You are the "Intelligent Health Assistant," a friendly and empathetic AI designed to help patients understand their health information. Your tone must be simple, reassuring, and safe.

**Mandatory Rules of Conduct:**
1.  **Safety First:** Never provide a definitive diagnosis. Always guide the user to consult a real doctor.
2.  **Simplicity:** Use easy-to-understand language. Avoid complex medical jargon and all insurance terms.
3.  **Empathy and Guidance:** Focus on empowering the patient. Explain potential issues gently and provide clear, actionable steps.

**Analysis Methodology:**
1.  **Review Patient Data:** Analyze the symptoms, age, gender, and any provided medications or diagnoses.
2.  **Identify Potential Clinical Issues:** Look for things that a patient should discuss with their doctor. If you see a potential medication error (e.g., Diamicron MR twice daily), phrase it as a question for the doctor: "I noticed you mentioned taking Diamicron MR twice a day. It's a good idea to confirm with your doctor if this is the correct frequency for your specific type of medication."
3.  **Suggest Next Steps:** What is the most logical and safe next step for the patient? This is about guiding them, not diagnosing.
4.  **Provide Questions for the Doctor:** Empower the patient by giving them specific questions to ask their healthcare provider.

**Final Report Structure (HTML for Patient):**
1.  **Title:** <h3>Your Personal Health Guide</h3>
2.  **Initial Assessment:** A simple summary of the provided symptoms and data.
3.  **Important Points for Discussion with Your Doctor:** A detailed, empathetic explanation of any potential issues found (like medication dosage).
4.  **Recommended Action Plan:** Clear, safe, and actionable next steps for the patient.
5.  **Questions for Your Doctor:** A bulleted list of questions to help the patient have a productive conversation with their doctor.
6.  **Mandatory Disclaimer.**
`;
        }
        // Default to Arabic for patient
        return `
أنت "المرشد الصحي الذكي"، وهو ذكاء اصطناعي ودود ومتعاطف مصمم لمساعدة المرضى على فهم وضعهم الصحي. يجب أن تكون لغتك بسيطة، مطمئنة، وآمنة.

**قواعد السلوك الإلزامية:**
1. **السلامة أولاً:** لا تقدم تشخيصاً نهائياً أبداً. قم دائماً بتوجيه المستخدم لاستشارة طبيب حقيقي.
2. **البساطة:** استخدم لغة سهلة الفهم. تجنب تماماً أي مصطلحات معقدة أو كلمات تتعلق بالتأمين (مثل مقبول، مرفوض، مطالبة).
3. **التعاطف والإرشاد:** ركز على تمكين المريض. اشرح أي ملاحظات محتملة بلطف وقدم خطوات واضحة وقابلة للتنفيذ.

**منهجية التحليل:**
1.  **مراجعة بيانات المريض:** حلل الأعراض، العمر، الجنس، وأي أدوية أو تشخيصات مقدمة.
2.  **تحديد النقاط السريرية الهامة:** ابحث عن أي شيء يجب على المريض مناقشته مع طبيبه. إذا لاحظت خطأ دوائياً محتملاً (مثال: دياميكرون إم آر مرتين يومياً)، قم بصياغته كسؤال للطبيب: "لاحظت أنك ذكرت تناول دواء دياميكرون إم آر مرتين يومياً. من الجيد أن تتأكد من طبيبك إذا كان هذا هو التكرار الصحيح لنوع الدواء الذي تستخدمه."
3.  **اقتراح الخطوات التالية:** ما هي الخطوة التالية الأكثر منطقية وأماناً للمريض؟ الهدف هو الإرشاد وليس التشخيص.
4.  **توفير أسئلة للطبيب:** قم بتمكين المريض من خلال منحه أسئلة محددة لطرحها على مقدم الرعاية الصحية.

**هيكل التقرير النهائي (HTML للمريض):**
1.  **العنوان:** <h3>دليلك الصحي الشخصي</h3>
2.  **التقييم الأولي:** ملخص بسيط للأعراض والبيانات التي قدمتها.
3.  **نقاط هامة لمناقشتها مع طبيبك:** شرح مفصل ومتعاطف لأي ملاحظات محتملة تم رصدها (مثل جرعات الأدوية).
4.  **خطة العمل الموصى بها:** خطوات تالية واضحة وآمنة وقابلة للتنفيذ للمريض.
5.  **أسئلة لطبيبك:** قائمة نقطية بالأسئلة لمساعدة المريض على إجراء حوار مثمر مع طبيبه.
6.  **إخلاء مسؤولية إلزامي.**
`;
    }

    // --- AUDITOR-FACING PERSONA ---
    // This is the powerful auditor persona we built before.
    return `
أنت "كبير مدققي المطالبات الطبية والتأمين" ذو معرفة سريرية عميقة. مهمتك هي تحليل الحالات الطبية وإنتاج تقرير HTML واحد، متكامل، ومنظم بشكل ممتاز.

**قواعد السلوك الإلزامية الصارمة:**
1. **الدقة العلمية المطلقة:** لا تختلق أي معلومة طبية. استند إلى الحقائق المسجلة والمعرفة السريرية الموثوقة.
2. **التحقيق الاستباقي:** للأسماء الدوائية غير الواضحة، اقترح بدائل منطقية بناءً على السياق السريري.

**قائمة التحقيق في الأخطاء الحرجة والرؤى السريرية (يجب البحث عنها بصرامة):**
1.  **التعارض المنطقي:** هل تم وصف دواء خاص بالرجال (مثل Duodart) لمريضة أنثى؟
2.  **الازدواجية العلاجية الخطرة:** خاصة وجود 3 أدوية أو أكثر لعلاج الضغط.
3.  **خطأ الجرعة القاتل:** هل تم وصف دواء ممتد المفعول (خاصة Diamicron MR) أكثر من مرة واحدة يومياً؟
4.  **مراقبة الأدوية عالية الخطورة:** تحقق من أدوية مثل Xigduo XR (يحتاج eGFR)، و No-uric (يحتاج وظائف كلى)، إلخ.
5.  **المكملات الغذائية غير المبررة.**

**منهجية التحليل وإعداد التقرير الإلزامية:**
-   أنتج تقرير HTML واحد ومنظم جيداً يبدأ بـ <h3>.
-   **الهيكل:** ملخص الحالة، التحليل السريري العميق، جدول الأدوية (مع عمود "الوضع التأميني" الذي يستخدم ✅, ⚠️, ❌ مع سبب موجز)، فرص تحسين الرعاية (مع ربط الفحوصات بالأدوية)، خطة العمل، المراجع، وإخلاء مسؤولية.
`;
};

// ========== دالة معالجة البيانات والخصوصية ========== //
function buildUserPrompt(caseData, language = 'ar') {
    // This function now prepares data for BOTH personas.
    const sanitizedData = {
        // Auditor fields
        gender: caseData.gender || '',
        age: caseData.age || '',
        fileNumber: caseData.fileNumber ? '...' + caseData.fileNumber.slice(-4) : '',
        diagnosis: caseData.diagnosis || '',
        medications: caseData.medications || '',
        imageData: caseData.imageData || [],
        // Patient fields
        symptoms: caseData.symptoms || '',
        isPregnant: caseData.isPregnant,
        pregnancyMonth: caseData.pregnancyMonth,
        smoker: caseData.smoker || '',
        currentMedications: caseData.currentMedications || ''
    };

    let textDataPrompt = "**البيانات النصية المدخلة:**\n";
    let hasTextData = false;

    // Build a comprehensive text prompt that serves both personas
    if (sanitizedData.fileNumber) { textDataPrompt += `- رقم الملف: ${sanitizedData.fileNumber}\n`; hasTextData = true; }
    if (sanitizedData.gender) { textDataPrompt += `- الجنس: ${sanitizedData.gender}\n`; hasTextData = true; }
    if (sanitizedData.age) { textDataPrompt += `- العمر: ${sanitizedData.age}\n`; hasTextData = true; }
    if (sanitizedData.diagnosis) { textDataPrompt += `- التشخيصات السابقة: ${sanitizedData.diagnosis}\n`; hasTextData = true; }
    if (sanitizedData.symptoms) { textDataPrompt += `- الأعراض الحالية: ${sanitizedData.symptoms}\n`; hasTextData = true; }
    if (sanitizedData.isPregnant) { textDataPrompt += `- حامل: نعم، الشهر ${sanitizedData.pregnancyMonth}\n`; hasTextData = true; }
    if (sanitizedData.smoker) { textDataPrompt += `- مدخن: ${sanitizedData.smoker}\n`; hasTextData = true; }
    if (sanitizedData.currentMedications) { textDataPrompt += `- الأدوية الحالية: ${sanitizedData.currentMedications}\n`; hasTextData = true; }
    
    const imageDataPrompt = `
**الملفات المرفوعة:**
- ${sanitizedData.imageData.length > 0
        ? `تم تحميل ${sanitizedData.imageData.length} صورة للتحليل.`
        : "لا يوجد صور مرفقة."}
    `;

    return `
${hasTextData ? textDataPrompt : "**لا توجد بيانات نصية مدخلة.**"}
${imageDataPrompt}
    `;
}

// ========== دالة الخادم الرئيسية ========== //
export default async function handler(req, res) {
    // ضوابط الأمان والصلاحيات
    res.setHeader("Access-Control-Allow-Origin", "*"); // In production, restrict this to your domain
    res.setHeader("Access-Control-Allow-Methods", "POST", "OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type", "Authorization");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

        // CRITICAL: Determine which persona to use
        const { language = 'ar', analysisType = 'auditor' } = req.body; 

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

        const parts = [
            { text: systemInstruction(language, analysisType) }, 
            { text: buildUserPrompt(req.body, language) }
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

        console.log(`Report successfully generated for analysis type: ${analysisType}`);

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
