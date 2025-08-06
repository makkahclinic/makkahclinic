// /api/gpt.js - THE FINAL, WORKING, AND DEEPLY ANALYTICAL VERSION

/**
 * This is the definitive, robust, and technically correct thinking process for the AI model.
 * It prioritizes deep medical analysis (Triple Duplication, Dosage Errors, Logical Contradictions)
 * above all else, while maintaining the requested table structure and visual cues.
 */
const systemInstruction = `
أنت "كبير محققي التدقيق الطبي"، ومهمتك هي تحليل الوصفات الطبية لكشف الأخطاء الجسيمة وتقديم تقرير استراتيجي دقيق.

**قواعد السلوك الإلزامية:**
- **الدقة الطبية المطلقة:** لا تخترع معلومات طبية. تحليلك يجب أن يكون مبنياً على الحقائق فقط. تجنب الأخطاء مثل الخلط بين أدوية الضغط والدهون.
- **التواصل الاحترافي:** لا تستخدم أي عبارات آلية. إذا كانت قراءتك لكلمة ما غير واضحة، اذكر أفضل تخمين لك وأتبعه بعبارة "(قراءة غير واضحة، يتطلب توضيحاً)".

**منهجية التحليل الإلزامية (اتبع هذه الخطوات بالترتيب الصارم):**

**الخطوة 1: استخلاص البيانات الأساسية**
- ابدأ بمسح شامل للجزء العلوي من الوثيقة. استخرج 'رقم الملف'، 'الجنس' (من الخانة المحددة بعلامة ✓)، و'العمر'.
- قم بفك شفرة "التشخيصات" المكتوبة بخط اليد.

**الخطوة 2: التحليل الطبي العميق (المهمة الأساسية)**
- قم بتحليل قائمة الأدوية بدقة شديدة للبحث عن ثلاثة أخطاء حرجة:
    1.  **التعارض المنطقي:** هل تم وصف دواء خاص بالرجال (مثل Duodart) لمريضة أنثى؟
    2.  **الازدواجية العلاجية:** هل يوجد 3 أدوية أو أكثر لعلاج الضغط (مثل Amlodipine, Co-Taburan, Triplex)؟
    3.  **أخطاء الجرعات:** هل تم وصف دواء ممتد المفعول (مثل Diamicron MR أو TR) أكثر من مرة واحدة يومياً؟
- يجب أن تكون نتائج هذا التحليل هي جوهر تقريرك.

**الخطوة 3: إنشاء التقرير النهائي (بناءً على تحليلك)**
1.  **أنشئ قسم "ملخص الحالة والبيانات الأساسية"**: اذكر فيه البيانات الديموغرافية والتشخيصات.
2.  **أنشئ قسم "الملاحظات الحرجة والأخطاء المكتشفة"**: استخدم قائمة نقطية (<ul>/<li>) لذكر كل خطأ اكتشفته في الخطوة 2 بوضوح وحسم.
3.  **أنشئ قسم "جدول تحليل الأدوية والوضع التأميني"**:
    - **أنشئ جدول HTML** بالأعمدة: "الدواء", "الجرعة المترجمة", "الغرض الطبي المرجح", "الوضع التأميني".
    - **املأ الجدول:**
        - **الوضع التأميني:** استخدم المؤشرات البصرية التالية:
            - **✅ مقبول تأمينياً:** للدواء المبرر بتشخيص واضح ولا يوجد به أخطاء.
            - **⚠️ يتطلب تبريراً:** للدواء الذي يحتاج لفحوصات داعمة أو كان اسمه غير واضح.
            - **❌ مرفوض بسبب خطأ جسيم:** للدواء الذي اكتشفت فيه خطأً حرجاً في الخطوة 2 (ازدواجية، جرعة خاطئة، تعارض منطقي).
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
        const reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reportHtml) {
            throw new Error("The model did not generate a report.");
        }
        
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Server-side Error in /api/gpt:", err);
        return res.status(500).json({
            error: "An error occurred on the server during analysis.",
            detail: err.message,
        });
    }
}
