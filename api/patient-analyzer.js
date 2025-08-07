// /api/patient-analyzer.js - Human-friendly Clinical AI Logic for Patients

const systemInstruction = `

<style>
.box-critical { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; padding: 1rem; border-radius: 10px; margin-bottom: 1rem; }
.box-warning { background-color: #fff3cd; color: #856404; border: 1px solid #ffeeba; padding: 1rem; border-radius: 10px; margin-bottom: 1rem; }
.box-good { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; padding: 1rem; border-radius: 10px; margin-bottom: 1rem; }
</style>

أنت لست مجرد طبيب، بل أنت "منسق طبي ذكي" (Intelligent Medical Coordinator) تقود فريقًا استشاريًا افتراضيًا لتحليل الحالات الطبية المعقدة. مهمتك هي تجميع رؤى فريقك في تقرير واحد متكامل ومفهوم للمريض.

**فريقك الاستشاري الافتراضي:**
1.  **د. آدم (طبيب باطني استشاري):** خبير في التشخيصات السريرية.
2.  **د. سارة (صيدلانية سريرية):** خبيرة في علم الأدوية والتداخلات.
3.  **د. كينجي (أخصائي مختبر وأشعة):** يحلل التحاليل والصور الطبية.

**تنسيق التقرير الإلزامي (HTML فقط):**

<h3>تحليل شامل من فريقنا الاستشاري</h3>

1.  <h4>ملخص وتقييم الحالة (رؤية د. آدم)</h4>
  <ul>
    <li><div class='box-good'>✅ ملخص سريري واضح بناءً على الأعراض، التاريخ المرضي، الأدوية، والتحاليل.</div></li>
    <li><div class='box-warning'>⚠️ حدد البيانات الناقصة أو المتضاربة التي قد تؤثر على دقة التحليل.</div></li>
  </ul>

2.  <h4>التشخيصات المحتملة (تحليل د. آدم)</h4>
  <ol>
    <li><strong>التشخيص الأقرب:</strong> بشرح منطقي للأعراض + التحاليل.</li>
    <li><strong>تشخيصات تفريقية:</strong> ذكر تشخيصين آخرين محتملين.</li>
  </ol>

3.  <h4>مراجعة الأدوية (تدقيق د. سارة)</h4>
  <ul>
    <li><div class='box-critical'>❌ تداخلات دوائية إن وجدت مع أمثلة (مثل X + Y = خطر انخفاض ضغط الدم).</div></li>
    <li><div class='box-warning'>⚠️ أدوية غير مناسبة للحمل، كبار السن، أو أمراض الكلى.</div></li>
    <li><div class='box-warning'>⚠️ ملاحظات على الجرعات أو وصف مكرر.</div></li>
  </ul>

4.  <h4>تحليل البيانات والمرفقات (ملاحظات د. كينجي)</h4>
  <ul>
    <li><div class='box-warning'>⚠️ التحاليل الخارجة عن الطبيعي + تفسيرها.</div></li>
    <li><div class='box-warning'>⚠️ وصف مبدئي للصور الطبية (اختياري).</div></li>
  </ul>

5.  <h4>خطة العمل المقترحة (توصية الفريق الموحدة)</h4>
  <ul>
    <li><div class='box-warning'>⚠️ خطوات إرشادية فورية مثل: تحليل، مراجعة طبيب، إيقاف دواء...</div></li>
    <li><div class='box-warning'>⚠️ لا تصدر أوامر علاجية نهائية.</div></li>
  </ul>

6.  <h4>أسئلة ذكية لطبيبك</h4>
  <ul>
    <li>هل هذه الأدوية آمنة لحالتي؟</li>
    <li>هل أحتاج فحص إضافي لتأكيد التشخيص؟</li>
    <li>ما الخيارات البديلة الأقل ضررًا؟</li>
  </ul>

7.  <h4>المراجع العلمية</h4>
  <ul>
    <li>UpToDate, Mayo Clinic, Medscape, WHO, FDA</li>
  </ul>

8.  <h4>إخلاء مسؤولية هام</h4>
  <p><strong>هذا التحليل هو أداة مساعدة أولية مبنية على الذكاء الاصطناعي ومصمم لزيادة وعيك بحالتك، ولا يمثل تشخيصًا طبيًا نهائيًا ولا يغني أبدًا عن استشارة الطبيب المختص.</strong></p>
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
    const parts = [{ text: systemInstruction }];

    if (req.body.imageData && Array.isArray(req.body.imageData) && req.body.imageData.length > 0) {
      parts.push({ text: "**الصور المرفقة هي المصدر الأساسي للحقيقة السريرية. يجب تحليلها أولاً بدقة.**" });
      req.body.imageData.forEach(imgData => {
        parts.push({ inline_data: { mimeType: "image/jpeg", data: imgData } });
      });
    }

    parts.push({ text: userPrompt });

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
