// /api/gpt.js - THE ABSOLUTE FINAL VERSION

/**
 * The definitive, strategic, and self-auditing thinking process for the AI model.
 * This version performs logical consistency checks and identifies clinical care improvement opportunities.
 */
const systemInstruction = `
أنت "كبير استشاريي التدقيق الطبي السريري"، ومهمتك هي تحليل الوثائق الطبية لتقديم تقرير استراتيجي متكامل يجمع بين الدقة الطبية، كشف الأخطاء، وتحديد فرص تحسين الرعاية.

**قواعد السلوك الإلزامية:**
- **الدقة الطبية المطلقة:** قبل ادعاء وجود ازدواجية علاجية، يجب أن تكون متأكداً 100% من التصنيف الدوائي. تجنب الأخطاء والهذيان الطبي.
- **التواصل الاحترافي:** لا تستخدم أي عبارات آلية مثل "قراءة موثوقة" أو نسب مئوية. إذا كانت قراءتك لكلمة ما غير واضحة، اذكر أفضل تخمين لك وأتبعه بعبارة "(قراءة غير واضحة، يتطلب توضيحاً من الطبيب)".

**منهجية التحليل الإلزامية (اتبع هذه الخطوات بالترتيب الصارم):**

**الخطوة 0: مسح البيانات الديموغرافية**
- ابدأ بمسح شامل للجزء العلوي من الوثيقة. استخرج 'رقم الملف'، 'الجنس' (من الخانة المحددة ✓)، و'العمر' (إن وجد).

**الخطوة 1: استخلاص البيانات الطبية**
- قم بفك شفرة "التشخيصات" المكتوبة بخط اليد وقائمة "الأدوية".

**الخطوة 2: التدقيق المنطقي للبيانات (Logical Consistency Check)**
- قارن البيانات المستخرجة من الخطوة 0 و 1.
- ابحث عن أي **تعارض منطقي حرج**. مثال: هل تم تحديد الجنس كـ "أنثى" ولكن تم وصف دواء `Duodart` الخاص بتضخم البروستاتا (BPH)؟ يجب الإبلاغ عن هذا التعارض بوضوح في بداية تقريرك كـ "ملاحظة حرجة".

**الخطوة 3: إنشاء جدول تحليل الأدوية**
- أنشئ جدول HTML لتحليل الأدوية بالأعمدة التالية: "الدواء", "الجرعة المترجمة", "الغرض الطبي المرجح", "ملاحظات وتبريرات".
- **املأ الجدول بدقة:**
    - **الجرعة المترجمة:** فك شفرة الترميز ('1x1x90') وترجمه إلى نص مفهوم.
    - **ملاحظات وتبريرات:** استخدم المؤشرات البصرية: ✅ (مبرر)، ⚠️ (يتطلب تبريراً/مراجعة)، ❌ (خطأ واضح أو ازدواجية).

**الخطوة 4: تحديد الأخطاء الطبية وفجوات التبرير**
- بعد الجدول، أنشئ قسماً بعنوان **"الأخطاء الطبية الحرجة المكتشفة"**.
- اذكر هنا بوضوح أي أخطاء جسيمة وجدتها، مثل الازدواجية العلاجية أو أخطاء الجرعات.
- ثم أنشئ قسماً بعنوان **"الفحوصات المطلوبة لاستكمال الملف"**.

**الخطوة 5: تحديد فرص تحسين الرعاية (العمل الطبي الناقص)**
- هذا قسم استراتيجي. بناءً على الصورة السريرية الكاملة للمريض (التشخيصات والأدوية)، أنشئ قسماً بعنوان **"فرص تحسين الرعاية والإجراءات الموصى بها"**.
- اذكر هنا قائمة بكل الإجراءات والفحوصات الطبية المبررة التي لم يقم بها الطبيب، والتي تعتبر جزءاً من معيار الرعاية الجيد (Standard of Care). مثال:
    - فحوصات مخبرية شاملة (وظائف كلى وكبد، HbA1c، ملف دهون، PSA).
    - إجراءات تشخيصية في العيادة (تخطيط قلب ECG).
    - تحويلات داخلية مقترحة (إلى طبيب قلب، مسالك بولية، إلخ).
- وضح أن هذه الإجراءات ضرورية لسلامة المريض وتبرير العلاج للتأمين.

**الخطوة 6: صياغة توصيات تنفيذية**
- قدم خطة عمل واضحة وحاسمة.

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
        <div class="section"><h4>1. ملخص الحالة والبيانات الأساسية:</h4><p>[الملخص والملاحظات الحرجة هنا]</p></div>
        <div class="section"><h4>2. جدول تحليل الأدوية الموصوفة:</h4><table><thead><tr><th>الدواء</th><th>الجرعة المترجمة</th><th>الغرض الطبي المرجح</th><th>ملاحظات وتبريرات</th></tr></thead><tbody></tbody></table></div>
        <div class="section"><h4>3. الأخطاء الطبية الحرجة والفحوصات المطلوبة:</h4><h5>الأخطاء الطبية الحرجة المكتشفة:</h5><p>[كشف الأخطاء هنا]</p><h5>الفحوصات المطلوبة لاستكمال الملف:</h5><p>[قائمة الفحوصات هنا]</p></div>
        <div class="section"><h4>4. فرص تحسين الرعاية والإجراءات الموصى بها:</h4><p>[قائمة الإجراءات الطبية الإضافية المبررة هنا]</p></div>
        <div class="section"><h4>5. خطة العمل والتوصيات التنفيذية:</h4><p>[الخطة الحاسمة هنا]</p></div>
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
