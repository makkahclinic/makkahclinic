// api/gpt.js
// خادم REST بسيط يستدعي OpenAI (Chat Completions مع صور) و Gemini (generateContent)
// بدون أية SDKs لتجنّب أخطاء "unsupported modules" في Edge.
//
// متطلبات البيئة (Vercel):
// OPENAI_API_KEY, GEMINI_API_KEY
// (اختياري) OPENAI_MODEL, GEMINI_MODEL

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_MODEL  = process.env.GEMINI_MODEL  || 'gemini-1.5-pro';

function extractJSON(text='') {
  // يلتقط JSON حتى لو كان داخل ```json ... ```
  const m = text.match(/\{[\s\S]*\}$/) || text.match(/\{[\s\S]*?\}/m);
  try { return JSON.parse(m ? m[0] : text); } catch { return null; }
}

function schema(language='ar') {
  // مخطط صارم؛ نطلب مصادر موثوقة وروابط مباشرة.
  const safetyNote = language === 'ar'
    ? "هذا المحتوى لتحسين الجودة والتدقيق التأميني ويُراجع من طبيب مُرخَّص قبل أي قرار سريري."
    : "For quality-improvement and payer audit support; a licensed clinician must review before decisions.";
  return `
أنت مساعد سريري للتدقيق وتحسين الجودة والدخل. أزل أي مُعرِّفات شخصية (PHI).
اللغة: ${language}. أعد الاستجابة بصيغة JSON فقط وفق المفاتيح التالية (حافظ على الأسماء كما هي):

{
 "executive_summary": "",
 "patient_summary": "",
 "physician_actions": {
   "chief_complaint": "", "vitals": [], "significant_signs": [],
   "diagnoses": [], "orders": [], "meds": [], "icd10_codes": []
 },
 "key_findings": [],
 "contradictions": [ { "item":"", "evidence":"", "impact":"" } ],
 "differential_diagnoses": [ { "dx":"", "why":"" } ],
 "severity_red_flags": [],
 "procedural_issues": [ { "issue":"", "impact":"", "evidence":"" } ],
 "missed_opportunities": [ { "what":"", "why_it_matters":"" } ],
 "revenue_quality_opportunities": [
   { "opportunity":"", "category":"documentation|diagnostics|procedure|follow-up|coding", "rationale":"", "risk_note":"" }
 ],
 "should_have_been_done": [ { "step":"", "reason":"" } ],
 "suggested_next_steps": [ { "action":"", "justification":"" } ],
 "icd_suggestions": [ { "code":"", "label":"", "why":"" } ],
 "cpt_suggestions": [ { "code":"", "label":"", "why":"" } ],
 "references": [ { "title":"", "org":"NICE|WHO|CDC|IDSA|NHS|BMJ|AAO|AAD|BSSH", "link":"" } ],
 "patient_safety_note": "${safetyNote}"
}

قواعد صارمة:
- استند إلى إرشادات موثوقة فقط (NICE/WHO/CDC/IDSA/…)، وضع روابط مباشرة للمصدر.
- لا تُنشئ أدوية/فحوص غير ضرورية؛ فسِّر التناقضات والترميز الخاطئ إن وجد.
- إن كان الملف مجرد وصفة/مطالبة قصيرة فاذكر نقص التوثيق واقتراحات تحسين الجودة/الدخل.
- أعد **JSON فقط** بلا شرح خارجي.
`;
}

function toOpenAIMessage({ instruction, images=[], texts=[] }) {
  const parts = [{ type: 'text', text: instruction }];
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
  }
  if (texts.length) parts.push({ type:'text', text: texts.join('\n\n').slice(0, 12000) });
  return parts;
}

function toGeminiParts({ instruction, images=[], texts=[] }) {
  const parts = [{ text: instruction }];
  for (const img of images) {
    const b64 = img.dataUrl.split(',')[1] || '';
    parts.push({ inlineData: { mimeType: img.contentType || 'image/png', data: b64 } });
  }
  if (texts.length) parts.push({ text: texts.join('\n\n').slice(0, 12000) });
  return parts;
}

