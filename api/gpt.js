// هذا الإعداد مخصص لـ Next.js لزيادة حجم الطلب المسموح به، وهو ضروري لرفع ملفات كبيرة.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb", // السماح بطلبات تصل إلى 50 ميجابايت
    },
  },
};

// --- الإعدادات الرئيسية ---
// عناوين ونماذج الذكاء الاصطناعي ومفاتيح التشغيل (API Keys)
// يتم قراءتها من متغيرات البيئة (ملف .env.local) لضمان الأمان.
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o"; // استخدام أحدث وأقوى نموذج
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest"; // أفضل نموذج متعدد الوسائط
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// --- دوال مساعدة ---
// لتبسيط إرسال الردود من الـ API
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (response) => (response.headers.get("content-type") || "").includes("application/json") ? response.json() : { raw: await response.text() };

// --- معالج رفع الملفات إلى Gemini ---
// Gemini يتطلب رفع الملفات أولاً ثم استخدامها في الطلب. هذه الدالة تقوم بذلك.
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, "base64");

  // 1. بدء جلسة الرفع
  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(binaryData.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
  });
  if (!initRes.ok) throw new Error(`Gemini init failed: ${JSON.stringify(await parseJsonSafe(initRes))}`);
  
  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload session URL is missing");

  // 2. رفع البيانات الفعلية وإنهاء الجلسة
  const uploadRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(binaryData.byteLength),
    },
    body: binaryData,
  });
  const metadata = await parseJsonSafe(uploadRes);
  if (!uploadRes.ok) throw new Error(`Gemini finalize failed: ${JSON.stringify(metadata)}`);
  
  return { uri: metadata?.file?.uri, mime: metadata?.file?.mime_type || mimeType };
}

// --- المرحلة الأولى: تجميع البيانات السريرية باستخدام Gemini ---
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });

  // رفع كل ملف على حدة والحصول على مرجع له
  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "unnamed_file", mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }

  if (userParts.length === 0) userParts.push({ text: "لا يوجد نص أو ملفات لتحليلها." });

  // هذا هو الـ Prompt الذي يوجه Gemini ليكون "مجمّع بيانات" وليس "ملخّص"
  const systemPrompt = `You are an expert in medical data extraction. Your task is to meticulously read all provided inputs (text and files, which may include handwritten notes, lab results, and reports). Your goal is to extract and combine ALL clinical information into a single, comprehensive, and clean text block. Ensure you extract every single medication, lab result, procedure, diagnosis, and symptom mentioned across all sources. Do not summarize, interpret, or omit any details. Just present the raw, aggregated facts.`;
  
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
  };

  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);
  
  // تجميع كل أجزاء النص من الرد في متغير واحد
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
}

