// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL     = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (r) =>
  (r.headers.get("content-type") || "").includes("application/json")
    ? r.json()
    : { raw: await r.text() };

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const pct   = (n) => Math.round(clamp(Number(n || 0), 0, 100));

// ---------- Gemini resumable upload ----------
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");

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

// ---------- Canonicalization & mapping ----------
const CANON = [
  [/^AUTO.*CBC|^CBC|COMPLETE\s*BLOOD/i, { name: "CBC", type: "lab", indication: "تقييم عام لصحة الدم" }],
  [/CREATININE/i, { name: "Creatinine", type: "lab", indication: "تقييم وظائف الكلى" }],
  [/URINE.*ANALYSIS|COMPLETE\s*URINE|C\.?U\.?A/i, { name: "Complete Urine Analysis", type: "lab", indication: "تقييم الجهاز البولي" }],
  [/UREA\b/i, { name: "Urea", type: "lab", indication: "تقييم وظائف الكلى" }],
  [/URIC\s*ACID/i, { name: "Uric Acid", type: "lab", indication: "تقييم فرط حمض اليوريك/النقرس" }],
  /(SGPT|ALT)\b/i, { name: "SGPT (ALT)", type: "lab", indication: "تقييم وظائف الكبد" },
  [/HBA1C|GLYCOSYLATED/i, { name: "HbA1c", type: "lab", indication: "متابعة السكري" }],
  [/CRP|C-REACTIVE|C\.R\.P/i, { name: "CRP", type: "lab", indication: "تقييم الالتهاب" }],
  [/CHOL(?!ESTERASE)|CHOLESTEROL|CHLOSTIROL/i, { name: "Cholesterol", type: "lab", indication: "تقييم مخاطر القلب" }],
  [/LDL/i, { name: "LDL Cholesterol", type: "lab", indication: "تقييم مخاطر القلب" }],
  [/TRIGLYCERIDES?|TG\b/i, { name: "Triglycerides", type: "lab", indication: "تقييم مخاطر القلب" }],
  [/DENGUE.*IGG/i, { name: "Dengue Ab IgG", type: "lab", indication: "سبر تعرّض سابق/عدوى غير حادة" }],
  [/ULTRA\s*SOUND|ULTRASOUND|U\/S/i, { name: "Ultrasound", type: "imaging", indication: "تقييم الأعضاء الداخلية" }],
  [/NEBULI[ZS]ER|INHAI?LER/i, { name: "Nebulizer / Inhaler", type: "procedure", indication: "علاج أعراض تنفسية" }],
  [/NORMAL\s*SALINE|NS\b/i, { name: "Normal Saline I.V infusion", type: "medication", indication: "تعويض سوائل/هبوط ضغط/جفاف" }],
  [/PRIMPERAN|METOCLOPRAMIDE/i, { name: "Primperan (Metoclopramide)", type: "medication", indication: "الغثيان/القيء" }],
  [/PANTOZOL|PANTOPRAZOLE/i, { name: "Pantozol (Pantoprazole) 40mg IV", type: "medication", indication: "قرحة/نزف/قيء شديد/GERD" }],
  [/REFERRAL|إحالة/i, { name: "Referral", type: "procedure", indication: "تحويل لاختصاصي" }],
];

function canonicalize(rawName = "", rawType = "") {
  for (let i = 0; i < CANON.length; i += 2) {
    const re = CANON[i], meta = CANON[i + 1];
    if (re.test(rawName)) return { ...meta };
  }
  return { name: rawName || "-", type: rawType || "lab", indication: null };
}

