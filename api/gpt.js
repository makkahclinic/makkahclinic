// /api/gpt.js — Unified Steel Edition (Structured Extract → Structured Assess → HTML build)
// Env: set GEMINI_API_KEY
const MAX_INLINE_REQUEST_MB = 19.0;
const RETRY_STATUS = new Set([429,500,502,503,504]);
const DEFAULT_TIMEOUT_MS = 60_000;

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-1.5-pro-latest';

const DRUG_ALIAS = [
  // [pattern (lowercase, spaces ignored), canonical name]
  ['amlopine','Amlodipine'],
  ['amlo.?pine','Amlodipine'],
  ['duodart','Dutasteride + Tamsulosin'],
  ['rozavi|rosavi|rosuv[a|o]','Rosuvastatin'],
  ['co[-\\s]?tabur[ao]n|co.?tareg|valsartan.?hct','Valsartan + Hydrochlorothiazide'],
  ['triplex|triplixam','Perindopril/Indapamide/Amlodipine'],
  ['formet\\s*xr|format\\s*xr|metformin\\s*(xr|sr)|glucophage\\s*(xr|sr)','Metformin XR'],
  ['dramicron\\s*tr|diamicron\\s*(mr|xr)|gliclazide\\s*(mr|xr)','Gliclazide MR'],
  ['pantomax|pantoprazol?e','Pantoprazole'],
  ['adol|paracetamol|acetaminophen','Paracetamol'],
  ['lancet','Lancets (Diabetes Supply)'],
  ['e[-\\s]?core\\s*(strip|study)?','Glucose Test Strips'],
  ['pika[-\\s]?ur','Urinary Alkalinizer (Pika-ur/Equiv.)'],
  ['suden\\s*cream|sudocrem','Topical Barrier Cream']
];

function normalizeDrugName(raw=''){
  const s = String(raw).toLowerCase().replace(/\s+/g,' ').trim();
  for(const [pat,canon] of DRUG_ALIAS){
    if(new RegExp(pat).test(s)) return canon;
  }
  // Title Case fallback
  return raw ? raw.replace(/\w\S*/g,t=>t[0].toUpperCase()+t.slice(1)) : raw;
}

const extractSchema = {
  type:'object',
  properties:{
    patient:{ type:'object', properties:{
      age:{ type:['integer','null'] }, sex:{ type:'string', enum:['male','female','unknown'] }
    }},
    meds:{ type:'array', items:{ type:'object', properties:{
      rawName:{ type:'string' },
      normalizedName:{ type:'string' },
      strengthText:{ type:['string','null'] },
      doseText:{ type:['string','null'] },         // e.g., "10 mg 1×90", "30 mg bid × 90"
      frequency:{ type:['string','null'] },        // od, bid, tid, qid, once daily, ...
      perDoseAmount:{ type:['string','null'] },
      perDoseUnit:{ type:['string','null'] },
      durationDays:{ type:['integer','null'] },
      route:{ type:['string','null'] }
    }, required:['rawName']}},
    notes:{ type:['string','null'] }
  },
  required:['meds']
};

const assessSchema = {
  type:'object',
  properties:{
    rows:{ type:'array', items:{ type:'object', properties:{
      drug:{ type:'string' },                        // canonical
      prescribedDose:{ type:'string' },              // as read
      suggestedDose:{ type:'string' },               // corrected concise text
      classification:{ type:'string' },              // e.g., "خافض ضغط"
      medicalPurpose:{ type:'string' },              // الغرض الطبي
      interactions:{ type:'string' },                // أهم التداخلات
      riskPercent:{ type:'integer', minimum:0, maximum:100 },
      insuranceDecision:{ type:'string' }            // النص النهائي (❌/⚠️/✅ + التخصص)
    }, required:['drug','prescribedDose','suggestedDose','classification','medicalPurpose','interactions','riskPercent','insuranceDecision']}},
    summary:{ type:'string' },
    deepAnalysis:{ type:'string' },
    opportunities:{ type:'array', items:{ type:'object', properties:{
      label:{ type:'string' }, reason:{ type:'string' }, sourceName:{ type:'string' }, url:{ type:'string' }
    }, required:['label','reason','sourceName','url']}},
    conclusion:{ type:'string' }
  },
  required:['rows']
};

