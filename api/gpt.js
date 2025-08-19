// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

// ===== Route config (must be static literal) =====
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

// ===== Keys & endpoints =====
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// ===== Helpers =====
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (r) =>
  (r.headers.get("content-type") || "").includes("application/json")
    ? r.json()
    : { raw: await r.text() };

function arr(x){ return Array.isArray(x) ? x : (x ? [x] : []); }
function asNum(n){ const v = Number(n); return Number.isFinite(v) ? v : null; }

// ===== Gemini: resumable upload (Files API) =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");

  // 1) init resumable
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

// ===== 1) Gemini → extraction JSON (أقوى وفرض مخطط) =====
function geminiSchemaPrompt(userText){
  return {
    system_instruction: {
      parts: [{
        text:
`أنت أداة استخراج حقائق طبية (OCR → JSON فقط). التزم بالمخطط حرفيًا وأعد JSON صالح دون أي تعليق.

استعن بالدلائل العالمية عند تسمية العناصر (WHO/CDC/NIH/NHS) ولكن لا تضع آراء علاجية؛ فقط حقائق من المستند/النص.

SCHEMA (return exactly this shape):
{
  "patient": {"ageYears": number|null, "gender": "ذكر"|"أنثى"|null, "pregnant": boolean|null},
  "vitals": {"bpSystolic": number|null, "bpDiastolic": number|null, "tempC": number|null},
  "symptoms": string[],
  "diagnoses": string[],
  "orders": [
    {"name": string, "type": "lab"|"medication"|"procedure"|"device"|"imaging", "dose": string|null, "indication": string|null}
  ],
  "flags": {
    "dehydrationLikely": boolean|null,
    "hypotension": boolean|null,
    "respiratorySymptoms": boolean|null,
    "abdominalPain": boolean|null
  },
  "rawLines": string[]   // أسطر/بنود مأخوذة كما ظهرت (اختياري)
}

مهم: إذا رأيت عناصر مثل:
- CBC, Creatinine, Urea, Uric Acid, SGPT/ALT, HbA1c, Cholesterol, LDL, Triglycerides, CRP
- Dengue Ab (IgG/IgM/NS1)
- Ultrasound/Ultra Sound
- Normal Saline I.V. infusion
- Nebulizer/Inhaler
- Primperan/Metoclopramide, Paracetamol, Pantozol/Pantoprazole
أدرجها في orders مع النوع المناسب. استخرج ضغط الدم مثل "BP: 140/100".
`
      }]
    },
    contents: [
      { role: "user", parts: [{ text: "النص الحر للمريض:\n" + (userText || "لا يوجد") }] }
    ]
  };
}

