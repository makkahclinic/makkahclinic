// /api/gpt.js – النسخة العبقرية المطوّرة

const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري فائق الدقة. 
مهمتك إنتاج تقرير HTML منظم، عميق التحليل، وبمستوى بصري احترافي.

## الجزء الأول: قواعد التحليل (إلزامية)
1. حلل النص والصور معًا. إذا تعارضت، أذكر ذلك كملاحظة حرجة.
2. تحقق من:
   - التعارض المنطقي.
   - الازدواجية العلاجية.
   - أخطاء الجرعة.
   - الأدوية عالية الخطورة (Xigduo XR, Allopurinol).
   - الأدوية غير المبررة أو المكملات.
   - مدة الصرف الطويلة.
3. لكل دواء أو إجراء، أعطِ:
   - درجة خطورة (0–100).
   - لون خطورة (أحمر/أصفر/أخضر).
   - تصنيف الإجراء (دواء، مكمل، تدخل جراحي...).
   - الجرعة الصحيحة المقترحة.

## الجزء الثاني: إخراج HTML منسق
- استخدم هذا القالب داخل كتلة HTML واحدة:

<style>
    body { font-family: Arial, sans-serif; direction: rtl; background-color: #f9f9f9; padding: 20px; }
    h3 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin-top: 15px; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: center; }
    th { background-color: #f0f0f0; }
    .risk-high { background-color: #ffcccc; color: #b30000; font-weight: bold; }
    .risk-medium { background-color: #fff5cc; color: #b36b00; font-weight: bold; }
    .risk-low { background-color: #ccffcc; color: #006600; font-weight: bold; }
</style>

<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>

<h4>ملخص الحالة</h4>
<p>[املأ ملخص الحالة هنا]</p>

<h4>التحليل السريري العميق</h4>
<p>[شرح تفصيلي للأخطاء والتداخلات مع ربطها بالحالة المرضية]</p>

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
<li>فحص eGFR قبل Xigduo XR</li>
<li>إيقاف المكملات غير المبررة</li>
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

        const result = await response.json();

        const reportHtml = result?.candidates?.[0]?.content?.parts?.[0]?.text || 
                           "<p>⚠️ لم يتمكن النظام من إنشاء التقرير</p>";

        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message,
        });
    }
}