const systemExtract =
`أنت مساعد طبي يقرأ صور الوصفات الطبية بخط اليد ويستخرج الأدوية بدقة.
- أخرج JSON فقط (لا نص حر) وفق المخطط المعطى.
- فسّر علامات مثل: od=مرة يوميًا، bid=مرتين، tid=ثلاث، qid=أربع.
- حلّل الأنماط: "1x90", "1 × 90", "١×٩٠" كمدة 90 يوم.
- لا تترجم الأسماء؛ اكتب الاسم كما هو في rawName، ثم normalizedName حاول تصحيحه للدواء الأقرب (مثال: Amlopine ⇒ Amlodipine).
- لا تفترض أدوية غير موجودة.`;

const systemAssess = 
`أنت "كبير مدققي المطالبات الطبية والتأمين". قدّم تقييمًا منظمًا بصيغة JSON فقط.
القواعد الإلزامية لكل دواء:
- suggestedDose: صِغ الجرعة الصحيحة باختصار (مثال: "Amlodipine 10 mg od × 30d").
- classification: فئة علاجية مختصرة.
- medicalPurpose: الغرض الطبي الموازي للتشخيص.
- interactions: اذكر أهم تداخل واحد أو اثنين فقط عند وجوده.
- riskPercent: (0–100). ≥70 high، 40–69 medium، <40 low.
- insuranceDecision (نص كامل بأحد الصيغ الثلاث ويشمل التخصص داخل النص):
  ❌ قابل للرفض — السبب: […] — وللقبول يلزم: […] — **التخصص المُراجع: […]**
  ⚠️ قابل للمراجعة — السبب: […] — لتحسين فرص القبول: […] — **التخصص المُراجع: […]**
  ✅ مقبول — **التخصص المُراجع: […]**
اعتبارات السلامة:
- فحص الازدواجية (مثل Amlodipine + Valsartan/HCT؛ أو Metformin XR + Gliclazide MR…).
- أخطاء الجرعات (مثال Pantoprazole غالبًا od؛ المسكنات الأفيونية لمدد طويلة غير مناسبة).
- مواءمة CKD (eGFR) والحمل والعمر.
"opportunities": روابط أدلة موثوقة (ADA, KDIGO, ACR, USPSTF…) مع سبب سريري مختصر.`;

// ========= Helpers =========
const _enc = new TextEncoder();
const byteLen = (s)=> _enc.encode(s||'').length;

function estimateInlineRequestMB(parts){
  let bytes=0;
  for(const p of parts){
    if(p.text) bytes += byteLen(p.text);
    if(p.inline_data?.data) bytes += Math.floor((p.inline_data.data.length*3)/4);
  }
  return bytes/(1024*1024);
}

function stripStyles(html){ try{ return String(html||'').replace(/<style[\s\S]*?<\/style>/gi,''); }catch{ return html; } }

function classifyRisk(v){ if(v>=70) return 'risk-high'; if(v>=40) return 'risk-medium'; return 'risk-low'; }

