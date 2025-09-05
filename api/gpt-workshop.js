import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";

export const config = {
  api: {
    bodyParser: { sizeLimit: "50mb" },
    responseLimit: false,
  },
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);

function ok(res, data) {
  return res.status(200).json(data);
}

function bad(res, status, message) {
  return res.status(status).json({ error: message });
}

// إصلاح استخراج البيانات من Base64
function extractBase64Data(dataUrl) {
  if (!dataUrl || !dataUrl.includes(',')) {
    throw new Error('صيغة البيانات غير صحيحة');
  }
  return dataUrl.split(',')[1];
}

async function uploadToGemini(name, mimeType, dataUrl) {
  try {
    const base64Data = extractBase64Data(dataUrl);
    const buffer = Buffer.from(base64Data, 'base64');
    
    // إنشاء ملف مؤقت
    const tempFile = {
      inlineData: {
        data: base64Data,
        mimeType: mimeType
      }
    };
    
    return tempFile;
  } catch (error) {
    console.error("خطأ في معالجة الملف:", error);
    throw new Error(`فشل في معالجة الملف: ${error.message}`);
  }
}

async function comprehensiveMedicalExtraction(file) {
  try {
    console.log(`بدء استخراج البيانات من: ${file.name}`);
    
    const fileData = await uploadToGemini(file.name, file.mimeType, file.data);

    const model = genAI.getGenerativeModel({ 
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      }
    });

    const prompt = `
أنت طبيب خبير في استخراج البيانات الطبية. استخرج جميع المعلومات من هذا المستند:

{
  "patientInfo": {
    "name": "اسم المريض",
    "age": "العمر", 
    "gender": "الجنس",
    "visitDate": "تاريخ الزيارة",
    "sourceFile": "${file.name}"
  },
  "chiefComplaint": "الشكوى الرئيسية",
  "diagnoses": ["التشخيصات"],
  "medications": ["الأدوية"],
  "vitalSigns": {
    "bloodPressure": "ضغط الدم",
    "heartRate": "النبض",
    "temperature": "الحرارة"
  },
  "investigations": ["الفحوصات والنتائج"],
  "treatmentPlan": ["خطة العلاج"]
}
`;

    const result = await model.generateContent([fileData, { text: prompt }]);
    const response = await result.response;
    const text = response.text();
    
    try {
      return JSON.parse(text);
    } catch (parseError) {
      return {
        error: "فشل في تحليل البيانات",
        rawText: text,
        fileName: file.name
      };
    }

  } catch (error) {
    console.error(`خطأ في معالجة ${file.name}:`, error);
    return {
      error: `خطأ: ${error.message}`,
      fileName: file.name
    };
  }
}

async function generateMedicalReport(extractedData) {
  try {
    const systemPrompt = `
أنت طبيب استشاري خبير. اكتب تقريراً طبياً شاملاً بالعربية يتضمن:

1. ملخص الحالة
2. التشخيص والتقييم
3. خطة العلاج
4. التوصيات والمتابعة
5. تقييم المخاطر

استخدم HTML للتنسيق مع العناوين والقوائم المناسبة.
`;

    const response = await fetch(OPENAI_API_URL, {
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
            content: `البيانات الطبية:\n${JSON.stringify(extractedData, null, 2)}` 
          },
        ],
        max_tokens: 4000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`خطأ في API: ${response.status}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || "فشل في إنتاج التقرير";

  } catch (error) {
    return `خطأ في إنتاج التقرير: ${error.message}`;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return bad(res, 405, "Method not allowed");
  }

  try {
    const { files } = req.body;

    if (!files || files.length === 0) {
      return bad(res, 400, "لم يتم رفع أي ملفات");
    }

    console.log(`بدء معالجة ${files.length} ملف(ات)`);

    // استخراج البيانات من جميع الملفات
    const extractionResults = [];
    for (const file of files) {
      const result = await comprehensiveMedicalExtraction(file);
      extractionResults.push(result);
    }

    // دمج البيانات المستخرجة
    const combinedData = {
      files: extractionResults,
      summary: {
        totalFiles: files.length,
        successfulExtractions: extractionResults.filter(r => !r.error).length,
        errors: extractionResults.filter(r => r.error).length
      }
    };

    // إنتاج التقرير الطبي
    const medicalReport = await generateMedicalReport(combinedData);

    return ok(res, {
      success: true,
      html: medicalReport,
      structured: {
        extractedText: JSON.stringify(combinedData, null, 2)
      }
    });

  } catch (error) {
    console.error("خطأ عام:", error);
    return bad(res, 500, `خطأ في الخادم: ${error.message}`);
  }
}
