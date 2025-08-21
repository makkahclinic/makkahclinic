// /pages/api/analyze.js

// --- Next.js body size for large payloads ---
export const config = {
  api: {
    bodyParser: { sizeLimit: "50mb" },
  },
};

// --- ENV & Endpoints ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL =
  "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

// --- Clinical Knowledge Base (Hardened & Expanded) ---
// NOTE: These lists are hardened to provide a deterministic safety net.
const PREGNANCY_RISK_CLASSES = [
  "statin", "atorvastatin", "rosuvastatin", "simvastatin", // Statins
  "ace inhibitor", "captopril", "enalapril", "lisinopril", "ramipril", // ACEi
  "arb", "losartan", "valsartan", "candesartan", "irbesartan", // ARBs
  "renin inhibitor", "aliskiren",
  "warfarin",
  "isotretinoin", "retinoid", "acitretin", // Retinoids
  "valproate", "valproic acid", "topiramate", // Anticonvulsants
  "methotrexate", "leflunomide", "mycophenolate", // Immunosuppressants
  "thalidomide", "lenalidomide",
  "misoprostol",
  "lithium",
  "tetracycline", "doxycycline", "minocycline", // Antibiotics
];
const BPH_MEDS = ["tamsulosin", "dutasteride", "finasteride", "duodart", "silodosin", "alfuzosin"];
const NEGATIVE_CHRONOTROPES = ["bisoprolol", "metoprolol", "atenolol", "propranolol", "carvedilol", "verapamil", "diltiazem"];
const METFORMIN_CONTAINING_DRUGS = ["metformin", "glucophage", "kazano", "segluro", "janumet", "kombiglyze"];
const GLICLAZIDE_MR_DRUGS = ["diamicron", "gliclazide"];


// --- General Helpers ---
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (response) =>
  (response.headers.get("content-type") || "").includes("application/json")
    ? response.json()
    : { raw: await response.text() };

function toEnglishDigits(str = "") {
  const map = { "٠":"0", "١":"1", "٢":"2", "٣":"3", "٤":"4", "٥":"5", "٦":"6", "٧":"7", "٨":"8", "٩":"9" };
  return String(str).replace(/[٠-٩]/g, (d) => map[d] || d);
}

// IMPROVEMENT: More robust JSON extraction, prioritizing markdown blocks.
function extractFirstJson(text = "") {
  const s = String(text || "").trim();
  const match = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match && match[1]) {
    try { return JSON.parse(match[1]); } catch (e) { console.error("Failed to parse JSON block, falling back.", e); }
  }
  const start = s.indexOf("{"); const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = s.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch {
      try { return JSON.parse(candidate.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")); } catch { return null; }
    }
  }
  return null;
}

