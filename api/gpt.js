// /api/gpt.js — النسخة التحفة/الفولاذية الموحّدة (Stable, Edge-safe, Rich Output)
// يجمع أفضل ما في النسختين:
// - تعليمات غنية (جدول كامل: الغرض الطبي + التداخلات + التخصص المراجع + البدائل + المدد)
// - فرص تحسين بخدمات مع روابط موثوقة (تبقى ظاهرة)
// - دعم uiLang: 'ar' | 'en' | 'both' (للـBilingual PDF فقط من الواجهة)
// - قبول legacy imageData[] و files[] (صور + PDF) مع تقدير حجم لتفادي 413
// - تصحيح النِّسَب % وإضافة risk-* تلقائياً + قص أي كلام قبل <h3> + إزالة أي <style>
// - CORS + Retries + Timeout

const MAX_INLINE_REQUEST_MB = 19.0;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;

// =================== SYSTEM INSTRUCTION (Rich & Strict) ===================
const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين". أخرج تقرير HTML واحد فقط بصياغة احترافية، **دون أي CSS أو <style>**.

[أ] التحليل المطلوب:
1) حلّل النص والصور/الملفات واذكر أي تعارض.
2) اكشف بدقة:
   • الازدواجية العلاجية
   • أخطاء الجرعات (XR/MR أكثر من مرة يوميًا، جرعات غير ملائمة لوظائف الكلى/الكبد، العمر، الحمل)
   • الأدوية عالية الخطورة ومتطلبات الأمان (Metformin/Xigduo XR ⇠ eGFR، Allopurinol ⇠ eGFR + UA ± HLA-B*58:01، Warfarin ⇠ INR)
   • التفاعلات الدوائية الحرجة (مثال: Ciprofloxacin + Warfarin ⇠ خطر نزيف/مراقبة INR)
   • ملاءمة العلاج لوضع CKD/HTN/DM والعمر
   • **المدد غير المناسبة** (مثل صرف 90 يوم لحالة حادة) أو صلاحية تنتهي قريبًا إن وُجدت
   • غياب التشخيص الداعم لكل دواء/إجراء
   • اذكر **بدائل آمنة** عندما توصي بالإيقاف، مع جرعات مقترحة

[ب] جدول الأدوية والإجراءات (إلزامي):
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
<!-- املأ الصفوف اللازمة؛ لا تترك الجدول فارغًا -->
</tbody></table>
- "درجة الخطورة": اكتب النسبة % وأضف كلاس td: risk-high (≥70) / risk-medium (40–69) / risk-low (<40).
- "قرار التأمين" حصراً بإحدى الصيغ الثلاث مع **التخصص المراجع** داخل القرار:
  ❌ قابل للرفض — السبب: […] — وللقبول يلزم: […] — **التخصص المُراجع: […]**
  ⚠️ قابل للمراجعة — السبب: […] — لتحسين فرص القبول: […] — **التخصص المُراجع: […]**
  ✅ مقبول — **التخصص المُراجع: […]**
- إذا أوصيت بإيقاف دواء، قدّم **بديلًا** وجرعة آمنة.

[ج] فرص تحسين الخدمة (مدعومة بالأدلة وروابط مباشرة):
- كل عنصر سطر واحد: **اسم الفحص/الخدمة** — سبب سريري محدد — **رابط مصدر موثوق**.
- فعّل الروابط الشائعة عند انطباق الحالة:
  • HbA1c — https://diabetesjournals.org/care
  • eGFR + UACR — https://kdigo.org/
  • Uric Acid + eGFR ± HLA-B*58:01 — https://rheumatology.org/
  • Potassium + Creatinine — https://www.ahajournals.org/
  • Chest X-ray (CXR) — https://acsearch.acr.org/
  • LDCT سنوي — https://www.uspreventiveservicestaskforce.org/
  • فحص عين شامل — https://diabetesjournals.org/care
  • OCT — https://www.aao.org/preferred-practice-pattern

[د] خطة العمل:
- نقاط مرقمة؛ ابدأ بالإجراءات العاجلة (مثال: K⁺>6.0 ⇒ غلوكونات كالسيوم IV + إنسولين/غلوكوز…).
- اذكر بدائل الأدوية الموقوفة + جرعاتها الآمنة.

[هـ] الخاتمة:
<p><strong>الخاتمة:</strong> هذا التقرير تحليل مبدئي ولا يغني عن مراجعة متخصص.</p>
`;

// =================== PROMPT BUILDER (keeps richness + uiLang) ===================
function buildUserPrompt(caseData = {}) {
  const uiLangLine =
    caseData.uiLang === 'en'  ? 'اكتب التقرير بالإنجليزية فقط.'
  : caseData.uiLang === 'both'? 'اكتب العناوين والتسميات ثنائية اللغة (عربي + إنجليزي) مع محتوى موحّد.'
                              : 'اكتب التقرير بالعربية فقط.';

  const filesInfo = summarizeFilesForPrompt(caseData);

  return `
${uiLangLine}

**بيانات المريض:**
- الاسم: ${caseData.name ?? 'غير محدد'}
- العمر: ${caseData.age ?? 'غير محدد'}
- الجنس: ${caseData.gender ?? 'غير محدد'}
- التشخيصات: ${caseData.diagnosis ?? 'غير محدد'}
- الأدوية/الإجراءات المكتوبة: ${caseData.medications ?? 'غير محدد'}
- الملاحظات الإضافية: ${caseData.notes ?? 'غير محدد'}

