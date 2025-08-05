// /api/gpt.js

export default async function handler(req, res) {
    // ... (The top part of the code remains the same)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("🔥 Server-side Error: GEMINI_API_KEY is not set.");
        return res.status(500).json({
            error: "خطأ في إعدادات الخادم",
            detail: "مفتاح واجهة برمجة التطبيقات (API Key) غير موجود.",
        });
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
    
    let htmlPrompt;
    const requestBody = req.body;

    if (requestBody.analysisType === 'patient') {
        // --- PATIENT PORTAL PROMPT (No changes here) ---
        // ... (The patient prompt remains the same as before)

    } else {
        // --- 🚀 FINAL & STRICT EXPERT AUDITOR PROMPT V3 ---
        const { diagnosis, symptoms, age, gender, smoker, beforeProcedure, afterProcedure } = requestBody;
        htmlPrompt = `
        **شخصيتك الأساسية:** أنت "خبير استشاري أعلى في المراجعة الطبية والتأمين الطبي (Senior Certified Medical Reimbursement Specialist)". ولديك قدرة فائقة على قراءة وتحليل الوصفات الطبية المكتوبة بخط اليد مهما كانت معقدة. خبرتك مبنية على بروتوكولات العلاج العالمية (UpToDate, NICE, American Diabetes Association) وسياسات شركات التأمين في المملكة العربية السعودية (مثل بوبا، التعاونية).

        **مهمتك:** تحليل الحالة الطبية المرفقة (نصًا وصورًا) وتقديم تقرير تدقيق طبي شامل لا يقبل الجدل، بصيغة HTML.

        // 🚀-- قواعد صارمة يجب اتباعها حرفيًا --🚀

        1.  **قاعدة التحليل الشامل:** **لا تتجاهل أي دواء أو تشخيص مكتوب، حتى لو كان غير واضح.** قم بتحليل كل دواء في صف منفصل تمامًا في الجدول. إذا كان خط اليد غير واضح، ابذل أقصى جهدك لتخمين الدواء من سياق التشخيصات الأخرى (مثلاً، إذا رأيت تشخيص السكري، فمن المرجح أن الدواء غير الواضح هو دواء سكري).
        2.  **قاعدة الألوان الإلزامية:** أنت **ملزم** باستخدام الأصناف اللونية (`class="risk-red"`, `class="risk-yellow"`, `class="risk-green"`) في وسوم `<tr>` الخاصة بالجدول الأول. **لا تترك أي صف بدون صنف لوني.**
            -   **risk-red**: للأخطاء الطبية الواضحة، أو الإجراءات المرفوضة تأمينيًا بنسبة 100%.
            -   **risk-yellow**: للإجراءات التي تحتاج تبريرًا قويًا جدًا أو تعتبر خارج البروتوكول المعتاد.
            -   **risk-green**: للإجراءات السليمة والمتوافقة تمامًا مع البروتوكولات.
        3.  **قاعدة حل التناقضات:** إذا وجدت تناقضًا صارخًا بين البيانات (مثلاً، تشخيصات لأمراض كبار السن مثل BPH لمريض يُدّعى أنه طفل)، يجب عليك الإشارة إلى هذا التناقض **بوضوح وقوة** في "الملخص التنفيذي". اعتبره مؤشرًا خطيرًا على احتمالية وجود خطأ كارثي في إدخال البيانات أو احتيال.
        4.  **قاعدة المصادر:** عند ذكر بروتوكول علاجي، يجب أن تكون محددًا. مثال: "بروتوكول الجمعية الأمريكية للسكري (ADA) لمرضى السكري من النوع الثاني".

        ---
        **هيكل التقرير المطلوب (يجب إنتاج كود HTML فقط باتباع هذا الهيكل بدقة شديدة):**

        <h3><svg ...>تقرير التدقيق الطبي الشامل</svg></h3>

        <div class="section">
            <h4>الملخص التنفيذي وأخطر الملاحظات</h4>
            <div class="recommendation-card risk-red">
              <p><strong>[ضع هنا أخطر ملاحظة بشكل مباشر، مثلاً: "تم وصف دواء Duodart المخصص للبروستاتا لمريض عمره 12 عامًا، وهو ما يعتبر خطأ طبيًا فادحًا ومرفوض تأمينيًا بشكل قاطع."]</strong></p>
            </div>
            <div class="recommendation-card risk-yellow">
              <p><strong>[ضع هنا ملاحظة هامة أخرى، مثلاً: "تم وصف 3 أدوية لارتفاع ضغط الدم و 2 للسكري مما قد يشير إلى حالة معقدة جدًا (Polypharmacy) تحتاج إلى توثيق استثنائي."]</strong></p>
            </div>
        </div>

        <div class="section">
            <h4>1. تقييم الإجراءات الحالية (التدقيق التفصيلي)</h4>
            <table class="audit-table">
                <thead><tr><th>الإجراء / الدواء</th><th>التقييم والتعليل العلمي (مع المصدر)</th><th>موافقة التأمين</th></tr></thead>
                <tbody>
                    <tr class="risk-green">
                        <td>Amlodipine 10mg</td>
                        <td><strong>تقييم: سليم ومبرر.</strong><br>يستخدم لعلاج ارتفاع ضغط الدم (HTN). الجرعة ضمن النطاق الطبيعي للبالغين. يتوافق مع إرشادات JNC8.</td>
                        <td><strong>مقبول.</strong> الإجراء ضروري طبيًا للتشخيص المذكور.</td>
                    </tr>
                    <tr class="risk-red">
                        <td>Duodart 0.5/0.4mg</td>
                        <td><strong>تقييم: خطأ طبي فادح.</strong><br>هذا الدواء مخصص لعلاج تضخم البروستاتا الحميد (BPH) ولا يستخدم إطلاقًا للنساء أو الأطفال. وصفه لطفل يعتبر خطأ جسيمًا.</td>
                        <td><strong>مرفوض قطعًا.</strong> استخدام خارج النطاق (Off-label) وغير مبرر بشكل خطير.</td>
                    </tr>
                    </tbody>
            </table>
        </div>

        <div class="section">
            <h4>2. فرص التحسين ورفع الإيرادات (الإجراءات الفائتة)</h4>
            <p>بناءً على التشخيصات المتعددة (Polypharmacy)، هذه هي الإجراءات الضرورية التي تم إغفالها:</p>
            <div class="recommendation-card">
                <h5>إجراء مقترح: فحص وظائف الكلى (Creatinine, eGFR) ولوحة الدهون الكاملة (Lipid Panel)</h5>
                <p><strong>المبرر الطبي:</strong> مع وجود تشخيص ارتفاع ضغط الدم والسكري (HTN, Dyslipidemia)، فإن بروتوكولات ADA و KDIGO تجعل هذه الفحوصات **إلزامية** لمراقبة تأثير الأدوية على الكلى وتقييم مخاطر أمراض القلب. إغفالها يعتبر نقصًا في الرعاية.</p>
                <p><strong>التأثير المالي:</strong> إضافة هذه الفحوصات كان سيزيد الفاتورة بقيمة تقريبية **~350 ريال سعودي** وهي مغطاة بالكامل من التأمين للتشخيصات المذكورة.</p>
            </div>
        </div>
        
        <div class="section financial-summary"> ... </div>
        <div class="section"><h4>4. توصيات نهائية للترميز والتوثيق</h4> ... </div>
        `;
    }

    // --- The rest of the file remains the same ---
    const parts = [{ text: htmlPrompt }];
    if (requestBody.imageData) {
        if (Array.isArray(requestBody.imageData)) {
            requestBody.imageData.forEach(imgData => {
                parts.push({ inline_data: { mime_type: "image/jpeg", data: imgData } });
            });
        } 
        else if (typeof requestBody.imageData === 'string') {
            parts.push({ inline_data: { mime_type: "image/jpeg", data: requestBody.imageData } });
        }
    }
    const payload = {
        contents: [{ parts: parts }],
        generationConfig: {
            temperature: 0.3, // Lowered temperature for more deterministic and rule-following output
        },
    };
    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) {
            const errorMessage = result.error?.message || `API request failed: ${response.statusText}`;
            throw new Error(errorMessage);
        }
        const reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!reportHtml) {
            throw new Error("لم يتمكن النموذج من إنشاء التقرير. الاستجابة كانت فارغة.");
        }
        return res.status(200).json({ htmlReport: reportHtml });
    } catch (err) {
        console.error("🔥 Server-side Error:", err);
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message,
        });
    }
}