function inferIndication(canonName, bundle) {
  const dx = (bundle?.extractedSummary?.diagnosis || []).join(" ").toLowerCase();
  const sx = (bundle?.extractedSummary?.symptoms  || []).join(" ").toLowerCase();
  const user = (bundle?.userText || "").toLowerCase();

  if (/hba1c/i.test(canonName) && /(dm|diabetes|سكري)/i.test(dx + user)) return "متابعة السكري";
  if (/creatinine|urea/i.test(canonName) && /(ckd|kidney|renal|كلو|كلى)/i.test(dx + user)) return "تقييم وظائف الكلى";
  if (/ultrasound/i.test(canonName) && /(abd|بطن|الم بطني|distension|انتفاخ)/i.test(sx + user)) return "ألم/انتفاخ بطني";
  if (/crp/i.test(canonName) && /(حمى|fever|التهاب)/i.test(sx + dx + user)) return "تقييم التهاب/عدوى";
  if (/uric acid/i.test(canonName) && /(gout|نقرس)/i.test(dx + user)) return "تقييم نقرس";
  if (/lipid|cholesterol|ldl|triglyceride/i.test(canonName) && /(htn|ضغط|سكري|قلب)/i.test(dx + user)) return "تقييم مخاطر قلبية وعائية";
  if (/primperan/i.test(canonName) && /(غثيان|قيء|nausea|vomit)/i.test(sx + user)) return "عرض غثيان/قيء";
  if (/pantozol/i.test(canonName) && /(نزف|hematemesis|melena|قيء|epigastric|حرقة)/i.test(sx + user)) return "أعراض هضمية/GERD";
  if (/nebulizer|inhaler/i.test(canonName) && /(سعال|ضيق نفس|wheeze|asma|copd)/i.test(sx + dx + user)) return "أعراض تنفسية";
  return null;
}

// ---------- Gemini prompt (JSON صارم) ----------
function geminiSchemaPrompt(userFreeText) {
  const system = `أنت مساعد لاستخلاص سريري وتأميني. أعد JSON فقط وبلا أي نص خارجه:
{
  "rawLines": string[],
  "diagnosis": string[],
  "symptoms": string[],
  "orders": [
    { "name": string, "type": "lab"|"medication"|"procedure"|"imaging"|"device",
      "dose": string|null, "indication": string|null, "evidence": string|null }
  ]
}`;
  return {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: userFreeText || "لا يوجد نص حر." }] }],
    generationConfig: { responseMimeType: "application/json" },
  };
}

// ---------- Gemini extract ----------
async function geminiExtract({ text, files }) {
  const parts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const base64 = (f?.data || "").includes("base64,")
      ? f.data.split("base64,").pop()
      : (f?.data || "");
    if (!base64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({ name: f?.name || "file", mimeType: mime, base64 });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const body = geminiSchemaPrompt(text);
  if (parts.length) body.contents.push({ role: "user", parts });

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error("Gemini generateContent error: " + JSON.stringify(data));

  let raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "{}";
  let extracted = {};
  try { extracted = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/); if (m) { try { extracted = JSON.parse(m[0]); } catch {} }
  }
  if (!extracted || typeof extracted !== "object") extracted = {};

  extracted.rawLines  = Array.isArray(extracted.rawLines)  ? extracted.rawLines  : [];
  extracted.diagnosis = Array.isArray(extracted.diagnosis) ? extracted.diagnosis : [];
  extracted.symptoms  = Array.isArray(extracted.symptoms)  ? extracted.symptoms  : [];
  extracted.orders    = Array.isArray(extracted.orders)    ? extracted.orders    : [];

  // إذا فشل الاستخلاص— heuristics سريعة
  if (!extracted.orders.length) {
    const hay = (text + "\n" + extracted.rawLines.join("\n")).toUpperCase();
    const quick = [
      [/CBC|COMPLETE\s*BLOOD/, "CBC"],
      [/CREATININE/, "Creatinine"],
      [/URINE\s*ANALYSIS|C\s*U\s*A/, "Complete Urine Analysis"],
      [/UREA/, "Urea"],
      [/URIC\s*ACID/, "Uric Acid"],
      [/(SGPT|ALT)\b/, "SGPT (ALT)"],
      [/HBA1C|GLYCOSYLATED/, "HbA1c"],
      [/CRP|C-REACTIVE|C\.R\.P/, "CRP"],
      [/CHOLESTEROL|CHLOSTIROL/, "Cholesterol"],
      [/LDL\b/, "LDL Cholesterol"],
      [/TRIGLYCERIDES?/, "Triglycerides"],
      [/DENGUE.*IGG/, "Dengue Ab IgG"],
      [/ULTRA\s*SOUND|ULTRASOUND/, "Ultrasound"],
      [/NEBULI[ZS]ER|INHAI?LER/, "Nebulizer / Inhaler"],
      [/NORMAL\s*SALINE|NS\b/, "Normal Saline I.V infusion"],
      [/PRIMPERAN|METOCLOPRAMIDE/, "Primperan (Metoclopramide)"],
      [/PANTOZOL|PANTOPRAZOLE/, "Pantozol (Pantoprazole) 40mg IV"],
      [/REFERRAL|إحالة/, "Referral"],
    ];
    for (const [re, nm] of quick) if (re.test(hay)) extracted.orders.push({ name: nm, type: null, dose: null, indication: null, evidence: null });
  }

  return extracted;
}

