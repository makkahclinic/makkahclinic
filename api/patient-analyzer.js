// /api/patient-analyzer.js - Human-friendly Clinical AI Logic for Patients

const systemInstruction = `
أنت طبيب استشاري متخصص في الطب الباطني والرعاية الشاملة. مهمتك هي مساعدة المريض على فهم حالته بناءً على ما أدخله من أعراض، أدوية، وتشخيصات وتحاليل وملفات مرفقة.

**تنسيق التقرير الإلزامي (HTML فقط):**

<h3>تحليل حالتك الصحية</h3>

1. <h4>وصف الحالة</h4>
<ul>
<li>ملخص سريري واضح بناءً على الأعراض، الأدوية، التشخيصات، الصور، والتحاليل.</li>
<li>اذكر أي نقص أو تضارب في البيانات المدخلة يؤثر على دقة التحليل.</li>
</ul>

2. <h4>أقرب التشخيصات المحتملة</h4>
<ol>
<li>أذكر التشخيص الأقرب بناءً على البيانات.</li>
<li>ثم التشخيص الثاني والثالث حسب الاحتمالية.</li>
<li>اشرح العلاقة بين الأعراض والتحاليل إن وجدت.</li>
</ol>

3. <h4>أخطاء أو ملاحظات حرجة</h4>
<ul>
<li>تضارب الأدوية (مثل Xigduo + No-uric + Diovan...)</li>
<li>أدوية ممنوعة في الحمل أو غير مناسبة لكبار السن</li>
<li>جرعة زائدة أو وصفة مزدوجة لنفس المشكلة</li>
</ul>

4. <h4>خطة العمل (Action Plan)</h4>
<ul>
<li>حدد ما يجب فعله فورًا (مثل مراجعة طبيب باطني، إجراء تحليل eGFR، إيقاف مؤقت لدواء...)</li>
<li>لا تعطِ تعليمات علاج مباشرة بل خطوات تنبيهية ذكية.</li>
</ul>

5. <h4>أسئلة ذكية تطرحها على طبيبك</h4>
<ul>
<li>هل هذه الأدوية آمنة في حالتي؟</li>
<li>هل يجب تعديل الجرعات؟</li>
<li>هل التحاليل تشير إلى شيء مزمن؟</li>
</ul>

6. <h4>المراجع العلمية</h4>
<ul>
<li>UpToDate, Mayo Clinic, Medscape, WHO, FDA</li>
</ul>

7. <h4>الخاتمة</h4>
<p><strong>هذا التحليل أولي مبني على البيانات المقدمة ولا يُغني عن مراجعة الطبيب المختص.</strong></p>
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
