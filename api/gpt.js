// /pages/api/gpt.js
// Backend: Medical Deep Audit (Gemini OCR/vision → ChatGPT clinical audit) + HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

// ✅ تحديد حجم البودي للطلبات إلى 50 ميغابايت (قيمة ثابتة)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",   // الحد الجديد للطلبات الكبيرة
    },
  },
};

// ---------- CONFIG ----------
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // fast, strong reasoning
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro"; // robust vision/long-context
const GEMINI_GENERATE_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const MAX_FILES_PER_REQUEST = 10;            // يدعم 10 ملفات
const BODY_SIZE_LIMIT_MB = 25;               // يتوافق مع config أدناه
const INLINE_LIMIT_BYTES = 18 * 1024 * 1024; // <20MB نمرر inlineData، أكبر من كذا نرفع عبر Files API
const REQUEST_TIMEOUT_MS = 180_000;          // 3 دقائق
const RETRY_STATUS = new Set([408, 409, 413, 429, 500, 502, 503, 504]);

// ---------- NEXT CONFIG ----------
export const config = {
  api: {
    bodyParser: {
      sizeLimit: `${BODY_SIZE_LIMIT_MB}mb`,
    },
  },
};

// ---------- UTILITIES ----------
const withTimeout = (p, ms = REQUEST_TIMEOUT_MS) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);

const isDataUrl = (s = "") => s.startsWith("data:");
const normalizeBase64 = (s = "") =>
  isDataUrl(s) ? s.substring(s.indexOf("base64,") + 7) : s;
const bytesFromBase64 = (b64) => Buffer.from(b64, "base64");
const safeJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// ---------- GEMINI FILES API (RESUMABLE UPLOAD) ----------
async function geminiUploadFile({ buffer, mimeType, displayName }) {
  // REST resumable upload (see Google Gemini Files API docs)
  const startRes = await fetch(
    "https://generativelanguage.googleapis.com/upload/v1beta/files",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_API_KEY,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(buffer.byteLength),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName || "FILE" } }),
    }
  );

  if (!startRes.ok) {
    const t = await startRes.text();
    throw new Error(`Gemini upload start failed: ${startRes.status} ${t}`);
  }

  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini upload url missing");

  const finalizeRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(buffer.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: buffer,
  });

  if (!finalizeRes.ok) {
    const t = await finalizeRes.text();
    throw new Error(`Gemini upload finalize failed: ${finalizeRes.status} ${t}`);
  }

  const info = await finalizeRes.json(); // { file: { name, uri, mimeType, ... } }
  const file = info.file || info; // some SDK/REST variants
  return { fileUri: file.uri, mimeType: file.mimeType || mimeType, name: file.name };
}

