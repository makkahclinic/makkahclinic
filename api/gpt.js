// /api/gpt.js
export default async function handler(req, res) {
  // ... (الكود السابق للتعامل مع CORS وOPTIONS)
  
  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
  
  const requestBody = req.body;
  
  // --- PROMPT محسن لتحليل استشاري عميق ---
  const htmlPrompt = `
    أنت "خبير طبي وصيدلي إكلينيكي ومحلل تأمين طبي" مهمتك تحليل البيانات الطبية المقدمة بدقة وعمق.
    **البيانات لتحليلها:**
    - **التشخيص:** ${requestBody.diagnosis || "غير محدد"}
    - **الأعراض:** ${requestBody.symptoms || "غير محددة"}
    - **العمر:** ${requestBody.age || "غير محدد"}
    - **الجنس:** ${requestBody.gender || "غير محدد"}
    - **مدخن:** ${requestBody.smoker ? 'نعم' : 'لا'}
    - **الإجراءات قبل التشخيص:** ${requestBody.beforeProcedure || "غير محددة"}
    - **الإجراءات بعد التشخيص:** ${requestBody.afterProcedure || "غير محددة"}
    ${requestBody.imageData ? '- **تم رفع صورة للمطالبة**' : ''}

    ---
    **تعليمات التحليل:**
    1. حلل كل إجراء طبي ودواء من حيث:
        - المبرر العلمي والطبي
        - مدى توافقه مع البروتوكولات الطبية
        - التفاعلات الدوائية المحتملة
        - الجرعات المناسبة للعمر والجنس
    2. قيم المخاطر واحتمالية الرفض من التأمين:
        - صنف المخاطر إلى: عالية (🔴)، متوسطة (🟡)، منخفضة (🟢)
        - حدد قيمة كل بند معرض للرفض
        - اذكر الأسباب العلمية والتأمينية للرفض
    3. اقترح تحسينات لزيادة قيمة الفاتورة:
        - إجراءات إضافية مبررة علمياً
        - أدوية بديلة أكثر فعالية
        - فحوصات مكملة ضرورية
    4. قدم ملخصاً مالياً:
        - إجمالي الفاتورة الحالية
        - الخصومات المحتملة
        - القيمة القابلة للإضافة
        - إجمالي الفاتورة بعد التحسين

    ---
    **هيكل التقرير المطلوب (HTML فقط):**
    <div class="report-container">
      <h3>تقرير تحليلي متكامل</h3>
      
      <div class="section analysis-summary">
        <h4>الملخص التنفيذي</h4>
        <p>[ملخص عام للحالة مع تقييم المخاطر الرئيسية]</p>
      </div>
      
      <div class="section medical-analysis">
        <h4>تحليل طبي وصيدلاني متعمق</h4>
        <!-- لكل دواء/إجراء -->
        <div class="med-item risk-high">
          <h5>🔴 دواء: [اسم الدواء] - جرعة: [الجرعة]</h5>
          <p><strong>التحليل:</strong> [التفاصيل الفنية والتحذيرات]</p>
          <p><strong>التوصيات:</strong> [اقتراحات للتحسين]</p>
        </div>
        
        <div class="med-item risk-medium">
          <h5>🟡 إجراء: [اسم الإجراء]</h5>
          <p><strong>التحليل:</strong> [التقييم الطبي]</p>
          <p><strong>التوصيات:</strong> [اقتراحات للتوثيق]</p>
        </div>
      </div>
      
      <div class="section insurance-risk">
        <h4>تقييم مخاطر التأمين</h4>
        <table>
          <tr><th>البند</th><th>القيمة</th><th>مستوى الخطورة</th><th>سبب الرفض المحتمل</th></tr>
          <tr><td>[اسم الدواء/الإجراء]</td><td>[القيمة]</td><td>🔴</td><td>[السبب العلمي]</td></tr>
        </table>
      </div>
      
      <div class="section financial-optimization">
        <h4>تحسين القيمة المالية</h4>
        <ul>
          <li>إضافة [فحص/إجراء] - [القيمة] - [المبرر الطبي]</li>
          <li>استبدال [الدواء] بـ [الدواء البديل] - [الفرق في القيمة]</li>
        </ul>
      </div>
      
      <div class="section final-summary">
        <h4>الملخص المالي</h4>
        <table>
          <tr><th>البند</th><th>القيمة (ريال سعودي)</th></tr>
          <tr><td>الإجمالي الحالي</td><td>[القيمة]</td></tr>
          <tr><td>الخصومات المحتملة</td><td>[القيمة]</td></tr>
          <tr><td>القيمة القابلة للإضافة</td><td>[القيمة]</td></tr>
          <tr><td><strong>الإجمالي بعد التحسين</strong></td><td><strong>[القيمة]</strong></td></tr>
        </table>
      </div>
    </div>
  `;

  // ... (الكود السابق لإعداد payload وإرسال الطلب)
}
