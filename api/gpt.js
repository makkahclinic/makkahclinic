// api/gpt.js
export const runtime = 'nodejs';          // تأكد أن الوظيفة ليست Edge (تجنّب unsupported modules)
export const maxDuration = 30;            // وقت كافٍ لاستخراج النصوص والاتصال بالنماذج

/**
 * بيئة التشغيل: ضَع المتغيرات التالية في إعدادات Vercel:
 * - OPENAI_API_KEY
 * - GEMINI_API_KEY
 * يمكن أيضًا ضبط:
 * - OPENAI_MODEL (افتراضي: gpt-4o-2024-08-06)
 * - GEMINI_MODEL (افتراضي: gemini-1.5-pro)
 */

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-2024-08-06';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-pro';

const STRICT_JSON_SCHEMA = {
  executive_summary: "",                 // ملخص تنفيذي واضح من 4–8 أسطر
  patient_summary: "",
  physician_actions: {
    chief_complaint: "",
    vitals: [],
    significant_signs: [],
    diagnoses: [],
    orders: [],
    meds: [],
    icd10_codes: []
  },
  key_findings: [],
  contradictions: [{ item:"", evidence:"", impact:"" }],
  differential_diagnoses: [{ dx:"", why:"" }],
  severity_red_flags: [],
  procedural_issues: [{ issue:"", impact:"", evidence:"" }],
  missed_opportunities: [{ what:"", why_it_matters:"" }],
  revenue_quality_opportunities: [{ opportunity:"", category:"documentation|diagnostics|procedure|coding|follow-up", rationale:"", risk_note:"" }],
  should_have_been_done: [{ step:"", reason:"" }],
  suggested_next_steps: [{ action:"", justification:"" }],
  icd_suggestions: [{ code:"", label:"", why:"" }],
  cpt_suggestions: [{ code:"", label:"", why:"" }],
  references: [{ title:"", org:"", link:"" }],
  patient_safety_note: ""
};

function buildInstruction({ language='ar', specialty='عام', insuranceContext='', texts=[] }) {
  const langLabel = language === 'en' ? 'English' : 'العربية';
  const spec = specialty?.trim() ? specialty.trim() : 'عام';
  const ctx = insuranceContext?.trim() ? `سياق/وصف تأميني: ${insuranceContext}` : '—';
  const ocr = texts?.length ? `\n\n[نص مُستخرج من PDF]:\n${texts.join('\n\n').slice(0, 20000)}` : '';

  return `
أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة، لا تُقدّم تشخيصًا نهائيًا ولا توصيات علاجية دون مراجعة بشرية.
اللغة: ${langLabel}
التخصص: ${spec}
${ctx}

قواعد:
1) إزالة/تجنّب أي مُعرّفات شخصية (PHI) وفق "Safe Harbor" في HIPAA.
2) أعد جوابًا بصيغة JSON حصراً بالمفاتيح التالية (بالعربية إن كانت لغة التقرير عربية). الحفاظ على نفس المفاتيح كما هي:
${JSON.stringify(STRICT_JSON_SCHEMA)}
3) استند إلى إرشادات عالمية (NICE/WHO/CDC/IDSA) عند الاقتضاء، وأدرج مرجعًا مختصرًا مع رابط حيث أمكن.
4) لا تستخدم قوالب إنشائية عامة؛ املأ الحقول بمحتوى ملموس من الوثيقة، واشرح التعارضات بوضوح (مثال: "لا توجد صدمة" مقابل تشخيص "كدمة").
5) لا تستخدم أسوار \`\`\` حول JSON. أعد JSON صالحًا فقط، بلا نص زائد.

المدخلات (صور+OCR) أدناه؛ ركّز على تلخيص ما فعله الطبيب، المخاطر/الرايات الحمراء، التناقضات، الأخطاء الإجرائية/الترميز، وما كان ينبغي عمله لتعظيم القبول التأميني وتحسين الجودة؛ لا تُنشىء ادعاءات غير مسنودة.
${ocr}
`.trim();
}

function stripCodeFenceToJson(text){
  if (typeof text !== 'string') return null;
  const m = text.match(/\{[\s\S]*\}$/);
  try { return JSON.parse(m ? m[0] : text); } catch { return null; }
}

function redactPHI(s) {
  if (!s) return s;
  // تنقيح بسيط للأسماء/الهويات والأرقام الطويلة (تحسين الجودة فقط، مراجعة بشرية لازمة)
  return s
   .replace(/\b([A-Z]|\p{L})[\p{L}\.'\-]{1,}\s+[A-Z\p{L}\.'\-]{1,}\b/giu, '[REDACTED]')
   .replace(/\b\d{9,}\b/g, '[REDACTED]');
}

function normalizeReport(rep){
  if (!rep || typeof rep !== 'object') return null;
  // تأكد من وجود كل المفاتيح الأساسية
  const base = JSON.parse(JSON.stringify(STRICT_JSON_SCHEMA));
  return Object.assign(base, rep);
}

