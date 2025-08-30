// api/gpt.js
// ================================
// Edge Function — تحليل متقدم للحالات الطبية (CDI/UR) - Schema V6.1
// متوافق مع Vercel Edge Runtime (لا يستخدم Node.js SDKs - يعتمد على fetch فقط)

export const config = { runtime: 'edge' };

// الحصول على المفاتيح من متغيرات البيئة في Vercel
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || '';

/** أدوات مساعدة **/
function jsonResponse(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: {'content-type':'application/json; charset=utf-8'}
  });
}

// دالة قوية لاستخراج JSON من مخرجات النماذج
function extractJSON(text){
  if(!text) return null;
  text = text.trim();

  // محاولة إزالة علامات Markdown
  const cleanText = text.replace(/^```(json)?|```$/g, '').trim();
  
  try { 
    // البحث عن أول { وآخر } لضمان التقاط الكائن كاملاً
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(cleanText.substring(start, end + 1));
    }
    return JSON.parse(cleanText); 
  } catch (e) {
    console.error("Failed to parse JSON:", e.message, text.slice(0, 500));
    return null;
  }
}

// دالة دمج محسنة للمفاتيح المنظمة الجديدة
function mergeArrays(a=[], b=[], keyFields=['dx','issue','what','opportunity','action','step','item', 'metric', 'name', 'test', 'code', 'link']){
  const out = [];
  const seen = new Set();
  
  function sig(x){
    if (typeof x === 'string') return x.trim().toLowerCase().slice(0, 150);
    if (typeof x !== 'object' || x === null) return String(x).slice(0, 100);

    for(const k of keyFields){
      if(x[k]) return `${k}:${String(x[k]).trim().toLowerCase().slice(0, 150)}`;
    }
    // توقيع احتياطي
    try {
        return JSON.stringify(Object.entries(x).sort().slice(0, 2)).slice(0, 150);
    } catch {
        return String(x).slice(0, 100);
    }
  }

  for(const it of [...(a||[]),...(b||[])].filter(Boolean)){
    const s = sig(it);
    if(!seen.has(s)){ out.push(it); seen.add(s); }
  }
  return out;
}

