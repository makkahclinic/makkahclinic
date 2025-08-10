// api/pharmacy-rx.js (الإصدار الهجين الخارق)

import { GoogleGenerativeAI } from '@google/generative-ai';

// ============================ الإعدادات والتهيأة ============================

// إعداد خدمة Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" }) : null;

// إعدادات API
export const config = {
    api: {
        bodyParser: { sizeLimit: '20mb' },
    },
};

// ============================ المصادر الطبية الموثوقة ============================
const SOURCES = {
    FDA_NSAID_20W: { title: 'FDA: Avoid NSAIDs ≥20 weeks of pregnancy', url: 'https://www.fda.gov/drugs/drug-safety-and-availability/fda-recommends-avoiding-use-nsaids-pregnancy-20-weeks-or-later-because-they-can-result-low-amniotic' },
    ADA_MET_EGFR_2025: { title: 'ADA (2025): Metformin contraindicated if eGFR <30', url: 'https://diabetesjournals.org/care/article/48/Supplement_1/S239/157554/11-Chronic-Kidney-Disease-and-Risk-Management' },
    DAILYMED_ROSU_RENAL: { title: 'DailyMed: Rosuvastatin - max 10 mg in severe renal impairment', url: 'https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?setid=3bf80420-7482-44c0-a117-30793ba89544&type=pdf' },
    FDA_SILD_LABEL_NITRATES: { title: 'FDA label: Sildenafil + nitrates contraindicated', url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/021845s025lbl.pdf' },
    KDIGO_ACE_ARB_AVOID: { title: 'KDIGO: Avoid combination therapy ACEi + ARB', url: 'https://kdigo.org/wp-content/uploads/2016/10/KDIGO_BP_Exec_Summary_final.pdf' },
    FDA_SPIRONOLACTONE_HYPERK: { title: 'FDA label: Spironolactone - hyperkalemia risk ↑ with ACEi/ARB & CKD', url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2018/012151s075lbl.pdf' },
    FDA_WARFARIN_BLEED: { title: 'FDA Coumadin label: antiplatelets ↑ bleeding risk with warfarin', url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2011/009218s107lbl.pdf' },
    // يمكنك إضافة باقي المصادر هنا...
};


// ============================ دوال مساعدة وأدوات التحليل ============================

// دالة رفع الملفات إلى Google
async function uploadFileToGoogleAI(apiKey, fileData) {
    const match = fileData.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return null; // تجاهل الملفات غير الصالحة
    const mimeType = match[1];
    const base64Data = match[2];
    const fileBuffer = Buffer.from(base64Data, 'base64');
    const uploadUrl = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': mimeType, 'x-goog-request-params': 'project=-' },
        body: fileBuffer,
    });
    if (!response.ok) {
        console.error("File upload failed:", await response.text());
        return null;
    }
    const result = await response.json();
    return result.file;
}

// دالة استخراج النصوص من الملفات باستخدام Gemini
async function extractTextFromFiles(fileParts) {
    if (!model || fileParts.length === 0) return "";
    try {
        const textOnlyModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Use flash for fast OCR
        const result = await textOnlyModel.generateContent(["Extract all text from these files. List medications if possible.", ...fileParts]);
        return result.response.text();
    } catch (e) {
        console.error("Gemini OCR failed:", e);
        return "";
    }
}


// قاموس الأدوية والقواعد المحددة مسبقًا (من الكود الذي أرسلته)
const DRUGS = {
    aspirin: { synonyms: ['asa', 'acetylsalicylic', 'أسبرين'], classes: ['ANTIPLATELET', 'NSAID'] },
    warfarin: { synonyms: ['coumadin', 'وارفارين'], classes: ['OAC'] },
    metformin: { synonyms: ['glucophage', 'ميتفورمين'], classes: ['BIGUANIDE'] },
    'amlodipine/valsartan': { synonyms: ['exforge'], classes: ['CCB','ARB'] },
    rosuvastatin: { synonyms: ['crestor', 'روزوفاستاتين'], classes: ['STATIN'] },
    lisinopril: { synonyms: ['ليزينوبريل'], classes: ['ACEI'] },
    valsartan: { synonyms: ['فالسارتان'], classes: ['ARB'] },
    sildenafil: { synonyms: ['viagra', 'سيلدينافيل'], classes: ['PDE5'] },
    nitroglycerin: { synonyms: ['glyceryl trinitrate'], classes: ['NITRATE'] },
    spironolactone: { synonyms: ['aldactone', 'سبيرونولاكتون'], classes: ['K_SPARING'] },
    // ... يمكن إضافة باقي الأدوية من الكود الأصلي هنا
};
function mapToCanonical(raw) {
    const norm = String(raw).toLowerCase().trim();
    for (const key in DRUGS) {
        if (norm.includes(key)) return key;
        for (const syn of DRUGS[key].synonyms) {
            if (norm.includes(syn.toLowerCase())) return key;
        }
    }
    return null;
}
function runRuleEngine(medicationList, patientContext) {
    const findings = [];
    const has = (key) => medicationList.some(m => m.canonical === key);

    // Rule 1: ACEi + ARB
    if (has('lisinopril') && has('valsartan')) {
        findings.push({ severity: 'high', title: 'تداخل خطير: ACEi + ARB', description: 'يمنع استخدام مثبطات الإنزيم المحول للأنجيوتنسين مع مضادات مستقبلات الأنجيوتنسين II لزيادة خطر الفشل الكلوي وفرط بوتاسيوم الدم.', refs: ['KDIGO_ACE_ARB_AVOID'] });
    }
    // Rule 2: PDE5 + Nitrates
    if (has('sildenafil') && has('nitroglycerin')) {
        findings.push({ severity: 'high', title: 'تداخل خطير: PDE5 + نترات', description: 'يمنع الاستخدام المتزامن لخطر هبوط ضغط الدم الشديد.', refs: ['FDA_SILD_LABEL_NITRATES'] });
    }
    // Rule 3: Metformin + severe CKD
    if (has('metformin') && patientContext.eGFR && patientContext.eGFR < 30) {
        findings.push({ severity: 'high', title: 'تعارض: ميتفورمين وقصور كلوي حاد', description: `يمنع استخدام الميتفورمين إذا كان معدل الترشيح الكبيبي (eGFR) أقل من 30.`, refs: ['ADA_MET_EGFR_2025'] });
    }
    // ... يمكن إضافة باقي القواعد هنا
    return findings;
}


// ============================ معالج الطلب الرئيسي (API Handler) ============================

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
    if (!model || !GEMINI_API_KEY) return res.status(500).json({ ok: false, message: "Gemini API key is not configured." });

    try {
        const { texts = [], images = [], patient = {} } = req.body || {};

        // 1. رفع الملفات إلى Google
        const fileUploadPromises = images.map(imgData => uploadFileToGoogleAI(GEMINI_API_KEY, imgData));
        const uploadedFiles = (await Promise.all(fileUploadPromises)).filter(Boolean);
        const fileParts = uploadedFiles.map(file => ({ fileData: { mimeType: file.mimeType, fileUri: file.uri } }));

        // 2. استخراج النصوص من كل المصادر
        const textFromFiles = await extractTextFromFiles(fileParts);
        const allMedicationInput = [...texts, textFromFiles].join('\n').trim();

        if (!allMedicationInput) {
             return res.status(400).json({ ok: false, message: "No medication information provided." });
        }
        
        // 3. (المرحلة الأولى) تشغيل محرك القواعد الأساسي
        const preliminaryMedList = allMedicationInput.split('\n').map(line => ({
            original: line,
            canonical: mapToCanonical(line)
        })).filter(m => m.canonical);
        const preliminaryFindings = runRuleEngine(preliminaryMedList, patient);

        // 4. (المرحلة الثانية) بناء الطلب الهجين إلى Gemini
        const hybridPrompt = `
            أنت صيدلي إكلينيكي خبير ومراجع أول، ومهمتك هي تدقيق تحليل دوائي تم إجراؤه بواسطة نظام آلي وتقديم تقرير نهائي شامل بصيغة HTML.

            **بيانات المريض:**
            - العمر: ${patient.age || 'غير محدد'}
            - الجنس: ${patient.sex || 'غير محدد'}
            - الوزن: ${patient.weight ? `${patient.weight} كجم` : 'غير محدد'}
            - وظائف الكلى (eGFR): ${patient.eGFR || 'غير محدد'}
            - الحمل: ${patient.pregnancy?.pregnant ? `نعم، ${patient.pregnancy.weeks || ''} أسابيع` : 'لا'}
            
            **قائمة الأدوية (نص خام من كل المصادر):**
            ---
            ${allMedicationInput}
            ---

            **نتائج التحليل الأولي من النظام الآلي:**
            ${preliminaryFindings.length > 0 ? preliminaryFindings.map(f => `- ${f.title}: ${f.description}`).join('\n') : "لم يجد النظام الأولي أي ملاحظات حرجة."}

            **المطلوب منك الآن (مهمة المراجع الخبير):**
            1.  **مراجعة وتأكيد:** راجع نتائج التحليل الأولي.
            2.  **بحث معمق:** ابحث عن أي ملاحظات أو تداخلات أو تعارضات إضافية **لم يكتشفها** النظام الأولي. ركز على التداخلات النادرة، أو التي تعتمد على الجرعة، أو نصائح تتعلق بأسلوب الحياة والطعام.
            3.  **إنشاء التقرير النهائي:** قم بدمج النتائج الأولية مع اكتشافاتك الإضافية في تقرير HTML واحد متكامل ومنسق. يجب أن يتبع التقرير الهيكل الذي طلبته منك سابقًا بدقة (جدول للأدوية، وبطاقات للملاحظات بنظام الألوان للخطورة). استخدم المراجع الموثوقة عند الحاجة مثل: ${Object.values(SOURCES).map(s => s.title).join(', ')}.

            ابدأ الآن بإنشاء كود HTML الكامل. لا تكتب أي شيء خارجه.
        `;

        const requestParts = [{ text: hybridPrompt }, ...fileParts];

        // 5. إرسال الطلب النهائي إلى Gemini
        const finalResult = await model.generateContent({ contents: [{ parts: requestParts }] });
        const finalHtml = finalResult.response.text();

        // 6. إرسال التقرير النهائي للواجهة الأمامية
        return res.status(200).json({ ok: true, html: finalHtml });

    } catch (e) {
        console.error("Hybrid analysis handler failed:", e);
        return res.status(500).json({ ok: false, error: "hybrid_analysis_failed", message: e.message });
    }
}
