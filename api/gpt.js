// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

// ===== Route config (must be static literal) =====
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
const parseJsonSafe = async (r) =>
  (r.headers.get("content-type") || "").includes("application/json")
    ? r.json()
    : { raw: await r.text() };

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const asPct = (n) => Math.round(clamp(Number(n || 0), 0, 100));

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

// ===== Gemini prompt schema (نطلب JSON رسمي) =====
function geminiSchemaPrompt(userFreeText) {
  const system = `أنت مساعد لاستخلاص سريري وتأميني. أعد JSON فقط بالمخطط التالي، بلا أي نص خارج JSON.
{
  "rawLines": string[],                // سطور من OCR أو الملف
  "orders": [                          // طلبات وتحاليل/أدوية/إجراءات
    { "name": string, "type": "lab"|"medication"|"procedure"|"imaging"|"device",
      "dose": string|null, "indication": string|null }
  ],
  "diagnosis": string[],               // تشخيصات مذكورة
  "symptoms": string[]                 // أعراض/علامات مذكورة (كلمات بسيطة)
}
`;
  return {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: userFreeText || "لا يوجد نص حر." }] }],
    generationConfig: { responseMimeType: "application/json" },
  };
}

// ===== Gemini: extract text+orders from files and free text =====
async function geminiExtract({ text, files }) {
  // attach files
  const parts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const base64 = (f?.data || "").split("base64,").pop() || f?.data || "";
    if (!base64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: mime,
      base64,
    });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  // build body & call Gemini
  const body = geminiSchemaPrompt(text);
  if (parts.length) body.contents.push({ role: "user", parts });

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error("Gemini generateContent error: " + JSON.stringify(data));

  // try strict JSON first; otherwise try to salvage a JSON block
  let raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "{}";
  let extracted = {};
  try {
    extracted = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { extracted = JSON.parse(m[0]); } catch {}
    }
  }
  if (!extracted || typeof extracted !== "object") extracted = {};

  // normalize shape
  extracted.rawLines = Array.isArray(extracted.rawLines) ? extracted.rawLines : [];
  extracted.orders   = Array.isArray(extracted.orders)   ? extracted.orders   : [];
  extracted.diagnosis = Array.isArray(extracted.diagnosis) ? extracted.diagnosis : [];
  extracted.symptoms  = Array.isArray(extracted.symptoms)  ? extracted.symptoms  : [];

  // === Fallback: heuristics when orders are empty ===
  if (!extracted.orders.length) {
    const hay = (text + "\n" + extracted.rawLines.join("\n")).toUpperCase();
    const patterns = [
      [/CBC|COMPLETE\s*BLOOD/i,                { name: "CBC", type: "lab" }],
      [/CREATININE/i,                          { name: "Creatinine", type: "lab" }],
      [/URINE\s*ANALYSIS|C(?:OMPLETE)?\s*U/i,  { name: "Complete Urine Analysis", type: "lab" }],
      [/UREA\b/i,                              { name: "Urea", type: "lab" }],
      [/URIC\s*ACID/i,                         { name: "Uric Acid", type: "lab" }],
      [/(SGPT|ALT)\b/i,                         { name: "SGPT (ALT)", type: "lab" }],
      [/HBA1C|GLYCOSYLATED/i,                  { name: "HbA1c", type: "lab" }],
      [/LDL\b/i,                               { name: "LDL", type: "lab" }],
      [/TRIGLYCERIDES?|TG\b/i,                 { name: "Triglycerides", type: "lab" }],
      [/CRP|C-REACTIVE/i,                      { name: "CRP", type: "lab" }],
      [/DENGUE.*IGG/i,                         { name: "Dengue Ab IgG", type: "lab" }],
      [/ULTRASOUND|ULTRA\s*SOUND/i,            { name: "Ultrasound", type: "imaging" }],
      [/NEBULIZER|INHALER/i,                   { name: "Nebulizer + Inhaler", type: "procedure" }],
      [/NORMAL\s*SALINE|NS\s*I\.?V/i,          { name: "Normal Saline I.V infusion", type: "medication" }],
      [/PRIMPERAN|METOCLOPRAMIDE/i,            { name: "Primperan", type: "medication" }],
      [/PARACETAMOL|ACETAMINOPHEN/i,           { name: "Paracetamol (IV)", type: "medication" }],
      [/PANTOZOL|PANTOPRAZOLE/i,               { name: "Pantozol 40mg IV", type: "medication" }],
    ];
    for (const [re, meta] of patterns) {
      if (re.test(hay)) extracted.orders.push({ ...meta, dose: null, indication: "مذكور ضمن المستند" });
    }
  }

  return extracted;
}