// ======== بناء موجه التحليل (System Prompt) - مخطط جديد (V6) وهندسة متقدمة =========
function buildSystemPrompt(lang='ar', specialty=''){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  const specialtyFocus = specialty ? L(`**التركيز التخصصي:** ${specialty}.`, `**Specialty Focus:** ${specialty}.`) : '';

  return L(
`أنت "مدقق سريري وتأميني خبير" (Expert Clinical Auditor). مهمتك تحليل السجلات الطبية (صور ونصوص) بدقة فائقة لغرض تحسين التوثيق (CDI) ومراجعة الامتثال.

# الأهداف الرئيسية:
1. تقييم الضرورة الطبية (Medical Necessity) واكتمال التوثيق.
2. تحديد التناقضات بين التوثيق السريري والترميز (Coding).
3. تحديد فرص تحسين الجودة والدخل (RCM/Quality).
4. دعم جميع الاستنتاجات بالإرشادات العالمية (NICE, CDC, WHO) مع روابط URL صالحة.

${specialtyFocus}

# القواعد الصارمة:
- **JSON فقط:** لا تكتب أي نص خارج كتلة JSON المحددة.
- **الموضوعية:** إذا كانت المعلومة غير موجودة، اترك الحقل فارغًا. لا تفترض أي شيء.
- **الخصوصية:** أزل كافة المعرفات الشخصية (PHI).
- **اللغة:** استخدم العربية الفصحى المهنية والموجزة.

# هيكل JSON المطلوب (V6 - التزم به حرفيًا):
{
  "executive_summary": "ملخص تنفيذي (3-5 جمل) يجمع بين الحالة السريرية وأهم نتائج التدقيق.",
  "patient_summary": "وصف موجز لحالة المريض السريرية.",
  "key_findings": ["أهم النتائج السريرية الإيجابية والسلبية."],
  
  "physician_actions": {
    "chief_complaint": "",
    "diagnoses": [""],
    "icd10_codes": [""],
    /* بيانات منظمة مطلوبة */
    "vitals": [{"metric": "المقياس (مثل BP, HR)", "value": "القيمة", "unit": "الوحدة"}],
    "significant_signs": [""],
    "orders": [{"test": "اسم التحليل/الإجراء"}],
    "meds": [{"name": "اسم الدواء", "dose": "الجرعة والتردد", "route": "طريقة الإعطاء"}]
  },

  "analysis": {
    "contradictions": [{"item": "وصف التناقض", "evidence": "الدليل المقتبس", "impact": "التأثير السريري/التأميني"}],
    "procedural_issues": [{"issue": "مشكلة توثيق/إجرائية", "impact": "", "evidence": ""}],
    "missed_opportunities": [{"what": "الإجراء السريري المفقود", "why_it_matters": ""}],
    "differential_diagnoses": [{"dx": "", "why": ""}],
    "severity_red_flags": [""]
  },

  "recommendations": {
    "revenue_quality_opportunities": [{"opportunity": "", "category": "documentation|diagnostics|procedure|follow-up|coding|stewardship", "rationale": "", "risk_note": ""}],
    "should_have_been_done": [{"step": "", "reason": ""}],
    "suggested_next_steps": [{"action": "", "justification": ""}],
    "icd_suggestions": [{"code": "", "label": "", "why": ""}],
    "cpt_suggestions": [{"code": "", "label": "", "why": ""}]
  },

  "references": [{"title": "", "org": "(NICE, CDC, etc.)", "link": ""}]
}
`,
// English Prompt (Mirrors the Arabic structure and V6 Schema)
`You are an Expert Clinical Auditor specializing in CDI and Compliance Review. Analyze the provided medical records precisely.

# Primary Objectives:
1. Assess Medical Necessity and documentation completeness.
2. Identify contradictions between clinical documentation and coding.
3. Identify RCM and Quality Improvement opportunities.
4. Support findings with global guidelines (NICE, CDC, WHO) and valid URLs.

${specialtyFocus}

# Strict Output Rules:
- **JSON Only:** Do not write any text outside the JSON block.
- **Objectivity:** If information is missing, leave the field empty. Do not assume.
- **Privacy:** Remove all PHI.
- **Language:** Use concise, professional English.

# Required JSON Schema (V6 - Adhere Strictly):
[Same JSON V6 schema as defined in the Arabic prompt]
`);
}

// ======== بناء رسالة المستخدم (User Content) =========
function buildUserMessage({lang, specialty, context, text, images, fileNames=[]}){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  const meta = L(
`# سياق المراجعة
اللغة المطلوبة للتقرير: العربية
سياق المطالبة/هدف المراجعة: ${context||'تدقيق جودة شامل'}

# المستندات المتاحة للتحليل
عدد الصور/الصفحات المرئية: ${images?.length||0}

## المحتوى النصي المستخرج (من PDF/نماذج)
ملاحظة: اعتمد على الصور كمصدر أساسي إذا وجد تعارض مع النص المستخرج.
<EXTRACTED_TEXT>
${text||'لا يوجد نص مستخرج.'}
</EXTRACTED_TEXT>

# المهمة
حلل النص والصور المرئية (المرفقة) معًا كسجل طبي واحد. اتبع تعليمات النظام بدقة وأعد تقرير JSON (V6) فقط.`,
`# Review Context
Required Report Language: English
Claim Context/Review Goal: ${context||'Comprehensive Quality Audit'}

# Documents Available for Analysis
Count of Visual Images/Pages: ${images?.length||0}

## Extracted Text Content (from PDF/Forms)
Note: Rely on images as the primary source if conflicts arise with the extracted text.
<EXTRACTED_TEXT>
${text||'No text extracted.'}
</EXTRACTED_TEXT>

# Task
Analyze the text and the visual images (attached) together as a single medical record. Follow the system instructions precisely and return the JSON (V6) report ONLY.`
);
  return meta;
}

