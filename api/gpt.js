// pages/api/gpt.js

/** ============ ضبط حجم الجسم ============ */
export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

/** ============ مفاتيح البيئة ============ 
 * ضع القيم في .env.local (خادم فقط):
 * OPENAI_API_KEY=sk-...
 * OPENAI_MODEL=gpt-4o-mini
 * GEMINI_API_KEY=AIza...
 * GEMINI_MODEL=gemini-1.5-pro-latest
 */
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

/** ============ أدوات مساعدة ============ */
const ok = (res, json) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, ...json });
};
const bad = (res, code, msg) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json({ ok: false, error: msg });
};
async function parseJsonSafe(response) {
  const ct = response.headers.get("content-type") || "";
  return ct.includes("application/json") ? response.json() : { raw: await response.text() };
}

/** ============ رفع الملفات إلى Gemini (جلسة Resumable) ============ */
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, "base64");

  // 1) بدء الجلسة
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

  // 2) رفع + إنهاء
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

/** ============ المرحلة 1: تجميع سريري مُحايد (Gemini) ============ */
async function aggregateClinicalDataWithGemini({ text, files, caseId }) {
  const userParts = [];
  if (text) userParts.push({ text });

  // نرفع كل ملف ونضيف مرجعَه للرسالة
  for (const f of files || []) {
    if (!f?.data) continue;
    const { uri, mime } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: f?.mimeType || "application/octet-stream",
      base64: f.data,
    });
    userParts.push({ file_data: { file_uri: uri, mime_type: mime } });
  }
  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  // ضمان عزل الحالة
  const systemPrompt = `
You are a meticulous medical transcription engine.
STRICT CASE ISOLATION: Only use the inputs attached to CASE_ID=${caseId}. Ignore any memory or prior cases.
Rules:
1) DO NOT summarize; transcribe ALL clinical details verbatim into structured text.
2) List every diagnosis, lab value, imaging, procedure, and each medication with dosage/frequency/duration as written.
3) Produce clean, well-ordered Arabic text blocks that are easy to parse downstream.
  `.trim();

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
  };

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);

  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
}

/** ============ المرحلة 2: التدقيق الإكلينيكي العميق (OpenAI) ============ */
function getExpertAuditorInstructions(lang = "ar", { caseId } = {}) {
  const schema = {
    meta: { caseId: "string" },
    summary: {
      caseOverview: "ملخص موجز للحالة الحالية بالأدلة الأساسية.",
      keyFindings: ["نقطة أساسية 1", "نقطة أساسية 2"],
    },
    diagnoses: {
      primary: "التشخيص الرئيسي بوضوح",
      secondary: ["قائمة التشاخيص الثانوية (إن وجدت)"],
      certaintyNotes: "ملاحظات حول درجة اليقين والتشخيصات التفريقية.",
    },
    risksAndConflicts: {
      redFlags: ["أعراض/مؤشرات إنذارية"],
      guidelineOmissions: ["فحوصات/إجراءات واجبة ولم تُذكر"],
      drugDrugConflicts: ["تعارضات دوائية محددة بالاسمين"],
      doseOrDurationErrors: ["أخطاء جرعة/تكرار/مدة مع السبب"],
      notMedicallyNecessary: ["بنود غير مبررة طبياً مع السبب"],
    },
    table: [
      {
        name: "string",
        dosage_written: "string",
        itemType: "lab|medication|procedure|omission",
        status: "تم إجراؤه|مفقود ولكنه ضروري",
        analysisCategory:
          "صحيح ومبرر|إجراء مكرر|غير مبرر طبياً|إجراء يتعارض مع التشخيص|تعارض دوائي|إغفال خطير|خطأ في الجرعة أو التكرار|الكمية تحتاج لمراجعة",
        insuranceDecision: { label: "مقبول|مرفوض|لا ينطبق", justification: "string" },
      },
    ],
    recommendations: [
      { priority: "عاجلة|أفضل ممارسة", description: "الإجراء المقترح مع السبب", relatedItems: ["أسماء عناصر من الجدول"] },
    ],
  };

  return `
أنت مدقق إكلينيكي مبني على الدليل (صيدلي سريري + طب أسرة) مهمتك تقديم مخرجات عربية احترافية.
STRICT CASE ISOLATION: حلّل فقط البيانات الخاصة بـ CASE_ID=${caseId}. تجاهل أي حالة أخرى.

قاعدة معرفية مختصرة يجب الاستناد إليها عند اللزوم:
- القلبية: إرشادات AHA/ACC/ESC.
- السكري: ADA Standards of Care (فحص قاع العين سنويًا لسكري النوع 2).
- الجرعات: Diamicron MR (Gliclazide MR) جرعته القياسية مرة واحدة يوميًا.
- السداد التأميني: الضرورة الطبية، التكرار، التعارضات، والكميات غير المعتادة.

قواعد إلزامية للمخرجات:
0) أعِد JSON صالح فقط وفق المخطط أدناه. لا تضف نصًا خارج JSON.
1) ابدأ بتلخيص الحالة بوضوح ثم التشخيص الرئيسي والثانوي.
2) استخرج المخاطر/التعارضات والأخطاء والـ Omissions.
3) أنشئ جدولاً يغطي **كل** فحص/دواء/إجراء مذكور أو واجب ولم يُذكر (omission).
4) لكل دواء املأ الحقل dosage_written كما هو من النص المجمع.
5) طبّق "قاعدة 90 يومًا": إن كانت الوصفة 90 يومًا دون إثبات ثبات الحالة ⇒ "الكمية تحتاج لمراجعة".
6) اللغة عربية فصحى مهنية، موجزة وواضحة.

المخطط المطلوب:
${JSON.stringify(schema, null, 2)}
`.trim();
}

