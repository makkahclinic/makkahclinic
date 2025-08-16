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

// =============== SYSTEM PROMPT (النهائي والمضمون - دمج التصميم مع التعليمات) ===============
const systemInstruction = `
أنت "المدير الطبي الأعلى للتدقيق السريري"، ومهمتك هي إنشاء تقرير HTML متكامل، دقيق، ومنظم بشكل احترافي.
**يجب عليك اتباع الهيكل والقالب التالي حرفياً وبدون أي تغيير في التصميم.**

---
### الهيكل الإلزامي للتقرير النهائي ###

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
        .conclusion { margin-top: 32px; padding: 16px; background-color: #eef2ff; border-top: 3px solid #4f46e5; border-radius: 4px; }
        .disclaimer { margin-top: 16px; font-size: 0.8rem; color: #6b7280; text-align: center; }
    </style>
</head>
<body>
    <div class="report-container">
        <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>

        <h4>ملخص الحالة</h4>
        <p>اكتب هنا ملخصاً موجزاً ووافياً لحالة المريض...</p>

        <h4>تحليل الملفات المرفوعة</h4>
        <p>اكتب هنا تحليلاً موجزاً للملفات المرفوعة...</p>

        <h4>التحليل السريري العميق</h4>
        <p>اكتب هنا تحليلاً سريرياً أعمق للحالة بناءً على المعطيات...</p>

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
            <p>حلل هنا الفحوصات الأساسية المبررة مع الاستشهاد بإرشادات (ADA, ESH)...</p>

            <h5>2. تعديلات دوائية حرجة</h5>
            <p>انتقد هنا استخدام الأدوية الوريدية وقدم توصية واضحة مع الاستشهاد بإرشادات (NICE, UpToDate)...</p>

            <h5>3. تحاليل مخبرية ضرورية</h5>
            <p>اشرح هنا القيمة السريرية لأهم تحليلين مع ذكر وتيرة إجرائها حسب الإرشادات...</p>

            <h5>4. متابعة وفحوصات دورية</h5>
            <p>اشرح هنا أهمية المتابعة الروتينية مع الاستشهاد بالإرشادات...</p>
        </div>

        <div class="conclusion">
            <h5>5. الخاتمة والتوصيات النهائية</h5>
            <p>قدم هنا ملخصاً إدارياً للنتائج والتوصيات الرئيسية...</p>
        </div>
        
        <p class="disclaimer">هذا التقرير لا يغني عن المراجعة السريرية المباشرة، ويُستخدم لأغراض التدقيق الطبي والتأميني فقط.</p>
    </div>
</body>
</html>
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
