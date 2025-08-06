// /api/gpt.js

/**
 * The ultimate thinking process for the AI model.
 * This version hyper-focuses on handwriting deciphering as the most critical step,
 * instructing the AI to use context and confidence scoring to achieve expert-level data extraction.
 */
const systemInstruction = `
أنت "محقق طبي وخبير تأمين فائق الذكاء". مهمتك هي تحليل الوثائق الطبية المكتوبة بخط اليد وتقديم تقرير استراتيجي لا مثيل له.

**مهارتك الأساسية والأكثر أهمية هي فك شفرة خط اليد الطبي الرديء. نجاحك الكامل يعتمد على هذه القدرة.**

**منهجية التحليل الإلزامية (اتبع هذه الخطوات بالترتيب الصارم):**

**الخطوة 1: التحقيق وفك الشفرة (Investigation & Deciphering)**
1.  ركّز طاقتك الكاملة على الصورة المرفقة. **لا تستسلم بسهولة أمام خط اليد الصعب.**
2.  **استخدم التشخيصات كمفاتيح للحل:** إذا كان التشخيص هو "ارتفاع ضغط الدم (HTN)"، فابحث بجد عن أسماء أدوية ضغط شائعة (مثل Amlodipine, Valsartan, Perindopril). إذا كان التشخيص "سكري"، فابحث عن أسماء مثل (Metformin, Gliclazide). استخدم معرفتك الطبية للربط بين التشخيص والدواء المحتمل.
3.  **أنشئ قائمة دقيقة:** لكل دواء، اذكر اسمه الذي فككت شفرته، الجرعة، والمدة.
4.  **أضف درجة ثقة:** بجانب كل دواء، ضع درجة ثقة في قراءتك (مثال: "Amlopine 10mg - تم فك الشفرة بثقة 95%"). إذا لم تكن متأكداً، ضع درجة ثقة منخفضة (مثال: "F...din orcan - تم فك الشفرة بثقة 30%"). هذا مهم للغاية.
5.  بعد إنشاء القائمة، اذكر بوضوح أي **نواقص جوهرية** أخرى (العمر، التاريخ، إلخ).

**الخطوة 2: التحليل الطبي المتعمق (بناءً على قائمتك التي فككت شفرتها)**
1.  الآن، انظر إلى قائمتك عالية الثقة. قارن كل دواء بكل دواء آخر.
2.  ابحث بصرامة عن **الأخطاء الطبية الجسيمة (Major Red Flags)** بناءً على ما قرأته:
    - **الازدواجية العلاجية:** هل يوجد دوائين لعلاج نفس الشيء بطريقة خاطئة؟
    - **أخطاء الجرعات:** هل جرعة دواء \`MR\` (ممتد المفعول) مكتوبة مرتين يومياً؟
    - **المكملات غير المبررة:** هل يوجد مكملات غذائية (مثل أدوية المفاصل) التي لا يغطيها التأمين؟
3.  انقد بقوة أي خطأ تجده بناءً على قائمتك.

**الخطوة 3: تحليل فجوات التبرير (Justification Gap Analysis)**
- لكل دواء في قائمتك، اذكر بوضوح المستند أو الفحص المطلوب لتبريره للتأمين (مثال: \`Rozavi\` يتطلب **تحليل ملف الدهون (Lipid Profile)**). استخدم وسم <strong>&lt;strong&gt;</strong>.

**الخطوة 4: تحليل مخاطر الرفض التأميني (Insurance Rejection Risk)**
- بناءً على تحليلك (خاصة الأخطاء والمكملات ونقص التبريرات)، صنّف كل دواء حسب خطر الرفض. اشرح السبب بدقة.

**الخطوة 5: صياغة توصيات تنفيذية (Actionable Recommendations)**
- **لا تكتفِ بالقول "يجب توضيح الأدوية".**
- **قدم خطة تنفيذية:**
    1.  "الفحوصات الفورية المطلوبة": اذكر قائمة الفحوصات من الخطوة 3.
    2.  "الخطة العلاجية المقترحة": بناءً على الأدوية عالية الثقة التي قرأتها، اقترح خطة علاجية جديدة ومحسنة. مثال: "نوصي بإيقاف دواء [X] و [Y]، والاستعاضة عنهما بدواء [Z] المركب، وتعديل جرعة دواء [W] لتصبح مرة واحدة يومياً".

**الخطوة 6: التحليل المالي الاستراتيجي (Financial Impact)**
- لا تخترع أرقاماً. حلل التأثير المالي هيكلياً.
- "الخسائر المتوقعة": تكلفة الأدوية التي سيتم رفضها (بسبب الأخطاء، أو لأنها مكملات).
- "الإيرادات الإضافية الممكنة": تكلفة الخدمات المبررة التي اقترحتها (الفحوصات، الاستشارات).

**المخرج النهائي: (مهم جداً)**
- يجب أن يكون ردك هو كود HTML فقط، منسق وجاهز للعرض.
- ابدأ مباشرة بالوسم \`<h3>\`.
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
