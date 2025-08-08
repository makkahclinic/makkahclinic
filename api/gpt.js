// /api/gpt.js — النسخة “العبقرية” النهائية
// ميزات: فحص حجم الطلب (inline images ~20MB)، retries/timeout، تصحيح ذاتي للكلاسات/النِّسَب، تعليمات سريرية وتأمينية مُحكمة
// ملاحظات: لا تستخدم responseMimeType مع generateContent (v1beta). متوافق مع Edge (TextEncoder بدل Buffer).

const MAX_INLINE_REQUEST_MB = 19.0; // هامش أمان دون حد 20MB للصور inline
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;

// ===================== System Instruction =====================
const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري. أخرج تقرير HTML واحد فقط (كتلة واحدة) بصياغة احترافية، دون أي CSS أو <style>.

[أ] منهجية إلزامية مختصرة
1) حلّل جميع البيانات النصية والصورية. وإن تعارض النص مع الصورة فاذكر ذلك كملاحظة حرجة وحدد أيهما يُعتَمد.
2) افحص بدقة:
   • الازدواجية العلاجية (خصوصًا أدوية الضغط/السكر/الدوار)
   • أخطاء الجرعات (مثال XR/MR أُعطي أكثر من مرة يوميًا)
   • أمان الأدوية عالية الخطورة ومتطلبات فحوصها (Metformin/Xigduo XR ⇠ eGFR؛ Allopurinol ⇠ eGFR + Uric Acid ± HLA-B*58:01)
   • وجود تشخيص داعم لكل دواء/إجراء (وإلا فاذكر انعدامه صراحة)
   • مدة الصرف (90 يوم لمرض حاد = علامة تحذير)
   • مطابقة الأدوية للحالة الكلوية/الكبدية والضغط الحالي والعمر
   • تداخلات كبار السن (مثال: مهدئات/دوار تزيد خطر السقوط)

[ب] قواعد مخاطبة التأمين (إلزامية)
- لكل عنصر صف في الجدول احسب "درجة الخطورة" كنسبة مئوية 0–100% (واكتب الرمز %) وفق شدة المخالفة وتأثيرها السريري/التأميني.
- طبّق كلاس لوني على خلية "درجة الخطورة" و"قرار التأمين":
  • risk-high: إذا الدرجة ≥ 70%
  • risk-medium: إذا 40–69%
  • risk-low: إذا < 40%
- صيّغ عمود "قرار التأمين" بأحد الأنماط الثلاثة حصراً:
  • ❌ قابل للرفض — السبب: [طبي/إجرائي محدد] — وللقبول يلزم: [تشخيص/فحص/تعديل جرعة/إلغاء ازدواجية…]
  • ⚠️ قابل للمراجعة — السبب: […] — لتحسين فرص القبول: […]
  • ✅ مقبول
- إذا كان الدواء/الإجراء بلا تشخيص داعم فاذكر ذلك داخل القرار.

[ج] بنية HTML مطلوبة (لا CSS ولا <style>)
1) <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
2) <h4>ملخص الحالة</h4><p>لخّص العمر/الجنس/التشخيصات/الملاحظات الحرجة (بما في ذلك أي تعارض نص/صورة).</p>
3) <h4>التحليل السريري العميق</h4><p>اشرح كل خطأ رئيسي مع ربطه بالحالة (CKD/ضغط/عمر/دواء XR…)، واذكر فحوص الأمان اللازمة (eGFR/UA/K/Cr...).</p>
4) <h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr>
<th>الدواء/الإجراء</th>
<th>الجرعة الموصوفة</th>
<th>الجرعة الصحيحة المقترحة</th>
<th>التصنيف</th>
<th>الغرض الطبي</th>
<th>التداخلات</th>
<th>درجة الخطورة (%)</th>
<th>قرار التأمين</th>
</tr></thead><tbody>
<!-- املأ الصفوف -->
</tbody></table>

[د] فرص تحسين الخدمة ورفع مستوى الدخل (وفق مصلحة المريض، مدعومة بالأدلة — إلزامي)
- أخرج قائمة نقطية، كل عنصر سطر واحد بالصيغة:
  **اسم الفحص/الخدمة** — سبب سريري محدد (مرتبط بعمر/أعراض/مرض/دواء) — منفعة للمريض (تشخيص/أمان/متابعة) — منفعة تشغيلية للعيادة (خدمة مخبرية/تصوير/متابعة دورية) — **مصدر موثوق** (اكتب اسم الجهة + رابط مباشر).
