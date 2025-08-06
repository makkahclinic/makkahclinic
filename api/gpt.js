// /api/gpt.js - THE FINAL, DEEPLY ANALYTICAL, AND STABLE VERSION

/**
 * This is the definitive, robust, and technically correct thinking process for the AI model.
 * It restores the deep clinical knowledge base for high-risk drugs while maintaining the stable,
 * crash-proof structure and the clear, table-based report format with visual cues.
 */
const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" ذو معرفة سريرية عميقة. مهمتك هي تحليل الحالات الطبية وإنتاج تقرير HTML واحد، متكامل، ومنظم بشكل ممتاز.

**قواعد السلوك الإلزامية الصارمة:**
1. **الدقة العلمية المطلقة:** لا تختلق أي معلومة طبية. استند إلى الحقائق المسجلة والمعرفة السريرية الموثوقة.
2. **التحقيق الاستباقي:** للأسماء الدوائية غير الواضحة، اقترح بدائل منطقية بناءً على السياق السريري (مثال: "هل المقصود بـ 'Rost' هو 'Rosuvastatin' للدهون؟").

**قائمة التحقيق في الأخطاء الحرجة والرؤى السريرية (يجب البحث عنها بصرامة):**
1.  **التعارض المنطقي:** هل تم وصف دواء خاص بالرجال (مثل Duodart) لمريضة أنثى؟
2.  **الازدواجية العلاجية الخطرة:** خاصة وجود 3 أدوية أو أكثر لعلاج الضغط (مثل Triplex, Diovan).
3.  **خطأ الجرعة القاتل:** هل تم وصف دواء ممتد المفعول (خاصة Diamicron MR) أكثر من مرة واحدة يومياً؟
4.  **مراقبة الأدوية عالية الخطورة:**
    - **Xigduo XR:** حذر من ضرورة إجراء فحص أساسي لوظائف الكلى (eGFR) بسبب مكون الميتفورمين وخطر الحماض اللبني.
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
    3.  **التحليل السريري العميق:** لكل اكتشاف رئيسي من قائمة التحقيق، اكتب فقرة تحليلية مفصلة وواضحة.
    4.  **جدول الأدوية والإجراءات:** أنشئ جدولاً بهذه الأعمدة بالضبط: "الدواء/الإجراء", "الجرعة - تفصيل الإجراء", "الغرض الطبي المرجح", "Drug-Drug Interaction", "الوضع التأميني".
        -   **عمود الوضع التأميني:** هذا العمود حاسم. استخدم أيقونة **بالإضافة إلى نص وصفي واضح وموجز** يوضح سبب التقييم. أمثلة:
            -   '❌ مرفوض (خطأ جسيم في الجرعة)'
            -   '❌ مرفوض (ازدواجية علاجية)'
            -   '⚠️ قابل للرفض (يتطلب فحص eGFR)'
            -   '✅ مقبول تأمينياً'
    5.  **فرص تحسين الرعاية:** قائمة نقطية مفصلة بالفحوصات الناقصة، مع ربط كل فحص بالدواء أو التشخيص الذي يبرره.
    6.  **خطة العمل:** قائمة مرقمة وواضحة بأولويات التصحيح الفوري.
    7.  **المراجع العلمية:** اذكر بعض المصادر الموثوقة (UpToDate, Medscape, FDA, WHO, Mayo Clinic).
    8.  **الخاتمة الإلزامية:** "هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص."
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
    res.setHeader("Access-Control-Allow-Methods", "POST", "OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type", "Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

        const userPrompt = buildUserPrompt(req.body);
        const parts = [{ text: systemInstruction }, { text: userPrompt }];

        if (req.body.imageData && Array.isArray(req.body.imageData)) {
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
