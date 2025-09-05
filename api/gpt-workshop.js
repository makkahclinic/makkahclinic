export const config = {
  api: {
    bodyParser: { sizeLimit: "50mb" },
    responseLimit: false,
  },
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

function extractBase64Data(dataUrl) {
  if (!dataUrl || !dataUrl.includes(',')) {
    throw new Error('صيغة البيانات غير صحيحة');
  }
  return dataUrl.split(',')[1];
}

async function analyzeMedicalContent(files) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-pro",
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 8192,
      }
    });

    const prompt = `
أنت خبير طبي متخصص في مراجعة الممارسات الطبية والكشف عن سوء الاستخدام. قم بتحليل هذه الوثائق الطبية بعناية فائقة واستخرج:

## 📋 المعلومات الأساسية:
1. **بيانات المريض**: الاسم، العمر، رقم الملف، رقم الهوية
2. **معلومات الطبيب**: اسم الطبيب، التخصص، رقم الترخيص إن وجد

## 🗓️ تحليل الزيارات والتواريخ (مهم جداً):
قم بتحليل كل زيارة على حدة واستخرج:
- **تاريخ كل زيارة بالتفصيل** (اليوم، الشهر، السنة، الوقت إن وجد)
- **الفترة الزمنية بين الزيارات** (احسب الأيام والأسابيع)
- **سبب كل زيارة** (زيارة جديدة، متابعة، طوارئ)
- **مدة الزيارة** إن كانت مذكورة

## 🔬 تحليل الفحوصات والإجراءات:
لكل زيارة، استخرج:
- **جميع الفحوصات المطلوبة** مع التاريخ الدقيق
- **نوع كل فحص** (تحاليل دم، أشعة، مناظير، إلخ)
- **النتائج** إن كانت متوفرة
- **التكلفة** إن كانت مذكورة

## ⚠️ تحليل التكرارات والمخالفات:
ابحث عن وحلل:
1. **الفحوصات المتكررة**:
   - فحوصات تم إعادتها في نفس اليوم
   - فحوصات تم إعادتها خلال أسبوع بدون مبرر واضح
   - فحوصات تم إعادتها خلال شهر بدون تغير في الحالة

2. **الإفراط في الفحوصات**:
   - طلب فحوصات غير ضرورية للحالة
   - طلب فحوصات مكلفة بدون مبرر قوي
   - طلب فحوصات متعددة للمشكلة نفسها

3. **أنماط مشبوهة**:
   - زيارات متكررة بدون تحسن واضح
   - تغيير التشخيص بشكل مفاجئ
   - عدم اتباع البروتوكولات الطبية المعيارية

## 💊 تحليل الأدوية:
- **الأدوية المقررة** في كل زيارة
- **الجرعات والمدة**
- **التفاعلات الدوائية المحتملة**
- **الأدوية المتكررة أو غير الضرورية**

## 📊 التقييم الطبي المهني:
قيّم:
1. **مدى ملاءمة الإجراءات** للأعراض المذكورة
2. **منطقية التسلسل الزمني** للعلاج
3. **فعالية الخطة العلاجية**
4. **الالتزام بالمعايير الطبية**

## 🚨 تقرير المخالفات:
إذا وجدت أي مخالفات، اذكر:
- **نوع المخالفة** بالتفصيل
- **التاريخ المحدد** للمخالفة
- **الضرر المحتمل** على المريض
- **التكلفة غير المبررة**
- **درجة خطورة المخالفة** (منخفضة/متوسطة/عالية)

## 📋 التنسيق المطلوب:
استخدم HTML مع:
- جداول مفصلة للزيارات والتواريخ
- ألوان تحذيرية للمخالفات (أحمر للخطر، برتقالي للتحذير)
- رموز للتصنيف (✅ طبيعي، ⚠️ مشبوه، ❌ مخالفة)
- خط زمني واضح للأحداث

## تعليمات مهمة:
- اقرأ التواريخ بعناية فائقة (انتبه للتنسيقات المختلفة)
- قارن بين تواريخ الزيارات والفحوصات
- ابحث عن التناقضات في التشخيص
- لا تتجاهل أي تفصيل صغير
- كن دقيقاً في حساب الفترات الزمنية
- اربط بين الأعراض والفحوصات المطلوبة
`;

    const imageParts = files.map(file => ({
      inlineData: {
        data: extractBase64Data(file.data),
        mimeType: file.mimeType
      }
    }));

    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    
    return response.text();

  } catch (error) {
    console.error('خطأ في التحليل:', error);
    throw new Error(`فشل في التحليل: ${error.message}`);
  }
}

