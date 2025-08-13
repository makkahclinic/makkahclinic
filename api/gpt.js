// /api/clinical-analyzer-final.js
// Final, Unified Medical-Operational Analyzer Prototype
// Runtime: Vercel / Next.js API Route (Node 18+)
// WARNING: For Educational & Prototyping Purposes ONLY. Not for clinical use.

// ========================= ENV (Vercel → Settings → Environment Variables) =========================
// GEMINI_API_KEY=your_gemini_api_key_here
// ==================================================================================================

// =============== 1. CLINICAL KNOWLEDGE BASE & CONFIGURATION ===============
// In a real system, this would be an external, version-controlled database.
const CLINICAL_KNOWLEDGE_BASE = {
    // Drug Families, Classes, and Components
    'triplixam': { family: 'ACEI_COMBO', classes: ['ace_inhibitor', 'ccb', 'diuretic'], components: ['perindopril', 'amlodipine', 'indapamide'] },
    'co-taburan': { family: 'ARB_COMBO', classes: ['arb', 'diuretic'], components: ['valsartan', 'hydrochlorothiazide'] },
    'amlodipine': { family: 'CCB', classes: ['ccb'] },
    'metformin': { family: 'Biguanide', classes: ['antidiabetic'] },
    'diamicron': { family: 'Sulfonylurea', classes: ['antidiabetic'] },
    'duodart': { family: 'BPH_MED', classes: ['5-alpha_reductase_inhibitor'], forGender: 'male' },
    'rozavi': { family: 'Statin', classes: ['statin'] },
    // A mapping of common names/typos to the canonical name for normalization
    'canonicalNames': {
        'triplex': 'triplixam',
        'metformin xr': 'metformin',
        'form xr': 'metformin',
        'co taburan': 'co-taburan',
        'diamicron mr': 'diamicron'
    }
};
const GEMINI_MODEL = "gemini-1.5-pro-latest";

// =============== 2. CORE HELPERS ===============

/**
 * Normalizes a drug name to its canonical form using the knowledge base.
 * @param {string} name - The raw drug name from the input.
 * @returns {string} The canonical drug name in lowercase.
 */
function getCanonicalDrugName(name) {
    if (!name) return "";
    const lowerName = name.trim().toLowerCase().split(" ")[0]; // Get the core name
    return CLINICAL_KNOWLEDGE_BASE.canonicalNames[lowerName] || lowerName;
}

/**
 * Enriches a list of raw drug names with structured data from our knowledge base.
 * @param {string[]} medicationNames - An array of raw drug names.
 * @returns {object[]} An array of structured drug objects with family, classes, etc.
 */
function enrichMedicationData(medicationNames) {
    if (!medicationNames || !Array.isArray(medicationNames)) return [];
    const uniqueNames = [...new Set(medicationNames.map(getCanonicalDrugName).filter(Boolean))];
    
    return uniqueNames.map(name => ({
        name: name,
        originalName: medicationNames.find(orig => getCanonicalDrugName(orig) === name), // Keep one original name for display
        ...(CLINICAL_KNOWLEDGE_BASE[name] || {})
    }));
}

// =============== 3. THE CLINICAL RULES ENGINE ===============

/**
 * The core logic unit. Analyzes patient data and medications against a set of clinical rules.
 * @param {object} patientData - The structured patient data (age, gender, etc.).
 * @param {object[]} enrichedMeds - The list of medications, enriched with data from the knowledge base.
 * @returns {{alerts: object[], recommendations: string[], insuranceDecisions: object}} - The analysis results.
 */
