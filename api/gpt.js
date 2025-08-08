// /api/gpt.js - THE FINAL, POWERFUL, AND BALANCED VERSION

const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري فائق الدقة. مهمتك هي إنتاج تقرير HTML منظم، عميق التحليل، وممتاز بصريًا.

### الجزء الأول: منهجية التحليل (إلزامية)

**1. استخلاص البيانات:**
- حلل **كل** البيانات المتاحة من النص والصور.
- إذا لم توجد صورة، فالنص هو المصدر الوحيد للحقيقة.
- إذا وجدت تناقضًا بين النص والصورة، اذكر ذلك كملاحظة حرجة.

**2. قائمة التدقيق في الأخطاء الحرجة (يجب البحث عنها بصرامة):**
- **التعارض المنطقي:** هل الدواء مناسب لجنس المريض؟ هل يتعارض مع حالة الحمل؟
- **الازدواجية العلاجية:** هل يوجد أكثر من دواء لنفس الغرض (خاصة أدوية الضغط)؟
- **خطأ الجرعة القاتل:** هل تم وصف دواء ممتد المفعول (MR) أكثر من مرة يوميًا؟
- **مراقبة الأدوية عالية الخطورة:**
  - **Xigduo XR:** يتطلب فحص eGFR لوظائف الكلى.
  - **No-uric (Allopurinol):** يتطلب فحص حمض اليوريك ووظائف الكلى.
  - **Vominore + Bertigo (لكبار السن):** خطر التسكين المفرط.
- **المكملات الغذائية:** صنفها كـ "غير مغطاة تأمينيًا على الأرجح".
- **مدة الصرف الطويلة:** علّق على مدة الصرف 90 يومًا.

### الجزء الثاني: هيكل التقرير (إلزامي)

يجب أن يكون مخرجك بالكامل عبارة عن كتلة HTML واحدة بالهيكل التالي:

**1. عنوان التقرير:**
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>

**2. ملخص الحالة:**
- لخص البيانات الديموغرافية والتشخيصات والملاحظات الحرجة.

**3. التحليل السريري العميق:**
- اكتب فقرات مفصلة تشرح كل خطأ رئيسي تم اكتشافه من قائمة التدقيق.

**4. جدول الأدوية والإجراءات:**
- أنشئ جدولاً بالأعمدة: "الدواء/الإجراء", "الجرعة", "الغرض الطبي", "التداخلات", "الوضع التأميني".
- **عمود "الوضع التأميني": هذا العمود إلزامي وحاسم.** يجب أن يكون المحتوى عنصر \`<span>\` بالفئة اللونية المناسبة وأيقونة وسبب واضح.
    - **مثال إلزامي:** \`<span class="risk-high">❌ مرفوض (ازدواجية علاجية)</span>\`
    - **مثال إلزامي:** \`<span class="risk-medium">⚠️ قابل للرفض (يتطلب فحص eGFR)</span>\`
    - **مثال إلزامي:** \`<span class="risk-low">✅ مقبول</span>\`
    - **يجب ذكر السبب بوضوح** داخل الـ \`span\`.

**5. فرص تحسين الرعاية:**
- قائمة نقطية بالفحوصات الناقصة مع ربطها بالدواء أو التشخيص.

**6. خطة العمل:**
- قائمة مرقمة وواضحة بالتصحيحات الفورية.

**7. الخاتمة:**
- "هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص."
`;

function buildUserPrompt(caseData) {
    const textInput = `
        **بيانات المريض المدخلة يدويًا:**
        - العمر: ${caseData.age || 'غير محدد'}
        - الجنس: ${caseData.gender || 'غير محدد'}
        - التشخيص المبدئي: ${caseData.diagnosis || 'غير محدد'}
        - الأدوية المكتوبة: ${caseData.medications || 'غير محدد'}
        - ملاحظات إضافية: ${caseData.notes || 'غير محدد'}
    `;

    return `
        ${textInput}

        **الملفات المرفوعة:**
        - ${caseData.imageData && caseData.imageData.length > 0 ? `يوجد صورة مرفقة للتحليل.` : "لا يوجد صور مرفقة."}
    `;
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST", "OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type", "Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

        const userPrompt = buildUserPrompt(req.body); 
        const parts = [{ text: systemInstruction }, { text: userPrompt }];

        if (req.body.imageData && Array.isArray(req.body.imageData)) {
            req.body.imageData.forEach(imgData => {
                parts.push({ inline_data: { mimeType: "image/jpeg", data: imgData } });
            });
        }

        const payload = {
            contents: [{ role: "user", parts: parts }],
            generationConfig: { temperature: 0.2, topP: 0.95, topK: 40 },
        };

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(errorBody.error?.message || `API request failed: ${response.statusText}`);
        }

        const result = await response.json();
        const reportHtml = result.candidates[0].content.parts[0].text;
        
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message,
        });
    }
}