// ---------- OpenAI system prompt ----------
function auditSystemPrompt() {
  return `
أنت استشاري تدقيق طبي وتأميني. حلّل مدخلات الحالة (patientInfo + extractedSummary + userText + seedTable)
وأخرج JSON فقط وفق المخطط التالي، بلا أي نص خارجه. استخدم الأدلة (WHO/CDC/NIH/NHS/UpToDate) ومراجع الدواء (FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed) كمرجع عام دون اقتباسات حرفية:

{
  "patientSummary": {"ageYears": number|null, "gender": "ذكر"|"أنثى"|null,
    "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null,
    "smoking": {"status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null,
    "chronicConditions": string[]},
  "diagnosis": string[],
  "symptoms": string[],
  "contradictions": string[],
  "table": [
    {"name": string, "itemType": "lab"|"medication"|"procedure"|"device"|"imaging",
     "doseRegimen": string|null, "intendedIndication": string|null,
     "isIndicationDocumented": boolean, "conflicts": string[],
     "riskPercent": number,
     "insuranceDecision": {"label": "مقبول"|"قابل للمراجعة"|"قابل للرفض", "justification": string}}
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}

تعليمات الجودة:
- اعتمد seedTable ولا تُفرغه، واملأ المؤشّر والتبرير بدقة.
- إذا نقص التوثيق، عِلّمه isIndicationDocumented=false لكن لا تترك justification فارغًا.
- لا تُخرج أي شيء خارج JSON.
`;
}

