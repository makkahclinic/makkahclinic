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

// --- المرحلة الأولى: تجميع البيانات السريرية باستخدام Gemini (V5) ---
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

  const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every single piece of clinical information into a clean, comprehensive text block.
  **CRITICAL RULES:**
  1.  **DO NOT SUMMARIZE.** Transcribe everything.
  2.  For each document/file, first identify and state the **Date of Visit** clearly.
  3.  Under each date, list all patient details, complaints, vital signs, diagnoses, and every single lab test, medication, and procedure mentioned in that document.
  4.  This creates a chronological record of the patient's journey. Do not merge data from different dates.
  5.  Present the information in a clear, structured manner.`;
  
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

// --- المرحلة الثانية: تعليمات المدقق الخبير لـ GPT-4o (نسخة مطورة بعمق V6) ---
function getExpertAuditorInstructions(lang = 'ar') {
  const langRule = lang === 'en' 
    ? "**Language Rule: All outputs MUST be in clear, professional English.**"
    : "**قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى الواضحة والمهنية.**";

  // **تحسين جوهري V6**: إضافة منطق تحليل التفاعلات الدوائية المتقدم.
  return `You are an expert, evidence-based clinical pharmacist and medical auditor. Your mission is to deeply analyze the following case, applying strict clinical reasoning and insurance reimbursement rules.

**Primary Knowledge Base (Your analysis MUST conform to these guidelines):**
* **Pharmacology & Pharmacokinetics:** Use guidelines like KDIGO for renal dose adjustments. For every medication, you MUST cross-reference it with the patient's diagnoses and available lab values.
* **Cardiology:** AHA/ACC/ESC Guidelines.
* **Endocrinology:** ADA Standards of Care.
* **Reimbursement & Utilization:** Focus on Medical Necessity, Duplication, and Contraindications.

**Mandatory Analysis Rules & Reasoning Logic:**
1.  **Drug-Disease Interaction Analysis (CRITICAL):**
    * For every prescribed medication, check against the patient's list of diagnoses for any contraindications or necessary precautions.
    * **Example:** If a patient has "Renal Failure" or "CKD" and is prescribed "Levofloxacin", you MUST flag this as **"تعارض دوائي-مرضي"**.
    * The justification must be clinical and precise: "دواء ليفوفلوكساسين يتطلب تعديل الجرعة في مرضى القصور الكلوي. يجب حساب معدل الترشيح الكبيبي (eGFR) قبل إعطاء الدواء لتجنب السمية."
2.  **Missing Pre-requisite Labs:**
    * If a drug requires a specific lab for safe administration (like GFR for Levofloxacin, or K+ for Spironolactone) and that lab is missing, you MUST flag the **missing lab** as a **"إغفال خطير"**.
3.  **Analyze the Timeline & Repetition:**
    * **Unjustified Repetition:** If a routine test is repeated without a clear clinical change, flag it as **"تكرار يتطلب تبريرًا"**.
    * **Duplicates within a visit:** If an item is listed multiple times on the SAME DAY, flag it as **"إجراء مكرر"**.
4.  **Assess Medical Necessity & Correctness:**
    * **Clinically Inappropriate Actions:** (e.g., Normal Saline in a hypertensive patient).
    * **Incorrect Test Selection:** (e.g., Dengue IgG for acute symptoms).
5.  **Proactive Standard of Care Analysis (Identify what is MISSING):**
    * Identify **Critical Omissions** (like missing ECG/Troponin for relevant symptoms).
    * Identify **Best Practice Omissions** (like missing referrals).
6.  **Generate DEEPLY DETAILED Recommendations:** Recommendations must be specific, actionable, and educational.

${langRule}

**Output ONLY JSON with the following exact schema:**
{
  "patientSummary": {"text": "A detailed summary of the patient's presentation, vitals, and diagnoses over the entire period."},
  "overallAssessment": {"text": "Your expert overall opinion on the quality of care, highlighting major correct decisions, critical omissions, and patterns of care like test repetition and drug-disease interactions."},
  "table": [
    {
      "name": "string",
      "itemType": "lab"|"medication"|"procedure",
      "status": "تم إجراؤه"|"مفقود ولكنه ضروري",
      "analysisCategory": "صحيح ومبرر"|"إجراء مكرر"|"تكرار يتطلب تبريرًا"|"غير مبرر طبياً"|"إجراء يتعارض مع التشخيص"|"تعارض دوائي-مرضي"|"إغفال خطير",
      "insuranceDecision": {"label": "مقبول"|"مرفوض"|"معلق", "justification": "string"}
    }
  ],
  "recommendations": [
    { "priority": "عاجلة"|"أفضل ممارسة"|"للمراجعة", "description": "string", "relatedItems": ["string"] }
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

// --- عارض التقرير المتقدم (HTML Renderer) - نسخة مطورة V6 ---
function renderHtmlReport(structuredData) {
  const s = structuredData;
  const getDecisionStyle = (label) => {
    switch (label) {
      case 'مقبول': return 'background-color: #e6f4ea; color: #1e8e3e;'; // Green
      case 'معلق': return 'background-color: #fff0e1; color: #e8710a;'; // Yellow
      case 'مرفوض': return 'background-color: #fce8e6; color: #d93025;'; // Red
      default: return 'background-color: #e8eaed; color: #3c4043;';
    }
  };
  const getCategoryIcon = (category) => {
      switch (category) {
          case 'صحيح ومبرر': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#1e8e3e"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
          case 'إجراء مكرر': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#e8710a"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`;
          case 'تكرار يتطلب تبريرًا': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#e8710a"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-5h2v2h-2zm0-8h2v6h-2z"/></svg>`;
          case 'غير مبرر طبياً': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#e8710a"><path d="M12 5.99L19.53 19H4.47L12 5.99M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z"/></svg>`;
          case 'إجراء يتعارض مع التشخيص': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#d93025"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
          case 'تعارض دوائي-مرضي': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#d93025"><path d="M21.9,8.88l-7.7-7.7a.5.5,0,0,0-.71,0L.29,14.39a.5.5,0,0,0,0,.71l7.7,7.7a.5.5,0,0,0,.71,0l13.2-13.2A.5.5,0,0,0,21.9,8.88ZM9.11,15.2,3,9.1,14.39,3,20.5,9.11Z"/></svg>`;
          case 'إغفال خطير': return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#d93025"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`;
          default: return '';
      }
  }

  const tableRows = (s.table || []).map(r => `
    <tr>
      <td>
        <div class="item-name">${r.name || '-'}</div>
        <div class="item-category">
          ${getCategoryIcon(r.analysisCategory)}
          <span>${r.analysisCategory || ''}</span>
        </div>
      </td>
      <td>${r.status || '-'}</td>
      <td><span class="decision-badge" style="${getDecisionStyle(r.insuranceDecision?.label)}">${r.insuranceDecision?.label || '-'}</span></td>
      <td>${r.insuranceDecision?.justification || '-'}</td>
    </tr>
  `).join("");

  const recommendationsList = (s.recommendations || []).map(rec => `
    <div class="rec-item ${rec.priority === 'عاجلة' ? 'urgent-border' : (rec.priority === 'للمراجعة' ? 'review-border' : 'best-practice-border')}">
      <span class="rec-priority ${rec.priority === 'عاجلة' ? 'urgent' : (rec.priority === 'للمرا
