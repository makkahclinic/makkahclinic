import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const SINGLE_CASE_PROMPT = `أنت خبير طبي متخصص في مراجعة جودة الرعاية الصحية ومطابقة البروتوكولات الطبية.

مهمتك: تحليل الملفات الطبية المرفقة (وصفات، تحاليل، أشعة، تقارير) وتقييم مدى التزام الطبيب بالبروتوكولات الطبية المعتمدة.

قم بتحليل الحالة وإعطاء تقرير شامل يتضمن:

1. **ملخص الحالة**: وصف موجز للحالة والتشخيص
2. **الإجراءات الصحيحة ✅**: ما فعله الطبيب بشكل صحيح وفق البروتوكول
3. **الأخطاء والمخالفات ❌**: ما فعله الطبيب بشكل خاطئ أو مخالف للبروتوكول
4. **الإجراءات الناقصة ⚠️**: ما كان يجب أن يفعله الطبيب ولم يفعله
5. **التحاليل والفحوصات**:
   - هل التحاليل المطلوبة كافية؟
   - هل هناك تحاليل ناقصة؟
   - تقييم نتائج التحاليل (إن وجدت)
6. **الأدوية الموصوفة**:
   - هل الأدوية مناسبة للحالة؟
   - هل الجرعات صحيحة؟
   - هل هناك تداخلات دوائية خطيرة؟
7. **الأشعة والصور** (إن وجدت):
   - تحليل الصور الطبية
   - ملاحظات على النتائج
8. **التوصيات 💡**: اقتراحات للتحسين والمتابعة
9. **درجة المطابقة**: نسبة مئوية لمدى الالتزام بالبروتوكول (0-100%)

استخدم البروتوكولات التالية كمرجع:
- بروتوكولات CDC الأمريكية
- بروتوكولات وزارة الصحة السعودية
- المبادئ التوجيهية لـ WHO
- أفضل الممارسات الطبية العالمية

أعط التقرير بتنسيق HTML جميل مع ألوان وأيقونات واضحة.
استخدم اللون الأخضر للصحيح، الأحمر للخطأ، الأصفر للتحذيرات.`;

const MULTI_CASE_PROMPT = `أنت خبير تأمين طبي متخصص في مراجعة الحالات الطبية وتقييمها من منظور التأمين.

مهمتك: تحليل جدول الحالات الطبية المرفق وتقييم كل حالة من حيث:
- مطابقة الإجراءات للبروتوكولات الطبية
- صحة الترميز (ICD codes)
- توثيق الأدوية والإجراءات
- احتمالية قبول أو رفض المطالبة

**المطلوب إخراجه:**
جدول HTML يحتوي على كل الحالات مع الأعمدة التالية:
1. رقم الحالة/المريض
2. التشخيص
3. الإجراءات/الأدوية
4. الترميز
5. **الحالة** (مع لون):
   - 🟢 **مقبول** (أخضر) - الحالة موثقة بشكل صحيح وقابلة للقبول
   - 🔴 **مرفوض** (أحمر) - الحالة بها مشاكل جوهرية تؤدي للرفض
   - 🟡 **يحتاج تصحيح** (أصفر) - الحالة قابلة للقبول بعد التصحيح
6. **الملاحظات** - شرح موجز للمشكلة
7. **التصحيح المطلوب** (إذا كانت صفراء) - ماذا يجب عمله بالضبط

**قواعد التقييم:**
- 🟢 مقبول: توثيق كامل، ترميز صحيح، إجراءات مطابقة للتشخيص
- 🔴 مرفوض: ترميز خاطئ، إجراءات غير مبررة، توثيق ناقص بشكل جوهري
- 🟡 يحتاج تصحيح: مشاكل بسيطة قابلة للإصلاح (ترميز يحتاج تحديث، توثيق ناقص)

**التنسيق:**
- استخدم جدول HTML بتنسيق جميل
- لون خلفية الصف حسب الحالة: #dcfce7 (أخضر)، #fee2e2 (أحمر)، #fef9c3 (أصفر)
- في النهاية أضف ملخص: عدد المقبول/المرفوض/يحتاج تصحيح

**بيانات الحالات:**
`;

