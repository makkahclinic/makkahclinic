export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
أنت استشاري تحليلات طبية وتأمينية، دورك هو تقييم الحالة التالية بعمق طبي ومالي.

🔍 المطلوب منك:
1. تحليل شامل للإجراءات المُتخذة (أشعة، فحوصات، أدوية) وبيان هل هي:
   ✅ مبررة ومدعومة تأمينياً
   ⚠️ مبررة ولكن غير مدعومة
   ❌ غير مبررة ولا مدعومة
2. بيان واضح لكل مبرر طبياً مع التركيز على التوثيق السريري المطلوب لقبوله تأمينياً.
3. الكشف عن الإجراءات أو الفحوصات الطبية المفقودة والتي كان من الأفضل عملها (مثل CBC، ESR، تحليل بول، وظائف كلى... حسب التشخيص والأعراض).
4. تقديم توصيات لتحسين الإيراد من نفس الحالة بطريقة مشروعة ومغطاة.

🧾 صيغة الإخراج المطلوبة (JSON فقط):
- result: ملخص طبي واضح للحالة
- justification: تحليل بندي للإجراءات المتخذة (مصفوفة: [{ step, justification, rationale }])
- rejectionRisk: (منخفض / متوسط / مرتفع)
- rejectionReason: سبب الرفض المحتمل إن وُجد
- rejectedValue: مبلغ معرض للرفض إن وُجد
- improvementSuggestions: قائمة من الفقرات، كل فقرة تصف الإجراء المقترح بصيغة تقريرية مثل:
🔹 اسم الإجراء (مثلاً: اختبار الشبكية بالتصوير):
- الأهمية الطبية: ...
- ما هي الأعراض أو التشخيصات التي تبرر طلبه: ...
- القيمة التقديرية: ...
- لماذا لا يُرفض تأمينياً: ...
  • اسم الإجراء (title)
  • الأهمية الطبية (description)
  • القيمة التقديرية بالريال السعودي (estimatedValue)
  • لماذا لا يُرفض تأمينياً (whyNotRejectable)
- potentialRevenueIncrease: عبارة منظمة توضح إجمالي الزيادة الممكنة مع دمج أسماء الإجراءات المقترحة وتأثيرها المالي والتأميني.
