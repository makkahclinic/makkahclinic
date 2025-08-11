// /api/gpt.js — Final Production Version (Corrected)
// Implements:
// 1. Detailed, non-truncated analysis via maxOutputTokens.
// 2. Mandatory evidence-based section for clinical value.
// 3. Google AI Files API for robust handling of large images (>4MB).
// 4. REMOVED responseMimeType to fix INVALID_ARGUMENT error.

// --- CONFIGURATION CONSTANTS ---
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4 MB threshold for switching to Files API
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 120_000; // Increased timeout for potentially longer processing

// ===================== System Instruction (Restored to Full Detail) =====================
const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري. أخرج تقرير HTML واحد فقط (كتلة واحدة) بصياغة احترافية، دون أي CSS أو <style>.

[أ] منهجية إلزامية مختصرة
1) حلّل جميع البيانات النصّيّة والصُّوَر. إن تعارض النص مع الصورة فاذكر ذلك كملاحظة حرجة وحدّد أيّهما يُعتمد ولماذا. لكل صورة، أضف قسمًا مخصصًا لتحليلها.
2) افحص بدقة:
   • الازدواجية العلاجية (خاصة أدوية الضغط/السكري/التجلط/الدوار)
   • أخطاء الجرعات (مثل XR/MR موصوف أكثر من مرة يوميًا)
   • أمان الأدوية عالية الخطورة وفحوصها (Metformin/Xigduo XR ⇠ eGFR؛ Allopurinol ⇠ eGFR + Uric Acid ± HLA-B*58:01؛ Warfarin ⇠ INR؛ ACEi/ARB/MRA ⇠ K+Cr)
   • وجود تشخيص داعم لكل دواء/إجراء (وإلا فاذكر انعدامه صراحة)
   • مدة الصرف (90 يوم لمرض حاد = علامة تحذير)
   • مطابقة العلاج للحالة الكلوية/الكبدية والضغط الحالي والعمر وكبار السن
   • تداخلات كبار السن (مثل: أدوية الدوار/المهدئات ⇒ خطر السقوط)

[ب] قواعد مخاطبة التأمين (إلزامية)
- لكل صف في الجدول: احسب "درجة الخطورة" (0–100%) واكتب علامة %.
- طبّق كلاس لوني على <td> في عمودي "درجة الخطورة" و"قرار التأمين":
  • risk-high إذا الدرجة ≥ 70%  • risk-medium إذا 40–69%  • risk-low إذا < 40%
- صِغ "قرار التأمين" حصراً بإحدى الصيغ:
  • ❌ قابل للرفض — السبب: [طبي/إجرائي محدد] — وللقبول يلزم: [تشخيص/فحص/تعديل جرعة/إلغاء ازدواجية/خطة متابعة…] — التخصص المُراجع: [اكتب التخصص المناسب]
  • ⚠️ قابل للمراجعة — السبب: […] — لتحسين فرص القبول: […] — التخصص المُراجع: [اكتب التخصص المناسب]
  • ✅ مقبول
- إن كان الدواء/الإجراء بلا تشخيص داعم فاذكر ذلك داخل القرار صراحة.

[ج] إظهار جميع الأدوية والإجراءات (إلزامي)
- اعرض **كل** الأدوية والإجراءات المذكورة في النص/الصورة **دون حذف أي صف** حتى لو نقصت البيانات.
- إن تعذّر تحديد خانة ما، اكتب "غير محدد".

[د] بنية HTML مطلوبة (لا CSS ولا <style>)
1) <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
2) <h4>ملخص الحالة</h4><p>لخّص العمر/الجنس/التدخين/السعال/الأعراض البصرية/التشخيصات/الملاحظات الحرجة.</p>
3) <h4>تحليل الملفات المرفوعة</h4>
   <!-- For each uploaded file (X-ray, MRI, etc.), add: -->
   <!-- <h5>تحليل [اسم الملف أو نوعه]</h5> -->
   <!-- <p>[Provide detailed analysis of the image, findings, and any OCR text here]</p> -->
4) <h4>التحليل السريري العميق</h4><p>اشرح الأخطاء الرئيسية واربطها بالحالة (CKD/ضغط/عمر/دواء XR…)، واذكر فحوص الأمان اللازمة (eGFR/UA/K/Cr/INR...).</p>
5) <h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr>
<th>الدواء/الإجراء</th><th>الجرعة الموصوفة</th><th>الجرعة الصحيحة المقترحة</th><th>التصنيف</th><th>الغرض الطبي</th><th>التداخلات</th><th>درجة الخطورة (%)</th><th>قرار التأمين</th>
</tr></thead><tbody>
<!-- Fill rows for every item without exception -->
</tbody></table>

[هـ] فرص تحسين الخدمة ورفع مستوى الدخل (وفق مصلحة المريض – مدعومة بالأدلة، إلزامي)
- أخرج قائمة نقطية؛ لكل عنصر سطر واحد بالصيغة:
  **اسم الفحص/الخدمة** — سبب سريري محدد (مرتبط بعمر/أعراض/مرض/دواء) — منفعة للمريض (تشخيص/أمان/متابعة) — منفعة تشغيلية للعيادة (مختبر/تصوير/متابعة دورية) — **مصدر موثوق + رابط مباشر**.
- أمثلة روابط موثوقة (استخدمها أو الأحدث منها):
  • ADA Standards of Care (Diabetes): https://diabetesjournals.org/care
  • FDA Metformin & Renal Impairment: https://www.fda.gov/drugs/
  • KDIGO CKD Guideline: https://kdigo.org/guidelines/ckd-evaluation-and-management/
  • ACR Appropriateness Criteria—Chronic Cough: https://acsearch.acr.org/list
  • USPSTF Lung Cancer Screening: https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/lung-cancer-screening
