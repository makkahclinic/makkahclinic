// /api/gpt.js

/**
 * @description Serverless API endpoint to generate a structured JSON medical insurance review.
 * This version uses Google's Gemini API with a specific JSON schema in the response configuration
 * to ensure a valid, parseable JSON object is always returned, matching the frontend's requirements.
 *
 * تم تحديث هذا الكود ليستخدم Gemini API مع تحديد مخطط JSON في الإعدادات لضمان
 * الحصول على رد بصيغة JSON منظمة تتوافق مع متطلبات الواجهة الأمامية.
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Ensure the request method is POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const {
    diagnosis,
    symptoms,
    age,
    gender,
    smoker,
    beforeProcedure,
    afterProcedure,
  } = req.body;

  // Validate that all required fields are present
  if (
    !diagnosis ||
    !symptoms ||
    !age ||
    !gender ||
    smoker === undefined ||
    !beforeProcedure ||
    !afterProcedure
  ) {
    return res.status(400).json({ error: "الرجاء ملء جميع الحقول." });
  }

  // Use the Gemini API key from Vercel's environment variables.
  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  // **CRITICAL CHANGE**: The prompt is now highly detailed and prescriptive to force
  // the model to generate a deep, insightful, and actionable report, not just a summary.
  // **تغيير جوهري**: التعليمات الآن مفصلة وتوجيهية للغاية لإجبار النموذج على
  // إنشاء تقرير عميق ومفيد وقابل للتنفيذ، وليس مجرد ملخص.
  const jsonPrompt = `
    أنت خبير استشاري في المراجعة الطبية والتأمين، ومهمتك مزدوجة: ضمان أفضل رعاية للمريض وتحقيق أقصى استفادة مالية مشروعة للعيادة. قم بتحليل الحالة التالية بعمق وقدم تقريراً مفصلاً بصيغة JSON. لا تكن مختصراً أبداً.

    **بيانات الحالة:**
    - التشخيص: ${diagnosis}
    - الأعراض: ${symptoms}
    - العمر: ${age}
    - الجنس: ${gender}
    - مدخن: ${smoker ? 'نعم' : 'لا'}
    - الإجراءات قبل التشخيص: ${beforeProcedure}
    - الإجراءات بعد التشخيص: ${afterProcedure}

    ---
    **التحليل المطلوب (يجب أن يكون مفصلاً وعميقاً):**

    1.  **result (الملخص النقدي):**
        -   قدم ملخصاً نقدياً للحالة. لا تكتفِ بسرد البيانات.
        -   حلل العلاقة بين التشخيص والأعراض والإجراءات المتخذة.
        -   هل هناك تقصير واضح في الرعاية؟ هل الإجراءات كافية أم سطحية؟ ما هي الصورة الكبيرة التي تراها كخبير؟

    2.  **justification (تقييم الإجراءات):**
        -   لكل إجراء تم اتخاذه، قدم تبريراً مفصلاً.
        -   مثال: إذا كان التشخيص "مشاكل كلى" وتم صرف دواء سكري، اشرح الرابط الطبي المنطقي (مثل: "مرضى الكلى غالباً ما يعانون من السكري، لذا فإن صرف دواء السكري مبرر لضبط الحالة المصاحبة").

    3.  **rejectionRisk (مخاطر الرفض):**
        -   بناءً على تحليلك، حدد مستوى الخطر (منخفض/متوسط/مرتفع).
        -   اشرح سبب هذا التقييم بوضوح.

    4.  **improvementSuggestions (اقتراحات التحسين - الجزء الأهم):**
        -   هنا تظهر خبرتك. فكر كطبيب استشاري وخبير مالي. ما هي الفحوصات أو الاستشارات الإضافية التي كانت **ضرورية طبياً** لهذه الحالة ولكن تم إغفالها؟
        -   يجب أن تكون الاقتراحات منطقية ومبنية على بروتوكولات طبية (مثل ADA, WHO).
        -   لكل اقتراح، يجب أن تقدم بالتفصيل:
            -   **title:** اسم الإجراء بوضوح (مثال: "فحص الموجات فوق الصوتية للكلى والمثانة (Kidney & Bladder Ultrasound)").
            -   **description:** اشرح الأهمية الطبية بعمق. لماذا هو ضروري؟ (مثال: "ضروري لتقييم بنية الكلى، واستبعاد وجود حصوات أو مشاكل في المسالك البولية قد تكون هي السبب الحقيقي لألم الظهر وتدهور وظائف الكلى").
            -   **estimatedValue:** قدر التكلفة بالريال السعودي (مثال: "250 ريال سعودي").
            -   **whyNotRejectable:** قدم حجة قوية ومقنعة لشركة التأمين (مثال: "يعتبر هذا الفحص جزءاً لا يتجزأ من التشخيص التفريقي لأمراض الكلى وفقاً للإرشادات الطبية، ولا يمكن الاستغناء عنه لتحديد السبب الجذري للمشكلة").
        -   **أمثلة على اقتراحات ذكية يجب أن تفكر بها:** تحليل بول كامل مع نسبة الزلال إلى الكرياتينين (UACR)، فحص الكهارل (Electrolytes)، استشارة متخصص (Nephrology/Cardiology Consultation)، زيارة متابعة مجدولة.

    5.  **potentialRevenueIncrease (الزيادة المحتملة في الإيرادات):**
        -   اجمع القيم التقديرية **لجميع** اقتراحاتك وقدم المجموع النهائي كرقم واضح بالريال السعودي.
    `;

  const payload = {
    contents: [{ role: "user", parts: [{ text: jsonPrompt }] }],
    generationConfig: {
      temperature: 0.5, // زيادة طفيفة للإبداع في التحليل
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          result: { type: "STRING", description: "ملخص شامل باللغة العربية الفصحى، يشرح الحالة والأخطاء أو التقصير إن وجد، ويعطي نظرة احترافية" },
          justification: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                step: { type: "STRING", description: "اسم الإجراء الذي تم تقييمه" },
                justification: { type: "STRING", description: "هل الإجراء 'مبرر' أو 'غير مبرر'" },
                rationale: { type: "STRING", description: "شرح علمي وتأميني واضح للتقييم" },
              },
              required: ["step", "justification", "rationale"],
            },
          },
          rejectionRisk: { type: "STRING", description: "مستوى الخطورة: 'منخفض', 'متوسط', 'مرتفع'" },
          rejectionReason: { type: "STRING", description: "لماذا يمكن رفض المطالبة إن وجد سبب" },
          rejectedValue: { type: "STRING", description: "قيمة تقريبية محتملة للرفض بالريال السعودي" },
          improvementSuggestions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING", description: "اسم الإجراء المقترح (مثلاً OCT أو استشارة عيون)" },
                description: { type: "STRING", description: "لماذا هذا الإجراء مهم طبيًا وتأمينيًا" },
                estimatedValue: { type: "STRING", description: "قيمة تقديرية للإجراء بالريال السعودي" },
                whyNotRejectable: { type: "STRING", description: "مبررات قوية تمنع الرفض التأميني" },
              },
              required: ["title", "description", "estimatedValue", "whyNotRejectable"],
            },
          },
          potentialRevenueIncrease: { type: "STRING", description: "تقدير الزيادة المحتملة في الإيرادات بالريال السعودي" },
        },
        required: ["result", "justification", "rejectionRisk", "rejectionReason", "rejectedValue", "improvementSuggestions", "potentialRevenueIncrease"],
      },
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.json();
      console.error("🔥 Gemini API Error Response:", errorBody);
      throw new Error(`API request failed: ${errorBody.error?.message || response.statusText}`);
    }

    const result = await response.json();
    const rawJsonString = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJsonString) {
      throw new Error("لم يتمكن النموذج من إنشاء رد JSON.");
    }

    const parsedPayload = JSON.parse(rawJsonString);
    
    return res.status(200).json(parsedPayload);

  } catch (err) {
    console.error("🔥 Server-side Error:", err);
    return res.status(500).json({
      error: "حدث خطأ في الخادم أثناء تحليل الحالة",
      detail: err.message,
    });
  }
}
