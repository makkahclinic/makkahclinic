export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://m2020m.org');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { diagnosis, symptoms, age, gender, beforeProcedure, afterProcedure } = req.body;

  if (!diagnosis || !symptoms || !age || !gender || !beforeProcedure || !afterProcedure) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key is not set.");

    const prompt = `
أنت استشاري تحليلات طبية وتأمينية، دورك هو تقييم الحالة التالية بعمق طبي ومالي.

🔍 المطلوب منك:
1. تحليل شامل للإجراءات المُتخذة (أشعة، فحوصات، أدوية) وبيان هل هي:
   ✅ مبررة ومدعومة تأمينياً
   ⚠️ مبررة ولكن غير مدعومة
   ❌ غير مبررة ولا مدعومة
2. بيان واضح لكل مبرر طبياً مع التركيز على التوثيق السريري المطلوب لقبوله تأمينياً.
3. الكشف عن الإجراءات أو الفحوصات الطبية المفقودة والتي كان من الأفضل عملها (مثل CBC، ESR، تحليل بول، وظائف كلى... حسب التشخيص والأعراض).
4. تقديم توصيات لتحسين الإيراد من نفس الحالة بطريقة مشروعة ومغطاة.

🧾 صيغة الإخراج المطلوبة (JSON فقط):
- result: ملخص طبي واضح للحالة
- justification: تحليل بندي للإجراءات المتخذة (مصفوفة: [{ step, justification, rationale }])
- rejectionRisk: (منخفض / متوسط / مرتفع)
- rejectionReason: سبب الرفض المحتمل إن وُجد
- rejectedValue: مبلغ معرض للرفض إن وُجد
- improvementSuggestions: قائمة [{ title, description, estimatedValue }]
- potentialRevenueIncrease: نص مالي يوضح كم يمكن تحسين الإيراد وما السبب

🔬 بيانات الحالة:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- الإجراءات التحليلية (أشعة وتحاليل) قبل التشخيص: ${beforeProcedure}
- الإجراءات العلاجية والوقائية بعد التشخيص: ${afterProcedure}
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
        max_tokens: 1400
      })
    });

    const data = await completion.json();
    const raw = data.choices?.[0]?.message?.content;

    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      result = { result: raw };
    }

    res.status(200).json(result);
  } catch (err) {
    console.error("GPT API Error:", err);
    res.status(500).json({ error: "GPT API Error: " + err.message });
  }
}
