// /api/medical-audit.js - النسخة النهائية المتكاملة

// قاعدة بيانات الأدوية الحساسة
const highRiskMedications = {
  'Diamicron MR': {
    maxFrequency: 1,
    ageAdjustment: { 
      over65: 'تخفيض الجرعة 50%',
      over75: 'تجنب أو استخدام بديل آمن'
    },
    warning: 'دواء ممتد المفعول - يؤخذ مرة واحدة يومياً فقط'
  },
  'Formet XR': {
    maxFrequency: 1,
    renalAdjustment: true,
    warning: 'يحتاج فحص وظائف الكلى قبل الصرف'
  },
  'Amlodipine': {
    maxDose: 10,
    warning: 'جرعات عالية قد تسبب تورم الأطراف'
  },
  'Duodart': {
    genderSpecific: 'ذكر',
    warning: 'مخصص للرجال فقط - ممنوع للنساء'
  }
};

const systemInstruction = `
أنت "كبير محققي التدقيق الطبي" في مؤسسة طبية مرموقة، ومهمتك هي تحليل البيانات الطبية بدقة متناهية لتجنب الأخطاء الدوائية المميتة. ستتلقى البيانات كصورة أو كنص أو كليهما.

**القواعد الإلزامية الصارمة:**
1. **الدقة العلمية المطلقة:** لا تختلق أي معلومة طبية، استند إلى الحقائق المسجلة فقط.
2. **الأولوية للأخطاء الحرجة:** ركز أولاً على أخطاء الجرعات والتفاعلات المميتة.
3. **الشفافية:** إذا كانت قراءة الصورة غير واضحة، ضع علامة (?) وأشر إلى درجة الثقة.
4. **الخصوصية:** لا تطلب أو تحتفظ بأي بيانات شخصية.

**منهجية التحليل الإلزامية (الخطوات مرتبة ترتيباً صارماً):**

**الخطوة 1: تحديد مصدر الحقيقة وكشف التناقضات**
- **إذا وُجدت صورة:** 
  • هي المصدر الأساسي للحقيقة.
  • استخرج: رقم الملف، الجنس (من الخانة ✓)، العمر، التشخيصات، الأدوية.
  • إذا وُجد نص: قارن بدقة وأبلغ عن التناقضات تحت عنوان "تناقضات حرجة".
- **بدون صورة:** النص هو المصدر الوحيد.

**الخطوة 2: التحليل الطبي المتعمق**
حلل الأدوية لاكتشاف الأخطاء:
1. **أخطاء الجرعات الخطيرة:** 
   - أدوية ممتدة المفعول (MR/XR/TR) أكثر من مرة يومياً
   - جرعات غير آمنة لكبار السن (فوق 65 سنة)
2. **التعارض المنطقي:** 
   - دواء خاص بالرجال لامرأة (مثل Duodart)
   - دواء ممنوع حسب العمر (مثل الأسبرين للأطفال)
3. **الازدواجية العلاجية:** 
   - 3+ أدوية لنفس الحالة (مثل 3 أدوية ضغط)
4. **التفاعلات الخطيرة:** 
   - (مثل Warfarin + Amiodarone) مع ذكر درجة الخطورة
5. **أخطاء السكري الخاصة:** 
   - Diamicron MR: يجب أن يكون مرة واحدة يومياً فقط
   - أدوية Sulfonylureas: جرعة مخفضة لكبار السن

**الخطوة 3: إنشاء التقرير النهائي (HTML فقط)**
1. **ملخص الحالة:** 
   - البيانات الأساسية + أي تناقضات
   - تحذيرات خاصة لكبار السن (إذا كان العمر > 65)

2. **الملاحظات الحرجة:**
   - قائمة نقطية (<ul>) بجميع الأخطاء مرتبة حسب الخطورة

3. **جدول الأدوية الشامل:**
<table border="1" style="width:100%; border-collapse:collapse;">
  <thead>
    <tr>
      <th>الدواء</th>
      <th>الجرعة</th>
      <th>الغرض الطبي</th>
      <th>الخطورة الدوائية</th>
      <th>الوضع التأميني</th>
    </tr>
  </thead>
  <tbody>
    <!-- سيتم ملؤه تلقائياً -->
  </tbody>
</table>

**تشفير الأيقونات:**
- ✅ مقبول: دواء صحيح وآمن
- ⚠️ يحتاج مراجعة: يحتاج فحوصات إضافية
- ❌ خطير: خطأ جسيم أو تفاعل مميت
- ? غير واضح: يحتاج توضيح

4. **التصحيح التلقائي المقترح:**
   - قائمة بالأخطاء والإجراءات التصحيحية الفورية

5. **فرص تحسين الرعاية:**
   - الفحوصات الناقصة
   - البدائل الآمنة

6. **المراجع العلمية:**
   - مصادر موثوقة (UpToDate, WHO, Egyptian Formulary)

**الخاتمة الإلزامية:**
"هذا التقرير ليس تشخيصاً نهائياً ويجب مراجعته من قبل طبيب متخصص"
`;

