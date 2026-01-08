// /api/patient-analyzer.js

function detectMimeType(base64Data = "") {
  const signatures = {
    JVBERi0: "application/pdf",
    iVBORw0: "image/png",
    "/9j/4A": "image/jpeg",
    R0lGOD: "image/gif",
    UklGRg: "image/webp",
    AAAAIG: "video/mp4",
    SUQzB: "audio/mpeg",
  };
  for (const [sig, mt] of Object.entries(signatures)) {
    if (base64Data.startsWith(sig)) return mt;
  }
  return "image/jpeg";
}

const reportTemplates = {
  ar: `
  <style>
    .report-container{font-family:'Cairo','Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;line-height:1.75}
    .box-critical{border-right:5px solid #721c24;background:#f8d7da;color:#721c24;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-warning{border-right:5px solid #856404;background:#fff3cd;color:#856404;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-good{border-right:5px solid #155724;background:#d4edda;color:#155724;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-info{border-right:5px solid #004085;background:#cce5ff;color:#004085;padding:1rem;margin:.75rem 0;border-radius:10px}
    .custom-table{border-collapse:collapse;width:100%;text-align:right;margin-top:1rem;box-shadow:0 2px 4px rgba(0,0,0,.06)}
    .custom-table th,.custom-table td{padding:12px;border:1px solid #dee2e6}
    .custom-table thead{background:#e9ecef}
    h3,h4{color:#243143;border-bottom:2px solid #0b63c2;padding-bottom:8px;margin-top:1.6rem}
    .icon{font-size:1.2em;margin-left:.5rem}
  </style>
  <div class="report-container">
    <h3>تقرير تحليل طبي شامل</h3>
    <p class="box-info">بناءً على المعلومات والملفات المرفوعة، أجرينا تحليلًا سريريًا منظّمًا مع مراجعة بصرية عميقة للصور/التقارير.</p>
    <h4>1) ملخص الحالة والتقييم</h4>
    <ul>
      <li><div class="box-good">✅ <strong>الملخص السريري:</strong> [ملخص دقيق].</div></li>
      <li><div class="box-critical">❌ <strong>نقاط حرجة:</strong> [تعارض/نقص حيوي].</div></li>
      <li><div class="box-warning">⚠️ <strong>بيانات ناقصة:</strong> [فحوص ضرورية مفقودة].</div></li>
    </ul>
    <h4>2) التشخيصات المحتملة (حسب الخطورة)</h4>
    <ol>
      <li><div class="box-critical"><strong>يستبعد أولًا:</strong> [تشخيص + تبرير].</div></li>
      <li><div class="box-warning"><strong>تالي محتمل:</strong> [تشخيص + تبرير].</div></li>
      <li><div class="box-good"><strong>أقل خطورة:</strong> [قائمة].</div></li>
    </ol>
    <h4>3) مراجعة الأدوية/الإجراءات والفجوات</h4>
    <h5>أ) الأدوية</h5>
    <table class="custom-table"><thead><tr><th>الدواء</th><th>الجرعة/المدة</th><th>الغرض</th><th>تحليل المخاطر</th></tr></thead>
      <tbody>
        <tr><td>[دواء]</td><td>[جرعة]</td><td>[غرض]</td><td class="box-critical">❌ <strong>خطر عالٍ:</strong> [سبب].</td></tr>
        <tr><td>[دواء]</td><td>[جرعة]</td><td>[غرض]</td><td class="box-warning">⚠️ <strong>بحذر:</strong> [سبب].</td></tr>
      </tbody>
    </table>
    <h5>ب) فجوات واختبارات لازمة</h5>
    <table class="custom-table"><thead><tr><th>المشكلة</th><th>تحليل/إجراء</th><th>سؤال للطبيب</th></tr></thead>
      <tbody>
        <tr><td><strong>مثال: صداع حول العين</strong></td><td class="box-warning">غياب قياس ضغط العين.</td><td>"هل أحتاج قياس ضغط العين بشكل عاجل؟"</td></tr>
        <tr><td><strong>مثال: قسطرة بولية دائمة</strong></td><td class="box-critical">خطر عدوى مزمنة؛ الأفضل القسطرة المتقطعة.</td><td>"هل المتقطعة أنسب لحالتي؟"</td></tr>
      </tbody>
    </table>
    <h4>4) خطة العمل</h4>
    <ul>
      <li><div class="box-critical"><span class="icon">🚨</span><strong>فوري:</strong> [أوقف/توجّه/اتصل…]</div></li>
      <li><div class="box-warning"><span class="icon">⚠️</span><strong>خلال 24 ساعة:</strong> [راجع/احجز…]</div></li>
    </ul>
    <h4>5) أسئلة ذكية</h4>
    <ul class="box-info"><li>[سؤال 1]</li><li>[سؤال 2]</li></ul>
    <h4>6) ملخص عام</h4>
    <p>[أعلى المخاطر + الخطوة التالية].</p>
    <h4>7) إخلاء مسؤولية</h4>
    <div class="box-warning"><strong>هذا التحليل للتوعية فقط ولا يغني عن الفحص السريري واستشارة طبيب مؤهل.</strong></div>
  </div>
  `,
  en: `
  <style>
    .report-container{font-family:Arial,system-ui,sans-serif;direction:ltr;line-height:1.75}
    .box-critical{border-left:5px solid #721c24;background:#f8d7da;color:#721c24;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-warning{border-left:5px solid #856404;background:#fff3cd;color:#856404;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-good{border-left:5px solid #155724;background:#d4edda;color:#155724;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-info{border-left:5px solid #004085;background:#cce5ff;color:#004085;padding:1rem;margin:.75rem 0;border-radius:10px}
    .custom-table{border-collapse:collapse;width:100%;text-align:left;margin-top:1rem;box-shadow:0 2px 4px rgba(0,0,0,.06)}
    .custom-table th,.custom-table td{padding:12px;border:1px solid #dee2e6}
    .custom-table thead{background:#e9ecef}
    h3,h4{color:#243143;border-bottom:2px solid #0b63c2;padding-bottom:8px;margin-top:1.6rem}
    .icon{font-size:1.2em;margin-right:.5rem}
  </style>
  <div class="report-container">
    <h3>Comprehensive Medical Analysis Report</h3>
    <p class="box-info">Based on the provided information and files, we performed a structured clinical review with in‑depth visual analysis of radiology/images.</p>
    <h4>1) Case summary & assessment</h4>
    <ul>
      <li><div class="box-good">✅ <strong>Clinical summary:</strong> [Concise summary].</div></li>
      <li><div class="box-critical">❌ <strong>Critical issues:</strong> [Conflicts / vital omissions].</div></li>
      <li><div class="box-warning">⚠️ <strong>Missing data:</strong> [Essential tests not done].</div></li>
    </ul>
    <h4>2) Differential diagnoses (by severity)</h4>
    <ol>
      <li><div class="box-critical"><strong>Must rule out first:</strong> [Dx + rationale].</div></li>
      <li><div class="box-warning"><strong>Next likely:</strong> [Dx + rationale].</div></li>
      <li><div class="box-good"><strong>Lower‑risk options:</strong> [List].</div></li>
    </ol>
    <h4>3) Medication / procedures / gaps</h4>
    <h5>A) Medication audit</h5>
    <table class="custom-table"><thead><tr><th>Drug</th><th>Dosage/Duration</th><th>Indication</th><th>Risk analysis</th></tr></thead>
      <tbody>
        <tr><td>[Med]</td><td>[Dose]</td><td>[Use]</td><td class="box-critical">❌ <strong>High risk:</strong> [Why].</td></tr>
        <tr><td>[Med]</td><td>[Dose]</td><td>[Use]</td><td class="box-warning">⚠️ <strong>Caution:</strong> [Why].</td></tr>
      </tbody>
    </table>
    <h5>B) Errors / diagnostic gaps</h5>
    <table class="custom-table"><thead><tr><th>Issue</th><th>Analysis & action</th><th>Ask your doctor</th></tr></thead>
      <tbody>
        <tr><td><strong>Example: Peri‑orbital headache</strong></td><td class="box-warning">No intraocular pressure measurement.</td><td>"Do I need urgent IOP testing?"</td></tr>
        <tr><td><strong>Example: Chronic indwelling catheter</strong></td><td class="box-critical">Consider intermittent catheterization.</td><td>"Is intermittent catheterization safer for me?"</td></tr>
      </tbody>
    </table>
    <h4>4) Action plan</h4>
    <ul>
      <li><div class="box-critical"><span class="icon">🚨</span><strong>Immediate:</strong> [Stop/ER/etc.].</div></li>
      <li><div class="box-warning"><span class="icon">⚠️</span><strong>Next 24h:</strong> [Book/monitor/etc.].</div></li>
    </ul>
    <h4>5) Smart questions</h4>
    <ul class="box-info"><li>[Q1]</li><li>[Q2]</li></ul>
    <h4>6) Overall summary</h4>
    <p>[Top risk + next step].</p>
    <h4>7) Disclaimer</h4>
    <div class="box-warning"><strong>This is a health‑awareness tool and not a medical diagnosis; always consult your physician.</strong></div>
  </div>
  `,
};

