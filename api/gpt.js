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

  // تابع تنفيذ الطلب هنا
  const { diagnosis, symptoms, age, gender, beforeProcedure, afterProcedure } = req.body;

  if (!diagnosis || !symptoms || !age || !gender || !beforeProcedure || !afterProcedure) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const prompt = `...`; // اختصرته هنا، تقدر تستخدم نفس الـ prompt اللي أرسلته لك سابقًا

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "user", content: prompt }
        ],
        max_tokens: 1000
      })
    });

    const data = await completion.json();
    const result = data.choices?.[0]?.message?.content || "لا توجد نتيجة من GPT";

    res.status(200).json({ result });

  } catch (err) {
    console.error("GPT API error:", err);
    res.status(500).json({ error: "GPT API error: " + err.message });
  }
}