function clinicalRulesEngine(patientData, enrichedMeds) {
    const alerts = [];
    const recommendations = [];
    const insuranceDecisions = {};

    // Context object to make rules easier to write
    const context = {
        age: patientData.age,
        gender: patientData.gender,
        isSmoker: patientData.isSmoker,
        symptoms: (patientData.notes || "").toLowerCase(),
        meds: enrichedMeds,
        hasMedClass: (cls) => enrichedMeds.some(m => m.classes?.includes(cls)),
        hasMedFamily: (fam) => enrichedMeds.some(m => m.family === fam),
        getMed: (name) => enrichedMeds.find(m => m.name === name)
    };

    // --- RULE SET ---

    // Rule 1: Critical Interaction -> ACEI + ARB
    if (context.hasMedFamily('ACEI_COMBO') && context.hasMedFamily('ARB_COMBO')) {
        alerts.push({ level: 'critical', text: 'تعارض خطير وممنوع: الجمع بين دواء يحتوي على ACEI (مثل Triplixam) وآخر يحتوي على ARB (مثل Co-Taburan).' });
        insuranceDecisions['co-taburan'] = `<span class="status-red">❌ مرفوض قطعًا (تعارض ACEI+ARB)</span>`;
    }

    // Rule 2: Therapeutic Duplication -> Redundant CCB
    if (context.getMed('amlodipine') && context.getMed('triplixam')?.components?.includes('amlodipine')) {
        alerts.push({ level: 'high', text: 'ازدواجية علاجية: وصف Amlodipine بشكل منفصل مع Triplixam الذي يحتوي عليه بالفعل.' });
        insuranceDecisions['amlodipine'] = `<span class="status-yellow">⚠️ قابل للمراجعة: يُلغى لوجوده في Triplixam</span>`;
    }

    // Rule 3: Geriatric Risk -> Hypoglycemia with Sulfonylureas
    if (context.age > 65 && context.hasMedFamily('Sulfonylurea')) {
        alerts.push({ level: 'medium', text: 'خطر نقص السكر في الدم لدى كبار السن مرتفع مع استخدام Sulfonylurea (مثل Diamicron).' });
        insuranceDecisions['diamicron'] = `<span class="status-yellow">⚠️ موافقة بحذر: خطر نقص السكر لدى كبار السن</span>`;
    }

    // Rule 4: Geriatric Risk -> Falls with multiple antihypertensives
    const antiHypertensivesCount = enrichedMeds.filter(m => m.classes?.includes('ace_inhibitor') || m.classes?.includes('arb') || m.classes?.includes('ccb') || m.classes?.includes('diuretic')).length;
    if (context.age > 65 && antiHypertensivesCount >= 2) {
        alerts.push({ level: 'medium', text: `خطر السقوط مرتفع بسبب وجود ${antiHypertensivesCount} أدوية لخفض ضغط الدم.` });
    }

    // Rule 5: Demographic Mismatch -> Male-only drug for female
    if (context.gender === 'female' && context.hasMedFamily('BPH_MED')) {
        alerts.push({ level: 'critical', text: 'خطأ جوهري: وصف دواء Duodart (لعلاج البروستاتا) لمريضة أنثى.' });
        insuranceDecisions['duodart'] = `<span class="status-red">❌ مرفوض ديموغرافيًا (دواء للرجال)</span>`;
    }

    // Rule 6: Red Flag -> Smoker with Cough
    if (context.isSmoker && context.symptoms.includes('سعال')) {
        recommendations.push('**تنبيه (Red Flag):** المريض مدخن ولديه سعال. **إجراء أشعة سينية على الصدر (Chest X-ray) ضروري** لاستبعاد أسباب خطيرة.');
    }

    // Rule 7: Mandatory Lab Monitoring
    if (context.hasMedFamily('Biguanide')) {
        recommendations.push('**إلزامي قبل البدء:** فحص وظائف الكلى (eGFR/Creatinine). Metformin هو مضاد استطباب إذا كان eGFR < 30.');
        recommendations.push('**للاستخدام طويل الأمد:** مراقبة مستوى فيتامين B12 بشكل دوري.');
        insuranceDecisions['metformin'] = `<span class="status-yellow">⚠️ موافقة مشروطة: بعد تأكيد eGFR ≥ 30</span>`;
    }
    if (context.hasMedFamily('Statin')) {
        recommendations.push('فحص إنزيمات الكبد (ALT/AST) عند البدء أو عند ظهور أعراض.');
    }
    if (context.hasMedFamily('ACEI_COMBO') || context.hasMedFamily('ARB_COMBO')) {
        recommendations.push('فحص البوتاسيوم (K+) ووظائف الكلى بعد 1-2 أسبوع من بدء العلاج أو تعديل الجرعة.');
    }
    
    return { alerts, recommendations, insuranceDecisions };
}

// =============== 4. FINAL REPORT GENERATOR ===============

/**
 * Builds the final HTML report from the analysis results.
 * @param {object} context - An object containing all patient data and analysis results.
 * @returns {string} A string of HTML representing the final report.
 */
