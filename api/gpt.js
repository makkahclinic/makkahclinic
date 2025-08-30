// api/case-analyzer.js (أو api/gpt.js)
// ================================
// Node.js Serverless Function (Vercel) - تحليل متقدم للحالات الطبية (V6.3)
// يستخدم SDKs الرسمية ويعمل في بيئة Node.js

// تهيئة Vercel لبيئة Node.js
export const config = { 
    runtime: 'nodejs',
    maxDuration: 45 // زيادة المدة المسموحة (تعتمد على خطة Vercel)
}; 

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || '';

const OPENAI_MODEL = "gpt-4o-2024-08-06";
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const MAX_TOKENS = 16384; // حد المخرجات

/** أدوات مساعدة **/

// أداة مساعدة: قراءة JSON من الطلب (ضرورية في بيئة Node.js على Vercel)
async function readJson(req) {
    try {
        // التحقق مما إذا كان الجسم قد تم تحليله مسبقاً (كما في Next.js API routes)
        if (req.body && Object.keys(req.body).length > 0) {
            return typeof req.body === 'object' ? req.body : JSON.parse(req.body);
        }
        
        // التحليل اليدوي إذا لم يكن متاحاً (مثل Node.js الخام)
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return {};
        return JSON.parse(raw);
    } catch (e) {
        throw new Error(`Invalid JSON payload: ${e.message}`);
    }
}

// دالة قوية لاستخراج JSON
function extractJSON(text){
  if(!text) return null;
  text = text.trim();
  const cleanText = text.replace(/^```(json)?|```$/g, '').trim();
  
  try { 
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(cleanText.substring(start, end + 1));
    }
    return JSON.parse(cleanText); 
  } catch (e) {
    console.error("Failed to parse JSON:", e.message);
    return null;
  }
}