async function getAuditFromOpenAI({ bundle, lang, caseId }) {
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: getExpertAuditorInstructions(lang, { caseId }) },
        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" },
      // max_tokens: 2000 // فعّلها إذا رغبت بتقييد صارم
    }),
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);

  const json = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
  return json;
}

/** ============ المرحلة 3: توليد HTML موحّد على الخادم ============ */
function riskClass(cat = "") {
  const s = (cat || "").toLowerCase();
  if (
    s.includes("إغفال") ||
    s.includes("omission") ||
    s.includes("يتعارض") ||
    s.includes("تعارض") ||
    s.includes("duplicate") ||
    s.includes("خطأ")
  )
    return "risk-critical";
  if (s.includes("غير مبرر") || s.includes("تحتاج لمراجعة") || s.includes("review")) return "risk-warning";
  if (s.includes("صحيح") || s.includes("correct")) return "risk-ok";
  return "";
}
function decisionBadge(label) {
  const base =
    "font-weight:700;padding:5px 10px;border-radius:16px;font-size:13px;display:inline-block;border:1px solid transparent;";
  if (label === "مقبول") return base + "background:#e6f4ea;color:#1e8e3e";
  if (label === "مرفوض") return base + "background:#fce8e6;color:#d93025";
  return base + "background:#e8eaed;color:#5f6368";
}