// ===== دالة مساعدة للتحقق من أخطاء الأدوية ===== //
function checkMedicationRisk(medName, dosage, age, gender) {
  const medication = medName.trim();
  const medKey = Object.keys(highRiskMedications).find(key => 
    medication.includes(key)
  );

  if (!medKey) return null;
  
  const rules = highRiskMedications[medKey];
  const warnings = [];
  
  // التحقق من الجرعات
  if (rules.maxFrequency) {
    const frequencyMatch = dosage.match(/(\d+) مرة/);
    if (frequencyMatch) {
      const frequency = parseInt(frequencyMatch[1]);
      if (frequency > rules.maxFrequency) {
        warnings.push(`جرعة زائدة: ${rules.warning}`);
      }
    }
  }
  
  // التحقق من الجنس
  if (rules.genderSpecific && gender && gender !== rules.genderSpecific) {
    warnings.push(`ممنوع للجنس ${gender}`);
  }
  
  // تعديلات كبار السن
  if (age > 65 && rules.ageAdjustment) {
    if (age > 75 && rules.ageAdjustment.over75) {
      warnings.push(`كبار السن (75+): ${rules.ageAdjustment.over75}`);
    } else if (rules.ageAdjustment.over65) {
      warnings.push(`كبار السن (65+): ${rules.ageAdjustment.over65}`);
    }
  }
  
  return warnings.length > 0 ? warnings : null;
}

// ===== دالة معالجة البيانات ===== //
function buildUserPrompt(caseData) {
  // تطبيق إجراءات الخصوصية الصارمة
  const sanitizedData = {
    gender: caseData.gender || '',
    age: caseData.age ? parseInt(caseData.age) : 0,
    fileNumber: caseData.fileNumber ? '#' + caseData.fileNumber.slice(-4) : '',
    diagnosis: caseData.diagnosis || '',
    medications: caseData.medications || '',
    imageData: caseData.imageData || []
  };

  let textDataPrompt = "**البيانات النصية المدخلة:**\n";
  let hasTextData = false;

  if (sanitizedData.fileNumber) {
    textDataPrompt += `- رقم الملف: ${sanitizedData.fileNumber}\n`;
    hasTextData = true;
  }
  if (sanitizedData.gender) {
    textDataPrompt += `- الجنس: ${sanitizedData.gender}\n`;
    hasTextData = true;
  }
  if (sanitizedData.age) {
    textDataPrompt += `- العمر: ${sanitizedData.age}\n`;
    hasTextData = true;
  }
  if (sanitizedData.diagnosis) {
    textDataPrompt += `- التشخيصات: ${sanitizedData.diagnosis}\n`;
    hasTextData = true;
  }
  if (sanitizedData.medications) {
    textDataPrompt += `- الأدوية: ${sanitizedData.medications}\n`;
    hasTextData = true;
  }

  // معالجة بيانات الصورة
  const imageDataPrompt = `
**الملفات المرفوعة:**
- ${sanitizedData.imageData.length > 0 
    ? `تم تحميل ${sanitizedData.imageData.length} صورة(صور) للتحليل. **هذه هي المصدر الأساسي للحقيقة.**` 
    : "لا يوجد صور مرفقة. **اعتمد على البيانات النصية أعلاه.**"}
  `;

  // تحذيرات خاصة لكبار السن
  const ageWarning = sanitizedData.age > 65 
    ? `\n\n**تحذير خاص:** المريض كبير السن (${sanitizedData.age} سنة) - يتطلب تعديل جرعات أدوية السكري والضغط`
    : '';

  return `
${hasTextData ? textDataPrompt : "**لا توجد بيانات نصية**"}
${imageDataPrompt}
${ageWarning}
  `;
}