// IMPROVEMENT: Added full Arabic language support.
function parseDurationToDays(duration = "") {
  if (!duration) return null;
  const d = toEnglishDigits(duration).toLowerCase();
  const arDays = d.match(/(\d{1,4})\s*(يوم|أيام)/); if (arDays) return parseInt(arDays[1], 10);
  const arWeeks = d.match(/(\d{1,3})\s*(اسبوع|أسبوع|اسابيع|أسابيع)/); if (arWeeks) return parseInt(arWeeks[1], 10) * 7;
  const arMonths = d.match(/(\d{1,2})\s*(شهر|شهور|أشهر)/); if (arMonths) return parseInt(arMonths[1], 10) * 30;
  const m1 = d.match(/x\s*(\d{1,4})\b/); if (m1) return parseInt(m1[1], 10);
  const m2 = d.match(/(\d{1,4})\s*(d|day|days)\b/); if (m2) return parseInt(m2[1], 10);
  const m3 = d.match(/(\d{1,3})\s*(w|wk|wks|week|weeks)\b/); if (m3) return parseInt(m3[1], 10) * 7;
  const m4 = d.match(/(\d{1,2})\s*(m|mo|mos|month|months)\b/); if (m4) return parseInt(m4[1], 10) * 30;
  if (/\b90\b/.test(d)) return 90;
  return null;
}
function parseFrequencyPerDay(freq = "") {
  if (!freq) return null;
  const f = toEnglishDigits(freq).toLowerCase().replace(/\s+/g, "");
  if (/مرة(واحدة)?(يوميا|فياليوم)/.test(f)) return 1;
  if (/مرتين(يوميا|فياليوم)/.test(f)) return 2;
  if (/ثلاثمرات(يوميا|فياليوم)/.test(f)) return 3;
  if (/كل12ساعة|كل١٢ساعة/.test(f)) return 2;
  if (/كل8ساعات|كل٨ساعات/.test(f)) return 3;
  if (/(od|qd|once|1x1|q24h)\b/.test(f)) return 1;
  if (/(bid|2x1|1x2|q12h)/.test(f)) return 2;
  if (/(tid|3x1|1x3|q8h)/.test(f)) return 3;
  if (/(qid|4x1|1x4|q6h)/.test(f)) return 4;
  if (/weekly|qw/.test(f)) return 1 / 7;
  if (/q2d/.test(f)) return 0.5;
  const m = f.match(/(\d)\s*x\s*(\d)/); if (m) return parseInt(m[2], 10);
  return null;
}

function estimateDaySupply({ doseDuration, daySupplyEstimate }) {
  if (Number.isFinite(daySupplyEstimate) && daySupplyEstimate > 0) return daySupplyEstimate;
  return parseDurationToDays(doseDuration) || 0;
}

function includesAny(hay = "", needles = []) {
  const s = String(hay || "").toLowerCase();
  return needles.some((n) => s.includes(String(n).toLowerCase()));
}

// --- Text Normalization & Similarity ---
function normalizeText(x = "") {
  return toEnglishDigits(x).toLowerCase().replace(/[^a-z\u0621-\u064A0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenSet(str = "") { return new Set(normalizeText(str).split(" ").filter(Boolean)); }
function jaccard(a = "", b = "") {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size && !B.size) return 1;
  const inter = new Set([...A].filter((x) => B.has(x)));
  const uni = new Set([...A, ...B]);
  return inter.size / uni.size;
}

// --- (A) OCR via Gemini ---
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, "base64");
  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,{method: "POST",headers: {"X-Goog-Upload-Protocol": "resumable","X-Goog-Upload-Command": "start","X-Goog-Upload-Header-Content-Length": String(binaryData.byteLength),"X-Goog-Upload-Header-Content-Type": mimeType,"Content-Type": "application/json",},body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),});
  if (!initRes.ok) throw new Error(`Gemini init failed: ${JSON.stringify(await parseJsonSafe(initRes))}`);
  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload session URL is missing");
  const uploadRes = await fetch(sessionUrl,{method: "PUT",headers: {"Content-Type": mimeType,"X-Goog-Upload-Command": "upload, finalize","X-Goog-Upload-Offset": "0","Content-Length": String(binaryData.byteLength),},body: binaryData,});
  const metadata = await parseJsonSafe(uploadRes);
  if (!uploadRes.ok) throw new Error(`Gemini finalize failed: ${JSON.stringify(metadata)}`);
  return { uri: metadata?.file?.uri, mime: metadata?.file?.mime_type || mimeType };
}

