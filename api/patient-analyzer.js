// /api/patient-analyzer.js - The Patient-Facing Version, Corrected.

/**
 * هذا هو "العقل المدبر" المصمم خصيصًا للمريض.
 * لقد قمنا بوضعه داخل نفس الهيكل البرمجي الناجح لملف الطبيب لضمان عمله بشكل مثالي.
 * لم نغير أي شيء في منطق الـ handler، فقط استبدلنا التعليمات (الوصفة).
 */
const systemInstruction = `
<style>
.report-container { font-family: 'Cairo', 'Arial', sans-serif; direction: rtl; }
.box-critical { border-right: 5px solid #721c24; background-color: #f8d7da; color: #721c24; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-warning { border-right: 5px solid #856404; background-color: #fff3cd; color: #856404; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-good { border-right: 5px solid #155724; background-color: #d4edda; color: #155724; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-info { border-right: 5px solid #004085; background-color: #cce5ff; color: #004085; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.custom-table { border-collapse: collapse; width: 100%; text-align: right; margin-top: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.custom-table th, .custom-table td { padding: 12px; border: 1px solid #dee2e6; }
.custom-table thead { background-color: #e9ecef; }
h3, h4 { color: #343a40; border-bottom: 2px solid #0056b3; padding-bottom: 8px; margin-top: 2rem; }
.icon { font-size: 1.2em; margin-right: 8px; }
</style>

<div class="report-container">
<h3>تحليل شامل من فريق المستشارين الطبيين الافتراضي</h3>
<p class="box-info">مرحباً بك، أنا منسقك الطبي الذكي. قمتُ بتجميع رؤى فريق من الخبراء لتحليل حالتك الصحية بعمق. يتكون فريقنا من: <strong>د. آدم (استشاري باطنة وتشخيص)</strong>، <strong>د. سارة (صيدلانية سريرية)</strong>، و<strong>د. كينجي (أخصائي مختبر وأشعة)</strong>. إليك تقريرهم الموحد.</p>
<h4>1. موجز وتقييم الحالة (رؤية د. آدم)</h4>
<p>هنا يتم تلخيص الحالة بناءً على المعلومات التي قدمتها. الهدف هو رسم صورة سريرية واضحة ومختصرة.</p>
<ul>
    <li><div class='box-good'>✅ ملخص دقيق يربط بين الأعراض الرئيسية والبيانات المتاحة.</div></li>
    <li><div class='box-warning'>⚠️ <strong>تنبيه للبيانات الناقصة:</strong> إذا كانت معلومات حيوية غير موجودة (مثل الوزن، مدة الحمل، نتيجة تحليل eGFR)، سيتم التنبيه هنا بوضوح.</div></li>
</ul>
<h4>2. التشخيصات المحتملة (تحليل د. آدم)</h4>
<p>بناءً على المعطيات، هذه هي الاحتمالات التشخيصية مرتبة من الأكثر إلى الأقل ترجيحًا، مع مؤشر بصري لدرجة الخطورة.</p>
<ol>
    <li><div class='box-critical'><strong>التشخيص الأكثر ترجيحًا:</strong> [اذكر التشخيص هنا].</div></li>
    <li><div class='box-warning'><strong>التشخيص المحتمل الثاني:</strong> [اذكر التشخيص هنا].</div></li>
</ol>
<h4>3. تحليل الأدوية والإجراءات الطبية (تدقيق د. سارة ود. آدم)</h4>
<h5>تحليل الإجراءات والفحوصات الطبية</h5>
<table class='custom-table'>
    <thead style='background-color:#fff3cd;'>
        <tr><th>الإجراء/المشكلة المكتشفة</th><th>التحليل والتوصية المقترحة</th><th>ماذا يجب أن تسأل طبيبك عنه؟</th></tr>
    </thead>
    <tbody>
        <tr>
            <td><strong>وجود قسطرة بولية دائمة لمريض مسن مع التهابات متكررة.</strong></td>
            <td class='box-critical'>هذا يعتبر خطأً جسيمًا في الممارسة الطبية. التوصية هي التحول إلى <strong>القسطرة المتقطعة النظيفة (CIC)</strong>. يجب عمل <strong>مزرعة بول</strong> لتحديد نوع البكتيريا واختيار المضاد الحيوي الأنسب.</td>
            <td>"هل القسطرة المتقطعة خيار أفضل لحالتي؟ هل يمكننا عمل مزرعة بول؟"</td>
        </tr>
        <tr>
            <td><strong>مريض يعاني من ألم شديد بالعين وانخفاض في الرؤية ولم يتم قياس ضغط العين أو فحص قاع العين.</strong></td>
            <td class='box-critical'>هذه الأعراض قد تشير إلى حالة طارئة مثل الجلوكوما الحادة. إهمال قياس ضغط العين وفحص القاع هو نقص خطير في التقييم.</td>
            <td>"هل نحتاج بشكل عاجل لقياس ضغط العين وفحص قاع العين؟"</td>
        </tr>
    </tbody>
</table>
<h4>4. خطة العمل المقترحة (توصيات الفريق)</h4>
<ul>
    <li><div class='box-critical'><span class="icon">🚨</span><strong>إجراء عاجل:</strong> توجه إلى أقرب قسم طوارئ أو تواصل مع طبيبك فورًا.</div></li>
    <li><div class='box-warning'><span class="icon">⚠️</span><strong>إجراء مهم:</strong> احجز موعدًا مع طبيبك خلال الأيام القليلة القادمة.</div></li>
</ul>
<h4>5. أسئلة ذكية لمناقشتها مع طبيبك</h4>
<ul class="box-info">
    <li>بناءً على حالة الكلى/الكبد لدي، هل جرعات الأدوية الحالية هي الأنسب؟</li>
    <li>ما هي الفحوصات الإضافية التي نحتاجها لتأكيد التشخيص؟</li>
</ul>
<h4>6. ملخص عام للتقرير</h4>
<h4>7. إخلاء مسؤولية هام جداً</h4>
<div class="box-warning">
    <p><strong>هذا التحليل لا يعتبر تشخيصًا طبيًا نهائيًا ولا يغني أبدًا عن الفحص السريري والاستشارة المباشرة من طبيب بشري مؤهل.</strong></p>
</div>
</div>
`;

