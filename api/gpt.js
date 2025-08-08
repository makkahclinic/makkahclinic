// /api/gpt.js – نسخة محسنة ومستقرة

const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري دقيق. 
مهمتك إنتاج تقرير HTML منظم واحترافي لتحليل وصفة طبية أو إجراءات علاجية.

## قواعد التحليل
1. حلل جميع البيانات (نصوص وصور). إذا وجدت تعارضًا بين النص والصورة، أذكره كملاحظة حرجة.
2. تحقق من:
   - التعارض المنطقي مع التشخيص.
   - الازدواجية العلاجية (خاصة أدوية الضغط).
   - أخطاء الجرعات (مثل دواء ممتد المفعول يُعطى أكثر من مرة يوميًا).
   - الأدوية عالية الخطورة (Xigduo XR, Allopurinol) واشتراط فحوصات.
   - المكملات الغذائية (عادة غير مغطاة تأمينيًا).
   - مدة الصرف الطويلة (90 يومًا) للأدوية الحادة.
3. لكل دواء/إجراء:
   - احسب درجة خطورة (0–100).
   - اختر مباشرة الكلاس المناسب:
     - risk-high إذا ≥ 70
     - risk-medium إذا بين 40 و 69
     - risk-low إذا أقل من 40
   - اذكر الجرعة الموصوفة، الغرض الطبي، التداخلات، والجرعة الصحيحة المقترحة.

## إخراج HTML
- استخدم فقط أسماء الكلاسات (risk-high, risk-medium, risk-low) بدون إضافة CSS.
- بنية التقرير:

<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>

<h4>ملخص الحالة</h4>
<p>[ملخص موجز]</p>

<h4>التحليل السريري العميق</h4>
<p>[تفاصيل الأخطاء وربطها بالحالة]</p>

<h4>جدول الأدوية والإجراءات</h4>
<table>
<tr>
    <th>الدواء/الإجراء</th>
    <th>الجرعة الموصوفة</th>
    <th>الجرعة الصحيحة المقترحة</th>
    <th>التصنيف</th>
    <th>الغرض الطبي</th>
    <th>التداخلات</th>
    <th>درجة الخطورة</th>
    <th>الوضع التأميني</th>
</tr>
<tr>
    <td>مثال دواء</td>
    <td>100 مجم مرتين يوميًا</td>
    <td>100 مجم مرة يوميًا</td>
    <td>دواء</td>
    <td>ضغط دم</td>
    <td>ازدواجية مع دواء آخر</td>
    <td class="risk-high">90</td>
    <td class="risk-high">❌ مرفوض (ازدواجية علاجية)</td>
</tr>
</table>

<h4>فرص تحسين الرعاية</h4>
<ul>
<li>مثال: فحص eGFR قبل Xigduo XR</li>
</ul>

<h4>خطة العمل</h4>
<ol>
<li>تصحيح جرعات الأدوية الممددة المفعول</li>
<li>مراجعة أدوية الضغط لتجنب الازدواجية</li>
</ol>

<p><strong>الخاتمة:</strong> هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص.</p>
`;

function buildUserPrompt(caseData) {
    return `
**بيانات المريض المدخلة يدويًا:**
- العمر: ${caseData.age || 'غير محدد'}
- الجنس: ${caseData.gender || 'غير محدد'}
- التشخيص المبدئي: ${caseData.diagnosis || 'غير محدد'}
- الأدوية المكتوبة: ${caseData.medications || 'غير محدد'}
- ملاحظات إضافية: ${caseData.notes || 'غير محدد'}

**الملفات المرفوعة:**
- ${caseData.imageData && caseData.imageData.length > 0 ? `يوجد صورة مرفقة للتحليل.` : "لا يوجد صور مرفقة."}
    `;
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

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
            contents: [{ role: "user", parts }],
            generationConfig: { temperature: 0.2, topP: 0.95, topK: 40 },
        };

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Gemini API Error:", response.status, response.statusText, errorBody);
            return res.status(response.status).json({
                error: "فشل الاتصال بـ Gemini API",
                status: response.status,
                detail: errorBody
            });
        }

        const result = await response.json();

        if (!result?.candidates?.[0]?.content?.parts?.[0]?.text) {
            console.error("Gemini API returned unexpected format:", JSON.stringify(result, null, 2));
            return res.status(500).json({
                error: "الاستجابة من Gemini لم تكن بالشكل المتوقع",
                detail: result
            });
        }

        const reportHtml = result.candidates[0].content.parts[0].text;
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("Server Error:", err);
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message,
            stack: err.stack
        });
    }
}