// ===== System prompt for OpenAI (التلميع/التحويل لـ JSON نهائي) =====
function auditSystemPrompt() {
  return `
أنت استشاري تدقيق طبي وتأميني. حلّل مدخلات الحالة (patientInfo + extractedSummary + userText + orders)
وأخرج JSON فقط وفق المخطط التالي، بلا أي نص خارجه. استخدم مراجع الأدلة (WHO/CDC/NIH/NHS/UpToDate) وخلفية دوائية (FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed) كموجهات عامة، دون اقتباسات.

{
  "patientSummary": {
    "ageYears": number|null,
    "gender": "ذكر"|"أنثى"|null,
    "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null,
    "smoking": {"status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null,
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
      "riskPercent": number,
      "insuranceDecision": { "label": "مقبول"|"قابل للمراجعة"|"قابل للرفض", "justification": string }
    }
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}

شروط جودة:
- لا تُرجع نصاً خارج JSON.
- املأ justification سريرياً بوضوح، وتجنب العموميات.
- إن لم تتوفر معلومات كافية، اذكر ذلك لكن احرص على ملء الجدول بما تستطيع استخلاصه.
`;
}

// ===== Apply soft insurance rules after polishing =====
function applySoftRules(polished, bundle) {
  const age = bundle?.patientInfo?.ageYears ?? null;
  const gender = bundle?.patientInfo?.gender || null;
  const hasRespSx = (bundle?.extractedSummary?.symptoms || [])
    .concat(bundle?.symptoms || [])
    .join(" ").toLowerCase()
    .match(/سعال|ضيق نفس|wheeze|cough|dyspnea/);

  const hasDehydrationOrHypotension =
    /جفاف|هبوط ضغط|dehydration|hypotension/i.test(
      (bundle?.userText || "") + " " + (bundle?.extractedSummaryText || "") + " " + (bundle?.extractedSummary?.rawLines || []).join(" ")
    );

  const hasHTN = /HTN|ضغط|hypertension/i.test(
    (bundle?.userText || "") + " " + (bundle?.extractedSummary?.diagnosis || []).join(" ")
  );

  for (const r of polished.table || []) {
    const nm = (r?.name || "").toUpperCase();

    // Dengue IgG alone ⇒ قابل للرفض
    if (/DENGUE/.test(nm) && /IGG/.test(nm) && !/IGM|NS1/.test(nm)) {
      r.riskPercent = Math.max(r.riskPercent || 0, 75);
      r.insuranceDecision = { label: "قابل للرفض",
        justification: "تحليل Dengue IgG لوحده لا يثبت عدوى حادة؛ التشخيص الحاد يحتاج IgM أو NS1 مع سياق سريري/وبائي مناسب." };
      r.conflicts = Array.isArray(r.conflicts) ? r.conflicts : [];
      if (!r.conflicts.includes("IgG منفرد")) r.conflicts.push("IgG منفرد");
    }

    // Normal Saline I.V without dehydration/hypotension (esp. with HTN/DM) ⇒ رفض
    if (/NORMAL\s*SALINE|NS\b/i.test(r?.name || "")) {
      if (!hasDehydrationOrHypotension) {
        r.riskPercent = Math.max(r.riskPercent || 0, 80);
        r.insuranceDecision = { label: "قابل للرفض",
          justification: "استخدام محلول وريدي غير مبرر بدون علامات جفاف/هبوط ضغط. يُقبل فقط عند وجود مبررات واضحة." };
        r.conflicts = Array.isArray(r.conflicts) ? r.conflicts : [];
        if (hasHTN && !r.conflicts.includes("ارتفاع ضغط")) r.conflicts.push("ارتفاع ضغط");
      }
    }

    // Nebulizer/ Inhaler without respiratory symptoms ⇒ قابل للمراجعة
    if (/NEBULIZER|INHALER/i.test(r?.name || "")) {
      if (!hasRespSx) {
        r.riskPercent = Math.max(r.riskPercent || 0, 65);
        r.insuranceDecision = { label: "قابل للمراجعة",
          justification: "ينبغي توثيق أعراض/علامات تنفسية (ضيق نفس/أزيز/تشبع أوكسجين) لتبرير الإجراء." };
      }
    }

    // Pregnant safety guard (example soft tweak)
    if (gender === "أنثى" && bundle?.patientInfo?.pregnant?.isPregnant && r.itemType === "medication") {
      r.conflicts = Array.isArray(r.conflicts) ? r.conflicts : [];
      if (!r.conflicts.includes("حمل")) r.conflicts.push("حمل");
    }
  }

  // Financial insights fallback array
  if (!Array.isArray(polished.financialInsights)) polished.financialInsights = [];
  return polished;
}