// --- المرحلة الثانية: تعليمات المدقق الخبير لـ GPT-4o ---
function getExpertAuditorInstructions(lang = 'ar') {
  const langRule = lang === 'en' 
    ? "**Language Rule: All outputs MUST be in clear, professional English.**"
    : "**قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية.**";

  // هذا الـ Prompt هو "العقل" للنظام. إنه يحول GPT-4o إلى خبير حقيقي.
  return `You are an expert, evidence-based clinical pharmacist and medical auditor. Your mission is to deeply analyze the following case, applying strict clinical and pharmaceutical rules.

**Primary Knowledge Base (Your analysis MUST conform to these guidelines):**
* **Heart Failure:** AHA/ACC/HFSA 2022 Guidelines, ESC 2021 Guidelines.
* **Diabetes in CKD:** KDIGO 2022 Clinical Practice Guideline.
* **General Diabetes:** ADA Standards of Care 2024/2025.
* **Hypertension:** ESC 2023 & ACC 2024 Guidelines.
* **Specific Drugs & Risks:** StatPearls, FDA/PMC reviews, official SmPC for drugs.

**Mandatory Analysis Rules:**
1.  **Pharmaceutical Analysis (Dose, Duration, Monitoring):**
    * For each medication, analyze its **dose, frequency, and duration**.
    * **Excessive Duration:** Flag any chronic medication prescribed for more than 30 days in an initial or acute visit as "معرض للرفض". Justification: "Long duration requires re-evaluation after initial stabilization."
    * **Incorrect Dosing:** Check if the dose is appropriate for the patient's condition (e.g., age, kidney function). Flag incorrect doses as "قابل للرفض".
    * **Missing Monitoring Labs:** For drugs requiring monitoring (e.g., statins need LFTs; ACEi/ARBs need Creatinine/K+), check if these labs were ordered. If not, add an **Urgent** recommendation to order them.
2.  **Apply A-priori Clinical Knowledge (Strict Rules):**
    * **IV Fluids in ADHF:** Strongly contraindicated unless there is documented hypotension or hypoperfusion. Flag as a major error.
    * **NSAIDs (e.g., Ibuprofen) in HF & CKD:** To be avoided. Flag as a major clinical risk.
    * **Metformin in CKD:** Must be stopped or dose-adjusted based on eGFR (contraindicated if eGFR < 30, caution if 30-45).
3.  **Proactive Standard of Care Analysis (Think about what's MISSING):**
    * **ADHF Diagnosis:** A BNP or NT-proBNP lab test is a Class 1 recommendation. If missing, recommend it urgently.
    * **Diabetes Care:** Check for standard of care items like referral for a fundus exam (ADA).
    * **Polypharmacy:** Identify and recommend stopping any unnecessary or duplicative medications.

${langRule}

**Output ONLY JSON with the following exact schema:**
{
  "patientSummary": {"text": "string"},
  "overallAssessment": {"text": "string"},
  "table": [
    {
      "name": "string",
      "itemType": "lab"|"medication"|"procedure"|"device"|"imaging",
      "doseRegimen": "string|null",
      "durationDays": "number|null",
      "intendedIndication": "string|null",
      "riskAnalysis": {
        "clinicalValidity": {"score": "number", "reasoning": "string"},
        "documentationStrength": {"score": "number", "reasoning": "string"},
        "financialImpact": {"score": "number", "reasoning": "string"}
      },
      "overallRiskPercent": "number",
      "insuranceDecision": {"label": "مقبول"|"معرض للرفض"|"قابل للرفض"|"إيقاف مؤقت / إعادة تقييم"|"Accepted"|"Subject to Rejection"|"Rejected"|"Temporary Stop / Re-evaluate", "justification": "string"}
    }
  ],
  "recommendations": [
    { "priority": "عاجلة"|"أفضل ممارسة"|"Urgent"|"Best Practice", "description": "string", "relatedItems": ["string"] }
  ]
}
ONLY JSON.`;
}

// دالة للتواصل مع OpenAI والحصول على رد JSON منظم
async function getAuditFromOpenAI(bundle, lang) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: getExpertAuditorInstructions(lang) },
        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" }, // لضمان أن الرد يكون دائماً بصيغة JSON
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