async function callOpenAI(apiKey, instruction, images, texts) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'You are a meticulous clinical quality & revenue-improvement assistant. Return STRICT JSON only.' },
      { role: 'user', content: toOpenAIMessage({ instruction, images, texts }) }
    ],
    response_format: { type: 'json_object' }
  };
  const r = await fetch(url, {
    method:'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'OpenAI error');
  const text = data.choices?.[0]?.message?.content || '';
  return extractJSON(text);
}

async function callGemini(apiKey, instruction, images, texts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role:'user', parts: toGeminiParts({ instruction, images, texts }) }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
  };
  const r = await fetch(url, {
    method:'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (data?.error) throw new Error(data.error.message || 'Gemini error');
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractJSON(text);
}

function coalesceArr(...arrs) {
  const seen = new Set();
  const out = [];
  for (const a of arrs) {
    (a||[]).forEach(x => {
      const key = typeof x === 'string' ? x : JSON.stringify(x);
      if (!seen.has(key) && key !== '{}' && key !== '""') { seen.add(key); out.push(x); }
    });
  }
  return out;
}

function mergeReports(a={}, b={}) {
  const merged = {};
  merged.executive_summary = [a.executive_summary, b.executive_summary].filter(Boolean).join(' — ');
  merged.patient_summary   = [a.patient_summary,   b.patient_summary  ].filter(Boolean).join(' — ');
  merged.physician_actions = {
    chief_complaint: a?.physician_actions?.chief_complaint || b?.physician_actions?.chief_complaint || "",
    vitals: coalesceArr(a?.physician_actions?.vitals, b?.physician_actions?.vitals),
    significant_signs: coalesceArr(a?.physician_actions?.significant_signs, b?.physician_actions?.significant_signs),
    diagnoses: coalesceArr(a?.physician_actions?.diagnoses, b?.physician_actions?.diagnoses),
    orders: coalesceArr(a?.physician_actions?.orders, b?.physician_actions?.orders),
    meds: coalesceArr(a?.physician_actions?.meds, b?.physician_actions?.meds),
    icd10_codes: coalesceArr(a?.physician_actions?.icd10_codes, b?.physician_actions?.icd10_codes)
  };
  const keys = [
    'key_findings','contradictions','differential_diagnoses','severity_red_flags',
    'procedural_issues','missed_opportunities','revenue_quality_opportunities',
    'should_have_been_done','suggested_next_steps','icd_suggestions','cpt_suggestions','references'
  ];
  for (const k of keys) merged[k] = coalesceArr(a[k], b[k]);

  merged.patient_safety_note = a.patient_safety_note || b.patient_safety_note || "";
  return merged;
}

// إذا كانت الدالة تُشغَّل كـ Edge، فوجود هذا الـ config غير ضروري؛ ولو كانت Node.js فالأمر سيعمل كذلك.
// (نتركها فارغة لتفادي التعارض بين بيئات Vercel المختلفة)
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ error: 'Method not allowed' });
  }
  try {
    const { language='ar', specialty='عام', insuranceContext='', images=[], texts=[], model='both' } = req.body || {};

    const instruction =
      schema(language) +
      `\n\nالتخصص السريري: ${specialty}\nالسياق/الخلفية التأمينية: ${insuranceContext || '—'}\n` +
      (texts?.length ? `\n(نصوص مستخرجة من PDF مرفقة أعلاه)\n` : '');

    const out = { gpt:null, gemini:null };

    if (model === 'gpt' || model === 'both') {
      out.gpt = await callOpenAI(process.env.OPENAI_API_KEY, instruction, images, texts);
    }
    if (model === 'gemini' || model === 'both') {
      out.gemini = await callGemini(process.env.GEMINI_API_KEY, instruction, images, texts);
    }

    const merged = mergeReports(out.gpt || {}, out.gemini || {});
    return res.json({ merged, gpt: out.gpt, gemini: out.gemini });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: e?.message || 'Server error' });
  }
};
