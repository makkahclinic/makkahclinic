// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

// ===== Route config (static literal) =====
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
  try {
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) return await r.json();
  } catch { /* ignore */ }
  try { return { raw: await r.text() }; }
  catch { return { raw: "" }; }
}
const safeArr = (v) => (Array.isArray(v) ? v : []);
const uniq    = (a) => Array.from(new Set(a));

// ===== Gemini: resumable upload (Files API) =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");

  // 1) start resumable session
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

// ===== Gemini: OCR/vision extract =====
async function geminiSummarize({ text, files }) {
  const parts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data || "").split("base64,").pop();
    if (!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({
      name: f?.name || "file", mimeType: mime, base64: b64
    });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt =
    "أنت مساعد لاستخلاص سريري: لخص النصوص في الصور/الملفات بدقة (OCR). " +
    "اذكر التشخيصات والطلبات الموثقة فقط، وميّز بين المذكور فعلاً والتخمين. لا تضف استنتاجات علاجية.";

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: "user", parts: [{ text: text || "" }] },
      ...(parts.length ? [{ role: "user", parts }] : []),
    ],
    generationConfig: {
      temperature: 0,   // ثبات أعلى
      topP: 0,
      candidateCount: 1,
      maxOutputTokens: 2048,
    },
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

// ===== System prompt (anchored to evidence sources) =====
function auditInstructions() {
  return `
أنت استشاري تدقيق طبي/تأميني. انتج **JSON فقط** (المخطط أدناه) بلا أي نص خارج JSON.

مرساة المعرفة (لا تضع روابط): WHO, CDC, NIH, NHS, Cochrane, UpToDate, NEJM, The Lancet,
JAMA, BMJ, Nature/Science (الطب الحيوي)، وإرشادات الأدوية والتنظيم: FDA, EMA, SFDA,
Micromedex, Lexicomp, BNF, DailyMed, USP. التزم بالأدلة الحديثة وتجنّب العموميات.

سياسات تأمينية مهمة (تُطبّق بعد فهم السياق):
- Dengue: وجود IgG فقط لا يثبت عدوى حادة ⇒ القرار "قابل للرفض" ما لم توجد أعراض وبائية قوية،
  وجود IgM أو NS1 مع أعراض متسقة ⇒ "مقبول".
- Normal Saline I.V: مقبول فقط مع دليل جفاف/هبوط ضغط/فقد سوائل. في ارتفاع ضغط الدم دون جفاف ⇒ "قابل للرفض".
- دوّن justification سريري محدّد لكل عنصر (لماذا مقبول/مرفوض/قابل للمراجعة).

المخرجات (ONLY JSON):
{
  "patientSummary": {"ageYears": number|null, "gender": "ذكر"|"أنثى"|null,
    "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null,
    "smoking": {"status":"مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null,
    "chronicConditions": string[]},
  "diagnosis": string[],
  "symptoms": string[],
  "contradictions": string[],
  "table": [
    {"name": string, "itemType": "lab"|"medication"|"procedure"|"device"|"imaging",
     "doseRegimen": string|null,
     "intendedIndication": string|null,
     "isIndicationDocumented": boolean,
     "conflicts": string[],
     "riskPercent": number,
     "insuranceDecision": {"label":"مقبول"|"قابل للرفض"|"قابل للمراجعة","justification": string}}
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}
ONLY JSON.
`;
}

function needsRefine(s) {
  const rows = Array.isArray(s?.table) ? s.table : [];
  if (!rows.length) return true;
  const zero = rows.filter((r) => !Number.isFinite(r?.riskPercent)).length;
  const weak = rows.filter((r) => !r?.insuranceDecision?.justification || r.insuranceDecision.justification.trim().length < 18).length;
  return zero > 0 || (weak / rows.length > 0.4);
}

