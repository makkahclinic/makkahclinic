import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";

// إعداد الـ API
export const config = {
  api: {
    bodyParser: { sizeLimit: "50mb" },
    responseLimit: false,
  },
};

// المتغيرات والثوابت
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";

// إعداد Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);

// دوال المساعدة
function ok(res, data) {
  return res.status(200).json(data);
}

function bad(res, status, message) {
  return res.status(status).json({ error: message });
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return { error: "خطأ في تحليل الاستجابة" };
  }
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30000) // 30 ثانية timeout
      });
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // تأخير متزايد
    }
  }
}

// رفع الملف إلى Gemini
async function uploadToGemini(name, mimeType, base64Data) {
  try {
    // تحويل base64 إلى buffer
    const buffer = Buffer.from(base64Data, 'base64');
    
    // إنشاء ملف مؤقت
    const tempFile = {
      name: name,
      mimeType: mimeType,
      data: buffer
    };
    
    // رفع الملف
    const uploadResponse = await fileManager.uploadFile(tempFile, {
      mimeType: mimeType,
      displayName: name,
    });
    
    return {
      uri: uploadResponse.file.uri,
      mimeType: uploadResponse.file.mimeType
    };
  } catch (error) {
    console.error("خطأ في رفع الملف:", error);
    throw new Error(`فشل في رفع الملف: ${error.message}`);
  }
}

// مرحلة 1: استخراج شامل للبيانات الطبية
async function comprehensiveMedicalExtraction(file) {
  try {
    if (!file?.data) {
      return {
        error: `خطأ في معالجة ${file?.name || "ملف غير مسمى"}: لا توجد بيانات.`,
        fileName: file?.name
      };
    }

    console.log(`بدء استخراج البيانات من: ${file.name}`);
    
    // رفع الملف إلى Gemini
    const { uri, mimeType } = await uploadToGemini(
      file.name,
      file.mimeType,
      file.data
    );

    const model = genAI.getGenerativeModel({ 
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      }
    });

    const prompt = `
أنت طبيب خبير في استخراج البيانات الطبية. استخرج جميع المعلومات الطبية من هذا المستند وأرجعها بصيغة JSON:

{
  "patientInfo": {
    "name": "اسم المريض الكامل",
    "age": "العمر",
    "gender": "الجنس",
    "visitDate": "تاريخ الزيارة",
    "medicalRecordNumber": "رقم الملف الطبي",
    "sourceFile": "${file.name}"
  },
  "chiefComplaint": "الشكوى الرئيسية",
  "presentIllness": "تاريخ المرض الحالي",
  "pastMedicalHistory": ["التاريخ المرضي السابق"],
  "familyHistory": "التاريخ العائلي",
  "medications": ["الأدوية الحالية"],
  "allergies": ["الحساسيات"],
  "vitalSigns": {
    "bloodPressure": "ضغط الدم",
    "heartRate": "معدل النبض",
    "temperature": "درجة الحرارة",
    "respiratoryRate": "معدل التنفس",
    "oxygenSaturation": "تشبع الأكسجين",
    "weight": "الوزن",
    "height": "الطول",
    "bmi": "مؤشر كتلة الجسم"
  },
  "physicalExam": "نتائج الفحص الجسدي",
  "diagnoses": [
    {
      "diagnosis": "التشخيص",
      "icdCode": "كود ICD",
      "severity": "شدة الحالة",
      "type": "نوع التشخيص (أساسي/ثانوي)"
    }
  ],
  "investigations": [
    {
      "test": "اسم الفحص",
      "result": "النتيجة",
      "normalRange": "المدى الطبيعي",
      "date": "تاريخ الفحص"
    }
  ],
  "treatmentPlan": ["خطة العلاج"],
  "procedures": ["الإجراءات الطبية"],
  "followUp": "تعليمات المتابعة",
  "additionalNotes": "ملاحظات إضافية",
  "riskFactors": ["عوامل الخطر"],
  "socialHistory": "التاريخ الاجتماعي"
}

استخرج كل المعلومات المتاحة في المستند. إذا لم تكن معلومة متاحة، اتركها فارغة أو null.
`;

    const result = await model.generateContent([
      {
        fileData: {
          mimeType: mimeType,
          fileUri: uri
        }
      },
      { text: prompt }
    ]);

    const response = await result.response;
    const text = response.text();
    
    try {
      const parsedData = JSON.parse(text);
      console.log(`تم استخراج البيانات بنجاح من: ${file.name}`);
      return parsedData;
    } catch (parseError) {
      console.error("خطأ في تحليل JSON:", parseError);
      return {
        error: "فشل في تحليل البيانات المستخرجة",
        rawText: text,
        fileName: file.name
      };
    }

  } catch (error) {
    console.error(`خطأ في استخراج البيانات من ${file.name}:`, error);
    return {
      error: `خطأ في معالجة الملف: ${error.message}`,
      fileName: file.name
    };
  }
}