// ---------- Insurance soft rules ----------
function applySoftRules(structured, bundle) {
  const textAll = ((bundle?.userText || "") + " " + (bundle?.extractedSummary?.rawLines || []).join(" ")).toLowerCase();
  const dxAll   = (bundle?.extractedSummary?.diagnosis || []).join(" ").toLowerCase();
  const sxAll   = (bundle?.extractedSummary?.symptoms || []).join(" ").toLowerCase();
  const hasResp = /سعال|ضيق نفس|wheeze|asma|copd|cough|dyspnea/.test(sxAll + textAll + dxAll);
  const hasDehydrationOrHypo = /جفاف|هبوط ضغط|dehydration|hypotension/.test(textAll + sxAll);
  const hasHTN = /htn|ضغط|hypertension/.test(textAll + dxAll);
  const hasDM  = /dm|diabetes|سكري/.test(textAll + dxAll);

  structured.table = Array.isArray(structured.table) ? structured.table : [];

  for (const r of structured.table) {
    const nm = (r?.name || "").toUpperCase();

    // Dengue IgG منفرد
    if (/DENGUE/.test(nm) && /IGG/.test(nm) && !/IGM|NS1/.test(nm)) {
      r.riskPercent = Math.max(r.riskPercent || 0, 75);
      r.insuranceDecision = {
        label: "قابل للرفض",
        justification: "تحليل Dengue IgG لوحده لا يثبت عدوى حادة؛ التشخيص الحاد يحتاج IgM أو NS1 مع سياق سريري/وبائي.",
      };
      r.conflicts = Array.isArray(r.conflicts) ? r.conflicts : [];
      if (!r.conflicts.includes("IgG منفرد")) r.conflicts.push("IgG منفرد");
    }

    // Normal Saline بدون مبرر
    if (/NORMAL\s*SALINE|NS\b/.test(r?.name || "")) {
      if (!hasDehydrationOrHypo) {
        r.riskPercent = Math.max(r.riskPercent || 0, 80);
        r.insuranceDecision = {
          label: "قابل للرفض",
          justification: "استخدام محلول وريدي غير مبرر بدون علامات جفاف/هبوط ضغط. يُقبل فقط مع توثيق سريري واضح.",
        };
        r.conflicts = Array.isArray(r.conflicts) ? r.conflicts : [];
        if (hasHTN && !r.conflicts.includes("ارتفاع ضغط")) r.conflicts.push("ارتفاع ضغط");
        if (hasDM && !r.conflicts.includes("سكري")) r.conflicts.push("سكري");
      }
    }

    // Nebulizer بدون أعراض تنفسية
    if (/NEBULIZER|INHALER/.test(r?.name || "")) {
      if (!hasResp) {
        r.riskPercent = Math.max(r.riskPercent || 0, 65);
        r.insuranceDecision = {
          label: "قابل للمراجعة",
          justification: "ينبغي توثيق أعراض/علامات تنفسية (ضيق نفس/أزيز/تشبّع أكسجين) لتبرير الإجراء.",
        };
      }
    }

    // PPI IV بدون مؤشرات قوية
    if (/PANTOZOL|PANTOPRAZOLE/.test(r?.name || "")) {
      if (!/(نزف|hematemesis|melena|قيء شديد)/i.test(textAll + sxAll)) {
        r.riskPercent = Math.max(r.riskPercent || 0, 60);
        r.insuranceDecision = {
          label: "قابل للمراجعة",
          justification: "PPI عبر الوريد يُفضل عند نزف علوي/قيء شديد. بدون ذلك يُفضّل الشكل الفموي أو مراجعة الضرورة.",
        };
      }
    }

    // قواعد خفيفة لقبول الفحوص الروتينية في DM/HTN
    if (/HBA1C|LDL|CHOLESTEROL|TRIGLYCERIDES|CREATININE|UREA|CBC|CRP|URINE/i.test(r?.name || "")) {
      if (!r.insuranceDecision?.label || r.insuranceDecision.label === "قابل للمراجعة") {
        r.riskPercent = Math.max(r.riskPercent || 0, 10);
        r.insuranceDecision = {
          label: "مقبول",
          justification: "فحص روتيني موصَى به لمتابعة الأمراض المزمنة/المخاطر وفق الإرشادات.",
        };
      }
    }
  }

  structured.financialInsights = Array.isArray(structured.financialInsights) ? structured.financialInsights : [];
  return structured;
}