async function geminiExtract({ text, files }){
  const parts = [];
  for(const f of files || []){
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data || "").split("base64,").pop() || f?.data;
    if(!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({ name: f?.name || "file", mimeType: mime, base64: b64 });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const body = geminiSchemaPrompt(text);
  if (parts.length) body.contents.push({ role: "user", parts });

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error("Gemini generateContent error: " + JSON.stringify(data));

  // Gemini رد غالبًا كنص JSON داخل part.text
  const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "{}";
  let extracted = {};
  try { extracted = JSON.parse(raw); } catch { extracted = {}; }

  // fallback: التقط ضغط الدم من النص إن وُجد
  const allText = [text, ...(arr(extracted?.rawLines))].join("\n");
  const mBP = allText.match(/BP[:\s]*([0-9]{2,3})\s*\/\s*([0-9]{2,3})/i);
  if (mBP) {
    extracted.vitals = extracted.vitals || {};
    extracted.vitals.bpSystolic = asNum(mBP[1]);
    extracted.vitals.bpDiastolic = asNum(mBP[2]);
  }

  // تأكيد الحقول
  extracted.patient  = extracted.patient  || { ageYears:null, gender:null, pregnant:null };
  extracted.vitals   = extracted.vitals   || { bpSystolic:null, bpDiastolic:null, tempC:null };
  extracted.symptoms = arr(extracted.symptoms);
  extracted.diagnoses= arr(extracted.diagnoses);
  extracted.orders   = arr(extracted.orders);
  extracted.flags    = extracted.flags || { dehydrationLikely:null, hypotension:null, respiratorySymptoms:null, abdominalPain:null };
  extracted.rawLines = arr(extracted.rawLines);

  // إذا لم يجد أوامر، حاول التقاط أسماء شائعة من النص الخام
  if (!extracted.orders.length) {
    const catalog = [
      ["AUTOMATED COMPLETE BLOOD CELL COUNT", "CBC", "lab"],
      ["Creatinine","Creatinine","lab"],
      ["COMPLETE URINE ANALYSIS","Complete Urine Analysis","lab"],
      ["Urea","Urea","lab"],
      ["Uric Acid","Uric Acid","lab"],
      ["SGPT","Liver enzyme (SGPT)","lab"],
      ["Glycosylated","HbA1c","lab"],
      ["cholesterol","Cholesterol","lab"],
      ["L.D.L","LDL","lab"],
      ["Triglycerides","Triglycerides","lab"],
      ["C-REACTIVE","CRP","lab"],
      ["DENGUE AB IGG","Dengue IgG","lab"],
      ["ULTRA SOUND","Ultrasound","imaging"],
      ["NEBULIZER","Nebulizer + Inhaler","procedure"],
      ["NORMAL SALINE","Normal Saline I.V infusion","medication"],
      ["PRIMPERAN","Primperan","medication"],
      ["PARACETAMOL","Paracetamol (IV)","medication"],
      ["PANTOZOL","Pantozol 40mg IV","medication"]
    ];
    const hay = allText.toUpperCase();
    for (const [needle, label, type] of catalog) {
      if (hay.includes(needle)) extracted.orders.push({ name: label, type, dose:null, indication:null });
    }
  }

  // أعلام إضافية من الكلمات
  const hay2 = (text||"") + "\n" + extracted.rawLines.join("\n");
  const hasResp = /cough|shortness of breath|wheeze|dyspnea|ضيق|سعال/i.test(hay2);
  const hasAbd  = /abdomen|epigastric|periumbilical|بطن|شرسوفي/i.test(hay2);
  extracted.flags.respiratorySymptoms ??= (hasResp ? true : null);
  extracted.flags.abdominalPain ??= (hasAbd ? true : null);

  return extracted;
}

// ===== 2) Rule engine (بدون فرض آراء علاجية؛ فقط قرار تأميني قابل للتفسير) =====
function decideForRow(row, facts){
  const bpSys = facts?.vitals?.bpSystolic;
  const bpDia = facts?.vitals?.bpDiastolic;
  const htN   = (asNum(bpSys) && asNum(bpDia)) ? (bpSys >= 140 || bpDia >= 90) : false;

  const S = (txt)=>txt; // for Arabic output directly below

  // defaults
  let risk = 30, label = "مقبول", why = "فحص/إجراء منخفض المخاطر ومفيد سريريًا حسب السياق العام.";
  const ind = (row.indication || "").toLowerCase();

  // Labs — آمنة إفتراضيًا
  if (row.type === "lab") {
    risk = 20;
    if (/dengue.*igg/i.test(row.name)) {
      risk  = 85;
      label = "قابل للرفض";
      why   = S("تحليل Dengue IgG لوحده لا يثبت عدوى حالية؛ يُطلب IgM أو NS1 لتشخيص عدوى حادة.");
    }
    if (/crp/i.test(row.name)) { risk = 25; }
    if (/uric|urate/i.test(row.name)) { risk = 45; why = S("قد يفيد حسب السياق، يُفضَّل تبرير سريري واضح."); }
  }

  // Meds / Procedures / Devices
  if (/normal saline/i.test(row.name)) {
    const dehydr = facts?.flags?.dehydrationLikely === true;
    const hypot  = facts?.flags?.hypotension === true;
    if (dehydr || hypot) {
      risk = 30; label = "مقبول";
      why  = S("مبرر بوجود جفاف/هبوط ضغط.");
    } else if (htN) {
      risk = 90; label = "قابل للرفض";
      why  = S("محلول وريدي غير مبرر في وجود ارتفاع ضغط الدم وغياب علامات الجفاف/الهبوط.");
    } else {
      risk = 70; label = "قابل للمراجعة";
      why  = S("يحتاج توثيقًا لعلامات جفاف/هبوط ضغط.");
    }
  }

  if (/nebulizer|inhaler/i.test(row.name)) {
    if (facts?.flags?.respiratorySymptoms) {
      risk = 35; label = "مقبول"; why = S("موثق بأعراض تنفسية.");
    } else {
      risk = 70; label = "قابل للمراجعة"; why = S("غياب أعراض تنفسية موثقة.");
    }
  }

  if (/ultra\s*sound|ultrasound/i.test(row.name) && !facts?.flags?.abdominalPain){
    risk = 60; label = "قابل للمراجعة"; why = S("يوثَّق سبب واضح (مثلاً ألم بطني محدد).");
  }

  if (/primperan|metoclopramide/i.test(row.name)) {
    risk = 40; label = "مقبول"; why = S("لعلاج الغثيان/الإقياء عند اللزوم.");
  }
  if (/paracetamol/i.test(row.name)) {
    risk = 30; label = "مقبول"; why = S("مسكن/خافض حرارة منخفض المخاطر.");
  }
  if (/pantozol|pantoprazole/i.test(row.name)) {
    risk = 45; label = "قابل للمراجعة"; why = S("يوثَّق وجود أعراض هضمية/نزف/وقاية دوائية.");
  }

  return { riskPercent: Math.max(0, Math.min(100, Math.round(risk))), insuranceDecision: { label, justification: why } };
}

function buildTable(facts){
  const rows = [];
  for (const o of arr(facts.orders)) {
    const base = {
      name: o?.name || "-",
      itemType: (o?.type || "procedure").toLowerCase(),
      doseRegimen: o?.dose || null,
      intendedIndication: o?.indication || null,
      isIndicationDocumented: Boolean(o?.indication && o.indication.trim().length>0),
      conflicts: []
    };
    const dec = decideForRow(base, facts);
    rows.push({ ...base, ...dec });
  }
  return rows;
}

function deriveContradictions(facts, table){
  const list = [];
  const bpSys = facts?.vitals?.bpSystolic, bpDia = facts?.vitals?.bpDiastolic;
  const htN = (asNum(bpSys) && asNum(bpDia)) ? (bpSys >= 140 || bpDia >= 90) : false;

  const hasNS = table.some(r => /normal saline/i.test(r.name));
  if (hasNS && htN && facts?.flags?.dehydrationLikely !== true && facts?.flags?.hypotension !== true) {
    list.push("طلب محلول وريدي رغم ارتفاع الضغط وغياب دليل جفاف/هبوط.");
  }

  const igg = table.find(r => /dengue.*igg/i.test(r.name));
  if (igg) list.push("دِنغي IgG وحده لا يثبت عدوى حادة — يلزم IgM/NS1 مع سياق وبائي/أعراض.");

  return list;
}

// ===== 3) ChatGPT تحويل النتائج إلى JSON مُحسّن (تبريرات لغوية) =====
function auditSystemPrompt(){
  return `
أنت استشاري تدقيق طبي/تأميني. لديك حقائق مُستخرَجة (facts) + جدول أولي (table).
حرّر تبريرات مهنية موجزة ومحددة (References-aware) دون نسخ مصادر، وارجع JSON بنفس المخطط.

المعايير (WHO/CDC/NIH/NHS ودوائية FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed).
IMPORTANT clinical insurance rules:
- Dengue IgG فقط ⇒ "قابل للرفض" مع تبرير يذكر الحاجة لـ IgM أو NS1.
- Normal Saline I.V ⇒ مقبول فقط مع جفاف/هبوط ضغط موثق؛ وإلا قابل للرفض/المراجعة.
- Nebulizer ⇒ يتطلّب أعراض تنفسية موثقة.
أعد JSON فقط.`;
}

async function chatgptPolish(bundle){
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role:"system", content: auditSystemPrompt() },
        { role:"user",   content: JSON.stringify(bundle) }
      ],
      response_format: { type:"json_object" }
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error("OpenAI error: " + JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(txt); } catch { return bundle; }
}

