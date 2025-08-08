// /api/gpt.js – النسخة الفولاذيّة النهائية (Edge-safe, no Buffer)
// مزايا: retries/timeout، تفادي 413، تصحيح تلقائي للكلاسات/النِّسَب٪، تعليمات إلزامية لذكر "التخصص المراجع" وروابط مصادر في فرص تحسين الخدمة.

const MAX_INLINE_REQUEST_MB = 19.0;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;

// ================ System Instruction (The Steel Edition) ================
const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري فائق الدقة. مهمتك إنتاج تقرير HTML واحد فقط، احترافي، وعميق التحليل.

[أ] منهجية التحليل الإلزامية
1) حلّل جميع البيانات النصّيّة والصُّوَر. إن تعارض النص مع الصورة فاذكر ذلك كملاحظة حرجة وحدّد أيّهما يُعتمد ولماذا.
2) افحص بدقة وعمق، مع ذكر التفاصيل السريرية:
   • **الازدواجية العلاجية** (ضغط/سكر/دوار…).
   • **أخطاء الجرعات** (XR/MR أكثر من مرة يوميًا، جرعات غير مناسبة لوظائف الكلى).
   • **أمان الأدوية في سياق الحالة:** تحقق من كل دواء مقابل وظائف الكلى (eGFR)، وظائف الكبد، الحمل، والعمر. (مثال: Ciprofloxacin يتطلب تعديل جرعة مع eGFR < 50).
   • **التفاعلات الدوائية الحرجة:** (مثال: Ciprofloxacin + Warfarin ⇒ يزيد خطر النزيف ويتطلب مراقبة INR يوميًا).
   • **وجود تشخيص داعم** لكل دواء/إجراء.
   • **اقتراح بدائل آمنة:** عند التوصية بإيقاف دواء ضروري (مثل مسكن ألم)، اقترح بديلاً أكثر أمانًا (مثل Paracetamol بدلاً من Ibuprofen في حالة القصور الكلوي).

[ب] قواعد مخاطبة التأمين الإلزامية
- لكل صف في الجدول: احسب "درجة الخطورة" (0–100%) واكتب علامة %.
- طبّق class لوني على <td> في عمودي "درجة الخطورة" و"قرار التأمين":
  • risk-high إذا الدرجة ≥ 70%  • risk-medium إذا 40–69%  • risk-low إذا < 40%
- صيّغ "قرار التأمين" حصراً بإحدى الصيغ الثلاث واذكر **التخصص المراجع** داخل القرار:
  • ❌ قابل للرفض — السبب: [طبي/إجرائي محدد] — وللقبول يلزم: [تشخيص/فحص/تعديل جرعة/إلغاء ازدواجية…] — **التخصص المُراجع: [مثال: كلى/قلب/غدد/أمراض معدية]**
  • ⚠️ قابل للمراجعة — السبب: […] — لتحسين فرص القبول: […] — **التخصص المُراجع: […]**
  • ✅ مقبول — **التخصص المُراجع (إن لزم): […]**

[ج] بنية HTML المطلوبة (لا CSS ولا <style>)
1) <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
2) <h4>ملخص الحالة</h4><p>لخّص العمر/الجنس/التشخيصات/الملاحظات الحرجة.</p>
3) <h4>التحليل السريري العميق</h4><p>اشرح الأخطاء الرئيسية واربطها بالحالة (CKD/ضغط/عمر/دواء XR…)، واذكر فحوص الأمان اللازمة (eGFR/UA/K/Cr/INR...).</p>
4) <h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr>
<th>الدواء/الإجراء</th>
<th>الجرعة الموصوفة</th>
<th>الجرعة الصحيحة المقترحة</th>
<th>التصنيف</th>
<th>درجة الخطورة (%)</th>
<th>قرار التأمين</th>
</tr></thead><tbody>
</tbody></table>

[د] فرص تحسين الخدمة (مدعومة بالأدلة الإلزامية)
- قائمة نقطية؛ لكل عنصر سطر واحد بالصيغة:
  **اسم الفحص/الخدمة** — سبب سريري محدد (مرتبط بعمر/أعراض/مرض/دواء) — **مصدر موثوق + رابط مباشر**.
