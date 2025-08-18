// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

// Refs:
// Google AI Files API (resumable upload): https://ai.google.dev/gemini-api/docs/files
// generateContent: https://ai.google.dev/gemini-api/docs/text-generation
// OpenAI Chat Completions (JSON mode): https://platform.openai.com/docs/api-reference/chat

// ===== Route config (keep static literal) =====
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

// ===== Keys & endpoints =====
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// ===== Small helpers =====
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg, extra) => res.status(code).json({ ok: false, error: msg, ...extra });
const isJson = (r) => (r.headers.get("content-type")||"").includes("application/json");
const parseJsonSafe = async (r) => (isJson(r) ? r.json() : { raw: await r.text() });

// ===== Gemini: resumable upload (Files API) =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");
  const bin = Buffer.from(base64, "base64");

  // 1) Start resumable session
  const initRes = await fetch(
    `${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bin.byteLength),
        "X-Goog-Upload-Header-Content-Type": mimeType || "application/octet-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: { display_name: name || "file", mime_type: mimeType || "application/octet-stream" },
      }),
    }
  );

  if (!initRes.ok) {
    const meta = await parseJsonSafe(initRes);
    throw new Error("Gemini init failed: " + JSON.stringify(meta));
  }

  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload URL missing");

  // 2) Upload + finalize
  const upRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType || "application/octet-stream",
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(bin.byteLength),
    },
    body: bin,
  });

  const meta = await parseJsonSafe(upRes);
  if (!upRes.ok) {
    throw new Error("Gemini finalize failed: " + JSON.stringify(meta));
  }

  return { uri: meta?.file?.uri, mime: meta?.file?.mime_type || mimeType || "application/octet-stream" };
}

// ===== Gemini: OCR/Summarize files + merge with free text & patient info =====
async function geminiSummarize({ text, files, patientInfo }) {
  const parts = [];

  // Attach files (image/PDF) via file_data
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const raw = f?.data || ""; // may already be base64 (frontend strips prefix)
    const base64 = raw.includes("base64,") ? raw.split("base64,").pop() : raw;
    if (!base64) continue;

    const { uri, mime: mm } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: mime,
      base64,
    });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  // System + user content
  const sys = "أنت مساعد لاستخلاص سريري (مع OCR). لخّص المحتوى الطبي في الملفات بدقة، واستخرج التشخيصات، الطلبات، التكرارات، وأي معلومات أدوية/جرعات مذكورة نصاً. لا تعطِ توصيات علاجية هنا؛ فقط استخلاص منظّم واضح.";
  const userText =
    (patientInfo ? `بيانات المريض: ${JSON.stringify(patientInfo, null, 2)}\n` : "") +
    (text || "لا يوجد نص حر.");

  const body = {
    system_instruction: { parts: [{ text: sys }] },
    contents: [
      { role: "user", parts: [{ text: userText }] },
      ...(parts.length ? [{ role: "user", parts }] : []),
    ],
  };

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error("Gemini generateContent error: " + JSON.stringify(data));

  const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
  return out;
}

// ===== Audit instructions for ChatGPT =====
function auditInstructions() {
  return `
أنت استشاري تدقيق طبي وتأميني. حلّل معطيات المريض + النص الحر + الخلاصة المستخرجة من OCR (من الملفات).
أخرج JSON فقط وفق المخطط التالي، بلا أي نص خارجه.
- itemType: lab | medication | procedure | device | imaging
- riskPercent thresholds: <60 مقبول، 60–74 قابل للرفض، ≥75 مرفوض
- املأ insuranceDecision.justification بتعليل سريري محدد يعتمد على الدلائل/الإرشادات والمعلومات المتاحة (واذكر التكرارات/التعارضات إن وجدت).
{
  "patientSummary": {"ageYears": number|null, "gender": "ذكر"|"أنثى"|null, "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null, "smoking": {"status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null, "chronicConditions": string[]},
  "diagnosis": string[],
  "symptoms": string[],
  "contradictions": string[],
  "table": [
    {"name": string, "itemType": "lab"|"medication"|"procedure"|"device"|"imaging", "doseRegimen": string|null, "intendedIndication": string|null, "isIndicationDocumented": boolean, "conflicts": string[], "riskPercent": number, "insuranceDecision": {"label": "مقبول"|"قابل للرفض"|"مرفوض", "justification": string}}
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}
ONLY JSON.`;
}

function needsRefine(s) {
  const rows = Array.isArray(s?.table) ? s.table : [];
  if (!rows.length) return true;
  const zero = rows.filter((r) => !Number.isFinite(r?.riskPercent) || r.riskPercent === 0).length;
  const weak = rows.filter(
    (r) => !r?.insuranceDecision?.justification || r.insuranceDecision.justification.trim().length < 20
  ).length;
  return zero / rows.length > 0.4 || weak / rows.length > 0.4;
}

async function chatgptJSON(bundle, extra = []) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");

  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: auditInstructions() },
        { role: "user", content: "المعطيات:\n" + JSON.stringify(bundle, null, 2) },
        ...extra,
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error("OpenAI error: " + JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

// ===== HTML rendering =====
function colorCell(p) {
  if (p >= 75) return 'style="background:#fee2e2;border:1px solid #fecaca"';
  if (p >= 60) return 'style="background:#fff7ed;border:1px solid #ffedd5"';
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';
}
function toHtml(s) {
  const rows = (s.table || [])
    .map(
      (r) =>
        `<tr>
          <td>${r.name || "-"}</td>
          <td>${r.itemType || "-"}</td>
          <td>${r.doseRegimen || "-"}</td>
          <td>${r.intendedIndication || "-"}</td>
          <td>${r.isIndicationDocumented ? "نعم" : "لا"}</td>
          <td>${(r.conflicts || []).join("<br>") || "-"}</td>
          <td ${colorCell(r.riskPercent || 0)}><b>${Math.round(r.riskPercent || 0)}%</b></td>
          <td>${r.insuranceDecision?.label || "-"}</td>
          <td>${r.insuranceDecision?.justification || "-"}</td>
        </tr>`
    )
    .join("");

  const contradictions =
    (s.contradictions || []).map((c) => `<li>${c}</li>`).join("") || "<li>لا شيء بارز</li>";

  return `
  <h2>ملخص الحالة</h2>
  <div class="kvs"><p>${(s.conclusion || "").replace(/\n/g, "<br>")}</p></div>

  <h2>التناقضات</h2>
  <ul>${contradictions}</ul>

  <h2>جدول الأدوية والإجراءات</h2>
  <table dir="rtl" style="width:100%;border-collapse:collapse">
    <thead>
      <tr>
        <th>الاسم</th><th>التصنيف</th><th>الجرعة</th><th>المؤشّر</th>
        <th>موثّق؟</th><th>تعارضات</th><th>درجة الخطورة</th><th>قرار التأمين</th><th>التبرير</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ===== Main handler =====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "POST only");

    if (!OPENAI_API_KEY || !GEMINI_API_KEY) {
      return bad(res, 500, "Missing API keys", {
        have_OPENAI: !!OPENAI_API_KEY,
        have_GEMINI: !!GEMINI_API_KEY,
      });
    }

    const { text = "", files = [], patientInfo = null } = req.body || {};

    // 1) OCR/summary from Gemini (robust to no-file/no-text)
    let extracted = "";
    try {
      extracted = await geminiSummarize({ text, files, patientInfo });
    } catch (e) {
      // لا توقف كل شيء إذا فشل OCR: نكمل بالنص فقط ونذكر السبب في اللوق
      console.error("Gemini summarize failed:", e?.message || e);
      extracted = "";
    }

    // 2) Structure via ChatGPT (with refine if weak)
    const bundle = { patientInfo, extractedSummary: extracted, userText: text };
    let structured = await chatgptJSON(bundle);
    if (needsRefine(structured)) {
      structured = await chatgptJSON(bundle, [
        {
          role: "user",
          content:
            "أعد التدقيق مع ملء النِّسَب والتبريرات لكل صف، وأبرز التكرارات والتعارضات بوضوح، واملأ الحقول الفارغة.",
        },
      ]);
    }

    // 3) HTML
    const html = toHtml(structured);
    return ok(res, { html, structured });
  } catch (err) {
    console.error("/api/gpt error:", err);
    return bad(res, 500, err?.message || String(err));
  }
}