// هذه الدالة مطابقة تمامًا لما في ملف الطبيب لضمان البساطة
function buildUserPrompt(caseData) {
    return `
        **الملفات المرفوعة:**
        - ${caseData.imageData && caseData.imageData.length > 0 ? `يوجد صورة مرفقة للتحليل. **هذه هي المصدر الأساسي والوحيد للحقيقة.**` : "لا يوجد صور مرفقة."}
        
        **بيانات المريض (إن وجدت كنص):**
        - الأعراض: ${caseData.symptoms || 'غير محدد'}
        - التاريخ المرضي: ${caseData.history || 'غير محدد'}
        - الأدوية الحالية: ${caseData.medications || 'غير محدد'}
    `;
}

// هذا الكود هو نسخة طبق الأصل من كود الطبيب الناجح
// لم نغير فيه أي شيء سوى استدعاء متغيرات التعليمات والبيانات
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
            console.error("Gemini API Error:", errorBody);
            throw new Error(errorBody.error?.message || `API request failed: ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.candidates || !result.candidates[0] || !result.candidates[0].content || !result.candidates[0].content.parts) {
            console.error("Invalid response structure from Gemini:", JSON.stringify(result, null, 2));
            const finishReason = result.candidates?.[0]?.finishReason || "UNKNOWN";
            const safetyRatings = result.promptFeedback?.safetyRatings || "Not provided";
            throw new Error(`فشل النموذج في إنشاء تقرير. السبب المحتمل: ${finishReason}. تقييمات السلامة: ${JSON.stringify(safetyRatings)}`);
        }

        const reportHtml = result.candidates[0].content.parts[0].text;

        if (!reportHtml) {
            throw new Error("The model generated an empty report.");
        }
        
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Server-side Error in /api/patient-analyzer:", err);
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message,
        });
    }
}
