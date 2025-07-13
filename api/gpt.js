import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

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
        if (patientAge < 30 && !patientSymptoms.includes('عطش') && !patientSymptoms.includes('تبول') && !patientSymptoms.includes('فقدان وزن')) {
          justification = '⚠️ مبررة ولكن غير مدعومة (غير كافٍ بمفرده دون أعراض داعمة، يجب توثيق الأعراض أو طلب HbA1c لاحقاً)';
          risk = 'متوسط إلى مرتفع';
        }
      }

      return { justification, risk };
    };

    const proceduresWithEvaluations: any[] = [];

    if (beforeProcedure && Array.isArray(beforeProcedure)) {
      beforeProcedure.forEach((proc: string) => {
        const { justification, risk } = evaluateProcedureJustification(proc, age, symptoms);
        proceduresWithEvaluations.push({
          step: proc,
          justification: justification,
          rationale: `تقييم مبدئي بناءً على العمر والأعراض: ${risk}`
        });
      });
    }

    if (afterProcedure && Array.isArray(afterProcedure)) {
      afterProcedure.forEach((proc: string) => {
        const { justification, risk } = evaluateProcedureJustification(proc, age, symptoms);
        proceduresWithEvaluations.push({
          step: proc,
          justification: justification,
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
2. بيان واضح لكل مبرر طبياً مع التركيز على التوثيق السريري المطلوب لقبوله تأمينياً، ويجب أن يتم تقييم الإجراء بناءً على عمر المريض والسياق:
  - في الأعمار الصغيرة (مثلاً: 20–30 سنة)، لا يُعتد بتحليل سكر عشوائي منفرد (200) بدون أعراض داعمة.
  - يتم الأخذ بعين الاعتبار الأعراض المرافقة مثل العطش، التبول المتكرر، فقدان الوزن.
  - الإجراء يعتبر مبرر فقط إذا كان مرتبطاً فعلاً بشكوى المريض أو ضمن خطة تقييم متكاملة.
3. الكشف عن الإجراءات أو الفحوصات الطبية المفقودة والتي كان من الأفضل عملها حسب التخصص، مثل:
- في حالات الباطنة: CBC، ESR، HbA1c، وظائف كلى، تحليل بول، فحص القدم، تخطيط قلب.
- في أمراض العيون: OCT، قياس ضغط العين، تصوير الشبكية، اختبار شيرمر، المصباح الشقي، قياس النظر، فحص قاع العين، واختبارات متابعة الشبكية في حالة مرضى السكري، ويُنصح بذكر ضغط العين وفحص النظر عند وجود أعراض بصرية مثل غباش أو ألم.
- في النساء والولادة: سونار، تحليل هرمونات، فحص مهبلي، فحص عنق الرحم.
- في طب الأسنان: أشعة بانورامية، فحص جيوب لثوية، تقييم تسوس، علاج جذور.
- في العظام: أشعة X، تصوير رنين، تقييم مدى الحركة، فحص كثافة العظم.
- في الطب العام: تحليل دم شامل، تقييم علامات حيوية، فحوصات روتينية بناء على الشكوى.
4. تقديم توصيات لتحسين الإيراد من نفس الحالة بطريقة مشروعة ومغطاة، ويجب توضيح الإجراءات التي كان من الممكن القيام بها ولم تُوثق، مثل:
- في ارتفاع الضغط: يجب دائمًا دعم صرف علاج الضغط بقياس فعلي موثق للضغط.
- في وصف المضادات الحيوية: يُشترط وجود حرارة، فحص سريري إيجابي، أو تحليل دم يدعم وجود عدوى مثل WBC مرتفع أو CRP.

🧾 صيغة الإخراج المطلوبة (JSON فقط):
- result: ملخص طبي واضح للحالة
- justification: تحليل بندي للإجراءات المتخذة (مصفوفة: [{ step, justification, rationale }])
- rejectionRisk: (منخفض / متوسط / مرتفع)
- rejectionReason: سبب الرفض المحتمل إن وُجد
- rejectedValue: مبلغ معرض للرفض إن وُجد
- improvementSuggestions: مصفوفة JSON حقيقية فقط بدون أي شرح نصي أو تنسيق Markdown، يجب أن تكون على هذا الشكل:
  [
    {
      "title": "تحليل السكر التراكمي HbA1c",
      "description": "لمعرفة مدى السيطرة على السكري خلال الثلاثة أشهر الماضية.",
      "estimatedValue": "150",
      "whyNotRejectable": "ضروري ومغطى تأمينياً لجميع مرضى السكري."
    },
    {
      "title": "تحليل وظائف الكلى",
      "description": "للكشف عن أثر السكري على الكلى.",
      "estimatedValue": "200",
      "whyNotRejectable": "مغطى تأمينياً عند وجود سكري مزمن."
    }
  ]
- potentialRevenueIncrease: عبارة منظمة توضح إجمالي الزيادة الممكنة مع دمج أسماء الإجراءات المقترحة وتأثيرها المالي والتأميني.

📊 بناءً على تحليل عدة حالات مشابهة، يجب إعطاء توصيات استراتيجية للطبيب توضح:
- الأخطاء المتكررة التي تؤدي إلى رفض التأمين، مثل صرف أدوية دون قياس أو تشخيص داعم.
- عدم توثيق نتائج فحوصات مهمة مثل قياس الضغط، أو وجود حرارة، أو نتائج المختبر.
- أهمية التفريق بين ما هو مبرر طبيًا وما هو مبرر تأمينيًا.
- ضرورة دمج الأعراض، النتائج، والفحوصات التشخيصية في قرار كل إجراء.
- أهم الإجراءات التي يُنصح بها وتُهمل غالبًا، خاصة OCT، قياس ضغط العين، اختبار شيرمر، فحص نظر، CBC في حالات العدوى، ومزرعة بول عند وجود أعراض بولية.
- مقترح لتحسين أسلوب التوثيق: ربط مباشر بين كل دواء أو فحص وسبب صرفه، مع توثيق النتيجة أو العرض المؤيد، مثل: “ألم في العين + انخفاض رؤية + شبكية طبيعية = لا حاجة لـ مضاد حيوي دون عدوى مثبتة.”

🔬 بيانات الحالة:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender === 'male' ? 'ذكر' : gender === 'female' ? 'أنثى' : 'غير محدد'}
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
