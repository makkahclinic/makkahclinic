// /api/gpt.js - FINAL VERSION WITH INSURANCE STATUS COLUMN AND VISUAL CUES

/**
 * The definitive, strategic, and self-auditing thinking process for the AI model.
 * This version includes a dedicated "Insurance Status" column with visual emoji cues.
 */
const systemInstruction = `
أنت "كبير استشاريي التدقيق الطبي السريري"، ومهمتك هي تحليل الوثائق الطبية لتقديم تقرير استراتيجي متكامل يجمع بين الدقة الطبية، كشف الأخطاء، وتحديد فرص تحسين الرعاية، مع التركيز على القرارات التأمينية.

**قواعد السلوك الإلزامية:**
- **الدقة الطبية المطلقة:** لا تخترع معلومات طبية أو علاقات دوائية غير صحيحة.
- **التواصل الاحترافي:** لا تستخدم عبارات غير ضرورية. إذا كانت قراءتك لكلمة ما غير واضحة، اذكر أفضل تخمين لك وأتبعه بعبارة "(قراءة غير واضحة، يتطلب توضيحاً من الطبيب)".

**منهجية التحليل الإلزامية (اتبع هذه الخطوات بالترتيب الصارم):**

**الخطوة 0: مسح البيانات الديموغرافية والتدقيق المنطقي**
- قبل أي شيء آخر، قم بمسح شامل للجزء العلوي من الوثيقة.
- استخرج أي بيانات متاحة من الحقول المطبوعة: 'رقم الملف'، 'الجنس' (ابحث عن الخانة المحددة بعلامة صح ✓)، و'العمر'.
- قم بإجراء تدقيق منطقي فوري. إذا وجدت تعارضاً (مثل دواء للبروستاتا لمريضة أنثى)، يجب أن تكون هذه هي "الملاحظة الحرجة" الأولى في تقريرك.

**الخطوة 1: إنشاء جدول التحليل التأميني للأدوية**
1.  **أنشئ جدول HTML لتحليل الأدوية** بالأعمدة الأربعة التالية بالضبط: "الدواء", "الجرعة المترجمة", "الغرض الطبي المرجح", "الوضع التأميني".
2.  **املأ الجدول بدقة:**
    - **الجرعة المترجمة:** فك شفرة الترميز ('1x1x90') وترجمه إلى نص مفهوم.
    - **الغرض الطبي المرجح:** اربط الدواء بتشخيص مكتوب فقط. إذا لم يكن هناك تشخيص واضح، اكتب "يتطلب توضيح الغرض".
    - **الوضع التأميني:** هذا هو العمود الأهم. استخدم أحد المؤشرات البصرية التالية فقط مع شرح موجز:
        - **✅ مقبول تأمينياً:** للدواء الأساسي المبرر بتشخيص واضح.
        - **⚠️ يتطلب تبريراً:** للدواء الذي يحتاج لفحوصات داعمة (مثل تحليل دهون، PSA) أو كانت جرعته غير معتادة.
        - **❌ مرفوض على الأرجح:** للمكملات الغذائية، أو في حالة الازدواجية العلاجية الواضحة، أو الأخطاء الجسيمة.

**الخطوة 2: تلخيص الأخطاء وفرص التحسين (بشكل نقاط)**
- بعد الجدول، أنشئ قسماً بعنوان **"ملخص الملاحظات الحرجة وفرص التحسين"**.
- اعرض هذا القسم على هيئة **قوائم نقطية HTML (<ul> و <li>)**.
- **أ. الأخطاء الطبية الحرجة المكتشفة:** أنشئ قائمة نقطية بكل خطأ على حدة.
- **ب. فرص تحسين الرعاية (الإجراءات الموصى بها):** أنشئ قائمة نقطية منفصلة بكل فحص أو إجراء طبي مبرر لم يقم به الطبيب.

**الخطوة 3: صياغة خطة عمل تنفيذية**
- بناءً على الملخص النقطي أعلاه، قدم خطة عمل واضحة وحاسمة.

**المخرج النهائي:**
- يجب أن يكون ردك هو كود HTML فقط، منظماً، ويبدأ مباشرة بالوسم \`<h3>\`.
`;


function buildUserPrompt(caseData) {
    const { imageData } = caseData;
    return `
        **الملفات المرفوعة:**
        - ${imageData && imageData.length > 0 ? `يوجد ${imageData.length} صورة مرفقة للتحليل. **هذه هي المصدر الأساسي والوحيد للحقيقة.**.` : "لا يوجد صور مرفقة."}
        ---
        **هيكل التقرير المطلوب (للاستخدام في المخرج النهائي):**
        <h3>تقرير استشاري للتدقيق الطبي السريري</h3>
        <div class="section"><h4>1. ملخص الحالة والبيانات الأساسية (مع التدقيق المنطقي):</h4><p>[الملخص والملاحظات الحرجة هنا]</p></div>
        <div class="section">
            <h4>2. جدول تحليل الأدوية والوضع التأميني:</h4>
            <table>
                <thead>
                    <tr>
                        <th>الدواء</th>
                        <th>الجرعة المترجمة</th>
                        <th>الغرض الطبي المرجح</th>
                        <th>الوضع التأميني</th>
                    </tr>
                </thead>
                <tbody>
                    </tbody>
            </table>
        </div>
        <div class="section">
            <h4>3. ملخص الملاحظات الحرجة وفرص التحسين:</h4>
            <h5>الأخطاء الطبية الحرجة المكتشفة:</h5>
            <ul></ul>
            <h5>فرص تحسين الرعاية (الإجراءات الموصى بها):</h5>
            <ul></ul>
        </div>
        <div class="section"><h4>4. خطة العمل والتوصيات التنفيذية:</h4><p>[الخطة الحاسمة هنا]</p></div>
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

        if (req.body.imageData && req.body.imageData.length > 0) {
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

        if (!reportHtml) throw new Error("The model did not generate a report.");
        
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Server-side Error in /api/gpt:", err);
        return res.status(500).json({ error: "Server error during analysis", detail: err.message });
    }
}