async function generateAdvancedAnalysis(analysisResult, files) {
  if (!OPENAI_API_KEY) {
    return analysisResult;
  }

  const systemPrompt = `
أنت خبير في مراجعة الممارسات الطبية والكشف عن الاحتيال الطبي. مهمتك تحليل التقرير المقدم وإضافة:

1. **تحليل إحصائي متقدم**:
   - معدل الزيارات شهرياً
   - معدل الفحوصات لكل زيارة
   - التكلفة الإجمالية والمتوسطة
   - مقارنة مع المعدلات الطبيعية

2. **خوارزمية كشف الأنماط المشبوهة**:
   - تحديد الأنماط غير الطبيعية
   - حساب مؤشر الخطر (Risk Score)
   - تصنيف درجة الاشتباه

3. **تقرير مفصل عن المخالفات**:
   - قائمة مرقمة بالمخالفات
   - الأدلة لكل مخالفة
   - التأثير المالي والصحي

4. **توصيات إجرائية**:
   - خطوات التحقق المطلوبة
   - الجهات المختصة للإبلاغ
   - الإجراءات الوقائية

استخدم تنسيق HTML احترافي مع رسوم بيانية نصية وألوان تحذيرية.
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: `التحليل الأولي: ${analysisResult}\n\nعدد الملفات: ${files.length}\nالوقت: ${new Date().toISOString()}` 
          },
        ],
        max_tokens: 4000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`خطأ في OpenAI API: ${response.status}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || analysisResult;

  } catch (error) {
    console.warn(`فشل في التحليل المتقدم: ${error.message}`);
    return analysisResult;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ 
      error: "الطريقة غير مسموحة - استخدم POST فقط"
    });
  }

  try {
    const { files, analysisType = 'comprehensive' } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ 
        error: "لم يتم رفع أي ملفات أو البيانات غير صحيحة"
      });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: "مفتاح Gemini API غير متوفر"
      });
    }

    console.log(`بدء التحليل المتقدم لـ ${files.length} ملف(ات)`);

    // التحليل الأساسي المفصل
    const analysisResult = await analyzeMedicalContent(files);

    // التحليل المتقدم إذا كان OpenAI متاحاً
    let finalReport = analysisResult;
    if (OPENAI_API_KEY && analysisType === 'comprehensive') {
      try {
        finalReport = await generateAdvancedAnalysis(analysisResult, files);
      } catch (enhancementError) {
        console.warn('فشل في التحليل المتقدم:', enhancementError.message);
      }
    }

    const responseData = {
      success: true,
      html: finalReport,
      structured: {
        analysisType: 'medical-practice-audit',
        filesAnalyzed: files.length,
        timestamp: new Date().toISOString(),
        model: "gemini-1.5-pro",
        enhanced: !!OPENAI_API_KEY,
        features: [
          'تحليل التواريخ والزيارات',
          'كشف الفحوصات المتكررة', 
          'تحليل الأنماط المشبوهة',
          'تقييم الممارسات الطبية',
          'حساب التكاليف غير المبررة'
        ]
      }
    };

    return res.status(200).json(responseData);

  } catch (error) {
    console.error("خطأ في الخادم:", error);
    
    return res.status(500).json({ 
      error: `خطأ في الخادم: ${error.message}`,
      type: error.constructor.name,
      timestamp: new Date().toISOString()
    });
  }
}
