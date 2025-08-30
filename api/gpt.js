// api/gpt.js (أو api/case-analyzer.js)
// V7.2 - Specialized Pharmacy Audit with JSON-Embedded Chain-of-Thought (CoT) and Smart Merge (Node.js)

export const config = { 
    runtime: 'nodejs',
    maxDuration: 50
}; 

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || '';

const OPENAI_MODEL = "gpt-4o-2024-08-06";
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const MAX_TOKENS = 16384;

/** أدوات مساعدة (Helpers) **/

async function readJson(req) {
    try {
        if (req.body && Object.keys(req.body).length > 0) {
            return typeof req.body === 'object' ? req.body : JSON.parse(req.body);
        }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return {};
        return JSON.parse(raw);
    } catch (e) {
        throw new Error(`Invalid JSON payload: ${e.message}`);
    }
}

function extractJSON(text){
  if(!text) return null;
  const cleanText = text.trim().replace(/^```(json)?|```$/g, '').trim();
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

function mergeArrays(a=[], b=[], keyFields=['medication', 'issue', 'gap', 'item', 'dx']){
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

// ======== V7.2: Enhanced Prompt with Embedded Chain-of-Thought (CoT) =========
// توجيه النموذج للتفكير النقدي داخل حقل مخصص قبل ملء التقرير.
function buildSystemPromptV7(lang='ar', specialty=''){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  
  return L(
`أنت "صيدلي سريري خبير ومدقق مطالبات تأمين". الأولوية القصوى هي سلامة المريض وتحديد المخاطر الدوائية.

# عملية التفكير الإلزامية (Chain-of-Thought):
**يجب عليك استخدام حقل \`_internal_reasoning_process\` كمسودة لتفكيرك النقدي المفصل.** اتبع هذه الخطوات داخله:
1. استخرج بيانات المريض (خاصة العمر) والتشخيصات.
2. أدرج جميع الأدوية وجرعاتها.
3. **التحليل النقدي (الأهم):** قم بتقييم التفاعلات، التكرار العلاجي (Duplication)، وموانع الاستعمال المطلقة (Contraindications). ابحث بنشاط عن مخاطر مثل "الضربة الثلاثية" (NSAID+Diuretic+ARB/ACEi) أو مخاطر هبوط السكر/الضغط لدى كبار السن.
4. حدد الفجوات العلاجية (Gap Analysis).
5. قرر تصنيف كل دواء (مقبول/مشكوك فيه/مرفوض) مع التبرير.

**بعد الانتهاء من التحليل في \`_internal_reasoning_process\`، قم بملء باقي حقول التقرير بناءً على استنتاجاتك.**

# هيكل JSON المطلوب (V7.2 - التزم به حرفيًا):
{
  "_internal_reasoning_process": "ضع هنا تحليلك النقدي المفصل خطوة بخطوة...",
  "patient_info": { "name": "", "age": "", "gender": "", "file_id": "" },
  "diagnoses": [""],
  "physician_info": { "name": "", "specialty": "" },
  "medication_review": [
    {
      "medication": "اسم الدواء/الإجراء",
      "dose_frequency": "الجرعة والتكرار",
      "duration_quantity": "المدة أو الكمية",
      "insurance_status_code": "GREEN|YELLOW|RED",
      "status_emoji": "🟢|🟡|🔴",
      "justification": "التعليل السريري والتأميني المفصل والنقدي (مستخرج من تحليل التفكير)",
      "action_required": "None|Monitor|Stop|Clarify|Switch"
    }
  ],
  "consultative_analysis": {
    "red_flags_immediate_action": [ { "issue": "", "recommendation": "" } ],
    "yellow_flags_monitoring_needed": [ { "issue": "", "recommendation": "" } ],
    "green_flags_appropriate_care": [ { "item": "", "note": "" } ]
  },
  "gap_analysis_missing_interventions": [ { "gap": "", "recommendation": "" } ],
  "executive_summary": "ملخص تنفيذي يركز على أهم نتائج مراجعة الأدوية وسلامة المريض."
}
`,
// English Prompt
`You are an Expert Clinical Pharmacist & Insurance Auditor. The highest priority is patient safety and identification of medication risks.

# Mandatory Chain-of-Thought Process:
**You MUST use the \`_internal_reasoning_process\` field as a scratchpad for your detailed critical thinking.** Follow these steps within it:
1. Extract patient data (especially age) and diagnoses.
2. List all medications and dosages.
3. **Critical Analysis (Most Important):** Evaluate interactions, Therapeutic Duplication, and absolute Contraindications. Actively look for risks like the "Triple Whammy" (NSAID+Diuretic+ARB/ACEi) or hypoglycemia/hypotension risks in the elderly.
4. Identify Gap Analysis.
5. Decide on the classification (Accepted/Questionable/Rejected) with justification.

**After completing the analysis in \`_internal_reasoning_process\`, fill the rest of the report fields based on your conclusions.**

# Required JSON Schema (V7.2 - Adhere Strictly):
[... English V7.2 Schema matching the Arabic one ...]
`);
}

// ======== بناء رسالة المستخدم (User Content) =========
function buildUserMessage({lang, context, text, images}){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  const truncatedText = (text || '').slice(0, 100000); 

  const meta = L(
`# سياق المراجعة
اللغة المطلوبة للتقرير: العربية
سياق المطالبة/هدف المراجعة: ${context||'مراجعة شاملة للأدوية الموصوفة وملاءمتها التأمينية والسريرية'}

# المستندات المتاحة للتحليل
عدد الصور/الصفحات المرئية: ${images?.length||0}

## المحتوى النصي المستخرج (إن وجد)
<EXTRACTED_TEXT>
${truncatedText||'لا يوجد نص مستخرج. اعتمد على الصور بشكل كامل.'}
</EXTRACTED_TEXT>

# المهمة
حلل النص والصور المرئية (المرفقة) معًا. اتبع تعليمات النظام (بما في ذلك عملية التفكير CoT) بدقة وأعد تقرير JSON (V7.2) فقط.`,
`# Review Context
[English context mirroring Arabic structure]`
);
  return meta;
}

// ======== استدعاء GPT‑4o (Updated for V7.2) =========
async function callOpenAI({lang, specialty, userMsg, images}){
  if(!OPENAI_API_KEY) return { ok:false, data:null, note:'OPENAI_API_KEY missing' };
  
  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    const content = [{ type:'text', text:userMsg }];
    for(const b64 of (images||[])){
      content.push({ type:'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" } });
    }
    // استخدام الموجه المحسن V7.2 (CoT)
    const system = buildSystemPromptV7(lang, specialty);
  
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.2, // زيادة طفيفة من 0.1 للسماح بتفكير أعمق مع الحفاظ على الدقة
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

// ======== استدعاء Gemini (Updated for V7.2) =========
async function callGemini({lang, specialty, userMsg, images}){
  if(!GEMINI_API_KEY) return { ok:false, data:null, note:'GEMINI_API_KEY missing' };

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // استخدام الموجه المحسن V7.2 (CoT)
    const system = buildSystemPromptV7(lang, specialty);

    const model = genAI.getGenerativeModel({ 
        model: GEMINI_MODEL,
        systemInstruction: system,
        generationConfig: { 
            temperature: 0.2, // زيادة طفيفة من 0.1
            maxOutputTokens: MAX_TOKENS,
            responseMimeType: "application/json" 
        }
    });

    const parts = [{ text: userMsg }];
    for(const b64 of (images||[])){
      parts.push({ inlineData:{ mimeType:'image/jpeg', data:b64 }});
    }

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

// =====================================================================
// *** V7.2: Smart Scoring and Merging Logic (Enhanced) ***
// =====================================================================

// دالة تقييم جودة التقرير (مُحسّنة)
function scoreReport(report) {
    if (!report || Object.keys(report).length === 0) return 0;
    let score = 0;

    const analysis = report.consultative_analysis || {};
    const medicationReview = report.medication_review || [];
    const reasoning = report._internal_reasoning_process || "";

    // 1. جودة التفكير (CoT) - وزن مرتفع
    if (reasoning.length > 100) {
        score += Math.min(reasoning.length / 10, 200); // مكافأة على التفكير المفصل
    }

    // 2. تحديد المخاطر العالية (وزن مرتفع جداً)
    const redFlags = analysis.red_flags_immediate_action || [];
    score += redFlags.length * 50;
    
    // مكافأة خاصة لتحديد المشاكل الحرجة (التكرار، التفاعلات الخطيرة)
    const criticalKeywords = ['تكرار', 'duplication', 'interaction', 'تفاعل', 'contraindication', 'موانع', 'triple whammy', 'ثلاثية', 'خطير', 'dangerous', 'risk', 'خطر'];
    
    // التحقق من وجود الكلمات المفتاحية في Red Flags أو في التفكير الداخلي
    if (redFlags.some(f => criticalKeywords.some(kw => f.issue.toLowerCase().includes(kw))) ||
        criticalKeywords.some(kw => reasoning.toLowerCase().includes(kw))) {
        score += 150;
    }

    // 3. تحديد الملاحظات
    score += (analysis.yellow_flags_monitoring_needed?.length || 0) * 20;
    
    // 4. عمق التحليل (متوسط طول التعليل)
    if (medicationReview.length > 0) {
        const totalLength = medicationReview.reduce((sum, item) => sum + (item.justification?.length || 0), 0);
        const avgLength = totalLength / medicationReview.length;
        score += Math.min(avgLength, 300) * 0.5; 
    }
    
    // 5. تحليل الفجوات
    score += (report.gap_analysis_missing_interventions?.length || 0) * 15;

    return score;
}

// دمج التقريرين (V7.2 - يستخدم التقييم الذكي)
function mergeReportsV7(a={}, b={}, lang='ar'){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  const get = (obj, path, def=[]) => path.split('.').reduce((o, k) => (o || {})[k], obj) || def;

  // استخدام scoreReport لاختيار التقرير الأفضل جودة
  const scoreA = scoreReport(a);
  const scoreB = scoreReport(b);

  console.log(`Report Quality Scores: A=${scoreA.toFixed(1)}, B=${scoreB.toFixed(1)}`);

  // اختيار التقرير ذو الجودة الأعلى كالأساس
  const primary = scoreA >= scoreB ? a : b;
  const secondary = scoreA >= scoreB ? b : a;

  // استراتيجية الدمج V7.2: نعتمد التقرير الأساسي (الأعلى جودة) ونُكمّل القوائم المستقلة.
  const merged = {
    // نحتفظ بمسودة التفكير للتقرير الأساسي لأغراض التشخيص (اختياري)
    // _internal_reasoning_process: primary._internal_reasoning_process || secondary._internal_reasoning_process,

    patient_info: primary.patient_info || secondary.patient_info || {},
    physician_info: primary.physician_info || secondary.physician_info || {},
    
    diagnoses: mergeArrays(a.diagnoses, b.diagnoses),

    // ** مراجعة الأدوية: نستخدم القائمة من التقرير الأعلى جودة (الأساسي) فقط. **
    medication_review: primary.medication_review || secondary.medication_review || [],

    // التحليل الاستشاري: دمج الأقسام الفرعية (Red/Yellow) لزيادة الشمولية
    consultative_analysis: {
        red_flags_immediate_action: mergeArrays(get(a, 'consultative_analysis.red_flags_immediate_action'), get(b, 'consultative_analysis.red_flags_immediate_action')),
        yellow_flags_monitoring_needed: mergeArrays(get(a, 'consultative_analysis.yellow_flags_monitoring_needed'), get(b, 'consultative_analysis.yellow_flags_monitoring_needed')),
        green_flags_appropriate_care: get(primary, 'consultative_analysis.green_flags_appropriate_care') || get(secondary, 'consultative_analysis.green_flags_appropriate_care'),
    },

    // تحليل الفجوات: دمج
    gap_analysis_missing_interventions: mergeArrays(a.gap_analysis_missing_interventions, b.gap_analysis_missing_interventions),
    
    // الملخص التنفيذي: نستخدم الأساسي
    executive_summary: primary.executive_summary || secondary.executive_summary || ''
  };

  // إضافة ملاحظة السلامة
  merged.patient_safety_note = L(
    "إخلاء مسؤولية: هذا التقرير ناتج عن تحليل آلي (AI) وهو مخصص لمراجعة الأدوية والتدقيق التأميني. يجب مراجعة جميع النتائج من قبل صيدلي سريري أو طبيب مرخص قبل اتخاذ أي قرارات علاجية.",
    "Disclaimer: This report is generated by AI for medication review and insurance audit purposes. All findings must be reviewed by a licensed clinical pharmacist or physician before making therapeutic decisions."
  );

  // إزالة حقل التفكير الداخلي من التقرير النهائي للمستخدم
  if (merged._internal_reasoning_process) {
    delete merged._internal_reasoning_process;
  }
  // التأكد من إزالته من التقارير الأصلية أيضاً قبل الدمج النهائي
  if (a._internal_reasoning_process) delete a._internal_reasoning_process;
  if (b._internal_reasoning_process) delete b._internal_reasoning_process;


  return merged;
}

// ============= نقطة الدخول (Handler) =============
export default async function handler(req, res){
  try{
    if(req.method !== 'POST') {
        return res.status(405).json({ok:false, error:'Use POST'});
    }
    
    const body = await readJson(req);

    const { lang='ar', modelChoice='both', specialty='', context='', images=[], text='', apiVersion='v7.2.0-node' } = body||{};
    
    const sanitizedText = text ? text.slice(0, 100000) : '';

    if (images.length === 0 && sanitizedText.trim().length === 0) {
        return res.status(400).json({ ok:false, error:"No content provided." });
    }

    if(!OPENAI_API_KEY && !GEMINI_API_KEY){
      return res.status(500).json({ ok:false, error:"Missing API keys." });
    }

    // تحضير رسالة المستخدم
    const userMsg = buildUserMessage({lang, context, text: sanitizedText, images});

    // تحديد النماذج
    const wantsGPT = (modelChoice==='both' || modelChoice==='gpt') && !!OPENAI_API_KEY;
    const wantsGem = (modelChoice==='both' || modelChoice==='gemini') && !!GEMINI_API_KEY;

    // التنفيذ المتوازي
    const [gptRes, gemRes] = await Promise.all([
      wantsGPT ? callOpenAI({lang, specialty, userMsg, images}) : Promise.resolve({ok:false, data:null, note:'Disabled or key missing.'}),
      wantsGem ? callGemini({lang, specialty, userMsg, images}) : Promise.resolve({ok:false, data:null, note:'Disabled or key missing.'})
    ]);

    // تجميع الأخطاء
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

    // الدمج باستخدام منطق V7.2 الذكي
    const merged = mergeReportsV7(gptRes.data || {}, gemRes.data || {}, lang);

    // الاستجابة النهائية
    return res.status(200).json({
      ok:true,
      version: apiVersion,
      errors: errors.length > 0 ? errors : undefined,
      merged,
      gpt: { ok:gptRes.ok, raw: gptRes.raw?.slice(0,150000), error: gptRes.error, note: gptRes.note },
      gemini: { ok:gemRes.ok, raw: gemRes.raw?.slice(0,150000), error: gemRes.error, note: gemRes.note }
    });

  }catch(err){
    console.error("Internal Handler Error:", err);
    return res.status(500).json({ ok:false, error:err?.message || String(err) });
  }
}
