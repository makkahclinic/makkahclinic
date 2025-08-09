// /api/patient-analyzer.js
// تحليل حالة المريض مع دعم صور أشعة/X-ray وصور طبية أخرى (JPEG/PNG/PDF) وإخراج تقرير HTML منسق (AR/EN).

export default async function handler(req, res) {
  // ---- CORS ----
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
    if (!apiKey) return res.status(500).json({ error: "System configuration error: missing GEMINI_API_KEY" });

    // ---- Helpers ----
    const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
    const detectMimeType = (base64Data = "") => {
      const signatures = {
        "JVBERi0": "application/pdf",
        "iVBORw0": "image/png",
        "/9j/4A": "image/jpeg",
        "R0lGOD": "image/gif",
        "UklGRg": "image/webp",
      };
      for (const [sig, mime] of Object.entries(signatures)) {
        if (base64Data.startsWith(sig)) return mime;
      }
      return "image/jpeg";
    };

    // ---- Input normalization (front-end may send synonyms) ----
    const uiLang = (req.body.uiLang || req.body.language || "ar").toLowerCase().startsWith("en") ? "en" : "ar";

    const caseDescription =
      req.body.caseDescription ||
      req.body.symptoms ||
      req.body.notes ||
      "";
    const medicalHistory =
      req.body.medicalHistory ||
      req.body.history ||
      "";
    const currentMedications =
      req.body.currentMedications ||
      req.body.medications ||
      "";
    const diagnosis = req.body.diagnosis || "";
    const labResults = req.body.labResults || "";
    const vitals = req.body.vitals || req.body.bloodPressure || req.body.temperature || "";
    const age = req.body.age || "";
    const gender = req.body.gender || "";
    const isPregnant = req.body.isPregnant || req.body.pregnancy?.status || req.body["pregnancy-status"] || "";
    const pregnancyMonth = req.body.pregnancyMonth || req.body["pregnancy-month"] || "";

    // Standardize files array: [{ name?, type?, base64 }]
    const files = Array.isArray(req.body.files)
      ? req.body.files
      : Array.isArray(req.body.imageData)
      ? req.body.imageData.map((d, i) =>
          typeof d === "string"
            ? { name: `img_${i + 1}.jpg`, type: detectMimeType(d), base64: d }
            : { name: d.name || `img_${i + 1}`, type: d.mimeType || d.type || detectMimeType(d.data), base64: d.data || d.base64 || "" }
        )
      : [];

    // ---- Validate & build parts ----
    const parts = [];
    // 1) System HTML template (ensures colored boxes + structure are preserved)
    const systemTemplate = buildReportTemplate(uiLang);
    // Note: we place the HTML/CSS template inside system instruction + reinforce "return raw HTML".
    const systemInstruction = {
      role: "system",
      parts: [
        {
          text:
            systemTemplate +
            "\n\nIMPORTANT: Return a single, self-contained HTML snippet (no markdown fences), filling the placeholders with the analysis. Maintain all CSS class names as provided.",
        },
      ],
    };

    // 2) User prompt (text data)
    const textPrompt = buildUserPrompt({
      uiLang,
      caseDescription,
      medicalHistory,
      currentMedications,
      diagnosis,
      labResults,
      vitals,
      age,
      gender,
      isPregnant,
      pregnancyMonth,
      filesCount: files.length,
    });
    parts.push({ text: textPrompt });

    // 3) Attach images/PDF as inline_data with the CORRECT field names
    for (const f of files) {
      if (!f || !f.base64) continue;
      const base64 = f.base64.replace(/\s+/g, "");
      const sizeInBytes = Math.floor((base64.length * 3) / 4); // rough size; padding ignored
      if (sizeInBytes > MAX_IMAGE_SIZE) {
        return res.status(413).json({
          error:
            uiLang === "ar"
              ? `حجم الملف '${f.name || "image"}' يتجاوز 4MB`
              : `File '${f.name || "image"}' exceeds 4MB`,
        });
      }
      const mime = f.type || detectMimeType(base64);
      parts.push({
        inline_data: {
          mime_type: mime, // <-- required snake_case per Gemini REST spec
          data: base64,
        },
      });
    }

    // 4) Language guard
    parts.push({
      text:
        uiLang === "ar"
          ? "يرجى أن يكون التقرير باللغة العربية بالكامل، بصيغة HTML فقط، دون أي أسوار Markdown أو أكواد إضافية."
          : "Provide the full report in English only, as pure HTML (no markdown fences).",
    });

    // ---- Build payload (REST v1beta generateContent) ----
    const payload = {
      contents: [{ role: "user", parts }],
      systemInstruction, // official field available in API; see docs
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
      // Optional: relaxed safety to avoid overblocking benign medical terms
      safetySettings: [
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_ONLY_HIGH" },
      ],
    };

    const apiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=" +
      encodeURIComponent(apiKey);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errMsg = `API request failed (${response.status})`;
      try {
        const e = await response.json();
        errMsg = e.error?.message || errMsg;
      } catch {}
      throw new Error(errMsg);
    }

    const result = await response.json();

    const reportHtml =
      result?.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string")?.text || "";

    if (!reportHtml) throw new Error("Failed to generate report (empty text).");

    return res.status(200).json({ htmlReport: reportHtml });
  } catch (err) {
    console.error("patient-analyzer error:", err);
    return res.status(500).json({
      error: "Server error during case analysis",
      detail: err.message,
    });
  }
}

