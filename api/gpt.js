export const config = {
  runtime: 'nodejs',
};

import Cors from 'micro-cors';
import type { NextApiRequest, NextApiResponse } from 'next';

const cors = Cors({
  origin: ['https://m2020m.org', 'http://localhost:3000'],
  allowMethods: ['POST', 'OPTIONS'],
});

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { diagnosis, symptoms, age, gender, beforeProcedure, afterProcedure } = req.body;

  if (!diagnosis || !symptoms || !age || !gender || !beforeProcedure || !afterProcedure) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key is not set.");

    const evaluateProcedureJustification = (
      procedure: string,
      patientAge: number,
      patientSymptoms: string[]
    ) => {
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
        proceduresWithEvaluations.push({ step: proc, justification, rationale: `تقييم مبدئي بناءً على العمر والأعراض: ${risk}` });
      });
    }

    if (Array.isArray(afterProcedure)) {
      afterProcedure.forEach((proc: string) => {
        const { justification, risk } = evaluateProcedureJustification(proc, age, symptoms);
        proceduresWithEvaluations.push({ step: proc, justification, rationale: `تقييم مبدئي بناءً على العمر والأعراض: ${risk}` });
      });
    }

    const prompt = `أنت استشاري تحليلات طبية وتأمينية، دورك هو تقييم الحالة التالية بعمق طبي ومالي.

🔍 المطلوب:
(نفس محتوى البرومبت الخاص بك...)

🔬 بيانات الحالة:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- قبل التشخيص: ${beforeProcedure}
- بعد التشخيص: ${afterProcedure}
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
        .replace(/^json\\s*/i, '')
        .replace(/^```json\\s*/i, '')
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
};

// 🔥 الحل الحقيقي هنا:
export default cors(handler);
