// api/gpt.js — Vercel Serverless Function (CommonJS, Node 18+)
// === v4.1.0 ===

const API_VERSION = 'v4.1.0';

// ---------- infra helpers ----------
function setCORS(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization'); }
async function readBody(req){
  const bufs=[]; for await (const c of req) bufs.push(c);
  const raw = Buffer.concat(bufs).toString('utf8');
  let obj={}; try{ obj = JSON.parse(raw||'{}'); }catch{}
  return { raw, obj };
}
function mimeFromName(name, fallback='image/png'){ const n=(name||'').toLowerCase(); if(n.endsWith('.jpg')||n.endsWith('.jpeg'))return 'image/jpeg'; if(n.endsWith('.png'))return 'image/png'; if(n.endsWith('.webp'))return 'image/webp'; if(n.endsWith('.heic'))return 'image/heic'; if(n.endsWith('.heif'))return 'image/heif'; if(n.endsWith('.tif')||n.endsWith('.tiff'))return 'image/tiff'; return fallback; }
function asWebRequest(req, bodyString){
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const url   = `${proto}://${host}${req.url}`;
  const headers = new Headers();
  for (const [k,v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) headers.set(k, v.join(', '));
    else if (typeof v === 'string') headers.set(k, v);
  }
  return new Request(url, { method: req.method, headers, body: bodyString });
}

// ---------- reference bank (credible links) ----------
const REF_BANK = [
  {title:'NICE CKS — Carpal tunnel syndrome (assessment / when to arrange NCS)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/carpal-tunnel-syndrome/diagnosis/assessment/'},
  {title:'NICE CKS — Tennis elbow (diagnosis and management)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/tennis-elbow/'},
  {title:'ICD‑10‑CM — S50.1 Contusion of forearm (non‑billable, injury code)', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/S00-T88/S50-S59/S50-/S50.1'},
  {title:'ICD‑10‑CM — M77.12 Lateral epicondylitis, left elbow', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/M00-M99/M70-M79/M77-/M77.12'},
  {title:'ICD‑10‑CM — G56.02 Carpal tunnel syndrome, left upper limb', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/G00-G99/G50-G59/G56-/G56.02'},
  {title:'BC Guidelines — ESR/CRP Testing (When to order)', org:'Government of British Columbia', link:'https://www2.gov.bc.ca/gov/content/health/practitioner-professional-resources/bc-guidelines/esr'}
];

// ---------- JSON schema (shared) ----------
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

// ---------- prompts ----------
function toRefBankText(){ return REF_BANK.map(r=>`- ${r.title} — ${r.link}`).join('\n'); }
function buildSystem({ language='ar', specialty='', context='', refBankText='' }) {
  return `
أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة. لا تقدّم تشخيصًا نهائيًا أو توصيات علاجية دون مراجعة بشرية.
اللغة: ${language==='ar'?'العربية':'English'} | التخصص: ${specialty||'عام'} | السياق: ${context||'—'}

المهمة: حلّل الصور + نص الوثيقة. أخرج JSON بالعربية فقط، مطابقًا للمخطط STRICT أدناه.
المسموح في "references": روابط "بنك المراجع" أدناه فقط.

بنك المراجع:
${refBankText}

تأكد من:
1. استخدام اللغة العربية الطبية السليمة فقط
2. تنظيم المحتوى في فقرات واضحة
3. استخدام المصطلحات الطبية العربية الصحيحة
4. الالتزام الكامل بتنسيق JSON المطلوب

قواعد:
- احذف/استبدل أي PHI بـ [REDACTED].
- لا تضع أي كائن استجابة أو أسوار كود، JSON فقط.
- نبّه إلى عدم اتساق الترميز (مثل S50.1 مع لا-إصابة) واستشهد بالمراجع المناسبة.
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
function deepRedact(v){
  if(v==null) return v;
  if(typeof v==='string') return redactTextPHI(v);
  if(Array.isArray(v)) return v.map(deepRedact);
  if(typeof v==='object'){ const o={}; for(const k of Object.keys(v)) o[k]=deepRedact(v[k]); return o; }
  return v;
}
const stripFences = s => typeof s==='string' ? s.replace(/```json|```/g,'').trim() : s;
function parseJsonSafe(s){ try{ return JSON.parse(s); }catch{ const m=s?.match?.(/\{[\s\S]*\}/); if(m){ try{ return JSON.parse(m[0]); }catch{} } return null; }}

// ---------- heuristics (قواعد ثابتة تُضاف للنتيجة) ----------
function deriveHeuristics(docText=''){
  const t = (docText||'').toUpperCase();
  const hxNoTrauma = /NO\s+TRAUMA/.test(t);
  const hasS501    = /S50\.1/.test(t);
  const isLeft     = /\b(LT|LEFT)\b/.test(t) || /LEFT\s+FOREARM/i.test(docText);
  const askCRP     = /CRP|C-?REACTIVE/i.test(t);
  const askESR     = /\bESR\b/i.test(t);
  const issues = []; const refs = new Set(); const recs = [];

  if (hasS501 && hxNoTrauma) {
    issues.push({
      issue: 'S50.1 (رضّ الساعد) مع توثيق "لا إصابة"',
      impact: 'عدم اتساق ترميزي قد يعرّض المطالبة للرفض',
      evidence: 'S50.1 كود إصابي سطحي وغير قابل للفوترة ويتطلب سياق إصابة واضح'
    });
    refs.add('ICD‑10‑CM — S50.1 Contusion of forearm (non‑billable, injury code)');
  }
  if (askCRP && askESR) {
    issues.push({
      issue: 'طلب CRP وESR معًا بصورة روتينية',
      impact: 'ازدواجية فحوصات بدون فائدة إضافية',
      evidence: 'توصي الجهة الحكومية بتفضيل CRP أولًا واستخدام ESR انتقائيًا عند داعٍ'
    });
    refs.add('BC Guidelines — ESR/CRP Testing (When to order)');
  }
  if (isLeft) {
    recs.push({
      opportunity: 'ترميز متسق مع السرد والجهة',
      category: 'documentation',
      rationale: 'M79.632 (ألم الساعد الأيسر) عند غياب تشخيص محدد؛ M77.12 عند دلائل التهاب اللُّقَيمة؛ G56.02 عند انطباق صورة النفق الرسغي',
      risk_note: 'التبديل مشروط بأدلة سريرية موثقة'
    });
    refs.add('ICD‑10‑CM — M77.12 Lateral epicondylitis, left elbow');
    refs.add('ICD‑10‑CM — G56.02 Carpal tunnel syndrome, left upper limb');
  }
  return { issues, refs, recs };
}
function pickRefsByNames(names){
  const idx = new Map(REF_BANK.map(r=>[r.title, r]));
  return [...names].map(n=> idx.get(n)).filter(Boolean);
}

// ---------- extraction ----------
function fromOpenAI(json) {
  // المحاولة الأولى: من output_text مباشرة
  if (typeof json?.output_text === 'string' && json.output_text.trim()) {
    return parseJsonSafe(stripFences(json.output_text));
  }
  
  // المحاولة الثانية: من محتوى output
  if (Array.isArray(json?.output)) {
    let combinedText = '';
    for (const item of json.output) {
      for (const content of item.content || []) {
        if (content.text) combinedText += content.text + '\n';
      }
    }
    if (combinedText.trim()) {
      return parseJsonSafe(stripFences(combinedText));
    }
  }
  
  // المحاولة الثالثة: البحث عن JSON في أي مكان في الرد
  const jsonString = JSON.stringify(json);
  const match = jsonString.match(/\{[\s\S]*"patient_summary"[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      console.error('Failed to parse matched JSON:', e);
    }
  }
  
  return null;
}
function fromGemini(json){
  try{
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

// لأغراض debugging فقط
function debugResponse(provider, response) {
  console.log(`${provider} response:`, JSON.stringify(response, null, 2));
  return response;
}

// ---------- Arabic normalization (اختياري عند الحاجة) ----------
function needsArabic(text){
  if(!text) return false;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const arab  = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return latin > arab;
}
async function arabicNormalize(obj, schema){
  const payload = {
    model: "gpt-4o-mini-2024-07-18",
    temperature: 0,
    response_format: { type: "json_schema", json_schema: { name: "ReportAR", strict: true, schema } },
    instructions: "أعد كتابة هذا JSON بالعربية الطبية الواضحة فقط، مع الحفاظ على نفس المفاتيح والبنية والقيم الدلالية. لا تُضِف مفاتيح جديدة. الروابط تبقى كما هي.",
    input: [{ role:"user", content:[{ type:"input_text", text: JSON.stringify(obj) }]}]
  };
  const r = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{ "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  let txt = '';
  if(typeof j?.output_text === 'string') txt = j.output_text;
  if(!txt && Array.isArray(j?.output)){ txt = j.output.flatMap(it => (it.content||[]).map(p=>p.text||"")).join("\n"); }
  try{ return JSON.parse(stripFences(txt)); }catch{ return obj; }
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
      return res.end(JSON.stringify({
        ok:true,
        hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasGemini: !!process.env.GEMINI_API_KEY,
        pkgBlob
      }));
    }

    // توقيع رفع Blob (Client Uploads)
    if (req.method === 'POST' && action === 'sign') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) { const e=new Error('Missing BLOB_READ_WRITE_TOKEN'); e.status=500; throw e; }
      const { raw, obj } = await readBody(req);
      const { handleUpload } = await import('@vercel/blob/client');
      const jsonResponse = await handleUpload({
        body: obj,
        request: asWebRequest(req, raw),
        onBeforeGenerateToken: async (pathname)=>({
          addRandomSuffix:true,
          maximumSizeInBytes: 500*1024*1024,
          validUntil: Date.now()+10*60*1000,
          tokenPayload: JSON.stringify({ pathname, ts: Date.now() })
        }),
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

      const sanitizedDocText = redactTextPHI(docText || '');
      const sys = buildSystem({ language, specialty, context, refBankText: toRefBankText() });
      const heur = deriveHeuristics(sanitizedDocText);

      // --- OpenAI (Structured Outputs) ---
      let openaiObj=null;
      if (model==='both' || model==='openai') {
        const imageParts = files.map(f=>({ type:"input_image", image_url: f.url }));
        const oaPayload = {
          model: "gpt-4o-2024-08-06",
          temperature: 0,
          response_format: { type:"json_schema", json_schema:{ name:"MedicalCaseReport", strict:true, schema: REPORT_SCHEMA } },
          instructions: sys,
          input: [{ role:"user", content: [
            { type:"input_text", text: "نص الوثيقة بعد تنقية PHI:\n"+(sanitizedDocText || '—') },
            { type:"input_text", text: "حلّل النص + الصور. أعد JSON بالعربية فقط حسب المخطط." },
            ...imageParts
          ]}]
        };
        const oaRes = await fetch("https://api.openai.com/v1/responses", {
          method:"POST", headers:{ "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
          body: JSON.stringify(oaPayload)
        });
        const oaData = await oaRes.json();
        console.log("OpenAI raw response:", JSON.stringify(oaData, null, 2)); // هذا السطر مهم للتصحيح
        openaiObj = fromOpenAI(oaData);
      }

      // --- Gemini (responseSchema) ---
      let geminiObj=null;
      if (model==='both' || model==='gemini') {
        const parts=[{ text: sys }];
        if(sanitizedDocText) parts.push({ text:"نص الوثيقة بعد تنقية PHI:\n"+sanitizedDocText });
        for(const f of files){
          const r = await fetch(f.url); const b = Buffer.from(await r.arrayBuffer());
          parts.push({ inline_data:{ mime_type: f.mimeType || mimeFromName(f.name), data: b.toString('base64') } });
        }
        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            contents:[{ role:"user", parts }],
            generationConfig:{ temperature:0, responseMimeType:"application/json", responseSchema: REPORT_SCHEMA }
          })
        });
        geminiObj = fromGemini(await gRes.json());
      }

      // دمج + تقوية بالحتميات + تنقية نهائية + تعريب إجباري عند الحاجة
      let mergedObj = mergeObjects(openaiObj, geminiObj) || openaiObj || geminiObj || {
        patient_summary:"", key_findings:[], differential_diagnoses:[], severity_red_flags:[], procedural_issues:[], missed_opportunities:[], revenue_quality_opportunities:[], suggested_next_steps:[], patient_safety_note:"هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويُراجع من طبيب مرخّص.", references:[]
      };

      mergedObj.procedural_issues = [...(mergedObj.procedural_issues||[]), ...heur.issues];
      mergedObj.revenue_quality_opportunities = [...(mergedObj.revenue_quality_opportunities||[]), ...(heur.recs||[])];
      const autoRefs = pickRefsByNames(heur.refs);
      const refSet = new Map([...(mergedObj.references||[]).map(r=>[r.link||r.title,r]), ...autoRefs.map(r=>[r.link,r])]);
      mergedObj.references = Array.from(refSet.values());

      mergedObj = deepRedact(mergedObj);

      if (language === 'ar') {
        const sample = JSON.stringify(mergedObj);
        if (needsArabic(sample) && process.env.OPENAI_API_KEY) {
          mergedObj = await arabicNormalize(mergedObj, REPORT_SCHEMA);
        }
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
