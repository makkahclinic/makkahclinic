// api/gpt.js (أو api/case-analyzer.js)
// V7.0 - Specialized Pharmacy/Prescription Audit (Node.js)

export const config = { 
    runtime: 'nodejs',
    maxDuration: 45 // زيادة المدة نظراً لعمق التحليل المطلوب
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

// Specialized V7 Merge Logic
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

// ======== V7.0: Specialized Pharmacy Audit Prompt and Schema =========
// هذا الموجه مستوحى بشكل كبير من الأمر الناجح الذي زودتني به.
function buildSystemPromptV7(lang='ar', specialty=''){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  
  return L(
`أنت "صيدلي سريري خبير ومدقق مطالبات تأمين" (Expert Clinical Pharmacist & Insurance Auditor). مهمتك تحليل الروشيتة/السجل الطبي المقدم بدقة فائقة لتقييم الأدوية الموصوفة.

# الأهداف الرئيسية:
1. استخراج بيانات المريض (الاسم، العمر، النوع، رقم الملف) والتشخيصات واسم الطبيب وتخصصه.
2. **تحليل الأدوية (الأهم):** قم بتحليل كل دواء أو إجراء موصوف بالتفصيل (ضمن مصفوفة \`medication_review\`).
   - حدد الجرعة/التكرار (\`dose_frequency\`) والمدة/الكمية (\`duration_quantity\`).
   - حدد موقف التأمين باستخدام الرموز (🟢 مقبول، 🟡 قابل للرفض/يحتاج مراجعة، 🔴 مرفوض) والترميز (GREEN, YELLOW, RED).
   - **التعليل (justification):** قدم تبريراً سريرياً وتأمينياً مفصلاً. اذكر مدى ملاءمة الدواء للتشخيص، تضارب الأدوية (Drug Interactions)، الجرعات الخاطئة (مثل جرعة زائدة تؤدي لهبوط ضغط/سكر)، مخالفة الإرشادات (Guidelines)، أو إذا كان مجرد مكمل غذائي غير ضروري. كن ناقداً ودقيقاً.
   - حدد الإجراء المطلوب (action_required).
3. **تحليل استشاري:** قدم تحليلاً مقسماً إلى: إجراءات خطرة يجب إيقافها (Red Flags)، إجراءات تحتاج مراجعة/مشكوك فيها (Yellow Flags)، وإجراءات مناسبة (Green Flags).
4. **تحليل الفجوات (Gap Analysis):** حدد الفحوصات أو التدخلات الناقصة بناءً على التشخيصات (مثل فحص قاع العين للسكري، وظائف الكلى، متابعة القلب لمرضى IHD).

# القواعد الصارمة:
- **JSON فقط:** سيتم فرض إخراج JSON عبر الـ API.
- **الدقة:** كن دقيقاً جداً في قراءة أسماء الأدوية والجرعات من الصور.

# هيكل JSON المطلوب (V7 - التزم به حرفيًا):
{
  "patient_info": { "name": "", "age": "", "gender": "", "file_id": "" },
  "diagnoses": [""],
  "physician_info": { "name": "", "specialty": "" },
  "medication_review": [
    {
      "medication": "اسم الدواء/الإجراء",
      "dose_frequency": "الجرعة والتكرار (مثال: 1x1, TID)",
      "duration_quantity": "المدة أو الكمية (مثال: 90 يوم)",
      "insurance_status_code": "GREEN|YELLOW|RED",
      "status_emoji": "🟢|🟡|🔴",
      "justification": "التعليل السريري والتأميني المفصل (تفاعلات، جرعة، إرشادات)",
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
// English Prompt (Mirroring the Arabic V7 structure and goals)
`You are an Expert Clinical Pharmacist & Insurance Auditor. Your task is to analyze the provided prescription/medical record with extreme precision to evaluate the prescribed medications.
[... English prompt mirroring the Arabic instructions and V7 Schema ...]
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

// ======== استدعاء GPT‑4o (Updated for V7) =========
async function callOpenAI({lang, specialty, userMsg, images}){
  if(!OPENAI_API_KEY) return { ok:false, data:null, note:'OPENAI_API_KEY missing' };
  
  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    const content = [{ type:'text', text:userMsg }];
    for(const b64 of (images||[])){
      // استخدام detail: high لقراءة دقيقة للروشتات
      content.push({ type:'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" } });
    }
    // استخدام الموجه المتخصص V7
    const system = buildSystemPromptV7(lang, specialty);
  
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.1, // دقة عالية مطلوبة لمراجعة الأدوية
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

// ======== استدعاء Gemini (Updated for V7) =========
async function callGemini({lang, specialty, userMsg, images}){
  if(!GEMINI_API_KEY) return { ok:false, data:null, note:'GEMINI_API_KEY missing' };

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // استخدام الموجه المتخصص V7
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

// ======== دمج التقريرين (V7 Merge Logic) =========
function mergeReportsV7(a={}, b={}, lang='ar'){
  const L = (ar,en)=> (lang==='ar'? ar : en);
  const get = (obj, path, def=[]) => path.split('.').reduce((o, k) => (o || {})[k], obj) || def;

  // تحديد التقرير الأساسي (الذي يحتوي على قائمة أدوية أكثر تفصيلاً)
  const scoreA = get(a, 'medication_review').length;
  const scoreB = get(b, 'medication_review').length;
  const primary = scoreA >= scoreB ? a : b;
  const secondary = scoreA >= scoreB ? b : a;

  // استراتيجية الدمج V7: نعتمد التقرير الأساسي (الأكثر اكتمالاً) ونُكمّل البيانات الناقصة من الثانوي.
  const merged = {
    patient_info: primary.patient_info || secondary.patient_info || {},
    physician_info: primary.physician_info || secondary.physician_info || {},
    
    // دمج قوائم التشخيص
    diagnoses: mergeArrays(a.diagnoses, b.diagnoses),

    // مراجعة الأدوية: نستخدم القائمة الأكثر شمولاً (الأساسية) لأن دمج المراجعات المعقدة يقلل الجودة غالباً.
    medication_review: primary.medication_review || secondary.medication_review || [],

    // التحليل الاستشاري: دمج الأقسام الفرعية
    consultative_analysis: {
        red_flags_immediate_action: mergeArrays(get(a, 'consultative_analysis.red_flags_immediate_action'), get(b, 'consultative_analysis.red_flags_immediate_action')),
        yellow_flags_monitoring_needed: mergeArrays(get(a, 'consultative_analysis.yellow_flags_monitoring_needed'), get(b, 'consultative_analysis.yellow_flags_monitoring_needed')),
        green_flags_appropriate_care: mergeArrays(get(a, 'consultative_analysis.green_flags_appropriate_care'), get(b, 'consultative_analysis.green_flags_appropriate_care')),
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

    const { lang='ar', modelChoice='both', specialty='', context='', images=[], text='', apiVersion='v7.0.0-node' } = body||{};
    
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
        // ملاحظة: نستدعي الوظائف القياسية التي تستخدم الآن موجه V7 داخلياً.
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

    // الدمج باستخدام منطق V7
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
