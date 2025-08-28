// api/gpt.js — Vercel Serverless Function (CommonJS, Node 18+)
// === v4.3.0 ===

const API_VERSION = 'v4.3.0';

// ---------- infra ----------
function setCORS(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization'); }
async function readBody(req){ const bufs=[]; for await (const c of req) bufs.push(c); const raw=Buffer.concat(bufs).toString('utf8'); let obj={}; try{ obj=JSON.parse(raw||'{}'); }catch{} return { raw, obj }; }
function asWebRequest(req, bodyString){ const proto=req.headers['x-forwarded-proto']||'https'; const host=req.headers['x-forwarded-host']||req.headers.host||'localhost'; const url=`${proto}://${host}${req.url}`; const headers=new Headers(); for(const [k,v] of Object.entries(req.headers)){ if(Array.isArray(v)) headers.set(k, v.join(', ')); else if(typeof v==='string') headers.set(k, v);} return new Request(url,{method:req.method, headers, body:bodyString}); }
function mimeFromName(name, fallback='image/png'){ const n=(name||'').toLowerCase(); if(n.endsWith('.jpg')||n.endsWith('.jpeg'))return 'image/jpeg'; if(n.endsWith('.png'))return 'image/png'; if(n.endsWith('.webp'))return 'image/webp'; if(n.endsWith('.heic'))return 'image/heic'; if(n.endsWith('.heif'))return 'image/heif'; if(n.endsWith('.tif')||n.endsWith('.tiff'))return 'image/tiff'; return fallback; }

// ---------- reference banks (روابط موثوقة) ----------
const BANKS = {
  ent: [
    {title:'NICE NG84 — Sore throat (acute): antimicrobial prescribing', org:'NICE', link:'https://www.nice.org.uk/guidance/ng84/chapter/recommendations'},
    {title:'NICE CKS — Sore throat (acute): FeverPAIN/Centor', org:'NICE CKS', link:'https://www.nice.org.uk/guidance/ng84/chapter/terms-used-in-the-guideline'},
    {title:'CDC — Group A streptococcal pharyngitis: clinical guidance', org:'CDC', link:'https://www.cdc.gov/group-a-strep/hcp/clinical-guidance/strep-throat.html'}
  ],
  hand: [
    {title:'NICE CKS — Carpal tunnel syndrome (assessment/NCS & management)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/carpal-tunnel-syndrome/diagnosis/assessment/'},
    {title:'NICE CKS — Tennis elbow (diagnosis & management)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/tennis-elbow/'},
    {title:'NICE CKS — Osteoarthritis (hand) — DDx يشمل De Quervain', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/osteoarthritis/diagnosis/differential-diagnosis/'},
    {title:'BSSH — De Quervain’s syndrome (أعراض وعلامات)', org:'BSSH', link:'https://www.bssh.ac.uk/patients/conditions/19/de_quervains_syndrome'},
    {title:'NHS — Trigger finger (الأعراض والعلاج)', org:'NHS', link:'https://www.nhs.uk/conditions/trigger-finger/'},
    {title:'ICD‑10‑CM — M65.4 Radial styloid tenosynovitis [de Quervain]', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/M00-M99/M65-M67/M65-/M65.4'},
    {title:'ICD‑10‑CM — M79.642 Pain in left hand', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/M00-M99/M70-M79/M79-/M79.642'},
    {title:'ICD‑10‑CM — M79.645 Pain in left finger(s)', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/M00-M99/M70-M79/M79-/M79.645'},
    {title:'ICD‑10‑CM — M18.12 Unilateral primary OA of 1st CMC (left hand)', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/M00-M99/M15-M19/M18-/M18.12'},
    {title:'BC Guidelines — ESR/CRP: متى نطلب؟', org:'Government of British Columbia', link:'https://www2.gov.bc.ca/gov/content/health/practitioner-professional-resources/bc-guidelines/esr'}
  ],
  general: [
    {title:'BC Guidelines — ESR/CRP: متى نطلب؟', org:'Government of British Columbia', link:'https://www2.gov.bc.ca/gov/content/health/practitioner-professional-resources/bc-guidelines/esr'}
  ]
};
function toRefBankText(arr){ return arr.map(r=>`- ${r.title} — ${r.link}`).join('\n'); }

// ---------- JSON schema (موسع لتلبية طلبك) ----------
const REPORT_SCHEMA = {
  type:"object",
  properties:{
    patient_summary:{type:"string"},
    key_findings:{type:"array",items:{type:"string"}},
    differential_diagnoses:{type:"array",items:{type:"object",properties:{dx:{type:"string"},why:{type:"string"}},required:["dx","why"]}},
    severity_red_flags:{type:"array",items:{type:"string"}},
    // جديد: ما الذي فعله الطبيب فعلاً (يُستخرج من UCAF)
    physician_actions:{
      type:"object",
      properties:{
        vitals:{type:"array",items:{type:"string"}},
        chief_complaint:{type:"string"},
        significant_signs:{type:"array",items:{type:"string"}},
        diagnoses:{type:"array",items:{type:"string"}},
        orders:{type:"array",items:{type:"string"}},
        meds:{type:"array",items:{type:"string"}}
      }
    },
    // جديد: تعارضات/أخطاء محددة
    contradictions:{type:"array",items:{type:"object",properties:{item:{type:"string"},evidence:{type:"string"},impact:{type:"string"}},required:["item","evidence"]}},
    procedural_issues:{type:"array",items:{type:"object",properties:{issue:{type:"string"},impact:{type:"string"},evidence:{type:"string"}},required:["issue"]}},
    missed_opportunities:{type:"array",items:{type:"object",properties:{what:{type:"string"},why_it_matters:{type:"string"}},required:["what"]}},
    revenue_quality_opportunities:{type:"array",items:{type:"object",properties:{opportunity:{type:"string"},category:{type:"string",enum:["documentation","diagnostics","procedure","follow-up"]},rationale:{type:"string"},risk_note:{type:"string"}},required:["opportunity","category"]}},
    // جديد: ما كان يجب على الطبيب فعله (صريح)
    should_have_been_done:{type:"array",items:{type:"object",properties:{step:{type:"string"},reason:{type:"string"}},required:["step"]}},
    suggested_next_steps:{type:"array",items:{type:"object",properties:{action:{type:"string"},justification:{type:"string"}},required:["action"]}},
    patient_safety_note:{type:"string"},
    references:{type:"array",items:{type:"object",properties:{title:{type:"string"},org:{type:"string"},link:{type:"string"}},required:["title","link"]}}
  },
  required:["patient_summary","key_findings","differential_diagnoses","physician_actions","contradictions","patient_safety_note","references"]
};

// ---------- domain detection ----------
function detectDomain(docText='', specialty=''){
  const sp = (specialty||'').toLowerCase();
  if (/ent|أنف|أذن|حنجرة/.test(sp)) return 'ent';
  if (/hand|wrist|finger|thumb|ساعد|يد|معصم|إبهام|أصبع|سبابة/i.test(docText)) return 'hand';
  return 'hand'; // أغلب نماذج UCAF لديك عضلي‑هيكلي لليد/الساعد
}

// ---------- prompts ----------
function buildSystem({ language='ar', specialty='', context='', refBankText='', domain='hand' }) {
  const langLine = language==='ar'?'العربية':'English';
  const domainHint = domain==='ent' ? 'المجال: أنف/أذن/حنجرة' : 'المجال: يد/معصم/أصابع (عضلي‑هيكلي)';
  return `
أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة. أخرج JSON **بالعربية فقط** و**مطابقًا للمخطط STRICT** أدناه. لا تُقدم تشخيصًا نهائيًا أو علاجًا دون مراجعة بشرية.

اللغة: ${langLine} | ${domainHint} | التخصص: ${specialty||'عام'} | السياق: ${context||'—'}

استخدم النص المُستخرج من UCAF + الصور. احذف أي PHI واستبدله بـ [REDACTED].
املأ الحقل "physician_actions" مما هو مُوثّق (العلامات الحيوية، الشكوى، العلامات، التشخيصات، الطلبات/التحاليل).
املأ "contradictions" بوضوح عند وجود تناقض بين السرد والترميز/الطلبات (مثال: NO TRAUMA مع S50.*, أو طلب CRP+ESR معًا).
حرِّر "should_have_been_done" بخطوات عملية قصيرة تستند لمراجع بنك الروابط بالأسفل.

بنك المراجع (اختر الأنسب فقط):
${refBankText}

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

// ---------- UCAF parser: يستخرج ما فعله الطبيب ----------
function grab(section, text){
  const i = text.indexOf(section); if(i<0) return '';
  const rest = text.slice(i + section.length);
  const nextLabels = ['Significant Signs','Other Conditions','Diagnosis','Suuggestive','Suggested','Service Code','Estimated Length','I hereby'];
  let end = rest.length;
  for(const L of nextLabels){ const j=rest.indexOf(L); if(j>=0) end = Math.min(end, j); }
  return rest.slice(0, end).trim();
}
function parseUCAF(docText=''){
  const t = docText || '';
  const vitals = [];
  const bp = t.match(/BP:\s*([0-9]+[-/][0-9]+)/i)?.[1];
  const pulse = t.match(/Puls?\s*:\s*([0-9]+)/i)?.[1];
  const temp = t.match(/Temp\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  const dur = t.match(/Duration of Illness\s*:\s*([0-9A-Za-z]+)/i)?.[1];
  if(bp) vitals.push('BP '+bp); if(pulse) vitals.push('Pulse '+pulse); if(temp) vitals.push('Temp '+temp); if(dur) vitals.push('Duration '+dur);

  const cc = grab('Chief Complaint & Main Symptoms:', t).replace(/[-•]\s*/g,'').replace(/\s+/g,' ').trim();
  const sig = grab('Significant Signs:', t).split(/\n|-/).map(s=>s.trim()).filter(Boolean);

  // التشخيصات
  const dxBlock = grab('Diagnosis :', t) || '';
  const dxMatches = Array.from(dxBlock.matchAll(/[A-Z][0-9][0-9](?:\.[0-9A-Z]+)?[A-Z0-9\s,.'‑\-()]*?/g)).map(m=>m[0].trim());
  const diagnoses = dxMatches.length ? dxMatches : dxBlock.split(/-|;|\n/).map(s=>s.trim()).filter(Boolean);

  // أوامر/خدمات
  const svcBlock = t.split(/Service Code\*|Service Description/i)[1] ? t.slice(t.indexOf('Service Code')) : '';
  const orders = [];
  const lines = svcBlock.split(/\n/);
  for(const line of lines){
    const m = line.match(/^\s*([A-Z0-9]+)\s+([A-Z][A-Z\-\s().]+[A-Z)]).*/);
    if(m){ orders.push(`${m[1]} — ${m[2].replace(/\s+/g,' ').trim()}`); }
    else{
      const crp = line.match(/C[\.\- ]?REACTIVE\s+PROTINE|C\.?R\.?P/i);
      const esr = line.match(/\bESR\b/i);
      if(crp) orders.push('— C-REACTIVE PROTEIN (CRP)');
      if(esr) orders.push('— ESR (automated)');
    }
  }

  // مؤشرات عامة
  const noTrauma = /NO\s+TRAUMA/i.test(t);
  const lateralityLeft = /\b(LT|LEFT)\b/i.test(t) || /LEFT\s+(?:HAND|FOREARM|FINGER)/i.test(t);

  return {
    vitals, chief_complaint: cc || '',
    significant_signs: sig,
    diagnoses, orders,
    flags: { noTrauma, lateralityLeft }
  };
}

// ---------- heuristics (تعارضات + ما يجب فعله) ----------
function heurHAND(docText='', parsed){
  const H = { issues:[], recs:[], refs:new Set(), red:[], contradictions:[], should:[] };
  const tUp = (docText||'').toUpperCase();
  const p = parsed || { flags:{} };
  const dxText = (parsed?.diagnoses||[]).join(' ').toUpperCase();

  // تعارض: لا إصابة مع S50.*
  if (p.flags?.noTrauma && /S50\./.test(dxText)){
    H.contradictions.push({ item:'ترميز إصابي (S50.*) مع توثيق "NO TRAUMA"', evidence:'النموذج يذكر NO TRAUMA بينما التشخيص يتضمن كدمة/إصابة سطحيّة للساعد (S50.*)', impact:'احتمال رفض مطالبة/عدم اتساق السرد مع الكود' });
    H.refs.add('ICD‑10‑CM — S50.1 Contusion of forearm (non‑billable, injury code)');
  }

  // CRP+ESR معًا
  const ordersText = (parsed?.orders||[]).join(' ');
  if (/CRP/i.test(ordersText) && /\bESR\b/i.test(ordersText)){
    H.contradictions.push({ item:'طلب CRP وESR معًا بصورة روتينية', evidence:'تم توثيق طلب الفحصين معًا في نفس الزيارة', impact:'ازدواجية قد لا تضيف قيمة وتعرّض للمراجعة' });
    H.refs.add('BC Guidelines — ESR/CRP: متى نطلب؟');
    H.issues.push({ issue:'ازدواجية فحوصات التهابية (CRP+ESR)', impact:'تكلفة دون فائدة واضحة في أغلب الحالات غير الالتهابية', evidence:'توصية بتفضيل CRP أولًا وESR انتقائيًا' });
    H.should.push({ step:'تفضيل CRP أولاً وعدم طلب ESR إلا عند داعٍ محدد مع CRP طبيعي', reason:'توصيات حكومية' });
  }

  // اقتراحات ترميز حسب السرد لليد/الأصابع
  if (p.flags?.lateralityLeft){
    H.recs.push({ opportunity:'ترميز متسق مع الجهة (Left)', category:'documentation', rationale:'M79.642 (ألم اليد اليسرى) أو M79.645 (ألم الإصبع الأيسر) عند غياب تشخيص محدد؛ M18.12 عند دلائل فُصال CMC؛ M65.4 عند دلائل De Quervain', risk_note:'لا تغيّر الكود دون دليل سريري موثّق' });
    H.refs.add('ICD‑10‑CM — M79.642 Pain in left hand');
    H.refs.add('ICD‑10‑CM — M79.645 Pain in left finger(s)');
    H.refs.add('ICD‑10‑CM — M18.12 Unilateral primary OA of first CMC, left hand');
    H.refs.add('ICD‑10‑CM — M65.4 Radial styloid tenosynovitis [de Quervain]');
  }

  // ما يجب فعله سريريًا (hand)
  H.should.push({ step:'اختبارات نوعية موجّهة', reason:'Finkelstein لـ De Quervain؛ Phalen/Tinel لـ CTS؛ اختبار Grind لمفصل CMC؛ تفريق Trigger finger بعُقدة A1 وبالطقطقة' });
  H.refs.add('NICE CKS — Carpal tunnel syndrome (assessment/NCS & management)');
  H.refs.add('NICE CKS — Tennis elbow (diagnosis & management)');
  H.refs.add('NICE CKS — Osteoarthritis (hand) — DDx يشمل De Quervain');
  H.refs.add('BSSH — De Quervain’s syndrome (أعراض وعلامات)');
  H.refs.add('NHS — Trigger finger (الأعراض والعلاج)');

  // رايات حمراء عامة
  H.red = ['حمّى عالية/تورّم شديد/اشتباه عدوى عميقة','عجز عصبي مترقٍ','ألم ليلي شديد أو علامات متلازمة حيز'];
  return H;
}

function pickRefsByTitles(names){
  const all = [...BANKS.ent, ...BANKS.hand, ...BANKS.general];
  const idx = new Map(all.map(r=>[r.title, r]));
  return [...names].map(n=> idx.get(n)).filter(Boolean);
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
  return { obj: parseJsonSafe(stripFences(txt)) || null, raw: txt };
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

// ---------- OpenAI call (structured + fallback) ----------
async function callOpenAIStructured({ system, sanitizedDocText, files }){
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
    const parsed = fromOpenAI(json);
    if(parsed?.obj) return parsed;
  }
  return { obj:null, raw:'' };
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

      // UCAF parsing + sanitization
      const parsed = parseUCAF(docText||'');
      const sanitizedDocText = redactTextPHI(docText || '');
      const system = buildSystem({ language, specialty, context, refBankText, domain });

      // heuristics
      const HX = domain==='ent' ? { issues:[], recs:[], refs:new Set(), red:[], contradictions:[], should:[] } : heurHAND(sanitizedDocText, parsed);

      // calls
      let openaiObj=null, openaiRaw='', geminiObj=null;
      if (model==='both' || model==='openai') { const {obj:o, raw} = await callOpenAIStructured({ system, sanitizedDocText, files }); openaiObj=o; openaiRaw=raw; }
      if (model==='both' || model==='gemini') geminiObj = await callGeminiStructured({ system, sanitizedDocText, files });

      // merge + reinforce + fill physician_actions إذا لزم
      let mergedObj = mergeObjects(openaiObj, geminiObj) || openaiObj || geminiObj || {
        patient_summary:"", key_findings:[], differential_diagnoses:[], severity_red_flags:[], physician_actions:{}, contradictions:[], procedural_issues:[], missed_opportunities:[], revenue_quality_opportunities:[], should_have_been_done:[], suggested_next_steps:[], patient_safety_note:"هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويُراجع من طبيب مرخّص.", references:[]
      };

      // حقن ما فعله الطبيب من UCAF إذا كان فارغًا
      mergedObj.physician_actions = mergedObj.physician_actions || {};
      mergedObj.physician_actions.vitals = mergedObj.physician_actions.vitals || parsed.vitals || [];
      mergedObj.physician_actions.chief_complaint = mergedObj.physician_actions.chief_complaint || parsed.chief_complaint || '';
      mergedObj.physician_actions.significant_signs = mergedObj.physician_actions.significant_signs || parsed.significant_signs || [];
      if(!Array.isArray(mergedObj.physician_actions.diagnoses) || !mergedObj.physician_actions.diagnoses.length){ mergedObj.physician_actions.diagnoses = parsed.diagnoses || []; }
      if(!Array.isArray(mergedObj.physician_actions.orders) || !mergedObj.physician_actions.orders.length){ mergedObj.physician_actions.orders = parsed.orders || []; }

      // تناقضات + فرص + رايات حمراء + ما يجب فعله
      mergedObj.contradictions = Array.from(new Map([...(mergedObj.contradictions||[]), ...HX.contradictions].map(x=>[JSON.stringify(x),x])).values());
      mergedObj.procedural_issues = [...(mergedObj.procedural_issues||[]), ...(HX.issues||[])];
      mergedObj.revenue_quality_opportunities = [...(mergedObj.revenue_quality_opportunities||[]), ...(HX.recs||[])];
      mergedObj.should_have_been_done = [...(mergedObj.should_have_been_done||[]), ...(HX.should||[])];
      if (Array.isArray(HX.red) && HX.red.length){
        mergedObj.severity_red_flags = Array.from(new Set([...(mergedObj.severity_red_flags||[]), ...HX.red]));
      }

      // مراجع
      const autoRefs = pickRefsByTitles(HX.refs||new Set());
      const refSet = new Map([...(mergedObj.references||[]).map(r=>[r.link||r.title,r]), ...autoRefs.map(r=>[r.link,r]), ...refBank.map(r=>[r.link,r])]);
      mergedObj.references = Array.from(refSet.values());

      // تنقية PHI + تعريب إجباري عند اللزوم
      mergedObj = deepRedact(mergedObj);
      if (language === 'ar' && needsArabic(JSON.stringify(mergedObj)) && process.env.OPENAI_API_KEY) {
        mergedObj = await arabicNormalize(mergedObj, REPORT_SCHEMA);
      }

      const openaiText = openaiObj ? JSON.stringify(deepRedact(openaiObj), null, 2) : '';
      const geminiText = geminiObj ? JSON.stringify(deepRedact(geminiObj), null, 2) : '';
      const merged = JSON.stringify(mergedObj, null, 2);

      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ merged, openai: openaiText, openai_raw: openaiRaw, gemini: geminiText }));
    }

    res.statusCode = 404; res.end('Not Found');
  } catch (err) {
    res.statusCode = err.status || 500; res.end(err.message || 'Internal Error');
  }
};
