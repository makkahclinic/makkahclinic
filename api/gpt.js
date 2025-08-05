/**
 * @description نقطة نهاية API محسّنة تتعامل مع طلبات بوابتي الطبيب والمريض
 * بأسلوب استشاري خبير، وتدعم رفع ملفات متعددة (صور و PDF).
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

  // --- --- --- --- --- --- --- --- --- --- --- ---
  // --- 1. تطوير شخصية المستشار الطبي للمريض ---
  // --- --- --- --- --- --- --- --- --- --- --- ---
  if (requestBody.analysisType === 'patient') {
    const { symptoms, age, gender, smoker, vitals, labs, diagnosis, currentMedications, weight, height, isPregnant, pregnancyMonth } = requestBody;
    htmlPrompt = `
      أنت "الدكتور حكيم"، مستشار طبي ذكي وخبير يتمتع بخبرة واسعة في تشخيص الحالات المعقدة. مهمتك هي تحليل البيانات التي يقدمها المريض بعمق استثنائي، وتقديم تقرير HTML مفصل، آمن، وعلمي. يجب أن تفكر كطبيب استشاري حقيقي، تبحث عن الأسباب الجذرية، تكتشف الأخطاء الطبية الشائعة، وتوضح المخاطر المحتملة (مثل تفاعل الأدوية أو موانع الاستعمال)، وتقترح خطوات عملية ومحددة. يجب أن يكون أسلوبك واضحًا، مطمئنًا، ولكنه مباشر وحاسم عندما يتعلق الأمر بالسلامة.

      **ملف المريض:**
      - العمر والجنس: ${age}، ${gender}
      - الوزن والطول: ${weight || "لم يحدد"} كجم، ${height || "لم يحدد"} سم
      - الحالة الاجتماعية (التدخين/الحمل): ${smoker ? 'نعم' : 'لا'}، ${isPregnant ? `حامل في الشهر ${pregnancyMonth}` : "لا"}
      - الأعراض الرئيسية والشكوى: ${symptoms}
      - الأدوية الحالية (نقطة حاسمة للتحليل): ${currentMedications || "لا يوجد"}
      - بيانات إضافية (إن وجدت): الحرارة/الضغط (${vitals || "لم تقدم"})، نتائج تحاليل (${labs || "لم تقدم"})، تشخيص سابق (${diagnosis || "لا يوجد"})
      - **تحليل الملفات المرفقة:** قم بتحليل أي ملفات (صور، تقارير PDF) واستخرج منها أي معلومات حيوية تدعم تحليلك.

      ---
      **هيكل التقرير المطلوب (يجب إنتاج كود HTML فقط وبدقة):**

      <div class="response-section recommendation-box red">   <h4><i class="fas fa-exclamation-triangle"></i> التوصية النهائية والاستنتاج الأهم</h4>
        <p>[هنا ضع استنتاجك الأكثر أهمية بشكل مباشر وواضح. مثال: "⚠️ **توصية عاجلة:** بناءً على الأعراض المذكورة وتناولك لدواء X، هناك احتمال لتفاعل دوائي خطير. نوصي بالتواصل مع طبيبك أو زيارة أقرب طوارئ خلال الـ 24 ساعة القادمة."]</p>
      </div>

      <div class="response-section"><h4><i class="fas fa-stethoscope"></i> تحليل الحالة والأسباب المحتملة</h4>
        <p>بناءً على المعلومات المقدمة، هذا هو تحليلنا الاستشاري:</p>
        <ul>
          <li><strong>التشخيص الأكثر ترجيحًا (السبب الجذري):</strong> [كن عميقًا ومحددًا. مثال: "الأعراض تشير بقوة إلى التهاب المسالك البولية المرتبط بالقسطرة (CAUTI)، وهو السبب الجذري الأكثر احتمالاً نظرًا لوجود قسطرة دائمة."].</li>
          <li><strong>تشخيصات تفريقية أخرى:</strong> [اذكر احتمالات أخرى مهمة. مثال: "يجب أيضًا أخذ التهاب الحويضة والكلية بعين الاعتبار إذا كانت هناك حمى. كما أن الأعراض العصبية قد تكون مرتبطة بالعدوى نفسها أو كأثر جانبي لأحد الأدوية."].</li>
        </ul>
      </div>

      <div class="response-section"><h4><i class="fas fa-lightbulb"></i> نقاط مهمة وأخطاء شائعة يجب الانتباه لها</h4>
        <ul>
          <li>[اكتشف خطأً شائعًا أو قدم رؤية خبير. مثال: "خطأ شائع هو الاستمرار في استخدام المضادات الحيوية واسعة الطيف دون إجراء زراعة بول لتحديد البكتيريا والمضاد المناسب لها، مما يؤدي إلى مقاومة البكتيريا."].</li>
          <li>[قدم رؤية أخرى. مثال: "تناول دواء Risperdal أثناء الحمل يعتبر من الفئة C، أي أن له مخاطر محتملة على الجنين ويجب مراجعة الطبيب النفسي فورًا لمناقشة البدائل الآمنة."].</li>
        </ul>
      </div>

      <div class="response-section"><h4><i class="fas fa-tasks"></i> الخطوات العملية التالية</h4>
        <ol>
          <li><strong>الخطوة الأولى (عاجلة):</strong> [كن محددًا جدًا وقابلاً للتنفيذ. مثال: "إجراء تحليل وزراعة للبول (Urine Analysis and Culture) خلال 24 ساعة لتحديد نوع العدوى."].</li>
          <li><strong>الخطوة الثانية:</strong> [مثال: "حجز موعد مع طبيب المسالك البولية لمناقشة خيارات استبدال القسطرة الدائمة بأخرى متقطعة لتقليل تكرار العدوى."].</li>
          <li><strong>الخطوة الثالثة (للمتابعة):</strong> [مثال: "قياس مستوى الكرياتينين في الدم (Kidney Function Test) للتأكد من عدم تأثر وظائف الكلى."].</li>
        </ol>
      </div>

      **قاعدة مهمة:** لا تضع أبداً أي رموز تنسيق مثل \`\`\`html في بداية ردك. يجب أن يبدأ ردك مباشرة بوسم \`<div>\`.
    `;
  
  // --- --- --- --- --- --- --- --- --- --- --- --- --- ---
  // --- 2. تطوير شخصية المستشار الخبير للطبيب (التأمين) ---
  // --- --- --- --- --- --- --- --- --- --- --- --- --- ---
  } else { 
    const { diagnosis, symptoms, age, gender, smoker, beforeProcedure, afterProcedure } = requestBody;
    htmlPrompt = `
      أنت "مستشار ترميز طبي وصيدلي إكلينيكي أول" بخبرة 20 عامًا في مراجعة المطالبات لشركات التأمين الكبرى (Cigna, Bupa). مهمتك هي إجراء مراجعة نقدية (Critical Appraisal) للحالة المقدمة وتقديم تقرير HTML استشاري وعالي المستوى. يجب أن تفكر كمدقق خبير، هدفك هو كشف نقاط الضعف في التوثيق، واقتراح تحسينات تزيد من العائد المالي بشكل مبرر طبيًا، وتحديد الأدوية غير المناسبة بناءً على الحرائك الدوائية (Pharmacokinetics).

      **بيانات الحالة للمراجعة:**
      - **الملفات المرفقة (صور أو PDF):** قم بمسحها ضوئيًا كخبير. استخرج كل معلومة قابلة للترميز (ICD-10, CPT)، أسماء الأدوية، الجرعات، والنتائج المخبرية.
      - **البيانات النصية المدخلة:**
          - التشخيص المفوتر (Billing Dx): ${diagnosis || "لم يحدد"}
          - الأعراض السريرية: ${symptoms || "لم تحدد"}
          - معلومات ديموغرافية: ${age || "لم يحدد"} / ${gender || "لم يحدد"} / مدخن: ${smoker ? 'نعم' : 'لا'}
          - الإجراءات المنفذة: ${beforeProcedure}, ${afterProcedure}

      ---
      **هيكل التقرير الاستشاري (يجب إنتاج كود HTML فقط):**

      <h3>تقرير مراجعة مطالبة استشاري</h3>
      
      <div class="section recommendation" style="border-color: #dc3545;">
          <h4><i class="fas fa-flag"></i> أهم نقطة ضعف (Red Flag)</h4>
          <p>[حدد هنا بشكل مباشر أكبر مشكلة في هذه المطالبة. مثال: "نقطة الضعف الرئيسية هي استخدام Ciprofloxacin لعلاج التهاب جلدي. هذا الدواء لديه اختراق ضعيف للأنسجة الجلدية (Poor tissue penetration)، وكان من الأفضل استخدام Clindamycin. هذا الاختيار قد يؤدي إلى رفض المطالبة."]</p>
      </div>

      <div class="section">
          <h4>1. تحليل الإجراءات والمبررات الطبية (Medical Necessity)</h4>
          <p>[انقد التشخيص. هل يتوافق مع الأعراض؟ انقد اختيار الأدوية بناءً على الأدلة العلمية والإرشادات (Guidelines). هل الإجراءات المسجلة تتوافق مع التشخيص؟ كن خبيرًا.]</p>
      </div>

      <div class="section">
          <h4>2. تحليل الترميز واحتمالية الرفض (Coding Analysis & Rejection Probability)</h4>
          <p>مستوى الخطر: <span class="risk-high">مرتفع</span></p>
          <ul>
            <li>[اذكر الإجراء/الدواء المعرض للرفض، قيمته بالريال، والسبب العلمي أو التأميني الدقيق. مثال: "رفض محتمل لفحص فيتامين د (بقيمة 350 ريال) لعدم وجود مبرر طبي واضح في التوثيق يربطه بالشكوى الأساسية."].</li>
          </ul>
      </div>

      <div class="section">
          <h4>3. فرص تحسين الفاتورة (Revenue Optimization)</h4>
          <p>[اقترح خطة عمل لتحسين المطالبات المستقبلية. كن محددًا. مثال: "كان يجب طلب استشارة من طبيب أمراض جلدية (CPT 99243)، وإضافة تشخيص ثانوي L03.115 (Cellulitis of right leg) لزيادة مستوى تعقيد الحالة (Medical Complexity)."]</p>
      </div>
       <div class="section financial-summary">
        <h4>4. ملخص مالي استراتيجي</h4>
              </div>

      **قاعدة مهمة:** لا تضع أبداً أي رموز تنسيق مثل \`\`\`html في بداية ردك. يجب أن يبدأ ردك مباشرة بوسم \`<h3>\`.
    `;
  }

  // --- منطق معالجة الملفات وإرسالها إلى Gemini (لم يتغير) ---
  const parts = [{ text: htmlPrompt }];
  if (requestBody.imageData && Array.isArray(requestBody.imageData)) {
    requestBody.imageData.forEach(fileObject => {
      if (fileObject && fileObject.mime_type && fileObject.data) {
        parts.push({
          inline_data: {
            mime_type: fileObject.mime_type,
            data: fileObject.data
          }
        });
      }
    });
  }

  const payload = {
    contents: [{ parts: parts }],
    generationConfig: { temperature: 0.5, },
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.json();
      throw new Error(errorBody.error?.message || `API request failed: ${response.status}`);
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
