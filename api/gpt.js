// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

// ===== Route config (static literal to avoid Vercel TemplateExpression bug) =====
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

// ===== Keys & endpoints =====
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL     = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// ===== Helpers =====
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function parseJsonSafe(r) {
  const ct = r.headers?.get?.("content-type") || "";
  return ct.includes("application/json") ? r.json() : { raw: await r.text() };
}

// ===== Gemini resumable upload =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");

  // 1) start session
  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bin.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
  });
  if (!initRes.ok) throw new Error("Gemini init failed: " + JSON.stringify(await parseJsonSafe(initRes)));

  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload URL missing");

  // 2) upload + finalize
  const upRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(bin.byteLength),
    },
    body: bin,
  });

  const meta = await parseJsonSafe(upRes);
  if (!upRes.ok) throw new Error("Gemini finalize failed: " + JSON.stringify(meta));
  return { uri: meta?.file?.uri, mime: meta?.file?.mime_type || mimeType };
}

// ===== Gemini summarize OCR/files =====
async function geminiSummarize({ text, files }) {
  const fileParts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const base64 = (f?.data || "").split("base64,").pop(); // يدعم dataURL أو base64 صِرف
    if (!base64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: mime,
      base64,
    });
    fileParts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  // prompt بسيط لاستخلاص المحتويات المذكورة فقط
  const systemPrompt =
    "أنت مساعد استخراج طبي. اكتب ملخصًا مُنظّمًا للعناصر المذكورة فقط في المستندات (تشخيصات/تحاليل/أدوية/إجراءات/تكرارات)، دون إضافة عناصر جديدة من عندك. لا توصيات علاجية.";
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: "user", parts: [{ text: text || "لا يوجد نص حر." }] },
      ...(fileParts.length ? [{ role: "user", parts: fileParts }] : []),
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

