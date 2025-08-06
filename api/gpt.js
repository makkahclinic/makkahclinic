// /api/medical-audit.js - النسخة النهائية المتكاملة والمطورة

/**
 * نظام متكامل للتدقيق الطبي الدوائي، يدمج التحليل العميق للذكاء الاصطناعي
 * مع قواعد بيانات داخلية للأدوية عالية الخطورة، ويدعم تحليل الصور والنصوص معاً
 * ويقدم تقارير طبية احترافية مع ضوابط أمان وخصوصية متقدمة.
 */

const systemInstruction = `
أنت "كبير محققي الأخطاء الدوائية الحرجة"، ومهمتك هي تحليل البيانات الطبية لتقديم تقرير استشاري عميق وحاسم، وليس مجرد سرد للمعلومات.

**قواعد السلوك الإلزامية الصارمة:**
1. **الدقة العلمية المطلقة:** لا تختلق أي معلومة طبية. استند إلى الحقائق المسجلة فقط.
2. **الأولوية للبيانات الأساسية:** الجنس والعمر هما حجر الأساس للتحليل. لا يمكن تجاوزهما.
3. **التواصل الاحترافي:** إذا كانت قراءة الصورة غير واضحة، اذكر أفضل تخمين لك وأتبعه بعبارة "(قراءة غير واضحة، يتطلب توضيحاً)".

**قائمة التحقيق في الأخطاء الحرجة (يجب البحث عنها بصرامة):**
1.  **التعارض المنطقي:** هل تم وصف دواء خاص بالرجال (مثل Duodart) لمريضة أنثى؟
2.  **الازدواجية العلاجية الخطرة:** هل يوجد 3 أدوية أو أكثر لعلاج الضغط (مثل Amlodipine, Co-Taburan, Triplex)؟
3.  **خطأ الجرعة القاتل:** هل تم وصف دواء ممتد المفعول (خاصة Diamicron MR أو TR) أكثر من مرة واحدة يومياً (مثل جرعة 1x2)؟

**منهجية التحليل الإلزامية (اتبع هذه الخطوات بالترتيب الصارم):**

**الخطوة 1: تحديد مصدر الحقيقة واستخلاص البيانات الأساسية**
- **إذا وُجدت صورة:** هي المصدر الأساسي للحقيقة. استخرج: رقم الملف، الجنس (من الخانة ✓)، العمر، التشخيصات، الأدوية.
- **إذا لم تجد الجنس أو العمر بشكل واضح في الصورة،** يجب أن تكون هذه هي **الملاحظة الحرجة الأولى** في تقريرك، تحت عنوان "فجوة معلومات حرجة"، ويجب أن تذكر أنه لا يمكن إتمام التحليل الدوائي بأمان بدون هذه المعلومات. **ممنوع افتراض الجنس أو العمر إطلاقاً.**
- **إذا وُجد نص:** قارن بدقة وأبلغ عن أي تناقضات تجدها.
- **بدون صورة:** النص هو المصدر الوحيد.

**الخطوة 2: إنشاء التقرير النهائي (HTML فقط)**
1. **ملخص الحالة:** البيانات الأساسية + أي فجوات معلومات حرجة أو تناقضات.
2. **التحليل السريري العميق والتوصيات الحاسمة:** هذا هو القسم الأهم. لكل خطأ وجدته من "قائمة التحقيق"، اكتب فقرة تحليلية مفصلة تتضمن:
    - **الخطأ المكتشف:** (مثال: "تم وصف دواء Diamicron MR مرتين يومياً").
    - **شرح الخطورة:** (مثال: "هذا خطأ علاجي جسيم لأن أدوية MR مصممة للإفراز البطيء، وتقسيم الجرعة يعرض المريض لخطر هبوط سكر حاد").
    - **التوصية الحاسمة:** (مثال: "يجب التواصل فوراً مع الطبيب لتصحيح الجرعة إلى مرة واحدة يومياً").
3. **جدول الأدوية الشامل:** أنشئ جدولاً بالأعمدة التالية: "الدواء", "الجرعة المترجمة", "الغرض الطبي المرجح", "التفاعلات", "الوضع التأميني".
   - **الوضع التأميني:** استخدم الأيقونات التالية:
     - ✅ مقبول
     - ⚠️ يحتاج مراجعة/تبرير
     - ❌ خطير/مرفوض (استخدم هذه العلامة للأدوية التي تحتوي على خطأ حرج).
4. **فرص تحسين الرعاية:** الفحوصات الناقصة والبدائل الآمنة.
5. **خطة العمل:** أولويات التصحيح الفوري.
6. **المراجع العلمية:** اذكر بعض المصادر الموثوقة (مثل UpToDate, Medscape).
7. **الخاتمة الإلزامية:** "هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص."
`;

// ========== دالة معالجة البيانات والخصوصية ========== //
function buildUserPrompt(caseData) {
    // تطبيق إجراءات الخصوصية
    const sanitizedData = {
        gender: caseData.gender || '',
        age: caseData.age || '',
        fileNumber: caseData.fileNumber ? '...' + caseData.fileNumber.slice(-4) : '', // إخفاء جزء من الرقم
        diagnosis: caseData.diagnosis || '',
        medications: caseData.medications || '',
        imageData: caseData.imageData || []
    };

    let textDataPrompt = "**البيانات النصية المدخلة (للمقارنة):**\n";
    let hasTextData = false;

    if (sanitizedData.fileNumber) { textDataPrompt += `- رقم الملف: ${sanitizedData.fileNumber}\n`; hasTextData = true; }
    if (sanitizedData.gender) { textDataPrompt += `- الجنس: ${sanitizedData.gender}\n`; hasTextData = true; }
    if (sanitizedData.age) { textDataPrompt += `- العمر: ${sanitizedData.age}\n`; hasTextData = true; }
    if (sanitizedData.diagnosis) { textDataPrompt += `- التشخيصات: ${sanitizedData.diagnosis}\n`; hasTextData = true; }
    if (sanitizedData.medications) { textDataPrompt += `- الأدوية: ${sanitizedData.medications}\n`; hasTextData = true; }

    const imageDataPrompt = `
**الملفات المرفوعة:**
- ${sanitizedData.imageData.length > 0
        ? `تم تحميل ${sanitizedData.imageData.length} صورة للتحليل. **الصورة هي المصدر الأساسي للحقيقة.**`
        : "لا يوجد صور مرفقة. **سيتم الاعتماد على البيانات النصية أعلاه.**"}
    `;
    
    const ageWarning = sanitizedData.age && parseInt(sanitizedData.age) > 65
        ? `\n\n**تحذير خاص:** المريض كبير السن (${sanitizedData.age} سنة) - يتطلب مراجعة دقيقة للجرعات.`
        : '';

    return `
${hasTextData ? textDataPrompt : "**لا توجد بيانات نصية مدخلة.**"}
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

        // التحقق من حجم البيانات
        if (JSON.stringify(req.body).length > 5 * 1024 * 1024) { // 5MB limit
            return res.status(413).json({ error: "Payload size exceeds the 5MB limit." });
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

        const parts = [
            { text: systemInstruction },
            { text: buildUserPrompt(req.body) }
        ];

        if (req.body.imageData && Array.isArray(req.body.imageData)) {
            req.body.imageData.forEach(imgData => {
                // Assuming base64 string is passed directly in the array
                if (typeof imgData === 'string') {
                     parts.push({
                        inline_data: {
                            mimeType: 'image/jpeg', // Defaulting to JPEG, can be made dynamic
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
                maxOutputTokens: 4096
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
