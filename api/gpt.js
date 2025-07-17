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
  // **MODEL UPGRADE**: Switched to gemini-1.5-pro-latest for higher quality, in-depth analysis.
  // **ترقية النموذج**: تم التغيير إلى gemini-1.5-pro-latest للحصول على تحليل أعمق وأعلى جودة.
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

  // **CRITICAL PROMPT & SCHEMA OVERHAUL**: The prompt and schema are now completely redesigned
  // to force the model to produce a detailed, critical, and structured report identical
  // to the user's desired example.
  // **إصلاح شامل للتعليمات والهيكل**: تم إعادة تصميم التعليمات وهيكل JSON بالكامل
  // لإجبار النموذج على إنتاج تقرير مفصل ونقدي ومنظم مطابق تمامًا للمثال المطلوب.
  const jsonPrompt = `
    أنت "مدقق طبي مالي خبير" ومهمتك تحليل المطالبات التأمينية لعيادة طبية. هدفك هو نقد الإجراءات الحالية، تحديد المخاطر المالية، وتقديم خطة عمل واضحة ومفصلة لزيادة الإيرادات بشكل مبرر طبيًا ومتوافق مع البروتوكولات. يجب أن يكون تحليلك عميقاً، دقيقاً، وأن تتبع هيكل الـ JSON المطلوب بحذافيره.

    **بيانات الحالة لتحليلها:**
    - التشخيص المفوتر: ${diagnosis}
    - الأعراض: ${symptoms}
    - العمر: ${age}
    - الجنس: ${gender}
    - مدخن: ${smoker ? 'نعم' : 'لا'}
    - الإجراءات المتخذة (قبل وبعد التشخيص): ${beforeProcedure}, ${afterProcedure}

    ---
    **منهجية التحليل المطلوبة (فكر بهذه الطريقة):**

    1.  **الملخص النقدي (criticalSummary):** ابدأ بنظرة نقدية. هل التشخيص المفوتر دقيق أم عام (مثل Z01.0)؟ هل الأدوية تتناسب مع التشخيص؟ هل هناك تقصير واضح؟
    2.  **تحليل الإجراءات الحالية (proceduresAnalysis):** حلل **كل** إجراء تم اتخاذه. هل هو مبرر؟ ما هي الملاحظات الهامة عليه؟
    3.  **تحليل مخاطر الرفض (insuranceRejectionAnalysis):** كن محدداً. ما هو الإجراء المعرض للرفض؟ لماذا؟ كم قيمته؟
    4.  **اقتراحات التحسين (revenueImprovementSuggestions):** هذا هو الجزء الأهم. اقترح فحوصات واستشارات إضافية **مبررة طبياً** تم إغفالها. لكل اقتراح، اشرح أهميته، قيمته، ولماذا لا يمكن للتأمين رفضه.
    5.  **التوصيات العامة (generalRecommendations):** قدم نصائح عامة لتحسين الترميز والتوثيق.

    الآن، قم بتعبئة هيكل الـ JSON التالي بهذا التحليل العميق.
    `;

  const payload = {
    contents: [{ role: "user", parts: [{ text: jsonPrompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          criticalSummary: {
            type: "STRING",
            description: "ملخص نقدي وعميق للحالة، يوضح نقاط الضعف والقوة في الإدارة الحالية للحالة.",
          },
          proceduresAnalysis: {
            type: "ARRAY",
            description: "تحليل مفصل لكل إجراء تم اتخاذه.",
            items: {
              type: "OBJECT",
              properties: {
                procedureName: { type: "STRING", description: "اسم الإجراء أو الدواء الذي تم تحليله." },
                justification: { type: "STRING", description: "هل الإجراء مبرر طبياً أم لا." },
                notes: { type: "STRING", description: "ملاحظات نقدية هامة، مثل عدم تطابق الدواء مع التشخيص العام." },
              },
              required: ["procedureName", "justification", "notes"],
            },
          },
          insuranceRejectionAnalysis: {
            type: "OBJECT",
            description: "تحليل مفصل لمخاطر الرفض من شركة التأمين.",
            properties: {
              riskLevel: { type: "STRING", description: "مستوى الخطر: 'منخفض', 'متوسط', 'مرتفع', 'عالٍ جداً'." },
              itemsAtRisk: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    itemName: { type: "STRING", description: "اسم الإجراء أو الدواء المعرض للرفض." },
                    value: { type: "STRING", description: "قيمة البند بالريال السعودي." },
                    reason: { type: "STRING", description: "السبب التفصيلي لاحتمالية الرفض." },
                  },
                  required: ["itemName", "value", "reason"],
                },
              },
              totalValueAtRisk: { type: "STRING", description: "إجمالي القيمة المالية المعرضة للرفض بالريال السعودي." },
            },
            required: ["riskLevel", "itemsAtRisk", "totalValueAtRisk"],
          },
          revenueImprovementSuggestions: {
            type: "OBJECT",
            description: "خطة عمل مفصلة لزيادة الإيرادات بشكل مبرر طبياً.",
            properties: {
              suggestions: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING", description: "اسم الإجراء أو الاستشارة المقترحة." },
                    description: { type: "STRING", description: "شرح عميق للأهمية الطبية للإجراء المقترح." },
                    estimatedValue: { type: "STRING", description: "القيمة التقديرية للإجراء بالريال السعودي." },
                    whyNotRejectable: { type: "STRING", description: "حجة قوية ومقنعة لشركة التأمين تمنع رفض الإجراء." },
                  },
                  required: ["title", "description", "estimatedValue", "whyNotRejectable"],
                },
              },
              potentialIncrease: { type: "STRING", description: "إجمالي الزيادة المحتملة في الإيرادات بالريال السعودي." },
            },
            required: ["suggestions", "potentialIncrease"],
          },
          generalRecommendations: {
            type: "STRING",
            description: "توصيات عامة وشاملة لتحسين الأداء والترميز والتوثيق في المستقبل.",
          },
        },
        required: [
          "criticalSummary",
          "proceduresAnalysis",
          "insuranceRejectionAnalysis",
          "revenueImprovementSuggestions",
          "generalRecommendations",
        ],
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
