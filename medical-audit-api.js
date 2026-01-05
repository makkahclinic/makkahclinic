import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
});

const SINGLE_CASE_PROMPT = `أنت مدقق جودة طبية. أخرج HTML فقط بدون أي Markdown (بدون ### أو ** أو -).

اتبع هذا الهيكل بالضبط:

<section class="case-summary">
<h2>📋 ملخص الحالة</h2>
<p>[وصف موجز للحالة والتشخيص]</p>
</section>

<section class="evaluation">
<h2>📊 تقييم الإجراءات</h2>

<div class="status-box accepted">
<h3>✅ مقبول - إجراءات صحيحة</h3>
<ul>
<li>[الإجراء الصحيح 1]</li>
<li>[الإجراء الصحيح 2]</li>
</ul>
</div>

<div class="status-box rejected">
<h3>❌ مرفوض - أخطاء ومخالفات</h3>
<ul>
<li>[الخطأ 1 + السبب]</li>
<li>[الخطأ 2 + السبب]</li>
</ul>
</div>

<div class="status-box warning">
<h3>⚠️ يحتاج مراجعة</h3>
<ul>
<li>[الإجراء الناقص 1 + ما يجب فعله]</li>
</ul>
</div>
</section>

<section class="tests">
<h2>🔬 التحاليل والفحوصات</h2>
<ul>
<li>[تقييم التحاليل]</li>
</ul>
</section>

<section class="medications">
<h2>💊 الأدوية الموصوفة</h2>
<ul>
<li>[تقييم الأدوية]</li>
</ul>
</section>

<section class="recommendations">
<h2>📝 التوصيات</h2>
<ul>
<li>[التوصية 1]</li>
<li>[التوصية 2]</li>
</ul>
</section>

<div id="ai-ratings" style="display:none;">
<span data-insurance-rating="X"></span>
<span data-service-rating="Y"></span>
</div>

⚠️ مهم جداً:
- أخرج HTML فقط - بدون Markdown
- استخدم class="status-box accepted/rejected/warning" للتلوين
- لا تضف أي headers أو footers
- X و Y أرقام من 1-10`;

const MULTI_CASE_PROMPT = `## تعليمات مهمة للإخراج:
- لا تكتب أي مقدمة أو عبارات تمهيدية مثل "بصفتي خبير..." أو "قمت بمراجعة..."
- ابدأ مباشرة بجدول HTML للحالات
- لا تكرر تعليمات التنسيق في النتيجة

مهمتك: تحليل **جميع** الحالات الطبية المرفقة وتقييم كل حالة بدقة.

**معايير التقييم:**
1. مطابقة البروتوكولات الطبية (CDC, MOH, WHO)
2. صحة الترميز (ICD-10, CPT codes)
3. توثيق الأدوية والجرعات
4. اكتمال الفحوصات
5. منطقية العلاج للتشخيص

**المطلوب - جدول HTML فقط:**
| رقم | المريض | التشخيص | الإجراءات/الأدوية | الترميز | الحالة | المشكلة | التصحيح |

**تصنيف الحالات:**
- 🟢 **مقبول** (class="status-accepted" خلفية #dcfce7)
- 🔴 **مرفوض** (class="status-rejected" خلفية #fee2e2)
- 🟡 **يحتاج تصحيح** (class="status-needs-correction" خلفية #fef9c3)

**ملخص في النهاية:**
إجمالي: X | ✅ مقبول: Y% | ❌ مرفوض: Z% | ⚠️ يحتاج تصحيح: W%

**ابدأ مباشرة بالجدول - لا مقدمات:**
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
