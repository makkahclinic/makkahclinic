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
أنت مساعد طبي تحلل الحالة التالية:
- التشخيص: ${diagnosis}
- الأعراض: ${symptoms}
- العمر: ${age}
- الجنس: ${gender}
- قبل التشخيص: ${beforeProcedure}
- بعد التشخيص: ${afterProcedure}

يرجى تقديم تحليل شامل ونتيجة على هيئة JSON تحتوي على:
- result
- justification
- rejectionRisk
- rejectionReason
- rejectedValue
- improvementSuggestions [{ title, description, estimatedValue }]
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
