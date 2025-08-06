// /api/gpt.js

/**
 * The core thinking process for the AI model.
 * This prompt teaches the AI HOW to think like a medical and insurance auditor.
 * It's structured as a step-by-step reasoning process, not just a template to fill.
 */
const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمينية"، وهو خبير يتمتع بخبرة عميقة في الطب الباطني وبروتوكولات التأمين الصحي. مهمتك هي تحليل الحالات الطبية المقدمة لك وتقديم تقرير تحليلي استراتيجي بصيغة HTML. لا تكتفِ بملء الفراغات، بل اتبع منهجية التفكير التالية بدقة:

**منهجية التحليل الإلزامية (اتبع هذه الخطوات بالترتيب):**

**الخطوة 1: استخلاص البيانات والتقييم الأولي (Data Extraction & First Look)**
1.  ابدأ بالملف المرفوع (الصورة) فهو مصدر الحقيقة الأساسي. قم بفك شفرة خط اليد بدقة شديدة.
2.  استخرج كل المعلومات المتاحة: التشخيصات، أسماء الأدوية، الجرعات، المدة.
3.  قارنها بالبيانات النصية (إن وجدت) للتأكيد.
4.  فوراً، حدد النواقص الجوهرية التي تمنع التقييم الكامل (مثل: **عمر المريض**، **تاريخ الوصفة**، **قياسات حيوية** مثل الضغط الفعلي). هذه نقطة ضعف أساسية ويجب التنويه لها في البداية.

**الخطوة 2: التحليل الطبي المتعمق (Deep Medical Analysis)**
1.  لكل تشخيص، قم بتقييم الأدوية الموصوفة له.
2.  ابحث بصرامة عن **الأخطاء الطبية الجسيمة (Major Red Flags)** مثل:
    - **الازدواجية العلاجية (Therapeutic Duplication):** هل يتلقى المريض نفس الدواء من مصادر مختلفة؟ (مثال: دوائين للضغط من نفس الفئة).
    - **أخطاء الجرعات (Dosage Errors):** هل الجرعة أو تكرارها صحيح علمياً؟ (مثال: إعطاء دواء ممتد المفعول "MR" مرتين يومياً).
    - **التداخلات الدوائية الخطرة (Drug Interactions).**
3.  انقد أي خيار علاجي ضعيف وقدم البديل الأفضل علمياً.

**الخطوة 3: تحليل فجوات التبرير (Justification Gap Analysis)**
- لكل دواء أو إجراء، اسأل نفسك: "ما هو المستند أو الفحص الذي تحتاجه شركة التأمين للموافقة على هذا؟".
- اذكر بوضوح الفحوصات الناقصة. أمثلة:
    - لتبرير دواء دهون (Statin) نحتاج **تحليل ملف الدهون (Lipid Profile)**.
    - لتبرير أدوية السكري نحتاج **فحص السكر التراكمي (HbA1c)**.
    - لتبرير دواء بروستاتا مكلف نحتاج **تقرير سونار (Ultrasound)**.
- استخدم وسم <strong>&lt;strong&gt;</strong> لتمييز أسماء الفحوصات الناقصة.

**الخطوة 4: تحليل مخاطر الرفض التأميني (Insurance Rejection Risk)**
- بناءً على تحليلك، صنّف كل دواء أو إجراء حسب خطر الرفض (مرتفع، متوسط، منخفض).
- اشرح "لماذا" سيتم الرفض. مثال: "دواء X - خطر مرتفع. السبب: ازدواجية علاجية مع دواء Y".

**الخطوة 5: صياغة التوصيات والخطة المثالية (Actionable Recommendations)**
- قدم خطة عمل واضحة ومحسّنة.
- ابدأ بـ "الإجراءات الفورية المقترحة" (الفحوصات والاستشارات اللازمة).
- ثم صف "الخطة العلاجية المثالية" التي هي أكثر أماناً للمريض ومبررة بالكامل للتأمين.

**الخطوة 6: التحليل المالي (Financial Impact)**
- لا تخترع أرقاماً. بدلاً من ذلك، قم بتحليل التأثير المالي بشكل هيكلي.
- حدد "قيمة الخسارة" بذكر البنود التي سيتم رفضها (مثال: تكلفة الأدوية المكررة والمكملات الغذائية).
- حدد "فرص زيادة الإيرادات" بذكر الخدمات الإضافية المبررة التي كان يمكن تقديمها (مثال: تكلفة الفحوصات المخبرية، السونار، تخطيط القلب). استخدم نصوصاً مثل "[قيمة تقديرية]" بدلاً من الأرقام.

**المخرج النهائي: (مهم جداً)**
- يجب أن يكون ردك هو كود HTML فقط، منسق وجاهز للعرض.
- استخدم الـ Classes المحددة في الهيكل أدناه.
- ابدأ مباشرة بالوسم \`<h3>\` بدون أي مقدمات أو علامات markdown.
`;