function buildUserPrompt(body) {
  const L = body.uiLang === "en" ? "en" : "ar";
  const lines = [];
  const push = (k, v) => {
    if (v !== undefined && v !== null && `${v}`.trim() !== "") lines.push(`- ${k}: ${v}`);
  };

  push(L==="ar"?"العمر":"Age", body.age);
  push(L==="ar"?"الجنس":"Gender", body.gender);
  if (body.gender === "female") {
    push(L==="ar"?"حامل؟":"Pregnant?", body.pregnancyStatus);
    if (body.pregnancyStatus === "yes") push(L==="ar"?"شهر الحمل":"Pregnancy month", body.pregnancyMonth);
  }

  push(L==="ar"?"أعراض بصرية":"Visual symptoms", body.visualSymptoms);
  if (body.visualSymptoms === true || body.visualSymptoms === "yes") {
    push(L==="ar"?"حدة البصر":"Visual acuity", body.visualAcuity);
    push(L==="ar"?"آخر فحص عين":"Last eye exam date", body.lastEyeExamDate);
  }

  push(L==="ar"?"مدخّن":"Smoker", body.isSmoker);
  if (body.isSmoker === true || body.isSmoker === "yes") push(L==="ar"?"سنوات التدخين":"Smoking years", body.smokingYears);
  push(L==="ar"?"سعال":"Cough", body.hasCough);
  if (body.hasCough === true || body.hasCough === "yes") {
    push(L==="ar"?"دم في السعال":"Hemoptysis", body.coughBlood);
    push(L==="ar"?"بلغم أصفر":"Yellow sputum", body.coughYellowSputum);
    push(L==="ar"?"سعال جاف":"Dry cough", body.coughDry);
  }

  push(L==="ar"?"الأعراض":"Symptoms", body.symptoms);
  push(L==="ar"?"التاريخ المرضي":"Medical history", body.history);
  push(L==="ar"?"تشخيصات سابقة":"Previous diagnoses", body.diagnosis);
  push(L==="ar"?"الأدوية الحالية":"Current medications", body.medications);
  push(L==="ar"?"تحاليل/أشعة":"Labs/Imaging", body.labs);

  const files = Array.isArray(body.files) ? body.files : [];
  const filesLine = files.length
    ? (L==="ar"
        ? `يوجد ${files.length} ملف/صورة مرفوعة للتحليل. **اعتبر الصور المصدر الأساسي للحقيقة وحلّل الأشعة بعمق مع ذكر النتائج.**`
        : `There are ${files.length} uploaded file(s). **Treat images as the primary source of truth; analyze radiology deeply and list findings.**`)
    : (L==="ar" ? "لا يوجد ملفات مرفوعة." : "No files uploaded.");

  const header = L==="ar"
    ? "### بيانات الحالة لتوليد التقرير وفق القالب:"
    : "### Case data to generate the report using the supplied template:";

  return `${header}\n${lines.join("\n")}\n\n${filesLine}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: "Patient data required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "System configuration error: missing GEMINI_API_KEY" });
    }

    const language = req.body.uiLang === "en" ? "en" : "ar";
    const systemTemplate = reportTemplates[language];

    const userParts = [{ text: buildUserPrompt(req.body) }];

    const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
    const addInline = (base64, mime) => userParts.push({ inline_data: { mime_type: mime, data: base64 } });
    const addText = (text, name) => userParts.push({ text: `--- محتوى الملف: ${name} ---\n${text}` });

    if (Array.isArray(req.body.files)) {
      for (const f of req.body.files) {
        const content = f.base64 || f.textContent || '';
        if (!content) continue;
        
        const mimeType = f.type || 'text/plain';
        const isTextType = mimeType.startsWith('text/') || mimeType === 'application/json';
        const isValidBase64 = /^[A-Za-z0-9+/]+=*$/.test(content.replace(/\s/g, '').substring(0, 100));
        
        if (isTextType || !isValidBase64) {
          addText(content, f.name || 'file');
        } else {
          const sizeInBytes = Math.floor((content.length * 3) / 4);
          if (sizeInBytes > MAX_IMAGE_SIZE) {
            return res.status(413).json({
              error: language === "ar" ? `حجم الملف "${f.name || "image"}" يتجاوز 4MB` : `File "${f.name || "image"}" exceeds 4MB`,
            });
          }
          addInline(content, mimeType);
        }
      }
    }

    // Enhanced prompt for insurance audit reports - matching Report #20 format exactly
    const insuranceAuditPrompt = language === "ar" 
      ? `أنت مدقق تأميني طبي. حلل كل حالة/زيارة في البيانات المرفقة بشكل منفصل ومفصل.

**التنسيق الإلزامي لكل حالة (يجب اتباعه حرفياً):**

<div class="case-section" data-case-id="[رقم]">
  <h3>🔍 الحالة رقم [N] | Claim Se No.: [رقم الملف] | المريض: [رقم المريض]</h3>
  
  <h4>📌 بيانات الحالة</h4>
  <table class="custom-table">
    <tr><td>التشخيص:</td><td>[أكواد ICD مع الوصف]</td></tr>
    <tr><td>درجة الحرارة:</td><td>[القيمة أو "غير متوفر" مع ⚠️]</td></tr>
    <tr><td>ضغط الدم:</td><td>[القيمة]</td></tr>
    <tr><td>الطول:</td><td>[القيمة أو "غير متوفر" مع ⚠️]</td></tr>
    <tr><td>الوزن:</td><td>[القيمة]</td></tr>
    <tr><td>النبض:</td><td>[القيمة أو "غير متوفر" مع ⚠️]</td></tr>
  </table>

  <h4>💊 الأدوية</h4>
  <table class="custom-table">
    <thead><tr><th>الدواء</th><th>الجرعة</th><th>التقييم</th><th>الحالة</th></tr></thead>
    <tbody>
      <tr>
        <td>[اسم الدواء]</td>
        <td>[الجرعة]</td>
        <td>[تحليل مفصل: هل يتوافق مع التشخيص؟ هل درجة الحرارة تبرره؟ هل توجد موانع؟]</td>
        <td data-insurance-rating="approved">✅ مقبول</td>
        <!-- أو -->
        <td data-insurance-rating="rejected">❌ مرفوض</td>
        <!-- أو -->
        <td data-insurance-rating="review">⚠️ يحتاج توثيق</td>
      </tr>
    </tbody>
  </table>

  <h4>🔬 التحاليل والإجراءات</h4>
  <table class="custom-table">
    <thead><tr><th>الإجراء</th><th>التقييم</th><th>الحالة</th></tr></thead>
    <tbody>
      <tr>
        <td>[اسم التحليل/الإجراء]</td>
        <td>[هل يتوافق مع التشخيص؟ التبرير]</td>
        <td data-insurance-rating="...">✅/❌/⚠️</td>
      </tr>
    </tbody>
  </table>

  <h4>❌ إجراءات مرفوضة</h4>
  <div class="box-critical">
    <strong>[اسم الدواء/الإجراء]</strong><br>
    ⚠️ [السبب التفصيلي للرفض]<br>
    📌 اقتراحات التبرير المقبولة: [عدم تحمل الفم، حالة حادة، حمى...]<br>
    ❗ عدم التوثيق = رفض التأمين
  </div>

  <h4>⚠️ إجراءات تحتاج توثيق</h4>
  <div class="box-warning">
    <strong>[اسم الإجراء]</strong><br>
    ⚠️ يحتاج توثيق المبرر الإكلينيكي<br>
    📌 اقتراحات: [...]<br>
    ❗ عدم التوثيق = رفض التأمين
  </div>

  <h4>📊 ملخص الحالة</h4>
  <table class="custom-table">
    <tr>
      <td><strong>✅ صحيح</strong></td>
      <td>[قائمة الأدوية/الإجراءات المقبولة]</td>
    </tr>
    <tr>
      <td><strong>❌ يحتاج تصحيح</strong></td>
      <td>[قائمة المرفوض أو يحتاج توثيق]</td>
    </tr>
  </table>
</div>

<hr style="border: 2px solid #1e3a5f; margin: 2rem 0;">

**قواعد التقييم:**
- ✅ مقبول: الدواء/الإجراء يتوافق تماماً مع التشخيص والعلامات الحيوية
- ❌ مرفوض: لا يوجد مبرر طبي (مثلاً: باراسيتامول وريدي مع حرارة طبيعية 36.1)
- ⚠️ يحتاج توثيق: قد يكون مبرراً لكن يحتاج توثيق في الملف (مثلاً: سوائل وريدية بدون توثيق عدم تحمل الفم)

**مهم جداً:**
- حلل كل حالة على حدة بنفس التنسيق أعلاه
- لا تختصر أبداً - كل دواء وإجراء يحتاج تقييم منفصل
- قارن دائماً بين التشخيص والعلامات الحيوية والأدوية الموصوفة
- أعد HTML كامل بالعربية`
      : `You are a medical insurance auditor. Analyze each case/visit in the provided data separately and in detail.

**Mandatory format for each case (follow exactly):**

<div class="case-section" data-case-id="[number]">
  <h3>🔍 Case #[N] | Claim Se No.: [file number] | Patient: [patient number]</h3>
  
  <h4>📌 Case Data</h4>
  <table class="custom-table">
    <tr><td>Diagnosis:</td><td>[ICD codes with description]</td></tr>
    <tr><td>Temperature:</td><td>[value or "N/A" with ⚠️]</td></tr>
    <tr><td>Blood Pressure:</td><td>[value]</td></tr>
    <tr><td>Height:</td><td>[value or "N/A" with ⚠️]</td></tr>
    <tr><td>Weight:</td><td>[value]</td></tr>
    <tr><td>Pulse:</td><td>[value or "N/A" with ⚠️]</td></tr>
  </table>

  <h4>💊 Medications</h4>
  <table class="custom-table">
    <thead><tr><th>Medication</th><th>Dosage</th><th>Assessment</th><th>Status</th></tr></thead>
    <tbody>
      <tr>
        <td>[medication name]</td>
        <td>[dosage]</td>
        <td>[detailed analysis: compatible with diagnosis? justified by vitals? contraindications?]</td>
        <td data-insurance-rating="approved">✅ Approved</td>
        <!-- or -->
        <td data-insurance-rating="rejected">❌ Rejected</td>
        <!-- or -->
        <td data-insurance-rating="review">⚠️ Needs Documentation</td>
      </tr>
    </tbody>
  </table>

  <h4>🔬 Tests & Procedures</h4>
  <table class="custom-table">
    <thead><tr><th>Procedure</th><th>Assessment</th><th>Status</th></tr></thead>
    <tbody>
      <tr>
        <td>[test/procedure name]</td>
        <td>[compatible with diagnosis? justification]</td>
        <td data-insurance-rating="...">✅/❌/⚠️</td>
      </tr>
    </tbody>
  </table>

  <h4>❌ Rejected Items</h4>
  <div class="box-critical">
    <strong>[medication/procedure name]</strong><br>
    ⚠️ [detailed rejection reason]<br>
    📌 Acceptable justifications: [oral intolerance, acute condition, fever...]<br>
    ❗ No documentation = Insurance rejection
  </div>

  <h4>⚠️ Items Needing Documentation</h4>
  <div class="box-warning">
    <strong>[procedure name]</strong><br>
    ⚠️ Needs clinical justification documentation<br>
    📌 Suggestions: [...]<br>
    ❗ No documentation = Insurance rejection
  </div>

  <h4>📊 Case Summary</h4>
  <table class="custom-table">
    <tr>
      <td><strong>✅ Correct</strong></td>
      <td>[list of approved medications/procedures]</td>
    </tr>
    <tr>
      <td><strong>❌ Needs Correction</strong></td>
      <td>[list of rejected or needs documentation]</td>
    </tr>
  </table>
</div>

<hr style="border: 2px solid #1e3a5f; margin: 2rem 0;">

**Evaluation Rules:**
- ✅ Approved: Medication/procedure fully compatible with diagnosis and vital signs
- ❌ Rejected: No medical justification (e.g., IV paracetamol with normal temp 36.1)
- ⚠️ Needs Documentation: May be justified but needs file documentation (e.g., IV fluids without documenting oral intolerance)

**Very Important:**
- Analyze each case separately with the same format above
- NEVER summarize - each medication and procedure needs separate evaluation
- Always compare diagnosis, vital signs, and prescribed medications
- Return complete HTML in English`;

    userParts.push({ text: insuranceAuditPrompt });

    const payload = {
      system_instruction: { role: "system", parts: [{ text: systemTemplate }] },
      contents: [{ role: "user", parts: userParts }],
      generation_config: { temperature: 0.2, top_p: 0.95, top_k: 40, max_output_tokens: 16384 },
    };

    const model = "gemini-2.0-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let msg = await response.text();
      try { const j = JSON.parse(msg); msg = j.error?.message || msg; } catch {}
      throw new Error(msg || `API request failed (${response.status})`);
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || "";
    if (!text) throw new Error("Failed to generate report text from the model.");

    return res.status(200).json({ htmlReport: text });
  } catch (err) {
    console.error("patient-analyzer error:", err);
    return res.status(500).json({ error: "Server error during case analysis", detail: err.message });
  }
}
