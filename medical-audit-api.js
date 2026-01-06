import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
});

const SINGLE_CASE_PROMPT = `# الدور والصلاحية
أنت **رئيس وحدة التدقيق التأميني والجودة الطبية** في مجمع مكة الطبي. مهمتك: تحليل عميق وشامل للملفات الطبية لكشف المخالفات وضمان الجودة.

# أهداف التدقيق
1. كشف **الاحتيال والإفراط في الاستخدام** (تكرار غير مبرر، صرف أدوية زائدة)
2. التحقق من **دقة الترميز** (ICD-10/CPT) ومطابقته للتشخيص
3. رصد **مخالفات CBAHI** ومعايير الجودة
4. تقييم **اكتمال التوثيق** والفحوصات الأساسية
5. تحديد **التداخلات الدوائية** والجرعات الخاطئة

# قواعد الإخراج (إلزامية)
- أخرج **HTML فقط** - ممنوع Markdown (بدون ### أو ** أو -)
- استخدم **class="status-box accepted/rejected/warning"** للتلوين
- لا تضف headers أو footers - ابدأ مباشرة بالمحتوى
- كن **شاملاً ومفصلاً** - لا تختصر

# هيكل التقرير المطلوب

<section class="case-summary">
<h2>📋 ملخص الحالة السريرية</h2>
<table>
<tr><th>البيان</th><th>التفاصيل</th></tr>
<tr><td>العمر/الجنس</td><td>[استخرج من الملف]</td></tr>
<tr><td>التشخيص الرئيسي</td><td>[التشخيص + كود ICD-10 إن وجد]</td></tr>
<tr><td>الأعراض المسجلة</td><td>[قائمة الأعراض]</td></tr>
<tr><td>التاريخ المرضي</td><td>[الأمراض المزمنة إن وجدت]</td></tr>
</table>
</section>

<section class="evaluation">
<h2>📊 تقييم الإجراءات الطبية</h2>

<div class="status-box accepted">
<h3>✅ مقبول - إجراءات صحيحة</h3>
<ul>
<li><strong>[اسم الإجراء]:</strong> [سبب القبول مع ذكر البروتوكول المرجعي CDC/WHO/MOH]</li>
</ul>
</div>

<div class="status-box rejected">
<h3>❌ مرفوض - أخطاء ومخالفات</h3>
<ul>
<li>
<strong>[اسم المخالفة]:</strong> [وصف تفصيلي]
<br><em>البروتوكول الصحيح:</em> [ما كان يجب فعله]
<br><em>العواقب المحتملة:</em> [المخاطر على المريض أو التأمين]
</li>
</ul>
</div>

<div class="status-box warning">
<h3>⚠️ يحتاج مراجعة - إجراءات ناقصة</h3>
<ul>
<li><strong>[الإجراء الناقص]:</strong> [لماذا مطلوب + ما يجب فعله]</li>
</ul>
</div>
</section>

<section class="diagnostics">
<h2>🔬 تقييم التحاليل والفحوصات</h2>
<table>
<tr><th>التحليل/الفحص</th><th>النتيجة</th><th>التقييم</th><th>الحالة</th></tr>
<tr><td>[اسم التحليل]</td><td>[النتيجة]</td><td>[تفسير طبي]</td><td class="status-accepted">✓</td></tr>
<tr><td>[تحليل ناقص]</td><td>-</td><td>[لماذا مطلوب]</td><td class="status-needs-correction">⚠</td></tr>
</table>
<p><strong>التحاليل الإلزامية المفقودة:</strong> [قائمة التحاليل التي كان يجب طلبها حسب التشخيص]</p>
</section>

<section class="medications">
<h2>💊 مراجعة الأدوية الموصوفة</h2>
<table>
<tr><th>الدواء</th><th>الجرعة</th><th>المدة</th><th>التقييم</th><th>الحالة</th></tr>
<tr><td>[اسم الدواء]</td><td>[الجرعة]</td><td>[المدة]</td><td>[مناسب/غير مناسب + السبب]</td><td class="status-accepted">✓</td></tr>
</table>
<div class="status-box warning" style="margin-top:10px;">
<h4>⚠️ تنبيهات دوائية</h4>
<ul>
<li><strong>تداخلات دوائية:</strong> [إن وجدت]</li>
<li><strong>أدوية زائدة:</strong> [تكرار غير مبرر]</li>
<li><strong>جرعات خاطئة:</strong> [إن وجدت]</li>
</ul>
</div>
</section>

<section class="coding">
<h2>📊 تقييم الترميز (ICD-10 / CPT)</h2>
<table>
<tr><th>الترميز المستخدم</th><th>الوصف</th><th>التقييم</th></tr>
<tr><td>[الكود]</td><td>[وصف الكود]</td><td>[صحيح/خاطئ + البديل الصحيح]</td></tr>
</table>
<p><strong>ملاحظات الترميز:</strong> [أي أكواد مفقودة أو خاطئة]</p>
</section>

<section class="cbahi">
<h2>🏥 الامتثال لمعايير CBAHI</h2>
<table>
<tr><th>المعيار</th><th>الحالة</th><th>الملاحظة</th></tr>
<tr><td>توثيق الحالة</td><td class="status-accepted">✓ ممتثل</td><td>[تفاصيل]</td></tr>
<tr><td>موافقة المريض</td><td class="status-needs-correction">⚠ ناقص</td><td>[ما ينقص]</td></tr>
</table>
</section>

<section class="risk-assessment">
<h2>⚠️ تقييم المخاطر والتسرب المالي</h2>
<div class="status-box rejected">
<h4>🔴 مخاطر عالية</h4>
<ul>
<li>[مخاطر على المريض أو احتيال تأميني محتمل]</li>
</ul>
</div>
<p><strong>التأثير المالي المقدر:</strong> [تقدير التكلفة الزائدة إن أمكن]</p>
</section>

<section class="recommendations">
<h2>📝 التوصيات وخطة العمل</h2>
<table>
<tr><th>التوصية</th><th>الأولوية</th><th>المسؤول</th></tr>
<tr><td>[التوصية 1]</td><td>عاجل</td><td>الطبيب المعالج</td></tr>
<tr><td>[التوصية 2]</td><td>متوسط</td><td>قسم الجودة</td></tr>
</table>
</section>

<div id="ai-ratings" style="display:none;">
<span data-insurance-rating="[1-10]"></span>
<span data-service-rating="[1-10]"></span>
</div>

# تذكير نهائي
- حلل كل جزء من الملف بعمق
- استخدم الجداول للتنظيم
- اذكر البروتوكولات المرجعية (CDC, WHO, MOH, CBAHI)
- لا تترك أي قسم فارغاً - إذا لم تجد بيانات اكتب "غير متوفر في الملف"`;