- فعّل العناصر عند توفر محركاتها السريرية. أمثلة إلزامية متى انطبقت الشروط:
  • سكري نوع 2: **HbA1c** (كل 3 أشهر إذا غير منضبط، 6–12 أشهر إذا مستقر) — ADA 2025 (رابط).
  • Metformin/Xigduo XR أو سكري/CKD: **eGFR + UACR** قبل/أثناء العلاج — FDA + KDIGO/ADA–KDIGO (روابط).
  • بدء/استخدام Allopurinol: **Uric Acid + eGFR ± HLA-B*58:01** (حسب العِرق) — ACR Gout (رابط).
  • ACEi/ARB + Spironolactone أو CKD: **Potassium + Creatinine** خلال 1–2 أسبوع — ACC/AHA HTN (رابط).
  • سعال مزمن (>8 أسابيع) أو مدخّن ≥40 سنة مع أعراض: **CXR** — ACR Appropriateness (رابط).
  • مدخّن 50–80 سنة ≥20 باك-سنة: **LDCT سنوي** — USPSTF (رابط).
  • سكري بالغ/عمر متقدم: **فحص عين شامل مع توسعة الحدقة** سنوياً — ADA 2025 (رابط).
  • ضعف رؤية/اشتباه DME: **OCT لماكيولا** — AAO PPP (رابط).
  • الوصول ضعيف لطبيب العيون: **تصوير قاع العين غير المُمَدَّد/Tele-retina** أو **نظام AI ذاتي (IDx-DR)** — AAO/ATA + FDA (روابط).
- إذا نقصت بيانات لازمة لتفعيل توصية (العمر/التدخين/المدة…) فاذكر صراحة: "مشروط بتوفير: …".

[هـ] خطة العمل
- قائمة مرقمة واضحة بتصحيحات فورية محددة (تعديل جرعة XR، إيقاف ازدواجية، طلب eGFR/UA/K+Cr…، إضافة تشخيص داعم…).

[و] الخاتمة
<p><strong>الخاتمة:</strong> هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص.</p>

[ز] الإخراج
- أخرج كتلة HTML واحدة فقط وصالحة، دون أي CSS أو <style>.
- اكتب نسب الخطورة مرفقة بعلامة %، وطبّق الكلاسات (risk-high / risk-medium / risk-low) على خلايا "درجة الخطورة" و"قرار التأمين".
`;

// ===================== Prompt Builder (يدعم حقول إضافية اختيارية) =====================
function buildUserPrompt(caseData = {}) {
  return `
**بيانات المريض (مدخل يدويًا):**
- العمر: ${caseData.age ?? 'غير محدد'}
- الجنس: ${caseData.gender ?? 'غير محدد'}
- التدخين: ${caseData.isSmoker ? 'مدخّن' : (caseData.isSmoker === false ? 'غير مدخّن' : 'غير محدد')}
- باك-سنة: ${caseData.smokingPackYears ?? 'غير محدد'}
- مدة السعال (أسابيع): ${caseData.coughDurationWeeks ?? 'غير محدد'}
- أعراض بصرية: ${caseData.visualSymptoms ?? 'غير محدد'}
- تاريخ آخر فحص عين: ${caseData.lastEyeExamDate ?? 'غير محدد'}
- التشخيصات: ${caseData.diagnosis ?? 'غير محدد'}
- الأدوية/الإجراءات المكتوبة: ${caseData.medications ?? 'غير محدد'}
- نتائج/ملاحظات إضافية: ${caseData.notes ?? 'غير محدد'}

**نتائج مخبرية (اختياري):**
- eGFR: ${caseData.eGFR ?? 'غير محدد'}
- HbA1c: ${caseData.hba1c ?? 'غير محدد'}
- Potassium: ${caseData.k ?? 'غير محدد'}
- Creatinine: ${caseData.cr ?? 'غير محدد'}
- Uric Acid: ${caseData.ua ?? 'غير محدد'}