// ---------- OpenAI polish ----------
async function chatgptPolish(bundle) {
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
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
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

// ---------- HTML ----------
function pill(color) {
  const bg = color === "red" ? "#fee2e2" : color === "amber" ? "#fff7ed" : "#ecfdf5";
  const bd = color === "red" ? "#fecaca" : color === "amber" ? "#ffedd5" : "#d1fae5";
  return `style="background:${bg};border:1px solid ${bd};padding:.25rem .5rem;border-radius:.5rem"`;
}
const colorOf = (p) => (p >= 75 ? "red" : p >= 60 ? "amber" : "green");

function toHtml(s) {
  const rows = (s.table || []).map(r => {
    const p = pct(r.riskPercent);
    return `<tr>
      <td>${r.name || "-"}</td>
      <td>${r.itemType || "-"}</td>
      <td>${r.doseRegimen || "-"}</td>
      <td>${r.intendedIndication || "-"}</td>
      <td>${r.isIndicationDocumented ? "نعم" : "لا"}</td>
      <td>${(r.conflicts || []).join("<br>") || "-"}</td>
      <td ${pill(colorOf(p))}><b>${p}%</b></td>
      <td>${r?.insuranceDecision?.label || "-"}</td>
      <td>${r?.insuranceDecision?.justification || "-"}</td>
    </tr>`;
  }).join("");

  const contradictions = (s.contradictions || []).length
    ? s.contradictions.map(c => `<li>${c}</li>`).join("")
    : "<li>لا يوجد تناقضات واضحة</li>";

  const shouldDo = (s.missingActions || []).map(x => `<li>${x}</li>`).join("") || "<li>—</li>";
  const fin = (s.financialInsights || []).map(x => `<li>${x}</li>`).join("") || "<li>—</li>";

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

// ---------- API handler ----------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "POST only");
    if (!OPENAI_API_KEY) return bad(res, 500, "Missing OPENAI_API_KEY");
    if (!GEMINI_API_KEY)  return bad(res, 500, "Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body || {};

    // (1) Gemini extract
    const extracted = await geminiExtract({ text, files });

    // (2) Canonicalize + seed table
    const seed = (extracted.orders || []).map(o => {
      const c = canonicalize(o?.name || "", o?.type || "");
      const inferred = inferIndication(c.name, { extractedSummary: extracted, userText: text });
      return {
        name: c.name,
        itemType: c.type,
        doseRegimen: o?.dose || null,
        intendedIndication: o?.indication || inferred || c.indication || null,
        isIndicationDocumented: !!(o?.evidence || o?.indication || inferred),
        conflicts: [],
        riskPercent: 0,
        insuranceDecision: { label: "قابل للمراجعة", justification: "تقدير أولي — بانتظار التوثيق السريري." },
      };
    });

    const bundle = {
      patientInfo,
      userText: text,
      extractedSummary: extracted,
      seedTable: seed,
      diagnosis: extracted.diagnosis,
      symptoms: extracted.symptoms,
      contradictions: [],
    };

    // (3) OpenAI polish
    let s = await chatgptPolish(bundle);

    // حرس ضد إفراغ الجداول/القوائم
    if (!Array.isArray(s.table) || !s.table.length) s.table = seed;
    if (!Array.isArray(s.contradictions)) s.contradictions = [];
    if (!Array.isArray(s.missingActions)) s.missingActions = [];
    if (!Array.isArray(s.financialInsights)) s.financialInsights = [];

    // (4) قواعد تأمينية
    s = applySoftRules(s, { userText: text, extractedSummary: extracted });

    // (5) Fallback conclusion + فرص مالية أساسية
    if (!s.conclusion || s.conclusion.trim().length < 10) {
      s.conclusion = "تحليل آلي أوّلي مع إبراز عناصر قد تُرفض تأمينياً (مثل IgG منفرد أو سوائل بلا جفاف). استكمل التوثيق السريري.";
    }
    if (s.financialInsights.length === 0) {
      s.financialInsights = [
        "تقليل الطلبات غير المبررة (IgG منفرد/سوائل دون جفاف) لخفض الرفض التأميني.",
        "استخدام قوالب توثيق المؤشّر السريري (Indication) يرفع نسب الموافقة.",
        "متابعة DM/HTN عبر HbA1c/eGFR/الدهون حسب الإرشادات.",
      ];
    }

    const html = toHtml(s);
    return ok(res, { html, structured: s });
  } catch (err) {
    console.error("/api/gpt error:", err);
    return bad(res, 500, err?.message || String(err));
  }
}