// ---------- TEMPLATES & PROMPTS ----------

function buildReportTemplate(lang) {
  if (lang === "en") {
    return `
<style>
.report-container { font-family: 'Arial', sans-serif; direction: ltr; }
.box-critical { border-left: 5px solid #721c24; background-color: #f8d7da; color: #721c24; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-warning  { border-left: 5px solid #856404; background-color: #fff3cd; color: #856404; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-good     { border-left: 5px solid #155724; background-color: #d4edda; color: #155724; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-info     { border-left: 5px solid #004085; background-color: #cce5ff; color: #004085; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.custom-table { border-collapse: collapse; width: 100%; text-align: left; margin-top: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.custom-table th, .custom-table td { padding: 12px; border: 1px solid #dee2e6; }
.custom-table thead { background-color: #e9ecef; }
h3, h4 { color: #343a40; border-bottom: 2px solid #0056b3; padding-bottom: 8px; margin-top: 2rem; }
.icon { font-size: 1.2em; margin-right: 8px; }
</style>

<div class="report-container">
  <h3>Comprehensive Medical Analysis Report</h3>
  <p class="box-info">Based on the provided information (including any imaging), our clinical diagnostics and clinical pharmacy team generated this structured report.</p>

  <h4>1) Case Summary & Assessment</h4>
  <ul>
    <li><div class="box-good">✅ <strong>Clinical Summary:</strong> [Concise case summary].</div></li>
    <li><div class="box-critical">❌ <strong>Critical Issues:</strong> [Data conflicts or red flags].</div></li>
    <li><div class="box-warning">⚠️ <strong>Missing/Needed Data:</strong> [Key tests not present].</div></li>
  </ul>

  <h4>2) Imaging Findings (X‑ray / CT / MRI / Ultrasound)</h4>
  <div class="box-info"><strong>Findings:</strong> [Objective radiology-style findings from the image(s) with localization and sizes if available].</div>
  <div class="box-warning"><strong>Limitations:</strong> [Mention image quality, projection, artifacts, or missing views].</div>
  <div class="box-good"><strong>Impression:</strong> [Numbered differential; most concerning first; recommendations if any].</div>

  <h4>3) Potential Diagnoses (ordered by severity)</h4>
  <ol>
    <li><div class="box-critical"><strong>Most Critical / must rule out:</strong> [Diagnosis + justification].</div></li>
    <li><div class="box-warning"><strong>Probable next:</strong> [Diagnosis + justification].</div></li>
    <li><div class="box-good"><strong>Other considerations:</strong> [Others].</div></li>
  </ol>

  <h4>4) Medication & Procedure Audit</h4>
  <p>All medications extracted from images/text are analyzed for risks, contraindications, duplications, dose, and monitoring.</p>
  <table class="custom-table">
    <thead>
      <tr><th>Medication</th><th>Dosage & Duration</th><th>Indication</th><th>Analysis & Risk Points</th></tr>
    </thead>
    <tbody>
      <tr><td>[Name]</td><td>[Dose]</td><td>[Why]</td><td class="box-critical">❌ Contraindicated / overdose / dangerous duplication.</td></tr>
      <tr><td>[Name]</td><td>[Dose]</td><td>[Why]</td><td class="box-warning">⚠️ Needs caution (renal/hepatic/elderly/monitoring).</td></tr>
    </tbody>
  </table>

  <h4>5) Procedure Errors & Diagnostic Gaps</h4>
  <table class="custom-table">
    <thead><tr><th>Identified Gap</th><th>Analysis & Action</th><th>Ask Your Doctor</th></tr></thead>
    <tbody>
      <tr><td>Headache near eye</td><td class="box-warning">No intraocular pressure documented to exclude glaucoma.</td><td>"Do I need IOP measurement urgently?"</td></tr>
      <tr><td>Chronic catheter infections</td><td class="box-critical">Consider switching to intermittent catheterization.</td><td>"Is intermittent catheterization safer for me?"</td></tr>
    </tbody>
  </table>

  <h4>6) Action Plan</h4>
  <ul>
    <li><div class="box-critical"><span class="icon">🚨</span><strong>Immediate:</strong> [Most urgent action].</div></li>
    <li><div class="box-warning"><span class="icon">⚠️</span><strong>Within 24h:</strong> [Next step].</div></li>
  </ul>

  <h4>7) Smart Questions for Your Doctor</h4>
  <ul class="box-info"><li>[Question 1]</li><li>[Question 2]</li></ul>

  <h4>8) Summary</h4>
  <p>[Focus on highest risk + next critical step].</p>

  <h4>9) Disclaimer</h4>
  <div class="box-warning"><strong>This is a health awareness tool, not a final diagnosis. It never replaces an in‑person clinical assessment by a qualified physician.</strong></div>
</div>
`.trim();
  }

  // Arabic
  return `
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap');
.report-container { font-family: 'Cairo','Arial',sans-serif; direction: rtl; }
.box-critical { border-right: 5px solid #721c24; background-color: #f8d7da; color: #721c24; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-warning  { border-right: 5px solid #856404; background-color: #fff3cd; color: #856404; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-good     { border-right: 5px solid #155724; background-color: #d4edda; color: #155724; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.box-info     { border-right: 5px solid #004085; background-color: #cce5ff; color: #004085; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
.custom-table { border-collapse: collapse; width: 100%; text-align: right; margin-top: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.custom-table th, .custom-table td { padding: 12px; border: 1px solid #dee2e6; }
.custom-table thead { background-color: #e9ecef; }
h3, h4 { color: #343a40; border-bottom: 2px solid #0056b3; padding-bottom: 8px; margin-top: 2rem; }
.icon { font-size: 1.2em; margin-left: 8px; }
</style>

<div class="report-container">
  <h3>تقرير تحليل طبي شامل</h3>
  <p class="box-info">استنادًا إلى المعلومات المقدمة (بما في ذلك أي صور أشعة)، قام فريقنا المختص في التشخيص السريري والصيدلة الإكلينيكية بإعداد هذا التقرير المنظم.</p>

  <h4>1) ملخص الحالة والتقييم</h4>
  <ul>
    <li><div class="box-good">✅ <strong>الملخص السريري:</strong> [ملخص موجز للحالة].</div></li>
    <li><div class="box-critical">❌ <strong>نقاط حرجة:</strong> [تعارض بيانات/علامات خطورة].</div></li>
    <li><div class="box-warning">⚠️ <strong>بيانات/فحوصات ناقصة:</strong> [اختبارات ضرورية مفقودة].</div></li>
  </ul>

  <h4>2) نتائج تصويرية (أشعة سينية / مقطعية / رنين / صوتية)</h4>
  <div class="box-info"><strong>Findings (النتائج الموضوعية):</strong> [تفصيل النتائج بأسلوب Radiology مع التوضع والأبعاد إن أمكن].</div>
  <div class="box-warning"><strong>الحدود:</strong> [جودة الصورة، الإسقاط، Artefacts، لقطات مفقودة].</div>
  <div class="box-good"><strong>Impression (الانطباع):</strong> [قائمة مرقمة حسب الأهم/الأخطر + التوصيات].</div>

  <h4>3) تشخيصات محتملة (مرتبة حسب الخطورة)</h4>
  <ol>
    <li><div class="box-critical"><strong>الأكثر إلحاحًا للاستبعاد أولًا:</strong> [تشخيص + تبرير].</div></li>
    <li><div class="box-warning"><strong>التشخيص المرجح التالي:</strong> [تشخيص + تبرير].</div></li>
    <li><div class="box-good"><strong>احتمالات أخرى:</strong> [تشخيصات أخرى].</div></li>
  </ol>

  <h4>4) مراجعة الأدوية والإجراءات</h4>
  <p>يتم استخراج الأدوية من الصور/النصوص وتحليلها لموانع الاستعمال، التداخلات، الجرعات، التكرار، والمتابعة.</p>
  <table class="custom-table">
    <thead>
      <tr><th>الدواء</th><th>الجرعة والمدة</th><th>الغاية</th><th>تحليل ونقاط خطورة</th></tr>
    </thead>
    <tbody>
      <tr><td>[الاسم]</td><td>[الجرعة]</td><td>[الغاية]</td><td class="box-critical">❌ مانع استعمال/جرعة زائدة/تكرار خطير.</td></tr>
      <tr><td>[الاسم]</td><td>[الجرعة]</td><td>[الغاية]</td><td class="box-warning">⚠️ يتطلب حذرًا (كلوي/كبدي/كبار سن/مراقبة).</td></tr>
    </tbody>
  </table>

  <h4>5) فجوات تشخيصية/أخطاء إجراءات</h4>
  <table class="custom-table">
    <thead><tr><th>الفجوة</th><th>التحليل والإجراء</th><th>سؤال للطبيب</th></tr></thead>
    <tbody>
      <tr><td>صداع حول العين</td><td class="box-warning">غياب قياس ضغط العين لاستبعاد الجلوكوما.</td><td>"هل أحتاج قياس ضغط العين بصورة عاجلة؟"</td></tr>
      <tr><td>التهابات مع قسطرة دائمة</td><td class="box-critical">التفكير بالتحول إلى قسطرة متقطعة.</td><td>"هل القسطرة المتقطعة أنسب لحالتي؟"</td></tr>
    </tbody>
  </table>

  <h4>6) خطة العمل</h4>
  <ul>
    <li><div class="box-critical"><span class="icon">🚨</span><strong>فوري:</strong> [الإجراء الأشد إلحاحًا].</div></li>
    <li><div class="box-warning"><span class="icon">⚠️</span><strong>خلال 24 ساعة:</strong> [الخطوة التالية].</div></li>
  </ul>

  <h4>7) أسئلة ذكية للطبيب</h4>
  <ul class="box-info"><li>[سؤال 1]</li><li>[سؤال 2]</li></ul>

  <h4>8) خلاصة</h4>
  <p>[أعلى خطورة + الخطوة الحرجة التالية].</p>

  <h4>9) إخلاء مسؤولية</h4>
  <div class="box-warning"><strong>هذه أداة توعوية وليست تشخيصًا نهائيًا، ولا تغني عن الفحص السريري لدى طبيب مؤهل.</strong></div>
</div>
`.trim();
}

