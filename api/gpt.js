// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

// ===== Route config (static literal) =====
export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
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

const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const isNum = (v) => Number.isFinite(v);

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

// ===== Gemini: extract text from files + merge with user text =====
async function geminiSummarize({ text, files }) {
  const parts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data || "").split("base64,").pop(); // تقبل dataURL أو base64 خام
    if (!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: mime,
      base64: b64,
    });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt =
    "أنت مساعد لاستخلاص سريري دقيق: لخص/استخرج من الملفات (OCR) أي نص تشخيصي/تحاليل/أدوية/إجراءات/أعراض." +
    " أعِد نصًا عربيًا موجزًا فقط دون استطراد.";

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: "user", parts: [{ text: text || "لا يوجد نص حر." }] },
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

// ===== Clinical audit prompt (with sources banner) =====
function auditInstructions() {
  return `
أنت استشاري تدقيق طبي وتأميني. المطلوب: تحويل المعطيات (نص حر + OCR + بيانات المريض) إلى JSON منظّم فقط (بدون أي شرح خارج JSON) وفق المخطط أدناه.
إرشادات الموثوقية: WHO, CDC, NIH, NHS, UpToDate, Cochrane, NEJM, Lancet, JAMA, BMJ. مراجع الدواء: FDA, EMA, SFDA, Micromedex, Lexicomp, BNF, DailyMed, USP.

قواعد مهمة (تُدمَج ضمن قرارات التأمين والتبريرات):
- Dengue IgG لوحده لا يثبت عدوى حادة → القرار "قابل للرفض" ما لم توجد أعراض/سياق وبائي قوي؛ التشخيص الحاد يحتاج IgM أو NS1.
- Normal Saline I.V infusion مقبول فقط بوجود دليل جفاف/فقد سوائل/هبوط ضغط؛ إذا لا يوجد (خصوصًا بارتفاع ضغط/اعتلال كلوي) → "قابل للرفض" مع تبرير.
- التبريرات يجب أن تكون سريرية محددة، وليست عامة.

أعد JSON فقط حسب المخطط:
{
  "patientSummary": {"ageYears": number|null, "gender": "ذكر"|"أنثى"|null, "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null, "smoking": {"status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null, "chronicConditions": string[]},
  "diagnosis": string[],
  "symptoms": string[],
  "contradictions": string[],
  "table": [
    {"name": string, "itemType": "lab"|"medication"|"procedure"|"device"|"imaging",
     "doseRegimen": string|null, "intendedIndication": string|null, "isIndicationDocumented": boolean,
     "conflicts": string[], "riskPercent": number,
     "insuranceDecision": {"label": "مقبول"|"قابل للمراجعة"|"قابل للرفض", "justification": string}
    }
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}
ONLY JSON.`;
}

