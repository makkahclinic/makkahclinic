// /api/patient-analyzer.js

// ــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ
// أدوات مساعدة
// ــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ

// اكتشاف نوع الملف من base64
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
  return "image/jpeg"; // افتراضي
}

// قوالب التقرير (يحافظ على الألوان والعرض)
const reportTemplates = {
  ar: `
  <style>
    .report-container { font-family: 'Cairo','Segoe UI',Tahoma,Arial,sans-serif; direction: rtl; line-height:1.75 }
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
    <p class="box-info">بناءً على المعلومات والملفات المرفوعة، أجرى فريقنا تحليلًا سريريًا منظّمًا للحالة مع مراجعة الصور (أشعة/صور تقارير) بدقّة.</p>

    <h4>1) ملخص الحالة والتقييم</h4>
    <ul>
      <li><div class="box-good">✅ <strong>الملخص السريري:</strong> [ملخص دقيق للحالة].</div></li>
      <li><div class="box-critical">❌ <strong>نقاط حرجة:</strong> [تعارض بيانات/معلومة حيوية مفقودة].</div></li>
      <li><div class="box-warning">⚠️ <strong>بيانات ناقصة:</strong> [فحوص ضرورية مفقودة].</div></li>
    </ul>

    <h4>2) التشخيصات المحتملة (مرتبة حسب الخطورة)</h4>
    <ol>
      <li><div class="box-critical"><strong>الأكثر خطورة ويجب استبعاده أولًا:</strong> [تشخيص + تبرير].</div></li>
      <li><div class="box-warning"><strong>تشخيص محتمل تالي:</strong> [تشخيص + تبرير].</div></li>
      <li><div class="box-good"><strong>تشخيصات أقل خطورة:</strong> [قائمة مختصرة].</div></li>
    </ol>

    <h4>3) مراجعة الأدوية والإجراءات والفجوات</h4>
    <h5>أ) مراجعة الأدوية</h5>
    <table class="custom-table">
      <thead><tr><th>اسم الدواء</th><th>الجرعة/المدة</th><th>الغرض</th><th>تحليل المخاطر</th></tr></thead>
      <tbody>
        <tr><td>[دواء]</td><td>[جرعة]</td><td>[غرض]</td><td class="box-critical">❌ <strong>خطر عالٍ:</strong> [سبب].</td></tr>
        <tr><td>[دواء]</td><td>[جرعة]</td><td>[غرض]</td><td class="box-warning">⚠️ <strong>بحذر:</strong> [سبب].</td></tr>
      </tbody>
    </table>

    <h5>ب) أخطاء الإجراءات/الفجوات التشخيصية</h5>
    <table class="custom-table">
      <thead><tr><th>المشكلة</th><th>التحليل والإجراء المقترح</th><th>سؤال للطبيب</th></tr></thead>
      <tbody>
        <tr><td><strong>مثال: صداع حول العين</strong></td><td class="box-warning">غياب قياس ضغط العين لاستبعاد الزرق الحاد.</td><td>"هل أحتاج قياس ضغط العين بشكل عاجل؟"</td></tr>
        <tr><td><strong>مثال: قسطرة بولية دائمة</strong></td><td class="box-critical">ترفع خطر العدوى المزمنة؛ الأفضل التحويل لقسطرة متقطعة.</td><td>"هل القسطرة المتقطعة أنسب لحالتي؟"</td></tr>
      </tbody>
    </table>

    <h4>4) خطة العمل</h4>
    <ul>
      <li><div class="box-critical"><span class="icon">🚨</span><strong>إجراء فوري:</strong> [أوقف/توجّه/اتصل…].</div></li>
      <li><div class="box-warning"><span class="icon">⚠️</span><strong>خلال 24 ساعة:</strong> [موعد/مراجعة].</div></li>
    </ul>

    <h4>5) أسئلة ذكية لطبيبك</h4>
    <ul class="box-info"><li>[سؤال 1]</li><li>[سؤال 2]</li></ul>

    <h4>6) ملخص عام</h4>
    <p>[أعلى المخاطر + الخطوة التالية].</p>

    <h4>7) إخلاء مسؤولية</h4>
    <div class="box-warning"><strong>هذا التحليل للتوعية فقط ولا يغني عن الفحص السريري واستشارة طبيب مؤهل.</strong></div>
  </div>
  `,
  en: `
  <style>
    .report-container { font-family: Arial, system-ui, sans-serif; direction: ltr; line-height:1.75 }
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
    <p class="box-info">Based on the provided information and uploaded files, we performed a structured clinical review, including in‑depth image (radiograph/report) analysis.</p>

    <h4>1) Case Summary & Assessment</h4>
    <ul>
      <li><div class="box-good">✅ <strong>Clinical summary:</strong> [Concise summary].</div></li>
      <li><div class="box-critical">❌ <strong>Critical issues:</strong> [Conflicts / vital omissions].</div></li>
      <li><div class="box-warning">⚠️ <strong>Missing data:</strong> [Essential tests not done].</div></li>
    </ul>

    <h4>2) Differential diagnoses (by severity)</h4>
    <ol>
      <li><div class="box-critical"><strong>Must‑rule‑out first:</strong> [Dx + rationale].</div></li>
      <li><div class="box-warning"><strong>Next likely:</strong> [Dx + rationale].</div></li>
      <li><div class="box-good"><strong>Lower‑risk options:</strong> [List].</div></li>
    </ol>

    <h4>3) Medication / procedures / gaps</h4>
    <h5>A) Medication audit</h5>
    <table class="custom-table">
      <thead><tr><th>Drug</th><th>Dosage/Duration</th><th>Indication</th><th>Risk analysis</th></tr></thead>
      <tbody>
        <tr><td>[Med]</td><td>[Dose]</td><td>[Use]</td><td class="box-critical">❌ <strong>High risk:</strong> [Why].</td></tr>
        <tr><td>[Med]</td><td>[Dose]</td><td>[Use]</td><td class="box-warning">⚠️ <strong>Caution:</strong> [Why].</td></tr>
      </tbody>
    </table>

    <h5>B) Procedure errors / diagnostic gaps</h5>
    <table class="custom-table">
      <thead><tr><th>Issue</th><th>Analysis & action</th><th>Ask your doctor</th></tr></thead>
      <tbody>
        <tr><td><strong>Example: Peri‑orbital headache</strong></td><td class="box-warning">No intraocular pressure measurement documented.</td><td>"Do I need urgent IOP testing?"</td></tr>
        <tr><td><strong>Example: Chronic indwelling catheter</strong></td><td class="box-critical">Chronic infection risk; consider intermittent catheterization.</td><td>"Is intermittent catheterization safer for me?"</td></tr>
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
    <p>[Top risk + next critical step].</p>

    <h4>7) Disclaimer</h4>
    <div class="box-warning"><strong>This is a health‑awareness tool and not a medical diagnosis; always consult your physician.</strong></div>
  </div>
  `,
};

