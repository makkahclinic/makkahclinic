// api/gpt.js
import Tesseract from "tesseract.js";
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

  // --- نظام متقدم لمعالجة وثائق الأطباء ---
  if (requestBody.analysisType === 'doctor') {
    // نظام متكامل لتحليل الوثائق الطبية ومعالجة أخطاء OCR
    htmlPrompt = `
      أنت "النظام الطبي المتكامل" - محرك ذكاء اصطناعي يجمع خبرات:
      [استشاري باطنة، صيدلي إكلينيكي، محلل تأمين طبي، خبير معالجة وثائق طبية]

      ## التعليمات الصارمة:
      1. **معالجة أخطاء OCR المتقدمة**:
         - استخدام خوارزمية تصحيح ثلاثية المستويات:
           • التشابه الصوتي (Phonetic)
           • التشابه البصري (Visual)
           • تحليل السياق الطبي
         - قائمة تصحيح تلقائية:
           "سيمغاسنانين" → "سيمفاستاتين"
           "أوصيرازول" → "أوميبرازول"
           "ملف" → "ملغ"
           "ثلثاً" → "تلفاً"
           "بلوم تقريم" → "يلزم تقديم"

      2. **استخراج البيانات الدوائية**:
         - استخراج فقط الأدوية المذكورة صراحة
         - عدم افتراض أي أدوية غير موجودة
         - لكل دواء: التحقق من:
           • الاسم (مطابقة مع قاعدة الأدوية)
           • الجرعة (رقم + وحدة صالحة)
           • التكرار (يومياً، أسبوعياً...)

      3. **نظام التحقق الرباعي**:
         أ. المطابقة مع قاعدة الأدوية المعتمدة
         ب. التحقق من صحة الجرعة
         ج. التحقق من وحدات القياس
         د. التحقق من السياق الطبي

      4. **التقرير الإلزامي**:
         ### جدول تصحيح الأخطاء:
         | النص الأصلي     | النص المصحح     | حالة التحقق | السبب |
         |-----------------|-----------------|-------------|--------|
         [يتم تعبئة هذا الجدول تلقائياً]

         ### الأدوية المؤكدة:
         | الدواء         | الجرعة       | الحالة       |
         |----------------|--------------|--------------|
         [يتم تعبئة هذا الجدول تلقائياً]

      5. **التحليل الطبي المتكامل**:
         - لكل دواء مؤكد:
           • تقييم طبي شامل
           • تقييم صيدلاني
           • تقييم تأميني
         - تحليل الإجراءات الطبية
         - تقييم المخاطر المالية

      ## مثال تطبيقي:
      النص المدخل: "سيمغاسنانين 80 ملف يومياً"
      المعالجة:
        1. التصحيح: "سيمفاستاتين 80 ملغ يومياً"
        2. التحقق: ✅ (دواء معروف، جرعة صالحة)
        3. التحليل: 
           - ❌ جرعة عالية خطيرة
           - ⚠️ خطر تلف العضلات
           - 💰 مرفوض تأمينياً

      ## قواعد حاسمة:
      - عدم ذكر أي دواء غير موجود في الوثيقة
      - عدم الافتراض أو الاستنتاج
      - الإبلاغ عن البيانات غير الواضحة
    `;
  } 
  // --- نظام متقدم لتحليل بيانات المرضى ---
  else if (requestBody.analysisType === 'patient') {
    const { symptoms, age, gender, smoker, vitals, labs, diagnosis, currentMedications } = requestBody;
    htmlPrompt = `
      أنت "المساعد الصحي الذكي" - نظام دعم قرارات طبية متقدم للمرضى

      ## التعليمات:
      1. التحليل الشامل للأعراض
      2. تقديم توصيات مبنية على الأدلة
      3. إنشاء خطة متابعة شخصية

      ... [نظام تحليل المرضى الحالي مع تحسينات] ...
    `;
  }

  // نظام معالجة الصور المتقدم
  let extractedText = '';
if (requestBody.imageData && Array.isArray(requestBody.imageData)) {
  for (const base64Image of requestBody.imageData) {
    const buffer = Buffer.from(base64Image, "base64");
    const { data: { text } } = await Tesseract.recognize(buffer, 'ara');
    extractedText += '\n' + text;
  }
}
  console.log("📷 النص المستخرج من الصورة:\n", extractedText);
  const parts = [{ text: htmlPrompt }];
if (extractedText) {
  parts.push({ text: extractedText });
}
  const payload = {
    contents: [{ parts: parts }],
    generationConfig: {
      temperature: 0.2,  // دقة عالية
      topK: 10,
      maxOutputTokens: 5000
    },
    safetySettings: [
      { category: "HARM_CATEGORY_MEDICAL", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }
    ]
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.json();
      throw new Error(errorBody.error?.message || `فشل في الاتصال بالخادم: ${response.statusText}`);
    }

    const result = await response.json();
    let reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;

    // التحقق النهائي لمنع الهلوسة
    const extractedMeds = extractMedications(extractedText || "");
if (reportHtml.includes("سيمفاستاتين") && !extractedMeds.includes("سيمفاستاتين")) {
  return res.status(200).json({
    htmlReport: `
      <div class="error-alert">
        <h3>⚠️ تحذير: بيانات غير كافية</h3>
        <p>لم يتم العثور على دواء "سيمفاستاتين" في الوثيقة المقدمة</p>
        <ul>
          <li>السبب المحتمل: جودة صورة منخفضة أو خط غير واضح</li>
          <li>التوصية: إعادة رفع صورة أوضح</li>
          <li>الأدوية المكتشفة: ${extractedMeds.join(', ') || 'لا شيء'}</li>
        </ul>
      </div>
    `
  });
}
          <p>لم يتم العثور على دواء "سيمفاستاتين" في الوثيقة المقدمة</p>
          <ul>
            <li>السبب المحتمل: جودة صورة منخفضة أو خط غير واضح</li>
            <li>التوصية: إعادة رفع صورة أوضح</li>
            <li>الأدوية المكتشفة: ${extractedMeds.join(', ') || 'لا شيء'}</li>
          </ul>
        </div>
      `;
    }

    return res.status(200).json({ htmlReport: reportHtml });

  } catch (err) {
    console.error("🔥 خطأ في الخادم:", err);
    return res.status(500).json({
      error: "فشل في تحليل الوثيقة الطبية",
      detail: err.message,
      solution: "الرجاء التحقق من جودة الصورة وإعادة المحاولة"
    });
  }
}

// دالة مساعدة لاستخراج الأدوية
function extractMedications(text) {
  const drugPatterns = [
    /(سيمفاستاتين|أتورفاستاتين|روزوفاستاتين)/gi,
    /(أوميبرازول|لانسوبرازول|بانتوبرازول)/gi,
    /(ميتفورمين|أنسولين|غليبنكلاميد)/gi
  ];
  
  const medications = new Set();
  
  drugPatterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => medications.add(match));
    }
  });
  
  return Array.from(medications);
}
