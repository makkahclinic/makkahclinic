// /api/unified-expert-analyzer.js — Advanced Medical-Operational Analyzer Prototype
// Runtime: Vercel / Next.js API Route (Node 18+)
// WARNING: For Educational & Prototyping Purposes ONLY. Not for clinical use.

// ========================= ENV (Vercel → Settings → Environment Variables) =========================
// GEMINI_API_KEY=your_gemini_api_key_here
// ==================================================================================================

import { createHash } from "crypto";

// =============== CONFIGURATION ===============
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const DEFAULT_TIMEOUT_MS = 180_000;

// =============== MOCK DRUG DATABASE & CLINICAL KNOWLEDGE BASE ===============
// In a real system, this would be a dedicated API or a large, validated database.
const CLINICAL_KNOWLEDGE_BASE = {
    // Drug Families & Classes
    'triplixam': { family: 'ACEI_COMBO', classes: ['ace_inhibitor', 'ccb', 'diuretic'], components: ['perindopril', 'amlodipine', 'indapamide'] },
    'co-taburan': { family: 'ARB_COMBO', classes: ['arb', 'diuretic'], components: ['valsartan', 'hydrochlorothiazide'] },
    'amlodipine': { family: 'CCB', classes: ['ccb'] },
    'metformin': { family: 'Biguanide', classes: ['antidiabetic'] },
    'diamicron': { family: 'Sulfonylurea', classes: ['antidiabetic'] },
    'duodart': { family: 'BPH_MED', classes: ['5-alpha_reductase_inhibitor'], forGender: 'male' },
    'rozavi': { family: 'Statin', classes: ['statin'] },
    // A mapping of common names/typos to the canonical name
    'canonicalNames': {
        'triplex': 'triplixam',
        'metformin xr': 'metformin',
        'form xr': 'metformin',
        'co taburan': 'co-taburan',
        'diamicron mr': 'diamicron'
    }
};

// =============== CORE ALGORITHMS & HELPERS ===============

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchWithRetry(url, options, { retries = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok && retries > 0 && [429, 500, 503].includes(response.status)) {
            await sleep((4 - retries) * 1000);
            return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
        }
        return response;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Normalizes a drug name using the knowledge base.
 * @param {string} name - The raw drug name.
 * @returns {string} The canonical drug name in lowercase.
 */
function getCanonicalDrugName(name) {
    if (!name) return "";
    const lowerName = name.trim().toLowerCase();
    return CLINICAL_KNOWLEDGE_BASE.canonicalNames[lowerName] || lowerName;
}

/**
 * Enriches a list of drug names with structured data from the knowledge base.
 * @param {string[]} medicationNames - An array of raw drug names.
 * @returns {object[]} An array of structured drug objects.
 */
function enrichMedicationData(medicationNames) {
    const uniqueNames = [...new Set(medicationNames.map(getCanonicalDrugName).filter(Boolean))];
    return uniqueNames.map(name => ({
        name: name,
        ...CLINICAL_KNOWLEDGE_BASE[name]
    }));
}

// =============== LAYER 2: KNOWLEDGE EXTRACTION (NER) ===============
async function extractMedicalEntities(text, apiKey) {
    if (!text || !text.trim()) {
        return { medications: [], diagnoses: [], symptoms: [] };
    }
    const NER_PROMPT = `Analyze the following medical text. Extract key entities.
Format the output as a single, clean JSON object: {"medications": ["drug name"], "diagnoses": ["condition"], "symptoms": ["symptom"]}.
If you find nothing for a category, return an empty array.
TEXT: "${text}"`;
    
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        const payload = {
            contents: [{ role: "user", parts: [{ text: NER_PROMPT }] }],
            generationConfig: { response_mime_type: "application/json", temperature: 0.1 }
        };
        const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) return { medications: [], diagnoses: [], symptoms: [] };
        const raw = await res.text();
        // Clean the response from markdown backticks
        const cleanedJsonString = raw.replace(/```json|```/g, "").trim();
        const j = JSON.parse(cleanedJsonString);
        return j?.candidates?.[0]?.content?.parts?.[0]?.text ? JSON.parse(j.candidates[0].content.parts[0].text) : { medications: [], diagnoses: [], symptoms: [] };
    } catch (e) {
        console.error("NER Extraction Failed:", e);
        return { medications: [], diagnoses: [], symptoms: [] }; // Fallback on error
    }
}


