// /api/gpt.js
export default async function handler(req, res) {
  // 1. إعداد CORS (جداً مهم)
  res.setHeader('Access-Control-Allow-Origin', 'https://m2020m.org');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 2. إذا كان الطلب OPTIONS (طلب Preflight)، ارجع OK
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 3. إذا كان غير POST، نرفضه
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { diagnosis, symptoms, procedure } = req.body;

  if (!diagnosis || !symptoms || !procedure) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OpenAI API key' });
  }

  try {
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'أنت مساعد تأمين طبي. حلل البيانات التالية وحدد إذا كان الإجراء الطبي مغطى بالتأمين.'
          },
          {
            role: 'user',
            content: `تشخيص: ${diagnosis}\nالأعراض: ${symptoms}\nالإجراء الطبي: ${procedure}`
          }
        ]
      })
    });

    const data = await completion.json();
    const result = data.choices?.[0]?.message?.content || 'لا يوجد رد من GPT';

    res.status(200).json({ result });
  } catch (err) {
    console.error('OpenAI Error:', err);
    res.status(500).json({ error: 'فشل الاتصال بـ GPT API' });
  }
}
