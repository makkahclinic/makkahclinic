// /api/gpt.js – النسخة الممتازة النهائية (مضادة لـ 413، مع retries/timeout وتصحيح تلقائي للكلاسات)

const MAX_INLINE_REQUEST_MB = 19.0; // أقل من 20MB كهوامش أمان لقيود Gemini على inline data
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;

const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري. أخرج تقرير HTML واحد فقط (كتلة واحدة) وفق القواعد التالية:

[أ] منهجية إلزامية مختصرة
1) حلّل كل البيانات النصية والصورية. إن وُجد تعارض نص/صورة فاذكره كملاحظة حرجة.
2) تحقّق بدقة من:
   • الازدواجية العلاجية (خصوصًا أدوية الضغط)
   • أخطاء الجرعات (مثل أدوية XR/MR تؤخذ أكثر من مرة يوميًا)
   • أدوية عالية الخطورة ومتطلبات فحوصها (مثال: Xigduo XR ⇠ eGFR، Allopurinol ⇠ eGFR/UA)
   • المبرر السريري لكل دواء/إجراء (يجب وجود تشخيص داعم)
   • المكملات الغذائية (غالبًا غير مغطاة تأمينيًا)
   • مدة الصرف غير الملائمة (مثال 90 يوم لعدوى حادة)

[ب] قواعد مخاطبة التأمين (إلزامية)
- لكل عنصر في الجدول:
  1) احسب "درجة الخطورة" كنسبة مئوية 0–100% واكتب الرمز %.
  2) طبّق class على <td> لعمود "درجة الخطورة" وعمود "قرار التأمين":
       • risk-high إذا الدرجة ≥ 70%
       • risk-medium إذا 40–69%
       • risk-low إذا < 40%
  3) عمود "قرار التأمين" إلزامي وبالصيغة:
       • ❌ قابل للرفض — السبب: [سبب طبي/إجرائي محدد]
         — وللقبول يلزم: [تشخيص/فحص/تعديل جرعة/إلغاء ازدواجية…]
       • ⚠️ قابل للمراجعة — السبب: […]
         — لتحسين فرص القبول: […]
       • ✅ مقبول
  4) إن كان الدواء/الإجراء بلا تشخيص داعم، اذكر ذلك صراحة داخل القرار.

[ج] بنية HTML مطلوبة (لا تضف CSS ولا <style>)
1) <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
2) <h4>ملخص الحالة</h4><p>…</p>
3) <h4>التحليل السريري العميق</h4><p>… اربط كل ملاحظة بالتشخيصات …</p>
4) <h4>جدول الأدوية والإجراءات</h4>
   جدول بالأعمدة:
   - الدواء/الإجراء
   - الجرعة الموصوفة
   - الجرعة الصحيحة المقترحة (اكتب "إيقاف" إن كان غير مبرر)
   - التصنيف (دواء | مكمل | جهاز فحص | كريم موضعي | إجراء تشخيصي | إجراء تداخلي)
   - الغرض الطبي
   - التداخلات
   - درجة الخطورة (%)  ← ضع class مناسب (risk-high/medium/low) على <td>
   - قرار التأمين      ← ضع class مناسب (risk-high/medium/low) على <td> وبالصيغ المعيارية
5) <h4>فرص تحسين الرعاية</h4><ul><li>…</li></ul>
6) <h4>خطة العمل</h4><ol><li>…</li></ol>
7) <p><strong>الخاتمة:</strong> هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص.</p>
`;

function buildUserPrompt(caseData) {
  return `
**بيانات المريض (مدخل يدويًا):**
- العمر: ${caseData.age || 'غير محدد'}
- الجنس: ${caseData.gender || 'غير محدد'}
- التشخيصات: ${caseData.diagnosis || 'غير محدد'}
- الأدوية/الإجراءات المكتوبة: ${caseData.medications || 'غير محدد'}
- ملاحظات إضافية: ${caseData.notes || 'غير محدد'}

