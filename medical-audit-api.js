import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini with direct API key (proven to work for medical analysis)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

// System role - defines WHO the AI is
const SYSTEM_ROLE = `أنت خبير طبي وتأميني متخصص بخبرة 20 عامًا في:
- مراجعة جودة الرعاية الصحية
- تدقيق مطالبات التأمين الطبي
- مطابقة البروتوكولات الطبية (CDC, MOH, WHO)
- تحليل الترميز الطبي (ICD-10, CPT)

أنت معروف بتقاريرك المفصلة والشاملة التي تغطي كل جانب من الحالة الطبية.
لا تختصر أبدًا. التفصيل هو سمتك الأساسية.`;

// Developer instructions - defines HOW to respond
const DEVELOPER_INSTRUCTIONS = `## 📋 قواعد إلزامية للتقرير:

### البنية المطلوبة (يجب اتباعها حرفياً):

1. **📄 ملخص الحالة** (200+ كلمة)
   - وصف شامل للحالة
   - التشخيص الرئيسي والتشخيصات الثانوية
   - الأعراض المسجلة
   - التاريخ المرضي

2. **✅ الإجراءات الصحيحة** (5+ نقاط)
   - اذكر كل إجراء صحيح مع السبب
   - اربطه بالبروتوكول المعتمد

3. **❌ الأخطاء والمخالفات** (تحليل معمق)
   - كل خطأ في فقرة منفصلة
   - اشرح لماذا هو خطأ
   - ما هو البروتوكول الصحيح
   - ما هي العواقب المحتملة

4. **⚠️ الإجراءات الناقصة** (قائمة مفصلة)
   - ما كان يجب فعله
   - لماذا كان ضرورياً
   - التأثير على المريض

5. **🔬 التحاليل والفحوصات** (جدول + تحليل)
   - جدول بكل التحاليل
   - تقييم كل نتيجة
   - التحاليل الناقصة المطلوبة

6. **💊 الأدوية** (تحليل كل دواء)
   - اسم الدواء والجرعة
   - هل مناسب للتشخيص؟
   - التداخلات الدوائية
   - البدائل المقترحة إن وجدت

7. **📊 تقييم الترميز** (ICD-10 / CPT)
   - الرمز المستخدم
   - هل صحيح؟
   - الرمز الصحيح إن كان خاطئاً

8. **💡 التوصيات** (5+ توصيات عملية)

9. **📈 التقييم النهائي** (جدول ملخص)

### قواعد التنسيق:
- استخدم HTML مع CSS inline
- ألوان: أخضر #22c55e للصحيح، أحمر #ef4444 للخطأ، أصفر #eab308 للتحذير
- استخدم الأيقونات: ✅❌⚠️💊🔬📋💡📊
- اجعل التقرير مرئياً وجميلاً

### في النهاية أضف:
<div id="ai-ratings" style="display:none;">
  <span data-insurance-rating="X"></span>
  <span data-service-rating="Y"></span>
</div>

حيث X و Y أرقام من 1-10.`;

// Example output for few-shot learning
const EXAMPLE_OUTPUT = `## 📋 مثال على جودة التقرير المطلوب:

<div style="background:#f0fdf4;padding:20px;border-radius:10px;margin:10px 0;">
<h3 style="color:#166534;">✅ الإجراءات الصحيحة</h3>
<ul>
<li><strong>طلب تحليل CBC:</strong> إجراء صحيح ومطابق لبروتوكول WHO لتقييم حالات العدوى. يساعد في تحديد نوع العدوى (بكتيرية/فيروسية) ومستوى شدتها.</li>
<li><strong>وصف Augmentin 1g:</strong> مضاد حيوي واسع الطيف مناسب لعدوى الجهاز التنفسي العلوي وفق بروتوكول MOH.</li>
<li><strong>المتابعة بعد 5 أيام:</strong> فترة مناسبة لتقييم الاستجابة للعلاج.</li>
</ul>
</div>

<div style="background:#fef2f2;padding:20px;border-radius:10px;margin:10px 0;">
<h3 style="color:#991b1b;">❌ الأخطاء والمخالفات</h3>
<div style="border-right:4px solid #ef4444;padding-right:15px;margin:10px 0;">
<strong>1. غياب فحص CRP:</strong>
<p>وفق بروتوكول CDC لتشخيص العدوى البكتيرية، يجب طلب CRP مع CBC لتحديد شدة الالتهاب. غيابه يضعف دقة التشخيص ويؤثر على قرار وصف المضاد الحيوي.</p>
<p><strong>التأثير:</strong> قد يؤدي لوصف مضاد حيوي غير ضروري أو بجرعة غير مناسبة.</p>
</div>
</div>

هذا هو مستوى التفصيل المطلوب لكل قسم.`;

