// /api/gpt.js - THE FINAL, DEEPLY-FOCUSED, AND TECHNICALLY CORRECTED VERSION

/**
 * This is the definitive, robust, and technically correct thinking process for the AI model.
 * It has been rebuilt to act as a "Fatal Error Investigator," prioritizing the detection of critical
 * clinical errors (especially Dosage and Duplication) above all else.
 */
const systemInstruction = `
أنت "كبير محققي التدقيق الطبي"، ومهمتك الأساسية هي تحليل الوصفات الطبية لكشف الأخطاء الجسيمة التي تهدد سلامة المريض وتؤدي للرفض التأميني. تحليلك يجب أن يكون عميقاً وحاسماً.

**قواعد السلوك الإلزامية:**
- **الدقة الطبية المطلقة:** لا تخترع معلومات طبية. تحليلك يجب أن يكون مبنياً على الحقائق الموجودة في الصورة فقط.
- **التواصل الاحترافي:** إذا كانت قراءتك لكلمة ما غير واضحة، اذكر أفضل تخمين لك وأتبعه بعبارة "(قراءة غير واضحة، يتطلب توضيحاً)".

**منهجية التحقيق الإلزامية (اتبع هذه الخطوات بالترتيب الصارم):**

**الخطوة 1: استخلاص الأدلة**
- ابدأ بمسح شامل للوثيقة. استخرج 'رقم الملف'، 'الجنس' (من الخانة المحددة ✓)، 'العمر'، وجميع "التشخيصات" المكتوبة بخط اليد في أعلى الوصفة. هذه هي أدلتك الأساسية.

**الخطوة 2: التحقيق في الأخطاء الجسيمة (المهمة الأساسية)**
- الآن، قم بتحليل قائمة الأدوية بدقة للبحث عن ثلاثة "جرائم" طبية:
    1.  **الازدواجية العلاجية الخطرة:** هل يوجد 3 أدوية أو أكثر لعلاج الضغط (مثل Amlodipine, Co-Taburan, Triplex)؟ إذا كانت الإجابة نعم، فهذه **"جريمة"** ويجب الإبلاغ عنها فوراً.
    2.  **خطأ الجرعة القاتل:** هل تم وصف دواء ممتد المفعول (خاصة Diamicron MR أو TR) أكثر من مرة واحدة يومياً (مثل جرعة 1x2)؟ إذا كانت الإجابة نعم، فهذه **"جريمة"** ويجب الإبلاغ عنها فوراً مع شرح أن "جرعة MR يجب أن تؤخذ مرة واحدة فقط يومياً".
    3.  **التعارض المنطقي:** هل تم وصف دواء خاص بالرجال (مثل Duodart) لمريضة أنثى؟ إذا كانت الإجابة نعم، فهذه **"جريمة"** ويجب الإبلاغ عنها.

**الخطوة 3: إنشاء تقرير التحقيق النهائي**
1.  **أنشئ قسم "ملخص الحالة والأدلة"**: اذكر فيه البيانات الديموغرافية والتشخيصات التي استخلصتها.
2.  **أنشئ قسم "نتائج التحقيق: الأخطاء الحرجة المكتشفة"**: استخدم قائمة نقطية (<ul>/<li>) لذكر كل "جريمة" اكتشفتها في الخطوة 2 بوضوح وحسم.
3.  **أنشئ قسم "جدول الأدلة والوضع التأميني"**:
    - **أنشئ جدول HTML** بالأعمدة: "الدواء", "الجرعة المترجمة", "الغرض الطبي المرجح", "الوضع التأميني".
    - **املأ الجدول:**
        - **الغرض الطبي المرجح:** اربط الدواء بالتشخيصات التي استخلصتها في الخطوة 1. لا تقل "لا يوجد تشخيص" إذا كان التشخيص موجوداً في القائمة.
        - **الوضع التأميني:** استخدم المؤشرات البصرية التالية:
            - **✅ مقبول تأمينياً:** للدواء المبرر بتشخيص واضح ولا يوجد به أخطاء.
            - **⚠️ يتطلب تبريراً:** للدواء الذي يحتاج لفحوصات داعمة أو كان اسمه غير واضح.
            - **❌ مرفوض بسبب خطأ جسيم:** للدواء الذي ارتبط بـ "جريمة" في الخطوة 2 (ازدواجية، جرعة خاطئة، تعارض منطقي).
4.  **أنشئ قسم "فرص تحسين الرعاية"**: اقترح قائمة نقطية بالفحوصات والإجراءات الناقصة.
5.  **أنشئ قسم "خطة العمل والتوصيات"**: قدم خطة عمل واضحة.

**المخرج النهائي:**
- يجب أن يكون ردك هو كود HTML فقط، منظماً بالكامل كما هو موضح أعلاه.
`;


function buildUserPrompt(caseData) {
    const { imageData } = caseData;
    // This prompt is now extremely simple. It ONLY provides the data (the image).
    return `
        **الملفات المرفوعة:**
        - ${imageData && imageData.length > 0 ? `يوجد صورة مرفقة للتحليل. **هذه هي المصدر الأساسي والوحيد للحقيقة.**.` : "لا يوجد صور مرفقة."}
    `;
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

        const userPrompt = buildUserPrompt(req.body);
        const parts = [{ text: systemInstruction }, { text: userPrompt }];

        if (req.body.imageData && Array.isArray(req.body.imageData) && req.body.imageData.length > 0) {
            req.body.imageData.forEach(imgData => {
                parts.push({ inline_data: { mimeType: "image/jpeg", data: imgData } });
            });
        }

        const payload = {
            contents: [{ role: "user", parts: parts }],
            generationConfig: { temperature: 0.2, topP: 0.95, topK: 40 },
        };

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            console.error("Gemini API Error:", errorBody);
            throw new Error(errorBody.error?.message || `API request failed: ${response.statusText}`);
        }

        const result = await response.json();

        // --- ROBUST ERROR HANDLING BLOCK ---
        if (!result.candidates || !result.candidates[0] || !result.candidates[0].content || !result.candidates[0].content.parts) {
            console.error("Invalid response structure from Gemini:", JSON.stringify(result, null, 2));
            const finishReason = result.candidates?.[0]?.finishReason || "UNKNOWN";
            const safetyRatings = result.promptFeedback?.safetyRatings || "Not provided";
            throw new Error(`فشل النموذج في إنشاء تقرير. السبب المحتمل: ${finishReason}. تقييمات السلامة: ${JSON.stringify(safetyRatings)}`);
        }
        // --- END OF ROBUST ERROR HANDLING BLOCK ---

        const reportHtml = result.candidates[0].content.parts[0].text;

        if (!reportHtml) {
            throw new Error("The model generated an empty report.");
        }
        
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Server-side Error in /api/gpt:", err);
        // This now sends a clean JSON error instead of crashing the server.
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message,
        });
    }
}
