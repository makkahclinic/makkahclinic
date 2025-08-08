// /api/gpt.js — النسخة التحفة النهائية (Stable, Edge-safe)
// مزايا: كشف أخطاء حرجة، بدائل علاجية، جدول بالألوان + تخصص مراجع، فرص تحسين بخدمات ورابط، تفادي 413، تصحيح تلقائي للكلاسات، Timeout + Retries

const MAX_INLINE_REQUEST_MB = 19.0; // هامش أمان أقل من حد 20MB لصور inline
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;

// =================== SYSTEM INSTRUCTION ===================
const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري. أخرج تقرير HTML واحد فقط بصياغة احترافية، دون أي CSS أو <style>.

[أ] التحليل المطلوب:
1) تحليل النص والصور، ذكر أي تعارض.
2) كشف:
   • الازدواجية العلاجية
   • أخطاء الجرعات (XR/MR أكثر من مرة يوميًا)
   • أمان الأدوية عالية الخطورة (Metformin/Xigduo XR ⇠ eGFR، Allopurinol ⇠ eGFR + UA ± HLA-B*58:01، Warfarin ⇠ INR)
   • التفاعلات الدوائية (مثال: Ciprofloxacin + Warfarin ⇠ نزيف)
   • مطابقة العلاج للحالة الكلوية/الكبدية والضغط والعمر
   • مدة صرف غير ملائمة (90 يوم لمرض حاد)
   • غياب التشخيص الداعم

[ب] جدول الأدوية والإجراءات:
- الأعمدة: الدواء/الإجراء | الجرعة الموصوفة | الجرعة الصحيحة المقترحة | التصنيف | الغرض الطبي | التداخلات | درجة الخطورة (%) | قرار التأمين
- درجة الخطورة: مع % + كلاس risk-high / risk-medium / risk-low
- قرار التأمين بصيغة:
  ❌ قابل للرفض — السبب: […] — وللقبول يلزم: […] — **التخصص المُراجع: […]**
  ⚠️ قابل للمراجعة — السبب: […] — لتحسين فرص القبول: […] — **التخصص المُراجع: […]**
  ✅ مقبول — **التخصص المُراجع: […]**
- ذكر البدائل العلاجية عند الإيقاف.

[ج] فرص تحسين الخدمة:
- صيغة: **اسم الفحص/الخدمة** — سبب سريري محدد — منفعة للمريض — منفعة للعيادة — **رابط مصدر طبي موثوق**
- تفعيل البنود الشائعة مع روابط:
  • HbA1c — https://diabetesjournals.org/care
  • eGFR + UACR — https://kdigo.org/
  • Uric Acid + eGFR ± HLA-B*58:01 — https://rheumatology.org/
  • Potassium + Creatinine — https://www.ahajournals.org/
  • Chest X-ray (CXR) — https://acsearch.acr.org/
  • LDCT سنوي — https://www.uspreventiveservicestaskforce.org/
  • فحص عين شامل — https://diabetesjournals.org/care
  • OCT — https://www.aao.org/preferred-practice-pattern

[د] خطة العمل:
- نقاط مرقمة، مع إجراءات عاجلة أولاً (مثل علاج فرط بوتاسيوم >6.0: غلوكونات كالسيوم IV + إنسولين/غلوكوز + غسيل كلوي عاجل)
- ذكر بدائل الأدوية الموقوفة + الجرعات الآمنة.

[هـ] الخاتمة:
<p><strong>الخاتمة:</strong> هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص.</p>
`;

// =================== PROMPT BUILDER ===================
function buildUserPrompt(caseData = {}) {
  return `
**بيانات المريض:**
- الاسم: ${caseData.name ?? 'غير محدد'}
- العمر: ${caseData.age ?? 'غير محدد'}
- الجنس: ${caseData.gender ?? 'غير محدد'}
- التشخيصات: ${caseData.diagnosis ?? 'غير محدد'}
- الأدوية/الإجراءات المكتوبة: ${caseData.medications ?? 'غير محدد'}
- الملاحظات الإضافية: ${caseData.notes ?? 'غير محدد'}

