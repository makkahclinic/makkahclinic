// /api/gpt.js

export default async function handler(req, res) {
    console.log("API route /api/gpt hit."); // Log entry point

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
        console.log("Handling OPTIONS request.");
        return res.status(200).end();
    }
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("GEMINI_API_KEY is not set.");
            return res.status(500).json({ error: "API Key is not configured on the server." });
        }
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
        const requestBody = req.body;
        let htmlPrompt;

        // This block is for insurance-check.html
        console.log("Building prompt for Doctor Portal.");
        const { diagnosis, symptoms, age, gender, smoker } = requestBody;
        htmlPrompt = `
        **شخصيتك الأساسية:** أنت "خبير استشاري أعلى في المراجعة الطبية والتأمين الطبي". لديك قدرة فائقة على قراءة وتحليل الوصفات الطبية المكتوبة بخط اليد. خبرتك مبنية على بروتوكولات العلاج العالمية وسياسات شركات التأمين في المملكة العربية السعودية.

        **مهمتك:** تحليل الحالة الطبية المرفقة وتقديم تقرير تدقيق طبي شامل بصيغة HTML.

        **قواعد صارمة يجب اتباعها حرفيًا:**
        1.  **التحليل الشامل:** حلل **كل دواء** في صف منفصل في الجدول. لا تتجاهل أي دواء حتى لو كان خطه غير واضح، حاول تخمينه من السياق.
        2.  **الألوان الإلزامية:** **أنت ملزم** باستخدام الأصناف اللونية (`class="risk-red"`, `class="risk-yellow"`, `class="risk-green"`) في وسوم `<tr>`. لا تترك أي صف بدون لون. (أحمر للخطأ، أصفر للشك، أخضر للسليم).
        3.  **كشف التناقضات:** إذا وجدت تناقضًا (مثل تشخيص مرض للبالغين لطفل)، اذكر ذلك بوضوح في الملخص التنفيذي كأولوية قصوى.
        4.  **المصادر:** اذكر اسم البروتوكول العلمي كمرجع (مثال: "حسب إرشادات الجمعية الأمريكية للسكري ADA").

        **هيكل التقرير المطلوب (HTML فقط):**
        1.  **الملخص التنفيذي:** ابدأ بـ `<h4>الملخص التنفيذي وأخطر الملاحظات</h4>` ثم استخدم `<div class="recommendation-card risk-red">` لعرض أخطر ملاحظة.
        2.  **جدول التدقيق:** استخدم `<h4>1. تقييم الإجراءات الحالية (التدقيق التفصيلي)</h4>` ثم أنشئ جدولاً `class="audit-table"` وحلل كل دواء في صف `<tr>` مع تطبيق صنف اللون الإلزامي.
        3.  **فرص التحسين:** استخدم `<h4>2. فرص التحسين ورفع الإيرادات (الإجراءات الفائتة)</h4>` واقترح فحوصات أو استشارات ضرورية تم إغفالها مع تبريرها الطبي والأثر المالي التقريبي.
        4.  **الملخص المالي وجدول التوصيات:** أكمل التقرير بالقسمين الأخيرين كما في التعليمات السابقة.
        `;

        console.log("Prompt built. Preparing payload for Gemini.");
        const parts = [{ text: htmlPrompt }];
        if (requestBody.imageData) {
            if (Array.isArray(requestBody.imageData)) {
                requestBody.imageData.forEach(imgData => parts.push({ inline_data: { mime_type: "image/jpeg", data: imgData } }));
            } else if (typeof requestBody.imageData === 'string') {
                parts.push({ inline_data: { mime_type: "image/jpeg", data: requestBody.imageData } });
            }
        }

        const payload = {
            contents: [{ parts: parts }],
            generationConfig: { temperature: 0.3 },
        };

        console.log("Sending request to Gemini API...");
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        console.log(`Received response from Gemini with status: ${response.status}`);
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || "Error from Gemini API");
        }
        
        const reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!reportHtml) {
            throw new Error("Gemini response was successful but contained no text report.");
        }

        console.log("Successfully generated report. Sending to client.");
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Final catch block error in /api/gpt:", err);
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء معالجة طلبك.",
            detail: err.message,
        });
    }
}
