export default async function handler(req, res) {
  // السماح بطلبات من m2020m.org
  res.setHeader("Access-Control-Allow-Origin", "https://m2020m.org");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // الرد على طلبات OPTIONS مسبقة
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { diagnosis, symptoms, procedure } = req.body;

  const prompt = `
تشخيص: ${diagnosis}
الأعراض: ${symptoms}
الإجراء المقترح: ${procedure}
أنت خبير تأمين طبي. هل هذه الحالة مغطاة عادة بالتأمين؟ ولماذا؟
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      })
    });

    const data = await response.json();

    if (data.choices?.[0]?.message?.content) {
      res.status(200).json({ result: data.choices[0].message.content });
    } else {
      res.status(500).json({ error: "No result from GPT" });
    }
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
}
