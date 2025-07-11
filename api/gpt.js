export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { diagnosis, symptoms, procedure } = req.body;

  const prompt = `
تشخيص: ${diagnosis}
الأعراض: ${symptoms}
الإجراء الطبي المقترح: ${procedure}

هل هذا الإجراء مغطى عادةً من قبل التأمين الطبي؟ اشرح ذلك بطريقة واضحة للطبيب المراجع.
`;

  try {
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'أنت خبير تأمين صحي وطبي.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const data = await completion.json();

    if (!data.choices || !data.choices.length) {
      return res.status(500).json({ error: 'No result from GPT' });
    }

    res.status(200).json({ result: data.choices[0].message.content });

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