async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });

  for (const file of files || []) {
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    const { uri, mime: finalMime } = await geminiUploadBase64({
      name: file?.name || "unnamed_file",
      mimeType: file?.mimeType || "application/octet-stream",
      base64: base64Data,
    });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }

  if (userParts.length === 0) userParts.push({ text: "No content provided." });

  // IMPROVEMENT: Stricter prompt to ensure clean JSON output.
  const systemPrompt = `
مهمتك صارمة: استخرج البيانات الطبية ككائن JSON واحد صالح. **لا تكتب أي نص أو تفسير أو ملاحظات خارج كائن JSON.**
يجب أن يكون الرد بأكمله مغلفًا بـ \`\`\`json ... \`\`\`.
- استخرج كل شيء بدقة: بيانات المريض، التشخيصات، الأدوية، الإجراءات، المختبرات، إلخ.
- لكل عنصر: { type, raw, name, form, route, strength, frequency, duration, quantity, indication, handwritten, confidence:{...} }
- لا تخترع أي بيانات. إذا كانت المعلومة غير موجودة، اترك الحقل فارغًا أو null.
- الهيكل النهائي المطلوب بالضبط:
{
  "patient": { "name":"", "gender":"", "age":"", "weight":"", "vitals":{"bp":"","hr":""}, "eGFR": "" },
  "diagnoses": [ "..." ],
  "items": [ { /* ... */ } ]
}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
    generation_config: { response_mime_type: "application/json" },
  };
  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);

  const textOut = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
  const parsed = extractFirstJson(textOut) || { patient: {}, diagnoses: [], items: [] };

  (parsed.items || []).forEach(it => {
    it.durationDays = Number.isFinite(it.durationDays) ? it.durationDays : parseDurationToDays(it.duration);
  });
  return parsed;
}

// --- (B, C) Expert Auditor (OpenAI) ---
function getExpertAuditorInstructions(lang = "ar") {
    const schema={patientSummary:{text:"..."},overallAssessment:{text:"..."},table:[{name:"string",itemType:"medication|procedure|lab|imaging|referral|supply|supplement",therapyType:"Maintenance|Acute|Unknown",doseStrength:"string",doseFrequency:"string",doseDuration:"string",daySupplyEstimate:0,status:"موصوف|تم إجراؤه|مفقود ولكنه ضروري",analysisCategory:"صحيح ومبرر|جرعة غير صحيحة|كمية عالية|إغفال خطير|تكرار علاجي|غير مبرر طبياً|إجراء يتعارض مع التشخيص",safetySignals:[{type:"Renal|Hepatic|Pregnancy|Gender|HR|BP|Age|Interaction|Other",severity:"Critical|Major|Minor",detail:"string"}],conflictsWithPatient:["string"],evidenceRef:null,inferred:false,insuranceDecision:{label:"مقبول|مرفوض|للمراجعة|لا ينطبق",justification:"string"}}],recommendations:[{priority:"عاجلة|أفضل ممارسة",description:"string",relatedItems:["string"]}]};
    return `أنت صيدلي سريري ومدقّق طبي قائم على الأدلة. أعِد **JSON صالحًا فقط** بهذا المخطط (دون نص إضافي).\n\n- **حارس الهلوسة:** أي عنصر حالته "موصوف" أو "تم إجراؤه" يجب أن يرتبط بعنصر فعلي من ocrItems عبر evidenceRef (فهرس). لا يُسمح بالعناصر المخترعة. العناصر المقترحة معيار رعاية تُوسَم inferred=true وstatus="مفقود ولكنه ضروري".\n- التزم بإرشادات: ACC/AHA 2021 للصدر، ADA (سكري)، KDIGO (كلية)، Beers/STOPP-START للشيخوخة.\n- معدّل إطلاق معدّل (MR): Gliclazide/DIAMICRON MR يجب أن يكون "مرة يوميًا". أي تكرار أعلى = "جرعة غير صحيحة".\n- أي مدة >30 يوم = "كمية عالية". 90+ يوم: مقبول غالبًا لأدوية الصيانة فقط وبشروط الاستقرار؛ وإلا "للمراجعة"/"مرفوض".\n- املأ doseStrength/doseFrequency/doseDuration مما في OCR، وإن غاب اكتب "غير محدد".\n- أدرج الإغفالات الحرجة (مثل ECG وhs‑cTn في ألم صدري) كـ inferred=true و"لا ينطبق" للتأمين.\n\nاللغة: العربية الفصحى، موجزة، مهنية.\n\nالمخطط:\n${JSON.stringify(schema,null,2)}`;
}
async function getAuditFromOpenAI(bundle) {
    const response=await fetch(OPENAI_API_URL,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${OPENAI_API_KEY}`},body:JSON.stringify({model:OPENAI_MODEL,temperature:0,messages:[{role:"system",content:getExpertAuditorInstructions("ar")},{role:"user",content:"Clinical Data for Audit:\n"+JSON.stringify(bundle,null,2)}],response_format:{type:"json_object"}}),});
    const data=await response.json();
    if(!response.ok)throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
    return JSON.parse(data?.choices?.[0]?.message?.content||"{}");
}


