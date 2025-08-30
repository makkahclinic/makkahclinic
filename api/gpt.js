// api/gpt.js
// Node.js Serverless Function (Vercel) — لا تستخدم حزم openai/@google لتفادي مشاكل Edge.
// المرجع: Functions Node.js runtime وقيود Edge. 
// https://vercel.com/docs/functions/runtimes/node-js

export const config = {
  runtime: 'nodejs',     // إجبار تشغيل الدالة على Node.js Runtime (وليس Edge)
  maxDuration: 60
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// نموذج الإخراج القياسي (JSON) كي يكون التقرير منظّمًا وعميقًا
const schemaKeys = {
  patient_summary: "",
  key_findings: [],
  physician_actions: {
    chief_complaint: "",
    diagnoses: [],
    icd10_codes: [],
    vitals: [],
    significant_signs: [],
    orders: [],
    meds: []
  },
  contradictions: [],
  differential_diagnoses: [],
  severity_red_flags: [],
  procedural_issues: [],          // [{issue, impact, evidence}]
  missed_opportunities: [],       // [{what, why_it_matters}]
  revenue_quality_opportunities: [], // [{opportunity, category, rationale, risk_note}]
  should_have_been_done: [],      // [{step, reason}]
  suggested_next_steps: [],       // [{action, justification}]
  icd_suggestions: [],            // اختياري
  cpt_suggestions: [],            // اختياري
  references: [],                 // [{title, org, link}]
  patient_safety_note: "هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويُراجع من طبيب مرخّص.",
  executive_summary: ""
};

// توجيه سريري قوي يفرض نفس المخطط ويطلب تعارضات/أخطاء واضحة
function buildSystemPrompt(lang = 'ar', specialty = '', context = '') {
  const L = lang === 'en' ? {
    role: "You are a clinical QA & revenue optimization assistant. Remove PHI. Output ONLY valid JSON with the exact schema provided.",
    safety: "Do not provide definitive diagnosis or treatment; this is for quality and insurance audit; must be reviewed by a licensed physician.",
    specialtyHint: specialty ? `Clinical specialty context: ${specialty}.` : "",
    contextHint: context ? `Insurance/visit context: ${context}.` : "",
    refs: "Base your judgments on reputable guidelines (NICE/WHO/CDC…) and cite short references with links in the `references` array."
  } : {
    role: "أنت مساعد سريري لتحسين الجودة والدخل. أزل أي معرفات شخصية. أعِد **JSON صالح فقط** وفق المخطط المحدد.",
    safety: "لا تقدّم تشخيصًا نهائيًا أو توصيات علاجية ملزمة؛ التقرير للتدقيق التعليمي والتأميني ويُراجع من طبيب مرخّص.",
    specialtyHint: specialty ? `سياق التخصص: ${specialty}.` : "",
    contextHint: context ? `سياق تأميني/زيارة: ${context}.` : "",
    refs: "استند إلى أدلة موثوقة (NICE/WHO/CDC...) مع روابط مختصرة ضمن مصفوفة `references`."
  };

  const schema = JSON.stringify(schemaKeys, null, 2);

  return `${L.role}
${L.safety}
${L.specialtyHint}
${L.contextHint}
${L.refs}

Return JSON ONLY with these keys (no prose, no markdown):
${schema}

Rules:
- Extract what the physician actually did (chief complaint, vitals, diagnoses, meds, orders) from the provided OCR text.
- Detect contradictions (e.g., "no trauma" but contusion code, antibiotic IV for simple viral pharyngitis, wrong drug coding).
- List procedural/documentation issues and missed opportunities tied to insurance acceptance and revenue.
- Provide ICD suggestions if the recorded codes are too generic or inconsistent.
- Keep Arabic language if input language is Arabic; otherwise English.
`;
}

// دمج نتائج النموذجين بذكاء
function mergeReports(a = {}, b = {}) {
  const merged = structuredClone(schemaKeys);
  const take = (x) => (Array.isArray(x) ? x : (x ? [x] : []));
  merged.patient_summary = a.patient_summary || b.patient_summary || "";
  merged.key_findings = Array.from(new Set([...(a.key_findings||[]), ...(b.key_findings||[])]));
  merged.physician_actions = {
    chief_complaint: a?.physician_actions?.chief_complaint || b?.physician_actions?.chief_complaint || "",
    diagnoses: Array.from(new Set([...(a?.physician_actions?.diagnoses||[]), ...(b?.physician_actions?.diagnoses||[])])),
    icd10_codes: Array.from(new Set([...(a?.physician_actions?.icd10_codes||[]), ...(b?.physician_actions?.icd10_codes||[])])),
    vitals: Array.from(new Set([...(a?.physician_actions?.vitals||[]), ...(b?.physician_actions?.vitals||[])])),
    significant_signs: Array.from(new Set([...(a?.physician_actions?.significant_signs||[]), ...(b?.physician_actions?.significant_signs||[])])),
    orders: Array.from(new Set([...(a?.physician_actions?.orders||[]), ...(b?.physician_actions?.orders||[])])),
    meds: Array.from(new Set([...(a?.physician_actions?.meds||[]), ...(b?.physician_actions?.meds||[])]))
  };
  const keys = [
    'contradictions','differential_diagnoses','severity_red_flags',
    'procedural_issues','missed_opportunities',
    'revenue_quality_opportunities','should_have_been_done','suggested_next_steps',
    'icd_suggestions','cpt_suggestions','references'
  ];
  for(const k of keys){
    merged[k] = [...(a[k]||[]), ...(b[k]||[])];
  }
  merged.executive_summary = a.executive_summary || b.executive_summary || "";
  merged.patient_safety_note = a.patient_safety_note || b.patient_safety_note || schemaKeys.patient_safety_note;
  return merged;
}

// استخراج JSON بأمان من نص
function safeParseJSON(txt){
  try {
    // إن عاد النموذج بين ```json ... ```
    const m = txt.match(/```json([\s\S]*?)```/i);
    const raw = m ? m[1] : txt;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// استدعاء OpenAI (Chat Completions) مع صور (image_url) + نص
async function callOpenAI({language, specialty, context, text, images}) {
  if(!OPENAI_API_KEY) return null;
  const system = buildSystemPrompt(language, specialty, context);

  const content = [{ type:'text', text: `OCR/Text:\n${text || ''}` }];
  for(const url of images.slice(0,4)){
    content.push({ type:'image_url', image_url:{ url, detail:'high' }});
  }

  const body = {
    model: "gpt-4o-2024-08-06",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content }
    ]
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify(body)
  });

  if(!r.ok){
    const e = await r.text();
    return { error: `OpenAI error ${r.status}: ${e}` };
  }
  const data = await r.json();
  const txt = data?.choices?.[0]?.message?.content || "";
  const json = safeParseJSON(txt);
  return json || { error: "Failed to parse OpenAI JSON", raw: txt };
}