// مرحلة 2: التحليل السريري المتعمق
async function deepClinicalAnalysis(medicalData) {
  try {
    console.log("بدء التحليل السريري المتعمق...");
    
    const systemPrompt = `
أنت طبيب استشاري خبير مع خبرة 20 سنة. قم بتحليل الحالة الطبية التالية بشكل متعمق ومنهجي:

## المطلوب في التحليل:

### 1. التقييم السريري الشامل
- تقييم حالة المريض العامة
- تحليل الأعراض والعلامات
- العلاقة بين الأعراض المختلفة

### 2. التشخيص التفاضلي
- قائمة بالتشخيصات المحتملة
- ترتيب التشخيصات حسب الاحتمالية
- الأسباب المرجحة والمستبعدة

### 3. تحليل المخاطر
- المضاعفات المحتملة
- عوامل الخطر الموجودة
- التدخل الطبي العاجل إذا لزم

### 4. تقييم خطة العلاج
- مناسبة العلاج الحالي
- البدائل العلاجية
- التعديلات المقترحة

### 5. التوصيات
- الفحوصات الإضافية المطلوبة
- المتابعة المطلوبة
- التحويلات التخصصية

### 6. الإنذار والتوقعات
- توقعات سير المرض
- فرص الشفاء
- العوامل المؤثرة على النتائج

يجب أن يكون التحليل مدعوماً بالأدلة الطبية والمراجع العلمية الحديثة.
`;

    const response = await fetchWithRetry(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: `البيانات الطبية للتحليل:\n\n${JSON.stringify(medicalData, null, 2)}` 
          },
        ],
        max_tokens: 8000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorData = await parseJsonSafe(response);
      throw new Error(`خطأ في API OpenAI: ${JSON.stringify(errorData)}`);
    }

    const data = await parseJsonSafe(response);
    console.log("تم إكمال التحليل السريري بنجاح");
    return data?.choices?.[0]?.message?.content || "لم يتم إنتاج التحليل السريري.";

  } catch (error) {
    console.error("خطأ في التحليل السريري:", error);
    return `خطأ في التحليل السريري: ${error.message}`;
  }
}

