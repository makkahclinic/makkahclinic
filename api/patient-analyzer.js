// /api/patient-analyzer.js
// Ready-to-paste, production-leaning endpoint for Arabic/English medical report generation
// - Accepts { uiLang, age, gender, ... , files:[{name,type,base64}] }
// - Images <= 4MB are sent inline; larger ones are uploaded to Google AI Files API automatically.
// - Returns { htmlReport } or { error, detail }

import crypto from "crypto";

// ---------- Helpers: MIME + base64 ----------
function detectMimeType(base64 = "") {
  // strip data URL prefix if present
  const b64 = base64.replace(/^data:[^;]+;base64,/, "");
  const signatures = [
    ["JVBERi0", "application/pdf"],
    ["iVBORw0", "image/png"],
    ["/9j/4A", "image/jpeg"],
    ["R0lGOD", "image/gif"],
    ["UklGRg", "image/webp"],
    ["AAAAIGZ0eXBtcDQy", "video/mp4"], // full mp4 ftyp
    ["SUQz", "audio/mpeg"],           // ID3
  ];
  for (const [sig, mt] of signatures) if (b64.startsWith(sig)) return mt;
  return "image/jpeg";
}

function base64SizeBytes(b64 = "") {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, "").replace(/=+$/, "");
  // bytes = floor((len * 3) / 4)
  return Math.floor((cleaned.length * 3) / 4);
}

function toInlinePart(base64, mime) {
  const data = base64.replace(/^data:[^;]+;base64,/, "");
  return { inline_data: { mime_type: mime, data } };
}

function ensureBoolean(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["yes", "true", "1", "y", "on"].includes(v.toLowerCase());
  return false;
}

function safeStr(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length > 2000 ? s.slice(0, 2000) + "…" : s;
}

// ---------- Report templates ----------
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
  <p class="box-info">اعتمد التحليل على المعلومات والملفات المرفوعة، مع قراءة بصرية دقيقة للصور/الأشعة عند توفرها.</p>
  <h4>1) ملخص الحالة والتقييم</h4>
  <ul>
    <li><div class="box-good">✅ <strong>الملخص السريري:</strong> [ملخص موجز دقيق].</div></li>
    <li><div class="box-critical">❌ <strong>نقاط حرجة:</strong> [تعارضات/نواقص حيوية].</div></li>
    <li><div class="box-warning">⚠️ <strong>بيانات ناقصة:</strong> [فحوص أساسية مفقودة].</div></li>
  </ul>
  <h4>2) التشخيصات المحتملة (حسب الخطورة)</h4>
  <ol>
    <li><div class="box-critical"><strong>يُستبعد أولًا:</strong> [تشخيص + تبرير مختصر].</div></li>
    <li><div class="box-warning"><strong>تالي محتمل:</strong> [تشخيص + تبرير].</div></li>
    <li><div class="box-good"><strong>أقل خطورة:</strong> [قائمة].</div></li>
  </ol>
  <h4>3) مراجعة الأدوية/الإجراءات والفجوات</h4>
  <h5>أ) الأدوية</h5>
  <table class="custom-table"><thead><tr><th>الدواء</th><th>الجرعة/المدة</th><th>الغرض</th><th>تحليل المخاطر</th></tr></thead>
    <tbody>
      <tr><td>[دواء]</td><td>[جرعة]</td><td>[غرض]</td><td class="box-critical">❌ <strong>خطر عالٍ:</strong> [السبب].</td></tr>
      <tr><td>[دواء]</td><td>[جرعة]</td><td>[غرض]</td><td class="box-warning">⚠️ <strong>بحذر:</strong> [السبب].</td></tr>
    </tbody>
  </table>
  <h5>ب) فجوات واختبارات لازمة</h5>
  <table class="custom-table"><thead><tr><th>المشكلة</th><th>تحليل/إجراء</th><th>سؤال للطبيب</th></tr></thead>
    <tbody>
      <tr><td><strong>مثال: قسطرة بولية دائمة</strong></td><td class="box-critical">خطر عدوى مزمنة؛ فكّر في القسطرة المتقطعة.</td><td>"هل المتقطعة أنسب لحالتي؟"</td></tr>
    </tbody>
  </table>
  <h4>4) خطة العمل</h4>
  <ul>
    <li><div class="box-critical"><span class="icon">🚨</span><strong>فوري:</strong> [إيقاف/توجّه/اتصال…]</div></li>
    <li><div class="box-warning"><span class="icon">⚠️</span><strong>خلال 24 ساعة:</strong> [حجز/مراقبة…]</div></li>
  </ul>
  <h4>5) أسئلة ذكية</h4>
  <ul class="box-info"><li>[س1]</li><li>[س2]</li></ul>
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
  <p class="box-info">Structured clinical synthesis based on the submitted data and files, with image/radiology review when provided.</p>
  <h4>1) Case summary & assessment</h4>
  <ul>
    <li><div class="box-good">✅ <strong>Clinical summary:</strong> [Concise key points].</div></li>
    <li><div class="box-critical">❌ <strong>Critical issues:</strong> [Conflicts / vital omissions].</div></li>
    <li><div class="box-warning">⚠️ <strong>Missing data:</strong> [Essential tests not done].</div></li>
  </ul>
  <h4>2) Differential diagnoses (by severity)</h4>
  <ol>
    <li><div class="box-critical"><strong>Rule out first:</strong> [Dx + rationale].</div></li>
    <li><div class="box-warning"><strong>Next likely:</strong> [Dx + rationale].</div></li>
    <li><div class="box-good"><strong>Lower risk:</strong> [List].</div></li>
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
      <tr><td><strong>Example: Chronic indwelling catheter</strong></td><td class="box-critical">Prefer intermittent catheterization when feasible.</td><td>"Is intermittent catheterization safer for me?"</td></tr>
    </tbody>
  </table>
  <h4>4) Action plan</h4>
  <ul>
    <li><div class="box-critical"><span class="icon">🚨</span><strong>Immediate:</strong> [Stop/ER/etc.].</div></li>
    <li><div class="box-warning"><span class="icon">⚠️</span><strong>Within 24h:</strong> [Book/monitor/etc.].</div></li>
  </ul>
  <h4>5) Smart questions</h4>
  <ul class="box-info"><li>[Q1]</li><li>[Q2]</li></ul>
  <h4>6) Overall summary</h4>
  <p>[Top risk + next step].</p>
  <h4>7) Disclaimer</h4>
  <div class="box-warning"><strong>This tool is for health awareness and not a medical diagnosis; always consult your physician.</strong></div>
