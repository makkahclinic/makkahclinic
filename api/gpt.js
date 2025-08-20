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

// --- المرحلة الأولى: تجميع البيانات السريرية باستخدام Gemini (نسخة مطورة) ---
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });

  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "unnamed_file", mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }

  if (userParts.length === 0) userParts.push({ text: "لا يوجد نص أو ملفات لتحليلها." });

  // **تحسين جوهري**: الـ Prompt الآن أكثر صرامة ويطلب تحديد التكرار.
  const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every single piece of clinical information into a clean, comprehensive text block.
  **CRITICAL RULES:**
  1.  **DO NOT SUMMARIZE.** Transcribe everything.
  2.  Extract all patient details, complaints, vital signs (BP, Temp, etc.), diagnoses, and ICD codes.
  3.  List every single lab test, medication, and procedure mentioned.
  4.  **If an item is listed more than once, explicitly state it.** For example: "DENGUE AB IGG (Listed 2 times)".
  5.  Present the information in a clear, structured manner. Do not interpret or analyze. Just transcribe the facts as they are presented.`;
  
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
  
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
}

// --- المرحلة الثانية: تعليمات المدقق الخبير لـ GPT-4o (نسخة مطورة بعمق) ---
function getExpertAuditorInstructions(lang = 'ar') {
  const langRule = lang === 'en' 
    ? "**Language Rule: All outputs MUST be in clear, professional English.**"
    : "**قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية.**";

  // **تحسين جوهري**: هذا الـ Prompt هو "العقل" الجديد للنظام. إنه يحول GPT-4o إلى فريق من الخبراء.
  return `You are an expert, evidence-based clinical pharmacist and medical auditor. Your mission is to deeply analyze the following case, applying strict clinical and insurance reimbursement rules.

**Primary Knowledge Base (Your analysis MUST conform to these guidelines):**
* **Heart Failure & ACS:** AHA/ACC/HFSA 2022/2023 Guidelines. An ECG is mandatory for epigastric pain in high-risk patients.
* **Diabetes in CKD:** KDIGO 2022 Clinical Practice Guideline.
* **General Diabetes:** ADA Standards of Care 2024/2025. Fundus exam referral is standard of care.
* **Hypertension:** ESC 2023 & ACC 2024 Guidelines.
* **Reimbursement Rules:** Focus on Medical Necessity. A procedure or test without a clear supporting symptom or diagnosis is considered unnecessary.

**Mandatory Analysis Rules:**
1.  **Identify ALL items:** Scrutinize the aggregated text and list every single medication, lab, and procedure.
2.  **Detect Duplicates:** If an item is listed more than once, flag it as "إجراء مكرر" and mark it for rejection.
3.  **Assess Medical Necessity:** For each item, ask "Is this justified by the patient's complaints and diagnosis?".
    * Example: A Dengue Fever test for a patient with no travel history, fever pattern, or rash is medically unnecessary. Flag it as "غير مبرر طبياً".
    * Example: A nebulizer session for a patient with no respiratory symptoms is medically unnecessary.
4.  **Pharmaceutical Analysis (Dose, Duration, Monitoring):**
    * **Excessive Duration:** Flag any chronic medication prescribed for more than 30 days in an initial visit as "معرض للرفض". Justification: "Long duration requires re-evaluation."
    * **Missing Monitoring Labs:** For drugs like statins or ACEi/ARBs, check if required monitoring labs (LFTs, Creatinine/K+) were ordered. If not, add an **Urgent** recommendation.
5.  **Proactive Standard of Care Analysis (Identify what is MISSING):**
    * **Cardiac Risk:** For a 60-year-old patient with DM, HTN, and epigastric pain, an **ECG** and **cardiac enzymes (Troponin)** are **MANDATORY** to rule out an acute coronary syndrome (ACS). Flag their absence as a critical omission.
    * **Diabetes Care:** Check for a fundus exam referral.
    * **Specialist Referrals:** Based on the diagnoses (HTN, DM with neuropathy), recommend referrals to **Cardiology**, **Endocrinology**, and **Ophthalmology**.

${langRule}

