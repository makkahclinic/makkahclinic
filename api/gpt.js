// /pages/api/gpt.js
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

// ===== Keys & Models =====
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
// استخدم موديل مستقر كافتراضي
const GEMINI_MODEL     = process.env.GEMINI_MODEL || "gemini-1.5-pro";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m)=>`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// ===== Helpers =====
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const has = (pat, text)=> new RegExp(pat,'i').test(String(text||""));
const parseJsonSafe = async (r) => (r.headers.get("content-type")||"").includes("application/json") ? r.json() : { raw: await r.text() };

// Retry with exponential backoff + jitter
async function withRetry(fn, {tries=4, baseMs=600} = {}){
  let lastErr;
  for (let i=0; i<tries; i++){
    try { return await fn(); }
    catch (err){
      const msg = String(err?.message||err);
      const retryable = /(?:429|503|500|ECONNRESET|ETIMEDOUT|overload|internal)/i.test(msg);
      if (!retryable || i === tries-1) throw err;
      const sleep = baseMs * Math.pow(2, i) + Math.floor(Math.random()*250);
      await new Promise(r=>setTimeout(r, sleep));
      lastErr = err;
    }
  }
  throw lastErr;
}

// ===== Gemini Files: resumable upload =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");
  // sanity: 50MB سقف منطقي لتقليل 500
  if (bin.byteLength > 50 * 1024 * 1024) {
    throw new Error(`File too large for inline analysis (${name}); please upload < 50MB`);
  }

  const init = async () => {
    const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,{
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
    const upRes = await fetch(sessionUrl,{
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

  return withRetry(init, {tries: 3, baseMs: 700});
}

// ===== Gemini: extract/normalize text from user text + files =====
async function geminiSummarize({ text, files }) {
  const fileParts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data||"").includes("base64,") ? f.data.split("base64,").pop() : f?.data;
    if (!b64) continue;
    // رفع الملف مع إعادة المحاولة
    const { uri, mime: mm } = await geminiUploadBase64({ name: f?.name || "file", mimeType: mime, base64: b64 });
    fileParts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt =
    "أنت مساعد استخلاص سريري: استخرج من الملفات النصوص الطبية، التشخيصات، الطلبات، النتائج والأدوية باختصار دقيق دون إنشاء علاجات جديدة.";

  // --- أهم تعديل: ندمج النص والملفات في رسالة واحدة parts[] ---
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role:"user",
        parts: [
          { text: text && text.trim() ? text.trim() : "لا يوجد نص حر." },
          ...fileParts
        ]
      }
    ]
  };

  const call = async () => {
    const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL),{
      method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
    });
    const data = await parseJsonSafe(resp);
    if(!resp.ok){
      // أعطِ رسالة واضحة للمستخدم بدل 500 عام
      throw new Error("Gemini generateContent error: " + JSON.stringify(data));
    }
    return data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("\n") || "";
  };

  return withRetry(call, {tries: 4, baseMs: 800});
}

// ===== OpenAI JSON instructions =====
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
ONLY JSON.`}

async function chatgptJSON(bundle, extra=[]){
  const resp = await fetch(OPENAI_API_URL,{
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role:"system", content:auditInstructions() },
        { role:"user", content: "المعطيات:\n"+JSON.stringify(bundle,null,2) },
        ...extra
      ],
      response_format:{ type:"json_object" }
    })
  });
  const data = await resp.json();
  if(!resp.ok) throw new Error("OpenAI error: "+JSON.stringify(data));
  return JSON.parse(data?.choices?.[0]?.message?.content||"{}");
}

