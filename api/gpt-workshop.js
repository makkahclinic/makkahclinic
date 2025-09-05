// نظام التحليل الطبي المتعمق المحسّن
export const config = {
  api: {
    bodyParser: { sizeLimit: "50mb" },
  },
};

// إعداد المفاتيح والثوابت
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";

// مرحلة 1: استخراج شامل للبيانات الطبية
async function comprehensiveMedicalExtraction(file) {
  if (!file?.data) return `خطأ في معالجة ${file?.name || "ملف غير مسمى"}: لا توجد بيانات.`;

  const { uri, mime: finalMime } = await geminiUploadBase64({
    name: file.name,
    mimeType: file.mimeType,
    base64: file.data,
  });

  const systemPrompt = `
أنت طبيب خبير في استخراج البيانات الطبية. استخرج جميع المعلومات الطبية التالية من المستند:

1. المعلومات الأساسية للمريض (الاسم، العمر، الجنس، تاريخ الزيارة)
2. الشكوى الرئيسية والأعراض الحالية
3. التاريخ المرضي السابق والعائلي
4. الأدوية الحالية والحساسيات
5. الفحص الجسدي والعلامات الحيوية
6. التشخيصات والأكواد الطبية
7. الفحوصات المطلوبة والنتائج
8. خطة العلاج والمتابعة
9. أي ملاحظات إضافية أو مضاعفات

أرجع JSON مفصل يحتوي على كل هذه المعلومات.
`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ 
      role: "user", 
      parts: [{ file_data: { file_uri: uri, mime_type: finalMime } }] 
    }],
    generation_config: {
      response_mime_type: "application/json",
      response_schema: {
        type: "object",
        properties: {
          patientInfo: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "string" },
              gender: { type: "string" },
              visitDate: { type: "string" },
              sourceFile: { type: "string" }
            }
          },
          chiefComplaint: { type: "string" },
          presentIllness: { type: "string" },
          pastMedicalHistory: { type: "array", items: { type: "string" } },
          familyHistory: { type: "string" },
          medications: { type: "array", items: { type: "string" } },
          allergies: { type: "array", items: { type: "string" } },
          vitalSigns: {
            type: "object",
            properties: {
              bloodPressure: { type: "string" },
              heartRate: { type: "string" },
              temperature: { type: "string" },
              respiratoryRate: { type: "string" },
              oxygenSaturation: { type: "string" }
            }
          },
          physicalExam: { type: "string" },
          diagnoses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                diagnosis: { type: "string" },
                icdCode: { type: "string" },
                severity: { type: "string" }
              }
            }
          },
          investigations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                test: { type: "string" },
                result: { type: "string" },
                normalRange: { type: "string" }
              }
            }
          },
          treatmentPlan: { type: "array", items: { type: "string" } },
          followUp: { type: "string" },
          additionalNotes: { type: "string" }
        }
      }
    }
  };

  const response = await fetchWithRetry(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`خطأ في استخراج بيانات Gemini: ${JSON.stringify(data)}`);

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n");
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return "فشل في تحليل البيانات المستخرجة";
  }

  return parsed;
}

// مرحلة 2: التحليل السريري المتعمق
async function deepClinicalAnalysis(medicalData) {
  const systemPrompt = `
أنت طبيب استشاري خبير. قم بتحليل الحالة الطبية التالية بشكل متعمق:

1. تقييم شامل للحالة السريرية
2. التشخيص التفاضلي المحتمل
3. تحليل المخاطر والمضاعفات
4. تقييم خطة العلاج الحالية
5. التوصيات للتحسين
6. المتابعة المطلوبة
7. التعليم الطبي للمريض

يجب أن يكون التحليل مدعوماً بالأدلة الطبية والمراجع العلمية.
أضف المراجع الطبية المناسبة بعد كل توصية.
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
        { role: "user", content: `البيانات الطبية للتحليل:\n\n${JSON.stringify(medicalData, null, 2)}` },
      ],
      max_tokens: 6000, // زيادة الحد الأقصى للرموز
      temperature: 0.1, // تقليل العشوائية للحصول على تحليل أكثر دقة
    }),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`خطأ في التحليل السريري: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "لم يتم إنتاج التحليل السريري.";
}