function ruleBasedChecks({ texts=[] }) {
  const blob = (texts||[]).join(' ').toUpperCase();
  const contradictions = [];
  // مثال: "NO TRAUMA" + تشخيص كدمة ساعِد (S50.1)
  if (blob.includes('NO TRAUMA') && (blob.includes('S50.1') || blob.includes('CONTUSION'))) {
    contradictions.push({
      item: 'S50.1 (Contusion) vs "No trauma"',
      evidence: 'نص النموذج يُصرّح بلا صدمة بينما الرمز S50.1 يوحي بكدمة/إصابة.',
      impact: 'احتمال رفض المطالبة لعدم الاتساق.'
    });
  }
  return { contradictions };
}

function mergeReports(gpt, gemini, hints){
  const keys = Object.keys(STRICT_JSON_SCHEMA);
  const out = {};
  for (const k of keys){
    const gv = gpt?.[k];
    const mv = gemini?.[k];
    out[k] = gv ?? mv ?? STRICT_JSON_SCHEMA[k];
  }
  // دمج يدوي للتناقضات المستنتجة
  const inferred = ruleBasedChecks(hints);
  if (inferred.contradictions?.length){
    const list = Array.isArray(out.contradictions) ? out.contradictions : [];
    out.contradictions = [...list, ...inferred.contradictions];
  }
  // إضافة ملاحظة سلامة افتراضية إن لم تُذكر
  if (!out.patient_safety_note) {
    out.patient_safety_note = 'هذا المحتوى لأغراض تحسين الجودة والتدقيق التأميني فقط ويُراجع من طبيب مرخص قبل أي قرار سريري.';
  }
  // ملخص تنفيذي مبسط إذا غاب
  if (!out.executive_summary) {
    out.executive_summary = 'ملخص تلقائي: تمت معالجة المستند واستخلاص أهم النتائج، مع إبراز التعارضات المحتملة وفرص تحسين التوثيق والدخل.'; 
  }
  return out;
}

function toOpenAIImageParts(images=[]) {
  const parts = [];
  for (const img of images){
    if (!img?.dataUrl) continue;
    parts.push({ type: 'image_url', image_url: { url: img.dataUrl, detail: 'low' } });
  }
  return parts;
}

function toGeminiParts(instruction, images=[], texts=[]) {
  const parts = [{ text: instruction }];
  for (const img of images){
    if (!img?.dataUrl) continue;
    const base64 = img.dataUrl.split(',')[1] || '';
    const mime = img.contentType || 'image/png';
    parts.push({ inlineData: { mimeType: mime, data: base64 } });
  }
  if (texts?.length) {
    parts.push({ text: `OCR:\n${texts.join('\n').slice(0, 20000)}` });
  }
  return parts;
}

async function callOpenAI(apiKey, instruction, images=[], texts=[]) {
  const content = [{ type:'text', text: instruction }];
  if (texts?.length) content.push({ type:'text', text: `OCR:\n${texts.join('\n').slice(0, 20000)}` });
  content.push(...toOpenAIImageParts(images));

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: 'You are a meticulous clinical quality & revenue-improvement assistant. Return STRICT JSON only.' },
      { role: 'user', content }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || 'OpenAI error');
  const raw = j?.choices?.[0]?.message?.content || '';
  const parsed = stripCodeFenceToJson(raw);
  return normalizeReport(parsed);
}

async function callGemini(apiKey, instruction, images=[], texts=[]) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role:'user', parts: toGeminiParts(instruction, images, texts) }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json' }
  };
  const r = await fetch(url, {
    method:'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || 'Gemini error');
  const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text || j?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || '';
  const parsed = stripCodeFenceToJson(txt);
  return normalizeReport(parsed);
}

export default async function handler(req, res) {
  try{
    if (req.method !== 'POST') {
      res.status(405).json({ error:'Only POST' }); return;
    }
    const body = await readJson(req);
    const {
      language='ar',
      model='both',
      specialty='عام',
      insuranceContext='',
      images=[],
      texts=[]
    } = body || {};

    // تنقيح بسيط لـ PHI في النصوص قبل إرسالها للنماذج (تحسين الخصوصية)
    const safeTexts = (texts||[]).map(redactPHI);

    const instruction = buildInstruction({ language, specialty, insuranceContext, texts: safeTexts });

    const wantGPT = model === 'both' || model === 'gpt';
    const wantGem = model === 'both' || model === 'gemini';

    const tasks = [];
    if (wantGPT)  tasks.push(callOpenAI(process.env.OPENAI_API_KEY, instruction, images, safeTexts).then(r=>({ which:'gpt', r })).catch(e=>({ which:'gpt', err:e })));
    if (wantGem)  tasks.push(callGemini(process.env.GEMINI_API_KEY, instruction, images, safeTexts).then(r=>({ which:'gemini', r })).catch(e=>({ which:'gemini', err:e })));

    const results = await Promise.all(tasks);
    let gpt=null, gemini=null, errors=[];
    for (const x of results){
      if (x.err) { errors.push(`${x.which}: ${x.err.message}`); }
      else if (x.which==='gpt') gpt = x.r;
      else if (x.which==='gemini') gemini = x.r;
    }

    const merged = mergeReports(gpt, gemini, { texts: safeTexts });

    res.status(200).json({
      ok:true,
      model,
      merged,
      gpt,
      gemini,
      errors: errors.length? errors: undefined
    });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
}

// قراءة JSON من الطلب (Node.js runtime)
async function readJson(req){
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const str = Buffer.concat(chunks).toString('utf8');
  return str ? JSON.parse(str) : {};
}