// --- (D) Deterministic Policy & Safety Checks ---
function postProcessPolicyAndSafety(structured, patientInfo) {
  const gender = (patientInfo?.gender || patientInfo?.sex || "").toLowerCase();
  const pregnant = Boolean(patientInfo?.pregnant);
  const hr = Number(toEnglishDigits(patientInfo?.vitals?.hr || patientInfo?.hr || "")) || null;
  const eGFR = Number(toEnglishDigits(patientInfo?.eGFR || patientInfo?.renal?.eGFR || "")) || null;

  structured.table = (structured.table || []).map((row) => {
    const r = { ...row };
    r.safetySignals = r.safetySignals || [];
    r.daySupplyEstimate = estimateDaySupply({ doseDuration: r.doseDuration, daySupplyEstimate: r.daySupplyEstimate });
    
    if (r.daySupplyEstimate > 30 && !/كمية عالية/.test(r.analysisCategory || "")) r.analysisCategory = `${r.analysisCategory || ""} | كمية عالية`.trim().replace(/^ \| /,'');
    
    if (r.itemType === "medication" && r.daySupplyEstimate >= 90 && (r.therapyType || "").toLowerCase() !== "maintenance") {
      r.insuranceDecision = { label: "مرفوض", justification: "صرف 90 يومًا مسموح فقط لأدوية الصيانة المستقرة." };
    }
    
    if (gender === "female" && includesAny(r.name, BPH_MEDS)) {
      r.safetySignals.push({ type: "Gender", severity: "Critical", detail: "دواء للبروستاتا وُصف لمريضة." });
      r.analysisCategory = "إجراء يتعارض مع التشخيص";
      r.insuranceDecision = { label: "مرفوض", justification: "وصف خاص بالرجال لمريضة أنثى." };
    }
    
    if (pregnant && includesAny(r.name, PREGNANCY_RISK_CLASSES)) {
      r.safetySignals.push({ type: "Pregnancy", severity: "Critical", detail: "دواء ذو خطورة عالية محتملة في الحمل." });
      if (r.insuranceDecision?.label !== 'مرفوض') r.insuranceDecision = { label: "للمراجعة", justification: "حمل قائم؛ يلزم تقييم المخاطر." };
    }

    if (eGFR && eGFR < 30 && includesAny(r.name, METFORMIN_CONTAINING_DRUGS)) {
      r.safetySignals.push({ type: "Renal", severity: "Critical", detail: `eGFR=${eGFR}؛ الميتفورمين ممنوع عند eGFR<30.` });
      r.analysisCategory = "غير مبرر طبياً";
      r.insuranceDecision = { label: "مرفوض", justification: "خطر الحماض اللبني." };
    }
    
    const isGliclazideMR = includesAny(r.name, GLICLAZIDE_MR_DRUGS) && /(mr|modified release|sr|xr)/i.test(r.name || "");
    const freq = parseFrequencyPerDay(r.doseFrequency || "");
    if (isGliclazideMR && freq && freq > 1) {
      r.analysisCategory = "جرعة غير صحيحة";
      r.safetySignals.push({ type: "Dosing", severity: "Major", detail: "Gliclazide MR يؤخذ مرة واحدة يوميًا فقط." });
      if (r.insuranceDecision?.label !== 'مرفوض') r.insuranceDecision = { label: "للمراجعة", justification: "تكرار الجرعة غير صحيح." };
    }
    
    if (hr && hr < 50 && includesAny(r.name, NEGATIVE_CHRONOTROPES)) {
      r.safetySignals.push({ type: "HR", severity: "Major", detail: `نبض منخفض (HR=${hr}) مع دواء يبطئ النبض.` });
      if (r.insuranceDecision?.label !== 'مرفوض') r.insuranceDecision = { label: "للمراجعة", justification: "بطء قلب ملحوظ." };
    }

    return r;
  });
  return structured;
}

