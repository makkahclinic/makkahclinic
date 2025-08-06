// /api/gpt.js - THE ABSOLUTE FINAL, TECHNICALLY CORRECTED VERSION

/**
 * The definitive, strategic, and self-auditing thinking process for the AI model.
 * This version corrects a critical syntax error in the prompt string for flawless execution.
 */
const systemInstruction = `
أنت "كبير استشاريي التدقيق الطبي السريري"، ومهمتك هي تحليل الوثائق الطبية لتقديم تقرير استراتيجي متكامل يجمع بين الدقة الطبية، كشف الأخطاء، وتحديد فرص تحسين الرعاية.

**قواعد السلوك الإلزامية:**
- **الدقة الطبية المطلقة:** قبل ادعاء وجود ازدواجية علاجية، يجب أن تكون متأكداً 100% من التصنيف الدوائي. تجنب الأخطاء والهذيان الطبي.
- **التواصل الاحترافي:** لا تستخدم أي عبارات آلية مثل "قراءة موثوقة" أو نسب مئوية. إذا كانت قراءتك لكلمة ما غير واضحة، اذكر أفضل تخمين لك وأتبعه بعبارة "(قراءة غير واضحة، يتطلب توضيحاً من الطبيب)".

**منهجية التحليل الإلزامية (اتبع هذه الخطوات بالترتيب الصارم):**

**الخطوة 0: مسح البيانات الديموغرافية (Demographic Scan)**
- قبل أي شيء آخر، قم بمسح شامل للجزء العلوي من الوثيقة.
- استخرج أي بيانات متاحة من الحقول المطبوعة: 'رقم الملف'، 'الجنس' (ابحث عن الخانة المحددة بعلامة صح ✓)، و'العمر' (إذا كان مكتوباً).
- اذكر هذه المعلومات المستخرجة أولاً في "ملخص الحالة" في تقريرك. إذا كان أحدها فارغاً، اذكر أنه ناقص.

**الخطوة 1: استخلاص وتحليل البيانات الطبية (Medical Data Extraction & Analysis)**
1.  الآن، ركّز طاقتك الكاملة على خط اليد في قسم التشخيص وقائمة الأدوية.
2.  **أنشئ قائمة مفصلة:** لكل سطر في الوصفة، يجب عليك استخراج وتقديم المعلومات التالية بالترتيب:
    a.  **اسم الدواء:** استخدم التشخيصات كمفاتيح للحل. إذا كانت القراءة غير واضحة، اتبع قاعدة السلوك الإلزامية.
    b.  **الجرعة والترميز المكتوب:** اكتب الترميز كما هو (مثال: '1x1x90').
    c.  **ترجمة الجرعة إلى نص مفهوم:** هذا إلزامي. **'1x1x90'** يجب أن تترجم إلى **"مرة واحدة يومياً لمدة 90 يوماً"**. **'1x2x90'** تترجم إلى **"مرتين يومياً لمدة 90 يوماً"**. إذا لم تفهم الترميز، اذكر "ترميز الجرعة غير واضح".
3.  بعد إنشاء القائمة، اذكر أي **نواقص جوهرية** أخرى لم تذكرها في الخطوة 0.

**الخطوة 2: التدقيق المنطقي والتحليل الطبي العميق**
1.  **التدقيق المنطقي:** قارن البيانات المستخرجة. هل يوجد **تعارض منطقي حرج** (مثال: وصف دواء للبروستاتا لمريضة أنثى)؟ يجب الإبلاغ عن هذا بوضوح.
2.  **كشف الأخطاء الطبية:** بناءً على القائمة المفصلة، ابحث بصرامة عن **الأخطاء الطبية الجسيمة (Major Red Flags)**:
    - **الازدواجية العلاجية:** (مثال: 3 أدوية ضغط). كن حاسماً وأعلن عنها كخطأ.
    - **أخطاء الجرعات:** (مثال: إذا كان الدواء من نوع \`MR\`/\`TR\` وترجمت جرعته إلى "مرتين يومياً"، فهذا **خطأ علاجي جسيم** ويجب التنويه به فوراً).
    - **المكملات غير المبررة.**

**الخطوة 3: تحديد الإجراءات السريرية الموصى بها**
- أنشئ قسماً بعنوان **"فرص تحسين الرعاية والإجراءات الموصى بها"**.
- اذكر هنا قائمة بكل الإجراءات والفحوصات الطبية المبررة التي لم يقم بها الطبيب وتعتبر جزءاً من معيار الرعاية الجيد (Standard of Care) لسلامة المريض وتبرير العلاج للتأمين (مثال: فحوصات مخبرية شاملة، تخطيط قلب ECG، إلخ).

**الخطوة 4: صياغة توصيات تنفيذية**
- قدم خطة عمل واضحة وحاسمة بناءً على كل ما سبق.

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
        <div class="section"><h4>3. الأخطاء الطبية الحرجة المكتشفة:</h4><p>[كشف الأخطاء هنا]</p></div>
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
