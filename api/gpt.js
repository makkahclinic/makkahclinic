// /api/gpt.js

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
    const prompt = `
أنت استشاري تأمين طبي خبير، وتقوم بمراجعة حالة طبية لمريض حسب المعطيات التالية:

- التشخيص (ICD-10): ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- الإجراءات قبل التشخيص: ${beforeProcedure}
- الإجراءات بعد التشخيص: ${afterProcedure}

🔹 مهامك:
1. تحليل الحالة بدقة وشرح الأسباب الطبية المتوقعة للأعراض.
2. تقييم كل إجراء هل هو مبرر أو لا مع توضيح علمي أو تأميني.
3. تحديد احتمالية الرفض التأميني، وذكر الأسباب إن وُجدت.
4. اقتراح فحوصات أو استشارات إضافية تساعد في:
   ✅ رفع الدخل الطبي للعيادة
   ✅ تقليل رفض التأمين
   ✅ تحسين جودة الرعاية الصحية
   ✅ دعم القرارات بالأدلة مثل: ADA, UpToDate, WHO
5. يجب أن تكون كل القيم النقدية بالريال السعودي فقط.
6. صيغة الإخراج: JSON فقط بالهيكل التالي:

{
  "result": "ملخص شامل باللغة العربية الفصحى، يشرح الحالة والأخطاء أو التقصير إن وجد، ويعطي نظرة احترافية",
  "justification": [
    {
      "step": "اسم الإجراء",
      "justification": "مبرر أو لا",
      "rationale": "شرح علمي وتأميني واضح"
    }
  ],
  "rejectionRisk": "منخفض/متوسط/مرتفع",
  "rejectionReason": "لماذا يمكن رفضه إن وُجد سبب",
  "rejectedValue": "قيمة تقريبية محتملة للرفض إن وُجدت (مثلاً 70 ريال)",
  "improvementSuggestions": [
    {
      "title": "اسم الإجراء المقترح (مثلاً OCT أو استشارة عيون)",
      "description": "لماذا هذا الإجراء مهم طبيًا وتأمينيًا",
      "estimatedValue": "قيمة تقديرية (مثلاً 350 ريال)",
      "whyNotRejectable": "مبررات تمنع الرفض التأميني"
    }
  ],
  "potentialRevenueIncrease": "تقدير الزيادة المحتملة مثل: 750 ريال سعودي"
}

🔹 أجب بالعربية الفصحى فقط. وحسب لغة المدخلات لو كانت إنجليزية.

ابدأ الآن بصياغة تقرير عميق.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "system", content: prompt }],
      temperature: 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content || "";

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      payload = { result: raw, warning: "⚠️ الرد ليس بصيغة JSON منظمة." };
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("❌ GPT API Error:", err);
    return res.status(500).json({
      error: "حدث خطأ أثناء تحليل الحالة.",
      detail: err.message,
    });
  }
}
