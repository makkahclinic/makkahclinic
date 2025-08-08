// /api/gpt.js – النسخة النهائية المشددة على المصادر + تدقيق أعمق + تصحيح تلقائي

const MAX_INLINE_REQUEST_MB = 19.0;         // حد أمان أقل من 20MB لصور inline
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;

const systemInstruction = `
أنت "كبير مدققي المطالبات الطبية والتأمين" خبير سريري. أخرج تقرير HTML واحد فقط (كتلة واحدة) وفق القواعد الآتية—بلا CSS أو <style>:

[أ] المنهجية الإلزامية
1) حلّل كل المدخلات (نصوص + صور). إن وُجد تعارض بين قيم (مثلاً eGFR 38 مقابل 62) فاذكره كـ "تعارض يجب حسمه" وبيّن كيف يُحسم (إعادة القياس، مراجعة المختبر).
2) ابحث بدقة عن:
   • الازدواجية العلاجية (خصوصًا الضغط، السكري، مضادات التجلط/الصفائح).  
   • أخطاء الجرعات (XR/MR أكثر من مرة يوميًا، جرعات عالية في CKD).  
   • التداخلات الكبرى والمحظورة: 
       - Simvastatin + Macrolides (خصوصًا Clarithromycin) ← خطر اعتلال عضلي/Rhabdo
       - ACEi/ARB + MRA (Ramipril/Losartan + Spironolactone) مع بوتاسيوم مرتفع
       - "الضربة الثلاثية": ACE/ARB + مدرّ + NSAID (AKI)
       - تعدد مضادات التخثر/الصفائح (Warfarin/DOAC + ASA + Clopidogrel)
   • أدوية عالية الخطورة ومتطلبات فحوصها:
       - Metformin/Xigduo XR ⇠ eGFR + الإيقاف المؤقت قبل/بعد صبغة يودية
       - Allopurinol ⇠ eGFR + Uric Acid ± HLA-B*58:01
       - Spironolactone/ACEi ⇠ Potassium/Creatinine
       - Warfarin ⇠ INR (خطة متابعة)
   • المبرر السريري لكل دواء/إجراء (تشخيص داعم واضح).  
   • مدة الصرف غير الملائمة (مثل 90 يوم لمضاد حيوي/كريم ستيرويدي حاد).  
   • فحوص لازمة تبعًا لعوامل الخطر:
       - مدخّن ≥20 باك-سنة وعمر 50–80 مع سعال مزمن ⇒ LDCT سنوي + CXR
       - سكري ⇒ فحص عين سنوي بتوسعة الحدقة + HbA1c دوري

[ب] المراجع (إلزامي)
- في نهاية التقرير أضف قسم "المراجع" يحتوي 6–12 مرجعًا مباشرة بروابط فعلية (URL) من هيئات موثوقة فقط:
  FDA drug labels, ADA Standards of Care, KDIGO, ACC/AHA/ACC Expert Consensus, USPSTF, IDSA/ATS CAP guideline, ACR Appropriateness Criteria.
- يجب أن تكون الروابط “حية” (HTTPS) وموسومة باسم الجهة والعنوان المختصر (مثال: "FDA – Xigduo XR label").

[ج] قواعد مخاطبة التأمين
- لكل عنصر في الجدول:
  1) احسب "درجة الخطورة" كنسبة 0–100% واكتب علامة %.
  2) ضع class على <td> الخاص بالنسبة وعلى <td> قرار التأمين حسب العتبات:
       • risk-high إذا ≥70%   • risk-medium إذا 40–69%   • risk-low إذا <40%
  3) عمود "قرار التأمين" إلزامي بصيغة:
       • ❌ قابل للرفض — السبب: [سبب طبي/إجرائي محدد]
         — وللقبول يلزم: [تشخيص/فحص/تعديل جرعة/إلغاء ازدواجية…]
       • ⚠️ قابل للمراجعة — السبب: […]
         — لتحسين فرص القبول: […]
       • ✅ مقبول
  4) عند غياب التشخيص الداعم اذكره صراحة (سبب للرفض/المراجعة).

[د] فرص تحسين الخدمة ورفع الدخل (Aligned with patient benefit)
- قدّم قائمة فرص دقيقة تُحسّن رعاية المريض وتزيد عوائد العيادة بشكل مشروع (تحاليل/تصوير/إحالات/متابعة أدوية). 
- لكل فرصة: 
   اسم الخدمة، لماذا للمريض (المعيار/الدليل)، متى/تكرارها، نوع الخدمة (مختبر/تصوير/عيون)، مثال كود CPT/خدمة (إن وُجد)، ومصدر guideline.
- أمثلة متوقعة: HbA1c كل 3 أشهر للسكري غير مضبوط، eGFR+UACR دوري، LDCT سنوي لمدخن مؤهل، فحص قاع عين، INR plan للوارفارين، مراقبة K/Cr بعد ACEi+MRA، CXR للسعال المزمن.

[هـ] بنية HTML مطلوبة (لا تضف CSS)
1) <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
2) <h4>ملخص الحالة</h4><p>…</p>
3) <h4>التحليل السريري العميق</h4><p>… اربط كل خطأ/تداخل بالتشخيصات وعوامل الخطر …</p>
4) <h4>جدول الأدوية والإجراءات</h4>
   جدول بالأعمدة: 
   - الدواء/الإجراء
   - الجرعة الموصوفة
   - الجرعة الصحيحة المقترحة (اكتب "إيقاف" إن غير مبرر)
   - التصنيف (دواء | مكمل | جهاز فحص | كريم موضعي | إجراء تشخيصي | إجراء تداخلي)
   - الغرض الطبي
   - التداخلات
   - درجة الخطورة (%)  ← ضع class (risk-high/medium/low) على <td>
   - قرار التأمين      ← ضع class (risk-high/medium/low) على <td> وبالصيغة المعيارية
5) <h4>فرص تحسين الخدمة ورفع الدخل</h4><ul><li>… خدمة/مبرر/تكرار/نوع/CPT (إن أمكن) / مرجع …</li></ul>
6) <h4>خطة العمل</h4><ol><li>…</li></ol>
7) <h4>المراجع</h4><ul><li><a href="…">[جهة] – عنوان</a></li>…</ul>
8) <p><strong>الخاتمة:</strong> هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص.</p>
`;