export async function analyzeMedicalCase(files, lang = 'ar') {
  try {
    const imageFiles = files.filter(f => !f.isExcel);
    const excelFiles = files.filter(f => f.isExcel);
    
    // Check total data size (limit to 10MB for API stability)
    let totalSize = 0;
    for (const file of files) {
      if (file.data) {
        totalSize += file.data.length;
      }
      if (file.textContent) {
        totalSize += file.textContent.length;
      }
    }
    const sizeMB = totalSize / (1024 * 1024);
    console.log(`Total data size: ${sizeMB.toFixed(2)} MB`);
    
    if (sizeMB > 15) {
      throw new Error(`حجم البيانات كبير جداً (${sizeMB.toFixed(1)} MB). الحد الأقصى 15 MB. يرجى تقليل عدد الملفات أو ضغط الصور.`);
    }
    
    const isMultiCase = excelFiles.length > 0;
    
    // Build user content with medical data
    const userContent = [];
    
    // Add task description
    if (isMultiCase) {
      userContent.push({ 
        type: 'text', 
        text: `📋 المهمة: تحليل جميع الحالات الطبية في ملف Excel وتقييم كل حالة.

أريد تقريراً شاملاً يتضمن:
- جدول بكل الحالات مع تصنيف ملون (🟢 مقبول / 🔴 مرفوض / 🟡 يحتاج تصحيح)
- تحليل مفصل لكل حالة
- ملخص إحصائي في النهاية

--- بيانات الحالات ---
`
      });
    } else {
      userContent.push({ 
        type: 'text', 
        text: `📋 المهمة: تحليل الحالة الطبية المرفقة بشكل معمق ومفصل.

أريد تقريراً شاملاً يتبع البنية المحددة بالضبط مع تفصيل كل قسم.

--- بيانات الحالة ---
`
      });
    }
    
    // Add Excel data as text
    if (excelFiles.length > 0) {
      for (const file of excelFiles) {
        let excelText = `\n📁 ملف: ${file.name}\n`;
        if (file.textContent) {
          excelText += file.textContent;
        } else if (file.data && !file.data.startsWith('data:')) {
          excelText += file.data;
        }
        userContent.push({ type: 'text', text: excelText });
      }
    }
    
    // Add images (OpenAI vision) with specific analysis instructions
    if (imageFiles.length > 0) {
      userContent.push({ type: 'text', text: `
📷 صورة وصفة طبية مرفقة - مطلوب تحليل كامل:

أنت خبير في قراءة الوصفات الطبية. انظر للصورة بعناية واستخرج:

1. اقرأ كل النص المكتوب في الصورة حرفياً
2. حدد كل دواء مكتوب (الاسم كما هو مكتوب بالضبط)
3. حدد الجرعة والتكرار لكل دواء
4. قيّم جودة الخط (واضح/متوسط/سيء)
5. اذكر أي أخطاء إملائية في أسماء الأدوية
6. اذكر أي اختصارات غير واضحة
7. حدد المعلومات الناقصة (تاريخ، توقيع، ختم، اسم المريض)
8. اذكر أي تحذيرات سلامة

الصورة التالية:
` });
      
      for (const file of imageFiles) {
        // Ensure proper base64 format for OpenAI Vision
        let imageUrl = file.data;
        
        // If it's already a data URL, use it directly
        // OpenAI Vision expects: data:image/jpeg;base64,XXXXX format
        if (!imageUrl.startsWith('data:')) {
          // Add proper prefix if missing
          imageUrl = `data:image/jpeg;base64,${imageUrl}`;
        }
        
        console.log(`Processing image: ${file.name}, size: ${(imageUrl.length / 1024).toFixed(1)} KB`);
        
        userContent.push({
          type: 'image_url',
          image_url: { 
            url: imageUrl,
            detail: 'high'  // High detail for medical prescriptions
          }
        });
      }
      
      userContent.push({ type: 'text', text: `
⬆️ هذه هي صورة الوصفة الطبية. 
اقرأ كل ما تراه في الصورة واكتب تحليلاً مفصلاً.
لا تقل "لا أستطيع قراءة" - حاول قراءة كل شيء مهما كانت جودة الخط.
` });
    }
    
    // Final instruction
    userContent.push({ type: 'text', text: `

---

🔴 تذكير مهم: 
- اتبع البنية المحددة بالضبط
- كل قسم يجب أن يحتوي على تحليل مفصل (ليس نقاط مختصرة)
- اذكر أسماء الأدوية والتحاليل والتشخيصات كما وردت في البيانات
- التقرير يجب أن يكون طويلاً ومفصلاً (2000+ كلمة)
- أخرج التقرير بتنسيق HTML جميل ومرئي

ابدأ التحليل الآن:` });
    
    // Build Gemini content parts
    const parts = [];
    
    // Add system instructions and example as text
    parts.push({ text: SYSTEM_ROLE + '\n\n' + DEVELOPER_INSTRUCTIONS + '\n\n' + EXAMPLE_OUTPUT + '\n\n---\n\n' });
    
    // Convert userContent to Gemini format
    for (const content of userContent) {
      if (content.type === 'text') {
        parts.push({ text: content.text });
      } else if (content.type === 'image_url') {
        // Convert image URL to Gemini inline format
        const imageData = content.image_url.url;
        if (imageData.startsWith('data:')) {
          const base64Data = imageData.replace(/^data:[^;]+;base64,/, '');
          const mimeMatch = imageData.match(/^data:([^;]+);/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          parts.push({
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          });
        }
      }
    }

    // Retry logic for API stability
    let result;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Gemini API attempt ${attempt}/3...`);
        result = await model.generateContent(parts);
        break; // Success, exit retry loop
      } catch (retryErr) {
        lastError = retryErr;
        console.error(`Attempt ${attempt} failed:`, retryErr.message);
        if (attempt < 3) {
          console.log(`Waiting 5 seconds before retry...`);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }
    
    if (!result) {
      throw new Error(`فشل الاتصال بعد 3 محاولات: ${lastError?.message || 'خطأ غير معروف'}`);
    }

    let htmlResponse = '';
    
    // Gemini response format
    const response = result.response;
    if (response && typeof response.text === 'function') {
      htmlResponse = response.text();
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
