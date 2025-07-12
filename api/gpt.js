// pages/api/gpt.js (أو المسار الفعلي لملف الـ API الخاص بك)
export default async function handler(req, res) {
  // *** هنا الجزء الجديد والمهم للتعامل مع 405 ***
  // تأكد أنك تسمح بطلبات OPTIONS لـ CORS Preflight إذا كنت تستخدم رؤوسًا معقدة
  res.setHeader('Access-Control-Allow-Origin', 'https://m2020m.org'); // تأكد من وجود هذا
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); // *** تأكد من إضافة POST و OPTIONS هنا ***
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // تأكد من وجود هذا

  // إذا كان الطلب هو OPTIONS (يستخدمه المتصفح للتحقق من CORS قبل إرسال الطلب الفعلي)
  if (req.method === 'OPTIONS') {
    return res.status(200).end(); // استجابة فارغة ولكن برمز 200 لتلبية طلب Preflight
  }
  // *** نهاية الجزء الخاص بـ CORS و 405 ***

  // هذا هو الجزء الذي يتعامل مع طلب POST الفعلي
  if (req.method === 'POST') {
    const { diagnosis, symptoms, procedure } = req.body;

    // قم بإضافة التحقق من صحة البيانات هنا إذا لزم الأمر
    if (!diagnosis || !symptoms || !procedure) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      // هنا تضع المنطق الذي يتفاعل مع خدمة GPT الخارجية
      // مثال:
      // const gptResponse = await fetch('YOUR_GPT_API_ENDPOINT', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'Authorization': `Bearer YOUR_GPT_API_KEY`
      //   },
      //   body: JSON.stringify({ prompt: `تشخيص: ${diagnosis}, أعراض: ${symptoms}, إجراء: ${procedure}`, max_tokens: 150 })
      // });
      // const gptData = await gptResponse.json();
      // const result = gptData.choices[0].text;

      // لتجربة سريعة، يمكن إرجاع استجابة وهمية:
      const result = `نتيجة تحليل الحالة لـ: ${diagnosis}, الأعراض: ${symptoms}, الإجراء المقترح: ${procedure}. تغطية تأمينية: محتملة.`;

      res.status(200).json({ result: result });
    } catch (apiError) {
      console.error("Error calling GPT API:", apiError); // سجل الخطأ لمراجعته في Vercel Logs
      res.status(500).json({ error: 'An error occurred while processing your request with the external API.' });
    }
  } else {
    // إذا وصل أي طلب بخلاف POST أو OPTIONS، أرجع 405
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