// --- (E) Grounding to OCR ---
function groundAuditRowsToOCR(structured, ocrItems = []) {
  const normalizedOCR = ocrItems.map((it, idx) => ({ idx, name: normalizeText(it.name || it.raw || "") }));
  structured.table = (structured.table || []).map(r => {
    if (r.inferred) {
      r.grounding = { matched: true, score: 1, evidenceRaw: "Inferred by system" };
      return r;
    }
    const rNorm = normalizeText(r.name || "");
    let best = { score: -1, idx: -1 };
    for (const it of normalizedOCR) {
      const score = jaccard(rNorm, it.name);
      if (score > best.score) best = { score, idx: it.idx };
    }
    const matched = best.score >= 0.35;
    r.grounding = { matched, score: Number(best.score.toFixed(2)), evidenceRaw: best.idx >= 0 ? ocrItems[best.idx]?.raw || "" : "" };
    if (!matched && (r.status?.includes("موصوف") || r.status?.includes("تم إجراؤه"))) {
      r.safetySignals = r.safetySignals || [];
      r.safetySignals.push({ type: "System", severity: "Major", detail: "⚠️ لم يتم العثور على العنصر في النص الأصلي (احتمال هلوسة)." });
      if (r.insuranceDecision?.label !== 'مرفوض') r.insuranceDecision = { label: "للمراجعة", justification: "يتطلب التحقق من التوثيق الأصلي." };
    }
    if (matched && !r.evidenceRef) r.evidenceRef = best.idx;
    return r;
  });
  return structured;
}


// --- (F) Add Standard-of-Care Omissions ---
function ensureStandardOfCare(structured, context) {
  const ctx = normalizeText([context.text, ...(context.diagnoses || [])].join(" "));
  const hasChestPain = includesAny(ctx, ["chest pain", "angina", "acs", "nstemi", "stemi", "الم صدري", "ذبحة"]);
  
  if (hasChestPain) {
    const names = (structured.table || []).map(r => normalizeText(r.name || ""));
    const hasECG = includesAny(names.join(' '), ["ecg", "تخطيط قلب"]);
    const hasTroponin = includesAny(names.join(' '), ["troponin", "hs-ctn", "تروبونين"]);
    
    const mkMissing = (name, itemType) => ({
      name, itemType, therapyType: "Diagnostic", status: "مفقود ولكنه ضروري", analysisCategory: "إغفال خطير",
      safetySignals: [{ type: "Standard of Care", severity: "Critical", detail: "عنصر أساسي في تقييم ألم الصدر حسب الإرشادات العالمية." }],
      inferred: true, insuranceDecision: { label: "لا ينطبق", justification: "إجراء تشخيصي." }
    });

    if (!hasECG) structured.table.push(mkMissing("ECG 12‑lead (تخطيط القلب)", "procedure"));
    if (!hasTroponin) structured.table.push(mkMissing("High‑Sensitivity Troponin (hs‑cTn)", "lab"));
  }
  return structured;
}


