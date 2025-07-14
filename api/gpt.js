import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // إعداد CORS بشكل مخصص
  const allowedOrigins = ['https://m2020m.org', 'http://localhost:3000'];
  const origin = req.headers.origin || '';

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

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

    const evaluateProcedureJustification = (procedure: string, patientAge: number, patientSymptoms: string[]) => {
      let justification = '✅ مبررة ومدعومة تأمينياً';
      let risk = 'منخفض';

      if (procedure.includes('سكر عشوائي')) {
        if (
          patientAge < 30 &&
          !patientSymptoms.includes('عطش') &&
          !patientSymptoms.includes('تبول') &&
          !patientSymptoms.includes('فقدان وزن')
        ) {
          justification =
            '⚠️ مبررة ولكن غير مدعومة (غير كافٍ بمفرده دون أعراض داعمة، يجب توثيق الأعراض أو طلب HbA1c لاحقاً)';
          risk = 'متوسط إلى مرتفع';
        }
      }

      return { justification, risk };
    };

    const proceduresWithEvaluations: any[] = [];

    if (Array.isArray(beforeProcedure)) {
      beforeProcedure.forEach((proc: string) => {
        const { justification, risk } = evaluateProcedureJustification(proc, age, symptoms);
        proceduresWithEvaluations.push({
          step: proc,
          justification,
          rationale: `تقييم مبدئي بناءً على العمر والأعراض: ${risk}`
        });
      });
    }

    if (Array.isArray(afterProcedure)) {
      afterProcedure.forEach((proc: string) => {
        const { justification, risk } = evaluateProcedureJustification(proc, age, symptoms);
        proceduresWithEvaluations.push({
          step: proc,
          justification,
          rationale: `تقييم مبدئي بناءً على العمر والأعراض: ${risk}`
        });
      });
    }

    const prompt = `أنت استشاري تحليلات طبية وتأمينية، دورك هو تقييم الحالة التالية بعمق طبي ومالي.

🔍 المطلوب منك:
1. تحليل شامل للإجراءات المُتخذة (أشعة، فحوصات، أدوية) وبيان هل هي:
   ✅ مبررة ومدعومة تأمينياً
   ⚠️ مبررة ولكن غير مدعومة
   ❌ غير مبررة ولا مدعومة

2. بيان واضح لكل مبرر طبياً مع التركيز على التوثيق السريري المطلوب لقبوله تأمينياً، ويجب أن يتم تقييم الإجراء بناءً على عمر المريض والسياق.

3. الكشف عن الإجراءات أو الفحوصات الطبية المفقودة والتي كان من الأفضل عملها حسب التخصص، مثل:
- الباطنة: CBC، ESR، HbA1c، وظائف كلى، بول، تخطيط قلب.
- العيون: OCT، ضغط العين، تصوير الشبكية، اختبار شيرمر، قاع العين.
- النساء: سونار، هرمونات، فحص مهبلي وعنق رحم.
- الأسنان: أشعة بانورامية، فحص لثوي، تقييم تسوس.
- العظام: X-Ray، MRI، حركة المفصل، كثافة العظم.
- الطب العام: تحاليل دم، علامات حيوية.

4. تقديم توصيات لتحسين الإيراد من نفس الحالة بطريقة مشروعة ومغطاة، مثل:
- دعم علاج الضغط بقياس فعلي.
- وصف مضاد حيوي عند وجود حرارة وفحص سريري إيجابي أو WBC مرتفع.

🧾 الإخراج المطلوب JSON فقط:
- result
- justification: [{ step, justification, rationale }]
- rejectionRisk
- rejectionReason
- rejectedValue
- improvementSuggestions: [
    {
      "title": "تحليل HbA1c",
      "description": "لقياس السيطرة على السكري خلال 3 أشهر.",
      "estimatedValue": "150",
      "whyNotRejectable": "مغطى تأمينياً لجميع مرضى السكري."
    },
    {
      "title": "تحليل وظائف الكلى",
      "description": "يكشف عن تأثير السكري على الكلى.",
      "estimatedValue": "200",
      "whyNotRejectable": "مغطى عند وجود سكري مزمن."
    }
  ]
- potentialRevenueIncrease: إجمالي الزيادة الممكنة ماديًا وتأمينيًا.

🔬 بيانات الحالة:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender === 'male' ? 'ذكر' : gender === 'female' ? 'أنثى' : 'غير محدد'}
- الإجراءات التحليلية قبل التشخيص: ${beforeProcedure}
- الإجراءات بعد التشخيص: ${afterProcedure}
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
      const cleaned = raw
        .replace(/^json\s*/i, '')
        .replace(/^```json\s*/i, '')
        .replace(/```$/, '')
        .trim();
      result = JSON.parse(cleaned);
    } catch (parseError) {
      console.error("Failed to parse GPT response:", parseError);
      result = { result: raw, error: "Failed to parse GPT response as JSON." };
    }

    res.status(200).json(result);
  } catch (err: any) {
    console.error("GPT API Error:", err);
    res.status(500).json({ error: "GPT API Error: " + err.message });
  }
}
