// main/api/gpt.js

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY    // تأكد من ضبط هذا المتغير في إعدادات Vercel
});

export default async function handler(req, res) {
  // 1) دعم CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  // 2) السماح فقط بـ POST
  if (req.method !== "POST") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 3) جلب البيانات من جسم الطلب
  const {
    diagnosis,
    symptoms,
    age,
    gender,
    beforeProcedure,
    afterProcedure
  } = req.body;

  // 4) التحقق من ملء جميع الحقول
  if (
    !diagnosis ||
    !symptoms ||
    !age ||
    !gender ||
    !beforeProcedure ||
    !afterProcedure
  ) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(400).json({ error: "الرجاء ملء جميع الحقول." });
  }

  try {
    // 5) بناء الـ prompt
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

    // 6) استدعاء OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: systemPrompt }],
      temperature: 0.2
    });

    const raw = completion.choices?.[0]?.message?.content || "";

    // 7) محاولة تحويله لـ JSON
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { result: raw };
    }

    // 8) إرجاع الرد مع هيدر CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(payload);

  } catch (err) {
    console.error("GPT API error:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res
      .status(500)
      .json({ error: "خطأ في الخادم: " + err.message });
  }
}