// --- (G) HTML Renderer ---
function renderHtmlReport(structuredData, lang = "ar") {
    const s = structuredData;
    const isArabic = lang === "ar";
    const text = {
        summaryTitle: "ملخص الحالة والتقييم العام", detailsTitle: "التحليل التفصيلي للعناصر",
        recommendationsTitle: "التوصيات والإجراءات المقترحة", itemHeader: "العنصر",
        therapyTypeHeader: "نوع العلاج", daysHeader: "أيام الصرف", statusHeader: "الحالة",
        decisionHeader: "قرار التأمين", signalsHeader: "إشارات السلامة",
        ocrHeader: "التوثيق", notAvailable: "غير متوفر."
    };

    const getDecisionStyle = (label = "") => {
        if (label.includes("مقبول")) return 'style="background-color:#e6f4ea;color:#1e8e3e;"';
        if (label.includes("مرفوض")) return 'style="background-color:#fce8e6;color:#d93025;"';
        if (label.includes("للمراجعة")) return 'style="background-color:#fff0e1;color:#e8710a;"';
        return 'style="background-color:#e8eaed;color:#5f6368;"';
    };

    const getRiskClass = (category = "") => {
        if (category.includes("إغفال") || category.includes("يتعارض") || category.includes("جرعة غير صحيحة")) return "risk-critical";
        if (category.includes("كمية عالية") || category.includes("تكرار علاجي")) return "risk-warning";
        return "";
    };

    const ocrBadge = (g) => {
        if (!g) return "-";
        if (g.evidenceRaw === "Inferred by system") return `<span title="أضافه النظام كمعيار رعاية" class="badge-info">مقترح</span>`;
        return g.matched
            ? `<span title="Score: ${g.score}\nSource: '${g.evidenceRaw}'" class="badge-success">موثق</span>`
            : `<span title="Score: ${g.score}" class="badge-danger">⚠️ غير موثق</span>`;
    };

    const formatSignals = (signals = []) => signals.length
        ? `<ul class="signals-list">${signals.map(s => `<li><b>${s.type} (${s.severity})</b>: ${s.detail}</li>`).join("")}</ul>`
        : "-";

    const rows = (s.table || []).map(r => `
        <tr class="${getRiskClass(r.analysisCategory)}">
            <td>
                <div class="item-name">${r.name || "-"}</div>
                <div class="item-category">${r.itemType || ""} — ${r.analysisCategory || ""}</div>
            </td>
            <td>${r.therapyType || "-"}</td>
            <td>${r.daySupplyEstimate > 0 ? r.daySupplyEstimate : "-"}</td>
            <td>${r.status || "-"}</td>
            <td><span class="decision-badge" ${getDecisionStyle(r.insuranceDecision?.label)}>${r.insuranceDecision?.label || "-"}</span></td>
            <td>${formatSignals(r.safetySignals)}</td>
            <td>${ocrBadge(r.grounding)}</td>
        </tr>`).join("");

    const recommendations = (s.recommendations || []).map(rec => `
      <div class="rec-item ${/عاجلة|urgent/i.test(rec.priority||"") ? "urgent-border" : "best-practice-border"}">
        <span class="rec-priority ${/عاجلة|urgent/i.test(rec.priority||"") ? "urgent" : "best-practice"}">${rec.priority}</span>
        <div class="rec-content">
          <div>${rec.description}</div>
          ${rec.relatedItems?.length ? `<div class="rec-related">مرتبط بـ: ${rec.relatedItems.join(", ")}</div>` : ""}
        </div>
      </div>`).join("");

    return `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
        body { direction: rtl; font-family: 'Tajawal', sans-serif; background-color: #f8f9fa; color: #3c4043; }
        .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 24px; padding: 24px; background: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        h2 { font-size: 22px; font-weight: 700; color: #0d47a1; margin: 0 0 20px; border-bottom: 2px solid #1a73e8; padding-bottom: 12px; }
        .audit-table { width: 100%; border-collapse: collapse; }
        .audit-table th, .audit-table td { padding: 12px 10px; text-align: right; border-bottom: 1px solid #e9ecef; vertical-align: top; }
        .audit-table th { font-size: 12px; color: #5f6368; text-transform: uppercase; position: sticky; top: 0; background: #fff; z-index: 1; }
        .item-name { font-weight: 700; font-size: 15px; }
        .item-category { font-size: 12px; color: #5f6368; }
        .decision-badge { font-weight: 700; padding: 4px 10px; border-radius: 14px; font-size: 12px; }
        .signals-list { margin:0; padding-right: 18px; font-size: 13px; list-style-type: '– '; }
        .badge-success, .badge-danger, .badge-info { padding: 3px 8px; border-radius: 8px; font-size: 12px; font-weight: 500; }
        .badge-success { background:#e6f4ea; color:#137333; }
        .badge-danger { background:#fce8e6; color:#d93025; }
        .badge-info { background:#e8f0fe; color:#1967d2; }
        tr.risk-critical { background-color: #fce8e6 !important; }
        tr.risk-warning { background-color: #fff0e1 !important; }
        .rec-item { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; padding: 14px; border-radius: 8px; background: #f8f9fa; border-right: 4px solid; }
        .rec-item.urgent-border { border-color: #d93025; }
        .rec-item.best-practice-border { border-color: #1e8e3e; }
        .rec-priority { flex-shrink: 0; font-weight: 700; padding: 5px 12px; border-radius: 8px; font-size: 12px; color: #fff; }
        .rec-priority.urgent { background: #d93025; }
        .rec-priority.best-practice { background: #1e8e3e; }
        .rec-content { display: flex; flex-direction: column; gap: 4px; }
        .rec-related { font-size: 12px; color: #5f6368; }
    </style>
    <div class="report-section"><h2>${text.summaryTitle}</h2><p>${s.patientSummary?.text || text.notAvailable}</p><p>${s.overallAssessment?.text || text.notAvailable}</p></div>
    <div class="report-section"><h2>${text.detailsTitle}</h2><table class="audit-table"><thead><tr>
        <th>${text.itemHeader}</th><th>${text.therapyTypeHeader}</th><th>${text.daysHeader}</th><th>${text.statusHeader}</th>
        <th>${text.decisionHeader}</th><th>${text.signalsHeader}</th><th>${text.ocrHeader}</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <div class="report-section"><h2>${text.recommendationsTitle}</h2>${recommendations}</div>
    `;
}


