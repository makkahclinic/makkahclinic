// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Node 18+ / Vercel)

// ===== Route config (static literal) =====
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

// ===== Keys & endpoints =====
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL  || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL  || "gemini-2.5-pro";
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

const norm = (x) => (typeof x === "string" ? x.trim() : x ?? "");

// ===== Gemini: resumable upload =====
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

  if (!initRes.ok) {
    throw new Error("Gemini init failed: " + JSON.stringify(await parseJsonSafe(initRes)));
  }

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

// ===== Gemini: extract text (OCR / multimodal) =====
async function geminiSummarize({ text, files }) {
  const parts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data || "").split("base64,").pop();
    if (!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: mime,
      base64: b64,
    });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt =
    "أنت مساعد OCR سريري. استخرج نصًا واضحًا من الملفات (صور/PDF)، ثم لخّص العناصر ذات الصلة: " +
    "الأعراض، العلامات الحيوية (BP/HR/Temp)، التشخيصات، الأكواد/قوائم الخدمات، والأدوية/السوائل/الإجراءات. " +
    "أعد نصًا متّسقًا فقط (بدون تحليل تأميني).";

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: "user", parts: [{ text: norm(text) || "لا يوجد نص حر." }] },
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

  const out = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p?.text || "")
    .join("\n")
    .trim();

  return out || "";
}

// ===== Audit instructions for ChatGPT (evidence-driven) =====
function systemAuditPrompt() {
  return `
أنت استشاري تدقيق طبي/تأميني. كوّن مخرجات منضبطة JSON فقط (بدون أي نص خارج JSON) وفق المخطط أدناه.

## مصادر المعرفة المعيارية (أذكرها ضمنيًا في التفكير لا كروابط):
WHO, CDC, NIH, NHS, UpToDate, Mayo Clinic, Micromedex, Lexicomp, BNF, DailyMed, FDA/EMA/SFDA, NEJM, Lancet, JAMA, BMJ.

## دورك
- دمج: (1) معلومات المريض، (2) النص الحر، (3) نص OCR المستخرج.
- استنتج المشكلة/الأعراض/التشخيصات، وافرز التكرارات والتعارضات.
- ابنِ جدول عناصر (تحاليل/أدوية/إجراءات/أجهزة/أشعة) مع:
  name, itemType, doseRegimen, intendedIndication, isIndicationDocumented, conflicts[], riskPercent, insuranceDecision{label, justification}.

## قواعد كتحقّق (لا تستبدل حكمك السريري، بل اجعلها قيود تحقق تُفعّل عند غياب الدليل):
- Dengue: إذا وُجد طلب IgG فقط بدون IgM/NS1 أو سياق وبائي/أعراض نموذجية → مبدئيًا "قابل للرفض" مع تبرير أن IgG لا يثبت عدوى حادة.
- Normal Saline I.V.: مقبول فقط إذا هناك دلائل جفاف/هبوط ضغط/فقد سوائل/قيء شديد…؛ وجود ارتفاع ضغط بدون دلائل نقص حجم → مبدئيًا "قابل للرفض".
- قيّم الجرعات/التداخلات/الموانع عند كبار السن/الحمل/اعتلال كلوي/كبدي إن وُجدت قرائن.

## مخرجات مطلوبة (JSON فقط):
{
  "patientSummary": {"ageYears": number|null, "gender": "ذكر"|"أنثى"|null, "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null, "smoking": {"status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null, "chronicConditions": string[], "vitals": {"bp": string|null, "hr": number|null, "tempC": number|null}},
  "diagnosis": string[],
  "symptoms": string[],
  "contradictions": string[],
  "table": [
    {"name": string, "itemType": "lab"|"medication"|"procedure"|"device"|"imaging", "doseRegimen": string|null, "intendedIndication": string|null, "isIndicationDocumented": boolean, "conflicts": string[], "riskPercent": number, "insuranceDecision": {"label": "مقبول"|"قابل للمراجعة"|"قابل للرفض", "justification": string}}
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}
ONLY JSON.
`;
}

