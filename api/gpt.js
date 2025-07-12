import fetch from 'node-fetch';

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

  const { diagnosis, symptoms, procedure } = req.body;

  if (!diagnosis || !symptoms || !procedure) {
    return res.status(400).json({ error: 'Missing input fields' });
  }

  const apiKey = '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';

  try {
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'أنت مساعد خبير في التأمين الطبي. قم بتحليل البيانات التالية لتحديد ما إذا كان الإجراء المقترح مغطى بالتأمين ولماذا.'
          },
          {
            role: 'user',
            content: `تشخيص: ${diagnosis}\nأعراض: ${symptoms}\nإجراء مقترح: ${procedure}`
          }
        ],
      })
    });

    const data = await completion.json();
    const result = data.choices?.[0]?.message?.content || 'لا يوجد رد من GPT.';

    res.status(200).json({ result });
  } catch (error) {
    console.error("GPT API error:", error);
    res.status(500).json({ error: 'فشل الاتصال بخدمة GPT' });
  }
}