function buildUserPrompt(d) {
  if (d.uiLang === "en") {
    return `
**Case Data (text):**
- Age: ${d.age || "NA"}
- Gender: ${d.gender || "NA"}
- Pregnancy: ${d.gender === "female" ? (d.isPregnant || "unspecified") + (d.pregnancyMonth ? ` (month ${d.pregnancyMonth})` : "") : "N/A"}
- Vitals/Notes: ${d.vitals || "NA"}
- Case Description: ${d.caseDescription || "NA"}
- Medical History: ${d.medicalHistory || "NA"}
- Current Medications: ${d.currentMedications || "NA"}
- Diagnosis (if any): ${d.diagnosis || "NA"}
- Lab Results: ${d.labResults || "NA"}

**Uploaded Files:** ${d.filesCount ? `${d.filesCount} file(s) attached. Treat images as the primary source of truth.` : "None"}

**Task for the model:**
1) Read images first (X-ray/other modalities). Extract objective *Findings* and then a concise *Impression*.
2) Cross-check text vs imaging; flag conflicts.
3) Analyze medications (contraindications, duplications, dosing, monitoring).
4) Return **only** the filled HTML snippet provided in the template (no markdown fences).
`.trim();
  }

  // Arabic
  return `
**بيانات الحالة (نص):**
- العمر: ${d.age || "غير محدد"}
- الجنس: ${d.gender || "غير محدد"}
- الحمل: ${d.gender === "female" ? (d.isPregnant || "غير محدد") + (d.pregnancyMonth ? ` (الشهر ${d.pregnancyMonth})` : "") : "غير منطبق"}
- العلامات الحيوية/ملاحظات: ${d.vitals || "غير محدد"}
- وصف الحالة: ${d.caseDescription || "غير محدد"}
- التاريخ المرضي: ${d.medicalHistory || "غير محدد"}
- الأدوية الحالية: ${d.currentMedications || "غير محدد"}
- تشخيصات مذكورة: ${d.diagnosis || "غير محدد"}
- نتائج تحاليل: ${d.labResults || "غير محدد"}

**الملفات المرفقة:** ${d.filesCount ? `${d.filesCount} ملف(ات) مرفقة. اعتبر الصور مصدر الحقيقة الأساسي.` : "لا يوجد"}

**مهمة النموذج:**
1) قراءة صور الأشعة/التصوير أولًا واستخراج *Findings* الموضوعية ثم *Impression* المختصر.
2) مطابقة النص مع الصور والتنبيه عن أي تعارض.
3) تدقيق الأدوية (موانع/تكرار/جرعات/متابعة).
4) إخراج **القطعة HTML** المعبّأة فقط وفق القالب (بدون Markdown).
`.trim();
}
