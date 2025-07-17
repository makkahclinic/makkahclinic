// /api/gpt.js

/**
 * @description Serverless API endpoint to generate a detailed, formatted HTML report.
 * This version uses the powerful gemini-1.5-pro model and instructs it to return a single,
 * comprehensive HTML string, which can be rendered directly by the frontend.
 *
 * تم تحديث هذا الكود ليستخدم نموذج gemini-1.5-pro القوي ويطلب منه إنشاء تقرير
 * بصيغة HTML، مما يسهل على الواجهة الأمامية عرضه مباشرة بشكل منسق.
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
    smoker === undefined
  ) {
    return res.status(400).json({ error: "الرجاء ملء جميع الحقول." });
  }

  // Use the Gemini API key from Vercel's environment variables.
  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

  // **FINAL PROMPT REVISION**: This prompt now asks for a single, detailed,
  // well-structured HTML report, exactly like the user's desired output format.
  const htmlPrompt = `
    أنت "مدقق طبي مالي خبير" ومهمتك كتابة تقرير تحليلي واحد ومتكامل بصيغة HTML. يجب أن يكون التقرير عميقاً، واضحاً، ومفيداً للطبيب. استخدم وسوم HTML والتنسيقات المحددة لإنشاء تقرير احترافي. لا تخرج عن هذا النسق أبداً.

    **بيانات الحالة لتحليلها:**
    - التشخيص المفوتر: ${diagnosis}
    - الأعراض: ${symptoms}
    - العمر: ${age}
    - الجنس: ${gender}
    - مدخن: ${smoker ? 'نعم' : 'لا'}
    - الإجراءات المتخذة: ${beforeProcedure}, ${afterProcedure}

    ---
    **هيكل التقرير المطلوب (يجب إنتاج كود HTML فقط):**

    <h3>تقرير تحليلي مُفصل</h3>
    
    <div class="section">
        <h4>1. تحليل الإجراءات ومبرراتها الطبية:</h4>
        <p>ابدأ بنقد التشخيص المفوتر. هل هو دقيق أم عام (مثل Z01.0)؟ اقترح الرمز الصحيح. حلل كل إجراء ودوّن ملاحظات هامة حوله. هل هو مبرر؟ هل يتناسب مع التشخيص؟</p>
    </div>

    <div class="section">
        <h4>2. احتمالية الرفض من التأمين:</h4>
        <p>حدد مستوى الخطر (منخفض/متوسط/عالٍ) باستخدام الفئة المناسبة: <span class="risk-low">منخفض</span>, <span class="risk-medium">متوسط</span>, <span class="risk-high">عالٍ</span>.</p>
        <p>اذكر بوضوح ما هي الإجراءات المعرضة للرفض، قيمتها بالريال السعودي، والسبب العلمي أو التأميني للرفض.</p>
    </div>

    <div class="section">
        <h4>3. ما كان يمكن عمله لرفع الفاتورة (وفقًا للبروتوكولات الطبية):</h4>
        <p>هذا هو الجزء الأهم. اقترح قائمة مفصلة من الفحوصات والاستشارات الإضافية التي تم إغفالها. لكل اقتراح، استخدم التنسيق التالي داخل وسم <div> مع فئة "recommendation":</p>
        <!-- مثال على التنسيق المطلوب لكل اقتراح -->
        <div class="recommendation">
            <strong>عنوان الاقتراح:</strong>
            <ul>
                <li><strong>أهمية الإجراء:</strong> اشرح بعمق لماذا هو ضروري طبياً.</li>
                <li><strong>القيمة التقديرية:</strong> قدر التكلفة بالريال السعودي.</li>
                <li><strong>لماذا لا يمكن رفضه:</strong> قدم حجة قوية ومقنعة لشركة التأمين.</li>
            </ul>
        </div>
    </div>

    <div class="section financial-summary">
        <h4>4. المؤشر المالي:</h4>
        <table>
            <thead>
                <tr>
                    <th>المؤشر</th>
                    <th>القيمة (ريال سعودي)</th>
                    <th>ملاحظات</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>إجمالي الدخل الحالي (المفوتر)</td>
                    <td>[ضع القيمة هنا]</td>
                    <td>[ضع الملاحظة هنا]</td>
                </tr>
                <tr>
                    <td>إجمالي الدخل بعد خصم الرفوض المحتملة</td>
                    <td>[ضع القيمة هنا]</td>
                    <td>[ضع الملاحظة هنا]</td>
                </tr>
                <tr>
                    <td>إجمالي الدخل المحتمل مع التحسينات</td>
                    <td>[ضع القيمة هنا]</td>
                    <td>[ضع الملاحظة هنا]</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="section">
        <h4>5. توصيات عامة شاملة:</h4>
        <p>قدم نصائح عامة لتحسين الترميز، التوثيق، ومواءمة العلاج مع التشخيص في المستقبل.</p>
    </div>

    اكتب التقرير الآن باللغة العربية الفصحى، وبشكل مفصل وواضح.
    `;

  const payload = {
    contents: [{ role: "user", parts: [{ text: htmlPrompt }] }],
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
    
    // Send the HTML report back to the frontend.
    return res.status(200).json({ htmlReport: reportHtml });

  } catch (err) {
    console.error("🔥 Server-side Error:", err);
    return res.status(500).json({
      error: "حدث خطأ في الخادم أثناء تحليل الحالة",
      detail: err.message,
    });
  }
}
