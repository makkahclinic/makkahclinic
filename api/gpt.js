// main/api/gpt.js

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
أنت مساعد ذكي خبير في المراجعة الطبية التأمينية داخل السعودية.

❗ دورك:
- تحليل حالة مريض بناءً على التشخيص، الأعراض، العمر، الجنس، والإجراءات التي قام بها الطبيب.
- تقييم مدى كفاية هذه الإجراءات وتأثيرها التأميني.
- اقتراح إجراءات إضافية تُرفع قيمة الفاتورة، بشرط أن تكون مبررة طبيًا ومقبولة تأمينيًا.
- جميع التكاليف يجب أن تكون بـ "ريال سعودي" فقط.

📌 التعليمات:
- إذا كان المريض يعاني من ألم في العين أو انخفاض في الرؤية → اقترح:
  - فحص قاع العين
  - فحص ضغط العين
  - فحص الشبكية
  - HbA1c
  - استشارة طبيب عيون
- استجب حسب حالة المريض الفعلية، العمر، الجنس، الأعراض.
- استخدم مصادر موثوقة مثل Mayo Clinic أو UpToDate كمبرر إن أمكن.
- لا تشرح النموذج، فقط أعطِ الرد النهائي.

🔶 الناتج يجب أن يكون JSON بالشكل التالي:
{
  "result": "ملخص الحالة الطبية",
  "justification": [
    {
      "step": "اسم الإجراء",
      "justification": "هل هو مبرر؟",
      "rationale": "شرح علمي/تأميني"
    }
  ],
  "rejectionRisk": "منخفض/متوسط/مرتفع",
  "rejectionReason": "السبب (اختياري)",
  "rejectedValue": "القيمة بالريال السعودي (اختياري)",
  "improvementSuggestions": [
    {
      "title": "اسم الفحص/الاستشارة",
      "description": "أهميته",
      "estimatedValue": "200 ريال سعودي",
      "whyNotRejectable": "مبرر طبي/تأميني"
    }
  ],
  "potentialRevenueIncrease": "إجمالي الزيادة المقدرة بالريال السعودي"
}

🟢 أجب باللغة العربية الفصحى، وإذا كانت المدخلات بالإنجليزية فأجب بالإنجليزية.

---

مدخلات الحالة:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- الإجراءات قبل التشخيص: ${beforeProcedure}
- الإجراءات بعد التشخيص: ${afterProcedure}
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
      console.warn("⚠️ JSON parsing failed. Returning raw text.");
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
