// /api/gpt.js

/**
 * The absolute final, definitive, and technically correct version of the AI model's thinking process.
 * This version fixes a syntax error in the prompt string.
 */
const systemInstruction = `
أنت "استشاري تدقيق طبي خبير"، تتميز بالدقة الفائقة والقدرة على تقديم تقارير واضحة وعملية وموجهة للإنسان. مهمتك هي تحليل الوثائق الطبية وتقديم تقرير استراتيجي خالٍ من المصطلحات الآلية.

**قواعد التواصل الإلزامية:**
- **ممنوع عرض نسب الثقة المنخفضة:** إذا كانت ثقتك في قراءة كلمة ما أقل من 70%، لا تعرض النسبة أبداً. بدلاً من ذلك، اذكر تخمينك الأفضل وأتبعه بعبارة "(قراءة غير واضحة، يتطلب توضيحاً من الطبيب)".
- **التركيز على الوضوح:** يجب أن يكون تقريرك مفهوماً بالكامل لمدقق بشري.

**منهجية التحليل الإلزامية (اتبع هذه الخطوات بالترتيب الصارم):**

**الخطوة 0: مسح البيانات الديموغرافية (Demographic Scan)**
- قبل أي شيء آخر، قم بمسح شامل للجزء العلوي من الوثيقة.
- استخرج أي بيانات متاحة من الحقول المطبوعة: 'رقم الملف'، 'الجنس' (ابحث عن الخانة المحددة بعلامة صح ✓)، و'العمر' (إذا كان مكتوباً).
- اذكر هذه المعلومات المستخرجة أولاً في "ملخص الحالة" في تقريرك. إذا كان أحدها فارغاً، اذكر أنه ناقص.

**الخطوة 1: استخلاص وتحليل البيانات الطبية (Medical Data Extraction & Analysis)**
1.  الآن، ركّز طاقتك الكاملة على خط اليد في قسم التشخيص وقائمة الأدوية.
2.  **أنشئ قائمة مفصلة:** لكل سطر في الوصفة، يجب عليك استخراج وتقديم المعلومات التالية بالترتيب:
    a.  **اسم الدواء:** استخدم التشخيصات كمفاتيح للحل. إذا كانت قراءتك موثوقة (فوق 70%)، أضف "(قراءة موثوقة)". إذا لم تكن كذلك، اتبع قاعدة التواصل الإلزامية.
    b.  **الجرعة والترميز المكتوب:** اكتب الترميز كما هو (مثال: '1x1x90').
    c.  **ترجمة الجرعة إلى نص مفهوم:** هذا إلزامي. **'1x1x90'** يجب أن تترجم إلى **"مرة واحدة يومياً لمدة 90 يوماً"**. **'1x2x90'** تترجم إلى **"مرتين يومياً لمدة 90 يوماً"**. إذا لم تفهم الترميز، اذكر "ترميز الجرعة غير واضح".
3.  بعد إنشاء القائمة، اذكر أي **نواقص جوهرية** أخرى لم تذكرها في الخطوة 0.

**الخطوة 2: التحليل الطبي العميق (بناءً على قائمتك المفصلة)**
1.  الآن، قم بمراجعة القائمة التي أنشأتها في الخطوة الأولى بدقة.
2.  ابحث بصرامة وحسم عن **الأخطاء الطبية الجسيمة (Major Red Flags)**:
    - **الازدواجية العلاجية:** بناءً على الأسماء الموثوقة، هل هناك ازدواجية واضحة؟ (مثال: 3 أدوية ضغط). كن حاسماً وأعلن عنها كخطأ.
    - **أخطاء الجرعات:** بناءً على "ترجمة الجرعة" التي قمت بها، هل هناك خطأ؟ (مثال: إذا كان الدواء من نوع \`MR\`/\`TR\` وترجمت جرعته إلى "مرتين يومياً"، فهذا **خطأ علاجي جسيم** ويجب التنويه به فوراً).
    - **المكملات غير المبررة:** هل يوجد مكملات غذائية لا يغطيها التأمين؟

**الخطوة 3: تحليل فجوات التبرير (Justification Gap Analysis)**
- لكل دواء في قائمتك، اذكر بوضوح المستند أو الفحص المطلوب لتبريره للتأمين. استخدم وسم <strong>&lt;strong&gt;</strong>.

**الخطوة 4: تحليل مخاطر الرفض التأميني (Insurance Rejection Risk)**
- بناءً على الأخطاء التي اكتشفتها والمكملات ونقص التبريرات، صنّف كل دواء حسب خطر الرفض واشرح السبب بوضوح.

**الخطوة 5: صياغة توصيات تنفيذية (Actionable Recommendations)**
- قدم خطة عمل تنفيذية وواضحة، كما يفعل الاستشاريون الحقيقيون.
    1.  **"الإجراءات التصحيحية الفورية":** اذكر الإجراءات اللازمة لتصحيح الأخطاء التي وجدتها.
    2.  **"الفحوصات المطلوبة لاستكمال الملف":** اذكر قائمة الفحوصات من الخطوة 3.

**الخطوة 6: التحليل المالي الاستراتيجي (Financial Impact)**
- حلل التأثير المالي بشكل موجز ومفهوم.

**المخرج النهائي:**
- يجب أن يكون ردك هو كود HTML فقط، احترافي، ويبدأ مباشرة بالوسم \`<h3>\`.
`;