</div>
  `,
};

// ---------- Prompt builder ----------
function buildUserPrompt(body) {
  const L = body.uiLang === "en" ? "en" : "ar";
  const lines = [];
  const add = (k, v) => {
    if (v !== undefined && v !== null && String(v).trim() !== "") lines.push(`- ${k}: ${safeStr(v)}`);
  };

  add(L === "ar" ? "العمر" : "Age", body.age);
  add(L === "ar" ? "الجنس" : "Gender", body.gender);
  if (String(body.gender).toLowerCase() === "female") {
    add(L === "ar" ? "حامل؟" : "Pregnant?", ensureBoolean(body.pregnancyStatus) ? "yes" : "no");
    if (ensureBoolean(body.pregnancyStatus)) add(L === "ar" ? "شهر الحمل" : "Pregnancy month", body.pregnancyMonth);
  }

  const visual = ensureBoolean(body.visualSymptoms);
  add(L === "ar" ? "أعراض بصرية" : "Visual symptoms", visual ? "yes" : "no");
  if (visual) {
    add(L === "ar" ? "حدة البصر" : "Visual acuity", body.visualAcuity);
    add(L === "ar" ? "آخر فحص عين" : "Last eye exam date", body.lastEyeExamDate);
  }

  const smoker = ensureBoolean(body.isSmoker);
  add(L === "ar" ? "مدخّن" : "Smoker", smoker ? "yes" : "no");
  if (smoker) add(L === "ar" ? "سنوات التدخين" : "Smoking years", body.smokingYears);

  const cough = ensureBoolean(body.hasCough);
  add(L === "ar" ? "سعال" : "Cough", cough ? "yes" : "no");
  if (cough) {
    add(L === "ar" ? "دم في السعال" : "Hemoptysis", ensureBoolean(body.coughBlood) ? "yes" : "no");
    add(L === "ar" ? "بلغم أصفر" : "Yellow sputum", ensureBoolean(body.coughYellowSputum) ? "yes" : "no");
    add(L === "ar" ? "سعال جاف" : "Dry cough", ensureBoolean(body.coughDry) ? "yes" : "no");
  }

  add(L === "ar" ? "الأعراض" : "Symptoms", body.symptoms);
  add(L === "ar" ? "التاريخ المرضي" : "Medical history", body.history);
  add(L === "ar" ? "تشخيصات سابقة" : "Previous diagnoses", body.diagnosis);
  add(L === "ar" ? "الأدوية الحالية" : "Current medications", body.medications);
  add(L === "ar" ? "تحاليل/أشعة" : "Labs/Imaging", body.labs);

  const files = Array.isArray(body.files) ? body.files : [];
  const filesLine = files.length
    ? (L === "ar"
        ? `يوجد ${files.length} ملف/صورة مرفوعة للتحليل. **تعامل مع الصور كمصدر أولي للحقيقة؛ حلّل الأشعة والعلامات البصرية بدقة.**`
        : `There are ${files.length} uploaded file(s). **Treat images as the primary source of truth; list concrete radiographic/visual findings.**`)
    : (L === "ar" ? "لا يوجد ملفات مرفوعة." : "No files uploaded.");

  const header = L === "ar"
    ? "### بيانات الحالة لتوليد التقرير وفق القالب:"
    : "### Case data to generate the report using the supplied template:";

  return `${header}\n${lines.join("\n")}\n\n${filesLine}`;
}

// ---------- Google AI (Gemini) HTTP ----------
async function fetchJSON(url, options = {}, retries = 2) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = json?.error?.message || `${res.status} ${res.statusText}`;
      if (retries > 0 && [429, 500, 502, 503, 504].includes(res.status)) {
        await new Promise(r => setTimeout(r, (3 - retries + 1) * 600)); // backoff
        return fetchJSON(url, options, retries - 1);
      }
      throw new Error(msg);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

// Upload to Google AI Files API (for larger files or non-inline types)
async function uploadFileToGemini({ apiKey, base64, mimeType }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const body = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Files API upload failed: ${res.status} ${txt}`);
  }
  const j = await res.json();
  // Expect { file: { uri, mimeType, ... } } or { uri, ... } depending on API version
  const file = j.file || j;
  if (!file?.uri) throw new Error("Files API did not return file.uri");
  return { fileUri: file.uri, mimeType: file.mimeType || mimeType };
}

