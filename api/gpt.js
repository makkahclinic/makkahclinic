// /api/gpt.js — نسخة محسّنة تلائم المتطلبات (بدون CSS ضمن الـ systemInstruction)

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
  1) احسب "درجة الخطورة" كنسبة مئوية 0–100% (أكتب معها علامة %) بالاعتماد على شدة الخطأ وتأثيره.
  2) طبّق كلاس لوني على خلية درجة الخطورة (td) وعلى خلية قرار التأمين وفق العتبات:
     • risk-high إذا كانت الدرجة ≥ 70%
     • risk-medium إذا كانت الدرجة بين 40% و 69%
     • risk-low إذا كانت الدرجة < 40%
  3) عمود "قرار التأمين" إلزامي وبالصيغة التالية (اختر المناسب):
     • ❌ قابل للرفض — السبب: [اذكر سببًا محددًا سريريًا/إجرائيًا]
       — وللقبول يلزم: [اذكر ما يجب إضافته/تعديله: تشخيص، فحص، تعديل جرعة، إلغاء ازدواجية...]
     • ⚠️ قابل للمراجعة — السبب: […]
       — لتحسين فرص القبول: […]
     • ✅ مقبول
  4) إن كان الدواء/الكريم/الإجراء بلا تشخيص داعم واضح، اذكر ذلك صراحة في القرار:
     مثال: "❌ قابل للرفض — السبب: عدم وجود تشخيص التهاب جلدي يبرر الكريم — وللقبول يلزم: إضافة تشخيص التهاب جلدي موثق".

[ج] بنية HTML مطلوبة (لا تضف CSS ولا <style>)
1) <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
2) <h4>ملخص الحالة</h4><p>…</p>
3) <h4>التحليل السريري العميق</h4><p>… اربط كل ملاحظة بالتشخيصات …</p>
4) <h4>جدول الأدوية والإجراءات</h4>
   جدول بالأعمدة بالترتيب:
   - الدواء/الإجراء
   - الجرعة الموصوفة
   - الجرعة الصحيحة المقترحة (اكتب "إيقاف" إن كان غير مبرر)
   - التصنيف (دواء | مكمل | جهاز فحص | كريم موضعي | إجراء تشخيصي | إجراء تداخلي)
   - الغرض الطبي (بوضوح)
   - التداخلات (إن وُجدت، مع تسمية الدواء المقابل)
   - درجة الخطورة (%)  ← ضع class مناسب (risk-high/medium/low) على <td>
   - قرار التأمين       ← ضع class مناسب (risk-high/medium/low) على <td> وبالصيغ المعيارية أعلاه
5) <h4>فرص تحسين الرعاية</h4><ul><li>…</li></ul>
6) <h4>خطة العمل</h4><ol><li>…</li></ol>
7) <p><strong>الخاتمة:</strong> هذا التقرير هو تحليل مبدئي ولا يغني عن المراجعة السريرية من قبل طبيب متخصص.</p>

[د] قواعد إضافية صارمة:
- اكتب درجات الخطورة كنسبة مع علامة % (مثل: 75%).
- لا تستخدم أي CSS أو وسم <style>. استخدم فقط أسماء الكلاسات المذكورة.
- لا تُخرِج سوى كتلة HTML واحدة صالحة.
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

function applySafetyPostProcessing(html) {
  // بوست-بروسس بسيط لضمان وجود الكلاسات بناءً على النسبة إن أغفلها النموذج:
  // يبحث عن خلايا "درجة الخطورة" ويضيف الكلاس حسب النسبة إن لم توجد.
  try {
    // نستخدم Regex خفيف لأننا لا نريد HTML parser ثقيل على السيرفر.
    return html.replace(
      /(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (m, open, numStr, close) => {
        const num = parseInt(numStr, 10);
        const klass = num >= 70 ? 'risk-high' : num >= 40 ? 'risk-medium' : 'risk-low';
        return open.replace('<td', `<td class="${klass}"`) + `${num}%` + close;
      }
    );
  } catch {
    return html; // لو فشل البوست-بروسس لأي سبب، رجّع الـ HTML كما هو.
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

    const apiUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=' +
      apiKey;

    const userPrompt = buildUserPrompt(req.body);

    const parts = [{ text: systemInstruction }, { text: userPrompt }];

    if (req.body.imageData && Array.isArray(req.body.imageData)) {
      for (const imgData of req.body.imageData) {
        if (typeof imgData === 'string' && imgData.length > 0) {
          parts.push({
            inline_data: { mimeType: 'image/jpeg', data: imgData },
          });
        }
      }
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        topK: 40,
        // اختياري: تحكم بطول الإخراج إن رغبت
        // maxOutputTokens: 2048,
      },
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      console.error('Gemini API Error:', response.status, response.statusText, bodyText);
      return res.status(response.status).json({
        error: 'فشل الاتصال بـ Gemini API',
        status: response.status,
        statusText: response.statusText,
        detail: bodyText,
      });
    }

    const result = await response.json();

    const reportHtml =
      result?.candidates?.[0]?.content?.parts?.[0]?.text ||
      '<p>⚠️ لم يتمكن النظام من إنشاء التقرير. حاول لاحقًا.</p>';

    // بوست-بروسس لتثبيت الكلاسات حسب النسبة إن لزم:
    const finalizedHtml = applySafetyPostProcessing(reportHtml);

    return res.status(200).json({ htmlReport: finalizedHtml });
  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({
      error: 'حدث خطأ في الخادم أثناء تحليل الحالة',
      detail: err.message,
      stack: err.stack,
    });
  }
}
