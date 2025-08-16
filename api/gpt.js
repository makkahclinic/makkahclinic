// pages/api/gpt.js
// الإصدار النهائي: يعتمد على فصل المحتوى (من Gemini) عن التصميم (قالب ثابت)
// لضمان تنسيق مثالي في كل مرة.

import { createHash } from "crypto";

// ... (كل دوال المساعدة مثل fetchWithRetry, ocrWithOpenAI, etc. تبقى كما هي) ...

// =============== القالب النهائي للتقرير (The Final HTML Template) ===============
// هذا هو التصميم الثابت. Gemini سيقوم فقط بملء الفراغات التي تبدأ بـ const finalReportTemplate = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.65; padding: 12px; background-color: #f9fafb; color: #111827; }
        .report-container { max-width: 900px; margin: auto; background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); }
        h3, h4, h5 { color: #1e3a8a; border-bottom: 2px solid #e0e7ff; padding-bottom: 8px; margin-top: 24px; }
        h3 { font-size: 1.5rem; }
        h4 { font-size: 1.25rem; }
        h5 { font-size: 1.1rem; color: #1e40af; border-bottom: 1px solid #e5e7eb; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 0.9rem; }
        th, td { border: 1px solid #e5e7eb; padding: 10px; text-align: start; vertical-align: top; }
        thead th { background-color: #f3f4f6; color: #1f2937; font-weight: 600; }
        tbody tr:nth-child(even) { background-color: #f9fafb; }
        .status-green, .status-yellow, .status-red { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 0.8rem; border: 1px solid; }
        .status-green { background-color: #dcfce7; color: #166534; border-color: #a7f3d0; }
        .status-yellow { background-color: #fefce8; color: #854d0e; border-color: #fde68a; }
        .status-red { background-color: #fee2e2; color: #991b1b; border-color: #fca5a5; }
        .section { margin-top: 20px; padding-left: 15px; border-left: 4px solid #4f46e5; }
        ul { list-style-type: disc; padding-right: 20px; }
        li { margin-bottom: 8px; }
        .conclusion { margin-top: 32px; padding: 16px; background-color: #eef2ff; border-top: 3px solid #4f46e5; border-radius: 4px; }
        .disclaimer { margin-top: 16px; font-size: 0.8rem; color: #6b7280; text-align: center; }
    </style>
</head>
<body>
    <div class="report-container">
        <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>

        <h4>ملخص الحالة</h4>
        <p></p>

        <h4>تحليل الملفات المرفوعة</h4>
        <p></p>

        <h4>التحليل السريري العميق</h4>
        <p></p>

        <h4>جدول الأدوية والإجراءات</h4>
        <table>
            <thead>
                <tr>
                    <th>بند الخدمة</th>
                    <th>التصنيف</th>
                    <th>الغرض الطبي</th>
                    <th>قرار التأمين</th>
                </tr>
            </thead>
            <tbody>
                </tbody>
        </table>

        <div class="section">
            <h4 class="section-title">التحليل التفصيلي والتوصيات</h4>
            
            <h5>1. خدمات طبية ضرورية ومقبولة تأمينياً</h5>
            <p></p>

            <h5>2. تعديلات دوائية حرجة</h5>
            <p></p>

            <h5>3. تحاليل مخبرية ضرورية</h5>
            <p></p>

            <h5>4. متابعة وفحوصات دورية</h5>
            <p></p>
        </div>

        <div class="conclusion">
            <h5>5. الخاتمة والتوصيات النهائية</h5>
            <p></p>
        </div>
        
        <p class="disclaimer">هذا التقرير لا يغني عن المراجعة السريرية المباشرة، ويُستخدم لأغراض التدقيق الطبي والتأميني فقط.</p>
    </div>
</body>
</html>
`;

// =============== الأمر الرئيسي (System Prompt) - نسخة ملء الفراغات ===============
const systemInstruction = `
أنت خبير تدقيق طبي مهمتك هي استخراج وتحليل المعلومات الطبية وتقديمها كمحتوى نصي خام.
مخرجك **يجب أن يكون نصاً فقط**، مقسماً إلى أقسام واضحة باستخدام الفاصل \`|||---|||\`.
لا تقم بإنشاء أي كود HTML إطلاقاً.

---
**القسم 1: CASE_SUMMARY**
اكتب ملخصاً موجزاً لحالة المريض.
|||---|||
**القسم 2: FILES_ANALYSIS**
اكتب تحليلاً موجزاً للملفات المرفوعة.
|||---|||
**القسم 3: CLINICAL_ANALYSIS**
اكتب تحليلاً سريرياً أعمق قليلاً للحالة.
|||---|||
**القسم 4: TABLE_ROWS**
هذه أهم مهمة: استخرج **كل بند خدمة** من الملفات. لكل بند، قم بإنشاء صف واحد بصيغة HTML \`<tr>...</tr>\`.
يجب أن يحتوي كل صف على 4 خلايا \`<td>\` بالترتيب التالي:
1.  اسم الخدمة (Service Name).
2.  تصنيف الخدمة (Category: e.g., تحليل دم, دواء وريدي, إحالة).
3.  الغرض الطبي (Medical Purpose).
4.  قرار التأمين (Insurance Decision): استخدم التنسيق الملون الدقيق (\`<span class='status-...'</span>\`) مع ذكر السبب للحالات الصفراء والحمراء.
مثال لصف واحد:
\`<tr><td>Creatinine</td><td>تحليل دم</td><td>تقييم وظائف الكلى</td><td><span class='status-green'>✅ مقبول</span></td></tr>\`
|||---|||
**القسم 5: ANALYSIS_SECTION_1**
اكتب محتوى فقرة "خدمات طبية ضرورية ومقبولة تأمينياً". برر الفحوصات الأساسية واستشهد بإرشادات (ADA, ESH).
|||---|||
**القسم 6: ANALYSIS_SECTION_2**
اكتب محتوى فقرة "تعديلات دوائية حرجة". انتقد استخدام الأدوية الوريدية وقدم توصية واضحة.
|||---|||
**الsection 7: ANALYSIS_SECTION_3**
اكتب محتوى فقرة "تحاليل مخبرية ضرورية". اشرح القيمة السريرية لأهم تحليلين.
|||---|||
**القسم 8: ANALYSIS_SECTION_4**
اكتب محتوى فقرة "متابعة وفحوصات دورية". اشرح أهمية المتابعة.
|||---|||
**القسم 9: CONCLUSION_SUMMARY**
اكتب ملخصاً إدارياً نهائياً للنتائج والتوصيات.
`;

// =============== API HANDLER (المنطق الجديد) ===============
export default async function handler(req, res) {
    // ... (منطق التحقق من الطلب، استدعاء OCR، تجهيز الملفات يبقى كما هو) ...
    try {
        // ...
        // الخطوة 1: استدعاء Gemini للحصول على المحتوى النصي الخام
        const rawContent = await geminiGenerate(geminiKey, parts); // geminiGenerate الآن تستخدم الأمر الجديد

        // الخطوة 2: فصل المحتوى إلى أقسام بناءً على الفاصل
        const contentSections = rawContent.split('|||---|||').map(s => s.trim());
        
        const placeholders = {
            '': contentSections[0] || '',
            '': contentSections[1] || '',
            '': contentSections[2] || '',
            '': contentSections[3] || '',
            '': contentSections[4] || '',
            '': contentSections[5] || '',
            '': contentSections[6] || '',
            '': contentSections[7] || '',
            '': contentSections[8] || '',
        };

        // الخطوة 3: تركيب التقرير النهائي بملء القالب
        let finalHtmlReport = finalReportTemplate;
        for (const placeholder in placeholders) {
            finalHtmlReport = finalHtmlReport.replace(placeholder, placeholders[placeholder]);
        }

        // إرجاع التقرير النهائي ذو التنسيق المثالي
        return res.status(200).json({
            ok: true,
            at: nowIso(),
            htmlReport: finalHtmlReport,
            // ... (meta data)
        });

    } catch (err) {
        // ... (معالجة الأخطاء)
    }
}
