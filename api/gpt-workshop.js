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
      model: "gemini-1.5-pro-latest",
      generationConfig: {
        temperature: 0.1,
      }
    });

    const prompt = `
أنت طبيب استشاري خبير في التحليل الطبي. قم بتحليل هذه الملفات الطبية واستخرج المعلومات التالية وقدمها في تقرير طبي شامل بالعربية:

## المطلوب استخراجه:
1. **معلومات المريض**: الاسم، العمر، الجنس، تاريخ الزيارة
2. **الشكوى الرئيسية والأعراض**: الأعراض المذكورة والمشاكل الصحية
3. **التشخيص الطبي**: التشخيص الأولي والثانوي إن وجد
4. **الأدوية والعلاجات**: الأدوية المقررة والجرعات
5. **الفحوصات والنتائج**: التحاليل والأشعة والنتائج
6. **التوصيات الطبية**: تعليمات المتابعة والنصائح

## التنسيق المطلوب:
اكتب التقرير باستخدام تنسيق HTML مع العناوين المناسبة وقوائم منظمة. استخدم الألوان والتنسيق لجعل التقرير واضحاً ومهنياً.

## التحليل والتقييم:
- قدم تحليلاً شاملاً للحالة الطبية
- اربط بين الأعراض والتشخيص والعلاج
- قدم تقييماً لخطة العلاج المقترحة
- اذكر أي ملاحظات مهمة أو تحذيرات
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
    throw new Error(`خطأ في التحليل: ${error.message}`);
  }
}

async function generateEnhancedReport(analysisResult, patientInfo) {
  const systemPrompt = `
أنت طبيب استشاري خبير في كتابة التقارير الطبية. قم بتحسين وإثراء التقرير المقدم مع إضافة:

1. رأس تقرير مهني مع معلومات المريض
2. ملخص تنفيذي للحالة
3. تحليل معمق للأعراض والعلامات
4. تقييم خطة العلاج الحالية
5. توصيات إضافية للمتابعة
6. تقييم المخاطر والتنبؤات

استخدم تنسيق HTML احترافي مع ألوان وتخطيط مناسب للطباعة.
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
            content: `التحليل الأولي: ${analysisResult}\n\nمعلومات إضافية: ${JSON.stringify(patientInfo)}` 
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
    console.warn(`فشل في التحسين عبر OpenAI: ${error.message}`);
    return analysisResult; // إرجاع التحليل الأولي في حالة فشل التحسين
  }
}

export default async function handler(req, res) {
  // التحقق من طريقة الطلب
  if (req.method !== "POST") {
    return res.status(405).json({ error: "الطريقة غير مسموحة - استخدم POST فقط" });
  }

  try {
    const { files, lang = 'ar' } = req.body;

    // التحقق من وجود الملفات
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "لم يتم رفع أي ملفات أو البيانات غير صحيحة" });
    }

    // التحقق من صحة مفاتيح API
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "مفتاح Gemini API غير متوفر" });
    }

    console.log(`بدء تحليل ${files.length} ملف(ات)`);

    // تحليل المحتوى الطبي
    const analysisResult = await analyzeMedicalContent(files);

    // محاولة تحسين التقرير باستخدام OpenAI (اختياري)
    let finalReport = analysisResult;
    if (OPENAI_API_KEY) {
      try {
        finalReport = await generateEnhancedReport(analysisResult, {
          filesCount: files.length,
          language: lang
        });
      } catch (enhancementError) {
        console.warn('فشل في تحسين التقرير:', enhancementError.message);
        // الاستمرار مع التحليل الأساسي
      }
    }

    // إعداد الاستجابة النهائية
    const responseData = {
      success: true,
      html: finalReport,
      structured: {
        extractedText: `تم تحليل ${files.length} ملف(ات) بنجاح في ${new Date().toLocaleString('ar')}\n\nالملفات المحللة:\n${files.map((f, i) => `${i + 1}. ${f.name}`).join('\n')}`,
        filesAnalyzed: files.length,
        timestamp: new Date().toISOString(),
        model: "gemini-1.5-pro-latest",
        enhanced: !!OPENAI_API_KEY
      }
    };

    return res.status(200).json(responseData);

  } catch (error) {
    console.error("خطأ في الخادم:", error);
    
    // إرسال رسالة خطأ مفصلة
    return res.status(500).json({ 
      error: `خطأ في الخادم: ${error.message}`,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
}
