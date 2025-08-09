// /api/patient-analyzer.js

// دالة مساعدة لاكتشاف نوع الملف من بيانات base64
function detectMimeType(base64Data) {
  const signatures = {
    'JVBERi0': 'application/pdf',
    'iVBORw0': 'image/png',
    '/9j/4A': 'image/jpeg',
    'R0lGOD': 'image/gif',
    'UklGRg': 'image/webp',
    'AAAAIG': 'video/mp4',
    'SUQzB': 'audio/mpeg'
  };
  
  for (const [signature, mimeType] of Object.entries(signatures)) {
    if (base64Data.startsWith(signature)) {
      return mimeType;
    }
  }
  
  return 'image/jpeg';
}

// قوالب التقرير متعددة اللغات
const reportTemplates = {
  ar: `
  <style>
  /* CSS Styles for Professional Report Formatting */
  .report-container { font-family: 'Cairo', 'Arial', sans-serif; direction: rtl; }
  /* ... (نفس أنماط CSS السابقة) ... */
  </style>
  
  <div class="report-container">
  <h3>تحليل شامل من فريقنا الاستشاري الطبي</h3>
  <p class="box-info">بناءً على المعلومات المقدمة، قام فريقنا المكون من استشاريين متخصصين في التشخيص السريري والصيدلة الإكلينيكية بتحليل حالتك لتقديم رؤية شاملة ومتكاملة.</p>
  <!-- ... (نفس محتوى التقرير العربي السابق) ... -->
  </div>
  `,
  
  en: `
  <style>
  /* CSS Styles for Professional Report Formatting */
  .report-container { font-family: 'Arial', sans-serif; direction: ltr; }
  .box-critical { border-left: 5px solid #721c24; background-color: #f8d7da; color: #721c24; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
  .box-warning { border-left: 5px solid #856404; background-color: #fff3cd; color: #856404; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
  .box-good { border-left: 5px solid #155724; background-color: #d4edda; color: #155724; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
  .box-info { border-left: 5px solid #004085; background-color: #cce5ff; color: #004085; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
  .custom-table { border-collapse: collapse; width: 100%; text-align: left; margin-top: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
  .custom-table th, .custom-table td { padding: 12px; border: 1px solid #dee2e6; }
  .custom-table thead { background-color: #e9ecef; }
  h3, h4 { color: #343a40; border-bottom: 2px solid #0056b3; padding-bottom: 8px; margin-top: 2rem; }
  .icon { font-size: 1.2em; margin-left: 8px; }
  </style>
  
  <div class="report-container">
  <h3>Comprehensive Medical Analysis Report</h3>
  <p class="box-info">Based on the information provided, our team of clinical diagnostic and clinical pharmacy specialists has analyzed your case to provide a comprehensive and integrated perspective.</p>
  
  <h4>1. Case Summary and Assessment</h4>
  <ul>
      <li><div class='box-good'>✅ <strong>Clinical Summary:</strong> [Accurate case summary here].</div></li>
      <li><div class='box-critical'>❌ <strong>Critical Issues:</strong> [Mention any data conflicts like age, or vital information such as pregnancy not considered].</div></li>
      <li><div class='box-warning'>⚠️ <strong>Missing Data:</strong> [Mention any essential missing tests for diagnosis, e.g., intraocular pressure measurement for headaches].</div></li>
  </ul>
  
  <h4>2. Potential Diagnoses (Ordered by Severity)</h4>
  <ol>
      <li><div class='box-critical'><strong>Most Critical Diagnosis (Must be ruled out first):</strong> [Diagnosis with justification, e.g., Preeclampsia due to headache and high blood pressure in an old prescription for a pregnant woman].</div></li>
      <li><div class='box-warning'><strong>Next Probable Diagnosis:</strong> [Second diagnosis with justification].</div></li>
      <li><div class='box-good'><strong>Other Less Severe Diagnoses:</strong> [Other diagnoses].</div></li>
  </ol>
  
  <h4>3. Medication, Procedures, and Error Analysis</h4>
  <p>A comprehensive audit of mentioned medications and diagnostic procedures was conducted to detect any risks or therapeutic gaps.</p>
  
  <h5>A) Medication Audit</h5>
  <p>All medications must be extracted from images and texts and analyzed according to the mandatory checklist.</p>
  <table class='custom-table'>
      <thead>
          <tr><th>Medication Name</th><th>Dosage & Duration</th><th>Medical Purpose</th><th>In-depth Analysis & Risk Points (Very Important)</th></tr>
      </thead>
      <tbody>
          <tr>
              <td>[Medication name]</td>
              <td>[Dosage]</td>
              <td>[Purpose]</td>
              <td class='box-critical'>❌ <strong>High Risk:</strong> [Analysis: Completely contraindicated during pregnancy / overdose / dangerous therapeutic duplication].</td>
          </tr>
          <tr>
              <td>[Medication name]</td>
              <td>[Dosage]</td>
              <td>[Purpose]</td>
              <td class='box-warning'>⚠️ <strong>Requires Caution:</strong> [Analysis: Contradicted with kidney condition / not preferred for elderly / requires monitoring].</td>
          </tr>
      </tbody>
  </table>
  
  <h5>B) Procedure Errors and Diagnostic Gaps</h5>
  <p>Identifies any incorrect medical procedures or essential tests not performed.</p>
  <table class='custom-table'>
      <thead>
          <tr><th>Problem / Identified Gap</th><th>Analysis & Recommended Action</th><th>What to Ask Your Doctor</th></tr>
      </thead>
      <tbody>
          <tr>
              <td><strong>[Example: Patient with severe eye-area headache]</strong></td>
              <td class='box-warning'>Intraocular pressure measurement not mentioned, which is essential to rule out emergencies like glaucoma.</td>
              <td>"Do I need urgent intraocular pressure measurement to confirm this headache isn't caused by a serious eye condition?"</td>
          </tr>
          <tr>
              <td><strong>[Example: Permanent urinary catheter with recurrent infections]</strong></td>
              <td class='box-critical'>Permanent catheter use is causing chronic infection and is considered suboptimal practice. Should switch to intermittent catheterization.</td>
              <td>"Is intermittent catheterization a better and safer option for my condition?"</td>
          </tr>
      </tbody>
  </table>
  
  <h4>4. Proposed Action Plan</h4>
  <ul>
      <li><div class='box-critical'><span class="icon">🚨</span><strong>Urgent Immediate Action:</strong> [Most urgent action, e.g., Immediately stop taking the following medications and go to ER].</div></li>
      <li><div class='box-warning'><span class="icon">⚠️</span><strong>Important Action (within 24 hours):</strong> [Next important action, e.g., Schedule appointment to discuss treatment plan].</div></li>
  </ul>
  
  <h4>5. Smart Questions to Discuss with Your Doctor</h4>
  <ul class="box-info">
      <li>[Smart question based on identified errors]</li>
      <li>[Another question about safer alternatives]</li>
  </ul>
  
  <h4>6. Overall Report Summary</h4>
  <p>[Final summary focusing on the highest risk and next critical step].</p>
  
  <h4>7. Important Disclaimer</h4>
  <div class="box-warning">
      <p><strong>This analysis is a health awareness tool only. It does not represent a final medical diagnosis and never replaces clinical examination and direct consultation with a qualified human physician.</strong> Treatment decisions must always be made in full consultation with your treating physician.</p>
  </div>
  </div>
  `
};