// دالة دمج قوية (V6) تعتمد على التوقيع الدلالي لمنع التكرار
function mergeArrays(a=[], b=[], keyFields=['dx','issue','what','opportunity','action','step','item', 'metric', 'name', 'test', 'code', 'link']){
  const out = [];
  const seen = new Set();
  
  function sig(x){
    if (typeof x === 'string') return x.trim().toLowerCase().slice(0, 150);
    if (typeof x !== 'object' || x === null) return String(x).slice(0, 100);

    for(const k of keyFields){
      if(x[k]) return `${k}:${String(x[k]).trim().toLowerCase().slice(0, 150)}`;
    }
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

// ======== بناء موجه التحليل (System Prompt) - مخطط V6 المعتمد =========
function buildSystemPrompt(lang='ar', specialty=''){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  const specialtyFocus = specialty ? L(`**التركيز التخصصي:** ${specialty}.`, `**Specialty Focus:** ${specialty}.`) : '';

  // استخدام الموجه V6 المتقدم لضمان أعلى جودة تحليل.
  return L(
`أنت "مدقق سريري وتأميني خبير" (Expert Clinical Auditor). مهمتك تحليل السجلات الطبية (صور ونصوص) بدقة فائقة لغرض تحسين التوثيق (CDI) ومراجعة الامتثال.

# الأهداف الرئيسية:
1. تقييم الضرورة الطبية (Medical Necessity) واكتمال التوثيق.
2. تحديد التناقضات بين التوثيق السريري والترميز (Coding).
3. تحديد فرص تحسين الجودة والدخل (RCM/Quality).
4. دعم جميع الاستنتاجات بالإرشادات العالمية (NICE, CDC, WHO) مع روابط URL صالحة.

${specialtyFocus}

# القواعد الصارمة:
- **JSON فقط:** سيتم فرض إخراج JSON عبر الـ API.
- **الموضوعية:** إذا كانت المعلومة غير موجودة، اترك الحقل فارغًا. لا تفترض أي شيء.
- **الخصوصية:** أزل كافة المعرفات الشخصية (PHI).
- **اللغة:** استخدم العربية الفصحى المهنية والموجزة.

# هيكل JSON المطلوب (V6 - التزم به حرفيًا):
{
  "executive_summary": "ملخص تنفيذي (3-5 جمل) يجمع بين الحالة السريرية وأهم نتائج التدقيق.",
  "patient_summary": "وصف موجز لحالة المريض السريرية.",
  "key_findings": [""],
  
  "physician_actions": {
    "chief_complaint": "",
    "diagnoses": [""],
    "icd10_codes": [""],
    "vitals": [{"metric": "المقياس", "value": "", "unit": ""}],
    "significant_signs": [""],
    "orders": [{"test": ""}],
    "meds": [{"name": "", "dose": "", "route": ""}]
  },

  "analysis": {
    "contradictions": [{"item": "", "evidence": "", "impact": ""}],
    "procedural_issues": [{"issue": "", "impact": "", "evidence": ""}],
    "missed_opportunities": [{"what": "", "why_it_matters": ""}],
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
// English Prompt
`You are an Expert Clinical Auditor specializing in CDI and Compliance Review. Analyze the provided medical records precisely. [Full English prompt mirroring Arabic structure and V6 Schema]`
);
}

// ======== بناء رسالة المستخدم (User Content) =========
function buildUserMessage({lang, context, text, images}){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  // زيادة حد النص المدخل إلى 100k
  const truncatedText = (text || '').slice(0, 100000); 

  const meta = L(
`# سياق المراجعة
اللغة المطلوبة للتقرير: العربية
سياق المطالبة/هدف المراجعة: ${context||'تدقيق جودة شامل'}

# المستندات المتاحة للتحليل
عدد الصور/الصفحات المرئية: ${images?.length||0}

## المحتوى النصي المستخرج (من PDF/نماذج)
ملاحظة: اعتمد على الصور كمصدر أساسي إذا وجد تعارض مع النص المستخرج.
<EXTRACTED_TEXT>
${truncatedText||'لا يوجد نص مستخرج.'}
</EXTRACTED_TEXT>

# المهمة
حلل النص والصور المرئية (المرفقة) معًا كسجل طبي واحد. اتبع تعليمات النظام بدقة وأعد تقرير JSON (V6) فقط.`,
`# Review Context
[English context mirroring Arabic structure]`
);
  return meta;
}

// ======== استدعاء GPT‑4o (SDK + JSON Mode + توافق V6.3) =========
async function callOpenAI({lang, specialty, userMsg, images}){
  if(!OPENAI_API_KEY) return { ok:false, data:null, note:'OPENAI_API_KEY missing' };
  
  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    const content = [{ type:'text', text:userMsg }];
    // إصلاح التوافق: الواجهة الأمامية V6.3 ترسل مصفوفة Base64 الخام. 
    // نحولها إلى Data URL المطلوبة لـ OpenAI SDK.
    for(const b64 of (images||[])){
      content.push({ type:'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" } });
    }
    const system = buildSystemPrompt(lang, specialty);
  
    // استدعاء API مع فرض JSON Mode
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: MAX_TOKENS,
      messages: [
        { role:"system", content: system },
        { role:"user",   content: content }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content;
    const data = extractJSON(raw);
    if (!data) throw new Error("Failed to extract valid JSON from OpenAI response.");
    return { ok:true, raw, data };
  } catch (e) {
    console.error("OpenAI Call Failed:", e);
    const errorMessage = e.message || String(e);
    return { ok:false, raw: errorMessage, data:null, error: errorMessage };
  }
}

// ======== استدعاء Gemini (SDK + JSON Mode + توافق V6.3) =========
async function callGemini({lang, specialty, userMsg, images}){
  if(!GEMINI_API_KEY) return { ok:false, data:null, note:'GEMINI_API_KEY missing' };

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const system = buildSystemPrompt(lang, specialty);

    // تهيئة النموذج مع التعليمات وفرض JSON Mode
    const model = genAI.getGenerativeModel({ 
        model: GEMINI_MODEL,
        systemInstruction: system,
        generationConfig: { 
            temperature: 0.1,
            maxOutputTokens: MAX_TOKENS,
            responseMimeType: "application/json" 
        }
    });

    const parts = [{ text: userMsg }];
    // التوافق: الواجهة الأمامية V6.3 ترسل مصفوفة Base64. Gemini SDK تقبلها مباشرة.
    for(const b64 of (images||[])){
      parts.push({ inlineData:{ mimeType:'image/jpeg', data:b64 }});
    }

    // استدعاء API
    const result = await model.generateContent({
        contents: [{ role: 'user', parts: parts }]
    });

    const raw = result.response?.text();
    const data = extractJSON(raw);
    if (!data) throw new Error("Failed to extract valid JSON from Gemini response.");
    return { ok:true, raw, data };
  } catch (e) {
    console.error("Gemini Call Failed:", e);
    const errorMessage = e.message || String(e);
    return { ok:false, raw: errorMessage, data:null, error: errorMessage };
  }
}

// ======== دمج التقريرين (منطق V6 القوي) =========
function mergeReports(a={}, b={}, lang='ar'){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  const get = (obj, path, def=[]) => path.split('.').reduce((o, k) => (o || {})[k], obj) || def;

  // تحديد التقرير الأساسي
  const scoreA = JSON.stringify(a).length;
  const scoreB = JSON.stringify(b).length;
  const primary = scoreA >= scoreB ? a : b;
  const secondary = scoreA >= scoreB ? b : a;

  // الدمج العميق باستخدام mergeArrays
  const merged = {
    patient_summary: primary.patient_summary || secondary.patient_summary || '',
    key_findings: mergeArrays(a.key_findings, b.key_findings),
    
    physician_actions: {
      chief_complaint: get(primary, 'physician_actions.chief_complaint', '') || get(secondary, 'physician_actions.chief_complaint', ''),
      diagnoses: mergeArrays(get(a, 'physician_actions.diagnoses'), get(b, 'physician_actions.diagnoses')),
      icd10_codes: mergeArrays(get(a, 'physician_actions.icd10_codes'), get(b, 'physician_actions.icd10_codes')),
      vitals: mergeArrays(get(a, 'physician_actions.vitals'), get(b, 'physician_actions.vitals')),
      significant_signs: mergeArrays(get(a, 'physician_actions.significant_signs'), get(b, 'physician_actions.significant_signs')),
      orders: mergeArrays(get(a, 'physician_actions.orders'), get(b, 'physician_actions.orders')),
      meds: mergeArrays(get(a, 'physician_actions.meds'), get(b, 'physician_actions.meds'))
    },

    analysis: {
      contradictions: mergeArrays(get(a, 'analysis.contradictions'), get(b, 'analysis.contradictions')),
      procedural_issues: mergeArrays(get(a, 'analysis.procedural_issues'), get(b, 'analysis.procedural_issues')),
      missed_opportunities: mergeArrays(get(a, 'analysis.missed_opportunities'), get(b, 'analysis.missed_opportunities')),
      differential_diagnoses: mergeArrays(get(a, 'analysis.differential_diagnoses'), get(b, 'analysis.differential_diagnoses')),
      severity_red_flags: mergeArrays(get(a, 'analysis.severity_red_flags'), get(b, 'analysis.severity_red_flags')),
    },

    recommendations: {
      revenue_quality_opportunities: mergeArrays(get(a, 'recommendations.revenue_quality_opportunities'), get(b, 'recommendations.revenue_quality_opportunities')),
      should_have_been_done: mergeArrays(get(a, 'recommendations.should_have_been_done'), get(b, 'recommendations.should_have_been_done')),
      suggested_next_steps: mergeArrays(get(a, 'recommendations.suggested_next_steps'), get(b, 'recommendations.suggested_next_steps')),
      icd_suggestions: mergeArrays(get(a, 'recommendations.icd_suggestions'), get(b, 'recommendations.icd_suggestions')),
      cpt_suggestions: mergeArrays(get(a, 'recommendations.cpt_suggestions'), get(b, 'recommendations.cpt_suggestions')),
    },

    references: mergeArrays(a.references, b.references)
  };

  // توليد ملخص تنفيذي ذكي
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

  const baseSummary = primary.executive_summary || secondary.executive_summary || merged.patient_summary;
  merged.executive_summary = [baseSummary, bullets.join(' ')].filter(Boolean).join('\n\n');

  // ملاحظة سلامة المريض
  merged.patient_safety_note = L(
    "إخلاء مسؤولية: هذا التقرير ناتج عن تحليل آلي (AI) وهو مخصص لأغراض التدقيق وتحسين الجودة فقط. يجب مراجعة جميع النتائج والتوصيات من قبل متخصص طبي مرخص قبل اتخاذ أي قرارات سريرية.",
    "Disclaimer: This report is generated by Automated Intelligence (AI) and is intended solely for auditing and quality improvement purposes. All findings and recommendations must be reviewed by a licensed medical professional before making any clinical decisions."
  );

  return merged;
}

// ============= نقطة الدخول (Handler) =============
export default async function handler(req, res){
  try{
    if(req.method !== 'POST') {
        return res.status(405).json({ok:false, error:'Use POST'});
    }
    
    // قراءة البيانات (تتعامل مع الأخطاء داخلياً)
    const body = await readJson(req);

    // إصلاح التوافق: استخدام المفاتيح الصحيحة (lang, text, images) والتوافق مع الواجهة V6.3
    const { lang='ar', modelChoice='both', specialty='', context='', images=[], text='', apiVersion='v6.3.0-node' } = body||{};
    
    // زيادة حد النص المدخل إلى 100k
    const sanitizedText = text ? text.slice(0, 100000) : '';

    if (images.length === 0 && sanitizedText.trim().length === 0) {
        return res.status(400).json({ ok:false, error:"No content provided (images or text)." });
    }

    if(!OPENAI_API_KEY && !GEMINI_API_KEY){
      return res.status(500).json({ ok:false, error:"Missing API keys." });
    }

    // تحضير الرسالة
    const userMsg = buildUserMessage({lang, context, text: sanitizedText, images});

    // تحديد النماذج المطلوبة
    const wantsGPT = (modelChoice==='both' || modelChoice==='gpt') && !!OPENAI_API_KEY;
    const wantsGem = (modelChoice==='both' || modelChoice==='gemini') && !!GEMINI_API_KEY;

    // إصلاح حاسم: التنفيذ المتوازي باستخدام Promise.all()
    const [gptRes, gemRes] = await Promise.all([
      wantsGPT ? callOpenAI({lang, specialty, userMsg, images}) : Promise.resolve({ok:false, data:null, note:'Disabled or key missing.'}),
      wantsGem ? callGemini({lang, specialty, userMsg, images}) : Promise.resolve({ok:false, data:null, note:'Disabled or key missing.'})
    ]);

    // تجميع الأخطاء والتحقق
    const errors = [];
    if (wantsGPT && !gptRes.ok) errors.push(`GPT-4o Error: ${gptRes.error}`);
    if (wantsGem && !gemRes.ok) errors.push(`Gemini Error: ${gemRes.error}`);

    if (!gptRes.data && !gemRes.data) {
        return res.status(500).json({ 
            ok:false, 
            error:"Both models failed to generate a valid response.", 
            errors: errors
        });
    }

    // الدمج
    const merged = mergeReports(gptRes.data || {}, gemRes.data || {}, lang);

    // الاستجابة النهائية (متوافقة مع الواجهة الأمامية V6.3)
    return res.status(200).json({
      ok:true,
      version: apiVersion,
      errors: errors.length > 0 ? errors : undefined,
      merged, // استخدام المفتاح 'merged'
      gpt: { ok:gptRes.ok, raw: gptRes.raw?.slice(0,150000), error: gptRes.error, note: gptRes.note },
      gemini: { ok:gemRes.ok, raw: gemRes.raw?.slice(0,150000), error: gemRes.error, note: gemRes.note }
    });

  }catch(err){
    console.error("Internal Handler Error:", err);
    return res.status(500).json({ ok:false, error:err?.message || String(err) });
  }
}