function buildUserPrompt(caseData = {}) {
  return `
**بيانات المريض (مدخل يدويًا):**
- العمر: ${caseData.age ?? 'غير محدد'}
- الجنس: ${caseData.gender ?? 'غير محدد'}
- حامل: ${caseData.isPregnant ?? 'غير محدد'} ${caseData.pregnancyMonth ? `(شهر ${caseData.pregnancyMonth})` : ''}
- الطول/الوزن: ${caseData.height ?? '-'} سم / ${caseData.weight ?? '-'} كجم
- الحرارة: ${caseData.temperature ?? '-'}  |  الضغط: ${caseData.bloodPressure ?? '-'}
- تدخين: ${caseData.isSmoker === true ? `نعم (${caseData.smokingPackYears ?? '?'} باك-سنة)` : caseData.isSmoker === false ? 'لا' : 'غير محدد'}
- سعال مزمن (أسابيع): ${caseData.coughDurationWeeks ?? 'غير محدد'}
- عيون: أعراض=${caseData.visualSymptoms ?? 'غير محدد'}, آخر فحص=${caseData.lastEyeExamDate ?? 'غير محدد'}, حدة الإبصار=${caseData.visualAcuity ?? 'غير محدد'}
- تحاليل مختصرة: eGFR=${caseData.eGFR ?? '-'}, HbA1c=${caseData.hba1c ?? '-'}, K=${caseData.k ?? '-'}, Cr=${caseData.cr ?? '-'}, Uric=${caseData.ua ?? '-'}

**التشخيصات المذكورة:** ${caseData.diagnosis || 'غير محدد'}
**وصف الحالة:** ${caseData.notes || 'غير محدد'}
**نتائج التحاليل/الأشعة (نص حر):** ${caseData.labResults || 'غير محدد'}
**الأدوية/الإجراءات المكتوبة:** ${caseData.medications || 'غير محدد'}

**الملفات المرفوعة:** ${Array.isArray(caseData.imageData) && caseData.imageData.length ? 'نعم (صورة/صور مرفقة)' : 'لا يوجد'}
`;
}

// تقدير الحجم MB للطلب (Base64 ≈ ×0.75)
function estimateInlineRequestMB(parts) {
  let bytes = 0;
  for (const p of parts) {
    if (p?.text) bytes += Buffer.byteLength(p.text, 'utf8');
    if (p?.inline_data?.data) bytes += Math.floor(p.inline_data.data.length * 3 / 4);
  }
  return bytes / (1024 * 1024);
}

/** تصحيح تلقائي: يضيف % إن سقطت، ويحقن الكلاس الصحيح للخطورة إذا نسيه النموذج */
function applySafetyPostProcessing(html) {
  try {
    // أضف % المفقودة للأرقام المفردة داخل خلايا الجدول
    html = html.replace(/(<td[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi, (_m,o,n,_s,c)=> `${o}${n}%${c}`);
    // ضع class حسب النسبة إن لم يوجد
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_m,open,numStr,close)=>{
        const v = parseInt(numStr,10);
        const klass = v >= 70 ? 'risk-high' : v >= 40 ? 'risk-medium' : 'risk-low';
        return open.replace('<td', `<td class="${klass}"`) + `${v}%` + close;
      });
    // تقليم أي هرجة قبل أول <h3> وبعد آخر </p> أو </ul> أو </ol>
    const start = html.indexOf('<h3'); if (start > 0) html = html.slice(start);
    const tailIdx = Math.max(html.lastIndexOf('</ol>'), html.lastIndexOf('</ul>'), html.lastIndexOf('</p>'));
    if (tailIdx > 0) html = html.slice(0, tailIdx + 5);
    return html;
  } catch (e) {
    console.error('Post-processing failed:', e);
    return html;
  }
}

// fetch مع timeout + retries
async function fetchWithRetry(url, options, { retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok && retries > 0 && RETRY_STATUS.has(res.status)) {
      await new Promise(r => setTimeout(r, (3 - retries) * 800)); // backoff بسيط
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return res;
  } finally {
    clearTimeout(timer);
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

    // مانع 413: تقدير حجم الطلب
    const estMB = estimateInlineRequestMB(parts);
    if (estMB > MAX_INLINE_REQUEST_MB) {
      return res.status(413).json({
        error: 'الطلب كبير جدًا',
        detail: `حجم الطلب المقدر ~${estMB.toFixed(2)}MB، يتجاوز حد الأمان ${MAX_INLINE_REQUEST_MB}MB. 
فضلاً صغّر/قلّل جودة الصورة من الواجهة أو أرسل صورة واحدة.`,
      });
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        topK: 40,
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
      if (response.status === 413 || /Request Entity Too Large|Content Too Large/i.test(text)) {
        return res.status(413).json({
          error: 'فشل الاتصال بـ Gemini API بسبب كِبر الحجم',
          detail: 'قلّل حجم الصور أو أرسل صورة واحدة.',
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