// ===== دالة الخادم الرئيسية ===== //
export default async function handler(req, res) {
  // ضوابط الأمان والصلاحيات
  res.setHeader("Access-Control-Allow-Origin", "https://your-medical-domain.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Strict-Transport-Security", "max-age=31536000");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // التحقق من المفتاح السري
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY غير مضبوط في البيئة");

    // التحقق من حجم البيانات
    if (JSON.stringify(req.body).length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: "حجم البيانات يتجاوز الحد المسموح (5MB)" });
    }

    // التحقق من عدد الصور
    if (req.body.imageData && req.body.imageData.length > 3) {
      return res.status(400).json({ error: "الحد الأقصى 3 صور لكل طلب" });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

    // إنشاء المحتوى متعدد الوسائط
    const parts = [
      { text: systemInstruction },
      { text: buildUserPrompt(req.body) }
    ];

    // إضافة الصور إذا وُجدت
    if (req.body.imageData && Array.isArray(req.body.imageData)) {
      req.body.imageData.forEach(imgData => {
        if (imgData.mimeType && imgData.data) {
          parts.push({
            inline_data: {
              mimeType: imgData.mimeType,
              data: imgData.data
            }
          });
        }
      });
    }

    // هيكل الطلب
    const payload = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.95,
        topK: 32,
        maxOutputTokens: 4096
      },
      safetySettings: [
        { 
          category: "HARM_CATEGORY_MEDICAL", 
          threshold: "BLOCK_MEDIUM_AND_ABOVE" 
        },
        { 
          category: "HARM_CATEGORY_DANGEROUS", 
          threshold: "BLOCK_MEDIUM_AND_ABOVE" 
        }
      ]
    };

    // إرسال الطلب لـ Gemini API
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeout: 60000 // 60 ثانية
    });

    // معالجة الاستجابة
    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Gemini API Error:", response.status, errorBody);
      throw new Error(`فشل في الخدمة: ${response.statusText}`);
    }

    const result = await response.json();

    // التحقق من هيكل الاستجابة
    const candidate = result.candidates?.[0];
    if (!candidate?.content?.parts?.[0]?.text) {
      const finishReason = candidate?.finishReason || "UNKNOWN";
      console.error("استجابة غير صالحة من Gemini:", JSON.stringify(result, null, 2));
      throw new Error(`فشل النموذج في إنشاء التقرير. السبب: ${finishReason}`);
    }

    let reportHtml = candidate.content.parts[0].text;

    // تحسين التقرير تلقائياً لكبار السن
    if (req.body.age && parseInt(req.body.age) > 65) {
      reportHtml = reportHtml.replace(
        /(Diamicron MR.*?)(مرتين|ثلاث|2|3)(.*?يومياً)/gi, 
        '$1مرة$3'
      );
    }

    // تسجيل التدقيق (بدون بيانات حساسة)
    console.log(`تم إنشاء تقرير طبي لملف: ${req.body.fileNumber?.slice(-4) || 'N/A'}`);

    return res.status(200).json({ htmlReport: reportHtml });

  } catch (err) {
    // تسجيل الأخطاء التفصيلي
    console.error("🔥 خطأ في معالجة الطلب:", {
      error: err.message,
      endpoint: "/api/medical-audit",
      timestamp: new Date().toISOString()
    });

    return res.status(500).json({
      error: "فشل في التحليل الطبي",
      detail: err.message,
      solution: "الرجاء التحقق من البيانات وإعادة المحاولة"
    });
  }
}
