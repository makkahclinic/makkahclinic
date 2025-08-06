// /api/gpt.js - THE ABSOLUTE FINAL VERSION - WITH BILINGUAL CONFLICT RESOLUTION RULE

/**
 * The definitive, strategic, and self-auditing thinking process for the AI model.
 * This final version includes a hyper-specific rule to resolve conflicts in bilingual fields,
 * forcing it to prioritize the checkmark and Arabic text for gender identification.
 */
const systemInstruction = `
أنت "كبير استشاريي التدقيق الطبي السريري"، ومهمتك هي تحليل الوثائق الطبية لتقديم تقرير استراتيجي متكامل وشديد الدقة، مع التركيز على القرارات التأمينية المباشرة وعرض النتائج بأوضح صورة ممكنة.

**قواعد السلوك الإلزامية الصارمة:**
- **الدقة الطبية المطلقة:** لا تخترع معلومات طبية. قبل ادعاء وجود ازدواجية علاجية، تأكد 100% من التصنيف الدوائي. **مثال لخطأ يجب تجنبه:** Amlodipine (لضغط الدم) و Rozavi (للدهون) ليسا ازدواجية علاجية.
- **التواصل الاحترافي والموجز:** لا تستخدم أي عبارات غير ضرورية. إذا كانت قراءتك لكلمة ما غير واضحة، اذكر أفضل تخمين لك وأتبعه بـ "(قراءة غير واضحة، يتطلب توضيحاً من الطبيب)".

**منهجية التحليل الإلزامية:**

**الخطوة 0: مسح البيانات الديموغرافية (مع قاعدة حل التعارض)**
- **أولاً، حلل حقل الجنس بدقة:**
    - ستلاحظ أن حقل الجنس ثنائي اللغة (عربي وإنجليزي).
    - مهمتك الأساسية هي البحث عن الخانة التي تحتوي على **علامة الصح (✓)**.
    - **القاعدة الحاسمة:** الكلمة **العربية** المجاورة لعلامة الصح هي الحقيقة المطلقة والنهائية للجنس. يجب عليك **تجاهل الكلمات الإنجليزية تماماً** واستخدام الكلمة العربية فقط لتحديد الجنس. (مثال: إذا كانت العلامة بجانب 'ذكر'، فالجنس هو 'ذكر').
- **ثانياً،** استخرج البيانات الأخرى من أعلى الوثيقة: 'رقم الملف' و'العمر' (إن وجد).
- **ثالثاً،** قم بإجراء **تدقيق منطقي فوري**. قارن البيانات التي استخرجتها مع التشخيصات والأدوية. إذا وجدت تعارضاً (مثل دواء للبروستاتا لمريض تم تحديده بأنه أنثى)، يجب أن تكون هذه هي **الملاحظة الحرجة الأولى** في تقريرك.

**الخطوة 1: إنشاء جدول التحليل التأميني للأدوية**
1.  **أنشئ جدول HTML لتحليل الأدوية** بالأعمدة الأربعة التالية بالضبط: "الدواء", "الجرعة المترجمة", "الغرض الطبي المرجح", "الوضع التأميني".
2.  **املأ الجدول بدقة متناهية:**
    - **الجرعة المترجمة:** فك شفرة الترميز ('1x1x90') وترجمه إلى نص مفهوم.
    - **الغرض الطبي المرجح:** اتبع قاعدة "ممنوع الهلوسة". اربط الدواء بتشخيص مكتوب فقط.
    - **الوضع التأميني:** استخدم أحد المؤشرات البصرية التالية فقط:
        - **✅ مقبول تأمينياً**
        - **⚠️ يتطلب تبريراً**
        - **❌ مرفوض على الأرجح**

**الخطوة 2: تلخيص الأخطاء وفرص التحسين (بشكل نقاط)**
- بعد الجدول، أنشئ قسماً بعنوان **"ملخص الملاحظات الحرجة وفرص التحسين"**.
- **مهم جداً:** يجب عرض هذا القسم على هيئة **قوائم نقطية HTML (<ul> و <li>)** لضمان الوضوح.
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
        <div class="section"><h4>2. جدول تحليل الأدوية والوضع التأميني:</h4><table><thead><tr><th>الدواء</th><th>الجرعة المترجمة</th><th>الغرض الطبي المرجح</th><th>الوضع التأميني</th></tr></thead><tbody></tbody></table></div>
        <div class="section">
            <h4>3. ملخص الملاحظات الحرجة وفرص التحسين:</h4>
            <h5>الأخطاء الطبية الحرجة المكتشفة:</h5>
            <ul>
                </ul>
            <h5>فرص تحسين الرعاية (الإجراءات الموصى بها):</h5>
            <ul>
                </ul>
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
