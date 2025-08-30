// api/gpt.js (أو api/case-analyzer.js)
// V7.1 - Specialized Pharmacy Audit with Smart Merge Logic and Enhanced Critical Prompts (Node.js)

export const config = { 
    runtime: 'nodejs',
    maxDuration: 50 // زيادة المدة لضمان اكتمال التحليل العميق
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

// ======== V7.1: Enhanced Pharmacy Audit Prompt =========
// تعزيز التركيز على تحديد التكرار العلاجي، الموانع المطلقة، والمخاطر الحرجة.
function buildSystemPromptV7(lang='ar', specialty=''){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  
  return L(
`أنت "صيدلي سريري خبير ومدقق مطالبات تأمين" (Expert Clinical Pharmacist & Insurance Auditor). مهمتك تحليل الروشيتة/السجل الطبي المقدم بدقة فائقة. **الأولوية القصوى هي سلامة المريض وتحديد المخاطر الدوائية.**

# الأهداف الرئيسية:
1. استخراج بيانات المريض (العمر مهم جداً للتحليل)، التشخيصات، والطبيب.
2. **تحليل الأدوية النقدي (الأهم):** قم بتحليل كل دواء ضمن مصفوفة \`medication_review\`.
   - حدد موقف التأمين (🟢 مقبول/GREEN، 🟡 قابل للرفض/YELLOW، 🔴 مرفوض/RED).
   - **التعليل (justification):** هذا هو الجزء الأهم. قدم تبريراً سريرياً وتأمينياً مفصلاً. **ابحث بنشاط عن المشكلات التالية وصنفها كـ 🔴 RED أو 🟡 YELLOW:**
     - **التكرار العلاجي (Therapeutic Duplication):** (مثال: دوائين من نفس الفئة لضغط الدم بدون مبرر موثق لارتفاع ضغط مقاوم).
     - **التفاعلات الخطيرة** (مثل "الضربة الثلاثية/Triple Whammy": NSAID + Diuretic + ARB/ACEi).
     - **موانع الاستعمال المطلقة (Contraindications):** (مثال: NSAIDs لمريض فشل كلوي/قلب/قرحة نشطة).
     - **المخاطر لدى كبار السن (Beers Criteria):** (مثل زيادة خطر هبوط السكر باستخدام Sulfonylureas).
     - الجرعات غير المناسبة (عالية جداً أو منخفضة جداً).
     - المكملات الغذائية غير الضرورية تأمينياً.
3. **تحليل استشاري:** قدم تحليلاً مقسماً إلى Red Flags (مخاطر فورية)، Yellow Flags (يحتاج مراجعة)، Green Flags (مناسب).
4. **تحليل الفجوات (Gap Analysis):** حدد الفحوصات أو التدخلات الناقصة بناءً على الإرشادات العالمية.

# القواعد الصارمة:
- **JSON فقط.**

# هيكل JSON المطلوب (V7 - التزم به حرفيًا):
{
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
      "justification": "التعليل السريري والتأميني المفصل والنقدي (يجب ذكر التكرار، التفاعلات، الموانع هنا)",
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
`You are an Expert Clinical Pharmacist & Insurance Auditor. Your task is to analyze the provided prescription/medical record with extreme precision. **The highest priority is patient safety and identification of medication risks.**
[... English prompt mirroring the enhanced Arabic V7.1 instructions and Schema ...]
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
حلل النص والصور المرئية (المرفقة) معًا. اتبع تعليمات النظام بدقة وأعد تقرير JSON (V7) فقط.`,
`# Review Context
[English context mirroring Arabic structure]`
);
  return meta;
}

// ======== استدعاء GPT‑4o (Updated for V7.1) =========
async function callOpenAI({lang, specialty, userMsg, images}){
  if(!OPENAI_API_KEY) return { ok:false, data:null, note:'OPENAI_API_KEY missing' };
  
  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    const content = [{ type:'text', text:userMsg }];
    for(const b64 of (images||[])){
      content.push({ type:'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" } });
    }
    // استخدام الموجه المحسن V7.1
    const system = buildSystemPromptV7(lang, specialty);
  
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

// ======== استدعاء Gemini (Updated for V7.1) =========
async function callGemini({lang, specialty, userMsg, images}){
  if(!GEMINI_API_KEY) return { ok:false, data:null, note:'GEMINI_API_KEY missing' };

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // استخدام الموجه المحسن V7.1
    const system = buildSystemPromptV7(lang, specialty);

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
// *** V7.1: Smart Scoring and Merging Logic ***
// =====================================================================

// دالة تقييم جودة التقرير (الجديدة)
function scoreReport(report) {
    if (!report || Object.keys(report).length === 0) return 0;
    let score = 0;

    const analysis = report.consultative_analysis || {};
    const medicationReview = report.medication_review || [];

    // 1. تحديد المخاطر العالية (وزن مرتفع جداً)
    const redFlags = analysis.red_flags_immediate_action || [];
    score += redFlags.length * 50;
    
    // مكافأة خاصة لتحديد التكرار أو التفاعلات الخطيرة (مثل مثال المستخدم)
    const criticalKeywords = ['تكرار', 'duplication', 'interaction', 'تفاعل', 'contraindication', 'موانع', 'triple whammy', 'ثلاثية', 'خطير', 'dangerous'];
    if (redFlags.some(f => criticalKeywords.some(kw => f.issue.toLowerCase().includes(kw)))) {
        score += 150;
    }

    // 2. تحديد الملاحظات (وزن متوسط)
    score += (analysis.yellow_flags_monitoring_needed?.length || 0) * 20;
    
    // 3. عمق التحليل (قياس متوسط طول التعليل)
    if (medicationReview.length > 0) {
        const totalLength = medicationReview.reduce((sum, item) => sum + (item.justification?.length || 0), 0);
        const avgLength = totalLength / medicationReview.length;
        // مكافأة العمق (حتى 300 حرف متوسط يعتبر ممتازاً)
        score += Math.min(avgLength, 300) * 0.5; 
    }
    
    // 4. تحليل الفجوات
    score += (report.gap_analysis_missing_interventions?.length || 0) * 15;

    // 5. التغطية الأساسية (وزن منخفض)
    score += medicationReview.length * 5;

    return score;
}

// دمج التقريرين (V7.1 - يستخدم التقييم الذكي)
function mergeReportsV7(a={}, b={}, lang='ar'){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  const get = (obj, path, def=[]) => path.split('.').reduce((o, k) => (o || {})[k], obj) || def;

  // ** التغيير الحاسم: استخدام scoreReport لاختيار التقرير الأفضل جودة **
  const scoreA = scoreReport(a);
  const scoreB = scoreReport(b);

  console.log(`Report Quality Scores: A=${scoreA.toFixed(1)}, B=${scoreB.toFixed(1)}`);

  // اختيار التقرير ذو الجودة الأعلى كالأساس
  const primary = scoreA >= scoreB ? a : b;
  const secondary = scoreA >= scoreB ? b : a;

  // استراتيجية الدمج V7.1: نعتمد التقرير الأساسي (الأعلى جودة) ونُكمّل البيانات الوصفية والقوائم المستقلة.
  const merged = {
    // البيانات الوصفية
    patient_info: primary.patient_info || secondary.patient_info || {},
    physician_info: primary.physician_info || secondary.physician_info || {},
    
    // التشخيصات: دمج القوائم
    diagnoses: mergeArrays(a.diagnoses, b.diagnoses),

    // ** مراجعة الأدوية: نستخدم القائمة من التقرير الأعلى جودة (الأساسي) فقط لضمان الاتساق. **
    medication_review: primary.medication_review || secondary.medication_review || [],

    // التحليل الاستشاري: دمج الأقسام الفرعية (Red/Yellow) لزيادة الشمولية
    consultative_analysis: {
        red_flags_immediate_action: mergeArrays(get(a, 'consultative_analysis.red_flags_immediate_action'), get(b, 'consultative_analysis.red_flags_immediate_action')),
        yellow_flags_monitoring_needed: mergeArrays(get(a, 'consultative_analysis.yellow_flags_monitoring_needed'), get(b, 'consultative_analysis.yellow_flags_monitoring_needed')),
        // Green flags نأخذها من الأساسي
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

  return merged;
}

// ============= نقطة الدخول (Handler) =============
export default async function handler(req, res){
  try{
    if(req.method !== 'POST') {
        return res.status(405).json({ok:false, error:'Use POST'});
    }
    
    const body = await readJson(req);

    const { lang='ar', modelChoice='both', specialty='', context='', images=[], text='', apiVersion='v7.1.0-node' } = body||{};
    
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

    // الدمج باستخدام منطق V7.1 الذكي
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