// مرحلة 3: التحليل التخصصي
async function specialtyAnalysis(medicalData, clinicalAnalysis) {
  try {
    console.log("بدء التحليل التخصصي...");
    
    // تحديد التخصص المناسب
    const diagnoses = medicalData.diagnoses || [];
    let specialty = "طب عام";
    let specialtyKeywords = [];
    
    for (const diag of diagnoses) {
      const diagnosis = diag.diagnosis?.toLowerCase() || "";
      
      if (diagnosis.includes("heart") || diagnosis.includes("cardiac") || diagnosis.includes("قلب")) {
        specialty = "أمراض القلب والأوعية الدموية";
        specialtyKeywords.push("قلبية وعائية");
      } else if (diagnosis.includes("diabetes") || diagnosis.includes("سكري") || diagnosis.includes("غدد")) {
        specialty = "الغدد الصماء والسكري";
        specialtyKeywords.push("غدد صماء");
      } else if (diagnosis.includes("respiratory") || diagnosis.includes("lung") || diagnosis.includes("رئة") || diagnosis.includes("صدر")) {
        specialty = "أمراض الصدر والرئتين";
        specialtyKeywords.push("تنفسية");
      } else if (diagnosis.includes("kidney") || diagnosis.includes("كلى") || diagnosis.includes("بول")) {
        specialty = "أمراض الكلى والمسالك البولية";
        specialtyKeywords.push("كلوية");
      } else if (diagnosis.includes("neuro") || diagnosis.includes("عصب") || diagnosis.includes("دماغ")) {
        specialty = "الأمراض العصبية";
        specialtyKeywords.push("عصبية");
      }
    }

    const systemPrompt = `
أنت استشاري متخصص في ${specialty} مع خبرة 25 سنة في هذا المجال. قم بتحليل هذه الحالة من منظور تخصصك المتقدم:

## التحليل التخصصي المطلوب:

### 1. التقييم التخصصي المتقدم
- تحليل الحالة من منظور ${specialty}
- العلامات والأعراض النوعية للتخصص
- التقييم الوظيفي للأجهزة المتخصصة

### 2. البروتوكولات العلاجية المتقدمة
- أحدث البروتوكولات في ${specialty}
- العلاجات المتطورة والحديثة
- التدخلات التخصصية المطلوبة

### 3. الفحوصات التخصصية
- الفحوصات المتقدمة المطلوبة
- التصوير التخصصي
- الفحوصات الوظيفية النوعية

### 4. إدارة المضاعفات
- المضاعفات الخاصة بالتخصص
- الوقاية من المضاعفات
- الإدارة المبكرة للمضاعفات

### 5. العلاج المتقدم والتدخلات
- خيارات العلاج المتقدمة
- التدخلات الجراحية إذا لزم الأمر
- العلاجات التجريبية والحديثة

### 6. المتابعة التخصصية
- جدول المتابعة التخصصية
- المؤشرات المطلوب مراقبتها
- متى يجب التحويل لتخصصات فرعية

### 7. التعاون مع التخصصات الأخرى
- التخصصات المطلوب التنسيق معها
- التوقيت المناسب للتحويل
- الرعاية متعددة التخصصات

استخدم أحدث الإرشادات الطبية والبروتوكولات المعتمدة دولياً في ${specialty}.
`;

    const response = await fetchWithRetry(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: `البيانات الطبية:\n${JSON.stringify(medicalData, null, 2)}\n\nالتحليل السريري الأولي:\n${clinicalAnalysis}` 
          },
        ],
        max_tokens: 6000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorData = await parseJsonSafe(response);
      throw new Error(`خطأ في API OpenAI: ${JSON.stringify(errorData)}`);
    }

    const data = await parseJsonSafe(response);
    console.log(`تم إكمال التحليل التخصصي في ${specialty}`);
    
    return {
      specialty,
      keywords: specialtyKeywords,
      analysis: data?.choices?.[0]?.message?.content || "لم يتم إنتاج التحليل التخصصي."
    };

  } catch (error) {
    console.error("خطأ في التحليل التخصصي:", error);
    return {
      specialty: "طب عام",
      keywords: [],
      analysis: `خطأ في التحليل التخصصي: ${error.message}`
    };
  }
}

// مرحلة 4: التقرير النهائي الشامل
async function generateComprehensiveReport(medicalData, clinicalAnalysis, specialtyResult) {
  try {
    console.log("بدء إنتاج التقرير النهائي الشامل...");
    
    const systemPrompt = `
أنت رئيس الأطباء (Chief Medical Officer) في مستشفى متقدم. اكتب تقريراً طبياً شاملاً ومهنياً باللغة العربية يتضمن:

## هيكل التقرير الطبي الشامل:

### 1. ملخص الحالة التنفيذي
- معلومات المريض الأساسية
- الشكوى الرئيسية
- التشخيص الأساسي
- الحالة العامة للمريض

### 2. البيانات الطبية الأساسية
- التاريخ المرضي الحالي والسابق
- التاريخ العائلي والاجتماعي
- الأدوية والحساسيات
- العلامات الحيوية

### 3. التقييم السريري المفصل
- نتائج الفحص الجسدي
- تحليل الأعراض والعلامات
- تفسير نتائج الفحوصات والتحاليل
