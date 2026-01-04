import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const MEDICAL_AUDIT_PROMPT = `أنت خبير طبي متخصص في مراجعة جودة الرعاية الصحية ومطابقة البروتوكولات الطبية.

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

export async function analyzeMedicalCase(files, lang = 'ar') {
  try {
    const contents = [];
    
    contents.push({
      role: 'user',
      parts: [
        { text: lang === 'ar' ? MEDICAL_AUDIT_PROMPT : MEDICAL_AUDIT_PROMPT.replace(/[\u0600-\u06FF]/g, '') }
      ]
    });

    const imageParts = files.map(file => {
      const base64Data = file.data.replace(/^data:[^;]+;base64,/, '');
      return {
        inlineData: {
          mimeType: file.mimeType || 'image/jpeg',
          data: base64Data
        }
      };
    });

    if (imageParts.length > 0) {
      contents[0].parts.push(...imageParts);
      contents[0].parts.push({ text: '\n\nقم بتحليل الملفات الطبية أعلاه وأعط تقريراً شاملاً بتنسيق HTML.' });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
    });

    let htmlResponse = response.text || '';
    
    if (htmlResponse.includes('```html')) {
      htmlResponse = htmlResponse.replace(/```html\n?/g, '').replace(/```\n?/g, '');
    }

    const styledHtml = wrapWithStyles(htmlResponse);

    return {
      success: true,
      html: styledHtml,
      raw: response.text
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

function wrapWithStyles(html) {
  return `
    <style>
      .audit-report { font-family: 'Tajawal', sans-serif; direction: rtl; }
      .audit-report h1, .audit-report h2, .audit-report h3 { color: #1e3a5f; margin-top: 1.5rem; }
      .audit-report h1 { font-size: 1.8rem; text-align: center; padding-bottom: 1rem; border-bottom: 3px solid #c9a962; }
      .audit-report h2 { font-size: 1.4rem; display: flex; align-items: center; gap: 0.5rem; }
      .audit-report h3 { font-size: 1.1rem; }
      .audit-report p, .audit-report li { line-height: 1.8; color: #334155; }
      .audit-report ul { list-style: none; padding: 0; }
      .audit-report li { padding: 0.5rem 1rem; margin: 0.5rem 0; border-radius: 8px; }
      .audit-report .success, .audit-report li:has(.success), .audit-report li:contains("✅") { background: #dcfce7; border-right: 4px solid #22c55e; }
      .audit-report .error, .audit-report li:has(.error), .audit-report li:contains("❌") { background: #fee2e2; border-right: 4px solid #ef4444; }
      .audit-report .warning, .audit-report li:has(.warning), .audit-report li:contains("⚠️") { background: #fef9c3; border-right: 4px solid #eab308; }
      .audit-report .info, .audit-report li:has(.info), .audit-report li:contains("💡") { background: #dbeafe; border-right: 4px solid #3b82f6; }
      .audit-report table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
      .audit-report th, .audit-report td { padding: 0.75rem; text-align: right; border: 1px solid #e2e8f0; }
      .audit-report th { background: #1e3a5f; color: white; }
      .audit-report tr:nth-child(even) { background: #f8fafc; }
      .audit-report .score-box { text-align: center; padding: 1.5rem; border-radius: 12px; margin: 1rem 0; }
      .audit-report .score-high { background: linear-gradient(135deg, #22c55e, #16a34a); color: white; }
      .audit-report .score-medium { background: linear-gradient(135deg, #eab308, #ca8a04); color: white; }
      .audit-report .score-low { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; }
      .audit-report .score-value { font-size: 3rem; font-weight: bold; }
      .error-box { background: #fee2e2; border: 2px solid #ef4444; padding: 1.5rem; border-radius: 12px; text-align: center; }
      .error-box h3 { color: #dc2626; margin: 0 0 1rem; }
    </style>
    <div class="audit-report">
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