- فعّل البنود التالية عندما تنطبق محفزاتها (مع روابط إلزامية):
  • سكري نوع 2 ⇒ **HbA1c** كل 3 أشهر إن غير منضبط — **ADA Standards of Care**: https://diabetesjournals.org/care
  • Metformin/Xigduo XR أو سكري/CKD ⇒ **eGFR + UACR** — **KDIGO**: https://kdigo.org/
  • Allopurinol ⇒ **Uric Acid + eGFR ± HLA-B*58:01** — **ACR Gout**: https://www.rheumatology.org/
  • ACEi/ARB + Spironolactone أو CKD ⇒ **Potassium + Creatinine خلال 1–2 أسبوع** — **ACC/AHA**: https://www.ahajournals.org/
  • سعال مزمن (>8 أسابيع) أو مدخّن ≥40 سنة ⇒ **Chest X-ray (CXR)** — **ACR Appropriateness**: https://acsearch.acr.org/
  • مدخّن 50–80 سنة مع ≥20 باك-سنة ⇒ **LDCT سنوي** — **USPSTF**: https://www.uspreventiveservicestaskforce.org/

[هـ] خطة العمل (يجب أن تكون إجرائية ومحددة)
- قائمة مرقمة بتصحيحات فورية دقيقة.
- مثال: "1. إعطاء غلوكونات الكالسيوم IV فوراً لفرط البوتاسيوم (K⁺>6.0)."
- مثال: "2. استبدال الإيبوبروفين بباراسيتامول (بحد أقصى 3 جم/يوم)."
- مثال: "3. تعديل جرعة السيبروفلوكساسين لـ 250mg مرتين يومياً بناءً على eGFR."

[و] الخاتمة
<p><strong>الخاتمة:</strong> هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص.</p>
`;

// ================ Prompt Builder ================
function buildUserPrompt(caseData = {}) {
  return `
**بيانات المريض (مدخل يدويًا):**
- العمر: ${caseData.age ?? 'غير محدد'}
- الجنس: ${caseData.gender ?? 'غير محدد'}
- التشخيصات: ${caseData.diagnosis ?? 'غير محدد'}
- الأدوية/الإجراءات المكتوبة: ${caseData.medications ?? 'غير محدد'}
- ملاحظات إضافية: ${caseData.notes ?? 'غير محدد'}

**نتائج مخبرية (اختياري):**
- eGFR: ${caseData.eGFR ?? 'غير محدد'}
- HbA1c: ${caseData.hba1c ?? 'غير محدد'}
- Potassium (K+): ${caseData.k ?? 'غير محدد'}
- Creatinine (Cr): ${caseData.cr ?? 'غير محدد'}
- Uric Acid (UA): ${caseData.ua ?? 'غير محدد'}
- INR: ${caseData.inr ?? 'غير محدد'}

**معلومات إضافية:**
- مدخّن: ${caseData.isSmoker === true ? 'نعم' : 'لا'}
- باك-سنة: ${caseData.smokingPackYears ?? 'غير محدد'}
- مدة السعال (أسابيع): ${caseData.coughDurationWeeks ?? 'غير محدد'}

**الملفات المرفوعة:**
- ${Array.isArray(caseData.imageData) && caseData.imageData.length > 0 ? 'يوجد صور مرفقة للتحليل.' : 'لا توجد صور مرفقة.'}
`;
}

// ================ Helpers ================
const _encoder = new TextEncoder();
function byteLengthUtf8(str) { return _encoder.encode(str || '').length; }

function estimateInlineRequestMB(parts) {
  let bytes = 0;
  for (const p of parts) {
    if (p.text) bytes += byteLengthUtf8(p.text);
    if (p.inline_data?.data) {
      const len = p.inline_data.data.length;
      bytes += Math.floor((len * 3) / 4);
    }
  }
  return bytes / (1024 * 1024);
}

function applySafetyPostProcessing(html) {
  try {
    html = String(html || '');
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi, (_m, o, n, _s, c) => `${o}${n}%${c}`);
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_m, open, numStr, close) => {
        const v = parseInt(numStr, 10);
        const klass = v >= 70 ? 'risk-high' : v >= 40 ? 'risk-medium' : 'risk-low';
        return open.replace('<td', `<td class="${klass}"`) + `${numStr}%` + close;
      });
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
      await new Promise(r => setTimeout(r, (3 - retries) * 800));
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ================ API Handler ================
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
        error: 'الطلب كبير جدًا',
        detail: `الحجم المقدر ~${estMB.toFixed(2)}MB. خفّض جودة الصور أو استخدم Files API.`,
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
      console.error('Gemini API Error:', response.status, response.statusText, text);
      return res.status(response.status).json({
        error: 'فشل الاتصال بـ Gemini API',
        detail: text.slice(0, 2000),
      });
    }

    let result;
    try { result = JSON.parse(text); }
    catch {
      console.error('Non-JSON response from Gemini:', text.slice(0, 600));
      return res.status(502).json({ error: 'استجابة غير متوقعة من Gemini', detail: text.slice(0, 1200) });
    }

    const rawHtml = result?.candidates?.[0]?.content?.parts?.[0]?.text || '<p>⚠️ لم يتمكن النظام من إنشاء التقرير.</p>';
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
