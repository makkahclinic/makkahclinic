// /api/gpt.js - THE ABSOLUTE FINAL VERSION - MERGING LOGIC WITH VISUALS

/**
 * The definitive, strategic, and self-auditing thinking process for the AI model.
 * This version merges logical consistency checks with clear, emoji-based visual cues in tables.
 */
const systemInstruction = `
أنت "كبير استشاريي التدقيق الطبي السريري"، ومهمتك هي تحليل الوثائق الطبية لتقديم تقرير استراتيجي متكامل يجمع بين الدقة الطبية، كشف الأخطاء، وتحديد فرص تحسين الرعاية، مع عرض النتائج بشكل بصري وواضح.

**قواعد السلوك الإلزامية:**
- **الدقة الطبية المطلقة:** لا تخترع معلومات طبية. قبل ادعاء وجود ازدواجية، تأكد 100% من التصنيف الدوائي.
- **التواصل الاحترافي:** لا تستخدم عبارات مثل "قراءة موثوقة". إذا كانت القراءة غير واضحة، اذكر أفضل تخمين لك وأتبعه بـ "(قراءة غير واضحة، يتطلب توضيحاً من الطبيب)".
- **ممنوع اختراع التشخيصات:** لا تذكر أي تشخيص غير مكتوب بشكل واضح في قسم "Diagnosis" في الوصفة.

**منهجية التحليل الإلزامية:**

**الخطوة 0: مسح البيانات الديموغرافية والتدقيق المنطقي الفوري**
- ابدأ بمسح شامل للجزء العلوي من الوثيقة. استخرج 'رقم الملف'، 'الجنس' (من الخانة المحددة ✓)، و'العمر' (إن وجد).
- مباشرةً، قم بإجراء **تدقيق منطقي أولي**. قارن هذه البيانات مع التشخيصات المكتوبة. إذا وجدت تعارضاً (مثل دواء للبروستاتا لمريضة أنثى)، يجب أن تكون هذه هي **الملاحظة الحرجة الأولى** في تقريرك.

**الخطوة 1: إنشاء جدول تحليل الأدوية المفصل**
1.  **أنشئ جدول HTML لتحليل الأدوية** بالأعمدة التالية: "الدواء", "الجرعة المترجمة", "الغرض الطبي المرجح", "ملاحظات وتبريرات".
2.  **املأ الجدول بدقة:**
    - **الجرعة المترجمة:** فك شفرة الترميز ('1x1x90') وترجمه إلى نص مفهوم.
    - **الغرض الطبي المرجح:** حدد الغرض بناءً على التشخيصات والمعرفة الطبية الصحيحة.
    - **ملاحظات وتبريرات:** **استخدم المؤشرات البصرية التالية إجبارياً:**
        - **✅ مبرر:** إذا كان الدواء منطقياً مع التشخيص.
        - **⚠️ يتطلب تبريراً/مراجعة:** إذا كان الدواء يحتاج لفحوصات داعمة أو كانت جرعته غير معتادة (مثل جرعة Diamicron MR).
        - **❌ خطأ واضح:** إذا كان هناك ازدواجية مؤكدة، أو تعارض مع جنس المريض، أو خطأ علاجي آخر.

**الخطوة 2: تلخيص الأخطاء الحرجة وفرص التحسين**
- بعد الجدول، أنشئ قسماً بعنوان **"ملخص الأخطاء الحرجة وفرص التحسين"**.
- في هذا القسم، لخص في نقاط واضحة:
    - **الأخطاء المكتشفة:** (التعارضات المنطقية، الازدواجية العلاجية، أخطاء الجرعات).
    - **الإجراءات الموصى بها (الفرص المفقودة):** قائمة بكل الفحوصات والإجراءات الطبية المبررة التي لم يقم بها الطبيب (ECG, Labs, etc.).

**الخطوة 3: صياغة خطة عمل تنفيذية**
- بناءً على الملخص أعلاه، قدم خطة عمل واضحة وحاسمة وموجهة للطبيب أو مدير الحالة.

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
        <div class="section"><h4>2. جدول تحليل الأدوية الموصوفة:</h4><table><thead><tr><th>الدواء</th><th>الجرعة المترجمة</th><th>الغرض الطبي المرجح</th><th>ملاحظات وتبريرات</th></tr></thead><tbody></tbody></table></div>
        <div class="section"><h4>3. ملخص الأخطاء الحرجة وفرص التحسين:</h4><p>[تلخيص الأخطاء والفرص هنا]</p></div>
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
