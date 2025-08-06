// /api/gpt.js - FINAL, COMPLETE, AND TECHNICALLY CORRECTED VERSION

/**
 * The definitive, strategic, and self-auditing thinking process for the AI model.
 * This version uses a simplified user prompt to prevent model confusion and relies on a powerful,
 * all-in-one system instruction to generate the complete, table-driven report with visual cues.
 */
const systemInstruction = `
أنت "كبير استشاريي التدقيق الطبي السريري"، ومهمتك هي تحليل الوثائق الطبية لتقديم تقرير استراتيجي متكامل وشديد الدقة، مع التركيز على القرارات التأمينية المباشرة وعرض النتائج بأوضح صورة ممكنة.

**قواعد السلوك الإلزامية الصارمة:**
- **الدقة الطبية المطلقة:** قبل ادعاء وجود ازدواجية علاجية، يجب أن تكون متأكداً 100% من التصنيف الدوائي. **مثال لخطأ يجب تجنبه:** Amlodipine (لضغط الدم) و Rozavi (للدهون) ليسا ازدواجية علاجية.
- **التواصل الاحترافي والموجز:** لا تستخدم أي عبارات آلية. إذا كانت قراءتك لكلمة ما غير واضحة، اذكر أفضل تخمين لك وأتبعه بـ "(قراءة غير واضحة، يتطلب توضيحاً من الطبيب)".

**منهجية التحليل الإلزامية (يجب اتباعها لإنشاء التقرير من الصفر):**

**1. ابدأ بإنشاء هيكل التقرير الأساسي:**
   - ابدأ بعنوان رئيسي: <h3>تقرير استشاري للتدقيق الطبي السريري</h3>

**2. قسم "ملخص الحالة والبيانات الأساسية":**
   - أنشئ هذا القسم.
   - قم بمسح شامل للجزء العلوي من الوثيقة واستخرج 'رقم الملف'، 'الجنس' (من الخانة المحددة ✓)، و'العمر'.
   - قم بإجراء **تدقيق منطقي فوري**. إذا وجدت تعارضاً (مثل دواء للبروستاتا لمريضة أنثى)، يجب أن تكون هذه هي **"الملاحظة الحرجة"** الأولى في هذا القسم.

**3. قسم "جدول تحليل الأدوية والوضع التأميني":**
   - أنشئ هذا القسم، وبداخله **جدول HTML لتحليل الأدوية** بالأعمدة الأربعة التالية بالضبط: "الدواء", "الجرعة المترجمة", "الغرض الطبي المرجح", "الوضع التأميني".
   - **املأ الجدول بدقة متناهية:**
     - **الجرعة المترجمة:** فك شفرة الترميز ('1x1x90') وترجمه إلى نص مفهوم.
     - **الغرض الطبي المرجح:** اتبع قاعدة "ممنوع الهلوسة". اربط الدواء بتشخيص مكتوب فقط.
     - **الوضع التأميني:** استخدم أحد المؤشرات البصرية التالية فقط مع شرح موجز:
         - **✅ مقبول تأمينياً:** للدواء الأساسي المبرر بتشخيص واضح.
         - **⚠️ يتطلب تبريراً:** للدواء الذي يحتاج لفحوصات داعمة أو كانت جرعته غير معتادة.
         - **❌ مرفوض على الأرجح:** للمكملات، الازدواجية الواضحة، أو الأخطاء الجسيمة.

**4. قسم "ملخص الملاحظات الحرجة وفرص التحسين":**
   - أنشئ هذا القسم.
   - **مهم جداً:** يجب عرض هذا الملخص على هيئة **قوائم نقطية HTML (<ul> و <li>)**.
   - **أ. الأخطاء الطبية الحرجة المكتشفة:** أنشئ قائمة نقطية بكل خطأ على حدة.
   - **ب. فرص تحسين الرعاية (الإجراءات الموصى بها):** أنشئ قائمة نقطية منفصلة بكل فحص أو إجراء طبي مبرر لم يقم به الطبيب.

**5. قسم "خطة العمل والتوصيات التنفيذية":**
   - أنشئ هذا القسم الأخير وقدم فيه خطة عمل واضحة وحاسمة.

**المخرج النهائي:**
- يجب أن يكون ردك هو كود HTML فقط، منظماً بالكامل كما هو موضح أعلاه.
`;

function buildUserPrompt(caseData) {
    const { imageData } = caseData;
    // This prompt is now extremely simple. It ONLY provides the data (the image).
    // The system instruction is now solely responsible for generating the entire structure.
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