// ===== OpenAI polish to structured JSON =====
async function chatgptPolish(bundle) {
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: auditSystemPrompt() },
        { role: "user", content: JSON.stringify(bundle) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error("OpenAI error: " + JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

// ===== Utilities to HTML =====
function pill(color, txt) {
  const bg = color === "red" ? "#fee2e2" : color === "amber" ? "#fff7ed" : "#ecfdf5";
  const bd = color === "red" ? "#fecaca" : color === "amber" ? "#ffedd5" : "#d1fae5";
  return `style="background:${bg}; border:1px solid ${bd}; padding:.25rem .5rem; border-radius:.5rem"`;
}
function riskColor(p) { return p >= 75 ? "red" : p >= 60 ? "amber" : "green"; }

function toHtml(s) {
  const rows = (s.table || []).map((r) => {
    const p = asPct(r.riskPercent);
    const color = riskColor(p);
    const dec = r?.insuranceDecision?.label || "-";
    const just = r?.insuranceDecision?.justification || "-";
    return `<tr>
      <td>${r.name || "-"}</td>
      <td>${r.itemType || "-"}</td>
      <td>${r.doseRegimen || "-"}</td>
      <td>${r.intendedIndication || "-"}</td>
      <td>${r.isIndicationDocumented ? "نعم" : "لا"}</td>
      <td>${(r.conflicts || []).join("<br>") || "-"}</td>
      <td ${pill(color, "")}><b>${p}%</b></td>
      <td>${dec}</td>
      <td>${just}</td>
    </tr>`;
  }).join("");

  const contradictions = (s.contradictions || []).length
    ? s.contradictions.map((c) => `<li>${c}</li>`).join("")
    : "<li>لا يوجد تناقضات واضحة</li>";

  const shouldDo = (s.missingActions || []).map((x) => `<li>${x}</li>`).join("") || "<li>—</li>";
  const fin = (s.financialInsights || []).map((x) => `<li>${x}</li>`).join("") || "<li>—</li>";

  const banner = `<div style="font-size:12px;color:#475569;margin-bottom:8px">
📎 التحليل موجّه بإرشادات WHO/CDC/NIH/NHS ومراجع الدواء (FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed).
</div>`;

  return `
${banner}
<h2>📋 ملخص الحالة</h2>
<div class="kvs"><p>${(s.conclusion || "لا توجد معلومات كافية لتقديم تقييم دقيق أو توصيات علاجية.").replace(/\n/g, "<br>")}</p></div>

<h2>⚠️ التناقضات والأخطاء</h2>
<ul>${contradictions}</ul>

<h2>💊 جدول الأدوية والإجراءات</h2>
<table dir="rtl" style="width:100%;border-collapse:collapse">
  <thead>
    <tr>
      <th>الاسم</th><th>التصنيف</th><th>الجرعة</th><th>المؤشّر</th>
      <th>موثّق؟</th><th>تعارضات</th><th>درجة الخطورة</th>
      <th>قرار التأمين</th><th>التبرير</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<h2>🩺 ما كان يجب القيام به</h2>
<ul>${shouldDo}</ul>

<h2>📈 فرص تحسين الدخل والخدمة</h2>
<ul>${fin}</ul>
`;
}

// ===== API Handler =====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "POST only");
    if (!OPENAI_API_KEY) return bad(res, 500, "Missing OPENAI_API_KEY");
    if (!GEMINI_API_KEY)  return bad(res, 500, "Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body || {};

    // 1) Gemini extraction
    const extracted = await geminiExtract({ text, files });

    // bundle for GPT polish
    const bundle = {
      patientInfo,
      userText: text,
      extractedSummary: extracted,
      extractedSummaryText: (extracted.rawLines || []).join("\n"),
      // seed table for GPT (helps preserve)
      table: extracted.orders.map((o) => ({
        name: o.name,
        itemType: o.type,
        doseRegimen: o.dose || null,
        intendedIndication: o.indication || null,
        isIndicationDocumented: !!o.indication,
        conflicts: [],
        riskPercent: 0,
        insuranceDecision: { label: "قابل للمراجعة", justification: "تقدير أولي — بانتظار التوثيق السريري." },
      })),
      contradictions: [],
    };

    // 2) OpenAI polish
    let structured = await chatgptPolish(bundle);

    // 🔒 preserve if GPT returned empty sections
    if (!Array.isArray(structured.table) || structured.table.length === 0) {
      structured.table = bundle.table;
    }
    if (!Array.isArray(structured.contradictions) || structured.contradictions.length === 0) {
      structured.contradictions = bundle.contradictions;
    }

    // 3) Soft rules
    structured = applySoftRules(structured, { patientInfo, userText: text, extractedSummary: extracted });

    // 4) Fallback conclusion
    if (!structured.conclusion || structured.conclusion.trim().length < 10) {
      structured.conclusion = "تحليل آلي أوّلي. أُبرزت عناصر قد تُرفض تأمينياً (مثل IgG منفرد أو سوائل بلا جفاف). استكمل التوثيق السريري.";
    }

    // 5) HTML
    const html = toHtml(structured);
    return ok(res, { html, structured });
  } catch (err) {
    console.error("/api/gpt error:", err);
    return bad(res, 500, err?.message || String(err));
  }
}