**الملفات المرفوعة:**
- ${Array.isArray(caseData.imageData) && caseData.imageData.length > 0 ? 'يوجد صور مرفقة للتحليل.' : 'لا توجد صور مرفقة.'}
`;
}

// ===================== Helpers: حجم الطلب، تصحيح المخرجات، fetch مع Timeout/Retry =====================
const _encoder = new TextEncoder();
function byteLengthUtf8(str) { return _encoder.encode(str || '').length; }

function estimateInlineRequestMB(parts) {
  let bytes = 0;
  for (const p of parts) {
    if (p.text) bytes += byteLengthUtf8(p.text);
    if (p.inline_data?.data) {
      const len = p.inline_data.data.length;   // طول Base64
      bytes += Math.floor((len * 3) / 4);      // تقدير bytes الفعلية
    }
  }
  return bytes / (1024 * 1024);
}

function applySafetyPostProcessing(html) {
  try {
    html = String(html || '');
    // أضف % إن كانت أرقام منفردة داخل خلايا
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi,
      (_m, o, n, _s, c) => `${o}${n}%${c}`);
    // أضف الكلاس حسب النسبة إن لم يوجد class على <td> لعمود "درجة الخطورة" أو "قرار التأمين"
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_m, open, numStr, close) => {
        const v = parseInt(numStr, 10);
        const klass = v >= 70 ? 'risk-high' : v >= 40 ? 'risk-medium' : 'risk-low';
        return open.replace('<td', `<td class="${klass}"`) + `${numStr}%` + close;
      });
    // قص أي ضجيج قبل أول <h3>
    const i = html.indexOf('<h3'); if (i > 0) html = html.slice(i);
    return html;
  } catch (e) {
    console.error('Post-processing failed:', e);
    return html;
  }
}

async function fetchWithRetry(url, options, { retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok && retries > 0 && RETRY_STATUS.has(res.status)) {
      await new Promise(r => setTimeout(r, (3 - retries) * 800)); // backoff بسيط
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ===================== API Handler =====================
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

    // إرفاق الصور (Base64 بدون البادئة) — احرص على ضغطها من الواجهة قبل الإرسال
    if (Array.isArray(req.body?.imageData)) {
      for (const img of req.body.imageData) {
        if (typeof img === 'string' && img.length > 0) {
          parts.push({ inline_data: { mimeType: 'image/jpeg', data: img } });
        }
      }
    }

    // فحص الحجم لتفادي 413 من Google أو البروكسي
    const estMB = estimateInlineRequestMB(parts);
    if (estMB > MAX_INLINE_REQUEST_MB) {
      return res.status(413).json({
        error: 'الطلب كبير جدًا',
        detail: `الحجم المقدر ~${estMB.toFixed(2)}MB > ${MAX_INLINE_REQUEST_MB}MB (حد inline ~20MB). 
خفّض جودة/دقّة الصور من الواجهة أو استخدم Files API.`,
        docs: [
          'https://ai.google.dev/gemini-api/docs/image-understanding',
          'https://ai.google.dev/gemini-api/docs/files'
        ]
      });
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, topP: 0.95, topK: 40 } // لا تضع responseMimeType هنا
    };

    const response = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    if (!response.ok) {
      console.error('Gemini API Error:', response.status, response.statusText, text);
      if (response.status === 413 || /Request Entity Too Large|Content Too Large/i.test(text)) {
        return res.status(413).json({
          error: 'فشل الاتصال بـ Gemini API بسبب كِبر الحجم',
          detail: 'قلّل حجم الصور أو استخدم Files API.',
          docs: [
            'https://ai.google.dev/gemini-api/docs/image-understanding',
            'https://ai.google.dev/gemini-api/docs/files'
          ]
        });
      }
      return res.status(response.status).json({
        error: 'فشل الاتصال بـ Gemini API',
        status: response.status,
        statusText: response.statusText,
        detail: text.slice(0, 2000)
      });
    }

    let result;
    try { result = JSON.parse(text); }
    catch {
      console.error('Non-JSON response from Gemini:', text.slice(0, 600));
      return res.status(502).json({ error: 'استجابة غير متوقعة من Gemini', detail: text.slice(0, 1200) });
    }

    const rawHtml =
      result?.candidates?.[0]?.content?.parts?.[0]?.text ||
      '<p>⚠️ لم يتمكن النظام من إنشاء التقرير.</p>';

    const finalizedHtml = applySafetyPostProcessing(rawHtml);
    return res.status(200).json({ htmlReport: finalizedHtml });

  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({
      error: 'حدث خطأ في الخادم أثناء تحليل الحالة',
      detail: err.message,
      stack: err.stack
    });
  }
}
