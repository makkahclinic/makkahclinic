// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

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

// ===== Gemini summarize OCR/files =====
async function geminiSummarize({ text, files }) {
  const fileParts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const base64 = (f?.data || "").split("base64,").pop();
    if (!base64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: mime,
      base64,
    });
    fileParts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt =
    "أنت مساعد استخراج طبي. لخّص العناصر المذكورة فعلاً في المستندات (تشخيصات/تحاليل/أدوية/إجراءات/تكرارات)، دون إضافة عناصر من عندك. لا توصيات علاجية.";
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
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
}

// ===== Prompt: evidence-driven with few-shot style =====
function fewShotRow() {
  return `
مثال صف (أسلوب الكتابة فقط، لا تُنشئ هذا إن لم يكن مذكوراً):
{"name":"Dengue Ab IgG","itemType":"lab","doseRegimen":null,"intendedIndication":"التحرّي عن تعرض سابق أو عدوى باردة","isIndicationDocumented":false,"conflicts":[],"riskPercent":15,"insuranceDecision":{"label":"قابل للرفض","justification":"IgG وحده لا يؤكّد عدوى حادة؛ التشخيص الحاد يحتاج IgM أو NS1 وفق WHO/CDC."}}
`;
}

function auditInstructions() {
  return `
أنت استشاري تدقيق طبي وتأميني. حوّل المدخلات إلى تقييم سريري تأميني دقيق يعتمد على الأدلة الحديثة من:
WHO, CDC, ECDC, NIH, NHS, UpToDate, Cochrane, NEJM, Lancet, JAMA, BMJ, Nature/Science,
والمراجع الدوائية: FDA, EMA, SFDA, BNF, Micromedex, Lexicomp, DailyMed, USP, Mayo Clinic.

المبادئ:
- اعمل حصراً على العناصر المذكورة فعلاً في مدخلات المستخدم (النص/الملفات). لا تضف عناصر غير موجودة.
- لكل عنصر: "name","itemType"(lab|medication|procedure|device|imaging),"doseRegimen","intendedIndication",
  "isIndicationDocumented"(true/false),"conflicts" (تكرارات/تعارضات محددة)،
  "riskPercent"(0-100)، "insuranceDecision" = {"label":"مقبول"|"قابل للرفض"|"مرفوض","justification": سبب سريري مختصر دقيق مع إحالة عامة للمصدر مثل WHO/CDC/BNF… بدون روابط}.
- التبريرات يجب أن تكون مُحدَّدة (≥ 40 حرفاً) وتتجنب العبارات العامة مثل "مفيد/شائع" بلا سبب سريري.
- لا توصيات علاجية مفصّلة؛ فقط قرارات تأمينية وتأصيل سريري موجز.
- أخرج JSON فقط بالمخطط التالي دون أي نص آخر:

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

${fewShotRow()}
ONLY JSON.`;
}

// ===== Refine rubric (تحسين الجودة) =====
function refineRubric(bundle) {
  return `
أنت مُحكِّم جودة. لديك "مسودة" JSON من نموذج آخر. حسّنها وفقاً للمعايير:
- لا تبريرات عامة؛ يجب ذكر سبب سريري محدّد أو شرط إرشادي (مثال: اشتراط IgM/NS1 للعدوى الحادة للضنك).
- عبّر عن التوثيق: إذا لم يوجد سياق/أعراض/مستند يؤيّد المؤشّر اكتب isIndicationDocumented=false وفسّر.
- riskPercent يجب أن يكون معبّراً (لا تضع 0% للجميع) وبسُلَّم واقعي (مثلاً 5/10/25/50/75/90).
- املأ missingActions بما ينقص فعلاً في الحالة (مثل طلب IgM/NS1، سكر تراكمي، وظائف كلوية… حسب المدخلات).
- لا تُنشئ عناصر غير مذكورة في المدخلات.
أعد JSON النهائي فقط. هذه هي المدخلات المرجعية:
- userText + OCR: ${JSON.stringify({ text: bundle.userText, extractedSummary: bundle.extractedSummary }).slice(0, 2000)}
`;
}

