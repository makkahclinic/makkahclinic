// ==================================================================
// ==            الكود النهائي لتحليل الوصفات الطبية              ==
// ==                     (الإصدار الاحترافي)                      ==
// ==================================================================
// هذا الكود يمثل النسخة النهائية والمصقولة التي تدمج أفضل بنية
// مع أقوى prompt للحصول على تحليل طبي احترافي ومنسق بصريًا.
// ==================================================================

// --- إعدادات أساسية ---
export const config = {
    api: { bodyParser: { sizeLimit: '25mb' } } // السماح بملفات تصل إلى 25 ميجابايت
};

const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4 MB (حد أقصى للملفات المضمنة)
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]); // حالات الخطأ التي تستدعي إعادة المحاولة
const DEFAULT_TIMEOUT_MS = 120 * 1000; // مهلة زمنية 120 ثانية للطلب

// ===================== التعليمات الرئيسية للنموذج (System Instruction) =====================
// هذا هو "عقل" التطبيق الذي يوجه Gemini لإنشاء التقرير الاحترافي
const systemInstruction = `
أنت "صيدلي إكلينيكي خبير" ومستشار في تصميم واجهات المعلومات الطبية. مهمتك هي تحليل البيانات السريرية للمريض وإنشاء تقرير HTML تفاعلي بصريًا، دقيق، وجميل المظهر.

[أ] منهجية التحليل (إلزامية)
1.  حلّل جميع البيانات النصية والصور المرفقة لاستخراج قائمة كاملة بالأدوية.
2.  لكل دواء، حدد اسمه، جرعته، وتعليمات تناوله.
3.  قم بإجراء تحليل سريري عميق، وابحث عن:
    * **التداخلات الدوائية:** بين الأدوية الموجودة في القائمة.
    * **التعارض مع حالة المريض:** هل يتعارض أي دواء مع بيانات المريض (العمر، وظائف الكلى eGFR، الحمل، إلخ).
    * **معلومات هامة:** أي ملاحظات أخرى ضرورية (مثل التفاعل مع طعام معين، تحذيرات عامة).
4.  قم بترقيم كل ملاحظة أو تداخل تجده بشكل تسلسلي (1, 2, 3, ...).

[ب] بنية تقرير HTML المطلوبة (إلزامية)

**أولاً: ابدأ ردك بوسم <style> يحتوي على كود الـ CSS التالي بالضبط:**
<style>
    .report-container { direction: rtl; font-family: 'Amiri', serif; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
    .report-title { font-size: 24px; font-weight: 700; color: #1e40af; margin-bottom: 12px; border-bottom: 2px solid #60a5fa; padding-bottom: 8px; }
    .report-subtitle { font-size: 18px; font-weight: 600; color: #1d4ed8; margin-top: 20px; margin-bottom: 10px; }
    .patient-summary p { font-size: 16px; line-height: 1.6; margin: 4px 0; }
    .meds-table { width: 100%; border-collapse: separate; border-spacing: 0 10px; margin-top: 10px; }
    .meds-table th { text-align: right; padding: 12px 15px; color: #374151; background-color: #f3f4f6; border-bottom: 2px solid #e5e7eb; font-size: 14px; }
    .meds-table td { text-align: right; padding: 14px 15px; background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); font-size: 15px; vertical-align: middle; }
    .dose-cell { font-weight: 600; color: #1e40af; background-color: #eff6ff; }
    .interaction-badge { display: inline-block; width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 50%; color: white; font-weight: 700; font-size: 12px; margin: 2px; }
    .interaction-badge.high { background-color: #ef4444; }
    .interaction-badge.moderate { background-color: #f97316; }
    .interaction-badge.low { background-color: #22c55e; }
    .interaction-badge.info { background-color: #3b82f6; }
    .findings-list { list-style-type: none; padding-right: 0; }
    .findings-list li { background: #fff; border-right: 5px solid; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.06); padding: 14px; margin-bottom: 12px; }
    .findings-list li[data-severity="high"] { border-color: #ef4444; }
    .findings-list li[data-severity="moderate"] { border-color: #f97316; }
    .findings-list li[data-severity="low"] { border-color: #22c55e; }
    .findings-list li[data-severity="info"] { border-color: #3b82f6; }
    .finding-title { font-size: 16px; font-weight: 700; }
    .finding-description { font-size: 15px; line-height: 1.7; color: #4b5563; margin-top: 8px; }
    .recommendations ol { padding-right: 20px; }
    .recommendations li { font-size: 15px; line-height: 1.8; margin-bottom: 8px; }
    .disclaimer { margin-top: 20px; font-size: 12px; text-align: center; color: #6b7280; }
</style>

**ثانياً: بعد الـ style، أنشئ التقرير داخل حاوية <div class="report-container"> بالهيكل التالي:**

1.  <h3 class="report-title">تحليل الوصفة الطبية الشامل</h3>
2.  <div class="patient-summary"> <h4 class="report-subtitle">ملخص حالة المريض</h4> ... </div>
3.  <div>
        <h4 class="report-subtitle">جدول الأدوية والتحليل المبدئي</h4>
        <table class="meds-table">
            <thead><tr>
                <th>الدواء</th>
                <th>الجرعة</th>
                <th>طريقة الأخذ</th>
                <th>التداخلات الدوائية</th>
                <th>التعارض مع الحالة</th>
            </tr></thead>
            <tbody>
                </tbody>
        </table>
    </div>
4.  <div>
        <h4 class="report-subtitle">تفاصيل التحليل السريري والملاحظات</h4>
        <ol class="findings-list">
            </ol>
    </div>
5.  <div class="recommendations">
        <h4 class="report-subtitle">خطة العمل والتوصيات</h4>
        <ol>
            </ol>
    </div>
6.  <p class="disclaimer"><strong>إخلاء مسؤولية:</strong> هذا التقرير هو للمساعدة المعلوماتية فقط ولا يغني عن الاستشارة الطبية المتخصصة.</p>

[ج] **آلية الربط البصري (مهم جدًا)**
-   عندما تجد ملاحظة (مثلاً، تداخل بين دوائين)، أعطها رقمًا (مثلاً، رقم 1).
-   في قائمة "تفاصيل التحليل السريري"، اعرض الملاحظة رقم 1 مع شرحها الكامل.
-   في **جدول الأدوية**، في صف كل دواء من الدوائين المتداخلين، ضع في عمود "التداخلات الدوائية" شارة ملونة <span class="interaction-badge"> بنفس لون الخطورة وتحمل الرقم 1.
-   بهذه الطريقة، يمكن للمستخدم رؤية شارة حمراء رقمها "1" في الجدول، ثم يذهب إلى الملاحظة رقم "1" في الأسفل ليقرأ التفاصيل. طبق هذا المبدأ على كل الملاحظات.

[د] **عمود الجرعة**
-   عندما تنشئ الخلية <td> لعمود الجرعة، أضف لها الكلاس \`dose-cell\`.

[هـ] الإخراج النهائي
-   يجب أن يكون ردك عبارة عن **كتلة HTML واحدة فقط**، تبدأ بـ <style>. لا تضف أي نص تمهيدي أو ختامي.
`;