// استدعاء Gemini (REST generateContent) مع inline_data base64
async function callGemini({language, specialty, context, text, images}) {
  if(!GEMINI_API_KEY) return null;

  const system = buildSystemPrompt(language, specialty, context);
  // أخذ أول 3 صور فقط
  const parts = [{ text: system + "\n\n" + (text ? `OCR/Text:\n${text}` : "") }];
  for(const dataUrl of images.slice(0,3)){
    const [head, b64] = dataUrl.split(','); // data:image/jpeg;base64,xxxx
    const mime = head.split(':')[1].split(';')[0] || 'image/jpeg';
    parts.push({ inline_data: { mime_type: mime, data: b64 }});
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const r = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ contents: [{ role:"user", parts }] })
  });

  if(!r.ok){
    const e = await r.text();
    return { error: `Gemini error ${r.status}: ${e}` };
  }
  const data = await r.json();
  const txt =
    data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join('\n') ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const json = safeParseJSON(txt);
  return json || { error: "Failed to parse Gemini JSON", raw: txt };
}

// إزالة محتمل لـ PHI بدائيًا (اسم/هوية) داخل النص قبل الإرسال (طبقة إضافية)
function basicPHIRemoval(s=''){
  return s
    .replace(/\b(Name|Patient|ID|MRN|DOB|Date of Birth|اسم|هوية|رقم ملف|تاريخ الميلاد)\s*[:：]\s*[^\n]+/gi, '$1: [REDACTED]')
    .slice(0, 20000);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' }); return;
  }
  try{
    const startedAt = new Date().toISOString();
    const { language='ar', modelChoice='both', specialty='', context='', images=[], text='' } = await readJSON(req);

    const cleanText = basicPHIRemoval(text||'');
    const payload = { language, specialty, context, text: cleanText, images: Array.isArray(images) ? images : [] };

    const wantGPT = modelChoice === 'both' || modelChoice === 'gpt';
    const wantGem = modelChoice === 'both' || modelChoice === 'gemini';

    const [gpt, gem] = await Promise.all([
      wantGPT ? callOpenAI(payload) : null,
      wantGem ? callGemini(payload) : null
    ]);

    const gptObj = (gpt && !gpt.error && typeof gpt === 'object') ? gpt : {};
    const gemObj = (gem && !gem.error && typeof gem === 'object') ? gem : {};
    const merged = mergeReports(gptObj, gemObj);

    res.setHeader('Content-Type','application/json');
    res.status(200).send(JSON.stringify({
      api_version: 'v6.0',
      started_at: startedAt,
      merged,
      gpt_raw: gpt || null,
      gemini_raw: gem || null
    }));
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Server error', detail: String(e?.message||e) });
  }
}

async function readJSON(req){
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw || '{}');
}
