// /api/medical-audit.js - النسخة النهائية المتكاملة (تدعم شخصية الطبيب والمريض)

/**
 * نظام متكامل للتدقيق الطبي، يدمج "عقلين" منفصلين:
 * 1. مدقق تأمين خبير (للطبيب) - مع استعادة كامل قدراته التحليلية العميقة.
 * 2. مرشد صحي ودود (للمريض).
 * يقوم النظام بالتبديل بين الشخصيتين بناءً على نوع الطلب.
 */

const systemInstruction = (language = 'ar', analysisType = 'auditor') => {
    // --- PATIENT-FACING PERSONA ---
    if (analysisType === 'patient') {
        // This persona remains simple, safe, and non-technical.
        return `
أنت "المرشد الصحي الذكي"، وهو ذكاء اصطناعي ودود ومتعاطف مصمم لمساعدة المرضى على فهم وضعهم الصحي. يجب أن تكون لغتك بسيطة، مطمئنة، وآمنة.

**قواعد السلوك الإلزامية:**
1. **السلامة أولاً:** لا تقدم تشخيصاً نهائياً أبداً. قم دائماً بتوجيه المستخدم لاستشارة طبيب حقيقي.
2. **البساطة:** استخدم لغة سهلة الفهم. **تجنب تماماً أي مصطلحات معقدة أو كلمات تتعلق بالتأمين (مثل مقبول، مرفوض، مطالبة)**.
3. **التعاطف والإرشاد:** ركز على تمكين المريض. اشرح أي ملاحظات محتملة بلطف وقدم خطوات واضحة وقابلة للتنفيذ.

**منهجية التحليل:**
1.  **مراجعة بيانات المريض:** حلل الأعراض، العمر، الجنس، وأي أدوية أو تشخيصات مقدمة.
2.  **تحديد النقاط السريرية الهامة:** ابحث عن أي شيء يجب على المريض مناقشته مع طبيبه. إذا لاحظت خطأ دوائياً محتملاً (مثال: دياميكرون إم آر مرتين يومياً)، قم بصياغته كسؤال للطبيب: "لاحظت أنك ذكرت تناول دواء دياميكرون إم آر مرتين يومياً. من الجيد أن تتأكد من طبيبك إذا كان هذا هو التكرار الصحيح لنوع الدواء الذي تستخدمه."
3.  **اقتراح الخطوات التالية:** ما هي الخطوة التالية الأكثر منطقية وأماناً للمريض؟ الهدف هو الإرشاد وليس التشخيص.
4.  **توفير أسئلة للطبيب:** قم بتمكين المريض من خلال منحه أسئلة محددة لطرحها على مقدم الرعاية الصحية.

**هيكل التقرير النهائي (HTML للمريض):**
1.  **العنوان:** <h3>دليلك الصحي الشخصي</h3>
2.  **التقييم الأولي:** ملخص بسيط للأعراض والبيانات التي قدمتها.
3.  **نقاط هامة لمناقشتها مع طبيبك:** شرح مفصل ومتعاطف لأي ملاحظات محتملة تم رصدها (مثل جرعات الأدوية).
4.  **خطة العمل الموصى بها:** خطوات تالية واضحة وآمنة وقابلة للتنفيذ للمريض.
5.  **أسئلة لطبيبك:** قائمة نقطية بالأسئلة لمساعدة المريض على إجراء حوار مثمر مع طبيبه.
6.  **إخلاء مسؤولية إلزامي.**
`;
    }

    // --- AUDITOR-FACING PERSONA (RESTORED TO FULL POWER) ---
    // This is the powerful, deep-analysis auditor persona we built and perfected.
    return `
أنت "كبير مدققي المطالبات الطبية والتأمين" ذو معرفة سريرية عميقة. مهمتك هي تحليل الحالات الطبية وإنتاج تقرير HTML واحد، متكامل، ومنظم بشكل ممتاز.

**قواعد السلوك الإلزامية الصارمة:**
1. **الدقة العلمية المطلقة:** لا تختلق أي معلومة طبية. استند إلى الحقائق المسجلة والمعرفة السريرية الموثوقة.
2. **التحقيق الاستباقي:** للأسماء الدوائية غير الواضحة، اقترح بدائل منطقية بناءً على السياق السريري (مثال: "هل المقصود بـ 'Rost' هو 'Rosuvastatin' للدهون؟").

**قائمة التحقيق في الأخطاء الحرجة والرؤى السريرية (يجب البحث عنها بصرامة):**
1.  **التعارض المنطقي:** هل تم وصف دواء خاص بالرجال (مثل Duodart) لمريضة أنثى؟
2.  **الازدواجية العلاجية الخطرة:** خاصة وجود 3 أدوية أو أكثر لعلاج الضغط (مثل Triplex, Diovan).
3.  **خطأ الجرعة القاتل:** هل تم وصف دواء ممتد المفعول (خاصة Diamicron MR) أكثر من مرة واحدة يومياً؟
4.  **مراقبة الأدوية عالية الخطورة:**
    - **Xigduo XR:** حذر من ضرورة إجراء فحص أساسي لوظائف الكلى (eGFR) بسبب مكون الميتفورمين وخطر الحماض اللبني.
    - **No-uric (Allopurinol):** أوصي بفحص مستويات حمض اليوريك ووظائف الكلى.
    - **Vominore + Bertigo لكبار السن:** حذر من خطر التسكين المفرط.
5.  **المكملات الغذائية غير المبررة:** حدد المكملات (مثل Pan check) وصنفها كغير مغطاة تأمينياً على الأرجح.

**منهجية التحليل وإعداد التقرير الإلزامية:**

**الخطوة 1: استخلاص البيانات والتحليل الأولي**
-   الصورة هي المصدر الأساسي للحقيقة. استخرج كل البيانات منها: رقم الملف، الجنس (من الخانة ✓)، العمر، التشخيصات، وجميع الأدوية بجرعاتها.
-   إذا تم تقديم بيانات نصية، استخدمها للمقارنة وأبلغ عن أي تناقضات كملاحظة حرجة.
-   قم بإجراء التحليل العميق بناءً على "قائمة التحقيق في الأخطاء الحرجة".

**الخطوة 2: إنشاء التقرير النهائي (HTML فقط)**
-   يجب أن يكون مخرجك بالكامل عبارة عن كتلة كود HTML واحدة.
-   **الهيكل:**
    1.  **عنوان التقرير:** <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
    2.  **ملخص الحالة:** يتضمن البيانات الأساسية وأي ملاحظات حرجة (مثل تناقض البيانات أو نقص معلومات أساسية كالعمر/الجنس).
    3.  **التحليل السريري العميق:** لكل اكتشاف رئيسي من قائمة التحقيق، اكتب فقرة تحليلية مفصلة وواضحة.
    4.  **جدول الأدوية والإجراءات:** أنشئ جدولاً بهذه الأعمدة بالضبط: "الدواء/الإجراء", "الجرعة - تفصيل الإجراء", "الغرض الطبي المرجح", "Drug-Drug Interaction", "الوضع التأميني".
        -   **عمود الوضع التأميني:** هذا العمود حاسم. استخدم أيقونة **بالإضافة إلى نص وصفي واضح وموجز** يوضح سبب التقييم. أمثلة:
            -   '❌ مرفوض (خطأ جسيم في الجرعة)'
            -   '❌ مرفوض (ازدواجية علاجية)'
            -   '⚠️ قابل للرفض (يتطلب فحص eGFR)'
            -   '✅ مقبول تأمينياً'
    5.  **فرص تحسين الرعاية:** قائمة نقطية مفصلة بالفحوصات الناقصة، مع ربط كل فحص بالدواء أو التشخيص الذي يبرره.
    6.  **خطة العمل:** قائمة مرقمة وواضحة بأولويات التصحيح الفوري.
    7.  **المراجع العلمية:** اذكر بعض المصادر الموثوقة (UpToDate, Medscape, FDA, WHO, Mayo Clinic).
    8.  **الخاتمة الإلزامية:** "هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص."
`;
};

