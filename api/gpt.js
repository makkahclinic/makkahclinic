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

  // **MERGED PROMPT**: This version combines the user's preferred analytical prompt
  // with the "Clinical Pharmacist" enhancement for in-depth drug analysis.
  const htmlPrompt = `
    أنت "صيدلي إكلينيكي وخبير مراجعة طبية وتأمين، متخصص في طب العيون والأمراض الباطنية المصاحبة". مهمتك كتابة تقرير تحليلي استشاري واحد ومتكامل بصيغة HTML. يجب أن يكون تحليلك شمولياً، يربط بين التخصصات، ويدعم توصياته بمصادر طبية معروفة.

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
        <p>ابدأ بنقد التشخيص المفوتر. هل هو دقيق أم عام؟ اقترح الرمز الصحيح. ثم، حلل كل دواء وإجراء. **عند تحليل الأدوية، أنت ملزم بتحليل خصائصها الدوائية:** هل الدواء المختار هو الأفضل في فئته لهذه الحالة؟ هل يصل بتركيز كافٍ لمكان العدوى (مثلاً، هل يعبر للبول في حالة التهاب المسالك البولية)؟ انقد الاختيارات الدوائية السيئة بوضوح (مثال: "اختيار الإريثروميسين لعلاج التهاب المسالك البولية هو خطأ علاجي لأن تركيزه في البول ضعيف جداً...").</p>
    </div>

    <div class="section">
        <h4>2. احتمالية الرفض من التأمين:</h4>
        <p>حدد مستوى الخطر (منخفض/متوسط/عالٍ) باستخدام الفئة المناسبة: <span class="risk-low">منخفض</span>, <span class="risk-medium">متوسط</span>, <span class="risk-high">عالٍ</span>.</p>
        <p>اذكر بوضوح ما هي الإجراءات المعرضة للرفض، قيمتها بالريال السعودي، والسبب العلمي أو التأميني للرفض، مع التركيز على الأخطاء العلاجية.</p>
    </div>

    <div class="section">
        <h4>3. ما كان يمكن عمله لرفع الفاتورة (وفقًا للبروتوكولات الطبية):</h4>
        <p>هذا هو الجزء الأهم. كخبير استشاري، فكر في "رحلة المريض" الكاملة. اقترح خطة عمل تبدأ بالاستشارات الضرورية ثم تنتقل إلى الفحوصات المتخصصة. كن شمولياً، وإذا كانت الحالة (مثل السكري) تؤثر على أعضاء أخرى، **فأنت ملزم** باقتراح فحوصات جهازية مثل وظائف الكلى والكبد. لكل اقتراح، استخدم التنسيق التالي:</p>
        
        <div class="recommendation">
            <strong>عنوان الاقتراح: (مثال: طلب استشارة طبية للعيون)</strong>
            <ul>
                <li><strong>أهمية الإجراء:</strong> اشرح بعمق لماذا الإحالة إلى أخصائي هي الخطوة الأولى الصحيحة والمبررة طبياً.</li>
                <li><strong>القيمة التقديرية:</strong> قدر التكلفة بالريال السعودي.</li>
                <li><strong>لماذا لا يمكن رفضه:</strong> قدم حجة قوية ومقنعة لشركة التأمين، وادعمها **بشكل إلزامي** بذكر بروتوكول طبي معروف (مثال: "وفقاً لإرشادات الجمعية الأمريكية للسكري (ADA)..." أو "حسب توصيات KDIGO لأمراض الكلى...").</li>
            </ul>
        </div>
        <div class="recommendation">
            <strong>عنوان الاقتراح: (مثال: بعد الاستشارة - فحوصات العيون المتخصصة)</strong>
            <ul>
                <li><strong>أهمية الإجراء:</strong> اشرح أهمية الفحوصات التي سيجريها الأخصائي مثل OCT وقياس ضغط العين.</li>
                <li><strong>القيمة التقديرية:</strong> قدر التكلفة الإجمالية لهذه الفحوصات بالريال السعودي.</li>
                <li><strong>لماذا لا يمكن رفضه:</strong> ادعم بالحجج والبروتوكولات الطبية (مثل AAO).</li>
            </ul>
        </div>
         <div class="recommendation">
            <strong>عنوان الاقتراح: (مثال: الفحوصات الجهازية المصاحبة)</strong>
            <ul>
                <li><strong>أهمية الإجراء:</strong> اشرح أهمية فحص وظائف الكلى (Creatinine, UACR) ووظائف الكبد لمريض السكري.</li>
                <li><strong>القيمة التقديرية:</strong> قدر التكلفة الإجمالية لهذه الفحوصات بالريال السعودي.</li>
                <li><strong>لماذا لا يمكن رفضه:</strong> ادعم بالحجج والبروتوكولات الطبية (مثل ADA, KDIGO).</li>
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
        <p>قدم نصائح عامة لتحسين الترميز، التوثيق، واختيار الأدوية بناءً على فعاليتها وخصائصها الدوائية.</p>
    </div>

    **قاعدة مهمة:** لا تضع أبداً أي رموز تنسيق مثل \`\`\`html في بداية ردك. يجب أن يبدأ ردك مباشرة بوسم \`<h3>\`.
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

  } catch (err)
    {
    console.error("🔥 Server-side Error:", err);
    return res.status(500).json({
      error: "حدث خطأ في الخادم أثناء تحليل الحالة",
      detail: err.message,
    });
  }
}
