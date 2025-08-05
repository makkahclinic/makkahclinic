// /api/gpt.js

/**
 * @description The intelligent backend for the Medical & Insurance Review Expert system.
 * It receives comprehensive case data, including images, from the frontend,
 * and uses a powerful, structured prompt to generate a detailed analytical report with Gemini.
 */
export default async function handler(req, res) {
    // Set CORS headers for cross-origin requests
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle preflight OPTIONS request
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // Ensure the request method is POST
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY environment variable is not set.");
        }
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

        // Destructure all expected data from the request body
        const {
            gender,
            isPregnant,
            pregnancyMonth,
            height,
            weight,
            temperature,
            bloodPressure,
            caseDescription,
            diagnosis,
            labResults,
            medicationsProcedures,
            imageData
        } = req.body;

        // --- Advanced Prompt Engineering ---
        // This prompt is the core "brain" of the application.
        const htmlPrompt = `
            أنت "خبير المراجعة الطبية والتأمين" (Medical & Insurance Review Expert).
            مهمتك هي تحليل البيانات الطبية الشاملة المقدمة لك (سواء كانت نصية أو من الصور) وتقديم تقرير تحليلي احترافي بصيغة HTML.

            ---
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
            - ${imageData && imageData.length > 0 ? `يوجد ${imageData.length} صورة مرفقة للتحليل.` : "لا يوجد صور مرفقة."}

            ---
            **قواعد التحليل (مهم جدًا):**

            1.  **الأولوية للملفات:** الأولوية المطلقة للملفات المرفوعة. إذا كانت هناك صورة، فهي المصدر الأساسي للحقيقة. قم بتحليلها بدقة (حتى لو كانت مكتوبة بخط اليد) لاستخراج كافة التفاصيل.
            2.  **النص كداعِم:** استخدم البيانات النصية (وصف الحالة، التشخيص، إلخ) كمصدر مكمل أو داعم أو لتأكيد ما وجدته في الصورة.
            3.  **تحديد النواقص:** إذا لاحظت أن معلومات حيوية ضرورية للتقييم الكامل ناقصة (مثل الطول، الوزن، نتائج تحاليل معينة لم يتم ذكرها ولكنها ضرورية للتشخيص)، يجب عليك التنويه في تقريرك إلى أهمية هذه المعلومات وكيف يمكن أن تؤثر على دقة التحليل.
            
            ---
            **هيكل التقرير المطلوب (يجب إنتاج كود HTML فقط):**

            <h3>تقرير تحليلي مُفصل</h3>
            
            <div class="section">
                <h4>1. ملخص الحالة وتحليلها:</h4>
                <p>[هنا، قم بتقديم ملخص شامل للحالة بناءً على كل المعطيات. اربط التشخيص بالأدوية والإجراءات المذكورة، ووضح منطقية الخطة العلاجية الأولية.]</p>
            </div>

            <div class="section">
                <h4>2. تقييم الإجراءات الحالية:</h4>
                <p>[حلل كل دواء وإجراء. هل هو الخيار الأفضل؟ هل الجرعة مناسبة؟ هل هناك تداخلات دوائية محتملة؟ انقد الاختيارات السيئة بوضوح علمي.]</p>
            </div>

            <div class="section">
                <h4>3. تحديد النواقص والفجوات (ما الذي ينقص؟):</h4>
                <p>[بناءً على التشخيص والحالة، اذكر بوضوح ما هي الفحوصات المخبرية أو الإشعاعية أو الاستشارات الطبية التي لم يتم عملها وهي ضرورية لتأكيد التشخيص أو لضمان سلامة المريض أو لتلبية متطلبات التأمين.]</p>
            </div>

            <div class="section">
                <h4>4. تحليل مخاطر الرفض التأميني:</h4>
                <ul>
                    <li>[اذكر الإجراء/الدواء الأول الذي قد يُرفض، مع ذكر السبب (مثال: "Pantomax 40mg: خطر رفض متوسط لعدم وجود تشخيص واضح للقرحة"). قدر القيمة المالية للرفض.]</li>
                    <li>[اذكر الإجراء/الدواء الثاني الذي قد يُرفض...]</li>
                </ul>
            </div>

            <div class="section">
                <h4>5. توصيات لتطوير العمل وخطة العمل المثالية:</h4>
                <p>[قدم خطة عمل واضحة ومُحسّنة. ابدأ بالفحوصات المقترحة، ثم الإجراءات العلاجية المبررة بناءً على نتائجها. اشرح كيف أن هذه الخطة ترفع من جودة الرعاية وتضمن موافقة التأمين.]</p>
            </div>

            <div class="section financial-summary">
                <h4>6. المؤشر المالي:</h4>
                <table>
                    <thead><tr><th>المؤشر</th><th>القيمة (ريال سعودي)</th><th>ملاحظات</th></tr></thead>
                    <tbody>
                        <tr><td>إجمالي الدخل الحالي (المفوتر)</td><td>[ضع القيمة التقديرية هنا]</td><td>[ملاحظة]</td></tr>
                        <tr><td>إجمالي الدخل بعد خصم الرفوض المحتملة</td><td>[ضع القيمة التقديرية هنا]</td><td>[ملاحظة]</td></tr>
                        <tr><td>إجمالي الدخل المحتمل مع التحسينات</td><td>[ضع القيمة التقديرية هنا]</td><td>[ملاحظة]</td></tr>
                    </tbody>
                </table>
            </div>

            **مهم جدًا:** يجب أن يكون ردك هو كود HTML فقط، يبدأ مباشرةً بالوسم \`<h3>\` بدون أي مقدمات أو علامات markdown مثل \`\`\`html.
        `;

        // --- Construct the API Payload ---
        const parts = [{ text: htmlPrompt }];
        if (imageData && Array.isArray(imageData) && imageData.length > 0) {
            imageData.forEach(imgData => {
                parts.push({
                    inline_data: {
                        mimeType: "image/jpeg", // Assuming jpeg, can be made dynamic if needed
                        data: imgData
                    }
                });
            });
        }

        const payload = {
            contents: [{ parts: parts }],
            generationConfig: {
                temperature: 0.4, // Lower temperature for more consistent, fact-based output
            },
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
        
        // Safely extract the generated HTML report
        const reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reportHtml) {
            console.error("No report generated by Gemini. Full response:", result);
            throw new Error("لم يتمكن النموذج من إنشاء التقرير.");
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