/**
 * Builds the dynamic user prompt part based on the request data.
 * @param {object} caseData - The data from the request body.
 * @returns {string} - A formatted string presenting the case data to the model.
 */
function buildUserPrompt(caseData) {
    const {
        gender, isPregnant, pregnancyMonth, height, weight, temperature,
        bloodPressure, caseDescription, diagnosis, labResults,
        medicationsProcedures, imageData
    } = caseData;

    return `
        **البيانات الواردة للتحليل:**

        **1. معلومات المريض:**
        - الجنس: ${gender || "لم يحدد"}
        ${gender === 'female' ? `- حامل: ${isPregnant === 'yes' ? `نعم، الشهر ${pregnancyMonth || 'غير محدد'}` : 'لا'}` : ''}
        - الطول: ${height ? `${height} سم` : "لم يحدد"}
        - الوزن: ${weight ? `${weight} كجم` : "لم يحدد"}
        - درجة الحرارة: ${temperature ? `${temperature}°C` : "لم تحدد"}
        - ضغط الدم: ${bloodPressure || "لم يحدد"}

        **2. تفاصيل الحالة:**
        - وصف الحالة: ${caseDescription || "لم يحدد"}
        - التشخيص المبدئي: ${diagnosis || "لم يحدد"}
        - نتائج التحاليل والأشعة: ${labResults || "لم يحدد"}
        - الأدوية والإجراءات الحالية: ${medicationsProcedures || "لم يحدد"}
        
        **3. الملفات المرفوعة:**
        - ${imageData && imageData.length > 0 ? `يوجد ${imageData.length} صورة مرفقة للتحليل. **هذه هي المصدر الأساسي للمعلومات**.` : "لا يوجد صور مرفقة."}

        ---
        **هيكل التقرير المطلوب (للاستخدام في المخرج النهائي):**

        <h3>تقرير تحليلي استراتيجي</h3>
        
        <div class="section">
            <h4>1. ملخص الحالة والنواقص الجوهرية:</h4>
            <p>[هنا الملخص والتركيز على النواقص مثل العمر والتاريخ]</p>
        </div>

        <div class="section">
            <h4>2. التحليل الطبي التفصيلي وتقييم العلاج:</h4>
            <p>[هنا تحليل الأدوية وكشف الأخطاء مثل الازدواجية والجرعات الخاطئة]</p>
        </div>

        <div class="section">
            <h4>3. الفجوات التشخيصية والتبريرات المطلوبة:</h4>
            <p>[هنا قائمة بالفحوصات الضرورية الناقصة مثل <strong>تحليل الدهون</strong> و <strong>HbA1c</strong>]</p>
        </div>

        <div class="section">
            <h4>4. تحليل مخاطر الرفض التأميني:</h4>
            <p>استخدم التصنيفات التالية: <span class="risk-high">خطر مرتفع</span>، <span class="risk-medium">خطر متوسط</span>، و <span class="risk-low">خطر منخفض</span>.</p>
            <ul>
                <li><strong>الدواء/الإجراء:</strong> [اسم الدواء] - <span class="[risk-high/risk-medium/risk-low]">[مستوى الخطر]</span>. <strong>السبب:</strong> [شرح سبب الخطر].</li>
            </ul>
        </div>

        <div class="section">
            <h4>5. توصيات وخطة العمل المثالية:</h4>
            <p>[هنا الخطة المحسنة المقترحة لضمان الجودة وموافقة التأمين]</p>
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

        // Construct the dynamic user prompt from the request body
        const userPrompt = buildUserPrompt(req.body);
        
        // --- Construct the API Payload ---
        // Start with the system instructions and user-provided text data
        const parts = [
            { text: systemInstruction },
            { text: userPrompt }
        ];

        // Add image data if it exists
        if (req.body.imageData && Array.isArray(req.body.imageData) && req.body.imageData.length > 0) {
            req.body.imageData.forEach(imgData => {
                // Future improvement: Dynamically detect MIME type from base64 string if needed.
                // For now, assuming JPEG as per the use case.
                parts.push({
                    inline_data: {
                        mimeType: "image/jpeg",
                        data: imgData
                    }
                });
            });
        }

        const payload = {
            // The model performs better by combining instructions and data in a single turn
            contents: [{ role: "user", parts: parts }],
            generationConfig: {
                temperature: 0.3, // Lower temperature for more factual, less creative analysis
                topP: 0.95,
                topK: 40,
            },
            // safetySettings can be adjusted if the model is too restrictive on medical content
        };

        // --- Make the API Call to Gemini ---
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
        
        // Robustly access the generated text
        const reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reportHtml) {
            console.error("No report generated by Gemini. Full response:", JSON.stringify(result, null, 2));
            throw new Error("لم يتمكن النموذج من إنشاء التقرير. قد يكون المحتوى محظورًا أو حدث خطأ غير متوقع.");
        }
        
        // --- Send the successful response back to the frontend ---
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        // --- Handle any server-side errors ---
        console.error("🔥 Server-side Error in /api/gpt:", err);
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message,
        });
    }
}
