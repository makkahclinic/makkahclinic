// /api/gpt.js - FINAL VERSION FOR MEDICAL AUDIT

const systemInstruction = `
أنت "كبير استشاريي التدقيق الطبي"، ومهمتك هي تحويل الوصفات الطبية المعقدة إلى تقارير استراتيجية واضحة ومنظمة في جداول HTML.

**قواعد السلوك الإلزامية:**
- **الدقة الطبية المطلقة:** قبل ادعاء وجود ازدواجية علاجية، يجب أن تكون متأكداً 100% أن الدوائين من نفس العائلة العلاجية ويعالجان نفس الحالة. تجنب الأخطاء مثل الخلط بين أدوية الضغط (Amlodipine) وأدوية الدهون (Rozavi). الدقة هي أولويتك القصوى.
- **التواصل الاحترافي:** لا تستخدم عبارات مثل "قراءة موثوقة". إذا كانت قراءتك لكلمة ما غير واضحة، اذكر أفضل تخمين لك وأتبعه بعبارة "(قراءة غير واضحة، يتطلب توضيحاً من الطبيب)".

**منهجية التحليل الإلزامية:**

**الخطوة 0: مسح البيانات الديموغرافية**
- ابدأ بمسح شامل للجزء العلوي من الوثيقة. استخرج 'رقم الملف'، 'الجنس' (من الخانة المحددة ✓)، و'العمر' (إن وجد). اذكر هذه المعلومات في بداية التقرير.

**الخطوة 1: استخلاص وتحليل البيانات في جدول**
1.  **أنشئ جدول HTML لتحليل الأدوية** بالأعمدة التالية: "الدواء", "الجرعة المترجمة", "الغرض الطبي المرجح", "ملاحظات وتبريرات".
2.  **املأ الجدول بدقة:**
    - **الجرعة المترجمة:** فك شفرة الترميز (مثل '1x1x90') وترجمه إلى نص مفهوم ("مرة واحدة يومياً لمدة 90 يوماً").
    - **ملاحظات وتبريرات:** استخدم المؤشرات البصرية: ✅ (مبرر)، ⚠️ (يتطلب تبريراً)، ❌ (خطأ محتمل).

**الخطوة 2: تحديد الأخطاء الحرجة وفجوات التبرير**
- بعد الجدول، أنشئ قسماً بعنوان **"الأخطاء الطبية الحرجة المكتشفة"**.
- اذكر هنا بوضوح أي أخطاء جسيمة وجدتها، مثل:
    - **الازدواجية العلاجية الحقيقية:** (مثال: "يوجد خطر ازدواجية ثلاثية في علاج الضغط بين الأدوية Amlodipine, Co-Taburan, و Triplex").
    - **أخطاء الجرعات:** (مثال: "جرعة دواء Diamicron MR الموصوفة مرتين يومياً تعتبر خطأ علاجياً").
- ثم أنشئ قسماً بعنوان **"الفحوصات المطلوبة لاستكمال الملف"** واذكر فيها قائمة الفحوصات اللازمة.

**الخطوة 3: صياغة توصيات تنفيذية**
- قدم خطة عمل تنفيذية وواضحة بناءً على الأخطاء والفجوات التي وجدتها.

**المخرج النهائي:**
- يجب أن يكون ردك هو كود HTML فقط، منظماً في جداول واضحة، ويبدأ مباشرة بالوسم \`<h3>\`.
`;

// The rest of the /api/gpt.js file (buildUserPrompt, handler, etc.) remains the same as the last version I provided.
// This is just the final, polished systemInstruction. For clarity, the full file is below.

function buildUserPrompt(caseData) {
    const {
        gender, isPregnant, pregnancyMonth, height, weight, temperature,
        bloodPressure, caseDescription, diagnosis, labResults,
        medicationsProcedures, imageData
    } = caseData;

    return `
        **البيانات الواردة للتحليل:**
        - الملفات المرفوعة: ${imageData && imageData.length > 0 ? `يوجد ${imageData.length} صورة مرفقة للتحليل. **هذه هي المصدر الأساسي والوحيد للحقيقة.**.` : "لا يوجد صور مرفقة."}
        ---
        **هيكل التقرير المطلوب (للاستخدام في المخرج النهائي):**
        <h3>تقرير استشاري للتدقيق الطبي</h3>
        <div class="section"><h4>1. ملخص الحالة والبيانات الأساسية:</h4><p>[الملخص هنا]</p></div>
        <div class="section"><h4>2. جدول تحليل الأدوية الموصوفة:</h4><table><thead><tr><th>الدواء</th><th>الجرعة المترجمة</th><th>الغرض الطبي المرجح</th><th>ملاحظات وتبريرات</th></tr></thead><tbody></tbody></table></div>
        <div class="section"><h4>3. الأخطاء الطبية الحرجة والفحوصات المطلوبة:</h4><h5>الأخطاء الطبية الحرجة المكتشفة:</h5><p>[كشف الأخطاء هنا]</p><h5>الفحوصات المطلوبة لاستكمال الملف:</h5><p>[قائمة الفحوصات هنا]</p></div>
        <div class="section"><h4>4. خطة العمل والتوصيات التنفيذية:</h4><p>[الخطة هنا]</p></div>
    `;
}

export default async function handler(req, res) {
    // CORS and method checks...
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

        const userPrompt = buildUserPrompt(req.body);
        const parts = [{ text: systemInstruction }, { text: userPrompt }];

        if (req.body.imageData && req.body.imageData.length > 0) {
            req.body.imageData.forEach(imgData => {
                parts.push({ inline_data: { mimeType: "image/jpeg", data: imgData } });
            });
        }

        const payload = {
            contents: [{ role: "user", parts: parts }],
            generationConfig: { temperature: 0.25, topP: 0.95, topK: 40 },
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

        if (!reportHtml) throw new Error("The model did not generate a report.");
        
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Server-side Error in /api/gpt:", err);
        return res.status(500).json({ error: "Server error during analysis", detail: err.message });
    }
}