// ===== HTML =====
function colorCell(p){
  if (p>=75) return 'style="background:#fee2e2;border:1px solid #fecaca"';
  if (p>=60) return 'style="background:#fff7ed;border:1px solid #ffedd5"';
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';
}

function toHtml(s){
  const rows = (s.table||[]).map(r=>`
<tr>
  <td>${r.name||"-"}</td>
  <td>${r.itemType||"-"}</td>
  <td>${r.doseRegimen||"-"}</td>
  <td>${r.intendedIndication||"-"}</td>
  <td>${r.isIndicationDocumented?"نعم":"لا"}</td>
  <td>${(r.conflicts||[]).join('<br>')||"-"}</td>
  <td ${colorCell(r.riskPercent||0)}><b>${Math.round(r.riskPercent||0)}%</b></td>
  <td>${r.insuranceDecision?.label||"-"}</td>
  <td>${r.insuranceDecision?.justification||"-"}</td>
</tr>`).join("");

  const contradictions = (s.contradictions||[]).map(c=>`<li>${c}</li>`).join("") || "<li>لا شيء بارز</li>";
  const mustDo = (s.missingActions||[]).map(c=>`<li>${c}</li>`).join("") || "<li>—</li>";
  const finance = (s.financialInsights||[]).map(c=>`<li>${c}</li>`).join("") || "<li>—</li>";

  return `
<div class="kvs" style="padding:8px 10px; background:#f8fbff; border:1px solid #e5e7eb; border-radius:10px">
  <h3>📋 ملخص الحالة</h3>
  <p>${(s.conclusion||"").replace(/\n/g,'<br>')}</p>
</div>

<h3>⚠️ التناقضات والأخطاء</h3>
<ul>${contradictions}</ul>

<h3>💊 جدول الأدوية والإجراءات</h3>
<table dir="rtl" style="width:100%;border-collapse:collapse">
  <thead>
    <tr>
      <th>الاسم</th><th>التصنيف</th><th>الجرعة</th><th>المؤشّر</th><th>موثّق؟</th><th>تعارضات</th><th>درجة الخطورة</th><th>قرار التأمين</th><th>التبرير</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<h3>🩺 ما كان يجب القيام به</h3>
<ul>${mustDo}</ul>

<h3>📈 فرص تحسين الدخل والخدمة</h3>
<ul>${finance}</ul>

<p style="margin-top:8px;color:#64748b">
  التحليل موجّه بإرشادات WHO/CDC/NIH/NHS ومرجعيات الدواء (FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed).
</p>`;
}