const MULTI_CASE_PROMPT = `# الدور والصلاحية
أنت **رئيس وحدة التدقيق التأميني والجودة الطبية** في مجمع مكة الطبي. مهمتك: تحليل جميع الحالات الطبية وتصنيفها.

# قواعد الإخراج (إلزامية)
- أخرج **HTML فقط** - ممنوع Markdown
- ابدأ مباشرة بالمحتوى - لا مقدمات
- استخدم الجداول للتنظيم

# هيكل التقرير المطلوب

<section class="portfolio-summary">
<h2>📊 ملخص المحفظة</h2>
<div style="display:flex;gap:15px;justify-content:center;margin:15px 0;">
<div class="status-box accepted" style="flex:1;text-align:center;padding:15px;">
<div style="font-size:2rem;font-weight:bold;">[عدد]</div>
<div>✅ مقبول</div>
</div>
<div class="status-box rejected" style="flex:1;text-align:center;padding:15px;">
<div style="font-size:2rem;font-weight:bold;">[عدد]</div>
<div>❌ مرفوض</div>
</div>
<div class="status-box warning" style="flex:1;text-align:center;padding:15px;">
<div style="font-size:2rem;font-weight:bold;">[عدد]</div>
<div>⚠️ يحتاج تصحيح</div>
</div>
</div>
</section>

<section class="cases-table">
<h2>📋 جدول ملخص الحالات</h2>
<table>
<thead>
<tr>
<th>القسم</th>
<th>رقم الحالة</th>
<th>المريض</th>
<th>التشخيص الرئيسي</th>
<th>ICD-10</th>
<th>الحالة</th>
</tr>
</thead>
<tbody>
<tr>
<td>[القسم]</td>
<td>[رقم]</td>
<td>[اسم/عمر]</td>
<td>[التشخيص]</td>
<td>[كود]</td>
<td class="status-accepted">🟢 مقبول</td>
</tr>
<tr>
<td>[القسم]</td>
<td>[رقم]</td>
<td>[اسم/عمر]</td>
<td>[التشخيص]</td>
<td>[كود]</td>
<td class="status-rejected">🔴 مرفوض</td>
</tr>
</tbody>
</table>
</section>

<!-- كرر هذا القسم لكل حالة تحتاج تفصيل -->
<section class="case-detail">
<h2>🔍 تحليل الحالة [رقم]: [التشخيص]</h2>

<div class="status-box accepted">
<h3>✅ الإجراءات الصحيحة</h3>
<ul>
<li><strong>[الإجراء]:</strong> [سبب القبول مع البروتوكول المرجعي]</li>
</ul>
</div>

<div class="status-box rejected">
<h3>❌ الأخطاء والمخالفات</h3>
<ul>
<li><strong>[المخالفة]:</strong> [الوصف]<br><em>البروتوكول الصحيح:</em> [ما يجب فعله]<br><em>العواقب:</em> [المخاطر]</li>
</ul>
</div>

<div class="status-box warning">
<h3>⚠️ الإجراءات الناقصة</h3>
<ul>
<li><strong>[الناقص]:</strong> [لماذا مطلوب]<br><em>الإجراء التصحيحي:</em> [ما يجب عمله بالتحديد لتصحيح الوضع - خطوات واضحة]</li>
</ul>
</div>

<div class="status-box warning">
<h3>⚠️ الإجراءات الزائدة (بدون تبرير)</h3>
<ul>
<li><strong>[الإجراء الزائد]:</strong> [وصف الإجراء]<br><em>التبرير المطلوب:</em> هذا الإجراء يتطلب وجود تشخيص [التشخيصات التي تبرر هذا الإجراء مثل: ICD-10 codes]<br><em>العواقب:</em> [رفض تأميني، تكلفة إضافية، مخالفة CBAHI]</li>
</ul>
</div>

<h4>💊 الأدوية</h4>
<table>
<tr><th>الدواء</th><th>الجرعة</th><th>التقييم</th></tr>
<tr><td>[اسم]</td><td>[جرعة]</td><td>[مناسب/غير مناسب]</td></tr>
</table>

<h4>🔬 التحاليل</h4>
<ul>
<li>[تقييم التحاليل المطلوبة والموجودة]</li>
</ul>
</section>

<section class="cross-patterns">
<h2>🔗 الأنماط المتكررة عبر الحالات</h2>
<div class="status-box warning">
<ul>
<li><strong>نمط 1:</strong> [مشكلة تتكرر في عدة حالات]</li>
<li><strong>نمط 2:</strong> [قصور نظامي]</li>
</ul>
</div>
</section>

<section class="recommendations">
<h2>📝 التوصيات العامة</h2>
<table>
<tr><th>التوصية</th><th>الأولوية</th><th>المسؤول</th></tr>
<tr><td>[التوصية]</td><td>عاجل</td><td>[القسم]</td></tr>
</table>
</section>

<div id="ai-ratings" style="display:none;">
<span data-insurance-rating="[1-10]"></span>
<span data-service-rating="[1-10]"></span>
</div>

# تذكير
- حلل كل حالة بتفصيل
- اربط بين الحالات لاكتشاف الأنماط
- اذكر البروتوكولات (CDC, WHO, MOH, CBAHI)`;

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
  const multiCaseStyles = isMultiCase ? `
    .status-accepted { background: #dcfce7 !important; }
    .status-rejected { background: #fee2e2 !important; }
    .status-needs-correction, .status-needs-fix { background: #fef9c3 !important; }
  ` : '';
  
  return `
    <style>
      .audit-body { font-family: 'Tajawal', sans-serif; direction: rtl; line-height: 1.8; }
      .audit-body section { margin-bottom: 1.5rem; }
      .audit-body h2 { color: #1e3a5f; font-size: 1.2rem; border-bottom: 2px solid #c9a962; padding-bottom: 0.5rem; margin-bottom: 1rem; }
      .audit-body h3 { color: #1e3a5f; font-size: 1rem; margin: 0 0 0.5rem; }
      .audit-body p { color: #334155; margin-bottom: 1rem; }
      .audit-body ul { list-style: none; padding: 0; margin: 0; }
      .audit-body li { padding: 0.6rem 1rem; margin: 0.4rem 0; border-radius: 6px; background: #f8fafc; border-right: 3px solid #cbd5e1; }
      
      .status-box { padding: 1rem; border-radius: 10px; margin: 1rem 0; }
      .status-box.accepted { background: #dcfce7; border: 2px solid #22c55e; }
      .status-box.accepted h3 { color: #15803d; }
      .status-box.accepted li { background: #bbf7d0; border-right-color: #22c55e; }
      
      .status-box.rejected { background: #fee2e2; border: 2px solid #ef4444; }
      .status-box.rejected h3 { color: #dc2626; }
      .status-box.rejected li { background: #fecaca; border-right-color: #ef4444; }
      
      .status-box.warning { background: #fef9c3; border: 2px solid #eab308; }
      .status-box.warning h3 { color: #a16207; }
      .status-box.warning li { background: #fef08a; border-right-color: #eab308; }
      
      .audit-body table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.9rem; }
      .audit-body th, .audit-body td { padding: 0.6rem; text-align: right; border: 1px solid #e2e8f0; }
      .audit-body th { background: #1e3a5f; color: white; }
      .audit-body tr:nth-child(even) { background: #f8fafc; }
      
      .error-box { background: #fee2e2; border: 2px solid #ef4444; padding: 1.5rem; border-radius: 12px; text-align: center; }
      .error-box h3 { color: #dc2626; margin: 0 0 1rem; }
      ${multiCaseStyles}
    </style>
    <div class="audit-body">
      ${html}
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
