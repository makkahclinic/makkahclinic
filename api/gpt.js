// /api/gpt.js

/**
 * @description A multi-purpose serverless API endpoint. It now intelligently handles
 * requests from both the Doctor's Portal and the new Patient's Portal, providing
 * tailored, expert-level responses for each.
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
  
  let htmlPrompt;
  const requestBody = req.body;

  // --- Logic to select the correct prompt based on the request source ---
  if (requestBody.analysisType === 'patient') {
    // --- NEW, EXPERT-LEVEL PATIENT PORTAL PROMPT ---
    const { symptoms, age, gender, smoker, vitals, labs, diagnosis, currentMedications, weight, height, isPregnant, pregnancyMonth } = requestBody;
    htmlPrompt = `
      أنت "مستشار طبي ذكي وخبير". مهمتك هي تحليل البيانات التي يقدمها المريض بعمق شديد، وتقديم تقرير HTML مفصل، آمن، وعلمي. يجب أن تفكر كطبيب استشاري حقيقي، تبحث عن الأسباب الجذرية، تكتشف الأخطاء الطبية الشائعة، وتقترح خطوات عملية ومحددة.

      **بيانات المريض:**
      - العمر: ${age}
      - الجنس: ${gender}
      - الوزن: ${weight || "لم يحدد"} كجم
      - الطول: ${height || "لم يحدد"} سم
      - مدخن: ${smoker ? 'نعم' : 'لا'}
      - هل هي حامل: ${isPregnant ? `نعم، في الشهر ${pregnancyMonth}` : "لا"}
      - الأعراض الرئيسية: ${symptoms}
      - الأدوية الحالية: ${currentMedications || "لا يوجد"}
      - الحرارة والضغط (إن وجدت): ${vitals || "لم يتم تقديمها"}
      - نتائج تحاليل (إن وجدت): ${labs || "لم يتم تقديمها"}
      - تشخيص سابق (إن وجد): ${diagnosis || "لا يوجد"}

      ---
      **هيكل التقرير المطلوب (يجب إنتاج كود HTML فقط وبدقة):**

      <div class="response-section recommendation-box green"> <!-- استخدم red للحالات الطارئة، yellow للحالات الهامة، و green للحالات غير المقلقة -->
        <!-- بناءً على تحليل عميق لخطورة الأعراض، ضع هنا توصيتك النهائية والواضحة. مثال: "⚠️ توصية هامة: بناءً على وجود قسطرة بولية دائمة وأعراض التهاب، نوصي بشدة بحجز موعد مع طبيب مسالك بولية خلال 24-48 ساعة." -->
      </div>

      <div class="response-section">
          <h4>
            <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" viewBox="0 0 24 24" fill="currentColor"><path d="M11.25 4.533A9.707 9.707 0 0 0 6 3a9.735 9.735 0 0 0-3.25.555.75.75 0 0 0-.5.707v14.25a.75.75 0 0 0 1 .707A9.716 9.716 0 0 0 6 18a9.716 9.716 0 0 0 2.25-.333.75.75 0 0 0 .5-.707V8.25a.75.75 0 0 0-.5-.707A9.735 9.735 0 0 0 6 7.5a8.25 8.25 0 0 1 5.25-2.967ZM12.75 4.533A9.707 9.707 0 0 1 18 3a9.735 9.735 0 0 1 3.25.555.75.75 0 0 1 .5.707v14.25a.75.75 0 0 1-1 .707A9.716 9.716 0 0 1 18 18a9.716 9.716 0 0 1-2.25-.333.75.75 0 0 1-.5-.707V8.25a.75.75 0 0 1 .5-.707A9.735 9.735 0 0 1 18 7.5a8.25 8.25 0 0 0-5.25-2.967Z" /></svg>
            تحليل الحالة والأسباب المحتملة
          </h4>
          <p>بناءً على المعلومات المقدمة، هذا هو تحليلنا الأولي:</p>
          <ul>
            <li><strong>السبب الجذري المحتمل:</strong> [هنا يجب أن تكون عميقاً. مثال: "وجود قسطرة بولية دائمة يعتبر السبب الرئيسي والأكثر ترجيحاً لحدوث التهابات مسالك بولية متكررة (CAUTI)."].</li>
            <li><strong>التشخيصات التفريقية:</strong> [اذكر احتمالات أخرى. مثال: "يجب أيضاً النظر في احتمالية أن تكون الأعراض العصبية (النسيان) ناتجة عن تأثير الالتهاب على الحالة العامة للمريضة، أو كأثر جانبي لأحد الأدوية الحالية."].</li>
          </ul>
      </div>
      
      <div class="response-section">
          <h4>
            <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12.97 3.97a.75.75 0 0 1 1.06 0l7.5 7.5a.75.75 0 0 1 0 1.06l-7.5 7.5a.75.75 0 1 1-1.06-1.06l6.22-6.22H3a.75.75 0 0 1 0-1.5h16.19l-6.22-6.22a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" /></svg>
            أخطاء طبية محتملة يجب الانتباه لها
          </h4>
          <p>بناءً على خبرتنا، هذه بعض الأخطاء الشائعة التي قد تحدث في مثل هذه الحالات ويجب مناقشتها مع الفريق الطبي:</p>
          <ul>
            <li>[اذكر خطأً شائعاً ومحدداً. مثال: "إهمال استخدام القسطرة المتقطعة كبديل للدائمة، وهو ما توصي به الإرشادات الطبية لتقليل العدوى."].</li>
            <li>[اذكر خطأً آخر. مثال: "تناول دواء مثل ريسبيردال أثناء الحمل يعتبر خطراً كبيراً على الجنين ويجب إيقافه فوراً تحت إشراف طبي."].</li>
          </ul>
      </div>

      <div class="response-section">
          <h4>
            <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5h-3.75V6Z" clip-rule="evenodd" /></svg>
            الخطوات التالية المقترحة
          </h4>
          <p>بناءً على التحليل، هذه هي الخطوات العملية التي نوصي بها:</p>
          <ul>
            <li><strong>الخطوة الأولى (عاجلة):</strong> [كن محدداً جداً. مثال: "إجراء تحليل وزراعة للبول (Urine Analysis and Culture) لتحديد نوع البكتيريا واختيار المضاد الحيوي المناسب."].</li>
            <li><strong>الخطوة الثانية:</strong> [مثال: "مناقشة الطبيب حول خيار استبدال القسطرة الدائمة بالقسطرة المتقطعة لتقليل خطر العدوى بشكل كبير."].</li>
            <li><strong>الخطوة الثالثة (للتأكد):</strong> [مثال: "إجراء فحص وظائف الكلى (Creatinine) للتأكد من أن العدوى لم تؤثر على الكلى."].</li>
          </ul>
      </div>
      
      <div class="response-section">
          <h4>
            <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm11.378-3.917c-.882 0-1.473.823-1.473 1.838 0 .931.515 1.744 1.455 1.838A.5.5 0 0 1 13.5 12.5v1.217a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1.217c0-.784-.57-1.624-1.455-1.838C8.623 10.423 8 9.603 8 8.672c0-1.017.612-1.838 1.473-1.838.84 0 1.473.823 1.473 1.838a.5.5 0 0 1-1 0c0-.594-.343-1.088-.873-1.088-.328 0-.5.276-.5.658 0 .343.248.658.5.658a.5.5 0 0 1 .5.5v.007a.5.5 0 0 1-.5.5h-.007a.5.5 0 0 1-.5-.5v-.007Z" clip-rule="evenodd" /></svg>
            أسئلة لمناقشتها مع طبيبك
          </h4>
          <p>عند زيارة الطبيب، هذه بعض الأسئلة الهامة التي يمكنك طرحها:</p>
          <ul>
            <li>هل يمكن أن تكون القسطرة هي السبب الرئيسي للمشكلة؟ وما هي البدائل المتاحة؟</li>
            <li>بناءً على نتيجة زراعة البول، ما هو المضاد الحيوي الأنسب لحالتي؟</li>
            <li>هل نحتاج للقلق بشأن تأثير هذه الالتهابات على وظائف الكلى؟</li>
          </ul>
      </div>

      **قاعدة مهمة:** لا تضع أبداً أي رموز تنسيق مثل \`\`\`html في بداية ردك. يجب أن يبدأ ردك مباشرة بوسم \`<div>\`.
    `;
  } else {
    // --- DOCTOR PORTAL PROMPT (RESTORED TO FULL DETAIL) ---
    const { diagnosis, symptoms, age, gender, smoker, beforeProcedure, afterProcedure } = requestBody;
    htmlPrompt = `
      أنت "صيدلي إكلينيكي وخبير مراجعة طبية وتأمين". مهمتك تحليل البيانات الطبية المقدمة (سواء كانت نصاً أو صوراً) وتقديم تقرير HTML مفصل.

      **البيانات لتحليلها:**
      - **الصور المرفقة (إن وجدت):** قم بقراءة وتحليل كل صورة مرفقة. استخرج منها التشخيصات، الأدوية، والجرعات.
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
          <p>بناءً على الصور والبيانات، ابدأ بنقد التشخيص. ثم، حلل كل دواء وإجراء. **عند تحليل الأدوية، أنت ملزم بتحليل خصائصها الدوائية:** هل الدواء المختار هو الأفضل؟ هل يصل بتركيز كافٍ لمكان العدوى؟ انقد الاختيارات الدوائية السيئة بوضوح.</p>
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
  }

  const parts = [{ text: htmlPrompt }];
  if (requestBody.imageData && Array.isArray(requestBody.imageData)) {
    requestBody.imageData.forEach(imgData => {
      parts.push({
        inline_data: {
          mime_type: "image/jpeg",
          data: imgData
        }
      });
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