// ===== Deterministic OpenAI call (JSON only) =====
async function chatgptJSON(bundle, extra = []) {
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0,
    top_p: 0,
    presence_penalty: 0,
    frequency_penalty: 0,
    // seed: 42, // فعّل إن كان الموديل يدعم
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: auditInstructions() },
      { role: "user", content: "المعطيات:\n" + JSON.stringify(bundle, null, 2) },
      ...extra,
    ],
  };

  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error("OpenAI error: " + JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

// ===== Policy enforcer (post-processing) =====
function enforceInsurancePolicies(struct) {
  if (!struct || !Array.isArray(struct.table)) return struct;
  const textBlob = JSON.stringify(struct);

  const hasHypotensionOrDehydration =
    /\b(hypotens|dehydrat|هبوط|جفاف|shock|orthostat)\b/i.test(textBlob);

  struct.table = struct.table.map((row) => {
    const item = { ...row };
    const name = (item.name || "").toString();

    // Dengue IgG وحده
    if (/dengue.*igg/i.test(name)) {
      const igmOrNs1 = /igm|ns1/i.test(textBlob);
      if (!igmOrNs1) {
        item.insuranceDecision = {
          label: "قابل للرفض",
          justification: "تحليل Dengue IgG وحده لا يثبت عدوى حادة؛ يلزم IgM أو NS1 مع سياق وبائي/أعراضي."
        };
        item.riskPercent = Math.max(item.riskPercent || 0, 75);
        item.isIndicationDocumented = false;
        item.conflicts = uniq([...(item.conflicts || []), "لا يوجد IgM/NS1 لتأكيد العدوى الحادة"]);
      }
    }

    // Normal Saline I.V بدون دليل جفاف/هبوط
    if (/normal\s*saline|محلول\s*ملحي|i\.v\.*\s*infusion/i.test(name)) {
      if (!hasHypotensionOrDehydration) {
        item.insuranceDecision = {
          label: "قابل للرفض",
          justification: "محلول وريدي غير مبرر بدون دلائل جفاف/فقد سوائل أو هبوط ضغط، خاصة مع ارتفاع ضغط الدم."
        };
        item.riskPercent = Math.max(item.riskPercent || 0, 80);
        item.isIndicationDocumented = false;
        item.conflicts = uniq([...(item.conflicts || []), "لا توجد دلائل جفاف/هبوط"]);
      }
    }

    // تقوية التبرير إن كان عامًا
    if (!item.insuranceDecision?.justification || item.insuranceDecision.justification.trim().length < 18) {
      item.insuranceDecision = item.insuranceDecision || {};
      item.insuranceDecision.label = item.insuranceDecision.label || "قابل للمراجعة";
      item.insuranceDecision.justification = item.insuranceDecision.justification || "التبرير غير كافٍ؛ يلزم ذكر سبب سريري محدّد أو دليل موثق.";
      item.riskPercent = Math.max(item.riskPercent || 0, 60);
    }

    return item;
  });

  // إن لم يملأ النموذج financialInsights، قدّم اقتراحات ذكية افتراضية
  if (!Array.isArray(struct.financialInsights) || !struct.financialInsights.length) {
    struct.financialInsights = [
      "تقليل الاختبارات غير المبررة لخفض الرفض التأميني وزيادة نسبة الموافقات.",
      "توحيد قوالب توثيق المؤشرات السريرية (Indication) لضمان قبول المطالبات.",
      "طلب فحوص مثبتة الدلالة (HbA1c, eGFR) لمتابعة السكري/الكلى حسب الإرشادات."
    ];
  }

  return struct;
}

// ===== HTML rendering =====
function colorCell(p) {
  const n = Math.round(Number(p || 0));
  if (n >= 75) return 'style="background:#fee2e2;border:1px solid #fecaca"'; // أحمر
  if (n >= 60) return 'style="background:#fff7ed;border:1px solid #ffedd5"'; // برتقالي
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';              // أخضر
}

function esc(x){ return (x==null ? "" : String(x)).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); }

function toHtml(s) {
  const rows = safeArr(s?.table).map(r => `
    <tr>
      <td>${esc(r.name||"-")}</td>
      <td>${esc(r.itemType||"-")}</td>
      <td>${esc(r.doseRegimen||"-")}</td>
      <td>${esc(r.intendedIndication||"-")}</td>
      <td>${r.isIndicationDocumented ? "نعم" : "لا"}</td>
      <td>${safeArr(r.conflicts).join("<br>") || "-"}</td>
      <td ${colorCell(r.riskPercent)}><b>${Math.round(r.riskPercent||0)}%</b></td>
      <td>${esc(r?.insuranceDecision?.label || "-")}</td>
      <td>${esc(r?.insuranceDecision?.justification || "-")}</td>
    </tr>
  `).join("");

  const contradictions = safeArr(s?.contradictions);
  const missing = safeArr(s?.missingActions);
  const fin = safeArr(s?.financialInsights);

  return `
  <div style="font-size:12px;color:#64748b;margin-bottom:8px">
    التحليل موجّه بإرشادات WHO/CDC/NIH/NHS ومرجعيات الأدوية (FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed).
  </div>

  <h2>📋 ملخص الحالة</h2>
  <div class="kvs" style="padding:10px;border:1px solid #e5e7eb;border-radius:10px;background:#f8fbff">
    <p>${esc(s?.conclusion || "يلزم استكمال البيانات السريرية للتشخيص والتغطية التأمينية.")}</p>
  </div>

  <h2>⚠️ التناقضات والأخطاء</h2>
  <ul>
    ${contradictions.length ? contradictions.map(c=>`<li>${esc(c)}</li>`).join("") : "<li>لا يوجد تناقضات واضحة</li>"}
  </ul>

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
  <ul>
    ${missing.length ? missing.map(x=>`<li>${esc(x)}</li>`).join("") : "<li>—</li>"}
  </ul>

  <h2>📈 فرص تحسين الدخل والخدمة</h2>
  <ul>
    ${fin.length ? fin.map(x=>`<li>${esc(x)}</li>`).join("") : "<li>—</li>"}
  </ul>
  `;
}

// ===== Handler =====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "POST only");
    if (!OPENAI_API_KEY) return bad(res, 500, "Missing OPENAI_API_KEY");
    if (!GEMINI_API_KEY) return bad(res, 500, "Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body || {};

    // 1) OCR/vision + merge text
    const extracted = await geminiSummarize({ text, files });
    const bundle = { patientInfo, extractedSummary: extracted, userText: text };

    // 2) Structure via ChatGPT (deterministic)
    let structured = await chatgptJSON(bundle);
    if (needsRefine(structured)) {
      structured = await chatgptJSON(bundle, [
        { role: "user", content: "أعد التدقيق بصرامة: علّل كل صف علمياً وامنع العموميات، واملأ riskPercent وjustification." }
      ]);
    }

    // 3) Enforce critical insurance policies
    structured = enforceInsurancePolicies(structured);

    // 4) Render HTML
    const html = toHtml(structured);
    return ok(res, { html, structured });
  } catch (err) {
    console.error("/api/gpt error:", err);
    return bad(res, 500, err?.message || String(err));
  }
}
