// /api/gpt.js - FINAL VERSION WITH ENFORCED VISUAL STYLES

const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري. مهمتك هي إنتاج تقرير HTML منظم بدقة لتحليل الحالات الطبية.

**قواعد التحليل الإلزامية:**
1.  **تحليل كل البيانات:** استخدم النص والصور المتاحة. إذا لم توجد صورة، فالنص هو الحقيقة الوحيدة.
2.  **التدقيق الدوائي الصارم:** لكل دواء، تحقق بصرامة من: التعارض المنطقي (الجنس، الحمل)، الازدواجية العلاجية، أخطاء الجرعة (خاصة أدوية MR)، ومراقبة الأدوية عالية الخطورة (Xigduo, Allopurinol).
3.  **تدقيق التأمين:** حدد المكملات الغذائية كغير مغطاة. لاحظ مدة الصرف الطويلة (90 يومًا).

**الهيكل الإلزامي للتقرير (HTML فقط):**
1.  **العنوان:** <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
2.  **ملخص الحالة:** لخص البيانات الأساسية والملاحظات الحرجة.
3.  **التحليل السريري العميق:** فقرات تشرح الأخطاء الرئيسية المكتشفة.
4.  **جدول الأدوية:** يجب أن يحتوي على الأعمدة التالية: "الدواء/الإجراء", "الجرعة", "الغرض الطبي", "التداخلات", "الوضع التأميني".
    -   **عمود "الوضع التأميني":** هذا العمود حاسم. **يجب** أن يكون المحتوى عنصر \`<span>\` بالفئة اللونية المناسبة ونص واضح للسبب.
        -   استخدم \`<span class="risk-high">❌ مرفوض (اذكر السبب)</span>\`
        -   استخدم \`<span class="risk-medium">⚠️ قابل للرفض (اذكر السبب)</span>\`
        -   استخدم \`<span class="risk-low">✅ مقبول</span>\`
        -   **يجب ذكر سبب الرفض بوضوح** (مثال: جرعة خاطئة، ازدواجية علاجية، يتطلب فحص eGFR).
5.  **فرص تحسين الرعاية:** قائمة نقطية بالفحوصات الناقصة.
6.  **خطة العمل:** قائمة مرقمة بالتصحيحات الفورية.
7.  **الخاتمة:** "هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية."
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