// ===== Hardened canonicalization =====
const CANON = [
  { re: /^AUTO.*CBC|^CBC|COMPLETE\s*BLOOD/i,         meta: { name: "CBC", type: "lab", indication: "تقييم عام لصحة الدم" } },
  { re: /CREATININE/i,                               meta: { name: "Creatinine", type: "lab", indication: "تقييم وظائف الكلى" } },
  { re: /URINE.*ANALYSIS|COMPLETE\s*URINE|C\.?U\.?A/i,meta: { name: "Complete Urine Analysis", type: "lab", indication: "تقييم الجهاز البولي" } },
  { re: /UREA\b/i,                                   meta: { name: "Urea", type: "lab", indication: "تقييم وظائف الكلى" } },
  { re: /URIC\s*ACID/i,                              meta: { name: "Uric Acid", type: "lab", indication: "تقييم فرط حمض اليوريك" } },
  { re: /(SGPT|ALT)\b/i,                             meta: { name: "SGPT (ALT)", type: "lab", indication: "تقييم وظائف الكبد" } },
  { re: /HBA1C|GLYCOSYLATED/i,                       meta: { name: "HbA1c", type: "lab", indication: "متابعة السكري" } },
  { re: /CRP|C-REACTIVE|C\.R\.P/i,                   meta: { name: "CRP", type: "lab", indication: "تقييم الالتهاب" } },
  { re: /CHOL(?!ESTERASE)|CHOLESTEROL|CHLOSTIROL/i,  meta: { name: "Cholesterol", type: "lab", indication: "تقييم دهون الدم" } },
  { re: /LDL\b/i,                                    meta: { name: "LDL Cholesterol", type: "lab", indication: "مخاطر القلب" } },
  { re: /TRIGLYCERIDES?|TG\b/i,                      meta: { name: "Triglycerides", type: "lab", indication: "مخاطر القلب" } },
  { re: /DENGUE.*IGG/i,                              meta: { name: "Dengue Ab IgG", type: "lab", indication: "تعرّض سابق/غير حاد" } },
  { re: /ULTRA\s*SOUND|ULTRASOUND|U\/S/i,            meta: { name: "Ultrasound", type: "imaging", indication: "تقييم البطن/الأعضاء" } },
  { re: /NEBULI[ZS]ER|INHAI?LER/i,                   meta: { name: "Nebulizer / Inhaler", type: "procedure", indication: "أعراض تنفسية" } },
  { re: /NORMAL\s*SALINE|NS\b/i,                     meta: { name: "Normal Saline I.V infusion", type: "medication", indication: "جفاف/هبوط ضغط/فقد سوائل" } },
  { re: /PRIMPERAN|METOCLOPRAMIDE/i,                 meta: { name: "Primperan (Metoclopramide)", type: "medication", indication: "الغثيان/القيء" } },
  { re: /PANTOZOL|PANTOPRAZOLE/i,                    meta: { name: "Pantozol (Pantoprazole) 40mg IV", type: "medication", indication: "GERD/قرحة/نزف/قيء شديد" } },
  { re: /REFERRAL|إحالة/i,                           meta: { name: "Referral", type: "procedure", indication: "تحويل لاختصاصي" } },
];

function toRegExp(x) {
  if (x instanceof RegExp) return x;
  if (typeof x === "string" && x.trim()) {
    try { return new RegExp(x, "i"); } catch { return null; }
  }
  return null;
}

function canonicalize(rawName = "", rawType = "") {
  const name = String(rawName || "");
  for (const entry of CANON) {
    let re, meta;
    if (Array.isArray(entry)) {
      re = toRegExp(entry[0]); meta = entry[1];
    } else {
      re = toRegExp(entry.re); meta = entry.meta;
    }
    if (re && meta && re.test(name)) return { ...meta };
  }
  return { name: name || "-", type: rawType || "lab", indication: null };
}

// ===== Post-processing helpers =====
function needsRefine(s) {
  const rows = Array.isArray(s?.table) ? s.table : [];
  if (!rows.length) return true;
  const zero = rows.filter((r) => !isNum(r?.riskPercent) || r.riskPercent === 0).length;
  const weak = rows.filter(
    (r) => !r?.insuranceDecision?.justification || r.insuranceDecision.justification.trim().length < 18
  ).length;
  return zero / rows.length > 0.35 || weak / rows.length > 0.35;
}

// enforce important insurance rules
function enforceRules(structured, ctx = {}) {
  const rows = Array.isArray(structured?.table) ? structured.table : [];
  for (const r of rows) {
    const canon = canonicalize(r?.name, r?.itemType);
    // Dengue IgG فقط
    if (/Dengue Ab IgG/i.test(canon.name)) {
      const hasStrongContext =
        asArray(structured?.symptoms).join(" ").match(/حمى|طفح|سفر|وباء/i) ||
        asArray(structured?.diagnosis).join(" ").match(/حمى الضنك|dengue/i);
      if (!hasStrongContext) {
        r.insuranceDecision = {
          label: "قابل للرفض",
          justification: "تحليل Dengue IgG لوحده لا يثبت عدوى حالية؛ التشخيص الحاد يحتاج IgM أو NS1 مع سياق سريري/وبائي.",
        };
        r.riskPercent = Math.max(75, r.riskPercent || 0);
      }
    }
    // Normal Saline I.V infusion
    if (/Normal Saline I\.V infusion/i.test(canon.name)) {
      const textBlob =
        [ctx?.userText, structured?.extractedSummary].filter(Boolean).join(" ") +
        " " +
        asArray(structured?.symptoms).join(" ");
      const hasJustification = /جفاف|هبوط ضغط|dehydrat|hypoten/i.test(textBlob);
      const hasContra = /ارتفاع ضغط|hypertens/i.test(textBlob);
      if (!hasJustification || hasContra) {
        r.insuranceDecision = {
          label: "قابل للرفض",
          justification:
            "استخدام محلول وريدي غير مبرر بدون علامات جفاف/هبوط ضغط، مع وجود ارتفاع ضغط/سكري — يُرفض تأمينياً.",
        };
        r.riskPercent = Math.max(80, r.riskPercent || 0);
      }
    }
    // تطبيع الاسم/النوع/المؤشر إن غاب
    r.itemType = r.itemType || canon.type;
    r.name = canon.name || r.name;
    r.intendedIndication = r.intendedIndication || canon.indication || null;
  }
  structured.table = rows;
  return structured;
}