// ===== Deterministic ChatGPT =====
async function chatgptJSON(bundle, extra = []) {
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      top_p: 0,
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
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

// ===== Light fuzzy restriction to mentioned items =====
function tokenize(s){ return (s||"").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").split(/\s+/).filter(Boolean); }
function scoreLike(a,b){ const A=new Set(tokenize(a)),B=new Set(tokenize(b)); if(!A.size||!B.size) return 0; let inter=0; A.forEach(w=>{ if(B.has(w)) inter++; }); return inter/Math.min(A.size,B.size); }

function harvestMentionedItems({ userText, extractedSummary }) {
  const text = [userText||"", extractedSummary||""].join("\n").toLowerCase();
  const out = new Set();
  text.split(/\n+/).forEach(ln=>{
    const s = ln.trim(); if(!s) return;
    const m = s.match(/([a-z0-9\.\-\+\s\/\(\)]{3,40})/gi) || [];
    m.forEach(f => { const k = f.trim(); if(k.length>=3 && k.split(" ").length<=8) out.add(k); });
  });
  return Array.from(out);
}
function restrictToMentioned(aiTable, mentioned) {
  if (!Array.isArray(aiTable)) return [];
  if (!mentioned.length) return aiTable;
  return aiTable.filter(row => {
    const nm = row?.name || "";
    const sim = Math.max(0, ...mentioned.map(raw => scoreLike(nm, raw)));
    return sim >= 0.30; // تخفيف القيود قليلاً
  });
}

// ===== HTML rendering =====
function colorCellStyle(p){ if(p>=75) return 'style="background:#fee2e2;border:1px solid #fecaca"'; if(p>=60) return 'style="background:#fff7ed;border:1px solid #ffedd5"'; return 'style="background:#ecfdf5;border:1px solid #d1fae5"'; }

function toHtml(s){
  const rows = (Array.isArray(s.table)?s.table:[]).map(r=>{
    const risk = Math.round(r?.riskPercent||0);
    return `<tr>
<td>${r?.name||"-"}</td>
<td>${r?.itemType||"-"}</td>
<td>${r?.doseRegimen||"-"}</td>
<td>${r?.intendedIndication||"-"}</td>
<td>${r?.isIndicationDocumented?"نعم":"لا"}</td>
<td>${(r?.conflicts||[]).join("<br>")||"-"}</td>
<td ${colorCellStyle(risk)}><b>${risk}%</b></td>
<td>${r?.insuranceDecision?.label||"-"}</td>
<td>${r?.insuranceDecision?.justification||"-"}</td>
</tr>`;
  }).join("");

  const contradictions = (Array.isArray(s.contradictions)?s.contradictions:[]).length
    ? s.contradictions.map(c=>`<li>${c}</li>`).join("")
    : "<li>لا يوجد تناقضات واضحة</li>";

  const missing = (Array.isArray(s.missingActions)?s.missingActions:[]).length
    ? s.missingActions.map(c=>`<li>${c}</li>`).join("")
    : "<li>—</li>";

  const fin = (Array.isArray(s.financialInsights)?s.financialInsights:[]).length
    ? s.financialInsights.map(c=>`<li>${c}</li>`).join("")
    : "<li>—</li>";

  return `
<h2>📋 ملخص الحالة</h2>
<div class="kvs"><p>${(s.conclusion||"—").replace(/\n/g,"<br>")}</p></div>

<h2>⚠️ التناقضات والأخطاء</h2>
<ul>${contradictions}</ul>

<h2>💊 جدول الأدوية والإجراءات</h2>
<table dir="rtl" style="width:100%;border-collapse:collapse">
<thead><tr>
<th>الاسم</th><th>التصنيف</th><th>الجرعة</th><th>المؤشّر</th>
<th>موثّق؟</th><th>تعارضات</th><th>درجة الخطورة</th><th>قرار التأمين</th><th>التبرير</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>

<h2>🩺 ما كان يجب القيام به</h2>
<ul>${missing}</ul>

<h2>📈 فرص تحسين الدخل والخدمة</h2>
<ul>${fin}</ul>`;
}

// ===== API handler =====
export default async function handler(req, res){
  try{
    if(req.method!=="POST") return bad(res,405,"POST only");
    if(!OPENAI_API_KEY) return bad(res,500,"Missing OPENAI_API_KEY");
    if(!GEMINI_API_KEY) return bad(res,500,"Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body||{};

    // (1) OCR/vision summary
    const extracted = await geminiSummarize({ text, files });

    // (2) Draft
    const bundle = { patientInfo, userText: text, extractedSummary: extracted };
    const draft = await chatgptJSON(bundle);

    // (3) Refine / improve quality
    const refined = await chatgptJSON(bundle, [
      { role: "system", content: refineRubric(bundle) },
      { role: "user", content: "المسودة:\n" + JSON.stringify(draft, null, 2) }
    ]);

    // (4) Keep only mentioned items (no hallucinations)
    const mentioned = harvestMentionedItems({ userText: text, extractedSummary: extracted });
    refined.table = restrictToMentioned(refined.table, mentioned);

    // (5) HTML
    const html = toHtml(refined);
    return ok(res, { html, structured: refined });
  }catch(err){
    console.error("/api/gpt error:", err);
    return bad(res,500, err?.message || String(err));
  }
}
