// /api/gpt.js — النسخة النهائية المحسّنة (Edge-safe, no Buffer, no responseMimeType)
// ميزات: تعليمات طبية صارمة، كشف تداخلات موسّع، فرض ربط الأعراض بالخدمات (CXR/LDCT)،
// حماية 413، retries/timeout، وتصحيح تلقائي للكلاسات والنِسَب٪.

const MAX_INLINE_REQUEST_MB = 19.0; // هامش أمان تحت حد ~20MB للصور inline
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;

// ===================== System Instruction =====================
const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري. أخرج تقرير HTML واحد فقط (كتلة واحدة) بصياغة احترافية، دون أي CSS أو <style>.

[أ] منهجية إلزامية مختصرة
1) حلّل كل البيانات النصّيّة والصُّوَر. إن تعارض النص مع الصورة فاذكر ذلك كملاحظة حرجة وحدّد أيّهما يُعتمد ولماذا.
2) افحص بدقة وعلى نحو صريح:
   • الازدواجية العلاجية: السكري، الضغط، مضادات التخثّر/الصفائح، المضادات الحيوية.
   • أخطاء الجرعات: XR/MR تُعطى أكثر من مرّة يوميًا، جرعات عالية في CKD، وصف طويل لحالات حادّة.
   • أمان الأدوية عالية الخطورة وفحوصها:
       - Metformin/Xigduo XR ⇠ eGFR
       - Allopurinol ⇠ eGFR + Uric Acid ± HLA-B*58:01
       - ACEi/ARB أو Spironolactone ⇠ Potassium + Creatinine (بعد 1–2 أسبوع من البدء/التعديل)
   • التداخلات الدوائية الحرجة (أذكرها بالاسم):
       - "الضربة الثلاثية": ACEi/ARB + Spironolactone (أو أي MRA) + NSAID ⇒ خطر AKI/HyperK
       - Simvastatin مع Clarithromycin/erythromycin/azole (CYP3A4) ⇒ خطر انحلال ربيدات
       - تعدد مضادات التخثّر/الصفائح (Warfarin + NOAC + Aspirin/Clopidogrel)
       - ازدواجية المضادات الحيوية لنفس التشخيص
   • وجود تشخيص داعم لكل دواء/إجراء. إن غاب التشخيص اذكر ذلك صراحة.
   • تعارضات المختبر الحرجة: مثال اختلاف eGFR بين قياسات حديثة — اعتبر الأحدث Red Flag واذكره في التحليل السريري.

[ب] قواعد مخاطبة التأمين (إلزامية)
- لكل صف في الجدول: احسب "درجة الخطورة" (0–100%) واكتب علامة %.
- طبّق كلاس لوني على <td> في عمودي "درجة الخطورة" و"قرار التأمين":
  • risk-high إذا الدرجة ≥ 70%  • risk-medium إذا 40–69%  • risk-low إذا < 40%
- صِغ "قرار التأمين" حصراً بإحدى الصيغ:
  • ❌ قابل للرفض — السبب: [طبي/إجرائي محدد] — وللقبول يلزم: [تشخيص/فحص/تعديل جرعة/إلغاء ازدواجية…]
  • ⚠️ قابل للمراجعة — السبب: […] — لتحسين فرص القبول: […]
  • ✅ مقبول
- إن كان الدواء/الإجراء بلا تشخيص داعم فاذكر ذلك داخل القرار.

[ج] بنية HTML مطلوبة (لا CSS ولا <style>)
1) <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
2) <h4>ملخص الحالة</h4><p>لخّص العمر/الجنس/التشخيصات/العلامات الحمراء (تعارض eGFR، إلخ) وأي افتراضات.</p>
3) <h4>التحليل السريري العميق</h4><p>
   - اربط الأعراض بالتوجيهات: مريض ≥40 سنة ومدخّن مع سعال مزمن/فقدان وزن ⇒ أذكر ضرورة CXR الآن وLDCT السنوي (إن انطبقت معايير USPSTF).
   - اشرح بالتفصيل الأخطاء (XR bid، CKD مع Metformin، الضربة الثلاثية، Simvastatin+Clarithromycin...).
   - علّق على تعارض eGFR واعتبر الأحدث مرجّحًا حتى التثبّت.
</p>
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

[د] فرص تحسين الخدمة ورفع مستوى الدخل (وفق مصلحة المريض – مدعومة بالأدلة)
- أخرج قائمة نقطية؛ لكل عنصر الصيغة:
  **اسم الفحص/الخدمة** — سبب سريري محدد — منفعة للمريض — منفعة تشغيلية للعيادة — **مصدر موثوق + رابط https مباشر**.