// يبني نص المستخدم بإظهار الحقول الجديدة كلها
function buildUserPrompt(body) {
  const L = body.uiLang === "en" ? "en" : "ar";

  const lines = [];
  const push = (k, v) => {
    if (v !== undefined && v !== null && `${v}`.trim() !== "") {
      lines.push(`- ${k}: ${v}`);
    }
  };

  // معلومات عامة
  push(L === "ar" ? "العمر" : "Age", body.age);
  push(L === "ar" ? "الجنس" : "Gender", body.gender);
  if (body.gender === "female") {
    push(L === "ar" ? "حامل؟" : "Pregnant?", body.pregnancyStatus);
    if (body.pregnancyStatus === "yes") {
      push(L === "ar" ? "شهر الحمل" : "Pregnancy month", body.pregnancyMonth);
    }
  }

  // أعراض بصرية
  push(L === "ar" ? "أعراض بصرية" : "Visual symptoms", body.visualSymptoms);
  if (body.visualSymptoms === true || body.visualSymptoms === "yes") {
    push(L === "ar" ? "حدة البصر" : "Visual acuity", body.visualAcuity);
    push(L === "ar" ? "آخر فحص عين" : "Last eye exam date", body.lastEyeExamDate);
  }

  // تدخين وسعال
  push(L === "ar" ? "مدخّن" : "Smoker", body.isSmoker);
  if (body.isSmoker === true || body.isSmoker === "yes") {
    push(L === "ar" ? "سنوات التدخين" : "Smoking years", body.smokingYears);
  }
  push(L === "ar" ? "سعال" : "Cough", body.hasCough);
  if (body.hasCough === true || body.hasCough === "yes") {
    push(L === "ar" ? "وجود دم بالسعال" : "Hemoptysis", body.coughBlood);
    push(L === "ar" ? "بلغم أصفر" : "Yellow sputum", body.coughYellowSputum);
    push(L === "ar" ? "سعال جاف" : "Dry cough", body.coughDry);
  }

  // نصوص حرّة
  push(L === "ar" ? "الأعراض" : "Symptoms", body.symptoms);
  push(L === "ar" ? "التاريخ المرضي" : "Medical history", body.history);
  push(L === "ar" ? "تشخيصات سابقة" : "Previous diagnoses", body.diagnosis);
  push(L === "ar" ? "الأدوية الحالية" : "Current medications", body.medications);
  push(L === "ar" ? "تحاليل/أشعة" : "Labs/Imaging", body.labs);

  // وجود صور
  const filesCount =
    Array.isArray(body.files) && body.files.length
      ? body.files.length
      : Array.isArray(body.imageData) && body.imageData.length
      ? body.imageData.length
      : 0;

  const filesLine =
    filesCount > 0
      ? L === "ar"
        ? `يوجد ${filesCount} ملف/صورة مرفوعة للتحليل. **الصور هي المصدر الأساسي للحقيقة. حلّل الأشعة والوثائق بصريًا بعمق مع ذكر النتائج.**`
        : `There are ${filesCount} uploaded image(s)/file(s). **Treat images as the primary source of truth; analyze radiology deeply and list findings.**`
      : L === "ar"
      ? "لا يوجد ملفات مرفوعة."
      : "No files uploaded.";

  const header =
    L === "ar"
      ? "### بيانات الحالة لاستخدامها في إنتاج التقرير وفق القالب المرفق:"
      : "### Case data to generate the report following the attached template:";

  return `${header}\n${lines.join("\n")}\n\n${filesLine}`;
}

// ــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ
// المعالج الرئيسي
// ــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ
export default async function handler(req, res) {
  // CORS
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

    const model = "models/gemini-1.5-pro-latest";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;

    const language = req.body.uiLang === "en" ? "en" : "ar";
    const systemTemplate = reportTemplates[language];

    // نجمع الأجزاء (نص + صور)
    const userParts = [{ text: buildUserPrompt(req.body) }];

    // دعم طريقتين لإرسال الصور:
    // 1) files: [{name,type,base64}]
    // 2) imageData: [base64, ...]
    const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
    const addInline = (base64, mime) => {
      userParts.push({ inline_data: { mime_type: mime, data: base64 } });
    };

    if (Array.isArray(req.body.files)) {
      for (const f of req.body.files) {
        if (!f?.base64) continue;
        const sizeInBytes = Math.floor((f.base64.length * 3) / 4);
        if (sizeInBytes > MAX_IMAGE_SIZE) {
          return res.status(413).json({
            error:
              language === "ar"
                ? `حجم الملف "${f.name || "image"}" يتجاوز 4MB`
                : `File "${f.name || "image"}" exceeds 4MB`,
          });
        }
        const mt = f.type || detectMimeType(f.base64);
        addInline(f.base64, mt);
      }
    } else if (Array.isArray(req.body.imageData)) {
      for (const b64 of req.body.imageData) {
        if (!b64) continue;
        const sizeInBytes = Math.floor((b64.length * 3) / 4);
        if (sizeInBytes > MAX_IMAGE_SIZE) {
          return res.status(413).json({
            error: language === "ar" ? "حجم الصورة يتجاوز 4MB" : "Image exceeds 4MB",
          });
        }
        const mt = detectMimeType(b64);
        addInline(b64, mt);
      }
    }

    // تعليمات اللغة والتحليل البصري العميق
    userParts.push({
      text:
        language === "ar"
          ? "أنتج تقريرًا HTML فقط باللغة العربية، مع الحفاظ التام على القالب والألوان. عند وجود صور أشعة (X‑ray/CT/MRI/تقارير)، استخرج **العلامات الشعاعية بدقة** (المكان/الشدة/الاحتمال) وأرفقها ضمن الأقسام المناسبة."
          : "Return HTML only in English, preserving the template/colors. If radiology images/reports are attached, list **specific radiographic findings** (location/severity/likelihood) in the proper sections.",
    });

    const payload = {
      // وفق مستندات Gemini REST: system_instruction + contents + generation_config
      system_instruction: {
        role: "system",
        parts: [{ text: systemTemplate }],
      },
      contents: [
        {
          role: "user",
          parts: userParts,
        },
      ],
      generation_config: {
        temperature: 0.2,
        top_p: 0.95,
        top_k: 40,
        max_output_tokens: 8192,
      },
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errText = await response.text();
      try {
        const j = JSON.parse(errText);
        errText = j.error?.message || errText;
      } catch {}
      throw new Error(errText || `API request failed (${response.status})`);
    }

    const result = await response.json();
    const text =
      result?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text || "";

    if (!text) throw new Error("Failed to generate report text from the model.");

    return res.status(200).json({ htmlReport: text });
  } catch (err) {
    console.error("patient-analyzer error:", err);
    return res.status(500).json({
      error: "Server error during case analysis",
      detail: err.message,
    });
  }
}
