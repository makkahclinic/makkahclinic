// ملف gpt.js داخل مجلد /api
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { diagnosis, symptoms, procedure } = req.body;

  if (!diagnosis || !symptoms || !procedure) {
    return res.status(400).json({ error: 'Missing input fields' });
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
    const result = data.choices?.[0]?.message?.content || 'No response from model';

    res.status(200).json({ result });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Failed to connect to OpenAI API' });
  }
}
