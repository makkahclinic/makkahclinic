// api/gpt.js
// ================================
// Edge Function — JSON in / JSON out
// يتكلم العربية/الإنجليزية وينتج تقريرًا منظّمًا مع مراجع.
// المتغيرات المطلوبة: OPENAI_API_KEY, GEMINI_API_KEY (اختياري أيهما متوفر)

export const config = { runtime: 'edge' };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || '';

/** أدوات صغيرة **/
const enc = new TextEncoder();
function jsonResponse(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: {'content-type':'application/json; charset=utf-8'}
  });
}
function pick(v, def){ return (v===undefined||v===null)?def:v; }
function safe(obj){ try{return JSON.stringify(obj).slice(0,1200)}catch{ return '' } }

function extractJSON(text){
  if(!text) return null;
  // جرّب التقاط { ... } الأول
  const match = text.match(/\{[\s\S]*\}$/);
  try { return JSON.parse(match ? match[0] : text); } catch {
    // جرب إزالة الأسلاك
    const codeMatch = text.match(/```json([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/i);
    if(codeMatch) { try{ return JSON.parse(codeMatch[1]); }catch{} }
    return null;
  }
}

// اندماج عناصر متشابهة بالنص
function mergeArrays(a=[], b=[], keyFields=['dx','issue','what','opportunity','action','step','item']){
  const out = [];
  const seen = new Set();
  function sig(x){
    for(const k of keyFields){
      if(x && x[k]) return `${k}:${String(x[k]).trim().toLowerCase()}`;
    }
    return JSON.stringify(x).slice(0,120);
  }
  for(const it of [...a,...b]){
    const s = sig(it);
    if(!seen.has(s)){ out.push(it); seen.add(s); }
  }
  return out;
}

// ======== بناء موجه التحليل (System Prompt) =========
function buildSystemPrompt(lang='ar'){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  return L(
`أنت "مدقق سريري تأميني" رفيع المستوى. مهمتك:
- استخراج حقائق الحالة من المستندات (الشكوى، العلامات الحيوية، العلامات المهمة، التشخيصات، الأوامر/التحاليل، الأدوية، الأكواد).
- كشف التناقضات والأخطاء (مثال: كود إصابة/كدمة مع توثيق "لا توجد صدمة"، أو مضاد حيوي واسع لحالة فيروسية بلا مبرر).
- تقديم "ما كان يجب فعله" و"فرص تحسين الجودة/الدخل" المستندة لإرشادات عالمية (NICE, WHO, CDC, AAD, IDSA…)، مع روابط مختصرة موثوقة.
- إزالة أي مُعرّفات شخصية (PHI) والاقتصار على المحتوى السريري.

أعد JSON فقط بالمفاتيح التالية (بدون أي نص خارج JSON):
{
  "patient_summary":"",
  "key_findings":[],
  "physician_actions":{
    "chief_complaint":"",
    "diagnoses":[],
    "icd10_codes":[],
    "vitals":[],
    "significant_signs":[],
    "orders":[],
    "meds":[]
  },
  "contradictions":[{"item":"","evidence":"","impact":""}],
  "procedural_issues":[{"issue":"","impact":"","evidence":""}],
  "missed_opportunities":[{"what":"","why_it_matters":""}],
  "revenue_quality_opportunities":[{"opportunity":"","category":"documentation|diagnostics|procedure|follow-up|coding","rationale":"","risk_note":""}],
  "differential_diagnoses":[{"dx":"","why":""}],
  "severity_red_flags":[],
  "should_have_been_done":[{"step":"","reason":""}],
  "suggested_next_steps":[{"action":"","justification":""}],
  "icd_suggestions":[{"code":"","label":"","why":""}],
  "cpt_suggestions":[{"code":"","label":"","why":""}],
  "references":[{"title":"","org":"","link":""}],
  "executive_summary":""
}
قواعد مهمة:
- استند إلى الدليل: NG84 (التهاب الحلق)، NG120 (السعال الحاد)، NG59 (ألم الظهر)، NG118 (مغص كلوي/حصيات)، NG136 (ارتفاع الضغط)، NG190 وCKS/AAD (الأكزيما)، وأضف روابط لكل توصية رئيسية.
- إن وُجد "NO TRAUMA" مع كود S50.1 (كدمة الساعد) فاذكر التناقض صراحةً وتأثيره التأميني.
- لا تُكرر عناصر متماثلة لفظيًا. إن تعذر الاستدلال اترك الحقل فارغًا [].
- اكتب بالعربية الفصحى المختصرة الواضحة.
`,
`You are a Senior Clinical & Insurance Auditor. Tasks:
- Extract facts (chief complaint, vitals, key signs, diagnoses, orders/tests, meds, codes).
- Flag contradictions (e.g., contusion code with 'no trauma'), coding/documentation errors, and antimicrobial stewardship issues.
- Provide “Should have been done” and “Revenue/Quality opportunities” backed by NICE/WHO/CDC/AAD/IDSA with links.
- Remove PHI. Output JSON ONLY with the exact schema shown (no extra text). Use concise, professional English.

Use: NG84 (sore throat), NG120 (acute cough), NG59 (low back pain), NG118 (renal colic/stones), NG136 (hypertension), NG190 + CKS/AAD (eczema).`
);
}

// ======== بناء رسالة المستخدم (User Content) =========
function buildUserMessage({lang, specialty, context, text, images, fileNames=[]}){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  const meta = L(
`اللغة: العربية
التخصص (اختياري): ${specialty||'عام'}
سياق التأمين/الوصف (اختياري): ${context||'—'}

## حقائق الحالة المستخرجة من المستند (نص PDF/النماذج):
${text||'—'}

## الصور (لقطات PDF/صور سريرية):
- عدد الصور: ${images?.length||0}
- الملفات: ${fileNames.join(', ') || '—'}

قم بتحليل الصور والنص معًا. أعد JSON حصراً.`,
`Language: English
Specialty (optional): ${specialty||'General'}
Insurance context: ${context||'-'}

## Case Facts (from PDF text/forms):
${text||'-'}

## Images (PDF renders/clinical images):
- count: ${images?.length||0}
- files: ${fileNames.join(', ') || '-'}

Analyze both text and images. Return JSON only.`
);
  return meta;
}

// ======== استدعاء GPT‑4o =========
async function callOpenAI({lang, userMsg, images}){
  if(!OPENAI_API_KEY) return { ok:false, raw:'', data:null, note:'OPENAI_API_KEY missing' };
  const content = [{ type:'text', text:userMsg }];
  for(const b64 of (images||[])){
    content.push({ type:'input_image', image_url:`data:image/jpeg;base64,${b64}` });
  }
  const system = buildSystemPrompt(lang);
  const payload = {
    model: "gpt-4o-2024-08-06",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role:"system", content: system },
      { role:"user",   content }
    ]
  };
  const r = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Authorization':`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  const raw = j?.choices?.[0]?.message?.content || JSON.stringify(j);
  return { ok:true, raw, data: extractJSON(raw) };
}

// ======== استدعاء Gemini =========
async function callGemini({lang, userMsg, images}){
  if(!GEMINI_API_KEY) return { ok:false, raw:'', data:null, note:'GEMINI_API_KEY missing' };
  const parts = [{ text: userMsg }];
  for(const b64 of (images||[])){
    parts.push({ inline_data:{ mime_type:'image/jpeg', data:b64 }});
  }
  const system = buildSystemPrompt(lang);
  const payload = {
    contents:[ { role:'user', parts } ],
    system_instruction: { role:'system', parts:[{text:system}] },
    generationConfig: { temperature: 0.2, maxOutputTokens: 1800, responseMimeType: "application/json" }
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${GEMINI_API_KEY}`,{
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
  });
  const j = await r.json();
  const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(j);
  return { ok:true, raw, data: extractJSON(raw) };
}

// ======== دمج التقريرين =========
function mergeReports(a={}, b={}){
  const merged = {
    patient_summary: a.patient_summary || b.patient_summary || '',
    key_findings: mergeArrays(a.key_findings, b.key_findings, ['_txt']).filter(Boolean),
    physician_actions: {
      chief_complaint: a.physician_actions?.chief_complaint || b.physician_actions?.chief_complaint || '',
      diagnoses: mergeArrays(a.physician_actions?.diagnoses, b.physician_actions?.diagnoses, ['_txt']),
      icd10_codes: mergeArrays(a.physician_actions?.icd10_codes, b.physician_actions?.icd10_codes, ['code']),
      vitals: mergeArrays(a.physician_actions?.vitals, b.physician_actions?.vitals, ['_txt']),
      significant_signs: mergeArrays(a.physician_actions?.significant_signs, b.physician_actions?.significant_signs, ['_txt']),
      orders: mergeArrays(a.physician_actions?.orders, b.physician_actions?.orders, ['_txt']),
      meds: mergeArrays(a.physician_actions?.meds, b.physician_actions?.meds, ['_txt'])
    },
    contradictions: mergeArrays(a.contradictions, b.contradictions, ['item']),
    procedural_issues: mergeArrays(a.procedural_issues, b.procedural_issues, ['issue']),
    missed_opportunities: mergeArrays(a.missed_opportunities, b.missed_opportunities, ['what']),
    revenue_quality_opportunities: mergeArrays(a.revenue_quality_opportunities, b.revenue_quality_opportunities, ['opportunity']),
    differential_diagnoses: mergeArrays(a.differential_diagnoses, b.differential_diagnoses, ['dx']),
    severity_red_flags: mergeArrays(a.severity_red_flags, b.severity_red_flags, ['_txt']),
    should_have_been_done: mergeArrays(a.should_have_been_done, b.should_have_been_done, ['step']),
    suggested_next_steps: mergeArrays(a.suggested_next_steps, b.suggested_next_steps, ['action']),
    icd_suggestions: mergeArrays(a.icd_suggestions, b.icd_suggestions, ['code']),
    cpt_suggestions: mergeArrays(a.cpt_suggestions, b.cpt_suggestions, ['code']),
    references: mergeArrays(a.references, b.references, ['link'])
  };

  // ملخص تنفيذي ذكي
  const bullets = [];
  if(merged.contradictions?.length) bullets.push(`تناقضات بارزة: ${merged.contradictions.map(x=>x.item).slice(0,3).join('، ')}`);
  if(merged.revenue_quality_opportunities?.length) bullets.push(`فرص دخل/جودة: ${merged.revenue_quality_opportunities.map(x=>x.opportunity).slice(0,3).join('، ')}`);
  if(merged.suggested_next_steps?.length) bullets.push(`الخطوات القادمة: ${merged.suggested_next_steps.map(x=>x.action).slice(0,3).join('، ')}`);
  merged.executive_summary = [merged.patient_summary, bullets.join(' | ')].filter(Boolean).join(' — ');

  // إضافة ملاحظة سلامة افتراضيًا
  merged.patient_safety_note = "هذا المحتوى مُعَدّ لتحسين الجودة والتدقيق التأميني، ويُراجع من طبيب مرخّص قبل أي قرار سريري.";

  return merged;
}

// ============= نقطة الدخول =============
export default async function handler(req){
  try{
    if(req.method !== 'POST') return jsonResponse({error:'Use POST'},405);
    const body = await req.json();
    const { lang='ar', modelChoice='both', specialty='', context='', images=[], text='', fileNames=[], apiVersion='v1' } = body||{};
    if(!OPENAI_API_KEY && !GEMINI_API_KEY){
      return jsonResponse({ error:"Missing API keys", detail:"Set OPENAI_API_KEY and/or GEMINI_API_KEY in Vercel Environment." }, 500);
    }
    // تحضير الرسالة
    const userMsg = buildUserMessage({lang, specialty, context, text, images, fileNames});

    // استدعاءات
    const wantsGPT = (modelChoice==='both' || modelChoice==='gpt') && OPENAI_API_KEY;
    const wantsGem = (modelChoice==='both' || modelChoice==='gemini') && GEMINI_API_KEY;

    const [gptRes, gemRes] = await Promise.all([
      wantsGPT ? callOpenAI({lang, userMsg, images}) : Promise.resolve({ok:false,raw:'',data:null}),
      wantsGem ? callGemini({lang, userMsg, images}) : Promise.resolve({ok:false,raw:'',data:null})
    ]);

    const a = gptRes.data || {};
    const b = gemRes.data || {};
    const merged = mergeReports(a,b);

    return jsonResponse({
      ok:true,
      version: apiVersion,
      merged,
      gpt: { ok:gptRes.ok, raw: gptRes.raw?.slice(0,120000) },
      gemini: { ok:gemRes.ok, raw: gemRes.raw?.slice(0,120000) }
    }, 200);

  }catch(err){
    return jsonResponse({ ok:false, error:String(err?.message||err) }, 500);
  }
}