// --- عارض التقرير المتقدم (HTML Renderer) ---
// هذا الجزء يحول بيانات JSON إلى تقرير HTML تفاعلي وجميل
function renderHtmlReport(structuredData) {
  const s = structuredData;
  const getDecisionColor = (label) => {
    switch (label) {
      case 'مقبول': case 'Accepted': return '#2e7d32';
      case 'معرض للرفض': case 'Subject to Rejection': case 'إيقاف مؤقت / إعادة تقييم': case 'Temporary Stop / Re-evaluate': return '#f9a825';
      case 'قابل للرفض': case 'Rejected': return '#e53935';
      default: return '#64748b';
    }
  };

  const tableRows = (s.table || []).map(r => `
    <tr>
      <td>
        <div class="item-name">${r.name || '-'}</div>
        <div class="item-type">${r.itemType || ''}</div>
      </td>
      <td>${(r.itemType === 'medication' && r.doseRegimen) ? r.doseRegimen : '-'}</td>
      <td>${r.intendedIndication || '-'}</td>
      <td><span class="decision-badge" style="background-color:${getDecisionColor(r.insuranceDecision?.label)};">${r.insuranceDecision?.label || '-'}</span></td>
      <td>${r.insuranceDecision?.justification || '-'}</td>
    </tr>
  `).join("");

  const recommendationsList = (s.recommendations || []).map(rec => `
    <div class="rec-item">
      <span class="rec-priority ${rec.priority === 'عاجلة' || rec.priority === 'Urgent' ? 'urgent' : 'best-practice'}">${rec.priority}</span>
      <div class="rec-desc">${rec.description}</div>
      ${rec.relatedItems && rec.relatedItems.length > 0 ? `<div class="rec-related">مرتبط بـ: ${rec.relatedItems.join(', ')}</div>` : ''}
    </div>
  `).join("");

  return `
  <style>
    body { direction: rtl; font-family: 'Tajawal', sans-serif; }
    .report-section { border: 1px solid #e0e0e0; border-radius: 12px; margin-bottom: 24px; padding: 20px; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .report-section h2 { font-size: 22px; color: #0d47a1; margin: 0 0 16px; display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; }
    .report-section h2 svg { width: 26px; height: 26px; fill: #1a73e8; }
    .summary-text { font-size: 16px; line-height: 1.8; color: #333; }
    .audit-table { width: 100%; border-collapse: collapse; }
    .audit-table th, .audit-table td { padding: 14px 12px; text-align: right; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
    .audit-table th { background-color: #f5f7f9; color: #0d47a1; font-weight: 600; font-size: 14px; }
    .audit-table tr:last-child td { border-bottom: none; }
    .audit-table tr:hover { background-color: #f8f9fa; }
    .item-name { font-weight: 600; color: #202124; margin-bottom: 4px; }
    .item-type { font-size: 12px; color: #5f6368; }
    .decision-badge { color: #fff; font-weight: 600; padding: 5px 10px; border-radius: 16px; font-size: 13px; display: inline-block; }
    .rec-item { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; padding: 12px; border-radius: 8px; background: #f8f9fa; }
    .rec-priority { flex-shrink: 0; font-weight: 700; padding: 4px 10px; border-radius: 8px; font-size: 12px; color: #fff; }
    .rec-priority.urgent { background: #ea4335; }
    .rec-priority.best-practice { background: #34a853; }
    .rec-desc { color: #333; }
    .rec-related { font-size: 11px; color: #5f6368; margin-top: 4px; }
  </style>
  <div class="report-section">
    <h2><svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>ملخص الحالة والتقييم العام</h2>
    <p class="summary-text">${s.patientSummary?.text || 'غير متوفر.'}</p>
    <p class="summary-text">${s.overallAssessment?.text || 'غير متوفر.'}</p>
  </div>
  <div class="report-section">
    <h2><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 16H6c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1zM8 11h8v2H8zm0-4h8v2H8z"/></svg>التحليل التفصيلي للطلبات</h2>
    <table class="audit-table"><thead><tr><th>الطلب</th><th>الجرعة</th><th>المؤشر</th><th>قرار التأمين</th><th>التبرير</th></tr></thead><tbody>${tableRows}</tbody></table>
  </div>
  <div class="report-section">
    <h2><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2h-2zm2-4h-2V7h2v6z"/></svg>التوصيات والإجراءات المقترحة</h2>
    ${recommendationsList}
  </div>
  `;
}

// --- معالج الطلبات الرئيسي (API Handler) ---
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    if (!OPENAI_API_KEY) return bad(res, 500, "Server Configuration Error: Missing OPENAI_API_KEY");
    if (!GEMINI_API_KEY) return bad(res, 500, "Server Configuration Error: Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body || {};
    
    // --- خط سير العمل ---
    // الخطوة 1: استخلاص وتجميع كل البيانات السريرية من النصوص والملفات باستخدام Gemini.
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };

    // الخطوة 2: إجراء التدقيق العميق والتحليل الخبير باستخدام GPT-4o.
    const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);
    
    // الخطوة 3: تحويل نتيجة JSON المعقدة إلى تقرير HTML غني وواضح.
    const htmlReport = renderHtmlReport(structuredAudit);
    
    // إرجاع كل من التقرير المرئي (HTML) والبيانات المنظمة (JSON)
    return ok(res, { html: htmlReport, structured: structuredAudit });

  } catch (err) {
    console.error("/api/clinical-audit error:", err);
    return bad(res, 500, err?.message || String(err));
  }
}
