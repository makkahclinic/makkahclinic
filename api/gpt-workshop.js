// استيراد المكتبات المطلوبة
import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';

// إعداد OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// إعدادات التطبيق
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.doc', '.docx'];

// إنشاء مجلد التحميل إذا لم يكن موجوداً
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// دالة استخراج النص من PDF
async function extractTextFromPDF(buffer) {
  try {
    const data = await pdf(buffer);
    return data.text;
  } catch (error) {
    console.error('خطأ في استخراج النص من PDF:', error);
    throw new Error('فشل في قراءة ملف PDF');
  }
}

// دالة استخراج النص من ملف نصي
function extractTextFromTxt(buffer) {
  try {
    return buffer.toString('utf-8');
  } catch (error) {
    console.error('خطأ في قراءة الملف النصي:', error);
    throw new Error('فشل في قراءة الملف النصي');
  }
}

// دالة تحليل البيانات الطبية باستخدام GPT
async function analyzeMedicalData(text) {
  try {
    const analysisPrompt = `
أنت خبير طبي متخصص في تحليل الملفات الطبية. قم بتحليل هذا النص الطبي وإنتاج تقرير شامل ومفصل:

النص الطبي:
${text.substring(0, 8000)} // أول 8000 حرف لتجنب تجاوز الحد

قم بإنتاج تقرير طبي شامل باللغة العربية يتضمن الأقسام التالية:

## 1. ملخص المريض والمعلومات الأساسية
- الاسم والبيانات الشخصية
- العمر والجنس
- رقم الملف الطبي
- تاريخ التسجيل
- معلومات الاتصال
- التأمين الطبي

## 2. التاريخ المرضي الشامل
- الأمراض المزمنة الحالية
- التاريخ الجراحي
- الحساسية المعروفة
- التاريخ العائلي للأمراض
- العادات الصحية (التدخين، الكحول، إلخ)

## 3. تحليل الزيارات الطبية
- إجمالي عدد الزيارات
- تواريخ الزيارات وتكرارها
- الأقسام المختلفة التي تمت زيارتها
- أسباب كل زيارة
- تقييم ضرورة الزيارات
- أنماط الزيارات غير الطبيعية

## 4. تحليل التشخيصات
- التشخيصات الرئيسية
- التشخيصات الثانوية
- تطور التشخيصات عبر الزمن
- دقة التشخيصات
- التشخيصات المتضاربة

## 5. مراجعة شاملة للأدوية
- قائمة كاملة بالأدوية الموصوفة
- الجرعات ومدة العلاج
- تحليل التفاعلات الدوائية
- مدى مناسبة الأدوية للحالة
- كشف الإفراط في وصف الأدوية
- تقييم الالتزام بالعلاج

## 6. تحليل الفحوصات والإجراءات
- قائمة بجميع الفحوصات المطلوبة
- نتائج الفحوصات المهمة
- تقييم ضرورة كل فحص
- كشف التكرار غير المبرر للفحوصات
- تحليل التكلفة مقابل الفائدة

## 7. تقييم جودة الرعاية الطبية
- مدى اتباع الإرشادات الطبية المعتمدة
- جودة التوثيق الطبي
- التنسيق بين الأطباء المختلفين
- كفاءة المتابعة الطبية
- سرعة الاستجابة للحالات الطارئة

## 8. تحليل المخاطر والمشاكل
- المخاطر الحالية على صحة المريض
- أخطاء محتملة في التشخيص أو العلاج
- تضارب في الأدوية أو الإجراءات
- مشاكل في التواصل الطبي
- قضايا السلامة الطبية

## 9. التحليل المالي والتأميني
- إجمالي التكاليف الطبية
- تحليل الفواتير الطبية
- كشف الإفراط في الفواتير
- مطالبات التأمين المشبوهة
- تقييم الكفاءة المالية للعلاج

## 10. التوصيات والتحسينات
- توصيات لتحسين الرعاية الطبية
- اقتراحات لتجنب المخاطر
- خطة المتابعة المستقبلية
- نصائح للمريض والأسرة
- توصيات للفريق الطبي

## 11. الملاحظات والتقييم النهائي
- تقييم عام شامل للحالة
- درجة الخطورة الحالية
- أولويات العلاج
- توقعات المستقبل
- ملاحظات خاصة مهمة

كن دقيقاً ومفصلاً في التحليل واستخدم المصطلحات الطبية المناسبة.
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "أنت خبير طبي متخصص في تحليل الحالات الطبية وكتابة التقارير الشاملة والمفصلة. لديك خبرة واسعة في مراجعة الملفات الطبية وكشف المشاكل والمخاطر."
        },
        {
          role: "user",
          content: analysisPrompt
        }
      ],
      max_tokens: 4000,
      temperature: 0.2,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('خطأ في التحليل:', error);
    throw new Error('فشل في تحليل البيانات الطبية');
  }
}

// دالة استخراج البيانات المنظمة
function extractStructuredData(text) {
  const patterns = {
    patientName: /(?:اسم المريض|المريض|الاسم)[:\s]*([^\n\r]+)/gi,
    patientId: /(?:رقم الهوية|الهوية|الرقم الوطني|رقم الملف)[:\s]*([0-9]+)/gi,
    age: /(?:العمر|السن)[:\s]*([0-9]+)/gi,
    gender: /(?:الجنس|النوع)[:\s]*([^\n\r]+)/gi,
    dates: /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g,
    departments: /(?:القسم|الشعبة|العيادة|الوحدة)[:\s]*([^\n\r]+)/gi,
    doctors: /(?:الطبيب|الدكتور|د\.)[:\s]*([^\n\r]+)/gi,
    diagnoses: /(?:التشخيص|الحالة|المرض|التشخيص النهائي)[:\s]*([^\n\r]+)/gi,
    medications: /(?:الدواء|العلاج|الأدوية|الوصفة)[:\s]*([^\n\r]+)/gi,
    procedures: /(?:الإجراء|العملية|الفحص|التدخل)[:\s]*([^\n\r]+)/gi,
    vitals: /(?:الضغط|النبض|الحرارة|الوزن|الطول)[:\s]*([^\n\r]+)/gi,
    insurance: /(?:التأمين|الشركة التأمينية|بوليصة)[:\s]*([^\n\r]+)/gi
  };

  const extractedData = {};
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      extractedData[key] = matches.map(match => match[1]?.trim()).filter(Boolean);
    }
  }

  return extractedData;
}

// دالة معالجة الملف المرفوع
async function parseFormData(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      uploadDir: UPLOAD_DIR,
      keepExtensions: true,
      maxFileSize: MAX_FILE_SIZE,
      multiples: false,
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ fields, files });
    });
  });
}

// المعالج الرئيسي للـ API
export async function POST(request) {
  try {
    console.log('بدء معالجة الطلب...');

    // تحويل NextRequest إلى Node.js request
    const req = {
      ...request,
      body: request.body,
    };

    // معالجة الملف المرفوع
    const { files } = await parseFormData(req);
    
    if (!files.file) {
      return NextResponse.json(
        { error: 'لم يتم رفع أي ملف' },
        { status: 400 }
      );
    }

    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = uploadedFile.filepath;
    const fileName = uploadedFile.originalFilename;
    const fileExtension = path.extname(fileName).toLowerCase();

    console.log(`معالجة الملف: ${fileName}`);

    // التحقق من نوع الملف
    if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return NextResponse.json(
        { error: 'نوع الملف غير مدعوم. يرجى رفع ملف PDF أو TXT' },
        { status: 400 }
      );
    }

    // قراءة الملف
    const fileBuffer = fs.readFileSync(filePath);
    let extractedText = '';

    // استخراج النص حسب نوع الملف
    if (fileExtension === '.pdf') {
      extractedText = await extractTextFromPDF(fileBuffer);
    } else if (fileExtension === '.txt') {
      extractedText = extractTextFromTxt(fileBuffer);
    } else {
      return NextResponse.json(
        { error: 'نوع الملف غير مدعوم حالياً' },
        { status: 400 }
      );
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return NextResponse.json(
        { error: 'لم يتم العثور على نص في الملف' },
        { status: 400 }
      );
    }

    console.log(`تم استخراج النص بنجاح. الطول: ${extractedText.length} حرف`);

    // استخراج البيانات المنظمة
    const structuredData = extractStructuredData(extractedText);

    // تحليل البيانات باستخدام GPT
    console.log('بدء التحليل باستخدام GPT...');
    const analysis = await analyzeMedicalData(extractedText);

    // حفظ النتائج
    const results = {
      fileName,
      uploadTime: new Date().toISOString(),
      textLength: extractedText.length,
      extractedData: structuredData,
      analysis,
      success: true
    };

    // حفظ النتائج في ملف
    const resultFileName = `analysis_${Date.now()}.json`;
    const resultPath = path.join(UPLOAD_DIR, resultFileName);
    fs.writeFileSync(resultPath, JSON.stringify(results, null, 2), 'utf-8');

    // حذف الملف المؤقت
    try {
      fs.unlinkSync(filePath);
    } catch (cleanupError) {
      console.error('خطأ في حذف الملف المؤقت:', cleanupError);
    }

    console.log('تم إكمال التحليل بنجاح');

    return NextResponse.json(results, { status: 200 });

  } catch (error) {
    console.error('خطأ في المعالجة:', error);
    
    return NextResponse.json(
      { 
        error: 'حدث خطأ أثناء معالجة الملف',
        details: error.message,
        success: false
      },
      { status: 500 }
    );
  }
}

// معالج GET للاختبار
export async function GET() {
  return NextResponse.json(
    { 
      message: 'API يعمل بشكل صحيح',
      timestamp: new Date().toISOString(),
      status: 'active'
    },
    { status: 200 }
  );
}

// تصدير الدوال للاستخدام الخارجي
export { analyzeMedicalData, extractStructuredData, extractTextFromPDF };