/**
 * Builds the dynamic user prompt part based on the request data.
 */
function buildUserPrompt(caseData) {
    const {
        gender, isPregnant, pregnancyMonth, height, weight, temperature,
        bloodPressure, caseDescription, diagnosis, labResults,
        medicationsProcedures, imageData
    } = caseData;

    return `
        **البيانات الواردة للتحليل:**

        **1. معلومات المريض (بيانات نصية داعمة):**
        - الجنس: ${gender || "غير محدد في النص"}
        ${gender === 'female' ? `- حامل: ${isPregnant === 'yes' ? `نعم، الشهر ${pregnancyMonth || 'غير محدد'}` : 'لا'}` : ''}
        - الطول: ${height ? `${height} سم` : "غير محدد في النص"}
        - الوزن: ${weight ? `${weight} كجم` : "غير محدد في النص"}
        - درجة الحرارة: ${temperature ? `${temperature}°C` : "غير محدد في النص"}
        - ضغط الدم: ${bloodPressure || "غير محدد في النص"}

        **2. تفاصيل الحالة (بيانات نصية داعمة):**
        - وصف الحالة: ${caseDescription || "غير محدد في النص"}
        - التشخيص المبدئي: ${diagnosis || "غير محدد في النص"}
        - نتائج التحاليل والأشعة: ${labResults || "غير محدد في النص"}
        - الأدوية والإجراءات الحالية: ${medicationsProcedures || "غير محدد في النص"}
        
        **3. الملفات المرفوعة:**
        - ${imageData && imageData.length > 0 ? `يوجد ${imageData.length} صورة مرفقة للتحليل. **هذه هي المصدر الأساسي والوحيد للحقيقة.**.` : "لا يوجد صور مرفقة."}

        ---
        **هيكل التقرير المطلوب (للاستخدام في المخرج النهائي):**

        <h3>تقرير استشاري للتدقيق الطبي</h3>
        
        <div class="section">
            <h4>1. ملخص الحالة والبيانات الأساسية:</h4>
            <p>[هنا الملخص والتركيز على البيانات المستخرجة من أعلى النموذج والنواقص]</p>
        </div>

        <div class="section">
            <h4>2. قائمة الأدوية الموصوفة وتحليلها:</h4>
            <p>[هنا القائمة المفصلة للأسماء والجرعات المترجمة]</p>
        </div>
        
        <div class="section">
            <h4>3. الأخطاء الطبية وفجوات التبرير:</h4>
            <p>[هنا كشف الأخطاء الطبية الجسيمة وقائمة الفحوصات المطلوبة]</p>
        </div>

        <div class="section">
            <h4>4. تحليل مخاطر الرفض التأميني:</h4>
            <ul>
                <li><strong>الدواء/الإجراء:</strong> [اسم الدواء] - <span class="[risk-high/risk-medium/risk-low]">[مستوى الخطر]</span>. <strong>السبب:</strong> [شرح سبب الخطر].</li>
            </ul>
        </div>

        <div class="section">
            <h4>5. خطة العمل والتوصيات التنفيذية:</h4>
            <p>[هنا الخطة المحسنة والمقترحة بشكل حاسم]</p>
        </div>

        <div class="section financial-summary">
            <h4>6. التحليل المالي الاستراتيجي:</h4>
            <table>
                <thead><tr><th>المؤشر</th><th>القيمة التقديرية</th><th>ملاحظات</th></tr></thead>
                <tbody>
                    <tr><td>إجمالي الخسائر المحتملة (بسبب الرفض)</td><td>[قيمة تقديرية]</td><td>تشمل الأدوية المرفوضة والمكملات.</td></tr>
                    <tr><td>إجمالي الإيرادات المضافة (من التحسينات)</td><td>[قيمة تقديرية]</td><td>تشمل الفحوصات والإجراءات المبررة.</td></tr>
                </tbody>
            </table>
        </div>
    `;
}


/**
 * @description The intelligent backend for the Medical & Insurance Review Expert system.
 */
export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY environment variable is not set.");
        }
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

        const userPrompt = buildUserPrompt(req.body);
        
        const parts = [
            { text: systemInstruction },
            { text: userPrompt }
        ];

        if (req.body.imageData && Array.isArray(req.body.imageData) && req.body.imageData.length > 0) {
            req.body.imageData.forEach(imgData => {
                parts.push({
                    inline_data: {
                        mimeType: "image/jpeg",
                        data: imgData
                    }
                });
            });
        }

        const payload = {
            contents: [{ role: "user", parts: parts }],
            generationConfig: {
                temperature: 0.3, 
                topP: 0.95,
                topK: 40,
            },
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
            console.error("No report generated by Gemini. Full response:", JSON.stringify(result, null, 2));
            throw new Error("لم يتمكن النموذج من إنشاء التقرير. قد يكون المحتوى محظورًا أو حدث خطأ غير متوقع.");
        }
        
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Server-side Error in /api/gpt:", err);
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message,
        });
    }
}