**التحاليل:**
- eGFR: ${caseData.eGFR ?? 'غير محدد'}
- البوتاسيوم: ${caseData.k ?? 'غير محدد'}
- الكرياتينين: ${caseData.cr ?? 'غير محدد'}
- HbA1c: ${caseData.hba1c ?? 'غير محدد'}
- Uric Acid: ${caseData.ua ?? 'غير محدد'}

**الصور المرفقة:**
- ${Array.isArray(caseData.imageData) && caseData.imageData.length > 0 ? 'يوجد صور' : 'لا توجد صور'}
`;
}

// =================== HELPERS ===================
const _encoder = new TextEncoder();
function byteLengthUtf8(str) { return _encoder.encode(str || '').length; }

function estimateInlineRequestMB(parts) {
  let bytes = 0;
  for (const p of parts) {
    if (p.text) bytes += byteLengthUtf8(p.text);
    if (p.inline_data?.data) bytes += Math.floor((p.inline_data.data.length * 3) / 4);
  }
  return bytes / (1024 * 1024);
}

function applySafetyPostProcessing(html) {
  try {
    html = String(html || '');
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi,
      (_, o, n, _s, c) => `${o}${n}%${c}`);
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_, open, num, close) => {
        const v = parseInt(num, 10);
        const klass = v >= 70 ? 'risk-high' : v >= 40 ? 'risk-medium' : 'risk-low';
        return open.replace('<td', `<td class="${klass}"`) + `${num}%` + close;
      });
    const i = html.indexOf('<h3');
    if (i > 0) html = html.slice(i);
    return html;
  } catch {
    return html;
  }
}

async function fetchWithRetry(url, options, { retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok && retries > 0 && RETRY_STATUS.has(res.status)) {
      await new Promise(r => setTimeout(r, (3 - retries) * 800));
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return res;
  } finally {
    clearTimeout(id);
  }
}

// =================== HANDLER ===================
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

    if (Array.isArray(req.body?.imageData)) {
      for (const img of req.body.imageData) {
        if (typeof img === 'string' && img.length > 0) {
          parts.push({ inline_data: { mimeType: 'image/jpeg', data: img } });
        }
      }
    }

    const estMB = estimateInlineRequestMB(parts);
    if (estMB > MAX_INLINE_REQUEST_MB) {
      return res.status(413).json({
        error: 'الطلب كبير جداً',
        detail: `الحجم ~${estMB.toFixed(2)}MB > ${MAX_INLINE_REQUEST_MB}MB. قلل حجم الصور أو استخدم Files API.`,
      });
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, topP: 0.95, topK: 40 }
    };

    const response = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    if (!response.ok) {
      if (response.status === 413) {
        return res.status(413).json({
          error: 'فشل الاتصال بـ Gemini API بسبب كبر الحجم',
          detail: 'قلل حجم الصور أو استخدم Files API.'
        });
      }
      return res.status(response.status).json({
        error: 'فشل الاتصال بـ Gemini API',
        detail: text.slice(0, 2000)
      });
    }

    let result;
    try { result = JSON.parse(text); }
    catch {
      return res.status(502).json({ error: 'استجابة غير متوقعة من Gemini', detail: text.slice(0, 1000) });
    }

    const rawHtml = result?.candidates?.[0]?.content?.parts?.[0]?.text || '<p>⚠️ لم يتمكن النظام من إنشاء التقرير.</p>';
    const finalizedHtml = applySafetyPostProcessing(rawHtml);

    return res.status(200).json({ htmlReport: finalizedHtml });

  } catch (err) {
    return res.status(500).json({ error: 'حدث خطأ في الخادم', detail: err.message });
  }
}
