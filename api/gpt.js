// api/gpt.js — Vercel Serverless Function (CommonJS, Node 18+)
// === v5.0.0 ===
// مخرجات منظمة بالعربية مع حقول: physician_actions, contradictions, should_have_been_done
// يستند إلى مراجع موثوقة (NICE CKS/NG190, AAD/AAAAI 2023, NICE NG136, ICD-10)

const API_VERSION = 'v5.0.0';

// ---------- infra ----------
function setCORS(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization'); }
async function readBody(req){ const bufs=[]; for await (const c of req) bufs.push(c); const raw=Buffer.concat(bufs).toString('utf8'); let obj={}; try{ obj=JSON.parse(raw||'{}'); }catch{} return { raw, obj }; }
function asWebRequest(req, bodyString){ const proto=req.headers['x-forwarded-proto']||'https'; const host=req.headers['x-forwarded-host']||req.headers.host||'localhost'; const url=`${proto}://${host}${req.url}`; const headers=new Headers(); for(const [k,v] of Object.entries(req.headers)){ if(Array.isArray(v)) headers.set(k, v.join(', ')); else if(typeof v==='string') headers.set(k, v);} return new Request(url,{method:req.method, headers, body:bodyString}); }
function mimeFromName(name, fallback='image/png'){ const n=(name||'').toLowerCase(); if(n.endsWith('.jpg')||n.endsWith('.jpeg'))return 'image/jpeg'; if(n.endsWith('.png'))return 'image/png'; if(n.endsWith('.webp'))return 'image/webp'; if(n.endsWith('.heic'))return 'image/heic'; if(n.endsWith('.heif'))return 'image/heif'; if(n.endsWith('.tif')||n.endsWith('.tiff'))return 'image/tiff'; return fallback; }

// ---------- Reference Banks (دقيقة ومحدّثة) ----------
const BANKS = {
  derm: [
    // NICE CKS — Atopic eczema: assessment/management/stepped approach
    {title:'NICE CKS — Eczema (atopic): overview & management', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/eczema-atopic/'},
    {title:'NICE CKS — Eczema (atopic): management (stepped approach)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/eczema-atopic/management/'},
    {title:'NICE CKS — Eczema (atopic): infected eczema / admission / EH', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/eczema-atopic/management/infected-eczema/'},
    {title:'NICE — NG190 Secondary bacterial infection of eczema (antimicrobial prescribing)', org:'NICE NG190', link:'https://www.nice.org.uk/guidance/ng190'},
    {title:'AAD — Atopic dermatitis clinical guideline (Topical therapy 2023)', org:'AAD/JAAD', link:'https://www.aad.org/member/clinical-quality/guidelines/atopic-dermatitis'},
    {title:'ICD‑10‑CM — L20.9 Atopic dermatitis, unspecified', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/L00-L99/L20-L30/L20-/L20.9'}
  ],
  ent: [
    {title:'NICE NG84 — Sore throat (acute): antimicrobial prescribing', org:'NICE', link:'https://www.nice.org.uk/guidance/ng84'},
    {title:'CDC — Group A strep pharyngitis: clinical guidance', org:'CDC', link:'https://www.cdc.gov/group-a-strep/hcp/clinical-guidance/strep-throat.html'}
  ],
  hand: [
    {title:'NICE CKS — Carpal tunnel syndrome (assessment/NCS & management)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/carpal-tunnel-syndrome/diagnosis/assessment/'},
    {title:'NICE CKS — Tennis elbow (diagnosis & management)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/tennis-elbow/'}
  ],
  htn: [
    {title:'NICE NG136 — Hypertension in adults: diagnosis and management', org:'NICE', link:'https://www.nice.org.uk/guidance/ng136'}
  ],
  general: []
};
const ALL_BANKS = [...BANKS.derm, ...BANKS.ent, ...BANKS.hand, ...BANKS.htn, ...BANKS.general];
function toRefBankText(arr){ return arr.map(r=>`- ${r.title} — ${r.link}`).join('\n'); }

// ---------- JSON schema (موسّع) ----------
const REPORT_SCHEMA = {
  type:"object",
  properties:{
    patient_summary:{type:"string"},
    key_findings:{type:"array",items:{type:"string"}},
    differential_diagnoses:{type:"array",items:{type:"object",properties:{dx:{type:"string"},why:{type:"string"}},required:["dx","why"]}},
    severity_red_flags:{type:"array",items:{type:"string"}},
    physician_actions:{type:"object",properties:{
      vitals:{type:"array",items:{type:"string"}},
      chief_complaint:{type:"string"},
      significant_signs:{type:"array",items:{type:"string"}},
      diagnoses:{type:"array",items:{type:"string"}},
      orders:{type:"array",items:{type:"string"}},
      meds:{type:"array",items:{type:"string"}}
    }},
    contradictions:{type:"array",items:{type:"object",properties:{item:{type:"string"},evidence:{type:"string"},impact:{type:"string"}},required:["item","evidence"]}},
    procedural_issues:{type:"array",items:{type:"object",properties:{issue:{type:"string"},impact:{type:"string"},evidence:{type:"string"}},required:["issue"]}},
    missed_opportunities:{type:"array",items:{type:"object",properties:{what:{type:"string"},why_it_matters:{type:"string"}},required:["what"]}},
    revenue_quality_opportunities:{type:"array",items:{type:"object",properties:{opportunity:{type:"string"},category:{type:"string",enum:["documentation","diagnostics","procedure","follow-up"]},rationale:{type:"string"},risk_note:{type:"string"}},required:["opportunity","category"]}},
    should_have_been_done:{type:"array",items:{type:"object",properties:{step:{type:"string"},reason:{type:"string"}},required:["step"]}},
    suggested_next_steps:{type:"array",items:{type:"object",properties:{action:{type:"string"},justification:{type:"string"}},required:["action"]}},
    patient_safety_note:{type:"string"},
    references:{type:"array",items:{type:"object",properties:{title:{type:"string"},org:{type:"string"},link:{type:"string"}},required:["title","link"]}}
  },
  required:["patient_summary","key_findings","differential_diagnoses","physician_actions","contradictions","patient_safety_note","references"]
};

// ---------- Domain detection ----------
function detectDomain(docText='', specialty=''){
  const sp=(specialty||'').toLowerCase();
  const t=(docText||'').toLowerCase();
  if(/derm|جلدية|eczema|urticaria|rash|l20\.9|حكة|طفح|حويصل|وذمة/.test(sp+t)) return 'derm';
  if(/ent|أنف|أذن|حنجرة|sore\s*throat|tonsil|pharyng|لوز|بلعوم|حلق/.test(sp+t)) return 'ent';
  if(/hand|wrist|finger|thumb|ساعد|يد|معصم|إبهام|أصبع|سبابة|forearm|elbow|carpal|epicondyl/.test(sp+t)) return 'hand';
  if(/htn|ضغط|hypertension|i10|bp\s*[:\s]?\d{2,3}\s*[-\/]\s*\d{2,3}/.test(sp+t)) return 'htn';
  return 'derm';
}

// ---------- System prompt ----------
function buildSystem({ language='ar', specialty='', context='', refBankText='', domain='derm' }) {
  const langLine = language==='ar'?'العربية':'English';
  const domainHint = {derm:'جلدية (إكزيما/أرتيكاريا/طفح)', ent:'أنف/أذن/حنجرة', hand:'يد/معصم/ساعد', htn:'ضغط الدم'}[domain] || 'عام';
  return `
أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة. أخرج JSON **بالعربية فقط** و**مطابقًا للمخطط STRICT** أدناه. لا تُقدم تشخيصًا نهائيًا أو علاجًا دون مراجعة بشرية.

اللغة: ${langLine} | المجال: ${domainHint} | التخصص: ${specialty||'عام'} | السياق: ${context||'—'}

استخدم النص المُستخرج من UCAF + الصور. احذف أي PHI واستبدله بـ [REDACTED].
املأ "physician_actions" بما هو موثّق (العلامات الحيوية، الشكوى، العلامات، التشخيصات، الأوامر/التحاليل، الأدوية).
املأ "contradictions" عندما يتعارض السرد مع الترميز/العلاج (مثال: مضاد موضعي في الإكزيما بدون عدوى موثّقة؛ ضغط مرتفع دون متابعة؛ NO TRAUMA مع S50.*).
املأ "should_have_been_done" بخطوات عملية قصيرة تستند لبنك المراجع أدناه.

بنك المراجع (استخدم الأنسب فقط):
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
  let out = s; for(const r of rules) out = out.replace(r.re, r.rep); return out.trim();
}
function deepRedact(v){ if(v==null) return v; if(typeof v==='string') return redactTextPHI(v); if(Array.isArray(v)) return v.map(deepRedact); if(typeof v==='object'){ const o={}; for(const k of Object.keys(v)) o[k]=deepRedact(v[k]); return o;} return v; }
const stripFences = s => typeof s==='string' ? s.replace(/```json|```/g,'').trim() : s;
function parseJsonSafe(s){ try{ return JSON.parse(s); }catch{ const m=s?.match?.(/\{[\s\S]*\}/); if(m){ try{ return JSON.parse(m[0]); }catch{} } return null; }}

// ---------- UCAF parser ----------
function sectionAfter(label, text){
  const i = text.indexOf(label); if(i<0) return '';
  const rest = text.slice(i + label.length);
  const stops = ['Significant Signs','Other Conditions','Diagnosis','Suuggestive','Suggested','Service Code','Estimated Length','I hereby','I hereby certify','For Insurance Company'];
  let end = rest.length; for(const L of stops){ const j = rest.indexOf(L); if(j>=0) end = Math.min(end, j); }
  return rest.slice(0,end).trim();
}
function parseVitals(text){
  const vitals=[];
  const bp = text.match(/BP[:\s]*([0-9]{2,3}\s*[-\/]\s*[0-9]{2,3})/i)?.[1] || text.match(/الضغط[:\s]*([0-9]{2,3}\s*[-\/]\s*[0-9]{2,3})/i)?.[1];
  const pulse = text.match(/Puls?[:\s]*([0-9]{2,3})/i)?.[1] || text.match(/النبض[:\s]*([0-9]{2,3})/i)?.[1];
  const temp = text.match(/Temp[:\s]*([0-9]{2,3}(?:\.[0-9]+)?)/i)?.[1] || text.match(/الحرارة[:\s]*([0-9]{2,3}(?:\.[0-9]+)?)/i)?.[1];
  const dur = text.match(/Duration of Illness[:\s]*([0-9A-Za-z]+(?:\s*[A-Za-z]+)?)/i)?.[1];
  if(bp) vitals.push('BP '+bp); if(pulse) vitals.push('Pulse '+pulse); if(temp) vitals.push('Temp '+temp); if(dur) vitals.push('Duration '+dur);
  return vitals;
}
function parseUCAF(docText=''){
  const t = docText || '';
  const vitals = parseVitals(t);
  const cc = sectionAfter('Chief Complaint & Main Symptoms:', t).replace(/[-•]\s*/g,'').replace(/\s+/g,' ').trim();
  const sig = sectionAfter('Significant Signs:', t).split(/\n|-/).map(s=>s.trim()).filter(Boolean);

  const dxBlock = sectionAfter('Diagnosis :', t) || '';
  const dxMatches = Array.from(dxBlock.matchAll(/[A-Z][0-9][0-9](?:\.[0-9A-Z]+)?[A-Z0-9\s,.'‑\-()]*/g)).map(m=>m[0].trim());
  const diagnoses = dxMatches.length ? dxMatches : dxBlock.split(/-|;|\n/).map(s=>s.trim()).filter(Boolean);

  // أوامر/خدمات
  const orders=[]; const svcIx = t.indexOf('Service Code');
  if(svcIx>=0){
    const svcBlock = t.slice(svcIx, svcIx+1000);
    const lines = svcBlock.split(/\n/);
    for(const line of lines){
      const m = line.match(/^\s*([A-Z0-9]+)\s+([A-Z][A-Z\-\s().]+[A-Z)]).*/);
      if(m){ orders.push(`${m[1]} — ${m[2].replace(/\s+/g,' ').trim()}`); }
      else{
        if(/C[\.\- ]?REACTIVE\s+PROTINE|C\.?R\.?P/i.test(line)) orders.push('— C-REACTIVE PROTEIN (CRP)');
        if(/\bESR\b/i.test(line)) orders.push('— ESR (automated)');
      }
    }
  }

  // أدوية (التقاط شائع حسب أسماء في ملفاتك)
  const meds = [];
  const medHits = t.match(/\b(L\-?CET|LORIN|LORADAY|EMIDOL|PARACETAMOL|FUSIBACT|DICLOMAX|NEUROVIT|GL[AO]CLAV|AZI(MAC|THRO)|CEF(IXIME|DOX|TRIAX))\b/ig);
  if(medHits) meds.push(...Array.from(new Set(medHits)));

  return { vitals, chief_complaint: cc || '', significant_signs: sig, diagnoses, orders, meds };
}

// ---------- Heuristics ----------
// Dermatology (Atopic dermatitis / rash)
function heurDERM(docText='', pa={}){
  const H = { issues:[], recs:[], refs:new Set(), red:[], contradictions:[], should:[] };
  const t = (docText||'').toUpperCase();
  const meds = (pa.meds||[]).join(' ').toUpperCase();
  const signs = (pa.significant_signs||[]).join(' ').toUpperCase();

  // 1) مضاد موضعي دون عدوى موثقة
  const topicalAbx = /(FUSIBACT|FUSIDIC|MUPIROCIN)/.test(meds);
  const infectionWords = /(INFECTION|INFECTED|IMPETIGO|قَيح|صديد|عدوى|قشور عسلية)/i.test(docText);
  if(topicalAbx && !infectionWords){
    H.contradictions.push({ item:'مضاد حيوي موضعي دون توثيق عدوى جلدية ثانوية', evidence:'وُصف FUSIDIC/Mupirocin بلا ذكر علامات عدوى', impact:'قابل للرفض وسوء استخدام مضادّات — يُوصى بتجنّب المضاد الموضعي روتينيًا' });
    H.refs.add('NICE — NG190 Secondary bacterial infection of eczema (antimicrobial prescribing)');
    H.issues.push({ issue:'صرف مضاد موضعي روتينيًا في الإكزيما', impact:'مقاومة/رفض مطالبة', evidence:'NG190: لا مضاد موضعي روتينيًا؛ استخدام قصير فقط مع عدوى مُثبتة' });
  }

  // 2) مضادات الهيستامين كعلاج للحكة
  if(/\b(L\-?CET|CETIRIZINE|LEVOCETIRIZINE|LORATADINE|FEXOFENADINE)\b/.test(meds)){
    H.issues.push({ issue:'الاعتماد على مضادات هيستامين غير مهدّئة للحكة', impact:'فعالية محدودة في AD', evidence:'إرشادات AAD/AAAAI: ليست علاج الحكة الأساسي؛ قد يُستخدم المُهدِّئ قصيرًا لقلة النوم' });
    H.refs.add('AAD — Atopic dermatitis clinical guideline (Topical therapy 2023)');
  }

  // 3) غياب الأساسيات (Emollients + Topical steroids/TCI)
  const hasMoisturizer = /(EMOLLIENT|MOISTURIZ)/.test(t);
  const hasSteroid = /(HYDROCORT|BETAMETH|MOMETASONE|CLOBETASOL|FLUOCIN|TRIAMCIN)/.test(t);
  if(!hasMoisturizer || !hasSteroid){
    H.should.push({ step:'بدء خطة أساس: مرطّب كثيف + كورتيكوستيرويد موضعي مناسب الشدّة (وTCI لمواضع حساسة)', reason:'الركن الأول في العلاج الموضعي وفق NICE CKS و AAD' });
    H.refs.add('NICE CKS — Eczema (atopic): overview & management');
    H.refs.add('AAD — Atopic dermatitis clinical guideline (Topical therapy 2023)');
  }

  // 4) Eczema herpeticum red flag
  H.red.push('تفاقم سريع مع حويصلات مؤلمة متجمّعة/آفات مثقوبة + حرارة: اشتباه Eczema herpeticum (أسيكلوفير فوري وإحالة نفس اليوم)');

  // 5) ضغط مرتفع غير مُتابع
  const bp = (pa.vitals||[]).find(v=>/BP\s*\d{2,3}\s*[-\/]\s*\d{2,3}/i.test(v));
  if(bp){
    const m = bp.match(/(\d{2,3})\s*[-\/]\s*(\d{2,3})/); if(m){ const sys=+m[1], dia=+m[2];
      if(sys>=140 || dia>=90){
        H.contradictions.push({ item:'ضغط مرتفع دون خطة تأكيد/متابعة', evidence:`قراءة مسجّلة ${sys}/${dia}`, impact:'نقص توثيق وفق NG136 (يلزم ABPM/HBPM)' });
        H.should.push({ step:'تأكيد الضغط بـ ABPM/HBPM خلال أيام', reason:'NICE NG136' });
        H.refs.add('NICE NG136 — Hypertension in adults: diagnosis and management');
      }
    }
  }
  return H;
}

// ENT و Hand (ملخّصات)
function heurENT(){ return { issues:[], recs:[], refs:new Set(['NICE NG84 — Sore throat (acute): antimicrobial prescribing','CDC — Group A strep pharyngitis: clinical guidance']), red:['انسداد هوائي/ضيق نفس','سيلان لعابي/صعوبة بلع شديدة'], contradictions:[], should:[{step:'توثيق درجات FeverPAIN/Centor و/أو RADT قبل المضاد', reason:'NICE/CDC'}] }; }
function heurHAND(docText='', pa={}){
  const H={ issues:[], recs:[], refs:new Set(), red:['حمّى/تورّم شديد/اشتباه عدوى','عجز عصبي مترقٍ','ألم ليلي شديد أو علامات حيز'], contradictions:[], should:[] };
  const dx = (pa.diagnoses||[]).join(' ').toUpperCase();
  if(/S50\./.test(dx) && /(NO\s+TRAUMA|WITHOUT\s+TRAUMA)/i.test(docText)){ H.contradictions.push({ item:'S50.* إصابي مع توثيق NO TRAUMA', evidence:'عدم اتساق سردي/ترميزي', impact:'قابل للرفض' }); }
  if(/CRP/i.test((pa.orders||[]).join(' ')) && /\bESR\b/i.test((pa.orders||[]).join(' '))){
    H.issues.push({ issue:'طلب CRP وESR معًا روتينيًا', impact:'ازدواجية غير لازمة', evidence:'التوجيه يفضل CRP أولًا وESR انتقائيًا' });
  }
  H.refs.add('NICE CKS — Carpal tunnel syndrome (assessment/NCS & management)');
  H.refs.add('NICE CKS — Tennis elbow (diagnosis & management)');
  H.should.push({ step:'اختبارات نوعية موجّهة (Finkelstein / Phalen / Tinel / Grind)', reason:'تحسين الدقة والترميز' });
  return H;
}
function heurHTN(docText='', pa={}){
  const H={ issues:[], recs:[], refs:new Set(['NICE NG136 — Hypertension in adults: diagnosis and management']), red:['أعراض عصبية/صدرية حادة مع BP مرتفع جدًا'], contradictions:[], should:[] };
  const bp = (pa.vitals||[]).find(v=>/BP\s*\d{2,3}\s*[-\/]\s*\d{2,3}/i.test(v));
  if(bp){ const m=bp.match(/(\d{2,3})\s*[-\/]\s*(\d{2,3})/); if(m){ const sys=+m[1], dia=+m[2]; if(sys>=140||dia>=90){ H.contradictions.push({ item:'ضغط مرتفع دون تأكيد تشخيص', evidence:`قراءة ${sys}/${dia}`, impact:'يلزم ABPM/HBPM وفحوص أساس' }); H.should.push({ step:'ABPM/HBPM + فحوص أساس (UA, eGFR, Lipids, HbA1c, ECG)', reason:'NICE NG136' }); }}}
  return H;
}

// ---------- Model I/O helpers ----------
function fromOpenAI(json){
  if(json?.error) return { obj:null, raw: JSON.stringify(json) };
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
  if(!process.env.OPENAI_API_KEY) return obj;
  const payload = {
    model: "gpt-4o-mini-2024-07-18", temperature: 0,
    response_format: { type:"json_schema", json_schema:{ name:"ReportAR", strict:true, schema } },
    instructions: "أعد كتابة هذا JSON بالعربية الطبية الواضحة فقط، مع الحفاظ على نفس المفاتيح والبنية والقيم.",
    input: [{ role:"user", content:[{ type:"input_text", text: JSON.stringify(obj) }]}]
  };
  const r = await fetch("https://api.openai.com/v1/responses", {
    method:"POST", headers:{ "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" }, body: JSON.stringify(payload)
  });
  const j = await r.json(); let txt = j?.output_text || (Array.isArray(j?.output)? j.output.flatMap(it=>(it.content||[]).map(p=>p.text||"")).join("\n"): "");
  try{ return JSON.parse(stripFences(txt)); }catch{ return obj; }
}

// ---------- OpenAI & Gemini ----------
async function callOpenAIStructured({ system, sanitizedDocText, files }){
  const models = ["gpt-4o-2024-08-06","gpt-4o-mini-2024-07-18"];
  for(const model of models){
    const imageParts = files.map(f=>({ type:"input_image", image_url: f.url }));
    const payload = {
      model, temperature: 0,
      response_format: { type:"json_schema", json_schema:{ name:"MedicalCaseReport", strict:true, schema: REPORT_SCHEMA } },
      instructions: system,
      input: [{ role:"user", content:[
        { type:"input_text", text: "نص الوثيقة بعد إزالة PHI:\n"+(sanitizedDocText || '—') },
        { type:"input_text", text: "حلّل النص + الصور. أعد JSON بالعربية فقط وفق المخطط." },
        ...imageParts
      ]}]
    };
    const res = await fetch("https://api.openai.com/v1/responses", {
      method:"POST", headers:{ "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" }, body: JSON.stringify(payload)
    });
    const parsed = fromOpenAI(await res.json());
    if(parsed?.obj) return parsed;
  }
  return { obj:null, raw:'' };
}
async function callGeminiStructured({ system, sanitizedDocText, files }){
  const parts=[{ text: system }]; if(sanitizedDocText) parts.push({ text:"نص الوثيقة بعد إزالة PHI:\n"+sanitizedDocText });
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

    // التحليل
    if (req.method === 'POST' && action === 'analyze') {
      const { obj } = await readBody(req);
      const { files=[], docText='', language='ar', model='both', specialty='', context='' } = obj || {};
      if(!Array.isArray(files) || files.length===0){ const e=new Error('لا توجد ملفات للتحليل'); e.status=400; throw e; }

      // domain + refs
      const domain = detectDomain(docText, specialty);
      const refBank = BANKS[domain] || BANKS.general;
      const refBankText = toRefBankText(refBank);

      // parse + sanitize
      const pa = parseUCAF(docText||'');
      const sanitizedDocText = redactTextPHI(docText||'');
      const system = buildSystem({ language, specialty, context, refBankText, domain });

      // heuristics
      let HX = { issues:[], recs:[], refs:new Set(), red:[], contradictions:[], should:[] };
      if(domain==='derm') HX = heurDERM(sanitizedDocText, pa);
      else if(domain==='hand') HX = heurHAND(sanitizedDocText, pa);
      else if(domain==='ent') HX = heurENT(sanitizedDocText, pa);
      else if(domain==='htn') HX = heurHTN(sanitizedDocText, pa);

      // model calls
      let openaiObj=null, openaiRaw='', geminiObj=null;
      if (model==='both' || model==='openai') { const {obj:o, raw} = await callOpenAIStructured({ system, sanitizedDocText, files }); openaiObj=o; openaiRaw=raw; }
      if (model==='both' || model==='gemini') geminiObj = await callGeminiStructured({ system, sanitizedDocText, files });

      // merge
      let mergedObj = mergeObjects(openaiObj, geminiObj) || openaiObj || geminiObj || {
        patient_summary:"", key_findings:[], differential_diagnoses:[], severity_red_flags:[],
        physician_actions:{ vitals: pa.vitals, chief_complaint: pa.chief_complaint, significant_signs: pa.significant_signs, diagnoses: pa.diagnoses, orders: pa.orders, meds: pa.meds },
        contradictions:[], procedural_issues:[], missed_opportunities:[], revenue_quality_opportunities:[], should_have_been_done:[], suggested_next_steps:[],
        patient_safety_note:"هذا المحتوى تعليمي ويُراجع من طبيب مرخّص.", references:[]
      };

      // ensure physician_actions filled
      mergedObj.physician_actions = mergedObj.physician_actions || {};
      mergedObj.physician_actions.vitals = mergedObj.physician_actions.vitals || pa.vitals || [];
      mergedObj.physician_actions.chief_complaint = mergedObj.physician_actions.chief_complaint || pa.chief_complaint || '';
      mergedObj.physician_actions.significant_signs = mergedObj.physician_actions.significant_signs || pa.significant_signs || [];
      if(!Array.isArray(mergedObj.physician_actions.diagnoses) || !mergedObj.physician_actions.diagnoses.length){ mergedObj.physician_actions.diagnoses = pa.diagnoses || []; }
      if(!Array.isArray(mergedObj.physician_actions.orders) || !mergedObj.physician_actions.orders.length){ mergedObj.physician_actions.orders = pa.orders || []; }
      if(!Array.isArray(mergedObj.physician_actions.meds) || !mergedObj.physician_actions.meds.length){ mergedObj.physician_actions.meds = pa.meds || []; }

      // inject heuristics
      mergedObj.contradictions = Array.from(new Map([...(mergedObj.contradictions||[]), ...HX.contradictions].map(x=>[JSON.stringify(x),x])).values());
      mergedObj.procedural_issues = [...(mergedObj.procedural_issues||[]), ...(HX.issues||[])];
      mergedObj.revenue_quality_opportunities = [...(mergedObj.revenue_quality_opportunities||[]), ...(HX.recs||[])];
      mergedObj.should_have_been_done = [...(mergedObj.should_have_been_done||[]), ...(HX.should||[])];
      if (Array.isArray(HX.red) && HX.red.length){
        mergedObj.severity_red_flags = Array.from(new Set([...(mergedObj.severity_red_flags||[]), ...HX.red]));
      }

      // references
      const autoRefs = ALL_BANKS.filter(r => (HX.refs||new Set()).has(r.title));
      const refSet = new Map([...(mergedObj.references||[]).map(r=>[r.link||r.title,r]), ...autoRefs.map(r=>[r.link,r]), ...refBank.map(r=>[r.link,r])]);
      mergedObj.references = Array.from(refSet.values());

      // redact + normalize
      mergedObj = deepRedact(mergedObj);
      if (language === 'ar' && needsArabic(JSON.stringify(mergedObj))) mergedObj = await arabicNormalize(mergedObj, REPORT_SCHEMA);

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
