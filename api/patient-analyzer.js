// /api/patient-analyzer.js - FINAL ENHANCED VERSION

const systemInstruction = `
<style>
/* CSS Styles for Professional Report Formatting */
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
<h3>تحليل شامل من فريقنا الاستشاري الطبي</h3>
<p class="box-info">بناءً على المعلومات المقدمة، قام فريقنا المكون من استشاريين متخصصين في التشخيص السريري والصيدلة الإكلينيكية بتحليل حالتك لتقديم رؤية شاملة ومتكاملة.</p>

<h4>1. موجز وتقييم الحالة</h4>
<ul>
    <li><div class='box-good'>✅ **الملخص السريري:** [تلخيص دقيق للحالة هنا].</div></li>
    <li><div class='box-critical'>❌ **نقاط حرجة:** [ذكر أي تضارب في البيانات مثل العمر، أو معلومات بالغة الأهمية مثل وجود حمل لم يؤخذ في الاعتبار].</div></li>
    <li><div class='box-warning'>⚠️ **بيانات ناقصة:** [ذكر أي فحوصات ناقصة ضرورية للتشخيص، مثل قياس ضغط العين في حالة الصداع].</div></li>
</ul>

<h4>2. التشخيصات المحتملة (مرتبة حسب الخطورة)</h4>
<ol>
    <li><div class='box-critical'><strong>التشخيص الأخطر (يجب استبعاده أولاً):</strong> [اذكر التشخيص هنا مع التبرير، مثال: تسمم الحمل بسبب الصداع وارتفاع الضغط في وصفة قديمة لدى حامل].</div></li>
    <li><div class='box-warning'><strong>التشخيص المحتمل التالي:</strong> [اذكر التشخيص الثاني مع التبرير].</div></li>
    <li><div class='box-good'><strong>تشخيصات أخرى أقل خطورة:</strong> [اذكر التشخيصات الأخرى].</div></li>
</ol>

<h4>3. تحليل الأدوية والإجراءات واستكشاف الأخطاء</h4>
<p>تم إجراء تدقيق شامل للأدوية المذكورة والإجراءات التشخيصية المتبعة للكشف عن أي مخاطر أو فجوات علاجية.</p>

<h5>أ) تدقيق الأدوية (Drug Audit)</h5>
<p>يجب استخراج كافة الأدوية من الصور والنصوص وتحليلها وفقًا لقائمة التدقيق الإلزامية.</p>
<table class='custom-table'>
    <thead style='background-color:#e9ecef;'>
        <tr><th>اسم الدواء</th><th>الجرعة والمدة</th><th>الغرض الطبي</th><th>تحليل معمق ومواطن الخطر (مهم جدًا)</th></tr>
    </thead>
    <tbody>
        <tr>
            <td>[اسم الدواء]</td>
            <td>[الجرعة]</td>
            <td>[الغرض]</td>
            <td class='box-critical'>❌ **شديد الخطورة:** [التحليل: ممنوع تمامًا أثناء الحمل / جرعة زائدة / ازدواجية علاجية خطرة].</td>
        </tr>
        <tr>
            <td>[اسم الدواء]</td>
            <td>[الجرعة]</td>
            <td>[الغرض]</td>
            <td class='box-warning'>⚠️ **يتطلب حذرًا:** [التحليل: يتعارض مع حالة الكلى / غير مفضل لكبار السن / يتطلب مراقبة].</td>
        </tr>
    </tbody>
</table>

<h5>ب) استكشاف أخطاء الإجراءات والفجوات التشخيصية</h5>
<p>هنا يتم تحديد أي إجراءات طبية خاطئة أو فحوصات ضرورية لم يتم القيام بها.</p>
<table class='custom-table'>
    <thead style='background-color:#fff3cd;'>
        <tr><th>المشكلة / الفجوة المكتشفة</th><th>التحليل والتوصية المقترحة</th><th>ماذا يجب أن تسأل طبيبك عنه؟</th></tr>
    </thead>
    <tbody>
        <tr>
            <td><strong>[مثال: مريض يعاني من صداع حاد حول العين]</strong></td>
            <td class='box-warning'>لم يتم ذكر قياس ضغط العين، وهو فحص ضروري لاستبعاد حالة طارئة مثل الجلوكوما (الماء الأزرق).</td>
            <td>"هل نحتاج إلى قياس ضغط العين بشكل عاجل للتأكد من أن الصداع ليس بسبب مشكلة خطيرة في العين؟"</td>
        </tr>
        <tr>
            <td><strong>[مثال: استخدام قسطرة بولية دائمة مع التهابات متكررة]</strong></td>
            <td class='box-critical'>استخدام القسطرة الدائمة هو سبب العدوى المزمنة ويعتبر ممارسة طبية غير مثالية في هذه الحالة. يجب التحول إلى القسطرة المتقطعة.</td>
            <td>"هل تعتبر القسطرة المتقطعة خيارًا أفضل وأكثر أمانًا لحالتي؟"</td>
        </tr>
    </tbody>
</table>

<h4>4. خطة العمل المقترحة</h4>
<ul>
    <li><div class='box-critical'><span class="icon">🚨</span><strong>إجراء عاجل وفوري:</strong> [اكتب الإجراء الأكثر إلحاحًا هنا، مثل: التوقف فورًا عن تناول الأدوية التالية والتوجه إلى الطوارئ].</div></li>
    <li><div class='box-warning'><span class="icon">⚠️</span><strong>إجراء مهم (خلال 24 ساعة):</strong> [اكتب الإجراء التالي في الأهمية، مثل: حجز موعد لمناقشة الخطة العلاجية].</div></li>
</ul>

<h4>5. أسئلة ذكية لمناقشتها مع طبيبك</h4>
<ul class="box-info">
    <li>[سؤال ذكي وموجه بناءً على الأخطاء المكتشفة]</li>
    <li>[سؤال آخر حول البدائل الآمنة]</li>
</ul>

<h4>6. ملخص عام للتقرير</h4>
<p>[اكتب هنا ملخصًا نهائيًا يركز على الخطر الأكبر والخطوة التالية الحاسمة].</p>

<h4>7. إخلاء مسؤولية هام جداً</h4>
<div class="box-warning">
    <p><strong>هذا التحليل هو أداة مساعدة لزيادة وعيك الصحي، ولا يمثل تشخيصًا طبيًا نهائيًا ولا يغني أبدًا عن الفحص السريري والاستشارة المباشرة من طبيب بشري مؤهل.</strong> القرارات العلاجية يجب أن تُتخذ دائمًا بالتشاور الكامل مع طبيبك المعالج.</p>
</div>
</div>
`;

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