- فعّل البنود التالية عندما تنطبق محفزاتها (وأضف الرابط المناسب):
  • سكري نوع 2 ⇒ **HbA1c** (كل 3 أشهر إن غير منضبط، 6–12 أشهر إن مستقر) — ADA.
  • Metformin/Xigduo XR أو سكري/CKD ⇒ **eGFR + UACR** قبل/أثناء العلاج — FDA + KDIGO/ADA–KDIGO.
  • Allopurinol ⇒ **Uric Acid + eGFR ± HLA-B*58:01** — ACR Gout.
  • ACEi/ARB + Spironolactone أو CKD ⇒ **Potassium + Creatinine خلال 1–2 أسبوع** — ACC/AHA.
  • سعال مزمن (>8 أسابيع) أو مدخّن ≥40 سنة مع أعراض ⇒ **Chest X-ray (CXR)** — ACR.
  • مدخّن 50–80 سنة مع ≥20 باك-سنة ⇒ **LDCT سنوي** — USPSTF.

[و] خطة العمل
- قائمة مرقمة بتصحيحات فورية دقيقة.

[ز] الخاتمة
<p><strong>الخاتمة:</strong> هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص.</p>

[ح] الإخراج
- أخرج **كتلة HTML واحدة فقط** وصالحة وكاملة.
`;

// ===================== Prompt Builder (Matches user's preferred Front-End) =====================
function buildUserPrompt(caseData = {}) {
  return `
**بيانات المريض (مدخل يدويًا):**
- العمر: ${caseData.age ?? 'غير محدد'}
- الجنس: ${caseData.gender ?? 'غير محدد'}
- هل المريضة حامل: ${caseData.isPregnant ?? 'غير محدد'}
- شهر الحمل: ${caseData.pregnancyMonth ?? 'غير محدد'}
- التدخين: ${caseData.isSmoker ? 'مدخّن' : 'غير مدخّن'}
- باك-سنة: ${caseData.packYears ?? 'غير محدد'}
- مدة السعال (أسابيع): ${caseData.coughDurationWeeks ?? 'غير محدد'}
- أعراض بصرية: ${caseData.visualSymptoms ?? 'غير محدد'}
- تاريخ آخر فحص عين: ${caseData.lastEyeExamDate ?? 'غير محدد'}
- حدة الإبصار: ${caseData.visualAcuity ?? 'غير محدد'}
- التشخيصات: ${caseData.diagnosis ?? 'غير محدد'}
- الأدوية/الإجراءات المكتوبة: ${caseData.medications ?? 'غير محدد'}
- وصف الحالة وملاحظات إضافية: ${caseData.notes ?? 'غير محدد'}
- نتائج التحاليل والأشعة المكتوبة: ${caseData.labResults ?? 'غير محدد'}

**الملفات المرفوعة:**
- ${Array.isArray(caseData.files) && caseData.files.length > 0 ? 'يوجد ملفات مرفقة للتحليل. قم بتحليل كل ملف على حدة في قسم خاص به.' : 'لا توجد ملفات مرفقة.'}
`;
}

// ===================== API & File Helpers =====================
async function uploadFileToGemini(apiKey, fileBuffer, mimeType) {
    const uploadUrl = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
    console.log(`Uploading file of type ${mimeType} to Google AI Files API...`);
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': mimeType },
        body: fileBuffer,
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Google AI Files API upload failed:', errorText);
        throw new Error(`File API upload failed with status ${response.status}`);
    }
    const result = await response.json();
    console.log(`File uploaded successfully. URI: ${result.file.uri}`);
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

// ===================== Main API Handler =====================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

    const userPrompt = buildUserPrompt(req.body || {});
    const parts = [{ text: systemInstruction }, { text: userPrompt }];

    if (Array.isArray(req.body?.files)) {
        for (const file of req.body.files) {
            if (typeof file.data === 'string' && file.data.length > 0) {
                const fileBuffer = Buffer.from(file.data, 'base64');
                if (fileBuffer.byteLength > MAX_INLINE_FILE_BYTES) {
                    try {
                        const fileUri = await uploadFileToGemini(apiKey, fileBuffer, file.type);
                        parts.push({ file_data: { mime_type: file.type, file_uri: fileUri } });
                    } catch (uploadError) {
                        console.error(`Skipping file ${file.name} due to upload error:`, uploadError.message);
                    }
                } else {
                    parts.push({ inline_data: { mime_type: file.type, data: file.data } });
                }
            }
        }
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.25,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      }
    };

    const response = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    if (!response.ok) {
      console.error('Gemini API Error:', response.status, response.statusText, text);
      return res.status(response.status).json({
        error: 'Failed to connect to Gemini API',
        detail: text.slice(0, 2000)
      });
    }

    let rawHtml;
    try {
        const result = JSON.parse(text);
        rawHtml = result?.candidates?.[0]?.content?.parts?.[0]?.text || '<p>⚠️ Could not extract report from API response.</p>';
        const finishReason = result?.candidates?.[0]?.finishReason;
        if (finishReason && finishReason !== 'STOP') {
            console.warn('Gemini generation finished with reason:', finishReason);
        }
    } catch (e) {
        rawHtml = text;
    }

    const finalizedHtml = rawHtml.replace(/```html|```/g, '').trim();
    return res.status(200).json({ htmlReport: finalizedHtml });

  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({
      error: 'An internal server error occurred while analyzing the case.',
      detail: err.message
    });
  }
}
