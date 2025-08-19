// /pages/api/gpt.js
// =========================================================
// Medical Insurance Audit API (Gemini JSON extraction + GPT-4o analysis)
// ENV required:
//   OPENAI_API_KEY = "sk-..."
//   GEMINI_API_KEY = "..."   (Google AI Studio / Gemini API)
// Optional ENV:
//   OPENAI_MODEL   = "gpt-4o"           (default below)
//   GEMINI_MODEL   = "gemini-1.5-pro"   (stable default)
//   REQUEST_TIMEOUT_MS = "180000"
//   MAX_FILES = "10"
//   MAX_INLINE_FILE_MB = "50"
// =========================================================

export const config = { api: { bodyParser: { sizeLimit: "100mb" } } };

// ---------- Constants ----------
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o"; // أعلى جودة
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL     = process.env.GEMINI_MODEL || "gemini-1.5-pro"; // مستقر
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m)=>`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 180000);
const MAX_FILES = Number(process.env.MAX_FILES || 10);
const MAX_INLINE_FILE_BYTES = Number(process.env.MAX_INLINE_FILE_MB ? process.env.MAX_INLINE_FILE_MB : 50) * 1024 * 1024;

// ---------- Small utils ----------
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const has = (pat, text)=> new RegExp(pat,'i').test(String(text||""));

const parseJsonSafe = async (r) => {
  const ct = (r.headers.get("content-type")||"").toLowerCase();
  try {
    if (ct.includes("application/json")) return await r.json();
    const raw = await r.text();
    return { raw };
  } catch {
    const raw = await r.text().catch(()=> "");
    return { raw };
  }
};

const tryParseObject = (s) => {
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const m = String(s).match(/\{[\s\S]*\}$/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
};

// Timeout wrapper for fetch
async function fetchWithTimeout(url, opts={}){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// Retry with exponential backoff + jitter
async function withRetry(fn, {tries=4, baseMs=600} = {}){
  let lastErr;
  for (let i=0; i<tries; i++){
    try { return await fn(); }
    catch (err){
      const msg = String(err?.message||err);
      const retryable = /(429|500|502|503|504|ECONNRESET|ETIMEDOUT|overloaded|internal)/i.test(msg);
      if (!retryable || i === tries-1) throw err;
      const sleep = baseMs * Math.pow(2, i) + Math.floor(Math.random()*250);
      await new Promise(r=>setTimeout(r, sleep));
      lastErr = err;
    }
  }
  throw lastErr;
}

// ---------- Gemini Files (resumable upload) ----------
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");

  if (bin.byteLength > MAX_INLINE_FILE_BYTES) {
    throw new Error(`File too large (${name}). Max ${Math.round(MAX_INLINE_FILE_BYTES/1024/1024)}MB`);
  }

  const run = async () => {
    const initRes = await fetchWithTimeout(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,{
      method:"POST",
      headers:{
        "X-Goog-Upload-Protocol":"resumable",
        "X-Goog-Upload-Command":"start",
        "X-Goog-Upload-Header-Content-Length":String(bin.byteLength),
        "X-Goog-Upload-Header-Content-Type":mimeType,
        "Content-Type":"application/json",
      },
      body: JSON.stringify({ file:{ display_name:name, mime_type:mimeType } })
    });
    if(!initRes.ok) throw new Error("Gemini init failed: "+JSON.stringify(await parseJsonSafe(initRes)));
    const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
    if(!sessionUrl) throw new Error("Gemini upload URL missing");
    const upRes = await fetchWithTimeout(sessionUrl,{
      method:"PUT",
      headers:{
        "Content-Type":mimeType,
        "X-Goog-Upload-Command":"upload, finalize",
        "X-Goog-Upload-Offset":"0",
        "Content-Length":String(bin.byteLength),
      },
      body: bin
    });
    const meta = await parseJsonSafe(upRes);
    if(!upRes.ok) throw new Error("Gemini finalize failed: "+JSON.stringify(meta));
    return { uri: meta?.file?.uri, mime: meta?.file?.mime_type || mimeType };
  };

  return withRetry(run, { tries: 3, baseMs: 700 });
}

// ---------- GEMINI: Structured JSON extraction ----------
async function geminiSummarize({ text, files }) {
  // Upload files then pass as file_data parts
  const fileParts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    the:
    const b64  = (f?.data||"").includes("base64,") ? f.data.split("base64,").pop() : f?.data;
    if (!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({ name: f?.name || "file", mimeType: mime, base64: b64 });
    fileParts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt = `
