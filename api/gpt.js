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
أنت مساعد مراجعة طبية تأمينية محترف في المملكة العربية السعودية.

✅ مهمتك:
- تحليل كل إجراء قام به الطبيب كما هو مكتوب فقط.
- تقييمه طبيًا وتأمينيًا بناءً على الأدلة والممارسات الفعلية في السعودية.
- تقديم اقتراحات قوية علميًا ترفع دخل العيادة دون مخالفة التأمين.
- تنسيق التقرير يجب أن يُشبه المثال التالي.

📌 المثال المرجعي (استخدم نفس التنسيق والأسلوب في إجابتك):

${diagnosis.includes("R94.4") ? `
التشخيص الأساسي: نتائج غير طبيعية لدراسات وظائف الكلى (ABNORMAL RESULTS OF KIDNEY FUNCTION STUDIES - R94.4)
الأعراض المذكورة: ألم أسفل الظهر.

ما قام به الطبيب:
صرف دواء DAPXIGA 10 MG...إلخ (كما في المثال الذي قدمه المستخدم سابقًا)

تحليل الإجراءات ومبرراتها الطبية:
...

احتمالية الرفض من التأمين:
...

ما كان يمكن عمله لرفع الفاتورة:
...

الزيادة المحتملة في الدخل: ...
` : ""}

📝 تذكر:
- لا تختلق معلومات، ولا تتجاهل الإجراءات المدخلة.
- إذا وُجد رقم (مثل سكر عشوائي ٣٠٠)، فهو نتيجة تحليل وليس سعر.
- اكتب بالريال السعودي دائمًا.
- النتيجة النهائية يجب أن تكون صيغة نص طبي تأميني مفصل، مثل المثال المرجعي أعلاه.
- استخدم العربية الفصحى.

---

بيانات الحالة:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- قبل التشخيص: ${beforeProcedure}
- بعد التشخيص: ${afterProcedure}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "system", content: systemPrompt }],
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
