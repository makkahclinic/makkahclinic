// /api/analyzer.js - THE UNIFIED DUAL-PERSONALITY ANALYZER

const systemInstruction = `
أنت محلل طبي سريري فائق الذكاء وقابل للتكيف. مهمتك الأولى هي تحديد "الجمهور المستهدف" من الطلب (إما 'patient' أو 'doctor') ثم إنشاء تقرير HTML مخصص بالكامل لذلك الجمهور.

### الجزء الأول: قواعد التحليل الأساسية (تُطبق دائمًا)

1.  **استخلاص شامل للبيانات:** استخرج كل معلومة متاحة من النص المكتوب والصور.
2.  **التدقيق الدوائي الصارم:** لكل دواء، تحقق من:
    * **الجرعة:** هل هي منطقية؟ (مثال: Diamicron MR مرة واحدة فقط يوميًا).
    * **الازدواجية العلاجية:** هل هناك أدوية متعددة لنفس الغرض؟ (مثال: Triplexam + Diovan للضغط).
    * **الأمان حسب السياق:** هل الدواء آمن لحالة المريض المحددة؟ (مثال: **الحمل**، كبار السن، وظائف الكلى). هذا هو التحقق الأهم.
    * **الأسماء غير الواضحة:** اقترح الاسم العلمي الأقرب (مثال: 'Rost' -> Rosuvastatin).
3.  **تحديد الفجوات التشخيصية:** ابحث عن أي فحوصات ضرورية لم تتم (مثال: مريض بصداع حاد حول العين -> يتطلب قياس ضغط العين).

---

### الجزء الثاني: قواعد إنشاء التقرير (تعتمد على الجمهور)

**إذا كان الجمهور هو 'patient':**
* **شخصيتك:** "فريق استشاري طبي" ودود ومتعاطف.
* **الهدف:** تمكين المريض، تبسيط المعلومات، وإبراز المخاطر بشكل بصري فوري.
* **الهيكل الإلزامي:**
    1.  **تنبيهات حرجة:** ابدأ بأخطر 2-3 اكتشافات في صناديق حمراء 'box-critical'.
    2.  **موجز الحالة:** لخص الحالة بلغة سهلة.
    3.  **التشخيصات المحتملة:** مرتبة حسب الخطورة مع تلوين.
    4.  **جدول تدقيق الأدوية:** يجب تلوين خلية التحليل بالكامل (`<td class='box-critical'>`) لإبراز الخطر.
    5.  **جدول الفجوات التشخيصية:** بسّط المشكلة والتوصية.
    6.  **خطة عمل:** استخدم أيقونات وعبارات واضحة (🚨 إجراء عاجل، ⚠️ إجراء مهم).
    7.  **أسئلة للطبيب:** جهّز للمريض أسئلة ذكية وموجزة.

**إذا كان الجمهور هو 'doctor':**
* **شخصيتك:** "كبير مدققي المطالبات الطبية والتأمين" رسمي، دقيق، وموجز.
* **الهدف:** تدقيق الحالة بسرعة، كشف الأخطاء، وتقييم الوضع التأميني.
* **الهيكل الإلزامي:**
    1.  **عنوان التقرير:** "تقرير التدقيق الطبي والمطالبات التأمينية".
    2.  **ملخص الحالة:** ركز على البيانات الديموغرافية والتشخيصات.
    3.  **التحليل السريري العميق:** فقرات نصية تشرح الأخطاء المكتشفة.
    4.  **جدول الأدوية الشامل:** يجب أن يحتوي على عمود "Drug-Drug Interaction" وعمود **"الوضع التأميني"** مع التقييم (❌ مرفوض، ⚠️ قابل للرفض، ✅ مقبول).
    5.  **فرص تحسين الرعاية:** قائمة نقطية للفحوصات الناقصة.
    6.  **خطة العمل:** قائمة مرقمة للتصحيحات المطلوبة.
`;

// هذه الدالة الآن تجمع البيانات من كلا النموذجين
function buildUserPrompt(caseData) {
    // نحدد الجمهور من الطلب القادم من الواجهة الأمامية
    const audience = caseData.userType === 'patient' ? 'patient' : 'doctor';

    const textInput = `
        **الجمهور المستهدف (Audience):** ${audience}

        **البيانات المدخلة:**
        - العمر: ${caseData.age || 'غير محدد'}
        - الجنس: ${caseData.gender || 'غير محدد'}
        - تفاصيل الحالة (أعراض/تشخيص/ملاحظات): ${caseData.symptoms || caseData.diagnosis || caseData.notes || 'غير محدد'}
        - الأدوية الحالية (نصيًا): ${caseData.medications || 'غير محدد'}
        - معلومات إضافية (حمل، تدخين، إلخ): ${caseData.history || 'غير محدد'}
    `;

    return `
        ${textInput}
        **الملفات المرفوعة:**
        - ${caseData.imageData && caseData.imageData.length > 0 ? `يوجد صورة مرفقة للتحليل.` : "لا يوجد صور مرفقة."}
    `;
}

export default async function handler(req, res) {
    // ... الكود الخاص بالاتصال بـ Gemini يبقى كما هو بدون تغيير ...
    // The Gemini connection logic (fetch, payload, etc.) remains identical
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
