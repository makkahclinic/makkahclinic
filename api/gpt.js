// /api/gpt.js — النسخة المطورة جداً (تشمل كشف التفاعلات + البدائل + خطط عاجلة)

const MAX_INLINE_REQUEST_MB = 19.0;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60000;

const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري. أخرج تقرير HTML واحد فقط (كتلة واحدة) دون أي CSS أو <style>.

[تحليل إلزامي]
1) حلّل النص والصور. إذا تعارضت، اذكر التعارض وحدد أيهما يُعتمد.
2) تحقق من:
   - الازدواجية العلاجية.
   - أخطاء الجرعات (XR/MR أكثر من مرة/يوم، فوروسيميد عالي الجرعة).
   - أمان الأدوية عالية الخطورة (Metformin/Xigduo XR ⇠ eGFR، Allopurinol ⇠ eGFR + UA ± HLA-B*58:01، Spironolactone ⇠ K، NSAIDs ⇠ CKD).
   - تفاعل Ciprofloxacin–Warfarin: يزيد خطر النزيف ⇒ يتطلب مراقبة INR يومياً أثناء المشاركة.
   - Ciprofloxacin مع CKD (eGFR < 50) ⇒ تعديل الجرعة (مثال: 250mg مرتين يومياً).
   - بدائل دوائية: 
        • إيبوبروفين ⇢ باراسيتامول (≤ 3g/يوم) إذا لا موانع.
        • سبيرونولاكتون مع فرط بوتاسيوم ⇢ مدرات ثيازيد إذا مناسب.
   - خطط عاجلة: 
        • فرط بوتاسيوم ≥ 6.0 ⇒ غلوكونات الكالسيوم IV فوراً + إنسولين/غلوكوز + اعتبارات غسيل كلوي عاجل.

[بنية التقرير]
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><p>…</p>
<h4>التحليل السريري العميق</h4><p>…</p>
<h4>جدول الأدوية والإجراءات</h4>
<table>…</table>
<h4>فرص تحسين الخدمة ورفع مستوى الدخل</h4>
<ul>
<li>**الفحص/الخدمة** — سبب سريري — منفعة للمريض — منفعة للعيادة — **مصدر + رابط**</li>
</ul>
<h4>خطة العمل</h4>
<ol><li>…</li></ol>
<p><strong>الخاتمة:</strong> هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص.</p>

[تفاصيل خطة العمل الإلزامية]
- حدد بدائل آمنة عند إيقاف الأدوية (مثال: باراسيتامول بدل NSAID، مدر ثيازيد بدل MRA عند فرط K⁺).
- حدد جرعات معدلة (Ciprofloxacin مع CKD).
- حدد إجراءات عاجلة لفرط K⁺ ≥ 6.0.
- حدد تواتر مراقبة INR (يوميًا عند مشاركة Ciprofloxacin + Warfarin).
`;

function buildUserPrompt(caseData = {}) {
  return `
**بيانات المريض:**
- الاسم: ${caseData.name || 'غير محدد'}
- العمر: ${caseData.age || 'غير محدد'}
- الجنس: ${caseData.gender || 'غير محدد'}
- الوزن: ${caseData.weight || 'غير محدد'}
- الطول: ${caseData.height || 'غير محدد'}
- التشخيصات: ${caseData.diagnosis || 'غير محدد'}
- الأدوية: ${caseData.medications || 'غير محدد'}
- العلامات الحيوية: ${caseData.vitals || 'غير محدد'}
- الفحوصات: ${caseData.labs || 'غير محدد'}
- ملاحظات إضافية: ${caseData.notes || 'غير محدد'}

**الملفات المرفوعة:**
- ${Array.isArray(caseData.imageData) && caseData.imageData.length > 0 ? 'يوجد صور مرفقة للتحليل' : 'لا توجد صور'}
`;
}

function byteLengthUtf8(str) {
  return new TextEncoder().encode(str || '').length;
}

function estimateInlineRequestMB(parts) {
  let bytes = 0;
  for (const p of parts) {
    if (p.text) bytes += byteLengthUtf8(p.text);
    if (p.inline_data?.data) {
      const len = p.inline_data.data.length;
      bytes += Math.floor(len * 3 / 4);
    }
  }
  return bytes / (1024 * 1024);
}

function applySafetyPostProcessing(html) {
  try {
    html = String(html || '');
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi,
      (_m, o, n, _s, c) => `${o}${n}%${c}`);
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_m, open, numStr, close) => {
        const v = parseInt(numStr, 10);
        const klass = v >= 70 ? 'risk-high' : v >= 40 ? 'risk-medium' : 'risk-low';
        return open.replace('<td', `<td class="${klass}"`) + `${numStr}%` + close;
      });
    const i = html.indexOf('<h3');
    if (i > 0) html = html.slice(i);
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
        detail: `الحجم ~${estMB.toFixed(2)}MB > ${MAX_INLINE_REQUEST_MB}MB.`
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
      return res.status(response.status).json({ error: text });
    }

    let result;
    try { result = JSON.parse(text); }
    catch {
      return res.status(502).json({ error: 'استجابة غير متوقعة من Gemini', detail: text });
    }

    const rawHtml = result?.candidates?.[0]?.content?.parts?.[0]?.text ||
      '<p>⚠️ لم يتمكن النظام من إنشاء التقرير.</p>';

    const finalizedHtml = applySafetyPostProcessing(rawHtml);
    return res.status(200).json({ htmlReport: finalizedHtml });

  } catch (err) {
    return res.status(500).json({
      error: 'حدث خطأ في الخادم أثناء تحليل الحالة',
      detail: err.message
    });
  }
}
