
// /api/gpt.js

/**
 * @description Serverless API endpoint to generate a detailed, formatted HTML report.
 * This version is now fully multimodal, capable of analyzing both text and image inputs.
 *
 * تم تحديث هذا الكود ليصبح متعدد الوسائط، قادراً على تحليل المدخلات النصية والصور معاً.
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
    imageData // Now receiving image data
  } = req.body;

  // Validate that either text fields or an image is provided
  if ((!diagnosis && !symptoms) && !imageData) {
    return res.status(400).json({ error: "الرجاء ملء الحقول النصية أو رفع صورة." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

  // **PROMPT ENHANCEMENT**: The prompt now instructs the model to prioritize image analysis.
  // **تحسين التعليمات**: التعليمات الآن توجه النموذج لإعطاء الأولوية لتحليل الصورة.
  const htmlPrompt = `
    أنت "صيدلي إكلينيكي وخبير مراجعة طبية وتأمين". مهمتك تحليل البيانات الطبية المقدمة (سواء كانت نصاً أو صورة وصفة طبية) وتقديم تقرير HTML مفصل.

    **البيانات لتحليلها:**
    - **الصورة المرفقة (إن وجدت):** قم بقراءة وتحليل الوصفة الطبية أو المطالبة المرفقة أولاً. استخرج منها التشخيصات، الأدوية، والجرعات.
    - **البيانات النصية (للسياق الإضافي):**
        - التشخيص المفوتر: ${diagnosis || "لم يحدد"}
        - الأعراض: ${symptoms || "لم تحدد"}
        - العمر: ${age || "لم يحدد"}
        - الجنس: ${gender || "لم يحدد"}
        - مدخن: ${smoker ? 'نعم' : 'لا'}
        - الإجراءات المتخذة: ${beforeProcedure}, ${afterProcedure}

    ---
    **هيكل التقرير المطلوب (يجب إنتاج كود HTML فقط):**

    <h3>تقرير تحليلي مُفصل</h3>
    
    <div class="section">
        <h4>1. تحليل الإجراءات ومبرراتها الطبية:</h4>
        <p>بناءً على الصورة والبيانات، ابدأ بنقد التشخيص. ثم، حلل كل دواء وإجراء. **عند تحليل الأدوية، أنت ملزم بتحليل خصائصها الدوائية:** هل الدواء المختار هو الأفضل؟ هل يصل بتركيز كافٍ لمكان العدوى؟ انقد الاختيارات الدوائية السيئة بوضوح.</p>
    </div>

    <div class="section">
        <h4>2. احتمالية الرفض من التأمين:</h4>
        <p>حدد مستوى الخطر. اذكر بوضوح ما هي الإجراءات المعرضة للرفض، قيمتها بالريال السعودي، والسبب العلمي أو التأميني للرفض.</p>
    </div>

    <div class="section">
        <h4>3. ما كان يمكن عمله لرفع الفاتورة (وفقًا للبروتوكولات الطبية):</h4>
        <p>اقترح خطة عمل كاملة تبدأ بالاستشارات الضرورية ثم الفحوصات المتخصصة. كن شمولياً واقترح فحوصات جهازية (مثل وظائف الكلى) إذا كانت الحالة تستدعي ذلك. ادعم كل اقتراح ببروتوكول طبي معروف.</p>
    </div>

    <div class="section financial-summary">
        <h4>4. المؤشر المالي:</h4>
        <table>
            <thead><tr><th>المؤشر</th><th>القيمة (ريال سعودي)</th><th>ملاحظات</th></tr></thead>
            <tbody>
                <tr><td>إجمالي الدخل الحالي (المفوتر)</td><td>[ضع القيمة هنا]</td><td>[ضع الملاحظة هنا]</td></tr>
                <tr><td>إجمالي الدخل بعد خصم الرفوض المحتملة</td><td>[ضع القيمة هنا]</td><td>[ضع الملاحظة هنا]</td></tr>
                <tr><td>إجمالي الدخل المحتمل مع التحسينات</td><td>[ضع القيمة هنا]</td><td>[ضع الملاحظة هنا]</td></tr>
            </tbody>
        </table>
    </div>

    <div class="section">
        <h4>5. توصيات عامة شاملة:</h4>
        <p>قدم نصائح عامة لتحسين الترميز والتوثيق واختيار الأدوية.</p>
    </div>

    **قاعدة مهمة:** لا تضع أبداً أي رموز تنسيق مثل \`\`\`html في بداية ردك. يجب أن يبدأ ردك مباشرة بوسم \`<h3>\`.
    `;

  // **PAYLOAD UPDATE**: Constructing a multimodal payload with text and image.
  // **تحديث الحمولة**: بناء حمولة متعددة الوسائط تحتوي على نص وصورة.
  const parts = [{ text: htmlPrompt }];
  if (imageData) {
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: imageData
      }
    });
  }

  const payload = {
    contents: [{ parts: parts }],
    generationConfig: {
      temperature: 0.5,
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
      throw new Error(errorBody.error?.message || `API request failed: ${response.statusText}`);
    }

    const result = await response.json();
    const reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reportHtml) {
      throw new Error("لم يتمكن النموذج من إنشاء التقرير.");
    }
    
    return res.status(200).json({ htmlReport: reportHtml });

  } catch (err) {
    console.error("🔥 Server-side Error:", err);
    return res.status(500).json({
      error: "حدث خطأ في الخادم أثناء تحليل الحالة",
      detail: err.message,
    });
  }
}