// ======== استدعاء GPT‑4o (باستخدام Fetch - متوافق مع Edge) =========
async function callOpenAI({lang, specialty, userMsg, images}){
  if(!OPENAI_API_KEY) return { ok:false, data:null, note:'OPENAI_API_KEY missing' };
  
  try {
    const content = [{ type:'text', text:userMsg }];
    for(const b64 of (images||[])){
      // استخدام detail: high لزيادة دقة تحليل الصور الطبية
      content.push({ type:'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" } });
    }
    const system = buildSystemPrompt(lang, specialty);
    const payload = {
      model: "gpt-4o-2024-08-06",
      temperature: 0.1, // خفض الحرارة لزيادة الدقة
      response_format: { type: "json_object" },
      max_tokens: 16384, // زيادة الحد الأقصى
      messages: [
        { role:"system", content: system },
        { role:"user",   content }
      ]
    };
    
    // استخدام Fetch للاتصال بـ API
    const r = await fetch('https://api.openai.com/v1/chat/completions',{
        method:'POST',
        headers:{'Authorization':`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},
        body: JSON.stringify(payload)
    });
    
    if (!r.ok) {
        const errorBody = await r.text();
        throw new Error(`OpenAI API Error (${r.status}): ${errorBody.slice(0, 1000)}`);
    }

    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content;
    const data = extractJSON(raw);
    if (!data) throw new Error("Failed to extract valid JSON from OpenAI response.");
    return { ok:true, raw, data };
  } catch (e) {
    console.error("OpenAI Call Failed:", e);
    return { ok:false, raw: e.message, data:null, error: e.message };
  }
}

// ======== استدعاء Gemini (باستخدام Fetch - متوافق مع Edge) =========
async function callGemini({lang, specialty, userMsg, images}){
  if(!GEMINI_API_KEY) return { ok:false, data:null, note:'GEMINI_API_KEY missing' };

  try {
    const parts = [{ text: userMsg }];
    for(const b64 of (images||[])){
      parts.push({ inline_data:{ mime_type:'image/jpeg', data:b64 }});
    }
    const system = buildSystemPrompt(lang, specialty);
    const payload = {
      contents:[ { role:'user', parts } ],
      system_instruction: { role:'model', parts:[{text:system}] },
      generationConfig: { 
          temperature: 0.1,
          maxOutputTokens: 16384, 
          responseMimeType: "application/json" 
      }
    };

    const modelName = 'gemini-1.5-pro-latest';
    // استخدام Fetch للاتصال بـ API
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`,{
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });

    if (!r.ok) {
        const errorBody = await r.text();
        throw new Error(`Gemini API Error (${r.status}): ${errorBody.slice(0, 1000)}`);
    }

    const j = await r.json();
    const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    const data = extractJSON(raw);
    if (!data) throw new Error("Failed to extract valid JSON from Gemini response.");
    return { ok:true, raw, data };
  } catch (e) {
    console.error("Gemini Call Failed:", e);
    return { ok:false, raw: e.message, data:null, error: e.message };
  }
}

// ======== دمج التقريرين (دعم المخطط الجديد V6 والتوطين) =========
function mergeReports(a={}, b={}, lang='ar'){
  const L = (ar,en)=> (lang==='ar'? ar : en);

  // دالة مساعدة للوصول إلى المسارات العميقة بأمان
  const get = (obj, path, def=[]) => path.split('.').reduce((o, k) => (o || {})[k], obj) || def;

  // تحديد التقرير الأساسي (الأكثر اكتمالاً)
  const scoreA = JSON.stringify(a).length;
  const scoreB = JSON.stringify(b).length;
  const primary = scoreA >= scoreB ? a : b;
  const secondary = scoreA >= scoreB ? b : a;

  const merged = {
    patient_summary: primary.patient_summary || secondary.patient_summary || '',
    key_findings: mergeArrays(a.key_findings, b.key_findings),
    
    // دمج الإجراءات (V6)
    physician_actions: {
      chief_complaint: get(primary, 'physician_actions.chief_complaint', '') || get(secondary, 'physician_actions.chief_complaint', ''),
      diagnoses: mergeArrays(get(a, 'physician_actions.diagnoses'), get(b, 'physician_actions.diagnoses')),
      icd10_codes: mergeArrays(get(a, 'physician_actions.icd10_codes'), get(b, 'physician_actions.icd10_codes')),
      vitals: mergeArrays(get(a, 'physician_actions.vitals'), get(b, 'physician_actions.vitals')),
      significant_signs: mergeArrays(get(a, 'physician_actions.significant_signs'), get(b, 'physician_actions.significant_signs')),
      orders: mergeArrays(get(a, 'physician_actions.orders'), get(b, 'physician_actions.orders')),
      meds: mergeArrays(get(a, 'physician_actions.meds'), get(b, 'physician_actions.meds'))
    },

    // دمج التحليل (V6 مع توافق رجعي للمخطط القديم)
    analysis: {
      contradictions: mergeArrays(get(a, 'analysis.contradictions') || a.contradictions, get(b, 'analysis.contradictions') || b.contradictions),
      procedural_issues: mergeArrays(get(a, 'analysis.procedural_issues') || a.procedural_issues, get(b, 'analysis.procedural_issues') || b.procedural_issues),
      missed_opportunities: mergeArrays(get(a, 'analysis.missed_opportunities') || a.missed_opportunities, get(b, 'analysis.missed_opportunities') || b.missed_opportunities),
      differential_diagnoses: mergeArrays(get(a, 'analysis.differential_diagnoses') || a.differential_diagnoses, get(b, 'analysis.differential_diagnoses') || b.differential_diagnoses),
      severity_red_flags: mergeArrays(get(a, 'analysis.severity_red_flags') || a.severity_red_flags, get(b, 'analysis.severity_red_flags') || b.severity_red_flags),
    },

    // دمج التوصيات (V6 مع توافق رجعي)
    recommendations: {
      revenue_quality_opportunities: mergeArrays(get(a, 'recommendations.revenue_quality_opportunities') || a.revenue_quality_opportunities, get(b, 'recommendations.revenue_quality_opportunities') || b.revenue_quality_opportunities),
      should_have_been_done: mergeArrays(get(a, 'recommendations.should_have_been_done') || a.should_have_been_done, get(b, 'recommendations.should_have_been_done') || b.should_have_been_done),
      suggested_next_steps: mergeArrays(get(a, 'recommendations.suggested_next_steps') || a.suggested_next_steps, get(b, 'recommendations.suggested_next_steps') || b.suggested_next_steps),
      icd_suggestions: mergeArrays(get(a, 'recommendations.icd_suggestions') || a.icd_suggestions, get(b, 'recommendations.icd_suggestions') || b.icd_suggestions),
      cpt_suggestions: mergeArrays(get(a, 'recommendations.cpt_suggestions') || a.cpt_suggestions, get(b, 'recommendations.cpt_suggestions') || b.cpt_suggestions),
    },

    references: mergeArrays(a.references, b.references)
  };

  // توليد ملخص تنفيذي ذكي (يدعم التوطين)
  const bullets = [];
  const sep = L('؛ ', '; ');

  if(merged.analysis.contradictions?.length) {
    bullets.push(`• ${L('تناقضات حرجة', 'Critical Contradictions')}: ${merged.analysis.contradictions.map(x=>x.item).slice(0,2).join(sep)}.`);
  }
  if(merged.recommendations.revenue_quality_opportunities?.length) {
    bullets.push(`• ${L('فرص تحسين (CDI/RCM)', 'Improvement Opportunities (CDI/RCM)')}: ${merged.recommendations.revenue_quality_opportunities.map(x=>x.opportunity).slice(0,3).join(sep)}.`);
  }
  if(merged.recommendations.should_have_been_done?.length) {
    bullets.push(`• ${L('فجوات رعاية', 'Care Gaps')}: ${merged.recommendations.should_have_been_done.map(x=>x.step).slice(0,2).join(sep)}.`);
  }

  // دمج الملخص الأساسي مع نتائج التدقيق
  const baseSummary = primary.executive_summary || secondary.executive_summary || merged.patient_summary;
  merged.executive_summary = [baseSummary, bullets.join(' ')].filter(Boolean).join('\n\n');

  // ملاحظة سلامة المريض (مدعومة بالتوطين)
  merged.patient_safety_note = L(
    "إخلاء مسؤولية: هذا التقرير ناتج عن تحليل آلي (AI) وهو مخصص لأغراض التدقيق وتحسين الجودة فقط. يجب مراجعة جميع النتائج والتوصيات من قبل متخصص طبي مرخص قبل اتخاذ أي قرارات سريرية.",
    "Disclaimer: This report is generated by Automated Intelligence (AI) and is intended solely for auditing and quality improvement purposes. All findings and recommendations must be reviewed by a licensed medical professional before making any clinical decisions."
  );

  return merged;
}

// ============= نقطة الدخول =============
export default async function handler(req){
  try{
    // التحقق من أن الطلب هو POST
    if(req.method !== 'POST') return jsonResponse({ok:false, error:'Use POST'},405);
    
    let body;
    try {
        // قراءة البيانات من الطلب (متوافق مع Edge)
        body = await req.json();
    } catch (e) {
        return jsonResponse({ ok:false, error:"Invalid JSON payload" }, 400);
    }

    const { lang='ar', modelChoice='both', specialty='', context='', images=[], text='', fileNames=[], apiVersion='v6.1.0' } = body||{};
    
    if (images.length === 0 && text.trim().length === 0) {
        return jsonResponse({ ok:false, error:"No content provided (images or text)." }, 400);
    }

    if(!OPENAI_API_KEY && !GEMINI_API_KEY){
      return jsonResponse({ ok:false, error:"Missing API keys (OPENAI_API_KEY and/or GEMINI_API_KEY)." }, 500);
    }

    // تحضير الرسالة
    const userMsg = buildUserMessage({lang, specialty, context, text, images, fileNames});

    // تحديد النماذج المطلوبة
    const wantsGPT = (modelChoice==='both' || modelChoice==='gpt') && !!OPENAI_API_KEY;
    const wantsGem = (modelChoice==='both' || modelChoice==='gemini') && !!GEMINI_API_KEY;

    // استدعاء النماذج بالتوازي
    const [gptRes, gemRes] = await Promise.all([
      wantsGPT ? callOpenAI({lang, specialty, userMsg, images}) : Promise.resolve({ok:false, data:null, note:'Disabled by configuration or missing key.'}),
      wantsGem ? callGemini({lang, specialty, userMsg, images}) : Promise.resolve({ok:false, data:null, note:'Disabled by configuration or missing key.'})
    ]);

    // تجميع الأخطاء
    const errors = [];
    if (wantsGPT && !gptRes.ok) errors.push(`GPT-4o Error: ${gptRes.error}`);
    if (wantsGem && !gemRes.ok) errors.push(`Gemini Error: ${gemRes.error}`);

    // التحقق من نجاح أحد الاستدعاءات على الأقل
    if (!gptRes.data && !gemRes.data) {
        // إذا لم يتم توليد أي بيانات صالحة من أي نموذج
        return jsonResponse({ 
            ok:false, 
            error:"Both models failed to generate a valid response.", 
            errors: errors
        }, 500);
    }

    // الدمج (تمرير اللغة)
    const merged = mergeReports(gptRes.data || {}, gemRes.data || {}, lang);

    return jsonResponse({
      ok:true,
      version: apiVersion,
      errors: errors.length > 0 ? errors : undefined,
      merged,
      // إرجاع البيانات الخام للتشخيص (محدودة الحجم)
      gpt: { ok:gptRes.ok, raw: gptRes.raw?.slice(0,150000), error: gptRes.error, note: gptRes.note },
      gemini: { ok:gemRes.ok, raw: gemRes.raw?.slice(0,150000), error: gemRes.error, note: gemRes.note }
    }, 200);

  }catch(err){
    console.error("Internal Handler Error:", err);
    return jsonResponse({ ok:false, error:String(err?.message||err) }, 500);
  }
}
