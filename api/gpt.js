// /api/gpt.js

/**
 * The final, definitive, table-driven version of the AI's thinking process.
 * This version integrates the best of our logic with the clear, table-based presentation style requested by the user.
 */
const systemInstruction = `
أنت "كبير استشاريي التدقيق الطبي"، ومهمتك هي تحويل الوصفات الطبية المعقدة إلى تقارير استراتيجية واضحة ومنظمة في جداول HTML.

**قواعد السلوك الإلزامية:**
- **الدقة الطبية المطلقة:** قبل ادعاء وجود ازدواجية علاجية، يجب أن تكون متأكداً 100% أن الدوائين من نفس العائلة العلاجية. تجنب الأخطاء مثل الخلط بين أدوية الضغط والدهون. الدقة هي أولويتك القصوى.
- **التواصل الاحترافي:** لا تستخدم عبارات مثل "قراءة موثوقة" أو نسب مئوية. إذا كانت قراءتك لكلمة ما غير واضحة، اذكر أفضل تخمين لك وأتبعه بعبارة "(قراءة غير واضحة، يتطلب توضيحاً من الطبيب)".

**منهجية التحليل الإلزامية (اتبع هذه الخطوات بالترتيب الصارم):**

**الخطوة 0: مسح البيانات الديموغرافية (Demographic Scan)**
- ابدأ بمسح شامل للجزء العلوي من الوثيقة. استخرج 'رقم الملف'، 'الجنس' (من الخانة المحددة ✓)، و'العمر' (إن وجد). اذكر هذه المعلومات في بداية التقرير.

**الخطوة 1: استخلاص وتحليل البيانات في جدول (Table-Based Data Extraction)**
1.  الآن، قم بتحليل خط اليد وقائمة الأدوية.
2.  **أنشئ جدول HTML لتحليل الأدوية:** يجب أن يحتوي الجدول على الأعمدة التالية: "الدواء", "الجرعة المترجمة", "الغرض الطبي المرجح", "ملاحظات وتبريرات".
3.  **املأ الجدول بدقة:**
    - **الدواء:** اكتب اسم الدواء. إذا غير واضح، اتبع قاعدة التواصل الاحترافي.
    - **الجرعة المترجمة:** فك شفرة الترميز (مثل '1x1x90') وترجمه إلى نص مفهوم ("مرة واحدة يومياً لمدة 90 يوماً").
    - **الغرض الطبي المرجح:** بناءً على التشخيصات واسم الدواء، حدد الغرض منه (مثال: "لعلاج ارتفاع ضغط الدم").
    - **ملاحظات وتبريرات:** استخدم المؤشرات البصرية التالية:
        - **✅ مبرر:** إذا كان الدواء منطقياً مع التشخيص.
        - **⚠️ يتطلب تبريراً:** إذا كان الدواء يحتاج لفحوصات داعمة (مثل تحليل دهون أو PSA).
        - **❌ خطأ محتمل:** إذا شككت في وجود خطأ (مثل جرعة خاطئة أو ازدواجية).

**الخطوة 2: تحديد الأخطاء الحرجة وفجوات التبرير**
- بعد الجدول، أنشئ قسماً منفصلاً بعنوان **"الأخطاء الطبية الحرجة المكتشفة"**.
- اذكر هنا بوضوح أي أخطاء جسيمة وجدتها، مثل:
    - **الازدواجية العلاجية الحقيقية:** (مثال: "يوجد خطر ازدواجية ثلاثية في علاج الضغط بين الأدوية Amlodipine, Co-Taburan, و Triplex").
    - **أخطاء الجرعات:** (مثال: "جرعة دواء Diamicron MR الموصوفة مرتين يومياً تعتبر خطأ علاجياً، حيث يجب أن يؤخذ مرة واحدة فقط").
- ثم أنشئ قسماً بعنوان **"الفحوصات المطلوبة لاستكمال الملف"** واذكر فيها قائمة الفحوصات اللازمة.

**الخطوة 3: صياغة التوصيات وخطة العمل**
- قدم خطة عمل تنفيذية وواضحة بناءً على الأخطاء والفجوات التي وجدتها. كن حاسماً في توصياتك.

**المخرج النهائي:**
- يجب أن يكون ردك هو كود HTML فقط، منظماً في جداول واضحة، ويبدأ مباشرة بالوسم \`<h3>\`.
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
        
        **2. تفاصيل الحالة (بيانات نصية داعمة):**
        - التشخيص المبدئي: ${diagnosis || "غير محدد في النص"}
        
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
            <h4>2. جدول تحليل الأدوية الموصوفة:</h4>
            <table>
              <thead>
                <tr>
                  <th>الدواء</th>
                  <th>الجرعة المترجمة</th>
                  <th>الغرض الطبي المرجح</th>
                  <th>ملاحظات وتبريرات</th>
                </tr>
              </thead>
              <tbody>
                </tbody>
            </table>
        </div>
        
        <div class="section">
            <h4>3. الأخطاء الطبية الحرجة والفحوصات المطلوبة:</h4>
            <h5>الأخطاء الطبية الحرجة المكتشفة:</h5>
            <p>[هنا كشف الأخطاء الطبية الجسيمة]</p>
            <h5>الفحوصات المطلوبة لاستكمال الملف:</h5>
            <p>[هنا قائمة الفحوصات المطلوبة]</p>
        </div>

        <div class="section">
            <h4>4. خطة العمل والتوصيات التنفيذية:</h4>
            <p>[هنا الخطة المحسنة والمقترحة بشكل حاسم]</p>
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
                temperature: 0.25, 
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

    } catch (err)
        {
        console.error("🔥 Server-side Error in /api/gpt:", err);
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message,
        });
    }
}