- فعّل البنود حين تنطبق محفزاتها:
  • سكري نوع 2 ⇒ **HbA1c** كل 3 أشهر إن غير منضبط، 6–12 أشهر إن مستقر — ADA 2025 (رابط).
  • Metformin/Xigduo XR أو سكري/CKD ⇒ **eGFR + UACR** قبل/أثناء العلاج — FDA + KDIGO/ADA–KDIGO.
  • Allopurinol ⇒ **Uric Acid + eGFR ± HLA-B*58:01** — ACR Gout.
  • ACEi/ARB + Spironolactone أو CKD ⇒ **Potassium + Creatinine خلال 1–2 أسبوع** — ACC/AHA HTN.
  • سعال مزمن (>8 أسابيع) أو مدخّن ≥40 سنة مع أعراض ⇒ **CXR الآن** — ACR Appropriateness.
  • مدخّن 50–80 سنة مع ≥20 باك-سنة ⇒ **LDCT سنوي** — USPSTF.
  • سكري بالغ/عمر متقدّم ⇒ **فحص عين شامل مع توسعة الحدقة سنوياً** — ADA 2025.
  • أعراض بصرية/اشتباه وذمة بقعية ⇒ **OCT لماكيولا** — AAO PPP.
  • ضعف الوصول لطبيب عيون ⇒ **تصوير قاع العين Non-mydriatic / Tele-retina** أو **نظام AI معتمد (IDx-DR)** — AAO/ATA + FDA.
- إلزامي: أدرج ≥ 6 مصادر بروابط https صحيحة. إن نقصت البيانات اكتب "مشروط بتوفير: …".

[هـ] خطة العمل
- قائمة مرقمة بتصحيحات فورية دقيقة (تعديل جرعة XR، إيقاف ازدواجية، طلب eGFR/UA/K+Cr…، إضافة تشخيص داعم…).

[و] الخاتمة
<p><strong>الخاتمة:</strong> هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص.</p>

[ز] الإخراج
- أخرج **كتلة HTML واحدة فقط** وصالحة.
- اكتب نسب الخطورة بعلامة % وطبّق الكلاسات (risk-high / risk-medium / risk-low) على <td> في عمودي "درجة الخطورة" و"قرار التأمين".
`;

// ===================== Prompt Builder (يدعم عيون/تنفس) =====================
function buildUserPrompt(caseData = {}) {
  return `
**بيانات المريض (مدخل يدويًا):**
- العمر: ${caseData.age ?? 'غير محدد'}
- الجنس: ${caseData.gender ?? 'غير محدد'}
- التدخين: ${caseData.isSmoker === true ? 'مدخّن' : caseData.isSmoker === false ? 'غير مدخّن' : 'غير محدد'}
- باك-سنة: ${caseData.smokingPackYears ?? 'غير محدد'}
- مدة السعال (أسابيع): ${caseData.coughDurationWeeks ?? 'غير محدد'}
- أعراض بصرية: ${caseData.visualSymptoms ?? 'غير محدد'}
- تاريخ آخر فحص عين: ${caseData.lastEyeExamDate ?? 'غير محدد'}
- حدة الإبصار (إن وُجد): ${caseData.visualAcuity ?? 'غير محدد'}
- مدة السكري (سنوات): ${caseData.diabetesDurationYears ?? 'غير محدد'}
- مدة ارتفاع الضغط (سنوات): ${caseData.htnDurationYears ?? 'غير محدد'}
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

// ===================== Helpers =====================
const _encoder = new TextEncoder();
function byteLengthUtf8(str) { return _encoder.encode(str || '').length; }

// تقدير حجم الطلب بالميجابايت (Base64 ≈ +33%)
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

/** تصحيح ذاتي: إضافة % عند اللزوم + تطبيق الكلاسات على خلايا بدون class + تصفية روابط المصادر */
function applySafetyPostProcessing(html) {
  try {
    html = String(html || '');

    // % لو مفقودة
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi,
      (_m, o, n, _s, c) => `${o}${n}%${c}`);

    // تطبيق الكلاسات على خلايا النِّسب التي بلا class
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_m, open, numStr, close) => {
        const v = parseInt(numStr, 10);
        const klass = v >= 70 ? 'risk-high' : v >= 40 ? 'risk-medium' : 'risk-low';
        return open.replace('<td', `<td class="${klass}"`) + `${numStr}%` + close;
      });

    // قص أي ضجيج قبل أول <h3>
    const i = html.indexOf('<h3'); if (i > 0) html = html.slice(i);

    // توكيد أن روابط “فرص تحسين الخدمة” تبدأ بـ https
    html = html.replace(/href="http:\/\//g, 'href="https://');

    return html;
  } catch (e) {
    console.error('Post-processing failed:', e);
    return html;
  }
}

// fetch مع timeout + retries
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
  } finally { clearTimeout(id); }
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
    const apiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

    const userPrompt = buildUserPrompt(req.body || {});
    const parts = [{ text: systemInstruction }, { text: userPrompt }];

    // صور Base64 (بدون data:…;base64,) — احرص على ضغطها من الواجهة
    if (Array.isArray(req.body?.imageData)) {
      for (const img of req.body.imageData) {
        if (typeof img === 'string' && img.length > 0) {
          parts.push({ inline_data: { mimeType: 'image/jpeg', data: img } });
        }
      }
    }

    // حماية 413
    const estMB = estimateInlineRequestMB(parts);
    if (estMB > MAX_INLINE_REQUEST_MB) {
      return res.status(413).json({
        error: 'الطلب كبير جدًا',
        detail: `الحجم المقدر ~${estMB.toFixed(2)}MB > ${MAX_INLINE_REQUEST_MB}MB (حد inline ~20MB).
خفّض جودة/دقّة الصور أو استخدم Files API.`,
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