// --- Main Handler (Final Pipeline) ---
export default async function handler(req, res) {
  console.log("--- New Request Received ---");
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) return bad(res, 500, "Server Configuration Error: API Key is missing.");

    const { text = "", files = [], patientInfo = {}, lang = "ar" } = req.body;
    console.log(`Processing request...`);

    // 1. OCR
    console.log("Step 1: OCR (Gemini)...");
    const ocrBundle = await aggregateClinicalDataWithGemini({ text, files });
    
    // 2. AI Audit
    console.log("Step 2: Expert Audit (OpenAI)...");
    const combinedPatientInfo = { ...ocrBundle.patient, ...patientInfo };
    const auditBundle = { patientInfo: combinedPatientInfo, ...ocrBundle, originalUserText: text };
    let structured = await getAuditFromOpenAI(auditBundle);
    
    // 3. Deterministic Layers (Policy, Safety, Grounding, Omissions)
    console.log("Step 3: Applying deterministic layers...");
    structured = postProcessPolicyAndSafety(structured, combinedPatientInfo);
    structured = groundAuditRowsToOCR(structured, ocrBundle.items);
    structured = ensureStandardOfCare(structured, { text, diagnoses: ocrBundle.diagnoses });
    
    // 4. Render HTML
    console.log("Step 4: Rendering HTML...");
    const htmlReport = renderHtmlReport(structured, lang);

    console.log("--- Request Processed Successfully ---");
    return ok(res, { html: htmlReport, structured, ocr: ocrBundle });

  } catch (err) {
    console.error("---!!!--- FATAL ERROR ---!!!---", { message: err.message, stack: err.stack });
    return bad(res, 500, `Internal server error: ${err.message}`);
  }
}
