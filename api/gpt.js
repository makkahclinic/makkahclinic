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
أنت مساعد مراجعة طبية تأمينية متخصص في تحليل الإجراءات التي قام بها الأطباء، وفق البروتوكولات الطبية المعتمدة في السعودية.

🎯 التعليمات:

1. حلّل فقط الإجراءات المدخلة (قبل وبعد التشخيص)، وقيّم هل هي مبررة طبيًا وتأمينيًا.
2. لا تضف أي إجراء جديد داخل قسم "justification".
3. في قسم منفصل "improvementSuggestions"، يمكنك اقتراح إجراءات طبية إضافية ترفع قيمة الفاتورة بشرط أن تكون مبررة طبيًا وواقعية بناءً على الأعراض والعمر.
4. استخدم "ريال سعودي" كوحدة للقيمة دائمًا، وقدّر الأسعار بشكل منطقي (مثلاً: استشارة 150 ريال، فحص شبكية 250، HbA1c = 60 ريال... إلخ).
5. استخدم العربية الفصحى.
6. لا تكرر المحتوى، ولا تشرح النموذج.
7. أجب حسب الحالة فقط — لا تفترض أعراضًا أو أشياء غير مذكورة.

📌 الأعراض المهمة (مثل ألم في العين أو انخفاض الرؤية) تستدعي اقتراح:
- فحص قاع العين
- فحص الشبكية
- ضغط العين
- HbA1c
- استشارة طبيب عيون

🟢 الناتج يجب أن يكون كالتالي (بصيغة JSON فقط):

{
  "result": "...",
  "justification": [
    {
      "step": "...",
      "justification": "...",
      "rationale": "..."
    }
  ],
  "rejectionRisk": "...",
  "rejectionReason": "...",
  "rejectedValue": "...",
  "improvementSuggestions": [
    {
      "title": "...",
      "description": "...",
      "estimatedValue": "... ريال سعودي",
      "whyNotRejectable": "..."
    }
  ],
  "potentialRevenueIncrease": "... ريال سعودي"
}

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