// ---------- GEMINI OCR / VISION EXTRACTION ----------
async function geminiExtractBundle({ userText, files, patientInfo }) {
  // Build parts: prefer inlineData for <20MB, else upload and use file_data
  const parts = [];

  // Add files (images/pdf/ct/xray). Each item: { mimeType, data (base64) , name? }
  for (let i = 0; i < Math.min(files.length, MAX_FILES_PER_REQUEST); i++) {
    const f = files[i];
    const mimeType = f?.mimeType || "application/octet-stream";
    const base64 = normalizeBase64(f?.data || "");
    const buf = bytesFromBase64(base64);

    if (!base64 || !buf?.length) continue;

    const useInline = buf.byteLength <= INLINE_LIMIT_BYTES && mimeType !== "application/pdf";
    if (useInline) {
      parts.push({
        inline_data: { data: base64, mime_type: mimeType },
      });
    } else {
      // large or PDF → Files API
      const uploaded = await geminiUploadFile({
        buffer: buf,
        mimeType,
        displayName: f?.name || `doc_${i + 1}`,
      });
      parts.push({
        file_data: {
          file_uri: uploaded.fileUri,
          mime_type: uploaded.mimeType,
        },
      });
    }
  }

  // Include a clear extraction instruction (Arabic-first, fallback English).
  const systemInstruction =
    "أنت نظام OCR/رؤية طبية احترافي. استخرج بدقة عالية كل النصوص الطبية، الأدوية بجرعاتها ومددها، الإجراءات، الفحوصات، التشخيصات، العلامات الحيوية، وتعليقات الأشعة من جميع الملفات المرفوعة (صور/‏PDF/‏أشعّة). لا تُحلّل ولا تبدي رأيًا سريريًا هنا؛ فقط أعِد نصًا قابلًا للبحث + نقاط موجزة لنتائج الأشعة إذا وُجدت. إذا تعارضت ورقة مع أخرى، اذكر كلا السطرين كما هو دون ترجيح.";

  const extractionPrompt =
    [
      "Extract ALL textual/clinical content from the attached files.",
      "Return as clean plain text (Arabic if source is Arabic, else English).",
      "If medical imaging is present (X-ray/CT/MRI), include a short bullet list of key visual findings.",
      "Do NOT hallucinate. If unreadable handwriting, mark as [UNREADABLE SEGMENT].",
      "",
      "Also echo back the original user free-text below to allow later contradiction checks:",
      "---- USER_FREE_TEXT_START ----",
      userText || "(none)",
      "---- USER_FREE_TEXT_END ----",
      "",
      "Patient context (may help with abbreviated terms):",
      JSON.stringify(patientInfo || {}, null, 2),
    ].join("\n");

  const body = {
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    contents: [
      {
        role: "user",
        parts: [
          // files first (per Gemini best-practice)
          ...parts,
          { text: extractionPrompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };

  const url = `${GEMINI_GENERATE_URL(GEMINI_MODEL)}?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  // Retry wrapper
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await withTimeout(fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })).catch((e) => ({ ok: false, status: 599, _err: e }));

    if (resp.ok) {
      const json = await resp.json();
      const text =
        json?.candidates?.[0]?.content?.parts
          ?.map((p) => p?.text)
          ?.filter(Boolean)
          ?.join("\n") || "";
      return text.trim();
    }
    if (!RETRY_STATUS.has(resp.status)) {
      const t = resp._err ? String(resp._err) : await resp.text().catch(() => "");
      throw new Error(`Gemini extraction failed: ${resp.status} ${t}`);
    }
  }
  throw new Error("Gemini extraction failed after retries");
}

// ---------- OPENAI DEEP AUDIT (STRUCTURED JSON) ----------
function buildOpenAIInstructions(mode = "clinical_audit") {
  return `
أنت استشاري تدقيق طبي وتأميني. حلّل معطيات المريض + نصوص OCR (من الملفات) + النص الحر.
أخرج JSON فقط، بلا أي نص خارجه.

قواعد صارمة للتقييم:
- صنّف كل بند: itemType = lab | medication | procedure | device | imaging.
- intendedIndication = المؤشّر السريري المتوقع. isIndicationDocumented = هل المؤشّر مذكور فعليًا في المعطيات.
- احسب riskPercent وفق العتبات:
  <60 = "مقبول" (أخضر) — المؤشّر واضح ولا تعارض مهم.
  60–74 = "قابل للرفض – يحتاج تبرير" (أصفر) — المؤشّر غير مكتمل أو يوجد بديل أقل تدخّلًا.
  ≥75 = "مرفوض" (أحمر) — لا مؤشّر/تعارض واضح/تكرار غير مبرَّر.
- املأ insuranceDecision.justification بتعليل سريري محدّد (ليس عامًا) يذكر لماذا القبول/الرفض وما المطلوب لقبول البند.
- إذا تكرّر نفس البند في الملفات، اعتبره تعارضًا وارفع الخطورة (≥75).
- املأ contradictions بأي اختلاف بين النص الحر وOCR (مثال: لا قيء مذكور ومع ذلك طُلب metoclopramide).

أخرج JSON بالهيكل التالي فقط:
{
  "patientSummary": {
    "ageYears": number|null,
    "gender": "ذكر"|"أنثى"|null,
    "pregnant": { "isPregnant": boolean, "gestationalWeeks": number|null }|null,
    "smoking": { "status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null }|null,
    "diabetes": { "has": boolean, "type": "1"|"2"|null, "durationYears": number|null }|null,
    "chronicConditions": string[]
  },
  "diagnosis": string[],
  "symptoms": string[],
  "contradictions": string[],
  "table": [
    {
      "name": string,
      "itemType": "lab"|"medication"|"procedure"|"device"|"imaging",
      "doseRegimen": string|null,
      "intendedIndication": string|null,
      "isIndicationDocumented": boolean,
      "conflicts": string[],
      "riskPercent": number,  // 0–100 ولا تضع 0 تلقائيًا
      "insuranceDecision": {
        "label": "مقبول"|"قابل للرفض"|"مرفوض",
        "justification": string // تعليل قوي محدّد لماهو مطلوب للقبول أو سبب الرفض
      }
    }
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}
ONLY JSON.
`;
}


async function openaiAuditToJSON({ bundle, mode = "clinical_audit" }) {
  const system = buildOpenAIInstructions(mode);
  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content:
        "المعطيات الموحدة لتحليلك:\n" +
        JSON.stringify(bundle, null, 2),
    },
  ];

  // Structured (json_object) guarantees valid JSON string
  const resp = await withTimeout(
    fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages,
        temperature: 0.2,
      }),
    })
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI audit failed: ${resp.status} ${t}`);
  }
  const data = await resp.json();
  const content =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
    "";
  const json = safeJson(content);
  if (!json) {
    throw new Error("OpenAI returned non-JSON content");
  }
  return json;
}

// ---------- HTML RENDERING ----------
function styleTag() {
  return `
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Tahoma, Arial; line-height: 1.6; color: #111; }
  h1,h2 { margin: 0.6rem 0; }
  .muted { color:#555; }
  .section { margin: 1.2rem 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
  th { background:#f5f5f5; }
  tr.risk-red { background: #fadde1; }     /* ≥75% */
  tr.risk-yellow { background: #fff2b3; }  /* 60-74% */
  tr.risk-green { background: #d9f2e3; }   /* <60% */
  .badge { display:inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
  .b-red { background:#e53935; color:#fff; }
  .b-yellow { background:#f9a825; color:#000; }
  .b-green { background:#2e7d32; color:#fff; }
  .disclaimer { font-size: 12px; color:#666; margin-top: 8px; }
  .kvs { display:flex; flex-wrap:wrap; gap:8px; }
  .kv { background:#fafafa; border:1px solid #eee; border-radius:8px; padding:6px 10px; }
</style>`;
}

function riskClass(r) {
  if (r >= 75) return "risk-red";
  if (r >= 60) return "risk-yellow";
  return "risk-green";
}
function riskBadge(r) {
  if (r >= 75) return `<span class="badge b-red">${r}%</span>`;
  if (r >= 60) return `<span class="badge b-yellow">${r}%</span>`;
  return `<span class="badge b-green">${r}%</span>`;
}

function renderPatientSummary(ps = {}) {
  const rows = [];
  const sex = ps.gender ?? "غير محدد";
  const preg =
    ps?.pregnant?.isPregnant
      ? `حامل (${ps.pregnant.gestationalWeeks ?? "?"} أسابيع)`
      : "غير حامل/غير منطبق";
  const smoking = ps?.smoking
    ? `${ps.smoking.status}${ps.smoking.packYears ? `، ${ps.smoking.packYears} pack-years` : ""}`
    : "غير محدد";
  const diabetes = ps?.diabetes
    ? ps.diabetes.has
      ? `نعم (نوع ${ps.diabetes.type || "?"}، منذ ${ps.diabetes.durationYears ?? "?"} سنة)`
      : "لا"
    : "غير محدد";
  const chronic = (ps.chronicConditions || []).join("، ") || "لا يوجد/غير مذكور";

  rows.push(`<div class="kv"><b>العمر:</b> ${ps.ageYears ?? "غير محدد"}</div>`);
  rows.push(`<div class="kv"><b>الجنس:</b> ${sex}</div>`);
  rows.push(`<div class="kv"><b>الحمل:</b> ${preg}</div>`);
  rows.push(`<div class="kv"><b>التدخين:</b> ${smoking}</div>`);
  rows.push(`<div class="kv"><b>السكري:</b> ${diabetes}</div>`);
  rows.push(`<div class="kv"><b>أمراض مزمنة:</b> ${chronic}</div>`);

  return `<div class="kvs">${rows.join("")}</div>`;
}

function renderHtmlReport(json) {
  const diag = (json.diagnosis || []).map((d) => `<li>${d}</li>`).join("") || "<li>—</li>";
  const sx = (json.symptoms || []).map((d) => `<li>${d}</li>`).join("") || "<li>—</li>";
  const ctr = (json.contradictions || []).map((d) => `<li>${d}</li>`).join("") || "<li>لا توجد تعارضات صريحة مذكورة.</li>";

  const rows =
    (json.table || [])
      .map((r) => {
        const rp = clamp(parseInt(r.riskPercent ?? 0, 10), 0, 100);
        const klass = riskClass(rp);
        const conflicts =
          (r.conflicts || []).length ? r.conflicts.join("؛ ") : "لا يوجد";
        const decision = r?.insuranceDecision?.label || "—";
        const why = r?.insuranceDecision?.justification || "—";
        return `<tr class="${klass}">
          <td>${r.name || "—"}</td>
          <td>${r.doseRegimen || "—"}</td>
          <td>${conflicts}</td>
          <td>${riskBadge(rp)}</td>
          <td><b>${decision}</b><br/><span class="muted">${why}</span></td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="5">لا بيانات</td></tr>`;

  const miss = (json.missingActions || []).map((x) => `<li>${x}</li>`).join("") || "<li>—</li>";
  const refs =
    (json.referrals || [])
      .map(
        (r) =>
          `<li><b>${r.specialty}:</b> ${(r.whatToDo || []).join("، ") || "—"}</li>`
      )
      .join("") || "<li>—</li>";
  const fins = (json.financialInsights || []).map((x) => `<li>${x}</li>`).join("") || "<li>—</li>";

  return `
${styleTag()}
<h1>تقرير التدقيق الطبي</h1>
<div class="muted">HTML جاهز للعرض والتصدير PDF</div>

<div class="section">
  <h2>ملخص الحالة</h2>
  ${renderPatientSummary(json.patientSummary || {})}
  <h3>التشخيص</h3>
  <ul>${diag}</ul>
  <h3>الأعراض</h3>
  <ul>${sx}</ul>
</div>

<div class="section">
  <h2>التناقضات الطبية</h2>
  <ul>${ctr}</ul>
</div>

<div class="section">
  <h2>الجدول الطبي (أدوية/إجراءات)</h2>
  <table>
    <thead>
      <tr>
        <th>الدواء/الإجراء</th>
        <th>الجرعة/المدة</th>
        <th>التعارضات</th>
        <th>الخطورة (%)</th>
        <th>قرار التأمين (مع التبرير)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>

<div class="section">
  <h2>الإجراءات المفقودة</h2>
  <ul>${miss}</ul>
</div>

<div class="section">
  <h2>الإحالات الطبية</h2>
  <ul>${refs}</ul>
</div>

<div class="section">
  <h2>التحليل المالي</h2>
  <ul>${fins}</ul>
</div>

<div class="section">
  <h2>الخاتمة</h2>
  <p>${json.conclusion || "هذا التقرير آلي ولا يغني عن الفحص الإكلينيكي المباشر ومطابقة الحالة."}</p>
  <p class="disclaimer">⚠️ هذا التقرير لا يغني عن الفحص الإكلينيكي ومطابقة الحالة مع السجل الطبي.</p>
</div>
`;
}

// ---------- API HANDLER ----------
export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return res.status(200).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { text, files = [], patientInfo = {}, mode = "clinical_audit", returnJson = true } =
      req.body || {};

    if (!process.env.OPENAI_API_KEY || !GEMINI_API_KEY) {
      return res.status(500).json({
        error:
          "Missing API keys. Set OPENAI_API_KEY and GEMINI_API_KEY as environment variables.",
      });
    }

    // Validate files
    if (!Array.isArray(files) || files.length > MAX_FILES_PER_REQUEST) {
      return res
        .status(400)
        .json({ error: `Attach 0–${MAX_FILES_PER_REQUEST} files.` });
    }

    // 1) OCR/Vision extraction (Gemini)
    const extractedText = files.length
      ? await geminiExtractBundle({ userText: text || "", files, patientInfo })
      : (text || "");

    // 2) Build unified bundle → OpenAI deep audit → JSON
    const bundle = {
      patientInfo,
      userFreeText: text || "",
      filesExtractedText: extractedText || "",
    };

    const structured = await openaiAuditToJSON({ bundle, mode });

    // 3) Render HTML with strong color coding & explicit justification
    const html = renderHtmlReport(structured);

    // Response: HTML + (optional) structured JSON for research/analytics
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json({
      ok: true,
      html,
      ...(returnJson ? { structured } : {}),
    });
} catch (err) {
  console.error("API /api/gpt error:", err);
  const message = (err && err.message) ? err.message : String(err);
  return res.status(500).json({ ok: false, error: message });
}
