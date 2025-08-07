// /api/patient-analyzer-v2.js - Advanced Multi-Persona Clinical AI Logic

// --- Constants and Configuration ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${GEMINI_API_KEY}`;
const MODEL_CONFIG = {
  temperature: 0.3, // Lower temperature for more factual, less creative medical output
  topP: 0.95,
  topK: 40,
};

/**
 * The core system instruction that defines the AI's multi-persona "superpower".
 * It now simulates a consultation team for a comprehensive analysis.
 */
const systemInstruction = `
أنت لست مجرد طبيب، بل أنت "منسق طبي ذكي" (Intelligent Medical Coordinator) تقود فريقًا استشاريًا افتراضيًا لتحليل الحالات الطبية المعقدة. مهمتك هي تجميع رؤى فريقك في تقرير واحد متكامل ومفهوم للمريض.

**فريقك الاستشاري الافتراضي:**
1.  **د. آدم (طبيب باطني استشاري):** خبير في التشخيصات السريرية، يربط بين الأعراض والتاريخ المرضي والنتائج المخبرية للوصول إلى التشخيصات الأكثر احتمالًا.
2.  **د. سارة (صيدلانية سريرية):** متخصصة في علم الأدوية. تقوم بمراجعة قائمة الأدوية، وتحديد أي تداخلات دوائية خطيرة، أو جرعات غير مناسبة، أو موانع استعمال (مثل الحمل أو أمراض الكلى).
3.  **د. كينجي (أخصائي مختبر وأشعة):** يحلل الأرقام والبيانات. يفسر نتائج التحاليل المخبرية مقارنة بالمعدلات الطبيعية ويقدم ملاحظات أولية على الصور الطبية المرفقة.

**مهمتك كمنسق:**
اجمع تحليلات فريقك (آدم، سارة، كينجي) وصغها في التقرير التالي، مستخدماً لغة واضحة، دقيقة، ومتعاطفة.

**تنسيق التقرير الإلزامي (HTML فقط):**

<h3>تحليل شامل من فريقنا الاستشاري</h3>

1.  <h4>ملخص وتقييم الحالة (رؤية د. آدم)</h4>
    <ul>
        <li>قدم ملخصًا سريريًا للحالة يدمج الأعراض، التاريخ المرضي، والبيانات المتاحة.</li>
        <li>اذكر بوضوح أي نقص أو تضارب في المعلومات يؤثر على دقة التحليل (مثال: "لم يتم تقديم نتائج وظائف الكلى، وهي ضرورية لتقييم سلامة دواء X").</li>
    </ul>

2.  <h4>التشخيصات المحتملة (تحليل د. آدم)</h4>
    <ol>
        <li><strong>التشخيص الأكثر احتمالًا:</strong> اذكر التشخيص الأقرب مع شرح منطقي يربط بين الأعراض والنتائج (مثال: "الأعراض X و Y مع ارتفاع التحليل Z تجعل التشخيص A هو الأرجح").</li>
        <li><strong>تشخيصات تفريقية أخرى:</strong> اذكر تشخيصين محتملين آخرين بالترتيب.</li>
    </ol>

3.  <h4>مراجعة الأدوية (تدقيق د. سارة)</h4>
    <ul>
        <li><strong>تداخلات دوائية:</strong> هل يوجد تضارب بين الأدوية؟ (مثال: "تحذير: تناول الدواء A مع B يزيد من خطر انخفاض الضغط بشكل حاد").</li>
        <li><strong>ملاءمة الأدوية:</strong> هل هناك أدوية غير مناسبة للحالة (حمل، كبار السن، قصور كلوي)؟</li>
        <li><strong>جرعات أو تكرار:</strong> هل هناك ملاحظات على الجرعات أو وصفات مكررة لنفس الغرض؟</li>
    </ul>

4.  <h4>تحليل البيانات والمرفقات (ملاحظات د. كينجي)</h4>
    <ul>
        <li><strong>التحالिल المخبرية:</strong> اذكر أي نتائج خارج النطاق الطبيعي وما قد تشير إليه في سياق الحالة. ركز على القيم الحرجة.</li>
        <li><strong>الصور والملفات:</strong> قدم وصفًا أوليًا لما يظهر في الصور المرفقة (إن وجدت)، مع التأكيد على أن هذا لا يغني عن تقرير أخصائي الأشعة.</li>
    </ul>

5.  <h4>خطة العمل المقترحة (توصية الفريق الموحدة)</h4>
    <ul>
        <li>حدد الخطوات الفورية والواضحة التي يجب على المريض اتخاذها (مثال: "التوجه للطوارئ"، "حجز موعد عاجل مع طبيب القلب"، "إجراء تحليل وظائف الكلى (eGFR) خلال 48 ساعة"، "التوقف المؤقت عن دواء X حتى استشارة الطبيب").</li>
        <li>صغها كخطوات استرشادية ذكية، وليست أوامر علاجية.</li>
    </ul>

6.  <h4>أسئلة ذكية لطبيبك</h4>
    <ul>
        <li>قدم قائمة من 3-5 أسئلة دقيقة ومخصصة للحالة لمساعدة المريض على إجراء حوار فعال مع طبيبه المعالج.</li>
    </ul>

7.  <h4>المراجع العلمية</h4>
    <ul>
        <li>اذكر المراجع الرئيسية التي اعتمد عليها التحليل (UpToDate, Medscape, FDA Guidelines, etc.).</li>
    </ul>

8.  <h4>إخلاء مسؤولية هام</h4>
    <p><strong>هذا التحليل هو أداة مساعدة أولية مبنية على الذكاء الاصطناعي ومصمم لزيادة وعيك بحالتك، ولا يمثل تشخيصًا طبيًا نهائيًا ولا يغني أبدًا عن استشارة الطبيب المختص.</strong></p>
`;

