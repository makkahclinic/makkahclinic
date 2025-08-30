// api/case-analyzer.js
// V8.0 - Clinical Consultant Engine with Advanced Heuristics & Granular Merge (Node.js)

export const config = {
    runtime: 'nodejs',
    maxDuration: 60 // Increased duration for deeper analysis
};

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || '';

const OPENAI_MODEL = "gpt-4o-2024-08-06";
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const MAX_TOKENS = 16384;

/** Helpers (unchanged, but still crucial) **/
async function readJson(req) { /* ... same as V7.2 ... */ }
function extractJSON(text){ /* ... same as V7.2 ... */ }
function mergeArrays(a=[], b=[], keyFields=['medication', 'issue', 'gap', 'item', 'dx']){ /* ... same as V7.2 ... */ }

// ===================================================================================
// *** V8: SUPERCHARGED System Prompt - The Core of the Clinical Consultant Engine ***
// ===================================================================================
function buildSystemPromptV8(lang = 'ar', specialty = '') {
    const L = (ar, en) => (lang === 'ar' ? ar : en);

    return L(
`أنت "استشاري صيدلة سريرية وخبير تدقيق تأمين". مهمتك ليست مجرد استخراج المعلومات، بل إجراء تحليل نقدي عميق كخبير طبي. سلامة المريض هي الأولوية المطلقة.

# عملية التفكير الإلزامية (Chain-of-Thought) داخل \`_internal_reasoning_process\`:
1.  **استيعاب الحالة:** لخص عمر المريض، جنسه، وتشخيصاته الأساسية.
2.  **جرد الأدوية:** أدرج كل دواء مع جرعته وتكراره ومدته.
3.  **التحليل السريري النقدي (الأهم):** يجب عليك تقييم كل دواء ومنظومة الأدوية بالكامل من خلال عدسة القواعد السريرية التالية:
    * **التفاعلات الدوائية الخطيرة:** ابحث عن أي تفاعلات مهمة.
    * **التكرار العلاجي:** هل يوجد دواءان من نفس الفئة؟ (مثال: 2 من مضادات الالتهاب غير الستيرويدية).
    * **موانع الاستعمال:** هل الدواء ممنوع استخدامه مع تشخيص معين؟
    * **قواعد سريرية إلزامية للبحث عنها (Mandatory Heuristics):**
        * **الضربة الثلاثية الكلوية (Triple Whammy):** ابحث بقوة عن تركيبة (NSAID + Diuretic + ACEi/ARB).
        * **متلازمة السيروتونين:** ابحث عن تركيبة (SSRI/SNRI + Tramadol/Triptans/MAOI).
        * **مخاطر النزيف العالية:** ابحث عن تركيبة (Anticoagulant + Antiplatelet + NSAID).
        * **إطالة فترة QT (QTc Prolongation):** ابحث عن أدوية معروفة بذلك (مثل Macrolides + Antipsychotics).
        * **معايير بيرز (Beers Criteria):** لكبار السن (>65)، تحقق من وجود أدوية غير مناسبة (مثل مضادات الهيستامين من الجيل الأول، البنزوديازيبينات طويلة المفعول).
    * **تقييم الجرعة:** هل الجرعة مناسبة للتشخيص والعمر؟ هل قد تحتاج لتعديل في حالة وجود قصور كلوي/كبدي (اذكر هذه الملاحظة كتحذير).
4.  **تحليل الفجوات (Gap Analysis):** فكر كطبيب استشاري. ما هي الفحوصات أو التدخلات المفقودة؟ (أمثلة: مريض سكري بدون فحص HbA1c أو فحص قاع عين، مريض ضغط بدون متابعة وظائف الكلى، مريض يأخذ ستاتين بدون تحليل LFTs).
5.  **الاستنتاج النهائي:** بناءً على ما سبق، صنّف كل دواء واملأ تقرير JSON.

**بعد إكمال هذا التحليل العميق في \`_internal_reasoning_process\`, قم بتعبئة هيكل JSON V8 بدقة.**

# هيكل JSON المطلوب (V8 - التزم به حرفيًا):
{
  "_internal_reasoning_process": "ضع هنا تحليلك النقدي المفصل خطوة بخطوة بناءً على التعليمات أعلاه...",
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
      "clinical_risk_level": "None|Low|Medium|High|Critical",
      "justification": "تعليل سريري وتأميني مفصل جدًا، يوضح سبب القبول أو الرفض والمخاطر المحددة (مثال: 'مقبول لعلاج السكري، لكن الجرعة قد تحتاج مراجعة لكبار السن').",
      "action_required": "None|Monitor|Stop|Clarify Dose|Switch"
    }
  ],
  "consultative_analysis": {
    "red_flags_immediate_action": [ { "issue": "وصف المشكلة الخطيرة", "recommendation": "التوصية الفورية" } ],
    "yellow_flags_monitoring_needed": [ { "issue": "وصف المشكلة التي تتطلب متابعة", "recommendation": "التوصية بالمتابعة" } ],
    "green_flags_appropriate_care": [ { "item": "العنصر المناسب", "note": "ملاحظة" } ]
  },
  "gap_analysis_missing_interventions": [ { "gap": "الفجوة العلاجية (فحص/إجراء ناقص)", "recommendation": "التوصية بإجرائه" } ],
  "executive_summary": "ملخص تنفيذي يركز على أهم المخاطر الدوائية المكتشفة، الفجوات العلاجية، والتوصيات الرئيسية لضمان سلامة المريض."
}
`,
// English V8 Prompt mirrors the detailed Arabic version
`You are a Board-Certified Clinical Pharmacist and an expert Insurance Auditor. Your task is not merely to extract data, but to perform a deep, critical analysis like a seasoned medical expert. Patient safety is the absolute priority.

# Mandatory Chain-of-Thought Process inside \`_internal_reasoning_process\`:
1.  **Case Assimilation:** Summarize patient age, gender, and primary diagnoses.
2.  **Medication Inventory:** List every drug with its dose, frequency, and duration.
3.  **Critical Clinical Analysis (Most Important):** You MUST evaluate each drug and the entire regimen through the lens of the following clinical heuristics:
    * **Significant Drug Interactions:** Look for any major interactions.
    * **Therapeutic Duplication:** Are there two drugs from the same class? (e.g., 2 NSAIDs).
    * **Contraindications:** Is a drug contraindicated for a specific diagnosis?
    * **Mandatory Heuristics to Actively Screen For:**
        * **The Triple Whammy (Renal Risk):** Aggressively search for the (NSAID + Diuretic + ACEi/ARB) combination.
        * **Serotonin Syndrome:** Screen for (SSRI/SNRI + Tramadol/Triptans/MAOI).
        * **High Bleeding Risk:** Screen for (Anticoagulant + Antiplatelet + NSAID).
        * **QTc Prolongation:** Identify known culprits (e.g., Macrolides + Antipsychotics).
        * **Beers Criteria:** For elderly patients (>65), check for inappropriate medications (e.g., first-gen antihistamines, long-acting benzodiazepines).
    * **Dose Evaluation:** Is the dose appropriate for the diagnosis and age? Could it need adjustment for potential renal/hepatic impairment (flag this as a cautionary note).
4.  **Gap Analysis:** Think like a consultant physician. What necessary tests or interventions are missing? (e.g., a diabetic patient without an HbA1c or eye exam, a hypertensive patient without renal function monitoring, a patient on a statin without LFTs).
5.  **Final Conclusion:** Based on the above, classify each drug and populate the JSON report.

**After completing this deep analysis in \`_internal_reasoning_process\`, meticulously fill the V8 JSON schema.**

# Required JSON Schema (V8 - Adhere Strictly):
[... English V8 Schema matching the Arabic one ...]
`
    );
}

