// /api/pharmacy-rx.js (الإصدار النهائي المصحح)
// هذا الكود يستخدم الهندسة الناجحة من كود المستخدم مع إصلاح الخلل البرمجي السابق.

// --- إعدادات أساسية ---
export const config = {
    api: { bodyParser: { sizeLimit: '25mb' } }
};

const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4 MB
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 120 * 1000; // 120 ثانية

// ===================== التعليمات الرئيسية للنموذج (System Instruction) =====================
const systemInstruction = `
أنت "صيدلي إكلينيكي خبير" ومطور ويب محترف. مهمتك هي تحليل البيانات السريرية للمريض وإنشاء تقرير HTML مفصل ودقيق.

[أ] منهجية التحليل (إلزامية)
1.  حلّل جميع البيانات النصية والصور المرفقة لاستخراج قائمة كاملة بالأدوية.
2.  لكل دواء، حدد اسمه، جرعته، وتعليمات تناوله قدر الإمكان.
3.  قم بإجراء تحليل سريري عميق، مع التركيز على:
    * **التداخلات الدوائية:** بين الأدوية الموجودة في القائمة فقط.
    * **التعارض مع حالة المريض:** هل يتعارض أي دواء مع بيانات المريض (العمر، وظائف الكلى eGFR، الحمل، الرضاعة، أمراض الكبد).
    * **معلومات هامة:** أي ملاحظات أخرى ضرورية (مثل التفاعل مع طعام معين، تحذيرات عامة، إلخ).

[ب] بنية تقرير HTML المطلوبة (إلزامية، بدون CSS أو <style> في هذا الجزء)
1.  <h3>تحليل الوصفة الطبية</h3>
2.  <h4>ملخص حالة المريض</h4><p>اكتب ملخصًا موجزًا لبيانات المريض (العمر، الجنس، eGFR، الحمل...).</p>
3.  <h4>جدول الأدوية</h4>
    <table><thead><tr>
    <th>الدواء</th><th>الجرعة</th><th>طريقة الأخذ</th>
    </tr></thead><tbody>
    </tbody></table>
4.  <h4>التحليل السريري والملاحظات</h4>
    <div class="findings-list">
    </div>

[ج] هيكل بطاقة الملاحظة (finding-card) داخل findings-list (إلزامي)
-   يجب أن تكون كل ملاحظة داخل <div class="finding-card">.
-   يجب أن تحتوي البطاقة على شارة <span class="badge"> لتحديد الخطورة.
-   استخدم السمة data-severity لتحديد المستوى:
    * **data-severity="high"**: للخطورة العالية (الأحمر).
    * **data-severity="moderate"**: للخطورة المتوسطة (الأصفر).
    * **data-severity="low"**: للخطورة المنخفضة (الأخضر).
    * **data-severity="info"**: للمعلومات العامة (الأزرق).
-   يجب أن تحتوي البطاقة على <h5> لعنوان الملاحظة (مثال: "تداخل دوائي: Amlodipine + Simvastatin").
-   يجب أن تحتوي البطاقة على <p> لشرح الملاحظة والتوصية.

[د] الخاتمة (إلزامية)
<p><strong>إخلاء مسؤولية:</strong> هذا التقرير هو للمساعدة المعلوماتية فقط ولا يغني عن الاستشارة الطبية المتخصصة.</p>

[هـ] الإخراج النهائي
-   يجب أن يكون ردك عبارة عن **كتلة HTML واحدة فقط**، صالحة وكاملة. لا تضف أي نص تمهيدي أو ختامي مثل \`\`\`html.
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


// ===================== دوال مساعدة للـ API والملفات (من كودك الناجح) =====================
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
                    // --- بداية الجزء الذي تم إصلاحه ---
                    const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
                    if (!match) {
                        console.warn('Skipping invalid data URL format.');
                        continue;
                    }
                    const mimeType = match[1];
                    const base64Data = match[2];
                    const buffer = Buffer.from(base64Data, 'base64');
                    // --- نهاية الجزء الذي تم إصلاحه ---

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
            // أعدنا رسالة الخطأ من Gemini مباشرة إلى الواجهة الأمامية لتشخيص أفضل
            throw new Error(`Gemini API responded with status ${response.status}: ${responseText}`);
        }

        const result = JSON.parse(responseText);
        const finalHtml = result?.candidates?.[0]?.content?.parts?.[0]?.text || '<p>خطأ: لم يتمكن النموذج من إنشاء تقرير.</p>';
        
        // إرسال رد JSON صحيح إلى الواجهة الأمامية
        return res.status(200).json({ ok: true, html: finalHtml.replace(/```html|```/g, '').trim() });

    } catch (err) {
        console.error('Server Error:', err);
        // إرسال رد JSON صحيح في حالة حدوث خطأ
        return res.status(500).json({ ok: false, error: 'Internal Server Error', message: err.message });
    }
}
