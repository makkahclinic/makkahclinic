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
    const systemPrompt = `
أنت مساعد مراجعة طبية تأمينية في المملكة العربية السعودية.

🎯 مهمتك:
- تحليل الحالة الطبية بناءً على المعلومات المقدمة فقط.
- تقييم كل إجراء قام به الطبيب (مذكور قبل وبعد التشخيص).
- لا تضف أي إجراء لم يُذكر، بل فقط اقترح في قسم منفصل.
- يجب أن تُقيّم:
  - هل الإجراء مبرر طبيًا؟ وهل يمكن رفضه من التأمين؟
  - القيمة المحتملة المعرضة للرفض.
- بعد التحليل، اقترح فحوصات أو استشارات إضافية يمكن إضافتها لرفع الدخل الطبي شريطة أن تكون:
  - مبررة طبيًا
  - غير قابلة للرفض تأمينيًا
  - مناسبة لعمر المريض، الأعراض، والتشخيص

🧾 صيغة الإخراج (JSON فقط):
{
  "result": "ملخص الحالة",
  "justification": [
    {
      "step": "اسم الإجراء",
      "justification": "مبرر أو غير مبرر",
      "rationale": "شرح علمي أو تأميني"
    }
  ],
  "rejectionRisk": "منخفض/متوسط/مرتفع",
  "rejectionReason": "اختياري",
  "rejectedValue": "ريال سعودي (إن وجد)",
  "improvementSuggestions": [
    {
      "title": "اسم الإجراء المقترح",
      "description": "أهميته",
      "estimatedValue": "ريال سعودي",
      "whyNotRejectable": "مبرر تأميني طبي واضح"
    }
  ],
  "potentialRevenueIncrease": "ريال سعودي (مجموع ما سبق تقديرًا)"
}

📌 ملاحظات:
- إذا وُجدت قيمة عددية بعد اسم تحليل (مثل سكر عشوائي ٣٠٠) فهذا هو **النتيجة** وليس السعر.
- استخدم فقط المعلومات المتوفرة، لا تفترض شيء من عندك.
- استخدم العربية الفصحى
- استخدم الريال السعودي فقط كوحدة
- اربط التوصيات بالحالة الفعلية، لا تقترح بلا معنى
- مثال: في مريض سكري بألم عين → اقترح فحص قاع العين أو ضغط العين أو الشبكية أو HbA1c أو استشارة طبيب عيون
- في حالات أعراض غير مفسّرة → اقترح CBC أو CRP أو متابعة أو اختبار بكتيريا سريع (إن مبرر)

---

📋 الحالة:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- قبل التشخيص: ${beforeProcedure}
- بعد التشخيص: ${afterProcedure}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: systemPrompt }],
      temperature: 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content || "";

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      payload = {
        result: raw,
        warning: "⚠️ الرد ليس JSON، تم عرضه كنص فقط",
      };
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("🔥 GPT API error:", err);
    return res.status(500).json({
      error: "خطأ أثناء تحليل الحالة من GPT",
      detail: err.message,
    });
  }
}
