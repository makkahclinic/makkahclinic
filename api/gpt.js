// main/api/gpt.js

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // احرص على ضبط المفتاح في إعدادات Vercel
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { diagnosis, symptoms, age, gender, beforeProcedure, afterProcedure } = req.body;

  if (!diagnosis || !symptoms || !age || !gender || !beforeProcedure || !afterProcedure) {
    return res.status(400).json({ error: "الرجاء ملء جميع الحقول." });
  }

  try {
    const systemPrompt = `
أنت استشاري تأمين طبي محترف، مهمتك إعداد تقرير مراجعة تأمينية شامل لحالة طبية مع تقييم معمق لكل إجراء.

🔹 صيغة التقرير:
1. ملخص الحالة (سرد طبي دقيق بلغة عربية فصحى أكاديمية، مع تحديد مدى خطورة الأعراض والعمر).
2. تحليل الإجراءات السابقة: تقييم مبرراتها علمياً وتأمينياً.
3. اعتراضات التأمين المحتملة: مع تقدير القيمة المالية المعرضة للرفض.
4. ما كان يجب فعله: إجراءات موصى بها وفق البروتوكولات الدولية (مثل ADA، WHO، AAO)، بما يشمل فحوصات، إحالات، أدوية، تصوير OCT إلخ.
5. تقدير القيمة التأمينية الممكن زيادتها بالريال السعودي فقط (ليس بالدولار).
6. الأثر الإيجابي للممارسات الصحيحة على المريض، العيادة، وشركة التأمين.
7. تقرير بلغة علمية واضحة قابلة للطباعة والاعتماد، طويلة (800 كلمة كحد أدنى) دون اختصار.

🔹 بيانات الحالة:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- الإجراءات قبل التشخيص: ${beforeProcedure}
- الإجراءات بعد التشخيص: ${afterProcedure}

🔹 تعليمات:
- استخدم وحدة "ريال سعودي" في جميع التقديرات.
- لا تستخدم رموز JSON أو جداول، التقرير بصيغة سردية فقط.
- لا تُكرر المعلومات. لا تستخدم عبارات سطحية مثل "قد يكون" أو "ربما"، بل استخدم لغة طبية دقيقة.
- استخدم المصادر التالية في تحليلك عند الاقتضاء: ADA, AAO, UpToDate, NICE Guidelines.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt }
      ],
      temperature: 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content || "";

    return res.status(200).json({ result: raw });
  } catch (err) {
    console.error("🔥 GPT API error:", err);
    return res.status(500).json({
      error: "خطأ أثناء تحليل الحالة من GPT",
      detail: err.message,
    });
  }
}