// ===== Build audit instructions (no hard-coded decisions; evidence-driven) =====
function auditInstructions() {
  return `
أنت استشاري تدقيق طبي وتأميني. المطلوب: تحويل المدخلات إلى تقييم سريري تأميني دقيق يعتمد على الأدلة الحديثة من:
WHO, CDC, ECDC, NIH, NHS, UpToDate, Cochrane, NEJM, Lancet, JAMA, BMJ, Nature/Science,
والمرجعيات الدوائية: FDA, EMA, SFDA, BNF, Micromedex, Lexicomp, DailyMed, USP, Mayo Clinic.

القواعد المهمة:
- اعمل فقط على العناصر المذكورة فعلاً في مدخلات المستخدم (نص/OCR). لا تضف عناصر غير مذكورة.
- لكل عنصر في الجدول: اذكر "الاسم"، "itemType" (lab|medication|procedure|device|imaging)،
  "doseRegimen" إن وُجد، "intendedIndication"، "isIndicationDocumented" (صحيح/خطأ بحسب النص/الملفات)،
  "conflicts" (تكرار/تعارضات محددة)، "riskPercent" (0-100)، و "insuranceDecision" مع
  {"label": "مقبول"|"قابل للرفض"|"مرفوض", "justification": سبب علمي دقيق ومختصر يعتمد على دلائل}.
- لا تفترض أعراض أو تشخيصات غير موثّقة. إذا نقص السياق قل "غير موثّق".
- استخدم لغة عربية طبية واضحة، وابتعد عن التعميمات.

أخرج JSON فقط بالمخطط التالي دون أي نص آخر:
{
  "patientSummary": {"ageYears": number|null, "gender": "ذكر"|"أنثى"|null, "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null, "smoking": {"status": "مدخن"|"غير مدخن"|"سابق"|null, "packYears": number|null}|null, "chronicConditions": string[]},
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

// ===== Deterministic ChatGPT call (temperature 0) =====
async function chatgptJSON(bundle, extra = []) {
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      top_p: 0,
      messages: [
        { role: "system", content: auditInstructions() },
        {
          role: "user",
          content:
            "المعطيات (نص حر + OCR مختصر + حقول بنيوية):\n" +
            JSON.stringify(bundle, null, 2),
        },
        ...extra,
      ],
      response_format: { type: "json_object" },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error("OpenAI error: " + JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

// ===== Simple fuzzy helpers to restrict output to mentioned items only =====
function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}
function scoreLike(a, b) {
  // نسبة تشارك كلمات بسيطة
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / Math.min(A.size, B.size);
}

// استخرج “العناصر المذكورة” من النص الحر + ملخص OCR (قائمة أسماء خام)
function harvestMentionedItems({ userText, extractedSummary }) {
  const text = [userText || "", extractedSummary || ""].join("\n").toLowerCase();
  // ابحث عن سطور شبيهة بطلبات labs/meds
  const rough = new Set();
  text.split(/\n+/).forEach((ln) => {
    const s = ln.trim();
    if (!s) return;
    if (s.length < 3) return;
    // أمثلة: Dengue, CBC, Creatinine, Pantozol, Normal Saline, Ultrasound...
    if (/[a-z\u0600-\u06FF]/i.test(s)) {
      // التقط عبارات مفيدة قصيرة
      const m = s.match(/([a-z0-9\.\-\+\s\/\(\)]{3,40})/gi);
      (m || []).forEach((frag) => {
        const f = frag.trim();
        if (f.length >= 3 && f.split(" ").length <= 8) rough.add(f);
      });
    }
  });
  return Array.from(rough);
}

// فلترة جدول AI للإبقاء على المذكور فقط
function restrictToMentioned(aiTable, mentionedList) {
  if (!Array.isArray(aiTable)) return [];
  if (!mentionedList.length) return aiTable; // لو ما قدرنا نستخرج، لا نمنع
  return aiTable.filter((row) => {
    const nm = row?.name || "";
    const maxSim = Math.max(
      0,
      ...mentionedList.map((raw) => scoreLike(nm, raw))
    );
    return maxSim >= 0.45; // حد بسيط للتماثل
  });
}

// ===== HTML rendering (الواجهة الأمامية تلوّن حسب النسبة؛ هنا نُنشئ جدولاً نظيفاً) =====
function colorCellStyle(p) {
  if (p >= 75) return 'style="background:#fee2e2;border:1px solid #fecaca"';
  if (p >= 60) return 'style="background:#fff7ed;border:1px solid #ffedd5"';
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';
}
function toHtml(s) {
  const rows = (s.table || [])
    .map((r) => {
      const risk = Math.round(r?.riskPercent || 0);
      return `<tr>
<td>${r?.name || "-"}</td>
<td>${r?.itemType || "-"}</td>
<td>${r?.doseRegimen || "-"}</td>
<td>${r?.intendedIndication || "-"}</td>
<td>${r?.isIndicationDocumented ? "نعم" : "لا"}</td>
<td>${(r?.conflicts || []).join("<br>") || "-"}</td>
<td ${colorCellStyle(risk)}><b>${risk}%</b></td>
<td>${r?.insuranceDecision?.label || "-"}</td>
<td>${r?.insuranceDecision?.justification || "-"}</td>
</tr>`;
    })
    .join("");

  const contradictions =
    (s.contradictions || []).map((c) => `<li>${c}</li>`).join("") ||
    "<li>لا يوجد تناقضات واضحة</li>";

  const missing =
    (s.missingActions || []).map((c) => `<li>${c}</li>`).join("") ||
    "<li>—</li>";

  const fin =
    (s.financialInsights || []).map((c) => `<li>${c}</li>`).join("") ||
    "<li>—</li>";

  return `
<h2>📋 ملخص الحالة</h2>
<div class="kvs"><p>${(s.conclusion || "—").replace(/\n/g, "<br>")}</p></div>

<h2>⚠️ التناقضات والأخطاء</h2>
<ul>${contradictions}</ul>

<h2>💊 جدول الأدوية والإجراءات</h2>
<table dir="rtl" style="width:100%;border-collapse:collapse">
<thead>
<tr>
  <th>الاسم</th><th>التصنيف</th><th>الجرعة</th><th>المؤشّر</th>
  <th>موثّق؟</th><th>تعارضات</th><th>درجة الخطورة</th><th>قرار التأمين</th><th>التبرير</th>
</tr>
</thead>
<tbody>${rows}</tbody>
</table>

<h2>🩺 ما كان يجب القيام به</h2>
<ul>${missing}</ul>

<h2>📈 فرص تحسين الدخل والخدمة</h2>
<ul>${fin}</ul>
`;
}

// ===== API handler =====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "POST only");
    if (!OPENAI_API_KEY) return bad(res, 500, "Missing OPENAI_API_KEY");
    if (!GEMINI_API_KEY) return bad(res, 500, "Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body || {};

    // 1) OCR/vision summary from Gemini
    const extracted = await geminiSummarize({ text, files });

    // 2) Build bundle to ChatGPT
    const bundle = {
      patientInfo,
      userText: text,
      extractedSummary: extracted,
    };

    // 3) Ask ChatGPT (deterministic)
    let structured = await chatgptJSON(bundle);

    // 4) Post-filter: keep only items that were mentioned in inputs
    const mentioned = harvestMentionedItems({
      userText: text,
      extractedSummary: extracted,
    });
    structured.table = restrictToMentioned(structured.table, mentioned);

    // 5) Render HTML
    const html = toHtml(structured);
    return ok(res, { html, structured });
  } catch (err) {
    console.error("/api/gpt error:", err);
    return bad(res, 500, err?.message || String(err));
  }
}
