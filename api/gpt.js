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
    smoker, // تمت إضافته للتحقق
    beforeProcedure,
    afterProcedure,
  } = req.body;

  // Validate that all required fields are present
  if (
    !diagnosis ||
    !symptoms ||
    !age ||
    !gender ||
    smoker === undefined || // تم تحديث التحقق
    !beforeProcedure ||
    !afterProcedure
  ) {
    return res.status(400).json({ error: "الرجاء ملء جميع الحقول." });
  }

  const apiKey = ""; // سيتم توفيره تلقائيًا
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  // Prompt is now focused on providing context for the JSON generation
  // التعليمات تركز الآن على توفير السياق اللازم لتوليد بيانات JSON
  const jsonPrompt = `
    أنت خبير مراجعة طبية تأمينية. بناءً على بيانات الحالة التالية، قم بإنشاء تحليل مفصل على هيئة JSON.

    **بيانات الحالة:**
    - التشخيص: ${diagnosis}
    - الأعراض: ${symptoms}
    - العمر: ${age}
    - الجنس: ${gender}
    - مدخن: ${smoker ? 'نعم' : 'لا'}
    - الإجراءات قبل التشخيص: ${beforeProcedure}
    - الإجراءات بعد التشخيص: ${afterProcedure}

    **المطلوب:**
    - تحليل الحالة وتقييم الإجراءات.
    - تحديد مخاطر الرفض التأميني.
    - اقتراح تحسينات عملية لزيادة دخل العيادة وتحسين الرعاية.
    - يجب أن تكون جميع القيم المالية بالريال السعودي.
    - قم بتعبئة جميع حقول مخطط JSON المطلوب بدقة واحترافية.
    `;

  const payload = {
    contents: [{ role: "user", parts: [{ text: jsonPrompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json", // طلب إخراج JSON
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

    // The response is already a JSON string, so we parse it before sending
    // الرد هو نص بصيغة JSON، لذا نقوم بتحليله قبل إرساله
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