// ---------- HTTP handler ----------
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = req.body || {};
    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({ error: "Patient data required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const language = body.uiLang === "en" ? "en" : "ar";
    const systemTemplate = reportTemplates[language];

    // Build user prompt
    const userParts = [{ text: buildUserPrompt(body) }];

    // Files: inline <= 4MB, otherwise upload to Files API
    const MAX_INLINE = 4 * 1024 * 1024; // 4MB
    const files = Array.isArray(body.files) ? body.files.slice(0, 12) : []; // sane cap
    for (const f of files) {
      if (!f?.base64) continue;
      const b64 = String(f.base64);
      const mime = f.type || detectMimeType(b64);
      const size = base64SizeBytes(b64);

      if (size <= MAX_INLINE && mime.startsWith("image/")) {
        userParts.push(toInlinePart(b64, mime));
      } else {
        // Upload to Files API (supports images, pdf, others)
        const { fileUri, mimeType } = await uploadFileToGemini({ apiKey, base64: b64, mimeType: mime });
        userParts.push({ file_data: { file_uri: fileUri, mime_type: mimeType } });
      }
    }

    // Final instruction to return HTML only
    userParts.push({
      text:
        language === "ar"
          ? "أعد HTML فقط بالعربية محافظًا على القالب/الألوان أعلاه. عند وجود صور/أشعة: اذكر العلامات الموضوعية والقابلة للقياس بنقاط مرقمة."
          : "Return HTML only in English, preserving the template/colors above. If images/radiology exist: list objective, measurable findings as numbered bullets.",
    });

    // Generate content
    const model = "models/gemini-1.5-pro-latest";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;

    const payload = {
      system_instruction: { role: "system", parts: [{ text: systemTemplate }] },
      contents: [{ role: "user", parts: userParts }],
      generation_config: {
        temperature: 0.2,
        top_p: 0.95,
        top_k: 40,
        max_output_tokens: 8192,
        response_mime_type: "text/html", // hint
      },
      safety_settings: [
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUAL", threshold: "BLOCK_ONLY_HIGH" },
      ],
    };

    const json = await fetchJSON(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const candidate = json?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const html =
      parts.find((p) => typeof p.text === "string")?.text ||
      parts.find((p) => typeof p.inline_data === "object")?.inline_data?.data ||
      "";

    if (!html) throw new Error("Model returned empty content.");

    // Very basic guard: ensure we return HTML (model sometimes returns markdown)
    const normalized = html.trim().startsWith("<") ? html : `<div>${html}</div>`;

    return res.status(200).json({ htmlReport: normalized });
  } catch (err) {
    console.error("patient-analyzer error:", err);
    const id = crypto.randomUUID?.() || String(Date.now());
    return res.status(500).json({
      error: "Server error during case analysis",
      detail: err.message,
      traceId: id,
    });
  }
}