function buildHTML(report, uiLang='ar'){
  const rows = report.rows || [];
  const h3 = (uiLang==='en'?'Medical & Insurance Audit Report':'تقرير التدقيق الطبي والمطالبات التأمينية');
  const h4a= (uiLang==='en'?'Case Summary':'ملخص الحالة');
  const h4b= (uiLang==='en'?'Deep Clinical Analysis':'التحليل السريري العميق');
  const h4c= (uiLang==='en'?'Drugs & Procedures Table':'جدول الأدوية والإجراءات');
  const h4d= (uiLang==='en'?'Opportunities to Improve Care (with evidence)':'فرص تحسين الخدمة (مدعومة بالأدلة)');
  const concl= (uiLang==='en'?'Conclusion: This report is preliminary and does not replace specialist review.':'الخاتمة: هذا التقرير تحليل مبدئي ولا يغني عن مراجعة متخصص.');

  let html = '';
  html += `<h3>${h3}</h3>`;
  html += `<h4>${h4a}</h4><p>${escapeHTML(report.summary||'')}</p>`;
  html += `<h4>${h4b}</h4><p>${escapeHTML(report.deepAnalysis||'')}</p>`;
  html += `<h4>${h4c}</h4>`;
  html += `<table><thead><tr>
<th>${uiLang==='en'?'Drug/Procedure':'الدواء/الإجراء'}</th>
<th>${uiLang==='en'?'Prescribed dose':'الجرعة الموصوفة'}</th>
<th>${uiLang==='en'?'Suggested correct dose':'الجرعة الصحيحة المقترحة'}</th>
<th>${uiLang==='en'?'Class':'التصنيف'}</th>
<th>${uiLang==='en'?'Purpose':'الغرض الطبي'}</th>
<th>${uiLang==='en'?'Interactions':'التداخلات'}</th>
<th>${uiLang==='en'?'Risk (%)':'درجة الخطورة (%)'}</th>
<th>${uiLang==='en'?'Insurance decision':'قرار التأمين'}</th>
</tr></thead><tbody>`;

  for(const r of rows){
    const risk = Number(r.riskPercent ?? 0);
    const klass = classifyRisk(risk);
    html += `<tr>
<td>${escapeHTML(r.drug||'—')}</td>
<td>${escapeHTML(r.prescribedDose||'—')}</td>
<td>${escapeHTML(r.suggestedDose||'—')}</td>
<td>${escapeHTML(r.classification||'—')}</td>
<td>${escapeHTML(r.medicalPurpose||'—')}</td>
<td>${escapeHTML(r.interactions||'—')}</td>
<td class="${klass}">${isFinite(risk)?risk+'%':'—'}</td>
<td>${escapeHTML(r.insuranceDecision||'—')}</td>
</tr>`;
  }
  html += `</tbody></table>`;

  if(Array.isArray(report.opportunities) && report.opportunities.length){
    html += `<ul>`;
    for(const o of report.opportunities){
      const line = `**${o.label}** — ${o.reason} — <a href="${escapeAttr(o.url)}" target="_blank" rel="noopener">${escapeHTML(o.sourceName||o.url)}</a>`;
      html += `<li>${line}</li>`;
    }
    html += `</ul>`;
  }
  html += `<p><strong>${uiLang==='en'?'Conclusion':'الخاتمة'}:</strong> ${escapeHTML(report.conclusion||concl)}</p>`;
  return html;
}

