// /api/pharmacy-rx.js (الإصدار النهائي المبسط والموثوق)

import { GoogleGenerativeAI } from '@google/generative-ai';

// --- إعدادات أساسية ---
export const config = {
    api: { bodyParser: { sizeLimit: '25mb' } }
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-pro-latest';

// --- دوال مساعدة ---
function dataUrlToBuffer(dataUrl) {
    const match = dataUrl.match(/^data:(.*);base64,(.*)$/);
    if (!match) return null;
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

// ============================ معالج الطلب الرئيسي (API Handler) ============================
export default async function handler(req, res) {
    console.log("Step 1: Handler started.");

    // التعامل مع CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    if (!GEMINI_API_KEY) {
        console.error("Fatal Error: GEMINI_API_KEY is not configured.");
        return res.status(500).json({ ok: false, message: "مفتاح Gemini API غير معرف على الخادم." });
    }

    try {
        const { texts = [], images = [], patient = {} } = req.body;
        console.log(`Step 2: Received request with ${texts.length} text parts and ${images.length} images.`);

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

        // تحويل الصور من dataURL إلى الصيغة التي تفهمها المكتبة
        const imageParts = images
            .map(dataUrlToBuffer)
            .filter(Boolean) // تجاهل أي صيغ غير صالحة
            .map(({ mimeType, buffer }) => ({
                inlineData: { data: buffer.toString('base64'), mimeType }
            }));
        
        console.log(`Step 3: Converted ${imageParts.length} images to generative parts.`);

        if (texts.length === 0 && imageParts.length === 0) {
            return res.status(400).json({ ok: false, message: "الرجاء إدخال نص أو رفع ملف يحتوي على الأدوية." });
        }

        // بناء الـ Prompt النهائي
        const ultimatePrompt = `
            أنت صيدلي إكلينيكي خبير، ومهمتك هي تحليل حالة المريض التالية وتقديم تقرير احترافي بصيغة HTML.

            **بيانات المريض:**
            - العمر: ${patient.age || 'غير محدد'}
            - الجنس: ${patient.sex === 'M' ? 'ذكر' : 'أنثى'}
            - الوزن: ${patient.weight ? `${patient.weight} كجم` : 'غير محدد'}
            - وظائف الكلى (eGFR): ${patient.eGFR || 'غير محدد'}
            - الحمل: ${patient.pregnancy?.pregnant ? `نعم، ${patient.pregnancy.weeks || ''} أسابيع` : 'لا'}

            **مهمتك:**
            قم بقراءة وفهم كل النصوص والصور المرفقة، ثم قم بإنشاء تقرير HTML كامل ومنسق يحتوي على الأقسام التالية بالترتيب:

            **القسم الأول: جدول الأدوية**
            - أنشئ جدولاً <table id="meds-table"> بالأعمدة: "الدواء", "الجرعة", "طريقة الأخذ".

            **القسم الثاني: التحليل السريري**
            - أنشئ حاوية <div id="findings-list">.
            - لكل ملاحظة، أنشئ بطاقة <div class="finding-card">.
            - لكل بطاقة، حدد نوعها (تداخل دوائي, تعارض مع الحالة, معلومة عامة) ومستوى خطورتها (أحمر للخطر جداً, أصفر للمتوسط, أخضر للمنخفض, أزرق للمعلومات). استخدم شارة <span class="badge"> مع السمة data-severity.

            **القسم الثالث: التنسيق (CSS)**
            - ابدأ ردك بوسم <style> يحتوي على تنسيق احترافي يدعم اللغة العربية.
            
            **تعليمات هامة:**
            - ردك يجب أن يكون بصيغة HTML فقط.
        `;

        const requestParts = [ultimatePrompt, ...texts, ...imageParts];
        
        console.log("Step 4: Sending request to Gemini...");
        const result = await model.generateContent({ contents: [{ parts: requestParts }] });
        const response = await result.response;
        const finalHtml = response.text();
        console.log("Step 5: Received response from Gemini. Sending to client.");

        return res.status(200).json({ ok: true, html: finalHtml });

    } catch (error) {
        console.error("CRITICAL ERROR in handler:", error);
        return res.status(500).json({ ok: false, error: "analysis_failed", message: error.message });
    }
}