function renderHtmlReport(structured) {
  const s = structured || {};
  const diagList = [
    s?.diagnoses?.primary ? `<li><b>التشخيص الرئيسي:</b> ${s.diagnoses.primary}</li>` : "",
    ...(Array.isArray(s?.diagnoses?.secondary)
      ? s.diagnoses.secondary.map((d) => `<li>ثانوي: ${d}</li>`)
      : []),
  ].join("");

  const risks = s?.risksAndConflicts || {};
  const risksBlocks = [
    ["علامات إنذارية", risks.redFlags],
    ["نواقص قياسية (Omissions)", risks.guidelineOmissions],
    ["تعارضات دوائية", risks.drugDrugConflicts],
    ["أخطاء جرعة/مدة", risks.doseOrDurationErrors],
    ["غير مبرَّر طبياً", risks.notMedicallyNecessary],
  ]
    .map(([title, arr]) =>
      Array.isArray(arr) && arr.length
        ? `<div style="margin-bottom:8px"><b>${title}:</b><ul style="margin:6px 18px">${arr
            .map((x) => `<li>${x}</li>`)
            .join("")}</ul></div>`
        : ""
    )
    .join("");

  const rows = (s.table || [])
    .map(
      (r) => `
      <tr class="${riskClass(r.analysisCategory)}">
        <td><div style="font-weight:700">${r.name || "-"}</div><small style="color:#5f6368">${
        r.analysisCategory || ""
      }</small></td>
        <td style="font-family:monospace">${r.dosage_written || "-"}</td>
        <td>${r.status || "-"}</td>
        <td><span style="${decisionBadge(r?.insuranceDecision?.label)}">${
        r?.insuranceDecision?.label || "-"
      }</span></td>
        <td>${(r?.insuranceDecision && r.insuranceDecision.justification) || "-"}</td>
      </tr>`
    )
    .join("");

  const recs =
    (s.recommendations || [])
      .map(
        (rec) => `
      <div style="display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:8px;background:#f8fafc;border-right:4px solid ${
        (rec.priority || "").includes("عاجلة") ? "#d93025" : "#1e8e3e"
      };margin-bottom:12px">
        <span style="font-weight:700;padding:4px 10px;border-radius:8px;font-size:12px;color:#fff;background:${
          (rec.priority || "").includes("عاجلة") ? "#d93025" : "#1e8e3e"
        }">${rec.priority || ""}</span>
        <div><div>${rec.description || ""}</div>${
          rec.relatedItems?.length
            ? `<div style="font-size:12px;color:#5f6368;margin-top:6px">مرتبط بـ: ${rec.relatedItems.join(", ")}</div>`
            : ""
        }</div>
      </div>`
      )
      .join("") || '<div style="color:#64748b">لا توجد توصيات.</div>';

  return `
  <style>
    .audit-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
    .audit-table th,.audit-table td{padding:12px;text-align:right;border-bottom:1px solid #e5e7eb;vertical-align:top;word-wrap:break-word}
    .audit-table th{background:#f8fafc}
    .risk-critical td{background:#fce8e6}.risk-warning td{background:#fff0e1}.risk-ok td{background:#e6f4ea}
  </style>

  <div class="report-section">
    <h2 style="font-size:20px;font-weight:700;color:#0d47a1;border-bottom:2px solid #1a73e8;padding-bottom:8px;margin-top:0">تلخيص الحالة</h2>
    <p>${s?.summary?.caseOverview || "غير متوفر."}</p>
    ${
      Array.isArray(s?.summary?.keyFindings) && s.summary.keyFindings.length
        ? `<ul style="margin:6px 18px">${s.summary.keyFindings.map((x) => `<li>${x}</li>`).join("")}</ul>`
        : ""
    }
  </div>

  <div class="report-section">
    <h2 style="font-size:20px;font-weight:700;color:#0d47a1;border-bottom:2px solid #1a73e8;padding-bottom:8px">التشخيص</h2>
    <ul style="margin:6px 18px">${diagList || "<li>غير محدد.</li>"}</ul>
    <div style="color:#475569">${s?.diagnoses?.certaintyNotes || ""}</div>
  </div>

  <div class="report-section">
    <h2 style="font-size:20px;font-weight:700;color:#0d47a1;border-bottom:2px solid #1a73e8;padding-bottom:8px">المخاطر والتعارضات</h2>
    ${risksBlocks || '<div style="color:#64748b">لا توجد ملاحظات حرجة.</div>'}
  </div>

  <div class="report-section">
    <h2 style="font-size:20px;font-weight:700;color:#0d47a1;border-bottom:2px solid #1a73e8;padding-bottom:8px">التحليل التفصيلي للإجراءات/الأدوية</h2>
    <div style="overflow-x:auto">
      <table class="audit-table">
        <thead><tr><th style="width:28%">الإجراء</th><th style="width:15%">الجرعة المكتوبة</th><th style="width:15%">الحالة</th><th style="width:15%">قرار التأمين</th><th style="width:27%">التبرير</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>

  <div class="report-section">
    <h2 style="font-size:20px;font-weight:700;color:#0d47a1;border-bottom:2px solid #1a73e8;padding-bottom:8px">التوصيات الإكلينيكية</h2>
    ${recs}
  </div>
  `;
}

/** ============ API Handler ============ */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY)
      return bad(res, 500, "Server configuration error: API keys are missing.");

    const { text = "", files = [], patientInfo = null, lang = "ar", caseId } = req.body || {};
    const safeCaseId = caseId || String(Date.now());

    // 1) تجميع محايد من Gemini
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files, caseId: safeCaseId });

    // 2) تدقيق عميق من OpenAI (بدون ذاكرة — رسائل هذه الطلبية فقط)
    const auditBundle = { caseId: safeCaseId, patientInfo, aggregatedClinicalText, originalUserText: text };
    const structured = await getAuditFromOpenAI({ bundle: auditBundle, lang, caseId: safeCaseId });

    // 3) HTML موحّد
    const html = renderHtmlReport(structured);

    return ok(res, { html, structured, caseId: safeCaseId });
  } catch (err) {
    console.error("API /api/gpt error:", err);
    return bad(res, 500, `Internal error: ${err.message || "unknown"}`);
  }
}
