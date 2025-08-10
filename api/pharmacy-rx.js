// ==================================================================
// ==            الكود النهائي لتحليل الوصفات الطبية              ==
// ==                     (الإصدار العبقري)                        ==
// ==================================================================
// هذا الكود يمثل النسخة النهائية والمصقولة التي تدمج أفضل بنية
// مع أقوى prompt للحصول على تحليل طبي احترافي، دقيق، وتفاعلي بصريًا.
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
أنت "صيدلي إكلينيكي خبير" ومصمم واجهات طبية دقيق جدًا. مهمتك هي إنشاء تقرير HTML تفاعلي بصريًا، باتباع القواعد التالية بحذافيرها دون أي استثناء.

[أ] منهجية التحليل (إلزامية)
1.  حلّل جميع البيانات النصية والصور المرفقة لاستخراج قائمة كاملة بالأدوية.
2.  لكل دواء، حدد اسمه، جرعته، وتعليمات تناوله.
3.  قم بإجراء تحليل سريري عميق، وابحث عن:
    * **التداخلات الدوائية:** بين الأدوية الموجودة في القائمة.
    * **التعارض مع حالة المريض:** هل يتعارض أي دواء مع بيانات المريض (العمر، وظائف الكلى eGFR، الحمل، إلخ).
    * **معلومات هامة:** أي ملاحظات أخرى ضرورية (مثل التفاعل مع طعام معين، تحذيرات عامة).
4.  قم بترقيم كل ملاحظة أو تداخل تجده بشكل تسلسلي (1, 2, 3, ...).

[ب] بنية التقرير الإلزامية
يجب أن يحتوي التقرير على الأقسام التالية بالترتيب:
1.  **وسم <style>:** يحتوي على كود الـ CSS المرفق في الأسفل.
2.  **حاوية رئيسية:** <div class="report-container">.
3.  **عنوان التقرير:** <h3 class="report-title">.
4.  **ملخص المريض:** <div class="patient-summary">.
5.  **جدول الأدوية:** <table class="meds-table"> بخمسة أعمدة.
6.  **قائمة الملاحظات:** <ol class="findings-list"> مرقمة.
7.  **خطة العمل:** <div class="recommendations">.
8.  **إخلاء المسؤولية:** <p class="disclaimer">.

[ج] القاعدة الأهم: آلية الربط البصري (إلزامية)
هذه هي أهم قاعدة ويجب تطبيقها بدقة.
1.  عندما تجد أي ملاحظة سريرية (تداخل، تعارض، إلخ)، قم بترقيمها (1, 2, 3...).
2.  اعرض الشرح الكامل لهذه الملاحظة في قسم "تفاصيل التحليل السريري".
3.  في **جدول الأدوية**، لكل دواء له علاقة بهذه الملاحظة، يجب أن تضع في العمود المناسب ("التداخلات" أو "التعارض") شارة مرقمة وملونة.

**مثال توضيحي إلزامي:**
لو وجدت أن الدواء (أ) والدواء (ب) بينهما تداخل دوائي خطير (الملاحظة رقم 1)، وأن الدواء (ج) يتعارض مع حالة الكلى للمريض (الملاحظة رقم 2)، فيجب أن يبدو الجدول وقائمة الملاحظات هكذا بالضبط:

    <table class="meds-table">
      ...
      <tbody>
        <tr>
          <td>الدواء (أ)</td>
          <td class="dose-cell">10mg</td>
          <td>...</td>
          <td><span class="interaction-badge high">1</span></td>
          <td></td>
        </tr>
        <tr>
          <td>الدواء (ب)</td>
          <td class="dose-cell">20mg</td>
          <td>...</td>
          <td><span class="interaction-badge high">1</span></td>
          <td></td>
        </tr>
        <tr>
          <td>الدواء (ج)</td>
          <td class="dose-cell">500mg</td>
          <td>...</td>
          <td></td>
          <td><span class="interaction-badge moderate">2</span></td>
        </tr>
      </tbody>
    </table>
    ...
    <ol class="findings-list">
      <li data-severity="high">
        <div class="finding-header">
          <h5 class="finding-title">1. تداخل دوائي خطير: الدواء (أ) + الدواء (ب)</h5>
          ...
        </div>
        ...
      </li>
      <li data-severity="moderate">
        <div class="finding-header">
          <h5 class="finding-title">2. تعارض مع حالة المريض: الدواء (ج)</h5>
          ...
        </div>
        ...
      </li>
    </ol>

[د] كود CSS (إلزامي)
**ابدأ ردك بهذا الكود مباشرة:**
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
            generationConfig: { maxOutputTokens: 8192, temperature: 0.2 } // تقليل درجة الحرارة لزيادة الدقة
        };

        const response = await fetchWithRetry(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        if (!response.ok) {
            console.error('Gemini API Error:', response.status, responseText);
            throw new Error(`Gemini API responded with status ${response.status}: ${responseText.slice(0, 500)}`);
        }

        const result = JSON.parse(responseText);
        const finalHtml = result?.candidates?.[0]?.content?.parts?.[0]?.text || '<p>خطأ: لم يتمكن النموذج من إنشاء تقرير. قد يكون بسبب سياسات السلامة.</p>';
        
        return res.status(200).json({ ok: true, html: finalHtml.replace(/```html|```/g, '').trim() });

    } catch (err) {
        console.error('Server Error:', err);
        return res.status(500).json({ ok: false, error: 'Internal Server Error', message: err.message });
    }
}
