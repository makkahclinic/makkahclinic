// api/gpt.js — Vercel Serverless Function (CommonJS, Node 18+)
// === v4.2.0 ===

const API_VERSION = 'v4.2.0';

// ---------- infra ----------
function setCORS(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization'); }
async function readBody(req){ const bufs=[]; for await (const c of req) bufs.push(c); const raw=Buffer.concat(bufs).toString('utf8'); let obj={}; try{ obj=JSON.parse(raw||'{}'); }catch{} return { raw, obj }; }
function asWebRequest(req, bodyString){ const proto=req.headers['x-forwarded-proto']||'https'; const host=req.headers['x-forwarded-host']||req.headers.host||'localhost'; const url=`${proto}://${host}${req.url}`; const headers=new Headers(); for(const [k,v] of Object.entries(req.headers)){ if(Array.isArray(v)) headers.set(k, v.join(', ')); else if(typeof v==='string') headers.set(k, v);} return new Request(url,{method:req.method, headers, body:bodyString}); }
function mimeFromName(name, fallback='image/png'){ const n=(name||'').toLowerCase(); if(n.endsWith('.jpg')||n.endsWith('.jpeg'))return 'image/jpeg'; if(n.endsWith('.png'))return 'image/png'; if(n.endsWith('.webp'))return 'image/webp'; if(n.endsWith('.heic'))return 'image/heic'; if(n.endsWith('.heif'))return 'image/heif'; if(n.endsWith('.tif')||n.endsWith('.tiff'))return 'image/tiff'; return fallback; }

// ---------- reference banks ----------
const BANKS = {
  ent: [
    {title:'NICE NG84 — Sore throat (acute): antimicrobial prescribing', org:'NICE', link:'https://www.nice.org.uk/guidance/ng84'},
    {title:'NICE CKS — Sore throat (acute): diagnosis & management (FeverPAIN/Centor)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/sore-throat-acute/'},
    {title:'CDC — Clinical guidance: Group A streptococcal pharyngitis', org:'CDC', link:'https://www.cdc.gov/group-a-strep/hcp/clinical-guidance/strep-throat.html'},
    {title:'IDSA — Clinical Practice Guideline for Group A Streptococcal Pharyngitis (2012 update)', org:'IDSA', link:'https://www.idsociety.org/practice-guideline/streptococcal-pharyngitis/'},
    {title:'ICD‑10‑CM — J03.90 Acute tonsillitis, unspecified', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/J00-J99/J00-J06/J03-/J03.90'},
    {title:'ICD‑10‑CM — J02.9 Acute pharyngitis, unspecified', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/J00-J99/J00-J06/J02-/J02.9'}
  ],
  msk: [
    {title:'NICE CKS — Carpal tunnel syndrome (assessment / when to arrange NCS)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/carpal-tunnel-syndrome/diagnosis/assessment/'},
    {title:'NICE CKS — Tennis elbow (diagnosis & management)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/tennis-elbow/'},
    {title:'ICD‑10‑CM — S50.1 Contusion of forearm (non‑billable, injury code)', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/S00-T88/S50-S59/S50-/S50.1'},
    {title:'ICD‑10‑CM — M77.12 Lateral epicondylitis, left elbow', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/M00-M99/M70-M79/M77-/M77.12'},
    {title:'ICD‑10‑CM — G56.02 Carpal tunnel syndrome, left upper limb', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/G00-G99/G50-G59/G56-/G56.02'},
    {title:'BC Guidelines — ESR/CRP Testing (When to order)', org:'Government of British Columbia', link:'https://www2.gov.bc.ca/gov/content/health/practitioner-professional-resources/bc-guidelines/esr'}
  ],
  general: [
    {title:'CDC — Clinical Considerations for Group A Strep', org:'CDC', link:'https://www.cdc.gov/group-a-strep/hcp/clinical-guidance/index.html'}
  ]
};
function toRefBankText(arr){ return arr.map(r=>`- ${r.title} — ${r.link}`).join('\n'); }

// ---------- JSON schema ----------
const REPORT_SCHEMA = {
  type:"object",
  properties:{
    patient_summary:{type:"string"},
    key_findings:{type:"array",items:{type:"string"}},
    differential_diagnoses:{type:"array",items:{type:"object",properties:{dx:{type:"string"},why:{type:"string"}},required:["dx","why"]}},
    severity_red_flags:{type:"array",items:{type:"string"}},
    procedural_issues:{type:"array",items:{type:"object",properties:{issue:{type:"string"},impact:{type:"string"},evidence:{type:"string"}},required:["issue"]}},
    missed_opportunities:{type:"array",items:{type:"object",properties:{what:{type:"string"},why_it_matters:{type:"string"}},required:["what"]}},
    revenue_quality_opportunities:{type:"array",items:{type:"object",properties:{opportunity:{type:"string"},category:{type:"string",enum:["documentation","diagnostics","procedure","follow-up"]},rationale:{type:"string"},risk_note:{type:"string"}},required:["opportunity","category"]}},
    suggested_next_steps:{type:"array",items:{type:"object",properties:{action:{type:"string"},justification:{type:"string"}},required:["action"]}},
    patient_safety_note:{type:"string"},
    references:{type:"array",items:{type:"object",properties:{title:{type:"string"},org:{type:"string"},link:{type:"string"}},required:["title","link"]}}
  },
  required:["patient_summary","key_findings","differential_diagnoses","patient_safety_note","references"]
};

// ---------- domain detection ----------
function detectDomain(docText='', specialty=''){
  const t = (docText||'').toLowerCase();
  const sp = (specialty||'').toLowerCase();
  if (/ent|أنف|أذن|حنجرة/.test(sp)) return 'ent';
  const entHit = /(tonsil|tonsilli|pharyng|sore\s*throat|اللوز|اللوزتين|التهاب\s*الحلق|بلعوم|حمى|حرارة\s*38)/i.test(docText);
  const mskHit = /(forearm|elbow|tenderness|weakness|carpal|epicondyl|ساعد|مرفق|أوتار|تنميل|نفق)/i.test(docText);
  if (entHit && !mskHit) return 'ent';
  if (mskHit && !entHit) return 'msk';
  return 'general';
}

// ---------- prompts ----------
function buildSystem({ language='ar', specialty='', context='', refBankText='', domain='general' }) {
  const langLine = language==='ar'?'العربية':'English';
  const domainHint = domain==='ent' ? 'المجال: أنف/أذن/حنجرة (التهاب الحلق/اللوزتين/البلعوم)' :
                      domain==='msk' ? 'المجال: عضلي‑هيكلي (ساعد/مرفق/أوتار/نفق رسغي)' :
                      'المجال: عام';
  return `
أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة. أخرج JSON **بالعربية فقط** و**مطابقًا للمخطط STRICT** أدناه. لا تُقدم تشخيصًا نهائيًا أو علاجًا دون مراجعة بشرية.

اللغة: ${langLine} | ${domainHint} | التخصص: ${specialty||'عام'} | السياق: ${context||'—'}

استخدم النص والصور معًا. احذف أي PHI وابدله بـ [REDACTED].
أدرج مراجعك من القائمة أدناه فقط، واختر الأنسب للحالة.

بنك المراجع:
${refBankText}

قواعد خاصة بالمجال:
- ENT: قيّم الحاجة للمضاد الحيوي وفق FeverPAIN/Centor، واذكر الحاجة لـ RADT/زرع إذا لزم (استنادًا لـ NICE/CDC/IDSA). لا تذكر أسماء علامات تجارية؛ استخدم أسماء علمية.
- MSK: نبّه إلى عدم اتساق S50.1 مع عدم وجود إصابة، واذكر بدائل ترميز إن لزم (M79.632/M77.12/G56.02) واستعمال NCS عند الشك بـ CTS.

لا تضع أي نص خارج JSON. لا تستخدم أسوار كود.
`;
}

// ---------- PHI redaction ----------
function redactTextPHI(s){
  if(!s) return s;
  const rules = [
    {re:/^.*\b(Name|Patient\s*File\s*No|ID\s*No|D\.?O\.?B|Provider Name|Insurance Co\.|TPA Name)\b.*$/gmi, rep:''},
    {re:/^.*\b(الاسم|رقم\s*الملف|رقم\s*الهوية|تاريخ\s*الميلاد|مزود\s*الخدمة|شركة\s*التأمين)\b.*$/gmi, rep:''},
    {re:/\b\d{8,}\b/g, rep:'[REDACTED]'},
    {re:/(المريضة|المريض)\s+(اسمها|اسمه)\s+[^\s،,.]+(\s+[^\s،,.]+){0,3}/g, rep:'[REDACTED]'}
  ];
  let out = s; for(const r of rules) out = out.replace(r.re, r.rep); return out;
}
function deepRedact(v){ if(v==null) return v; if(typeof v==='string') return redactTextPHI(v); if(Array.isArray(v)) return v.map(deepRedact); if(typeof v==='object'){ const o={}; for(const k of Object.keys(v)) o[k]=deepRedact(v[k]); return o;} return v; }
const stripFences = s => typeof s==='string' ? s.replace(/```json|```/g,'').trim() : s;
function parseJsonSafe(s){ try{ return JSON.parse(s); }catch{ const m=s?.match?.(/\{[\s\S]*\}/); if(m){ try{ return JSON.parse(m[0]); }catch{} } return null; }}

// ---------- heuristics ----------
function heurENT(docText=''){
  const t = (docText||'').toLowerCase();
  const fever = /(?:temp|temperature|حرارة)\s*[:=]?\s*(?:38|38\.\d)/i.test(docText);
  const cough = /cough|سعال/i.test(docText);
  const tonsil = /tonsil|لوز|اللوزتين|tonsillit/i.test(docText);
  const erythema = /nasopharyngeal\s*erythema|احمرار\s*البلعوم|hyperemia/i.test(docText);
  const brands = /(gloclav|augmentin|mesporin|ceftriax|diclomax|lorin|paracetamol|acetaminophen)/i.test(docText);
  const issues=[], recs=[], refs=new Set();

  if(brands){
    issues.push({ issue:'استخدام/ترميز أسماء تجارية للأدوية بدل الأسماء العلمية/الكود المعتمد', impact:'قد يسبب إشكالات فوترة ومراجعات تأمينية', evidence:'المراجع الوطنية/الدولية توصي بالتسمية العلمية وتوثيق الجرعة والمدة ومبررات المضاد الحيوي' });
  }
  // نقص التوثيق وفق NG84 (درجات FeverPAIN/Centor + اختبار RADT عند الحاجة)
  if(tonsil || erythema || fever){
    issues.push({ issue:'غياب توثيق درجة FeverPAIN/Centor واختبار RADT/زرع عند الحاجة', impact:'صعوبة تبرير المضاد الحيوي وخطر مقاومة الجراثيم/رفض المطالبة', evidence:'توصيات NICE NG84 وCDC وIDSA' });
    refs.add('NICE NG84 — Sore throat (acute): antimicrobial prescribing');
    refs.add('NICE CKS — Sore throat (acute): diagnosis & management (FeverPAIN/Centor)');
    refs.add('CDC — Clinical guidance: Group A streptococcal pharyngitis');
    refs.add('IDSA — Clinical Practice Guideline for Group A Streptococcal Pharyngitis (2012 update)');
  }
  // فرص ترميز
  if(tonsil){
    recs.push({ opportunity:'تدقيق الترميز إلى J03.90 (التهاب اللوزتين الحاد غير محدد) أو J02.9 حسب السرد', category:'documentation', rationale:'مطابقة السرد السريري لأكواد ICD‑10‑CM مع توثيق الحرارة ونتيجة RADT/زرع', risk_note:'لا تغيّر الكود دون دليل سريري موثّق' });
    refs.add('ICD‑10‑CM — J03.90 Acute tonsillitis, unspecified');
    refs.add('ICD‑10‑CM — J02.9 Acute pharyngitis, unspecified');
  }
  // رايات حمراء عامة للـ ENT
  const red = [
    'ضيق نفس/صرير/سيلان لعابي أو صعوبة بلع شديدة',
    'طوريات/امتداد ألم إلى العنق مع صلابة أو انحراف لسان المزمار',
    'تجفاف أو هبوط ضغط أو تدهور عام'
  ];
  return { issues, recs, refs, red };
}

function heurMSK(docText=''){
  const t = (docText||'').toUpperCase();
  const hxNoTrauma = /NO\s+TRAUMA/.test(t);
  const hasS501    = /S50\.1/.test(t);
  const isLeft     = /\b(LT|LEFT)\b/.test(t) || /LEFT\s+FOREARM/i.test(docText);
  const askCRP     = /CRP|C-?REACTIVE/i.test(docText);
  const askESR     = /\bESR\b/i.test(docText);

  const issues = []; const refs = new Set(); const recs = [];
  if (hasS501 && hxNoTrauma) {
    issues.push({ issue:'S50.1 (رضّ الساعد) مع توثيق "لا إصابة"', impact:'عدم اتساق ترميزي قد يعرّض المطالبة للرفض', evidence:'S50.1 كود إصابي سطحي وغير قابل للفوترة ويتطلب سياق إصابة واضح' });
    refs.add('ICD‑10‑CM — S50.1 Contusion of forearm (non‑billable, injury code)');
  }
  if (askCRP && askESR) {
    issues.push({ issue:'طلب CRP وESR معًا بصورة روتينية', impact:'ازدواجية فحوصات بدون فائدة إضافية', evidence:'التوجيه الحكومي يفضّل CRP أولًا واستخدام ESR انتقائيًا' });
    refs.add('BC Guidelines — ESR/CRP Testing (When to order)');
  }
  if (isLeft) {
    recs.push({ opportunity:'ترميز متسق مع السرد والجهة', category:'documentation', rationale:'M79.632 (ألم الساعد الأيسر) عند غياب تشخيص محدد؛ M77.12 عند دلائل التهاب اللُّقَيمة؛ G56.02 عند انطباق صورة النفق الرسغي', risk_note:'التبديل مشروط بأدلة سريرية موثقة' });
    refs.add('ICD‑10‑CM — M77.12 Lateral epicondylitis, left elbow');
    refs.add('ICD‑10‑CM — G56.02 Carpal tunnel syndrome, left upper limb');
  }
  const red = ['حمّى عالية أو تورّم شديد أو علامات عدوى جهازية','عجز عصبي مترقٍ','ألم لَيلي شديد أو علامات متلازمة الحيّز'];
  return { issues, recs, refs, red };
}

// ---------- model I/O helpers ----------
function fromOpenAI(json){
  if(json?.error) return null;
  let txt = '';
  if(typeof json?.output_text === 'string' && json.output_text.trim()) txt = json.output_text;
  if(!txt && Array.isArray(json?.output)){
    const parts=[]; for(const item of json.output){ for(const p of (item.content||[])){ if(typeof p?.text==='string') parts.push(p.text); } }
    txt = parts.join('\n');
  }
  return parseJsonSafe(stripFences(txt)) || null;
}
function fromGemini(json){
  try{
    if(json?.error) return null;
    const cand = json?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const txt = stripFences(parts.map(p=>p?.text||'').join(''));
    return parseJsonSafe(txt);
  }catch{ return null; }
}
function mergeObjects(A, B){
  const base=A||B; if(!base) return null;
  const other=(base===A)?B:A; if(!other) return JSON.parse(JSON.stringify(base));
  const merged = {...base};
  const keys = new Set([...Object.keys(base), ...Object.keys(other)]);
  const toArr=v=>Array.isArray(v)?v:(v==null?[]:[v]);
  for(const k of keys){
    const x=base[k], y=other[k];
    if(Array.isArray(x)||Array.isArray(y)){
      const all=[...toArr(x), ...toArr(y)];
      merged[k]=Array.from(new Map(all.map(o=>[JSON.stringify(o),o])).values());
    }else if(typeof x==='object'&&x&&typeof y==='object'&&y){ merged[k]={...x,...y}; }
    else{ merged[k]= x ?? y; }
  }
  return merged;
}
function needsArabic(text){ if(!text) return false; const latin=(text.match(/[A-Za-z]/g)||[]).length; const arab=(text.match(/[\u0600-\u06FF]/g)||[]).length; return latin>arab; }
async function arabicNormalize(obj, schema){
  const payload = {
    model: "gpt-4o-mini-2024-07-18",
    temperature: 0,
    response_format: { type:"json_schema", json_schema:{ name:"ReportAR", strict:true, schema } },
    instructions: "أعد كتابة هذا JSON بالعربية الطبية الواضحة فقط، مع الحفاظ على نفس المفاتيح والبنية والقيم الدلالية. لا تُضِف مفاتيح جديدة. الروابط تبقى كما هي.",
    input: [{ role:"user", content:[{ type:"input_text", text: JSON.stringify(obj) }]}]
  };
  const r = await fetch("https://api.openai.com/v1/responses", {
    method:"POST", headers:{ "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" }, body: JSON.stringify(payload)
  });
  const j = await r.json(); if(j?.error) return obj;
  let txt = ''; if(typeof j?.output_text==='string') txt=j.output_text;
  if(!txt && Array.isArray(j?.output)){ txt = j.output.flatMap(it => (it.content||[]).map(p=>p.text||"")).join("\n"); }
  try{ return JSON.parse(stripFences(txt)); }catch{ return obj; }
}

// ---------- OpenAI call with fallback ----------
async function callOpenAIStructured({ system, sanitizedDocText, files, language }){
  const models = ["gpt-4o-2024-08-06","gpt-4o-mini-2024-07-18"];
  for(const model of models){
    const imageParts = files.map(f=>({ type:"input_image", image_url: f.url }));
    const payload = {
      model, temperature: 0,
      response_format: { type:"json_schema", json_schema:{ name:"MedicalCaseReport", strict:true, schema: REPORT_SCHEMA } },
      instructions: system,
      input: [{ role:"user", content:[
        { type:"input_text", text: "نص الوثيقة بعد تنقية PHI:\n"+(sanitizedDocText || '—') },
        { type:"input_text", text: "حلّل النص + الصور. أعد JSON بالعربية فقط حسب المخطط." },
        ...imageParts
      ]}]
    };
    const res = await fetch("https://api.openai.com/v1/responses", {
      method:"POST", headers:{ "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" }, body: JSON.stringify(payload)
    });
    const json = await res.json();
    const obj = fromOpenAI(json);
    if(obj) return obj;
  }
  return null;
}

// ---------- Gemini structured ----------
async function callGeminiStructured({ system, sanitizedDocText, files }){
  const parts=[{ text: system }]; if(sanitizedDocText) parts.push({ text:"نص الوثيقة بعد تنقية PHI:\n"+sanitizedDocText });
  for(const f of files){
    const r = await fetch(f.url); const b = Buffer.from(await r.arrayBuffer());
    parts.push({ inline_data:{ mime_type: f.mimeType || mimeFromName(f.name), data: b.toString('base64') } });
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ contents:[{ role:"user", parts }], generationConfig:{ temperature:0, responseMimeType:"application/json", responseSchema: REPORT_SCHEMA } })
  });
  const json = await res.json();
  return fromGemini(json);
}

// ---------- handler ----------
module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const u = new URL(req.url, `http://${req.headers.host}`);
  const action = u.searchParams.get('action') || 'analyze';

  try {
    if (req.method === 'GET' && action === 'version') {
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ apiVersion: API_VERSION }));
    }
    if (req.method === 'GET' && action === 'health') {
      let pkgBlob=false; try{ require.resolve('@vercel/blob'); pkgBlob=true; }catch{}
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok:true, hasBlobToken:!!process.env.BLOB_READ_WRITE_TOKEN, hasOpenAI:!!process.env.OPENAI_API_KEY, hasGemini:!!process.env.GEMINI_API_KEY, pkgBlob }));
    }

    // توقيع رفع Blob
    if (req.method === 'POST' && action === 'sign') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) { const e=new Error('Missing BLOB_READ_WRITE_TOKEN'); e.status=500; throw e; }
      const { raw, obj } = await readBody(req);
      const { handleUpload } = await import('@vercel/blob/client');
      const jsonResponse = await handleUpload({
        body: obj, request: asWebRequest(req, raw),
        onBeforeGenerateToken: async (pathname)=>({ addRandomSuffix:true, maximumSizeInBytes: 500*1024*1024, validUntil: Date.now()+10*60*1000, tokenPayload: JSON.stringify({ pathname, ts: Date.now() }) }),
        onUploadCompleted: async ({ blob }) => { console.log('Blob uploaded:', blob.url); }
      });
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify(jsonResponse));
    }

    // التحليل البنيوي الصارم
    if (req.method === 'POST' && action === 'analyze') {
      const { obj } = await readBody(req);
      const { files=[], docText='', language='ar', model='both', specialty='', context='' } = obj || {};
      if(!Array.isArray(files) || files.length===0){ const e=new Error('لا توجد ملفات للتحليل'); e.status=400; throw e; }

      // domain + refs
      const domain = detectDomain(docText, specialty);
      const refBank = BANKS[domain] || BANKS.general;
      const refBankText = toRefBankText(refBank);

      const sanitizedDocText = redactTextPHI(docText || '');
      const system = buildSystem({ language, specialty, context, refBankText, domain });

      // heuristics
      const H = domain==='ent' ? heurENT(sanitizedDocText) : domain==='msk' ? heurMSK(sanitizedDocText) : {issues:[], recs:[], refs:new Set(), red:[]};

      // calls
      let openaiObj=null, geminiObj=null;
      if (model==='both' || model==='openai') openaiObj = await callOpenAIStructured({ system, sanitizedDocText, files, language });
      if (model==='both' || model==='gemini') geminiObj = await callGeminiStructured({ system, sanitizedDocText, files });

      // merge + reinforce + redact + arabic normalize
      let mergedObj = mergeObjects(openaiObj, geminiObj) || openaiObj || geminiObj || {
        patient_summary:"", key_findings:[], differential_diagnoses:[], severity_red_flags:[], procedural_issues:[], missed_opportunities:[], revenue_quality_opportunities:[], suggested_next_steps:[], patient_safety_note:"هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويُراجع من طبيب مرخّص.", references:[]
      };
      mergedObj.procedural_issues = [...(mergedObj.procedural_issues||[]), ...(H.issues||[])];
      mergedObj.revenue_quality_opportunities = [...(mergedObj.revenue_quality_opportunities||[]), ...(H.recs||[])];
      if (Array.isArray(H.red) && H.red.length){
        mergedObj.severity_red_flags = Array.from(new Set([...(mergedObj.severity_red_flags||[]), ...H.red]));
      }
      const autoRefs = [...(H.refs||[])].map(name => (BANKS.ent.concat(BANKS.msk).concat(BANKS.general)).find(r=>r.title===name)).filter(Boolean);
      const refSet = new Map([...(mergedObj.references||[]).map(r=>[r.link||r.title,r]), ...autoRefs.map(r=>[r.link,r]), ...refBank.map(r=>[r.link,r])]);
      mergedObj.references = Array.from(refSet.values());

      mergedObj = deepRedact(mergedObj);
      if (language === 'ar' && needsArabic(JSON.stringify(mergedObj)) && process.env.OPENAI_API_KEY) {
        mergedObj = await arabicNormalize(mergedObj, REPORT_SCHEMA);
      }

      const openaiText = openaiObj ? JSON.stringify(deepRedact(openaiObj), null, 2) : '';
      const geminiText = geminiObj ? JSON.stringify(deepRedact(geminiObj), null, 2) : '';
      const merged = JSON.stringify(mergedObj, null, 2);

      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ merged, openai: openaiText, gemini: geminiText }));
    }

    res.statusCode = 404; res.end('Not Found');
  } catch (err) {
    res.statusCode = err.status || 500; res.end(err.message || 'Internal Error');
  }
};
