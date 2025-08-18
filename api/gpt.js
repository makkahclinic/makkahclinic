// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

// ===== Route config (must be static literal per Next.js docs) =====
export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } }, // literal string only
};

// ===== Keys & endpoints =====
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// ===== Helpers =====
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (r) =>
  (r.headers.get("content-type") || "").includes("application/json")
    ? r.json()
    : { raw: await r.text() };

// ===== Gemini: resumable upload (Files API) =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");

  // 1) start resumable session
  const start = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Header-Content-Length": String(bin.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
  });
  if (!start.ok) throw new Error("Gemini init failed: " + JSON.stringify(await parseJsonSafe(start)));
  const session = start.headers.get("X-Goog-Upload-URL");
  if (!session) throw new Error("Gemini upload URL missing");

  // 2) upload + finalize (PUT)
  const up = await fetch(session, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
    },
    body: bin,
  });
  const meta = await parseJsonSafe(up);
  if (!up.ok) throw new Error("Gemini finalize failed: " + JSON.stringify(meta));

  return { uri: meta?.file?.uri, mime: meta?.file?.mime_type || mimeType };
}

// ===== Gemini: OCR/merge user text =====
async function geminiSummarize({ text, files }) {
  const parts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data || "").split("base64,").pop(); // supports pure base64 or dataURL
    if (!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({ name: f?.name || "file", mimeType: mime, base64: b64 });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt =
    "أنت مساعد لاستخلاص سريري: لخص ما في الملفات (OCR) بدقة واذكر تشخيصات/طلبات/تكرارات فقط دون استنتاجات علاجية.";

  const body = {
    // REST field name per docs
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: "user", parts: [{ text: (text || "لا يوجد نص حر.") }] },
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

  const out =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
  return out;
}

// ===== ChatGPT audit prompt → strict JSON =====
function auditInstructions() {
  return `
أنت استشاري تدقيق طبي وتأميني. حلّل معطيات المريض + النص الحر + الخلاصة من OCR.
أخرج JSON فقط وفق المخطط التالي، بلا أي نص خارجه.
- itemType: lab | medication | procedure | device | imaging
- riskPercent: <60 مقبول، 60–74 قابل للرفض، ≥75 مرفوض
- املأ insuranceDecision.justification بتعليل سريري محدّد؛ واذكر التكرارات والتعارضات.
{
  "patientSummary": {"ageYears": number|null, "gender": "ذكر"|"أنثى"|null, "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null, "smoking": {"status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null, "chronicConditions": string[]},
  "diagnosis": string[],
  "symptoms": string[],
  "contradictions": string[],
  "table": [
    {"name": string, "itemType": "lab"|"medication"|"procedure"|"device"|"imaging",
     "doseRegimen": string|null, "intendedIndication": string|null,
     "isIndicationDocumented": boolean, "conflicts": string[],
     "riskPercent": number,
     "insuranceDecision": {"label": "مقبول"|"قابل للرفض"|"مرفوض", "justification": string}}
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}
ONLY JSON.`.trim();
}

function needsRefine(s) {
  const rows = Array.isArray(s?.table) ? s.table : [];
  if (!rows.length) return true;
  const zero = rows.filter((r) => !Number.isFinite(r?.riskPercent) || r.riskPercent === 0).length;
  const weak = rows.filter((r) => !r?.insuranceDecision?.justification || r.insuranceDecision.justification.trim().length < 20).length;
  return zero / rows.length > 0.4 || weak / rows.length > 0.4;
}

async function chatgptJSON(bundle, extra = []) {
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
      // use JSON mode / structured outputs
      response_format: { type: "json_object" },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error("OpenAI error: " + JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

// ===== HTML renderer (colored risk) =====
function colorCell(p) {
  if (p >= 75) return 'style="background:#fee2e2;border:1px solid #fecaca"';
  if (p >= 60) return 'style="background:#fff7ed;border:1px solid #ffedd5"';
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';
}

function toHtml(s) {
  const rows = (s.table || [])
    .map(
      (r) => `<tr>
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

  return `
<h2>ملخص الحالة</h2>
<div class="kvs"><p>${(s.conclusion || "").replace(/\n/g, "<br>")}</p></div>

<h2>التناقضات</h2>
<ul>${(s.contradictions || []).map((c) => `<li>${c}</li>`).join("") || "<li>لا شيء بارز</li>"}</ul>

<h2>جدول الأدوية والإجراءات</h2>
<table dir="rtl" style="width:100%;border-collapse:collapse">
  <thead><tr>
    <th>الاسم</th><th>التصنيف</th><th>الجرعة</th>
    <th>المؤشّر</th><th>موثّق؟</th><th>تعارضات</th>
    <th>درجة الخطورة</th><th>قرار التأمين</th><th>التبرير</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

<p style="margin-top:10px;color:#475569;font-size:12px">
* هذا التقرير لا يغني عن التقييم السريري.
</p>`;
}

// ===== Handler =====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "POST only");
    if (!OPENAI_API_KEY) return bad(res, 500, "Missing OPENAI_API_KEY");
    if (!GEMINI_API_KEY) return bad(res, 500, "Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body || {};

    // 1) OCR/merge via Gemini
    const extracted = await geminiSummarize({ text, files });

    // 2) Audit via ChatGPT → JSON
    const bundle = { patientInfo, extractedSummary: extracted, userText: text };
    let structured = await chatgptJSON(bundle);
    if (needsRefine(structured)) {
      structured = await chatgptJSON(bundle, [
        { role: "user", content: "أعد التدقيق مع ملء النِّسَب والتبريرات لكل صف وأبرز التكرارات والتعارضات." },
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