function escapeHTML(s=''){ return String(s).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
function escapeAttr(s=''){ return String(s).replace(/"/g,'&quot;'); }

async function fetchWithRetry(url,options,{retries=2,timeoutMs=DEFAULT_TIMEOUT_MS}={}){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{...options, signal:controller.signal});
    if(!res.ok && retries>0 && RETRY_STATUS.has(res.status)){
      await new Promise(r=>setTimeout(r,(3-retries)*800));
      return fetchWithRetry(url,options,{retries:retries-1,timeoutMs});
    }
    return res;
  }finally{ clearTimeout(timer); }
}

async function callGeminiJSON(apiKey, parts, responseSchema){
  const url = `${API_BASE}/${MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents:[{ role:'user', parts }],
    generationConfig:{
      temperature:0.2, topP:0.95, topK:40,
      responseMimeType:'application/json',
      responseSchema
    }
  };
  const res = await fetchWithRetry(url,{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
  const text = await res.text();
  if(!res.ok){ throw new Error(`Gemini ${res.status}: ${text.slice(0,800)}`); }
  let json; try{ json = JSON.parse(text); } catch{ throw new Error('Non-JSON from Gemini'); }
  const raw = json?.candidates?.[0]?.content?.parts?.find(p=>typeof p.text==='string')?.text;
  if(!raw) throw new Error('Empty candidate');
  try{ return JSON.parse(raw); } catch{ throw new Error('Failed to parse model JSON'); }
}

function toPartsForExtraction(body){
  const tline =
    body.uiLang==='en' ? 'Write outputs in English when free text is needed.'
    : body.uiLang==='both' ? 'If text is needed, include Arabic + English headings.' : 'اكتب المخرجات بالعربية عند الحاجة.';
  const intro = `Context:
${tline}
Patient age: ${body.age ?? 'NA'}, sex: ${body.gender ?? 'NA'}.
Free text notes: ${body.notes ?? body.diagnosis ?? body.labResults ?? 'NA'}.`;

  const parts=[{text: systemExtract}, {text: intro}];
  const files = Array.isArray(body.files)? body.files: [];
  for(const f of files){
    if(!f || typeof f.base64!=='string') continue;
    let mime = f.type || ((f.name||'').toLowerCase().endsWith('.pdf') ? 'application/pdf':'image/jpeg');
    parts.push({ inline_data: { mimeType: mime, data: f.base64 }});
  }
  return parts;
}

function toPartsForAssess(extracted, body){
  // نمرّر قائمة الأدوية كـ JSON + بعض بيانات الحالة
  const patient = {
    age: body.age, gender: body.gender, isSmoker: body.isSmoker, eGFR: body.eGFR ?? undefined,
    dx: body.diagnosis, labs: body.labResults
  };
  const normMeds = (extracted.meds||[]).map(m=>{
    // تطبيع محلي للاسم والمدة من النص الحر
    const canon = normalizeDrugName(m.normalizedName || m.rawName);
    const dur = m.durationDays ?? sniffDurationDays(m.doseText);
    return {...m, normalizedName: canon, durationDays: dur};
  });
  const tline =
    body.uiLang==='en' ? 'Return all strings in Arabic where appropriate for headings, but content may be Arabic.' : '';
  const prompt =
`Inputs (JSON):
patient=${JSON.stringify(patient, null, 2)}
meds=${JSON.stringify(normMeds, null, 2)}

Rules:
- Use concise Arabic terminology in the output JSON values unless the drug name is English.
- Focus on dose correctness, duplication, renal/hepatic fit, and duration (90d for acute is risky).`;
  return [{text: systemAssess}, {text: tline}, {text: prompt}];
}

function sniffDurationDays(txt=''){
  const s=String(txt||'').toLowerCase();
  // 1x90, 1 × 90, ١×٩٠, "لمدة 90 يوم"
  const m1 = s.match(/x\s*([0-9]{1,3})\s*(?:d|day|days)?/i);
  const m2 = s.match(/لمدة\s*([0-9]{1,3})\s*(?:يوم|يوماً|يومًا|days?)/);
  const m3 = s.match(/(?:\u00D7|×)\s*([0-9]{1,3})/); // علامة الضرب
  const m = m2||m1||m3;
  const n = m ? parseInt(m[1],10) : null;
  return (Number.isFinite(n) ? n : null);
}

function applySafetyPost(html){
  try{
    html = String(html||'');
    // ضمان %
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi, (_m,o,n,_s,c)=> `${o}${n}%${c}`);
    // إضافة risk-*
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_m,open,numStr,close)=>{
        const v=parseInt(numStr,10); const klass = v>=70?'risk-high':(v>=40?'risk-medium':'risk-low');
        return open.replace('<td', `<td class="${klass}"`) + `${numStr}%` + close;
      });
    const i=html.indexOf('<h3'); if(i>0) html = html.slice(i);
    return stripStyles(html);
  }catch{ return html; }
}

// ========= API Handler =========
export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'Method Not Allowed'});

  try{
    const apiKey = process.env.GEMINI_API_KEY;
    if(!apiKey) throw new Error('GEMINI_API_KEY is not set.');
    const body = req.body || {};

    // === Stage 1: Extraction (structured) ===
    const extractParts = toPartsForExtraction(body);
    const estMB = estimateInlineRequestMB(extractParts);
    if(estMB > MAX_INLINE_REQUEST_MB){
      return res.status(413).json({ error:'الطلب كبير جدًا', detail:`الحجم ~${estMB.toFixed(2)}MB > ${MAX_INLINE_REQUEST_MB}MB. قلل عدد/حجم الملفات.` });
    }
    const extracted = await callGeminiJSON(apiKey, extractParts, extractSchema);

    // === Stage 2: Assessment (structured) ===
    const assessParts = toPartsForAssess(extracted, body);
    const assessed = await callGeminiJSON(apiKey, assessParts, assessSchema);

    // === Build HTML locally (stable 8 columns) ===
    const uiLang = body.uiLang==='en' ? 'en' : 'ar'; // bilingual يُدار في الواجهة
    const html = buildHTML(assessed, uiLang);
    const final = applySafetyPost(html);
    return res.status(200).json({ htmlReport: final, extracted, assessed });

  }catch(err){
    console.error('API Error:', err);
    return res.status(500).json({ error:'حدث خطأ في الخادم أثناء تحليل الحالة', detail: err.message });
  }
}