// مرحلة 3: التحليل التخصصي حسب التخصص
async function specialtyAnalysis(medicalData, clinicalAnalysis) {
  // تحديد التخصص المناسب بناءً على التشخيصات
  const diagnoses = medicalData.diagnoses || [];
  let specialty = "طب عام";
  
  // منطق تحديد التخصص
  for (const diag of diagnoses) {
    const diagnosis = diag.diagnosis?.toLowerCase() || "";
    if (diagnosis.includes("heart") || diagnosis.includes("cardiac")) {
      specialty = "أمراض القلب";
    } else if (diagnosis.includes("diabetes") || diagnosis.includes("سكري")) {
      specialty = "الغدد الصماء";
    } else if (diagnosis.includes("respiratory") || diagnosis.includes("lung")) {
      specialty = "أمراض الصدر";
    }
    // يمكن إضافة المزيد من التخصصات
  }

  const systemPrompt = `
أنت استشاري متخصص في ${specialty}. قم بتحليل هذه الحالة من منظور تخصصك:

1. التقييم التخصصي للحالة
2. البروتوكولات العلاجية المتقدمة
3. الفحوصات التخصصية المطلوبة
4. خيارات العلاج المتقدمة
5. التوصيات للوقاية من المضاعفات
6. متى يجب التحويل لتخصصات أخرى

استخدم أحدث الإرشادات الطبية والبروتوكولات المعتمدة.
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
      max_tokens: 4000,
      temperature: 0.1,
    }),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`خطأ في التحليل التخصصي: ${JSON.stringify(data)}`);
  return {
    specialty,
    analysis: data?.choices?.[0]?.message?.content || "لم يتم إنتاج التحليل التخصصي."
  };
}

// مرحلة 4: التقرير النهائي الشامل
async function generateComprehensiveReport(medicalData, clinicalAnalysis, specialtyResult) {
  const systemPrompt = `
أنت رئيس الأطباء (CMO). اكتب تقريراً طبياً شاملاً ومهنياً باللغة العربية يتضمن:

## هيكل التقرير المطلوب:

### 1. ملخص الحالة التنفيذي
- معلومات المريض الأساسية
- الشكوى الرئيسية
- التشخيص الأساسي

### 2. التقييم السريري المفصل
- تحليل الأعراض والعلامات
- نتائج الفحص الجسدي
- تفسير نتائج الفحوصات

### 3. التشخيص التفاضلي
- التشخيصات المحتملة
- الأسباب المرجحة والمستبعدة
- التبرير العلمي

### 4. خطة العلاج الشاملة
- العلاج الفوري
- العلاج طويل المدى
- التعديلات المطلوبة على نمط الحياة

### 5. التوصيات التخصصية
- التوصيات حسب التخصص
- الفحوصات الإضافية المطلوبة
- متابعة التخصصات الأخرى

### 6. المتابعة والمراقبة
- جدول المتابعة المقترح
- المؤشرات المطلوب مراقبتها
- علامات الإنذار المبكر

### 7. التثقيف الصحي للمريض
- نصائح للمريض
- التعليمات الواجب اتباعها
- متى يجب طلب المساعدة الطبية

يجب دعم كل توصية بالمراجع الطبية المناسبة.
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
          content: `
البيانات الطبية الأساسية:
${JSON.stringify(medicalData, null, 2)}

التحليل السريري:
${clinicalAnalysis}

التحليل التخصصي (${specialtyResult.specialty}):
${specialtyResult.analysis}
` 
        },
      ],
      max_tokens: 8000, // زيادة كبيرة في حجم الاستجابة
      temperature: 0.1,
    }),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`خطأ في إنتاج التقرير النهائي: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "لم يتم إنتاج التقرير النهائي.";
}

// المعالج الرئيسي المحسّن
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "طريقة غير مسموحة.");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) return bad(res, 500, "خطأ في إعداد الخادم.");

    const { files = [] } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) return bad(res, 400, "لم يتم توفير ملفات.");

    // مرحلة 1: الاستخراج الشامل
    const extractedData = await Promise.all(
      files.map(file => comprehensiveMedicalExtraction(file))
    );

    // دمج البيانات من عدة ملفات
    const consolidatedData = consolidateMultipleRecords(extractedData);

    // مرحلة 2: التحليل السريري المتعمق
    const clinicalAnalysis = await deepClinicalAnalysis(consolidatedData);

    // مرحلة 3: التحليل التخصصي
    const specialtyResult = await specialtyAnalysis(consolidatedData, clinicalAnalysis);

    // مرحلة 4: التقرير النهائي الشامل
    const comprehensiveReport = await generateComprehensiveReport(
      consolidatedData, 
      clinicalAnalysis, 
      specialtyResult
    );

    return ok(res, {
      report: comprehensiveReport,
      rawData: consolidatedData,
      clinicalAnalysis,
      specialtyAnalysis: specialtyResult,
      metadata: {
        filesProcessed: files.length,
        patientName: consolidatedData?.patientInfo?.name || "غير محدد",
        specialty: specialtyResult.specialty
      }
    });

  } catch (err) {
    console.error("خطأ في التحليل الطبي المتعمق:", err?.message);
    return bad(res, 500, `خطأ داخلي في الخادم: ${err?.message}`);
  }
}

// دالة مساعدة لدمج السجلات المتعددة
function consolidateMultipleRecords(records) {
  if (records.length === 1) return records[0];
  
  // منطق دمج السجلات المتعددة للمريض نفسه
  const consolidated = {
    patientInfo: records[0]?.patientInfo || {},
    visits: records.map((record, index) => ({
      visitNumber: index + 1,
      ...record
    })),
    // دمج التواريخ المرضية
    pastMedicalHistory: [...new Set(records.flatMap(r => r.pastMedicalHistory || []))],
    // دمج الأدوية
    medications: [...new Set(records.flatMap(r => r.medications || []))],
    // دمج الحساسيات
    allergies: [...new Set(records.flatMap(r => r.allergies || []))]
  };
  
  return consolidate
