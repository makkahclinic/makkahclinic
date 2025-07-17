// main/api/gpt.js

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // تأكد من إضافته في Vercel
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    diagnosis,
    symptoms,
    age,
    gender,
    smoker,
    beforeProcedure,
    afterProcedure
  } = req.body;

  if (!diagnosis || !symptoms || !age || !gender || !beforeProcedure || !afterProcedure || smoker === undefined) {
    return res.status(400).json({ error: "الرجاء ملء جميع الحقول." });
  }

  try {
    const systemPrompt = `
أنت مساعد خبير في المراجعة الطبية التأمينية. مهمتك تقديم تقرير طبي تأميني شامل بناءً على المعطيات التالية:

- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- مدخن: ${smoker ? 'نعم' : 'لا'}
- الإجراءات قبل التشخيص: ${beforeProcedure}
- الإجراءات بعد التشخيص: ${afterProcedure}

⬇️ المطلوب بالتحديد:

1. قدم **ملخصًا سريريًا دقيقًا** للحالة بناءً على الأعراض والعمر.
2. قيّم **كل إجراء طبي** تم اتخاذه (مبرر أو لا) مع شرح علمي دقيق (مستند إلى ADA، WHO، AAO، إلخ).
3. حدّد **احتمالية رفض التأمين** لكل إجراء غير مبرر.
4. اقترح بذكاء **ما كان يجب فعله** بشكل واقعي ومربح للعيادة وملائم تأمينيًا:
  - اقتراح فحوصات إضافية مفصلة (مثل OCT، HbA1c، تصوير الشبكية، وظائف الكلى، تخطيط القلب...)
  - استشارات تخصصية
  - متابعة
  - تثقيف صحي

💰 حدّد القيمة التقديرية لكل إجراء مقترح بالريال السعودي (ليس بالدولار)
✅ اشرح لماذا لا يمكن رفضه تأمينياً.
📚 استند دومًا إلى بروتوكولات طبية مشهورة.
📄 اجعل التقرير عربيًا بالكامل، سرديًا، تفصيليًا، احترافيًا، ويشبه تقارير التأمين الرسمية.
✳️ استخدم عنوان رئيسي لكل قسم، وفصّل النقاط، واذكر التأثير التأميني والمالي والطبي، وفائدة كل فحص.
🔢 لا تقل عدد كلمات التقرير عن 800 كلمة مهما حصل.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "system", content: systemPrompt }],
      temperature: 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content || "";

    let payload;
    try {
      payload = { result: raw };
    } catch (err) {
      payload = { result: raw, warning: "⚠️ الرد ليس JSON، تم عرضه كنص فقط" };
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("🔥 GPT API error:", err);
    return res.status(500).json({
      error: "حدث خطأ أثناء التحليل من GPT",
      detail: err.message,
    });
  }
}
