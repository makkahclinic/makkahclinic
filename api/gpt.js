// main/api/gpt.js

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY    // تأكد من ضبط هذا المتغير في إعدادات Vercel أو بيئتك
});

export default async function handler(req, res) {
  // 1) دعم طلبات CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  // 2) نسمح فقط بطلبات POST
  if (req.method !== "POST") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 3) قراءة الحقول من body
  const {
    diagnosis,
    symptoms,
    age,
    gender,
    beforeProcedure,
    afterProcedure
  } = req.body;

  // 4) التحقق من وجود جميع الحقول
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
    // 5) بناء رسالة النظام للموديل
    const systemPrompt = `
أنت مساعد طبي مختص في تحليل إجراءات التأمين.
لديك هذه البيانات:
- التشخيص (ICD-10): ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- إجراءات ما قبل التشخيص: ${beforeProcedure}
- إجراءات ما بعد التشخيص: ${afterProcedure}

الرجاء أن تنتج الرد بصيغة JSON يتضمن الحقول التالية:
1) result: ملخص موجز للحالة.
2) justification: مصفوفة من الكائنات، كل كائن يحتوي على:
   - step: اسم الإجراء
   - justification: تقييم الإجراء
   - rationale: المبرر التأميني
3) rejectionRisk: احتمالية الرفض (نص).
4) rejectionReason: سبب الرفض (اختياري).
5) rejectedValue: القيمة المعرضة للرفض (اختياري).
6) improvementSuggestions: مصفوفة من الكائنات، كل كائن يحتوي على:
   - title: عنوان الاقتراح
   - description: وصف الأهمية
   - estimatedValue: القيمة التقديرية
   - whyNotRejectable: سبب قبول الإجراء تأمينيًا
7) potentialRevenueIncrease: نص يوضح الزيادة المحتملة في الدخل.
`;

    // 6) استدعاء OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: systemPrompt }],
      temperature: 0.2
    });

    // 7) الحصول على النص الناتج
    const raw = completion.choices?.[0]?.message?.content || "";

    // 8) محاولة تحويل الرد إلى JSON
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      // إذا لم يكن JSON صالحًا، نضع النص كله في result
      payload = { result: raw };
    }

    // 9) إعادة الرد مع هيدر CORS
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
