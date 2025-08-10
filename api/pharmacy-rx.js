// ==================================================================
// == العقل المدبر النهائي لتحليل الوصفات الطبية (الإصدار الخارق) ==
// ==================================================================
// هذا الكود يوحد كل العمليات في طلب واحد ذكي إلى Gemini ليقوم بـ:
// 1. قراءة النصوص من الملفات والصور (OCR).
// 2. فهم وتحديد قائمة الأدوية والجرعات والتعليمات.
// 3. إجراء تحليل سريري شامل (تداخلات، تعارضات مع الحالة).
// 4. إعداد تقرير HTML نهائي ومنسق وجاهز للعرض.
// ==================================================================

import { GoogleGenerativeAI } from '@google/generative-ai';

// --- إعدادات أساسية ---
export const config = {
    api: { bodyParser: { sizeLimit: '25mb' } }
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-pro-latest';

// --- دوال مساعدة ---

/**
 * دالة آمنة لتحليل `data:URL` وتحويله إلى Buffer و MIME type.
 */
function parseDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return null;
    }
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
}

/**
 * ترفع ملفًا واحدًا إلى Google AI Files API وتتعامل مع الأخطاء بأمان.
 */
async function uploadFileToGoogleAI(apiKey, fileBuffer, mimeType, index) {
    try {
        const uploadUrl = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Type': mimeType,
                'x-goog-request-params': 'project=-' // ضروري للوصول الصحيح
            },
            body: fileBuffer,
        });

        if (!response.ok) {
            console.error(`File upload failed for item ${index}:`, await response.text());
            return null; // تجاهل الملف الفاشل
        }
        const result = await response.json();
        return result.file;
    } catch (error) {
        console.error(`Exception during file upload for item ${index}:`, error);
        return null;
    }
}


// ============================ معالج الطلب الرئيسي (API Handler) ============================

export default async function handler(req, res) {
    // التعامل مع طلبات OPTIONS الخاصة بـ CORS
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(200).end();
    }
    // السماح بالوصول من أي مصدر
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ ok: false, message: "مفتاح Gemini API غير معرف على الخادم." });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    try {
        const { texts = [], images = [], patient = {} } = req.body || {};

        // 1. رفع الملفات (الصور) بالتوازي للحصول على أفضل أداء
        const uploadPromises = images
            .map(parseDataUrl)
            .filter(Boolean) // تجاهل أي data URLs غير صالحة
            .map(({ buffer, mimeType }, index) => uploadFileToGoogleAI(GEMINI_API_KEY, buffer, mimeType, index));
        
        const uploadedFiles = (await Promise.all(uploadPromises)).filter(Boolean); // تجاهل أي عمليات رفع فاشلة

        // 2. بناء أجزاء الطلب لـ Gemini
        const textInputs = texts.map(t => t.trim()).filter(Boolean);
        const fileParts = uploadedFiles.map(file => ({
            fileData: { mimeType: file.mimeType, fileUri: file.uri }
        }));
        
        if (textInputs.length === 0 && fileParts.length === 0) {
            return res.status(400).json({ ok: false, message: "الرجاء إدخال نص أو رفع ملف يحتوي على الأدوية." });
        }

        // 3. بناء الـ Prompt الخارق والنهائي
        const ultimatePrompt = `
            أنت صيدلي إكلينيكي خبير، ومهمتك هي تحليل حالة المريض التالية وتقديم تقرير احترافي بصيغة HTML.

            **بيانات المريض:**
            - العمر: ${patient.age || 'غير محدد'}
            - الجنس: ${patient.sex === 'M' ? 'ذكر' : (patient.sex === 'F' ? 'أنثى' : 'غير محدد')}
            - الوزن: ${patient.weight ? `${patient.weight} كجم` : 'غير محدد'}
            - وظائف الكلى (eGFR): ${patient.eGFR || 'غير محدد'}
            - الحمل: ${patient.pregnancy?.pregnant ? `نعم، ${patient.pregnancy.weeks || ''} أسابيع` : (patient.pregnancy?.pregnant === false ? 'لا' : 'غير محدد')}
            - الرضاعة: ${patient.lactation?.breastfeeding ? 'نعم' : 'غير محدد'}
            - حالة الكبد: ${patient.liverDisease ? 'يوجد مرض كبدي' : 'طبيعي'}

            **مهمتك:**
            قم بقراءة وفهم كل النصوص والملفات المرفقة، ثم قم بإنشاء تقرير HTML كامل ومنسق يحتوي على الأقسام التالية بالترتيب:

            **القسم الأول: جدول الأدوية**
            - أنشئ جدولاً <table id="meds-table"> لعرض الأدوية.
            - يجب أن يحتوي الجدول على الأعمدة التالية: "الدواء", "الجرعة", "طريقة الأخذ".
            - املأ الجدول من المعلومات التي استخرجتها.

            **القسم الثاني: التحليل السريري والملاحظات**
            - أنشئ حاوية <div id="findings-list">.
            - داخلها، لكل ملاحظة هامة، أنشئ بطاقة <div class="finding-card">.
            - **لكل بطاقة، حدد نوعها ومستوى خطورتها:**
                -   **النوع:** هل هو "تداخل دوائي" (بين دواء وآخر في القائمة)، "تعارض مع حالة المريض" (مثل دواء لا يناسب مرضى الكلى)، أم "معلومة عامة" (مثل تفاعل مع طعام أو تحذير عام).
                -   **الخطورة (Severity):** استخدم شارة <span class="badge"> مع السمة data-severity.
                    -   data-severity="high" (أحمر): خطر جداً أو تعارض تام.
                    -   data-severity="moderate" (أصفر): خطر متوسط يتطلب حذرًا ومراقبة.
                    -   data-severity="low" (أخضر): تفاعل بسيط أو ملاحظة غير مقلقة.
                    -   data-severity="info" (أزرق): معلومة عامة هامة.
            - اكتب شرحًا واضحًا ومختصرًا لكل ملاحظة.

            **القسم الثالث: التنسيق (CSS)**
            - ابدأ ردك بوسم <style> يحتوي على تنسيق CSS احترافي وجميل للتقرير، مع الأخذ في الاعتبار الألوان المطلوبة للخطورة ودعم اللغة العربية (direction: rtl).
            
            **تعليمات هامة:**
            - يجب أن يكون ردك كاملاً بصيغة HTML فقط.
            - لا تكتب أي كلمة تمهيدية أو ختامية خارج كود HTML.
        `;

        // 4. دمج كل الأجزاء في طلب واحد
        const requestParts = [{ text: ultimatePrompt }, ...fileParts, ...textInputs.map(text => ({ text }))];

        // 5. إرسال الطلب إلى Gemini وانتظار التقرير النهائي
        const result = await model.generateContent({ contents: [{ parts: requestParts }] });
        const finalHtml = result.response.text();

        // 6. إرسال التقرير للواجهة الأمامية
        return res.status(200).json({ ok: true, html: finalHtml });

    } catch (error) {
        console.error("Final handler failed:", error);
        return res.status(500).json({ ok: false, error: "analysis_failed", message: error.message });
    }
}