أنت خبير في تحليل التقارير الطبية. استخرج معلومات سريرية دقيقة ومنظّمة من النص والملفات.
أعد الناتج بصيغة JSON حصراً وفق المخطط التالي:
{
  "chiefComplaint": string[],                       // الشكوى الرئيسية والأعراض المختصرة
  "history": { "chronic": string[], "allergies": string[] },
  "labs": [{ "name": string, "value": string, "ref": string|null }],
  "imaging": [{ "modality": string, "finding": string }],
  "medications": [{ "name": string, "dose": string|null, "freq": string|null, "route": string|null }],
  "diagnoses": string[],
  "orders": [{ "name": string, "category":"lab"|"imaging"|"procedure"|"device"|"medication" }]
}
لا تستنتج علاجات جديدة. إذا تعذّر الاستخلاص فارجع حقولاً فارغة.
`.trim();

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    generation_config: {
      response_mime_type: "application/json",
      response_schema: {
        type: "object",
        properties: {
          chiefComplaint: { type: "array", items: { type: "string" } },
          history: {
            type: "object",
            properties: {
              chronic:   { type: "array", items: { type: "string" } },
              allergies: { type: "array", items: { type: "string" } }
            }
          },
          labs: {
            type: "array",
            items: {
              type: "object",
              properties: { name:{type:"string"}, value:{type:"string"}, ref:{type:"string", "nullable":true} }
            }
          },
          imaging: {
            type: "array",
            items: { type: "object", properties: { modality:{type:"string"}, finding:{type:"string"} } }
          },
          medications: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name:{type:"string"}, dose:{type:"string","nullable":true},
                freq:{type:"string","nullable":true}, route:{type:"string","nullable":true}
              }
            }
          },
          diagnoses: { type: "array", items: { type: "string" } },
          orders: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                // ✅ استخدم category مع enum (enum يُسمح به فقط مع STRING)
                category: { type: "string", enum: ["lab","imaging","procedure","device","medication"] }
              }
            }
          }
        }
      }
    },
    contents: [{
      role:"user",
      parts: [
        { text: text && String(text).trim() ? String(text).trim() : "لا يوجد نص حر." },
        ...fileParts
      ]
    }]
  };

  const call = async () => {
    const resp = await fetchWithTimeout(GEMINI_GEN_URL(GEMINI_MODEL),{
      method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
    });
    const data = await parseJsonSafe(resp);
    if(!resp.ok) throw new Error("Gemini generateContent error: " + JSON.stringify(data));
    const txt = data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("") || "{}";
    const obj = tryParseObject(txt) || {};
    return obj;
  };

  return withRetry(call, { tries: 4, baseMs: 800 });
}

// ---------- Seed rows from Gemini extraction ----------
function seedTableFromExtraction(extracted){
  const rows = [];
  for (const m of (extracted?.medications||[])) {
    rows.push({
      name: m.name, itemType: "medication",
      doseRegimen: [m.dose, m.freq, m.route].filter(Boolean).join(" ").trim() || null,
      intendedIndication: null, isIndicationDocumented: false,
      conflicts: [], riskPercent: 55,
      insuranceDecision: { label: "قابل للمراجعة", justification: "" }
    });
  }
  for (const o of (extracted?.orders||[])) {
    const cat = o.category || o.type || "procedure"; // ← دعم ردود قديمة فيها "type"
    rows.push({
      name: o.name, itemType: cat, doseRegimen: null,
      intendedIndication: null, isIndicationDocumented: false,
      conflicts: [], riskPercent: 55,
      insuranceDecision: { label: "قابل للمراجعة", justification: "" }
    });
  }
  return rows;
}

// ---------- OpenAI JSON analysis ----------
function auditInstructions(){ return `
أنت استشاري تدقيق طبي وتأميني. اعتمد WHO/CDC/NIH/NHS & (FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed).
أخرج JSON فقط بالمخطط:
{
  "patientSummary":{"ageYears":number|null,"gender":"ذكر"|"أنثى"|null,"chronicConditions":string[]},
  "diagnosis":string[], "symptoms":string[], "contradictions":string[],
  "table":[
    {"name":string,"itemType":"lab"|"medication"|"procedure"|"device"|"imaging",
     "doseRegimen":string|null,"intendedIndication":string|null,"isIndicationDocumented":boolean,
     "conflicts":string[],"riskPercent":number,
     "insuranceDecision":{"label":"مقبول"|"قابل للمراجعة"|"قابل للرفض","justification":string}}
  ],
  "missingActions":string[], "referrals":[{"specialty":string,"whatToDo":string[]}],
  "financialInsights":string[], "conclusion":string
}
ONLY JSON.
`}

async function chatgptJSON(bundle, extra=[]){
  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role:"system", content: auditInstructions() },
      { role:"user", content: "المعطيات:\n"+JSON.stringify(bundle,null,2) },
      ...extra
    ],
    response_format:{ type:"json_object" }
  };

  const resp = await fetchWithTimeout(OPENAI_API_URL,{
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body)
  });
  const data = await parseJsonSafe(resp);
  if(!resp.ok) throw new Error("OpenAI error: "+JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  return tryParseObject(txt) || {};
}

// ---------- Local guardrails ----------
function applyGuardrails(structured, ctx){
  const s = structured || {};
  const ctxText = [ctx?.userText, JSON.stringify(ctx?.extracted||{}), ctx?.extractedSummary].filter(Boolean).join(" ");

  s.table = Array.isArray(s.table)? s.table : [];
  s.contradictions = Array.isArray(s.contradictions)? s.contradictions : [];
  s.missingActions = Array.isArray(s.missingActions)? s.missingActions : [];
  s.financialInsights = Array.isArray(s.financialInsights)? s.financialInsights : [];

  const pushContra=(m)=>{ if(m && !s.contradictions.includes(m)) s.contradictions.push(m); };

  s.table = s.table.map((r)=>{
    const name=String(r?.name||"").trim();
    const lower=name.toLowerCase();
    let risk = Number.isFinite(r?.riskPercent)? Number(r.riskPercent):55;
    let label = r?.insuranceDecision?.label || "قابل للمراجعة";
    let just  = String(r?.insuranceDecision?.justification||"").trim();

    if(!r?.isIndicationDocumented){
      risk = Math.max(risk,60);
      if(label==="مقبول") label="قابل للمراجعة";
      if(!just) just="غياب توثيق المؤشّر السريري؛ يلزم توثيق واضح للقبول التأميني.";
    }

    if (/dengue/i.test(lower) && /igg/i.test(lower) && !has("\\b(igm|ns\\s*-?1)\\b", ctxText)){
      risk=Math.max(risk,80); label="قابل للرفض";
      if(!just) just="Dengue IgG منفرد لا يثبت عدوى حادة؛ المطلوب IgM/NS1 مع سياق سريري/وبائي.";
      pushContra("طلب Dengue IgG منفردًا دون IgM/NS1.");
      if(!s.missingActions.includes("طلب IgM/NS1 لتأكيد حمى الضنك عند الاشتباه.")) s.missingActions.push("طلب IgM/NS1 لتأكيد حمى الضنك عند الاشتباه.");
    }

    const isIVFluid = /\b(normal\s*saline|\bi\.?v\.?\s*infusion\b)/i.test(lower);
    const hasDehydration = has("جفاف|dehydrat", ctxText);
    const hasHypotension = has("هبوط\\s*ضغط|hypotens", ctxText);
    if (isIVFluid && !(hasDehydration||hasHypotension)){
      risk=Math.max(risk,80); label="قابل للرفض";
      if(!just) just="استخدام محلول وريدي بلا دلائل جفاف/هبوط ضغط — خاصة مع HTN/DM/CKD.";
      pushContra("وصف محلول وريدي دون دليل على الجفاف/هبوط ضغط.");
    }

    const isAntiemetic = /\b(metoclopramide|primperan|ondansetron|domperidone|prochlorperazine|granisetron)\b/i.test(lower);
    const hasNauseaVom = has("قي[ءئ]|تقي[ؤء]|غثيان|nausea|vomit|emesis", ctxText);
    if (isAntiemetic && !hasNauseaVom){
      risk=Math.max(risk,75); label="قابل للرفض";
      if(!just) just="مضاد قيء بلا توثيق عرض قيء/غثيان لا يُبرّر تأمينيًا.";
      pushContra("مضاد قيء دون توثيق قيء/غثيان.");
      if(!s.missingActions.includes("توثيق قيء/غثيان (الشدة/التواتر) لتبرير مضاد القيء.")) s.missingActions.push("توثيق قيء/غثيان (الشدة/التواتر) لتبرير مضاد القيء.");
    }

    if (/nebulizer|inhal/i.test(lower) && !has("ضيق\\s*نفس|أزيز|wheez|o2|sat", ctxText)){
      risk=Math.max(risk,65); if(label==="مقبول") label="قابل للمراجعة";
      if(!just) just="يتطلب توثيق أعراض تنفسية (ضيق نفس/أزيز/تشبع O₂) لتبرير الإجراء.";
    }

    if (risk>=75) label="قابل للرفض"; else if (risk>=60 && label==="مقبول") label="قابل للمراجعة";
    return {...r, riskPercent:Math.round(risk), insuranceDecision:{label, justification:just}, conflicts:Array.isArray(r?.conflicts)? r.conflicts:[]};
  });

  if (s.financialInsights.length===0){
    s.financialInsights.push(
      "تقليل الطلبات غير المبررة (IgG منفرد / سوائل بلا دليل) لخفض الرفض التأميني.",
      "توحيد قوالب توثيق المؤشّر السريري يرفع نسب الموافقة ويزيد إيراد العيادة."
    );
  }

  return s;
}

// ---------- HTML builder (frontend uses this HTML string) ----------
function badge(p){ if(p>=75) return 'badge badge-bad'; if(p>=60) return 'badge badge-warn'; return 'badge badge-ok'; }
function toHtml(s){
  const rows = (s.table||[]).map(r=>`
    <tr>
      <td>${r.name||"-"}</td>
      <td>${r.itemType||"-"}</td>
      <td>${r.doseRegimen||"-"}</td>
      <td>${r.intendedIndication||"-"}</td>
      <td>${r.isIndicationDocumented?"نعم":"لا"}</td>
      <td>${(r.conflicts||[]).join('<br>')||"-"}</td>
      <td><span class="${badge(r.riskPercent||0)}"><b>${Math.round(r.riskPercent||0)}%</b></span></td>
      <td>${r.insuranceDecision?.label||"-"}</td>
      <td>${r.insuranceDecision?.justification||"-"}</td>
    </tr>
  `).join("");

  const contra = (s.contradictions||[]).map(x=>`<li>• ${x}</li>`).join("") || "<li>لا شيء بارز</li>";
  const missing = (s.missingActions||[]).map(x=>`<li>• ${x}</li>`).join("") || "<li>—</li>";
  const fin = (s.financialInsights||[]).map(x=>`<li>• ${x}</li>`).join("") || "<li>—</li>";

  return `
  <h2>📋 ملخص الحالة</h2>
  <div class="kvs"><p>${(s.conclusion||"لا توجد معلومات كافية لتقديم تقييم دقيق أو توصيات علاجية.").replace(/\n/g,'<br>')}</p></div>

  <h2>⚠️ التناقضات والأخطاء</h2>
  <ul>${contra}</ul>

  <h2>💊 جدول الأدوية والإجراءات</h2>
  <table class="table" dir="rtl">
    <thead><tr>
      <th>الاسم</th><th>التصنيف</th><th>الجرعة</th><th>المؤشّر</th>
      <th>موثّق؟</th><th>تعارضات</th><th>درجة الخطورة</th><th>قرار التأمين</th><th>التبرير</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>🩺 ما كان يجب القيام به</h2>
  <ul>${missing}</ul>

  <h2>📈 فرص تحسين الدخل والخدمة</h2>
  <ul>${fin}</ul>
  `;
}

// ---------- API Handler ----------
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return bad(res,405,"POST only");
    if(!OPENAI_API_KEY) return bad(res,500,"Missing OPENAI_API_KEY");
    if(!GEMINI_API_KEY)  return bad(res,500,"Missing GEMINI_API_KEY");

    const { text="", files=[], patientInfo=null } = req.body||{};

    // Basic sanitation
    if (!Array.isArray(files)) return bad(res,400,"Invalid files payload");
    if (files.length > MAX_FILES) return bad(res,400,`Too many files (max ${MAX_FILES}).`);
    for (const f of files){
      if (!f?.name || !f?.data) continue;
      if ((f.data||"").length > MAX_INLINE_FILE_BYTES*1.37) {
        return bad(res,400,`File too large: ${f.name}`);
      }
    }

    // 1) Gemini structured extraction
    const extractedObj = await geminiSummarize({ text, files });

    // 2) Seed table
    const seed = seedTableFromExtraction(extractedObj);

    // 3) Compose bundle
    const bundle = { patientInfo, extracted: extractedObj, userText: text, seedTable: seed };

    // 4) Main analysis
    let structured = await chatgptJSON(bundle);

    // 5) Guardrails
    structured = applyGuardrails(structured, { userText:text, extracted:extractedObj });

    // 6) Refinement if weak
    const weak = !Array.isArray(structured?.table) || structured.table.length===0 ||
                 structured.table.filter(r=>Number(r?.riskPercent||0)===0).length/Math.max(structured.table.length||1,1) > 0.4;

    if (weak){
      const refined = await chatgptJSON(bundle, [
        { role:"user", content:"أعد التدقيق مع ملء النِّسَب والتبريرات لكل صف، وركّز على التناقضات وطلبات غير مبررة (IgG منفرد / سوائل بلا دليل / مضاد قيء بلا قيء / Nebulizer بلا أعراض)." }
      ]);
      structured = applyGuardrails(refined, { userText:text, extracted:extractedObj });
    }

    const html = toHtml(structured);
    return ok(res,{ html, structured, extracted: extractedObj });
  }catch(err){
    console.error("/api/gpt error:", err);
    const msg = String(err?.message||err).slice(0, 1200);
    return bad(res,500, msg);
  }
}