// ===== Handler =====
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return bad(res,405,"POST only");
    if(!OPENAI_API_KEY) return bad(res,500,"Missing OPENAI_API_KEY");
    if(!GEMINI_API_KEY) return bad(res,500,"Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body||{};

    // 1) OCR → facts
    const facts = await geminiExtract({ text, files });

    // دمج بعض معطيات الواجهة (إن وُجدت)
    if (patientInfo?.gender) facts.patient.gender = patientInfo.gender;
    if (typeof patientInfo?.ageYears === "number") facts.patient.ageYears = patientInfo.ageYears;

    // 2) جدول + تناقضات + توصيات
    const table = buildTable(facts);
    const contradictions = deriveContradictions(facts, table);

    const missing = [];
    if (table.some(r => /dengue.*igg/i.test(r.name))) missing.push("طلب IgM/NS1 لتأكيد عدوى الضنك الحادة.");
    if (table.some(r => /normal saline/i.test(r.name)) &&
        !(facts?.flags?.dehydrationLikely || facts?.flags?.hypotension))
      missing.push("توثيق دليل جفاف/هبوط ضغط إذا لزم السوائل الوريدية.");
    if (table.find(r => /nebulizer|inhaler/i.test(r.name)) && !facts?.flags?.respiratorySymptoms)
      missing.push("توثيق أعراض/علامات تنفسية قبل النيبولايزر.");

    const finance = [
      "تقليل الطلبات غير المبررة (مثل IgG وحده/سوائل بلا جفاف) لخفض الرفض التأميني.",
      "استخدام قوالب توثيق المؤشّر السريري (Indication) يرفع نسب الموافقة.",
    ];

    const bundle = {
      facts,
      table,
      contradictions,
      missingActions: missing,
      financialInsights: finance,
      conclusion:
        "تحليل آلي أولي مع إبراز التناقضات وقابلية الرفض. يُنصح باستكمال التوثيق وفق الإرشادات."
    };

    // 3) صياغة لغوية منظمة عبر GPT (نفس الـ schema)
    const polished = await chatgptPolish(bundle);

    // تأكيد الحقول لمنع أخطاء الواجهة
    polished.table = arr(polished.table);
    polished.contradictions = arr(polished.contradictions);
    polished.missingActions = arr(polished.missingActions);
    polished.financialInsights = arr(polished.financialInsights);

    const html = toHtml(polished);
    return ok(res, { html, structured: polished });
  }catch(err){
    console.error("/api/gpt error:", err);
    return bad(res,500, err?.message || String(err));
  }
}