function buildUserPrompt(caseData) {
  const language = caseData.language || 'ar';
  
  const templates = {
    ar: `
    **الملفات المرفوعة:**
    - ${caseData.imageData && caseData.imageData.length > 0 
        ? `يوجد ${caseData.imageData.length} صورة(صور) مرفقة للتحليل. **هذه هي المصدر الأساسي والوحيد للحقيقة.**` 
        : "لا يوجد صور مرفقة."}
    
    **بيانات المريض (إن وجدت كنص):**
    - الأعراض: ${caseData.symptoms || 'غير محدد'}
    - التاريخ المرضي: ${caseData.history || 'غير محدد'}
    - الأدوية الحالية: ${caseData.medications || 'غير محدد'}
    
    **ملاحظة:** يمكنك استخدام أي مصطلحات طبية بالعربية أو الإنجليزية، سأفهمها وأقدم التقرير باللغة المطلوبة.
    `,
    
    en: `
    **Uploaded Files:**
    - ${caseData.imageData && caseData.imageData.length > 0 
        ? `There ${caseData.imageData.length === 1 ? 'is 1 image' : `are ${caseData.imageData.length} images`} attached for analysis. **These are the primary and sole source of truth.**` 
        : "No images attached."}
    
    **Patient Data (if provided as text):**
    - Symptoms: ${caseData.symptoms || 'Not specified'}
    - Medical History: ${caseData.history || 'Not specified'}
    - Current Medications: ${caseData.medications || 'Not specified'}
    
    **Note:** You can use medical terms in Arabic or English. I will understand them and provide the report in the requested language.
    `
  };
  
  return templates[language] || templates.ar;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'Patient data required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "System configuration error" });
    }
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
    
    // تحديد لغة التقرير (افتراضي عربي)
    const language = req.body.language || 'ar';
    const systemInstruction = reportTemplates[language] || reportTemplates.ar;
    
    const userPrompt = buildUserPrompt({...req.body, language});
    const parts = [{ text: systemInstruction }, { text: userPrompt }];

    const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB

    if (req.body.imageData && Array.isArray(req.body.imageData)) {
      for (const img of req.body.imageData) {
        if (!img.data) continue;

        // حساب حجم الصورة (تقريبي)
        const sizeInBytes = (img.data.length * 3) / 4;
        if (sizeInBytes > MAX_IMAGE_SIZE) {
          return res.status(400).json({ 
            error: language === 'ar' 
              ? `حجم الصورة يتجاوز الحد المسموح (4MB)` 
              : `Image size exceeds allowed limit (4MB)`
          });
        }

        const mimeType = img.mimeType || detectMimeType(img.data);
        parts.push({ inline_data: { mimeType, data: img.data } });
      }
    }

    // إضافة تعليمات إضافية للغة
    const languageInstruction = {
      text: language === 'ar' 
        ? "يرجى تقديم التقرير باللغة العربية فقط، مع الحفاظ على الهيكل المحدد في التعليمات."
        : "Please provide the report in English only, while maintaining the structure specified in the instructions."
    };
    parts.push(languageInstruction);

    const payload = {
      contents: [{ role: "user", parts: parts }],
      generationConfig: { 
        temperature: 0.2, 
        topP: 0.95, 
        topK: 40,
        maxOutputTokens: 4096
      },
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.json();
      throw new Error(errorBody.error?.message || `API request failed: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error("Failed to generate report");
    }

    const reportHtml = result.candidates[0].content.parts[0].text;
    
    return res.status(200).json({ htmlReport: reportHtml });

  } catch (err) {
    return res.status(500).json({
      error: "Server error during case analysis",
      detail: err.message
    });
  }
}