// ===== Guardrails (كما هي مع تحسينات طفيفة) =====
function applyGuardrails(structured, ctx){
  const s = structured || {};
  const ctxText = [ctx?.userText, ctx?.extractedSummary].filter(Boolean).join(" ");
  s.table = Array.isArray(s.table)? s.table : [];
  s.contradictions = Array.isArray(s.contradictions)? s.contradictions : [];
  s.missingActions = Array.isArray(s.missingActions)? s.missingActions : [];
  s.financialInsights = Array.isArray(s.financialInsights)? s.financialInsights : [];

  const pushContra=(m)=>{ if(!s.contradictions.includes(m)) s.contradictions.push(m); };

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
      if(!just) just="تحليل Dengue IgG لوحده لا يثبت عدوى حادة؛ التشخيص الحاد يحتاج IgM أو NS1 مع سياق سريري/وبائي.";
      pushContra("طلب Dengue IgG منفردًا دون IgM/NS1.");
      if(!s.missingActions.includes("طلب IgM/NS1 لتأكيد حمى الضنك عند الاشتباه.")) s.missingActions.push("طلب IgM/NS1 لتأكيد حمى الضنك عند الاشتباه.");
    }

    const isIVFluid = /\b(normal\s*saline|\bi\.?v\.?\s*infusion\b)/i.test(lower);
    const hasDehydration = has("جفاف|dehydrat", ctxText);
    const hasHypotension = has("هبوط\\s*ضغط|hypotens", ctxText);
    if (isIVFluid && !(hasDehydration||hasHypotension)){
      risk=Math.max(risk,80); label="قابل للرفض";
      if(!just) just="استخدام محلول وريدي غير مبرر بدون علامات جفاف/هبوط ضغط — خصوصًا مع HTN/DM/اعتلال كلوي.";
      pushContra("وصف محلول وريدي دون دليل على الجفاف/هبوط ضغط.");
    }

    const isAntiemetic = /\b(metoclopramide|primperan|ondansetron|domperidone|prochlorperazine|granisetron)\b/i.test(lower);
    const hasNauseaVom = has("قي[ءئ]|تقي[ؤء]|غثيان|nausea|vomit|emesis", ctxText);
    if (isAntiemetic && !hasNauseaVom){
      risk=Math.max(risk,75); label="قابل للرفض";
      if(!just) just="مضاد قيء بلا توثيق لعرض قيء/غثيان لا يُبرّر تأمينيًا. وثّق العرض ومدته/شِدته.";
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

// ===== HTML builder =====
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

// ===== API Handler =====
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return bad(res,405,"POST only");
    if(!OPENAI_API_KEY) return bad(res,500,"Missing OPENAI_API_KEY");
    if(!GEMINI_API_KEY)  return bad(res,500,"Missing GEMINI_API_KEY");

    const { text="", files=[], patientInfo=null } = req.body||{};

    // حدود وقائية على عدد/حجم الملفات
    if (files.length > 10) return bad(res,400,"Too many files (max 10).");
    for (const f of files){
      if ((f?.data||"").length > 80 * 1024 * 1024) return bad(res,400,`File too large: ${f?.name||""}`);
    }

    const extracted = await geminiSummarize({ text, files });
    const bundle = { patientInfo, extractedSummary: extracted, userText: text };

    let structured = await chatgptJSON(bundle);

    // Guardrails
    structured = applyGuardrails(structured, { userText:text, extractedSummary:extracted });

    // إعادة تحسين إن كان الجدول ضعيفًا
    const weak = !Array.isArray(structured?.table) || structured.table.length===0 ||
                 structured.table.filter(r=>Number(r?.riskPercent||0)===0).length/Math.max(structured.table.length||1,1) > 0.4;

    if (weak){
      const refined = await chatgptJSON(bundle, [
        { role:"user", content:"أعد التدقيق مع ملء النِّسَب والتبريرات لكل صف، وركّز على التناقضات وطلبات غير مبررة (IgG منفرد / سوائل بلا دليل / مضاد قيء بلا قيء / Nebulizer بلا أعراض)." }
      ]);
      structured = applyGuardrails(refined, { userText:text, extractedSummary:extracted });
    }

    const html = toHtml(structured);
    return ok(res,{ html, structured });
  }catch(err){
    console.error("/api/gpt error:", err);
    // أعطِ تفاصيل أكثر في الرد (لكن بدون تسريب مفاتيح)
    const msg = String(err?.message||err).slice(0, 600);
    return bad(res,500, msg.includes("Gemini generateContent error") ? msg : `Internal error: ${msg}`);
  }
}