// =============== LAYER 3: CLINICAL RULES ENGINE ===============
function clinicalRulesEngine(patientData, enrichedMeds) {
    const alerts = [];
    const recommendations = [];
    const insuranceDecisions = {};

    const context = {
        ...patientData,
        meds: enrichedMeds,
        hasMedClass: (cls) => enrichedMeds.some(m => m.classes?.includes(cls)),
        hasMedFamily: (fam) => enrichedMeds.some(m => m.family === fam),
        getMed: (name) => enrichedMeds.find(m => m.name === name)
    };

    // --- RULE SET ---

    // 1. Critical Interaction: ACEI + ARB
    if (context.hasMedFamily('ACEI_COMBO') && context.hasMedFamily('ARB_COMBO')) {
        alerts.push({ level: 'critical', text: 'تعارض خطير وممنوع: الجمع بين دواء يحتوي على ACEI (مثل Triplixam) وآخر يحتوي على ARB (مثل Co-Taburan).' });
        insuranceDecisions['co-taburan'] = `<span class="status-red">❌ مرفوض قطعًا (تعارض ACEI+ARB)</span>`;
    }

    // 2. Therapeutic Duplication: Redundant CCB
    if (context.getMed('amlodipine') && context.hasMedClass('ccb')) {
         if (context.getMed('triplixam')?.components?.includes('amlodipine')) {
            alerts.push({ level: 'high', text: 'ازدواجية علاجية: وصف Amlodipine بشكل منفصل مع Triplixam الذي يحتوي عليه بالفعل.' });
            insuranceDecisions['amlodipine'] = `<span class="status-yellow">⚠️ قابل للمراجعة: يُلغى لوجوده في Triplixam</span>`;
         }
    }

    // 3. Geriatric Risk: Hypoglycemia
    if (context.age > 65 && context.hasMedFamily('Sulfonylurea')) {
        alerts.push({ level: 'medium', text: 'خطر نقص السكر في الدم لدى كبار السن مرتفع مع استخدام Sulfonylurea (مثل Diamicron).' });
        insuranceDecisions['diamicron'] = `<span class="status-yellow">⚠️ موافقة بحذر: خطر نقص السكر لدى كبار السن</span>`;
    }
    
    // 4. Geriatric Risk: Falls
    const antiHypertensives = enrichedMeds.filter(m => m.classes?.includes('ace_inhibitor') || m.classes?.includes('arb') || m.classes?.includes('ccb') || m.classes?.includes('diuretic'));
    if (context.age > 65 && antiHypertensives.length >= 2) {
        alerts.push({ level: 'medium', text: 'خطر السقوط مرتفع بسبب وجود دوائين أو أكثر لخفض ضغط الدم.'});
    }

    // 5. Contraindication/Safety Check: Metformin & eGFR
    if (context.hasMedFamily('Biguanide')) {
        recommendations.push('**إلزامي قبل البدء:** فحص وظائف الكلى (eGFR/Creatinine). Metformin هو مضاد استطباب إذا كان eGFR < 30.');
        insuranceDecisions['metformin'] = `<span class="status-yellow">⚠️ موافقة مشروطة: بعد تأكيد eGFR ≥ 30</span>`;
    }
    
    // 6. Long-term Use Check: Metformin & B12
    if (context.hasMedFamily('Biguanide')) {
        recommendations.push('**للاستخدام طويل الأمد:** مراقبة مستوى فيتامين B12 بشكل دوري.');
    }

    // 7. Safety Monitoring: Statins & ACEI/ARB
    if (context.hasMedFamily('Statin')) recommendations.push('فحص إنزيمات الكبد (ALT/AST) عند البدء أو عند ظهور أعراض.');
    if (context.hasMedFamily('ACEI_COMBO') || context.hasMedFamily('ARB_COMBO')) {
        recommendations.push('فحص البوتاسيوم (K+) ووظائف الكلى بعد 1-2 أسبوع من بدء العلاج.');
    }

    // 8. Demographic Mismatch
    if (context.gender === 'female' && context.hasMedFamily('BPH_MED')) {
        alerts.push({ level: 'critical', text: 'خطأ جوهري: وصف دواء Duodart (لعلاج البروستاتا) لمريضة أنثى.' });
        insuranceDecisions['duodart'] = `<span class="status-red">❌ مرفوض ديموغرافيًا (دواء للرجال)</span>`;
    }
    
    // 9. Red Flag Rule: Smoker with Cough
    if (context.isSmoker && context.symptoms?.some(s => s.toLowerCase().includes('cough') || s.toLowerCase().includes('سعال'))) {
         recommendations.push('**تنبيه (Red Flag):** المريض مدخن ولديه سعال. **إجراء أشعة سينية على الصدر (Chest X-ray) ضروري** لاستبعاد أسباب خطيرة.');
    }

    return { alerts, recommendations, insuranceDecisions };
}


