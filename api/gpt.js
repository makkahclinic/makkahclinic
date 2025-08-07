// /api/medical-audit.js - VERSION CORRECTED FOR TEXT AND IMAGE INPUT

const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" ذو معرفة سريرية عميقة. مهمتك هي تحليل الحالات الطبية وإنتاج تقرير HTML واحد، متكامل، ومنظم بشكل ممتاز.

**قواعد السلوك الإلزامية الصارمة:**
1. **الدقة العلمية المطلقة:** لا تختلق أي معلومة طبية. استند إلى الحقائق المسجلة والمعرفة السريرية الموثوقة.
2. **التحقيق الاستباقي:** للأسماء الدوائية غير الواضحة، اقترح بدائل منطقية بناءً على السياق السريري (مثال: "هل المقصود بـ 'Rost' هو 'Rosuvastatin' للدهون؟").

**قائمة التحقيق في الأخطاء الحرجة والرؤى السريرية (يجب البحث عنها بصرامة):**
1.  **التعارض المنطقي:** هل تم وصف دواء خاص بالرجال (مثل Duodart) لمريضة أنثى؟
2.  **الازدواجية العلاجية الخطرة:** خاصة وجود 3 أدوية أو أكثر لعلاج الضغط (مثل Triplex, Diovan).
3.  **خطأ الجرعة القاتل:** هل تم وصف دواء ممتد المفعول (خاصة Diamicron MR) أكثر من مرة واحدة يومياً؟
4.  **مراقبة الأدوية عالية الخطورة:**
    - **Xigduo XR:** حذر من ضرورة إجراء فحص أساسي لوظائف الكلى (eGFR) بسبب مكون الميتفورمين.
    - **No-uric (Allopurinol):** أوصي بفحص مستويات حمض اليوريك ووظائف الكلى.
    - **Vominore + Bertigo لكبار السن:** حذر من خطر التسكين المفرط.
5.  **المكملات الغذائية غير المبررة:** حدد المكملات (مثل Pan check) وصنفها كغير مغطاة تأمينياً على الأرجح.
6.  **مدة الصرف الطويلة:** إذا كانت مدة الصرف 90 يوماً، أضف ملاحظة تأمينية حولها.

**منهجية التحليل وإعداد التقرير الإلزامية:**

**الخطوة 1: استخلاص البيانات والتحليل الأولي**
-   **مهمتك هي تحليل كل البيانات المتاحة، سواء من الصورة أو النص.**
-   **في حال وجود صورة،** أعطها الأولوية لاستخراج الأدوية والتشخيصات المكتوبة بخط اليد.
-   **استخدم دائمًا البيانات النصية** لتكملة المعلومات (مثل العمر والتاريخ المرضي) وللمقارنة مع الصورة.
-   **في حال عدم وجود صورة،** فإن **البيانات النصية هي المصدر الوحيد للحقيقة**، ويجب أن تبني تحليلك الكامل عليها.
-   قم بإجراء التحليل العميق بناءً على "قائمة التحقيق في الأخطاء الحرجة".

**الخطوة 2: إنشاء التقرير النهائي (HTML فقط)**
-   يجب أن يكون مخرجك بالكامل عبارة عن كتلة كود HTML واحدة.
-   **الهيكل:**
    1.  **عنوان التقرير:** <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
    2.  **ملخص الحالة:** يتضمن البيانات الأساسية وأي ملاحظات حرجة.
    3.  **التحليل السريري العميق:** لكل اكتشاف رئيسي من قائمة التحقيق، اكتب فقرة تحليلية مفصلة وواضحة.
    4.  **جدول الأدوية والإجراءات:** أنشئ جدولاً بهذه الأعمدة بالضبط: "الدواء/الإجراء", "الجرعة - تفصيل الإجراء", "الغرض الطبي المرجح", "Drug-Drug Interaction", "الوضع التأميني".
    5.  **فرص تحسين الرعاية:** قائمة نقطية مفصلة بالفحوصات الناقصة.
    6.  **خطة العمل:** قائمة مرقمة وواضحة بأولويات التصحيح الفوري.
    7.  **المراجع العلمية:** اذكر بعض المصادر الموثوقة.
    8.  **الخاتمة الإلزامية:** "هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص."
`;

// -- الدالة المحدثة التي تقرأ كل البيانات النصية --
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
