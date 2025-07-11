export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { diagnosis, symptoms, procedure } = req.body;

  if (!diagnosis || !symptoms || !procedure) {
    return res.status(400).json({ error: 'Missing input data' });
  }

  const prompt = `أنت خبير تأمين طبي. حلل الحالة التالية:\nتشخيص: ${diagnosis}\nالأعراض: ${symptoms}\nالإجراء المطلوب: ${procedure}\n\nهل هذا الإجراء مغطى تأمينيًا عادة؟ هل هناك خطر رفض؟ ما البدائل؟ اكتب نص توثيق طبي مقترح مختصر.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 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'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    res.status(200).json({ result: data.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: 'خطأ في الاتصال بـ OpenAI API.' });
  }
} 
