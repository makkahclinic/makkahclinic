// main/api/gpt.js

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // تأكد من إضافته في Vercel > Settings > Environment Variables
});

export default async function handler(req, res) {
  // ✅ دعم CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    diagnosis,
    symptoms,
    age,
    gender,
    beforeProcedure,
    afterProcedure,
  } = req.body;

  if (
    !diagnosis ||
    !symptoms ||
    !age ||
    !gender ||
    !beforeProcedure ||
    !afterProcedure
  ) {
    return res.status(400).json({ error: "الرجاء ملء جميع الحقول." });
  }

  try {
    // ✅ الـ Prompt بشكل صحيح داخل backticks
    const systemPrompt = `
أنت مساعد طبي مختص بتحليل إجراءات التأمين.
المعطيات:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- قبل التشخيص: ${beforeProcedure}
- بعد التشخيص: ${afterProcedure}

أرجو أن تُخرِج JSON يحتوي على:
1) result (ملخص الحالة)
2) justification: [ { step, justification, rationale }, ... ]
3) rejectionRisk
4) rejectionReason (اختياري)
5) rejectedValue (اختياري)
6) improvementSuggestions: [ { title, description, estimatedValue, whyNotRejectable }, ... ]
7) potentialRevenueIncrease
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: systemPrompt }],
      temperature: 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content || "";

    // ✅ نحاول تحويل الناتج إلى JSON
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {
        result: raw,
        warning: "⚠️ الرد ليس JSON، تم عرضه كنص فقط",
      };
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("GPT API error:", err);
    return res
      .status(500)
      .json({ error: "خطأ أثناء تحليل الحالة: " + err.message });
  }
}