export async function analyzeMedicalCase(files, lang = 'ar') {
  try {
    const imageFiles = files.filter(f => !f.isExcel);
    const excelFiles = files.filter(f => f.isExcel);
    
    const isMultiCase = excelFiles.length > 0;
    const prompt = isMultiCase ? MULTI_CASE_PROMPT : SINGLE_CASE_PROMPT;
    
    const parts = [{ text: prompt }];
    
    if (imageFiles.length > 0) {
      for (const file of imageFiles) {
        const base64Data = file.data.replace(/^data:[^;]+;base64,/, '');
        parts.push({
          inlineData: {
            mimeType: file.mimeType || 'image/jpeg',
            data: base64Data
          }
        });
      }
    }
    
    if (excelFiles.length > 0) {
      let excelText = '\n\n--- بيانات الحالات من Excel ---\n';
      for (const file of excelFiles) {
        excelText += `\nملف: ${file.name}\n`;
        if (file.textContent) {
          excelText += file.textContent;
        } else if (file.data && !file.data.startsWith('data:')) {
          excelText += file.data;
        }
      }
      parts.push({ text: excelText });
    }
    
    parts.push({ text: '\n\nقم بتحليل البيانات أعلاه وأعط تقريراً شاملاً بتنسيق HTML.' });

    const contents = [{
      role: 'user',
      parts: parts
    }];

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
    });

    let htmlResponse = '';
    
    if (result.candidates && result.candidates[0] && result.candidates[0].content) {
      const resultParts = result.candidates[0].content.parts || [];
      htmlResponse = resultParts.map(p => p.text || '').join('');
    } else if (result.text) {
      htmlResponse = result.text;
    } else if (typeof result.response?.text === 'function') {
      htmlResponse = result.response.text();
    }
    
    if (!htmlResponse) {
      throw new Error('لم يتم الحصول على استجابة من النموذج');
    }
    
    if (htmlResponse.includes('```html')) {
      htmlResponse = htmlResponse.replace(/```html\n?/g, '').replace(/```\n?/g, '');
    }
    if (htmlResponse.includes('```')) {
      htmlResponse = htmlResponse.replace(/```\n?/g, '');
    }

    const styledHtml = wrapWithStyles(htmlResponse, isMultiCase);

    return {
      success: true,
      html: styledHtml,
      raw: htmlResponse,
      isMultiCase: isMultiCase
    };

  } catch (error) {
    console.error('Medical audit error:', error);
    return {
      success: false,
      error: error.message,
      html: `<div class="error-box">
        <h3>❌ حدث خطأ في التحليل</h3>
        <p>${error.message}</p>
      </div>`
    };
  }
}

function wrapWithStyles(html, isMultiCase = false) {
  const today = new Date().toLocaleDateString('ar-SA', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    calendar: 'islamic-umalqura'
  });
  const gregorian = new Date().toLocaleDateString('ar-EG', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric'
  });
  
  const multiCaseStyles = isMultiCase ? `
    .status-accepted { background: #dcfce7 !important; }
    .status-rejected { background: #fee2e2 !important; }
    .status-needs-fix { background: #fef9c3 !important; }
    .status-badge { 
      display: inline-block; padding: 0.25rem 0.75rem; border-radius: 20px; 
      font-weight: bold; font-size: 0.85rem; 
    }
    .badge-green { background: #22c55e; color: white; }
    .badge-red { background: #ef4444; color: white; }
    .badge-yellow { background: #eab308; color: #1f2937; }
    .summary-box { 
      display: flex; gap: 1rem; justify-content: center; 
      margin: 1.5rem 0; padding: 1rem; background: #f8fafc; border-radius: 12px; 
    }
    .summary-item { text-align: center; padding: 1rem 2rem; border-radius: 8px; }
    .summary-item.accepted { background: #dcfce7; }
    .summary-item.rejected { background: #fee2e2; }
    .summary-item.needs-fix { background: #fef9c3; }
    .summary-item .count { font-size: 2rem; font-weight: bold; }
  ` : '';
  
  return `
    <style>
      .audit-report { font-family: 'Tajawal', sans-serif; direction: rtl; }
      .report-header { 
        display: flex; align-items: center; justify-content: space-between; 
        padding: 1.5rem; background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%); 
        border-radius: 12px; margin-bottom: 1.5rem; color: white;
      }
      .report-header .logo-area { display: flex; align-items: center; gap: 1rem; }
      .report-header img { width: 70px; height: 70px; border-radius: 50%; border: 3px solid #c9a962; background: white; }
      .report-header .clinic-info h2 { font-size: 1.3rem; color: #c9a962; margin: 0; }
      .report-header .clinic-info p { font-size: 0.85rem; margin: 0.25rem 0 0; opacity: 0.9; }
      .report-header .date-area { text-align: left; font-size: 0.85rem; }
      .report-header .date-area .hijri { color: #c9a962; font-weight: bold; }
      .audit-report h1, .audit-report h2, .audit-report h3 { color: #1e3a5f; margin-top: 1.5rem; }
      .audit-report h1 { font-size: 1.6rem; text-align: center; padding: 1rem; border-bottom: 3px solid #c9a962; background: #f8fafc; border-radius: 8px; margin-top: 0; }
      .audit-report h2 { font-size: 1.3rem; display: flex; align-items: center; gap: 0.5rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
      .audit-report h3 { font-size: 1.1rem; }
      .audit-report p, .audit-report li { line-height: 1.8; color: #334155; }
      .audit-report ul { list-style: none; padding: 0; }
      .audit-report li { padding: 0.75rem 1rem; margin: 0.5rem 0; border-radius: 8px; border-right: 4px solid #cbd5e1; background: #f8fafc; }
      .audit-report .success, .audit-report li:has(.success) { background: #dcfce7 !important; border-right-color: #22c55e !important; }
      .audit-report .error, .audit-report li:has(.error) { background: #fee2e2 !important; border-right-color: #ef4444 !important; }
      .audit-report .warning, .audit-report li:has(.warning) { background: #fef9c3 !important; border-right-color: #eab308 !important; }
      .audit-report .info, .audit-report li:has(.info) { background: #dbeafe !important; border-right-color: #3b82f6 !important; }
      .audit-report table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
      .audit-report th, .audit-report td { padding: 0.75rem; text-align: right; border: 1px solid #e2e8f0; }
      .audit-report th { background: #1e3a5f; color: white; }
      .audit-report tr:nth-child(even) { background: #f8fafc; }
      .audit-report .score-box { text-align: center; padding: 1.5rem; border-radius: 12px; margin: 1rem 0; }
      .audit-report .score-high { background: linear-gradient(135deg, #22c55e, #16a34a); color: white; }
      .audit-report .score-medium { background: linear-gradient(135deg, #eab308, #ca8a04); color: white; }
      .audit-report .score-low { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; }
      .audit-report .score-value { font-size: 3rem; font-weight: bold; }
      .report-footer { 
        margin-top: 2rem; padding: 1rem; background: #f8fafc; border-radius: 8px; 
        text-align: center; font-size: 0.8rem; color: #64748b; border-top: 2px solid #c9a962;
      }
      .error-box { background: #fee2e2; border: 2px solid #ef4444; padding: 1.5rem; border-radius: 12px; text-align: center; }
      .error-box h3 { color: #dc2626; margin: 0 0 1rem; }
      ${multiCaseStyles}
      @media print {
        .report-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
    <div class="audit-report">
      <div class="report-header">
        <div class="logo-area">
          <img src="https://www.m2020m.org/logo-transparent.png" alt="شعار المجمع">
          <div class="clinic-info">
            <h2>مجمع مكة الطبي بالزاهر</h2>
            <p>قسم إدارة الجودة وسلامة المرضى</p>
          </div>
        </div>
        <div class="date-area">
          <div class="hijri">${today}</div>
          <div>${gregorian}</div>
        </div>
      </div>
      ${html}
      <div class="report-footer">
        <p>تم إنشاء هذا التقرير بواسطة نظام مراجعة جودة الرعاية الطبية - مجمع مكة الطبي بالزاهر</p>
        <p>هذا التقرير للأغراض الاستشارية فقط ولا يغني عن الرأي الطبي المتخصص</p>
      </div>
    </div>
  `;
}

export function registerMedicalAuditRoutes(app) {
  app.post('/api/medical-audit', async (req, res) => {
    try {
      const { files, lang } = req.body;
      
      if (!files || files.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'لم يتم رفع أي ملفات' 
        });
      }

      const result = await analyzeMedicalCase(files, lang);
      res.json(result);
      
    } catch (error) {
      console.error('Medical audit API error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
}