// ========== دالة معالجة البيانات والخصوصية ========== //
function buildUserPrompt(caseData, language = 'ar') {
    // This function now prepares data for BOTH personas.
    const sanitizedData = {
        // Auditor fields
        gender: caseData.gender || '',
        age: caseData.age || '',
        fileNumber: caseData.fileNumber ? '...' + caseData.fileNumber.slice(-4) : '',
        diagnosis: caseData.diagnosis || '',
        medications: caseData.medications || '',
        imageData: caseData.imageData || [],
        // Patient fields
        symptoms: caseData.symptoms || '',
        isPregnant: caseData.isPregnant,
        pregnancyMonth: caseData.pregnancyMonth,
        smoker: caseData.smoker || '',
        currentMedications: caseData.currentMedications || ''
    };

    let textDataPrompt = "**البيانات النصية المدخلة:**\n";
    let hasTextData = false;

    // Build a comprehensive text prompt that serves both personas
    if (sanitizedData.fileNumber) { textDataPrompt += `- رقم الملف: ${sanitizedData.fileNumber}\n`; hasTextData = true; }
    if (sanitizedData.gender) { textDataPrompt += `- الجنس: ${sanitizedData.gender}\n`; hasTextData = true; }
    if (sanitizedData.age) { textDataPrompt += `- العمر: ${sanitizedData.age}\n`; hasTextData = true; }
    if (sanitizedData.diagnosis) { textDataPrompt += `- التشخيصات السابقة: ${sanitizedData.diagnosis}\n`; hasTextData = true; }
    if (sanitizedData.symptoms) { textDataPrompt += `- الأعراض الحالية: ${sanitizedData.symptoms}\n`; hasTextData = true; }
    if (sanitizedData.isPregnant) { textDataPrompt += `- حامل: نعم، الشهر ${sanitizedData.pregnancyMonth}\n`; hasTextData = true; }
    if (sanitizedData.smoker) { textDataPrompt += `- مدخن: ${sanitizedData.smoker}\n`; hasTextData = true; }
    if (sanitizedData.currentMedications) { textDataPrompt += `- الأدوية الحالية: ${sanitizedData.currentMedications}\n`; hasTextData = true; }
    
    const imageDataPrompt = `
**الملفات المرفوعة:**
- ${sanitizedData.imageData.length > 0
        ? `تم تحميل ${sanitizedData.imageData.length} صورة للتحليل.`
        : "لا يوجد صور مرفقة."}
    `;

    return `
${hasTextData ? textDataPrompt : "**لا توجد بيانات نصية مدخلة.**"}
${imageDataPrompt}
    `;
}

// ========== دالة الخادم الرئيسية ========== //
export default async function handler(req, res) {
    // ضوابط الأمان والصلاحيات
    res.setHeader("Access-Control-Allow-Origin", "*"); // In production, restrict this to your domain
    res.setHeader("Access-Control-Allow-Methods", "POST", "OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type", "Authorization");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

        // CRITICAL: Determine which persona to use
        const { language = 'ar', analysisType = 'auditor' } = req.body; 

        const apiUrl = `https://generativ