function buildFinalReport({ patientData, alerts, recommendations, insuranceDecisions, enrichedMeds }) {
    const medicationRows = enrichedMeds.map(med => {
        const decision = insuranceDecisions[med.name] || `<span class="status-green">✅ مقبول</span>`;
        return `<tr>
            <td>${med.originalName}</td>
            <td>${decision}</td>
        </tr>`;
    }).join('');

    const alertList = alerts.length > 0
        ? `<ul>${alerts.map(a => `<li class="alert-${a.level}">${a.text}</li>`).join('')}</ul>`
        : '<p>لم يتم رصد تنبيهات سريرية حرجة بناءً على القواعد الحالية.</p>';

    const recommendationList = recommendations.length > 0
        ? `<ul>${recommendations.map(r => `<li>${r}</li>`).join('')}</ul>`
        : '<p>لا توجد توصيات إلزامية بناءً على البيانات الحالية.</p>';

    return `
    <style>
      body { font-family: sans-serif; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
      .status-green, .status-yellow, .status-red { display: inline-block; padding: 5px 12px; border-radius: 15px; font-weight: bold; font-size: 0.9em;}
      .status-green { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
      .status-yellow { background-color: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
      .status-red { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
      .section-title { color: #1e40af; font-weight: bold; border-bottom: 2px solid #1e40af; padding-bottom: 5px; margin-top: 25px; }
      .alert-critical { color: #721c24; font-weight: bold; }
      .alert-high { color: #856404; font-weight: bold; }
      .alert-medium { color: #0c5460; }
      .disclaimer { font-size: 0.8em; color: #666; text-align: center; margin-top: 30px; }
    </style>
    <h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
    
    <h4 class="section-title">ملخص بيانات المريض</h4>
    <p>
        <strong>العمر:</strong> ${patientData.age || 'N/A'} | 
        <strong>الجنس:</strong> ${patientData.gender || 'N/A'} | 
        <strong>مدخن:</strong> ${patientData.isSmoker ? 'نعم' : 'لا'} | 
        <strong>الملاحظات الرئيسية:</strong> ${patientData.notes || 'لا يوجد'}
    </p>

    <h4 class="section-title">التحليل السريري العميق والتنبيهات</h4>
    ${alertList}

    <h4 class="section-title">جدول قرارات التأمين للأدوية</h4>
    <table>
        <thead><tr><th>الدواء/الإجراء</th><th>قرار التأمين المبدئي</th></tr></thead>
        <tbody>${medicationRows}</tbody>
    </table>

    <h4 class="section-title">خطة العمل الإلزامية والخدمات الضرورية</h4>
    ${recommendationList}

    <p class="disclaimer"><strong>إخلاء مسؤولية:</strong> هذا التقرير تم إنشاؤه بواسطة نظام ذكاء اصطناعي وهو لأغراض توضيحية فقط ولا يغني عن الحكم السريري للطبيب المختص.</p>
    `;
}


// =============== 5. THE MAIN API HANDLER (ORCHESTRATOR) ===============

export default async function handler(req, res) {
    // Allow CORS for easy testing from any frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const body = req.body || {};
        
        // Step 1: Sanitize and structure the input data
        const patientData = {
            age: body.age ? parseInt(body.age, 10) : null,
            gender: body.gender || null, // expecting 'male' or 'female'
            isSmoker: body.isSmoker === true,
            notes: body.notes || "",
            medications: body.medications || []
        };
        
        if (!patientData.medications || !Array.isArray(patientData.medications) || patientData.medications.length === 0) {
           return res.status(200).json({ htmlReport: buildFinalReport({ patientData, alerts: [], recommendations: [], insuranceDecisions: {}, enrichedMeds: [] }) });
        }

        // --- Orchestration ---
        
        // Step 2: Enrich medication data using the knowledge base
        const enrichedMeds = enrichMedicationData(patientData.medications);

        // Step 3: Run the clinical rules engine with the structured data
        const { alerts, recommendations, insuranceDecisions } = clinicalRulesEngine(patientData, enrichedMeds);
        
        // Step 4: Generate the final HTML report from the analysis results
        const htmlReport = buildFinalReport({
            patientData,
            alerts,
            recommendations,
            insuranceDecisions,
            enrichedMeds
        });
        
        // Step 5: Return the complete report
        return res.status(200).json({ htmlReport });

    } catch (err) {
        console.error("Critical Handler Error:", err);
        return res.status(500).json({ error: "Internal Server Error", detail: err.message });
    }
}

export const config = {
    api: { bodyParser: { sizeLimit: "2mb" } }
};