// =============== LAYER 5: SYNTHESIS & REPORT GENERATION ===============
function buildFinalReport(context) {
    const { patientData, alerts, recommendations, insuranceDecisions, allMeds } = context;

    const medicationRows = allMeds.map(med => {
        const canonicalName = getCanonicalDrugName(med);
        const decision = insuranceDecisions[canonicalName] || `<span class="status-green">✅ مقبول</span>`;
        return `<tr>
            <td>${med}</td>
            <td>${decision}</td>
        </tr>`;
    }).join('');

    const alertList = alerts.map(a => `<li class="alert-${a.level}">${a.text}</li>`).join('');
    const recList = recommendations.map(r => `<li>${r}</li>`).join('');

    return `
    <style>
      .status-green { display: inline-block; background-color: #d4edda; color: #155724; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #c3e6cb; }
      .status-yellow { display: inline-block; background-color: #fff3cd; color: #856404; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #ffeeba; }
      .status-red { display: inline-block; background-color: #f8d7da; color: #721c24; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #f5c6cb; }
      .section-title { color: #1e40af; font-weight: bold; border-bottom: 2px solid #1e40af; padding-bottom: 5px; margin-top: 20px; }
      .alert-critical { color: #721c24; font-weight: bold; }
      .alert-high { color: #856404; }
      .alert-medium { color: #0c5460; }
    </style>
    <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
    
    <h4 class="section-title">ملخص بيانات المريض</h4>
    <p>
        <strong>العمر:</strong> ${patientData.age || 'N/A'} | 
        <strong>الجنس:</strong> ${patientData.gender || 'N/A'} | 
        <strong>مدخن:</strong> ${patientData.isSmoker ? 'نعم' : 'لا'} | 
        <strong>ملاحظات:</strong> ${patientData.notes || 'لا يوجد'}
    </p>

    <h4 class="section-title">التحليل السريري العميق والتنبيهات</h4>
    ${alerts.length > 0 ? `<ul>${alertList}</ul>` : '<p>لم يتم رصد تنبيهات سريرية حرجة.</p>'}

    <h4 class="section-title">جدول قرارات التأمين للأدوية</h4>
    <table>
        <thead><tr><th>الدواء/الإجراء</th><th>قرار التأمين المبدئي</th></tr></thead>
        <tbody>${medicationRows}</tbody>
    </table>

    <h4 class="section-title">خطة العمل الإلزامية والخدمات الضرورية</h4>
    ${recommendations.length > 0 ? `<ul>${recList}</ul>` : '<p>لا توجد توصيات إلزامية بناءً على البيانات الحالية.</p>'}

    <hr>
    <p><strong>إخلاء مسؤولية:</strong> هذا التقرير تم إنشاؤه بواسطة نظام ذكاء اصطناعي وهو لأغراض توضيحية فقط ولا يغني عن الحكم السريري للطبيب المختص.</p>
    `;
}

// =============== API HANDLER (ORCHESTRATOR) ===============
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) throw new Error("GEMINI_API_KEY is not configured.");

        const body = req.body || {};
        const patientData = {
            age: body.age,
            gender: body.gender,
            isSmoker: body.isSmoker,
            notes: body.notes || "",
            problems: body.problems || [],
            medications: body.medications || []
        };

        // For this example, we'll use OCR on the `notes` field if it's long.
        // In a real app, this would process file uploads.
        const textForExtraction = patientData.notes;
        
        // --- Orchestration ---
        // 1. Extract entities from free text
        const extractedEntities = await extractMedicalEntities(textForExtraction, geminiKey);
        
        // 2. Combine and enrich medication data
        const allMedicationNames = [...new Set([...patientData.medications, ...extractedEntities.medications])];
        const enrichedMeds = enrichMedicationData(allMedicationNames);

        // 3. Add extracted symptoms to patient context
        patientData.symptoms = extractedEntities.symptoms;

        // 4. Run the rules engine
        const { alerts, recommendations, insuranceDecisions } = clinicalRulesEngine(patientData, enrichedMeds);
        
        // 5. Synthesize and generate the final report
        const htmlReport = buildFinalReport({
            patientData,
            alerts,
            recommendations,
            insuranceDecisions,
            allMeds: allMedicationNames
        });

        return res.status(200).json({ htmlReport });

    } catch (err) {
        console.error("Handler Error:", err);
        return res.status(500).json({ error: "Internal Server Error", detail: err.message });
    }
}

export const config = {
    api: { bodyParser: { sizeLimit: "2mb" } }
};