**التحاليل/القيم:**
- eGFR: ${caseData.eGFR ?? 'غير محدد'}
- HbA1c: ${caseData.hba1c ?? 'غير محدد'}
- البوتاسيوم (K+): ${caseData.k ?? 'غير محدد'}
- الكرياتينين (Cr): ${caseData.cr ?? 'غير محدد'}
- Uric Acid (UA): ${caseData.ua ?? 'غير محدد'}
- INR: ${caseData.inr ?? 'غير محدد'}

**نمط حياة وأعراض:**
- مدخّن: ${caseData.isSmoker === true ? 'نعم' : (caseData.isSmoker === false ? 'لا' : 'غير محدد')}
- باك-سنة: ${caseData.smokingPackYears ?? 'غير محدد'}
- مدة السعال (أسابيع): ${caseData.coughDurationWeeks ?? 'غير محدد'}
- أعراض بصرية: ${caseData.visualSymptoms ?? 'غير محدد'}
- آخر فحص قاع عين: ${caseData.lastEyeExamDate ?? 'غير محدد'}
- حدة البصر: ${caseData.visualAcuity ?? 'غير محدد'}

**الملفات المرفوعة:**
${filesInfo}
`;
}

function summarizeFilesForPrompt(caseData) {
  const files = []
    .concat(Array.isArray(caseData.files) ? caseData.files : [])
    .concat(Array.isArray(caseData.imageData) ? caseData.imageData.map(b64 => ({ type:'image/jpeg', base64:b64, name:'image.jpg' })) : []);
  if (!files.length) return '- لا توجد ملفات.';
  const lines = files.slice(0, 12).map((f, i) => {
    const mime = f.type || ((f.name||'').toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
    const label = mime.startsWith('image/') ? 'صورة' : (mime === 'application/pdf' ? 'PDF' : 'ملف');
    const name = f.name || `attachment-${i+1}`;
    const approxKB = Math.round(((f.base64?.length || 0) * 3) / 4 / 1024);
    return `- ${label}: ${name} (~${approxKB}KB)`;
  });
  return lines.join('\n');
}

// =================== HELPERS ===================
const _encoder = new TextEncoder();
const byteLengthUtf8 = (s) => _encoder.encode(s || '').length;

function estimateInlineRequestMB(parts) {
  let bytes = 0;
  for (const p of parts) {
    if (p.text) bytes += byteLengthUtf8(p.text);
    if (p.inline_data?.data) bytes += Math.floor((p.inline_data.data.length * 3) / 4);
  }
  return bytes / (1024 * 1024);
}

function stripStyles(html) {
  try { return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ''); }
  catch { return html; }
}

function applySafetyPostProcessing(html) {
  try {
    html = String(html || '');
    // أضف % إن سقطت
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi,
      (_m, o, n, _s, c) => `${o}${n}%${c}`);
    // أضف كلاس الخطر إن غير موجود
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_m, open, numStr, close) => {
        const v = parseInt(numStr, 10);
        const klass = v >= 70 ? 'risk-high' : v >= 40 ? 'risk-medium' : 'risk-low';
        return open.replace('<td', `<td class="${klass}"`) + `${numStr}%` + close;
      });
    // ابدأ من أول <h3> وقص أي مقدمة
    const i = html.indexOf('<h3'); if (i > 0) html = html.slice(i);
    // أزل أي <style> تسرب
    html = stripStyles(html);
    return html;
  } catch {
    return html;
  }
}

async function fetchWithRetry(url, options, { retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok && retries > 0 && RETRY_STATUS.has(res.status)) {
      await new Promise(r => setTimeout(r, (3 - retries) * 800));
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// =================== HANDLER ===================
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

    const body = req.body || {};
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

    const parts = [{ text: systemInstruction }, { text: buildUserPrompt(body) }];

    // دعم الملفات الحديثة والقديمة
    const attachments = [];
    if (Array.isArray(body.files)) {
      for (const f of body.files) {
        if (!f || typeof f.base64 !== 'string') continue;
        let mime = f.type || '';
        if (!mime) mime = (f.name || '').toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
        attachments.push({ mimeType: mime, data: f.base64 });
      }
    }
    if (Array.isArray(body.imageData)) {
      for (const b64 of body.imageData) {
        if (typeof b64 === 'string' && b64.length > 0) attachments.push({ mimeType: 'image/jpeg', data: b64 });
      }
    }
    for (const a of attachments) parts.push({ inline_data: a });

    // حارس الحجم
    const estMB = estimateInlineRequestMB(parts);
    if (estMB > MAX_INLINE_REQUEST_MB) {
      return res.status(413).json({
        error: 'الطلب كبير جداً',
        detail: `الحجم ~${estMB.toFixed(2)}MB > ${MAX_INLINE_REQUEST_MB}MB. قلل حجم/عدد الملفات أو استخدم Files API.`,
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
    }, { retries: 2, timeoutMs: DEFAULT_TIMEOUT_MS });

    const text = await response.text();

    if (!response.ok) {
      console.error('Gemini API Error:', response.status, response.statusText, text);
      if (response.status === 413) {
        return res.status(413).json({
          error: 'فشل الاتصال بـ Gemini API بسبب كبر الحجم',
          detail: 'قلل حجم الملفات أو استخدم Files API.'
        });
      }
      return res.status(response.status).json({
        error: 'فشل الاتصال بـ Gemini API',
        detail: text.slice(0, 2000),
      });
    }

    let json;
    try { json = JSON.parse(text); }
    catch {
      console.error('Non-JSON response from Gemini:', text.slice(0, 600));
      return res.status(502).json({ error: 'استجابة غير متوقعة من Gemini', detail: text.slice(0, 1200) });
    }

    const rawHtml =
      json?.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text
      || '<p>⚠️ لم يتمكن النظام من إنشاء التقرير.</p>';

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
