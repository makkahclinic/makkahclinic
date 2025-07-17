// main/api/gpt.js

/**
 * @description Serverless API endpoint to generate a detailed medical insurance review report.
 * This version is upgraded to use Google's Gemini API and features a highly-detailed,
 * structured prompt to ensure the output matches a professional report format.
 *
 * تم تطوير هذا الكود لاستخدام Gemini API من Google مع تعليمات مفصلة لضمان جودة التقرير.
 */
export default async function handler(req, res) {
  // Set CORS headers to allow requests from any origin
  // إعدادات CORS للسماح بالطلبات من أي مصدر
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle preflight OPTIONS request
  // معالجة طلب OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Ensure the request method is POST
  // التأكد من أن الطلب من نوع POST
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
  // التحقق من وجود جميع الحقول المطلوبة في الطلب
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

  // The Gemini API key should be left as an empty string.
  // The Canvas environment will automatically provide the key.
  // يجب ترك مفتاح Gemini API فارغًا، حيث سيتم توفيره تلقائيًا في بيئة العمل
  const apiKey = "";
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  // This is the core of the improvement. The prompt is meticulously structured
  // to force the AI to generate a report with the exact sections and details
  // from the user's desired sample report.
  //
  // هذا هو جوهر التحسين. تم تصميم التعليمات (Prompt) بدقة فائقة لإجبار النموذج
  // على إنشاء تقرير بنفس الأقسام والتفاصيل الموجودة في العينة المطلوبة.
  const detailedPrompt = `
    **مهمتك:** أنت خبير استشاري في المراجعة الطبية لشركات التأمين. عليك إنشاء تقرير طبي تأميني مفصل، احترافي، وموضوعي باللغة العربية الفصحى. يجب أن يكون التقرير شاملاً ويتبع الهيكل المحدد أدناه بدقة متناهية.

    **بيانات الحالة:**
    - **التشخيص:** ${diagnosis}
    - **الأعراض الرئيسية:** ${symptoms}
    - **العمر:** ${age}
    - **الجنس:** ${gender}
    - **مدخن:** ${smoker ? "نعم" : "لا"}
    - **الإجراءات المُتخذة قبل التشخيص:** ${beforeProcedure}
    - **الإجراءات المُتخذة بعد التشخيص:** ${afterProcedure}

    ---

    **هيكل التقرير الإلزامي (يجب اتباعه حرفيًا):**

    # تقرير مراجعة طبية تفصيلي لحالة ${diagnosis}

    ## 1. ملخص الحالة السريرية:
    - ابدأ بذكر عمر المريض، جنسه، وتشخيصه.
    - لخّص الأعراض الرئيسية وأهميتها السريرية، مع التركيز على أي علامات خطورة (أعلام حمراء).
    - اذكر العوامل المؤثرة مثل التدخين أو غياب تاريخ طبي سابق.

    ## 2. مراجعة وتقييم الإجراءات الطبية المتخذة:
    - لكل إجراء تم اتخاذه (قبل وبعد التشخيص)، قم بتحليله كنقطة منفصلة.
    - **التقييم المهني:** قيّم الإجراء بوضوح. هل هو مبرر طبيًا ومتوافق مع المعايير العالمية (مثل ADA, AAO, WHO)؟
    - **تحليل التأمين:** اشرح بالتفصيل لماذا قد ترفض شركة التأمين تغطية تكلفة الإجراء إذا كان غير مبرر. ركز على مفاهيم "غياب الضرورة الطبية" و"عدم اتباع البروتوكولات المعتمدة".

    ## 3. الخطة العلاجية المثلى (ما كان يجب فعله):
    - هذا هو القسم الأهم. يجب أن يكون مفصلاً وعمليًا.
    - اقترح خطة رعاية شاملة وبديلة لما تم. لكل اقتراح، يجب أن توضح:
      - **الإجراء المقترح:** صف الإجراء بوضوح (مثال: تصوير مقطعي للشبكية OCT، فحص HbA1c، تخطيط قلب ECG).
      - **الضرورة الطبية:** اشرح لماذا هذا الإجراء حيوي لهذه الحالة تحديدًا وماذا يكشف.
      - **القيمة التقديرية:** حدد تكلفة تقديرية **بالريال السعودي (SAR)**.
      - **مبررات عدم الرفض التأميني:** اشرح بقوة لماذا هذا الإجراء ضروري طبيًا ولا يمكن لشركة التأمين رفضه.
      - **المرجعية العلمية:** استشهد ببروتوكولات طبية معروفة (ADA, AHA/ACC, EASD) لدعم توصيتك.
    - **يجب أن تشمل اقتراحاتك:**
      - فحوصات تشخيصية متقدمة ومحددة.
      - إحالات إلى تخصصات دقيقة (طبيب عيون، أخصائي غدد صماء).
      - خطة علاج دوائي (مثل Metformin كخط أول).
      - تعديلات على نمط الحياة وتثقيف صحي.

    ## 4. التأثير الإيجابي على العيادة والتأمين:
    - وضح كيف أن اتباع الخطة المثلى المقترحة يعود بالنفع على العيادة.
    - ركز على زيادة الموافقات التأمينية، تحسين سمعة العيادة، نمو الإيرادات بشكل مشروع، وتقليل المخاطر القانونية.

    ## 5. الخلاصة:
    - لخص النتائج الرئيسية للتقرير.
    - أكّد مجددًا على الفرق الجوهري بين النهج المتبع والنهج الموصى به وتأثير ذلك على صحة المريض.

    **شروط صارمة:**
    - **اللغة:** عربية فصحى فقط.
    - **الأسلوب:** رسمي، سردي، تفصيلي، وموضوعي.
    - **الطول:** يجب ألا يقل التقرير عن 800 كلمة لضمان تغطية جميع الجوانب بعمق.
    - **التنسيق:** استخدم Markdown للعناوين والنقاط لسهولة القراءة.
    `;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: detailedPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      topP: 1.0,
      topK: 32,
      maxOutputTokens: 4096, // زيادة عدد التوكنز للسماح بتقارير طويلة
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Handle non-successful responses from the API
      // معالجة الأخطاء في حال عدم نجاح الطلب
      const errorBody = await response.json();
      console.error("🔥 Gemini API Error Response:", errorBody);
      throw new Error(
        `API request failed with status ${response.status}: ${
          errorBody.error?.message || "Unknown error"
        }`
      );
    }

    const result = await response.json();

    // Extract the generated text from the Gemini response
    // استخلاص النص المولد من استجابة Gemini
    const generatedText =
      result.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!generatedText) {
        return res.status(500).json({ error: "لم يتمكن النموذج من إنشاء رد. قد تكون هناك مشكلة في المحتوى المدخل." });
    }

    // Send the successful response back to the client
    // إرسال الرد الناجح للعميل
    return res.status(200).json({ result: generatedText });

  } catch (err) {
    console.error("🔥 Server-side Error:", err);
    return res.status(500).json({
      error: "حدث خطأ في الخادم أثناء إنشاء التقرير",
      detail: err.message,
    });
  }
}
