// /api/patient-analyzer.js - Human-friendly Clinical AI Logic for Patients

const systemInstruction = `
أنت طبيب استشاري متخصص في الطب الباطني والرعاية الشاملة. مهمتك هي مساعدة المريض على فهم حالته بناءً على ما أدخله من أعراض، أدوية، وتحاليل.

**الهيكل الإلزامي للتقرير (HTML فقط):**

<h3>تحليل حالتك الصحية</h3>

1. <h4>وصف الحالة</h4>
<ul>
<li>قدم ملخصًا للحالة بناءً على البيانات المُدخلة.</li>
<li>اذكر ما إذا كانت هناك بيانات ناقصة تؤثر على دقة التحليل.</li>
</ul>

2. <h4>أقرب التشخيصات المحتملة</h4>
<ol>
<li>ضع التشخيص الأقرب بناءً على المعطيات.</li>
<li>ثم الاحتمالات الأقل دقة بالترتيب.</li>
</ol>

3. <h4>ملاحظات حرجة / أخطاء طبية محتملة</h4>
<ul>
<li>تضارب بين الأدوية</li>
<li>أدوية عالية الخطورة حسب العمر أو التحاليل</li>
<li>جرعات غير مناسبة</li>
</ul>

4. <h4>خطة العمل (Action Plan)</h4>
<ul>
<li>مثلاً: أوقف دواء معين مؤقتًا، اعمل تحليل، راجع طبيب مختص...</li>
</ul>

5. <h4>أسئلة تقترح أن تطرحها على طبيبك</h4>
<ul>
<li>هل أحتاج إلى تحليل وظائف الكلى؟</li>
<li>هل هذه الأدوية مناسبة لمرضي المزمن؟</li>
</ul>

**ملاحظات تقنية إلزامية:**
- اكتب بلغة إنسانية واضحة.
- لا تُصدر تشخيصًا نهائيًا، بل ترجيحي.
- لا تقدم علاجًا مباشرًا دون اقتراح مراجعة طبيب متخصص.
- إذا كانت البيانات ناقصة، نبّه المستخدم بذلك.

**المصادر:** UpToDate, Mayo Clinic, Medscape, WHO, FDA
`;

function buildUserPrompt(caseData) {
  return `
  **بيانات الحالة التي أدخلها المستخدم:**
  - العمر: ${caseData.age}
  - الجنس: ${caseData.sex}
  - الأعراض: ${caseData.symptoms}
  - التشخيص السابق: ${caseData.history}
  - التحاليل: ${caseData.labs}
  - الأدوية الحالية: ${caseData.medications}
  - حامل: ${caseData.isPregnant ? "نعم" : "لا"}
  - مدخن: ${caseData.isSmoker ? "نعم" : "لا"}
  ${caseData.imageData?.length > 0 ? "\n- مرفق صور طبية للتحليل." : ""}
  `;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

    const userPrompt = buildUserPrompt(req.body);
    const parts = [{ text: systemInstruction }, { text: userPrompt }];

    if (req.body.imageData && Array.isArray(req.body.imageData)) {
      req.body.imageData.forEach(imgData => {
        parts.push({ inline_data: { mimeType: "image/jpeg", data: imgData } });
      });
    }

    const payload = {
      contents: [{ role: "user", parts: parts }],
      generationConfig: { temperature: 0.4, topP: 0.95, topK: 40 },
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.json();
      throw new Error(errorBody.error?.message || `API Error: ${response.status}`);
    }

    const result = await response.json();
    const reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reportHtml) {
      throw new Error("Model returned an empty report.");
    }

    return res.status(200).json({ htmlReport: reportHtml });

  } catch (err) {
    console.error("🔥 Error in patient-analyzer:", err);
    return res.status(500).json({
      error: "حدث خطأ أثناء تحليل الحالة",
      detail: err.message,
    });
  }
}