// ===================== بناء طلب المستخدم (Prompt) =====================
function buildUserPrompt(patientData = {}) {
    return `
**بيانات المريض:**
- العمر: ${patientData.age ?? 'غير محدد'}
- الجنس: ${patientData.sex ?? 'غير محدد'}
- وظائف الكلى (eGFR): ${patientData.eGFR ?? 'غير محدد'}
- هل المريضة حامل: ${patientData.pregnancy?.pregnant ? 'نعم' : 'لا'}
- أسابيع الحمل: ${patientData.pregnancy?.weeks ?? 'غير محدد'}
- حالة الكبد: ${patientData.liverDisease ? 'يوجد مرض كبدي' : 'طبيعي'}

**الأدوية المكتوبة (نصًا):**
${patientData.medicationsText ?? 'لا يوجد'}

**الملفات المرفوعة:**
${Array.isArray(patientData.files) && patientData.files.length > 0 ? 'يوجد ملفات مرفقة للتحليل.' : 'لا توجد ملفات مرفقة.'}
`;
}


// ===================== دوال مساعدة للـ API والملفات =====================
async function uploadFileToGemini(apiKey, fileBuffer, mimeType) {
    const uploadUrl = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
    console.log(`Uploading file of type ${mimeType}...`);
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': mimeType },
        body: fileBuffer,
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error('File API upload failed:', errorText);
        throw new Error(`File API upload failed with status ${response.status}`);
    }
    const result = await response.json();
    console.log(`File uploaded. URI: ${result.file.uri}`);
    return result.file.uri;
}

async function fetchWithRetry(url, options, { retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok && retries > 0 && RETRY_STATUS.has(res.status)) {
            await new Promise(r => setTimeout(r, (3 - retries) * 1000));
            return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
        }
        return res;
    } finally {
        clearTimeout(id);
    }
}

// ===================== معالج الطلب الرئيسي (Main API Handler) =====================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

        const { texts = [], images = [], patient = {} } = req.body || {};
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
        
        const patientDataForPrompt = { ...patient, medicationsText: texts.join('\n'), files: images };
        const userPrompt = buildUserPrompt(patientDataForPrompt);
        const parts = [{ text: systemInstruction }, { text: userPrompt }];

        if (Array.isArray(images)) {
            for (const imageDataUrl of images) {
                if (typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:')) {
                    const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
                    if (!match) {
                        console.warn('Skipping invalid data URL format.');
                        continue;
                    }
                    const mimeType = match[1];
                    const base64Data = match[2];
                    const buffer = Buffer.from(base64Data, 'base64');

                    if (buffer.byteLength > MAX_INLINE_FILE_BYTES) {
                        try {
                            const fileUri = await uploadFileToGemini(apiKey, buffer, mimeType);
                            parts.push({ file_data: { mime_type: mimeType, file_uri: fileUri } });
                        } catch (uploadError) {
                            console.error(`Skipping a file due to upload error:`, uploadError.message);
                        }
                    } else {
                        parts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
                    }
                }
            }
        }
        
        const payload = {
            contents: [{ role: 'user', parts }],
            generationConfig: { maxOutputTokens: 8192 }
        };

        const response = await fetchWithRetry(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        if (!response.ok) {
            console.error('Gemini API Error:', response.status, responseText);
            throw new Error(`Gemini API responded with status ${response.status}: ${responseText}`);
        }

        const result = JSON.parse(responseText);
        const finalHtml = result?.candidates?.[0]?.content?.parts?.[0]?.text || '<p>خطأ: لم يتمكن النموذج من إنشاء تقرير.</p>';
        
        return res.status(200).json({ ok: true, html: finalHtml.replace(/```html|```/g, '').trim() });

    } catch (err) {
        console.error('Server Error:', err);
        return res.status(500).json({ ok: false, error: 'Internal Server Error', message: err.message });
    }
}
