export const config = { runtime: 'edge' };

// ميثاق النظام: توجيه دقيق لاستخراج خط اليد + بناء تقرير HTML نظيف
const SYSTEM_INSTRUCTIONS = `
أنت خبير تدقيق مطالبات طبية. هدفك:
1) استخراج قائمة الأدوية من صور/‏PDF الوصفة بخط اليد بدقة عالية.
2) إنتاج تقرير HTML نظيف (بدون CSS خارجي) يتضمن:
   أ) ملخص الحالة السريرية.
   ب) تحليل سريري عميق مختصر.
   ج) جدول الأدوية والإجراءات بالأعمدة التالية: [الدواء/الإجراء | الجرعة الموصوفة | الجرعة الصحيحة المقترحة | التصنيف | الغرض الطبي | التداخلات | درجة الخطورة (%) | قرار التأمين].
   د) فرص تحسين الخدمة (HbA1c, eGFR, UACR… مع مرجع موجز).
   هـ) خطة عمل عملية.
   و) خاتمة قصيرة.

قواعد استخراج خط اليد (بالغة العربية):
- فسّر صيغ مثل:
  • "od" = مرة يوميًا، "bid" = مرتان يوميًا، "tid" = ثلاث مرات يوميًا.
  • "1x1x90" ≈ قرص واحد يوميًا لمدة 90 يوم.
  • "1x2x90" ≈ قرصان يوميًا لمدة 90 يوم.
  • الرمز × أو x أو X كلها تفيد "مرّات".
- طبّع الأخطاء الإملائية الشائعة إن ظهرت:
  Amlopine→Amlodipine، Rozavi→Rosuvastatin، Pantomax→Pantoprazole،
  Formet/Formot→Metformin XR، Dramicron/Dramacron→Diamicron MR،
  Co-taburan→(ارجّح Valsartan/HCT أو Losartan/HCT حسب السياق).
- إن كان الاسم غير واضح اكتب: "اسم غير واضح (احتمال: …)" ولا تترك خانة فارغة.
- دوّن المدة إذا ظهرت (مثل 90 يوم).

قواعد ضمان الجودة:
- اذكر الازدواجيات (مثل وجود خافضي ضغط متعددين).
- اضبط تحذيرات كبار السن ووظائف الكلى (أشر إلى الحاجة لـ eGFR و HbA1c).
- لا تُفصح عن معلومات حساسة غير موجودة في المدخلات.
- أخرج النتيجة على شكل HTML منسّق بعناوين فرعية (<h2>) وجداول (<table>) وفقرات (<p>) فقط.
- لا تُدرج CSS أو JavaScript أو صور؛ HTML نصي فقط.
`;

function userPromptArabic(notes){
  return `
[سياق]
ملاحظات إضافية من المستخدم (قد تكون فارغة):
${notes || '—'}

[مطلوب]
- اقرأ كل الصور/الملفات المرفوعة (وصفة طبية بخط اليد).
- استخرج الأدوية والجرعات والمدة.
- قدّم تقريرًا عربيًا كاملًا وفق القالب المذكور في "قواعد الإخراج".
- إذا كان عنصر غير واضح، اذكر الاحتمال الأقرب.
- لا تذكر أنك نموذج؛ فقط التقرير.

[قواعد الإخراج]
- استخدم عناوين: ملخص الحالة، التحليل السريري العميق، جدول الأدوية والإجراءات، فرص تحسين الخدمة، خطة العمل، الخاتمة.
- جدول الأدوية يجب أن يتضمن كامل الأعمدة وبالترتيب.
- استخدم نسب تقديرية للخطورة (%).
`;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({error: 'Method not allowed'}), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const { language = 'ar', notes = '', files = [] } = await req.json();

    const parts = [];
    // تعليمات النظام
    parts.push({ text: SYSTEM_INSTRUCTIONS });

    // ملاحظات المستخدم
    parts.push({ text: userPromptArabic(notes) });

    // المرفقات (صور/‏PDF) — inline_data
    for (const f of files) {
      if (!f?.data || !f?.type) continue;
      parts.push({
        inline_data: {
          mime_type: f.type,
          data: f.data
        }
      });
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      // إعدادات توليد متحفظة لتقليل الهلوسة
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 3500
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUAL_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    };

    const key = process.env.GOOGLE_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({error: 'Missing GOOGLE_API_KEY'}), { status: 500, headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'} });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${key}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const errText = await r.text();
      return new Response(JSON.stringify({error: `Gemini ${r.status}`, detail: errText}), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await r.json();
    const txt = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    return new Response(JSON.stringify({ htmlReport: txt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error', detail: String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