// ===== HTML rendering =====
function colorCell(p) {
  if (!isNum(p)) p = 0;
  if (p >= 75) return 'style="background:#fee2e2;border:1px solid #fecaca"';
  if (p >= 60) return 'style="background:#fff7ed;border:1px solid #ffedd5"';
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';
}

function toHtml(s) {
  const contradictions = (s.contradictions || []).length
    ? s.contradictions.map((c) => `<li>${c}</li>`).join("")
    : "<li>لا شيء بارز</li>";

  const rows = (s.table || []).map((r) => {
    const rp = isNum(r.riskPercent) ? Math.round(r.riskPercent) : 0;
    const dec = r.insuranceDecision?.label || "-";
    const just = r.insuranceDecision?.justification || "-";
    const conf = (r.conflicts || []).join("<br>") || "-";
    const doc  = r.isIndicationDocumented ? "نعم" : "لا";
    return `<tr>
      <td>${r.name || "-"}</td>
      <td>${r.itemType || "-"}</td>
      <td>${r.doseRegimen || "-"}</td>
      <td>${r.intendedIndication || "-"}</td>
      <td>${doc}</td>
      <td>${conf}</td>
      <td ${colorCell(rp)}><b>${rp}%</b></td>
      <td>${dec}</td>
      <td>${just}</td>
    </tr>`;
  }).join("");

  const missing = (s.missingActions || []).map((x) => `<li>• ${x}</li>`).join("") || "<li>—</li>";
  const fin = (s.financialInsights || []).map((x) => `<li>• ${x}</li>`).join("") || "<li>—</li>";

  const banner = `
  <div style="font-size:12px;color:#475569;margin-bottom:6px">
  📎 التحليل موجّه بإرشادات WHO/CDC/NIH/NHS ومراجع الدواء (FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed).
  </div>`;

  return `
  ${banner}
  <h2>📋 ملخص الحالة</h2>
  <div class="kvs"><p>${(s.conclusion || "لا توجد معلومات كافية لتقديم تحليل دقيق.").replace(/\n/g, "<br>")}</p></div>

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

// ===== OpenAI call =====
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
      response_format: { type: "json_object" },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error("OpenAI error: " + JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

// ===== API handler =====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "POST only");
    if (!OPENAI_API_KEY) return bad(res, 500, "Missing OPENAI_API_KEY");
    if (!GEMINI_API_KEY) return bad(res, 500, "Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body || {};
    const extracted = await geminiSummarize({ text, files });

    // حزمة تُرسل إلى النموذجين
    const bundle = {
      patientInfo,
      userText: text,
      extractedSummary: extracted,
    };

    let structured = await chatgptJSON(bundle);
    // قواعد ما بعد المعالجة + تطبيع
    structured = enforceRules(structured, { userText: text, extractedSummary: extracted });

    // إعادة الطلب لو النتائج هشة
    if (needsRefine(structured)) {
      structured = await chatgptJSON(bundle, [
        {
          role: "user",
          content:
            "أعد التدقيق بدقّة مع ملء النِّسَب والتبريرات لكل صف، وربط المؤشّر بالمعطيات السريرية. التزم بقواعد التأمين (IgG وحده وNormal Saline).",
        },
      ]);
      structured = enforceRules(structured, { userText: text, extractedSummary: extracted });
    }

    const html = toHtml(structured);
    return ok(res, { html, structured });
  } catch (err) {
    console.error("/api/gpt error:", err);
    return bad(res, 500, err?.message || String(err));
  }
}