**Output ONLY JSON with the following exact schema:**
{
  "patientSummary": {"text": "A detailed summary of the patient's presentation, vitals, and diagnoses."},
  "overallAssessment": {"text": "Your expert overall opinion on the quality of care, highlighting major correct decisions and critical omissions."},
  "table": [
    {
      "name": "string",
      "itemType": "lab"|"medication"|"procedure",
      "status": "تم إجراؤه"|"مفقود ولكنه ضروري",
      "analysisCategory": "صحيح"|"إجراء مكرر"|"غير مبرر طبياً"|"إغفال خطير",
      "insuranceDecision": {"label": "مقبول"|"مرفوض"|"معرض للرفض", "justification": "string"}
    }
  ],
  "recommendations": [
    { "priority": "عاجلة"|"أفضل ممارسة", "description": "string", "relatedItems": ["string"] }
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
      response_format: { type: "json_object" },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

// --- عارض التقرير المتقدم (HTML Renderer) - نسخة مطورة V2 ---
function renderHtmlReport(structuredData) {
  const s = structuredData;
  const getDecisionStyle = (label) => {
    switch (label) {
      case 'مقبول': return 'background-color: #2e7d32;'; // Green
      case 'معرض للرفض': return 'background-color: #f9a825;'; // Yellow
      case 'مرفوض': return 'background-color: #d93025; color: #fff;'; // Red
      default: return 'background-color: #e8eaed; color: #3c4043;';
    }
  };
  const getCategoryStyle = (category) => {
    switch (category) {
        case 'صحيح': return 'color: #2e7d32;';
        case 'إجراء مكرر':
        case 'غير مبرر طبياً': return 'color: #f9a825; font-weight: bold;';
        case 'إغفال خطير': return 'color: #d93025; font-weight: bold;';
        default: return '';
    }
  }

  const tableRows = (s.table || []).map(r => `
    <tr>
      <td>
        <div class="item-name">${r.name || '-'}</div>
        <div class="item-type" style="${getCategoryStyle(r.analysisCategory)}">${r.analysisCategory || ''}</div>
      </td>
      <td>${r.status || '-'}</td>
      <td><span class="decision-badge" style="${getDecisionStyle(r.insuranceDecision?.label)}">${r.insuranceDecision?.label || '-'}</span></td>
      <td>${r.insuranceDecision?.justification || '-'}</td>
    </tr>
  `).join("");

  const recommendationsList = (s.recommendations || []).map(rec => `
    <div class="rec-item">
      <span class="rec-priority ${rec.priority === 'عاجلة' ? 'urgent' : 'best-practice'}">${rec.priority}</span>
      <div class="rec-desc">${rec.description}</div>
      ${rec.relatedItems && rec.relatedItems.length > 0 ? `<div class="rec-related">مرتبط بـ: ${rec.relatedItems.join(', ')}</div>` : ''}
    </div>
  `).join("");

  return `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
    body { direction: rtl; font-family: 'Tajawal', sans-serif; background-color: #f8f9fa; }
    .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 24px; padding: 24px; background: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .report-section h2 { font-size: 22px; font-weight: 700; color: #0d47a1; margin: 0 0 16px; display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1a73e8; padding-bottom: 10px; }
    .report-section h2 svg { width: 28px; height: 28px; fill: #1a73e8; }
    .summary-text { font-size: 16px; line-height: 1.8; color: #3c4043; margin-bottom: 12px; }
    .audit-table { width: 100%; border-collapse: collapse; }
    .audit-table th, .audit-table td { padding: 16px 12px; text-align: right; border-bottom: 1px solid #e9ecef; vertical-align: top; }
    .audit-table th { background-color: #f1f3f5; color: #0d47a1; font-weight: 700; font-size: 14px; text-transform: uppercase; }
    .audit-table tr:last-child td { border-bottom: none; }
    .item-name { font-weight: 700; color: #202124; font-size: 15px; }
    .item-type { font-size: 13px; }
    .decision-badge { font-weight: 500; padding: 6px 12px; border-radius: 16px; font-size: 13px; display: inline-block; color: #fff; }
    .rec-item { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; padding: 14px; border-radius: 8px; background: #f1f3f5; border-right: 4px solid; }
    .rec-priority { flex-shrink: 0; font-weight: 700; padding: 5px 12px; border-radius: 8px; font-size: 12px; color: #fff; }
    .rec-priority.urgent { background: #d93025; }
    .rec-priority.best-practice { background: #1e8e3e; }
    .rec-item.urgent-border { border-color: #d93025; }
    .rec-item.best-practice-border { border-color: #1e8e3e; }
    .rec-desc { color: #202124; font-size: 15px; }
    .rec-related { font-size: 12px; color: #5f6368; margin-top: 6px; }
  </style>
  <div class="report-section">
    <h2><svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>ملخص الحالة والتقييم العام</h2>
    <p class="summary-text">${s.patientSummary?.text || 'غير متوفر.'}</p>
    <p class="summary-text">${s.overallAssessment?.text || 'غير متوفر.'}</p>
  </div>
  <div class="report-section">
    <h2><svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>التحليل التفصيلي للإجراءات</h2>
    <table class="audit-table"><thead><tr><th>الإجراء</th><th>الحالة</th><th>قرار التأمين</th><th>التبرير</th></tr></thead><tbody>${tableRows}</tbody></table>
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
    
    // --- خط سير العمل المطور ---
    // الخطوة 1: استخلاص وتجميع كل البيانات السريرية بدقة متناهية باستخدام Gemini.
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });
    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };

    // الخطوة 2: إجراء التدقيق العميق والتحليل الخبير باستخدام GPT-4o والتعليمات الجديدة.
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