**الملفات المرفوعة:**
- ${Array.isArray(caseData.imageData) && caseData.imageData.length > 0 ? 'يوجد صور مرفقة للتحليل.' : 'لا توجد صور مرفقة.'}
`;
}

// تقدير حجم الطلب بالميجابايت (Base64 = يزيد ~33%)
function estimateInlineRequestMB(parts) {
  let bytes = 0;
  for (const p of parts) {
    if (p.text) bytes += Buffer.byteLength(p.text, 'utf8');
    if (p.inline_data?.data) {
      // Base64 → bytes ≈ length * 3/4
      const len = p.inline_data.data.length;
      bytes += Math.floor(len * 3 / 4);
    }
  }
  return bytes / (1024 * 1024);
}

/** تصحيح ذاتي: يضيف الكلاسات حسب النسبة إذا نسيها النموذج، ويضمن وجود % */
function applySafetyPostProcessing(html) {
  try {
    // أضف % إن نُسيت
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi, (_m, o, n, _s, c) => `${o}${n}%${c}`);
    // أضف الكلاس حسب النسبة إن لم يوجد class
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_m, open, numStr, close) => {
        const num = parseInt(numStr, 10);
        const klass = num >= 70 ? 'risk-high' : num >= 40 ? 'risk-medium' : 'risk-low';
        return open.replace('<td', `<td class="${klass}"`) + `${num}%` + close;
      });
    // يضمن كتلة HTML واحدة (يحذف أي شيء قبل أول <h3> وبعد آخر </p> إن لزم)
    const first = html.indexOf('<h3');
    if (first > 0) html = html.slice(first);
    const lastP = html.lastIndexOf('</p>');
    if (lastP > 0 && lastP < html.length - 4) html = html.slice(0, lastP + 4);
    return html;
  } catch (e) {
    console.error('Post-processing failed:', e);
    return html;
  }
}

// fetch مع timeout + retries لرموز معيّنة
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

    // جهّز الأجزاء
    const userPrompt = buildUserPrompt(req.body || {});
    const parts = [{ text: systemInstruction }, { text: userPrompt }];

    if (Array.isArray(req.body?.imageData)) {
      for (const img of req.body.imageData) {
        if (typeof img === 'string' && img.length > 0) {
          parts.push({ inline_data: { mimeType: 'image/jpeg', data: img } });
        }
      }
    }

    // فحص حجم الطلب لتجنّب 413 وحدّ 20MB للـ inline images في Gemini
    const estMB = estimateInlineRequestMB(parts);
    if (estMB > MAX_INLINE_REQUEST_MB) {
      return res.status(413).json({
        error: 'الطلب كبير جدًا',
        detail: `حجم الطلب المقدر ~${estMB.toFixed(2)}MB، تجاوز حد الأمان ${MAX_INLINE_REQUEST_MB}MB للصور inline. 
ننصح برفع الصور بدقة/جودة أقل من الواجهة الأمامية أو استخدام Files API للصور الكبيرة.`,
        docs: [
          'Limits for inline image data in Gemini (20MB total).',
          'Consider sending images via Files API for large payloads.'
        ]
      });
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2, topP: 0.95, topK: 40,
        // جرّب إجبار المخرجات HTML فقط
        responseMimeType: 'text/html'
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
      // 413 من جهة Google (كبير جدًا)
      if (response.status === 413 || /Request Entity Too Large|Content Too Large/i.test(text)) {
        return res.status(413).json({
          error: 'فشل الاتصال بـ Gemini API بسبب كِبر الحجم',
          detail: 'قلّل حجم الصور أو استخدم Files API.',
          docs: [
            'Inline image total request size limit is 20MB.',
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
      console.error('Non-JSON response from Gemini:', text.slice(0, 500));
      return res.status(502).json({ error: 'استجابة غير متوقعة من Gemini', detail: text.slice(0, 1000) });
    }

    const rawHtml = result?.candidates?.[0]?.content?.parts?.[0]?.text ||
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