// ===== OpenAI: structure as JSON =====
async function chatgptJSON(bundle, extraMessages = []) {
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemAuditPrompt() },
        { role: "user", content: "المعطيات:\n" + JSON.stringify(bundle, null, 2) },
        ...extraMessages,
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error("OpenAI error: " + JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

// ===== Post-processing: apply insurance heuristics (non-dogmatic) =====
function applyInsuranceHeuristics(structured, contextText) {
  const s = structured || {};
  s.table = Array.isArray(s.table) ? s.table : [];

  const hay = (contextText || "").toLowerCase();

  // Capture BP if not parsed
  if (!s?.patientSummary?.vitals?.bp) {
    const m = /bp[:\s]*([0-9]{2,3})\s*\/\s*([0-9]{2,3})/i.exec(contextText || "");
    if (m) {
      s.patientSummary = s.patientSummary || {};
      s.patientSummary.vitals = s.patientSummary.vitals || {};
      s.patientSummary.vitals.bp = `${m[1]}/${m[2]}`;
    }
  }

  const hasHypotension =
    /\bbp[:\s]*([0-8]?\d)\s*\/\s*([0-5]?\d)\b/i.test(contextText || "") || /hypotens/i.test(hay);
  const signsOfDehydration =
    /(dehydrat|dry mucosa|poor turgor|orthostat|vomit|diarrh|tachycardia)/i.test(hay) ||
    /جفاف|هبوط|نقص\s?سوائل|قيء|إسهال/.test(contextText || "");

  const names = s.table.map((r) => (r?.name || "").toLowerCase());

  const hasIgG = names.some((n) => /dengue.*igg|igg.*dengue/.test(n));
  const hasIgM = names.some((n) => /dengue.*igm|igm.*dengue/.test(n));
  const hasNS1 = names.some((n) => /ns1/.test(n));
  const hasNS  = names.some((n) => /normal\s*saline|i\.v\.?\s*infusion/.test(n));

  // Rule: Dengue IgG only
  if (hasIgG && !hasIgM && !hasNS1) {
    s.table = s.table.map((r) => {
      const nm = (r?.name || "").toLowerCase();
      if (/dengue.*igg|igg.*dengue/.test(nm)) {
        r.riskPercent = Math.max(75, Number(r.riskPercent || 0));
        r.insuranceDecision = r.insuranceDecision || {};
        r.insuranceDecision.label = "قابل للرفض";
        r.insuranceDecision.justification =
          r.insuranceDecision.justification ||
          "تحليل Dengue IgG لوحده لا يثبت عدوى حادة؛ التشخيص الحاد يحتاج IgM أو NS1 مع سياق وبائي/أعراض متوافقة.";
        r.isIndicationDocumented = !!r.isIndicationDocumented;
      }
      return r;
    });
  }

  // Rule: Normal Saline without justification / with HTN
  if (hasNS && !hasHypotension && !signsOfDehydration) {
    s.table = s.table.map((r) => {
      const nm = (r?.name || "").toLowerCase();
      if (/normal\s*saline|i\.v\.?\s*infusion/.test(nm)) {
        r.riskPercent = Math.max(80, Number(r.riskPercent || 0));
        r.insuranceDecision = r.insuranceDecision || {};
        r.insuranceDecision.label = "قابل للرفض";
        r.insuranceDecision.justification =
          r.insuranceDecision.justification ||
          "استخدام محلول وريدي غير مبرر بدون علامات جفاف/هبوط ضغط. القبول يتطلب دليل نقص حجم أو فقد سوائل واضح.";
        r.isIndicationDocumented = !!r.isIndicationDocumented;
      }
      return r;
    });
  }

  // Keep arrays safe
  s.contradictions   = Array.isArray(s.contradictions) ? s.contradictions : [];
  s.missingActions   = Array.isArray(s.missingActions) ? s.missingActions : [];
  s.financialInsights= Array.isArray(s.financialInsights) ? s.financialInsights : [];

  // Add helpful nudges if empty
  if (!s.missingActions.length) {
    s.missingActions.push(
      "توثيق المؤشّر السريري (Indication) لكل طلب/دواء.",
      "إضافة نتائج/خطة متابعة موجزة في الزيارة."
    );
  }
  if (!s.financialInsights.length) {
    s.financialInsights.push(
      "تقليل الطلبات غير المبررة (IgG وحده / سوائل بلا دليل) لخفض الرفض التأميني.",
      "استخدام قوالب التوثيق يرفع نسب الموافقة ويزيد إيراد العيادة."
    );
  }

  return s;
}

// ===== HTML rendering (defensive) =====
function colorCell(p) {
  const v = Number.isFinite(p) ? p : 0;
  if (v >= 75) return 'style="background:#fee2e2;border:1px solid #fecaca"';
  if (v >= 60) return 'style="background:#fff7ed;border:1px solid #ffedd5"';
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';
}

function toHtml(s) {
  const rows = (Array.isArray(s.table) ? s.table : []).map((r) => {
    const risk = Number.isFinite(r?.riskPercent) ? Math.round(r.riskPercent) : 0;
    const dec  = r?.insuranceDecision?.label || "-";
    const just = r?.insuranceDecision?.justification || "-";
    const conf = Array.isArray(r?.conflicts) ? r.conflicts.join("<br>") : "-";
    return `<tr>
      <td>${r?.name || "-"}</td>
      <td>${r?.itemType || "-"}</td>
      <td>${r?.doseRegimen || "-"}</td>
      <td>${r?.intendedIndication || "-"}</td>
      <td>${r?.isIndicationDocumented ? "نعم" : "لا"}</td>
      <td>${conf || "-"}</td>
      <td ${colorCell(risk)}><b>${risk}%</b></td>
      <td>${dec}</td>
      <td>${just}</td>
    </tr>`;
  }).join("");

  const contrad = (Array.isArray(s.contradictions) ? s.contradictions : [])
    .map((c) => `<li>• ${c}</li>`).join("") || "<li>لا شيء بارز</li>";

  const miss = (Array.isArray(s.missingActions) ? s.missingActions : [])
    .map((x) => `<li>• ${x}</li>`).join("") || "<li>—</li>";

  const fin = (Array.isArray(s.financialInsights) ? s.financialInsights : [])
    .map((x) => `<li>• ${x}</li>`).join("") || "<li>—</li>";

  const banner =
    `📎 التحليل موجّه بإرشادات WHO/CDC/NIH/NHS ومراجع الدواء (FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed).`;

  const concl = (s?.conclusion || "").trim();

  return `
  <div class="kvs" style="line-height:1.9">
    <div style="margin:8px 0 14px; color:#475569">${banner}</div>

    <h2>📋 ملخص الحالة</h2>
    <p>${concl || "لا توجد معلومات كافية لتقديم تحليل دقيق أو قرارات تأمينية."}</p>

    <h2>⚠️ التناقضات والأخطاء</h2>
    <ul>${contrad}</ul>

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
    <ul>${miss}</ul>

    <h2>📈 فرص تحسين الدخل والخدمة</h2>
    <ul>${fin}</ul>
  </div>`;
}

// ===== Controller =====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "POST only");
    if (!OPENAI_API_KEY) return bad(res, 500, "Missing OPENAI_API_KEY");
    if (!GEMINI_API_KEY) return bad(res, 500, "Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body || {};

    // 1) OCR / extract
    const extracted = await geminiSummarize({ text, files });

    // 2) Primary structure via ChatGPT
    const bundle = { patientInfo, extractedSummary: extracted, userText: text };
    let structured = await chatgptJSON(bundle);

    // 3) Safety refine if weak
    const rows = Array.isArray(structured?.table) ? structured.table : [];
    const weak =
      !rows.length ||
      rows.filter((r) => !Number.isFinite(r?.riskPercent) || !r?.insuranceDecision?.justification).length > rows.length * 0.4;
    if (weak) {
      structured = await chatgptJSON(bundle, [
        { role: "user", content: "أعد التدقيق بإكمال الجدول مع نسب وتبريرات دقيقة ومحددة سريرياً." },
      ]);
    }

    // 4) Apply heuristics based on extracted context
    structured = applyInsuranceHeuristics(structured, `${text}\n${extracted}`);

    // 5) HTML
    const html = toHtml(structured);
    return ok(res, { html, structured, extracted });
  } catch (err) {
    console.error("/api/gpt error:", err);
    return bad(res, 500, err?.message || String(err));
  }
}
