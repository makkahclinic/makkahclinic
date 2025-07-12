export default async function handler(req, res) {
  // إعداد رؤوس CORS للسماح بالوصول من موقعك
  res.setHeader('Access-Control-Allow-Origin', 'https://m2020m.org');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // السماح بطلبات CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // رفض أي طريقة غير POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // استخراج البيانات القادمة من النموذج
  const { diagnosis, symptoms, age, gender, beforeProcedure, afterProcedure } = req.body;

  if (!diagnosis || !symptoms || !age || !gender || !beforeProcedure || !afterProcedure) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key is not set.");
    }

    const prompt = `
أنت مساعد خبير في مراجعة الحالات الطبية وتقييم التغطية التأمينية. الحالة التالية تحتوي على:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- الإجراءات قبل التشخيص: ${beforeProcedure}
- الإجراءات بعد التشخيص: ${afterProcedure}

يرجى تحليل التناسق بين التشخيص، الأعراض، والإجراءات.
- هل هناك خطر رفض من شركة التأمين؟ ولماذا؟
- ما المبررات الطبية المقبولة؟
- هل توجد إجراءات إضافية موصى بها طبياً وتزيد من الإيراد؟
- قدم النتيجة في JSON يتضمن:
  - result
  - justification
  - rejectionRisk
  - rejectionReason
  - rejectedValue
  - improvementSuggestions: [{ title, description, estimatedValue }]
  - potentialRevenueIncrease
    `;

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000
      })
    });

    const data = await completion.json();
    const rawContent = data.choices?.[0]?.message?.content;

    let result = {};
    try {
      result = JSON.parse(rawContent);
    } catch (e) {
      result = { result: rawContent };
    }

    res.status(200).json(result);
  } catch (err) {
    console.error("GPT API error:", err);
    res.status(500).json({ error: "GPT API error: " + err.message });
  }
}