function buildUserMessage({lang, context, text, images}){ /* ... same as V7.2 ... */ }

// ======== API Call Functions (Updated to use V8 prompt) =========
async function callOpenAI({lang, specialty, userMsg, images}){
    if(!OPENAI_API_KEY) return { ok:false, data:null, note:'OPENAI_API_KEY missing' };
    try {
        const client = new OpenAI({ apiKey: OPENAI_API_KEY });
        const content = [{ type:'text', text:userMsg }];
        for(const b64 of (images||[])){
            content.push({ type:'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" } });
        }
        // Using the enhanced V8 prompt
        const system = buildSystemPromptV8(lang, specialty);
    
        const completion = await client.chat.completions.create({
            model: OPENAI_MODEL,
            temperature: 0.15, // Slightly lower for more deterministic clinical output
            response_format: { type: "json_object" },
            max_tokens: MAX_TOKENS,
            messages: [
                { role:"system", content: system },
                { role:"user",   content: content }
            ]
        });
        const raw = completion.choices?.[0]?.message?.content;
        const data = extractJSON(raw);
        if (!data) throw new Error("Failed to extract valid JSON from OpenAI response.");
        return { ok:true, raw, data };
    } catch (e) { /* ... same error handling ... */ }
}

async function callGemini({lang, specialty, userMsg, images}){
    if(!GEMINI_API_KEY) return { ok:false, data:null, note:'GEMINI_API_KEY missing' };
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        // Using the enhanced V8 prompt
        const system = buildSystemPromptV8(lang, specialty);
        const model = genAI.getGenerativeModel({ 
            model: GEMINI_MODEL,
            systemInstruction: system,
            generationConfig: { 
                temperature: 0.15,
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
    } catch (e) { /* ... same error handling ... */ }
}

// ================================================================
// *** V8: Advanced Scoring and Merging Logic ***
// ================================================================

function scoreReportV8(report) {
    if (!report || Object.keys(report).length === 0) return 0;
    let score = 0;
    const reasoning = (report._internal_reasoning_process || "").toLowerCase();
    const analysis = report.consultative_analysis || {};
    const medicationReview = report.medication_review || [];

    // 1. CoT Quality
    if (reasoning.length > 150) score += Math.min(reasoning.length / 5, 250);

    // 2. Identification of Critical Risks (Massive Bonus)
    const criticalKeywords = ['triple whammy', 'serotonin syndrome', 'bleeding risk', 'qt prolongation', 'beers criteria', 'contraindication', 'تكرار علاجي', 'الضربة الثلاثية', 'متلازمة السيروتونين'];
    const foundKeywords = criticalKeywords.filter(kw => reasoning.includes(kw));
    score += foundKeywords.length * 200; // HUGE bonus for each specific heuristic identified.

    // 3. Flag Severity
    score += (analysis.red_flags_immediate_action?.length || 0) * 75;
    score += (analysis.yellow_flags_monitoring_needed?.length || 0) * 30;
    
    // 4. Gap Analysis Depth
    score += (report.gap_analysis_missing_interventions?.length || 0) * 40;

    // 5. Justification Depth
    if (medicationReview.length > 0) {
        const totalLength = medicationReview.reduce((sum, item) => sum + (item.justification?.length || 0), 0);
        score += Math.min(totalLength / medicationReview.length, 400) * 0.5;
    }

    return score;
}

// V8 Merge: More granular, merges medication lists
function mergeReportsV8(a={}, b={}, lang='ar'){
    const scoreA = scoreReportV8(a);
    const scoreB = scoreReportV8(b);
    console.log(`Report Quality Scores (V8): A=${scoreA.toFixed(1)}, B=${scoreB.toFixed(1)}`);

    const primary = scoreA >= scoreB ? a : b;
    const secondary = scoreA >= scoreB ? b : a;
    
    // Helper to get nested properties safely
    const get = (obj, path, def=[]) => path.split('.').reduce((o, k) => (o || {})[k], obj) || def;

    // Granular medication review merge
    const mergedMedReview = mergeArrays(
        get(a, 'medication_review'), 
        get(b, 'medication_review')
    );

    const merged = {
        patient_info: primary.patient_info || secondary.patient_info || {},
        physician_info: primary.physician_info || secondary.physician_info || {},
        diagnoses: mergeArrays(a.diagnoses, b.diagnoses),
        
        // ** V8 Change: Use the more comprehensive merged medication list **
        medication_review: mergedMedReview,

        consultative_analysis: {
            red_flags_immediate_action: mergeArrays(get(a, 'consultative_analysis.red_flags_immediate_action'), get(b, 'consultative_analysis.red_flags_immediate_action')),
            yellow_flags_monitoring_needed: mergeArrays(get(a, 'consultative_analysis.yellow_flags_monitoring_needed'), get(b, 'consultative_analysis.yellow_flags_monitoring_needed')),
            green_flags_appropriate_care: mergeArrays(get(a, 'consultative_analysis.green_flags_appropriate_care'), get(b, 'consultative_analysis.green_flags_appropriate_care')),
        },

        gap_analysis_missing_interventions: mergeArrays(a.gap_analysis_missing_interventions, b.gap_analysis_missing_interventions),
        
        executive_summary: primary.executive_summary || secondary.executive_summary || ''
    };
    
    // Add disclaimer and clean up internal reasoning field
    /* ... same as V7.2 ... */

    return merged;
}

// ============= Handler (Updated to use V8 logic) =============
export default async function handler(req, res){
    try {
        // ... (request validation, readJson) ... same as before
        const body = await readJson(req);
        const { lang='ar', modelChoice='both', specialty='', context='', images=[], text='' } = body||{};
        
        // ... (input validation, key checks) ... same as before
        
        const userMsg = buildUserMessage({lang, context, text, images});

        const wantsGPT = (modelChoice==='both' || modelChoice==='gpt') && !!OPENAI_API_KEY;
        const wantsGem = (modelChoice==='both' || modelChoice==='gemini') && !!GEMINI_API_KEY;

        const [gptRes, gemRes] = await Promise.all([
            wantsGPT ? callOpenAI({lang, specialty, userMsg, images}) : Promise.resolve({ok:false, data:null, note:'Disabled or key missing.'}),
            wantsGem ? callGemini({lang, specialty, userMsg, images}) : Promise.resolve({ok:false, data:null, note:'Disabled or key missing.'})
        ]);
        
        // ... (error aggregation) ... same as before

        if (!gptRes.data && !gemRes.data) {
            return res.status(500).json({ ok:false, error:"Both models failed.", errors });
        }

        // Use the V8 Smart Merge
        const merged = mergeReportsV8(gptRes.data || {}, gemRes.data || {}, lang);

        return res.status(200).json({
            ok:true,
            version: 'v8.0.0-node-consultant',
            errors: errors.length > 0 ? errors : undefined,
            merged,
            gpt: { ok:gptRes.ok, raw: gptRes.raw, error: gptRes.error, note: gptRes.note },
            gemini: { ok:gemRes.ok, raw: gemRes.raw, error: gemRes.error, note: gemRes.note }
        });
    } catch(err) {
        // ... (final error handling) ... same as before
    }
}