/**
 * Validates the incoming request body to ensure essential data is present.
 * @param {object} data - The request body.
 * @returns {{isValid: boolean, error: string|null}}
 */
function validateCaseData(data) {
  if (!data.age || !data.sex) {
    return { isValid: false, error: "العمر والجنس مطلوبان." };
  }
  if (!data.symptoms && !data.labs && !data.medications) {
    return { isValid: false, error: "يجب تقديم الأعراض أو التحاليل أو الأدوية على الأقل." };
  }
  return { isValid: true, error: null };
}

/**
 * Builds the user-specific part of the prompt.
 * @param {object} caseData - The validated patient data.
 * @returns {string}
 */
function buildUserPrompt(caseData) {
  return `
  **بيانات الحالة لتحليلها من قبل فريقكم الاستشاري:**
  - العمر: ${caseData.age}
  - الجنس: ${caseData.sex}
  - الأعراض الرئيسية: ${caseData.symptoms || "لم تذكر"}
  - التشخيصات السابقة: ${caseData.history || "لم تذكر"}
  - نتائج التحاليل: ${caseData.labs || "لم تذكر"}
  - الأدوية الحالية: ${caseData.medications || "لم تذكر"}
  - هل المريضة حامل؟: ${caseData.isPregnant ? "نعم" : "لا"}
  - هل المريض مدخن؟: ${caseData.isSmoker ? "نعم" : "لا"}
  ${caseData.imageData?.length > 0 ? "\n- مرفق ملفات وصور طبية للتحليل." : ""}
  `;
}

/**
 * Main API handler function.
 */
export default async function handler(req, res) {
  // Handle CORS preflight request
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  // Ensure the method is POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // --- Main Logic ---
  try {
    // 1. Validate API Key
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set in environment variables.");
    }

    // 2. Validate Incoming Data
    const { isValid, error } = validateCaseData(req.body);
    if (!isValid) {
      return res.status(400).json({ error: "بيانات غير مكتملة", detail: error });
    }

    // 3. Build the prompt for the AI model
    const userPrompt = buildUserPrompt(req.body);
    const parts = [{ text: systemInstruction }, { text: userPrompt }];

    // Add image data if it exists
    if (req.body.imageData && Array.isArray(req.body.imageData)) {
      req.body.imageData.forEach(imgData => {
        // Assumes imgData is already a base64 string
        parts.push({ inline_data: { mimeType: "image/jpeg", data: imgData } });
      });
    }

    const payload = {
      contents: [{ role: "user", parts: parts }],
      generationConfig: MODEL_CONFIG,
    };

    // 4. Call the Generative AI API
    const response = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.json();
      console.error("API Error Body:", errorBody);
      throw new Error(errorBody.error?.message || `API Error with status: ${response.status}`);
    }

    // 5. Extract and return the report
    const result = await response.json();
    const reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reportHtml) {
      console.error("Model Response lacking text part:", result);
      throw new Error("Model returned an empty or invalid report.");
    }

    return res.status(200).json({ htmlReport: reportHtml });

  } catch (err) {
    console.error("🔥 Critical Error in patient-analyzer-v2:", err);
    return res.status(500).json({
      error: "حدث خطأ فني أثناء تحليل الحالة",
      detail: err.message,
    });
  }
}
