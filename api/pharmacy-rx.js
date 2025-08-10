/* eslint-disable */
// pages/api/pharmacy-rx.js
//
// عقلٌ مدبّر (AR/EN) لتحليل روشتات وصور + نصوص:
// - OCR (OCR.space أو tesseract.js اختياري)
// - Post-processing لتصحيح أسماء الأدوية
// - استخراج {name, dose} من كل سطر
// - تحليل تداخلات ومحاذير: عمر/كلية/كبد/حمل/إرضاع/وزن
// - إخراج JSON + HTML ملون بالخطورة (🟥 🟧 🟩 🔵)
// -------------------------------------------------------------------

const USE_OCRSPACE = !!process.env.OCRSPACE_API_KEY;
const OCRSPACE_API_KEY = process.env.OCRSPACE_API_KEY || "";
const TESSERACT_ENABLED = process.env.TESSERACT_ENABLED === "1";

// تحميل tesseract فقط إذا فعّلته
let Tesseract = null;
if (!USE_OCRSPACE && TESSERACT_ENABLED) {
  try { Tesseract = require("tesseract.js"); } catch { /* ignore */ }
}

// ------------------ أدوات عامة ------------------
const SEV = {
  HIGH: { code: "HIGH", label: "شديد جدًا", color: "#DC2626", emoji: "🟥" },
  MOD:  { code: "MOD",  label: "متوسط",    color: "#F59E0B", emoji: "🟧" },
  LOW:  { code: "LOW",  label: "منخفض",    color: "#16A34A", emoji: "🟩" },
  INFO: { code: "INFO", label: "تنبيه",    color: "#0891B2", emoji: "🔵" },
};

function norm(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\.\-\/\+\(\)\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function softNormalizeLine(s = "") {
  return String(s)
    .replace(/[^\w\u0600-\u06FF\.\-\/\s\+]/g, " ")
    .replace(/(\d+)\s*mg\b/ig, "$1 mg")
    .replace(/\s+/g, " ")
    .trim();
}
function escapeHTML(s){ return String(s||"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])) }
function parseDoseMg(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+(\.\d+)?)\s*mg\b/i);
  return m ? parseFloat(m[1]) : null;
}

// ------------------ تصحيحات OCR دوائية ------------------
const OCR_CORRECTIONS = [
  [/^amilodipin(e)?\b/i, 'amlodipine'], [/\bamlodipin\b/i, 'amlodipine'],
  [/\brozavi\b/i, 'rosuvastatin'], [/\bcrestor\b/i, 'rosuvastatin'],
  [/\batorva(statin)?\b/i, 'atorvastatin'],
  [/\bduodart\b/i, 'dutasteride/tamsulosin'], [/\bjalyn\b/i, 'dutasteride/tamsulosin'],
  [/\btams?ulosin\b/i, 'tamsulosin'],
  [/\bglucophage(\s*xr)?\b/i, 'metformin xr'],
  [/\b(formet|formot)\s*xr?\s*([0-9]+)\b/i, (m,_,d)=> `metformin xr ${d} mg`],
  [/\bmetfor(r|rn?in)\b/i, 'metformin'],
  [/\bdiam?icron\s*mr?\s*([0-9]+)?\b/i, (m,d)=> `gliclazide mr ${d?d+' mg':''}`.trim()],
  [/\bgliclazide\s*m(r)?\b/i, 'gliclazide mr'],
  [/\bsita(gliptin)?\b/i, 'sitagliptin'],
  [/\bpanto(max|prazole)\b/i, 'pantoprazole'], [/\bnexium\b/i, 'esomeprazole'],
  [/\bparacetam(o|a)l\b/i, 'paracetamol'], [/\bacetaminophen\b/i, 'paracetamol'],
  [/\bibu(profen)?\b/i, 'ibuprofen'], [/\bdiclofenac\b/i, 'diclofenac'],
  [/\b(hct|hctz)\b/i, 'hydrochlorothiazide'],
  [/\bexforge(\s*hct)?\b/i, (m,h)=> h? 'amlodipine/valsartan/hydrochlorothiazide' : 'amlodipine/valsartan'],

  // عربي
  [/أملود?ي?بين/gi, 'amlodipine'],
  [/روزوفاستاتين/gi, 'rosuvastatin'], [/أتورفاستاتين/gi, 'atorvastatin'],
  [/ديوادارت/gi, 'dutasteride/tamsulosin'], [/تامسولوسين/gi, 'tamsulosin'],
  [/ميتفورمين/gi, 'metformin'], [/جليك?لازايد\s*ام\s*ار/gi, 'gliclazide mr'],
  [/بانتوبرازول/gi, 'pantoprazole'], [/اي?بوبروفين/gi, 'ibuprofen'],
  [/ديكلوفيناك/gi, 'diclofenac'],
  [/فالسارتان\s*\/?\s*ه?ي?در?و?كلوروثيازيد/gi, 'valsartan/hydrochlorothiazide'],
];
function applyCorrections(line){
  let out = ' ' + softNormalizeLine(line) + ' ';
  for (const [re, rep] of OCR_CORRECTIONS) out = out.replace(re, rep);
  // أضف mg المفقودة لأدوية شائعة لو تبعها رقم فقط
  out = out.replace(/\b(amlodipine|rosuvastatin|atorvastatin|gliclazide mr|metformin( xr)?)\s+(\d+)\b/gi,
    (m,drug, xr, dose)=> `${drug} ${dose} mg`);
  return out.trim();
}
function splitLines(text=""){
  if (!text) return [];
  const lines = text.split(/\r?\n+/).map(softNormalizeLine).map(applyCorrections).filter(Boolean);
  const uniq = new Set(); const out = [];
  for (const l of lines) { const k=l.toLowerCase(); if(!uniq.has(k)){uniq.add(k); out.push(l);} }
  return out;
}

// ------------------ OCR من الصور ------------------
async function ocrWithOcrSpace(image){
  // image: dataURL (base64) أو URL مباشر
  const isUrl = /^https?:\/\//i.test(image);
  const form = new URLSearchParams();
  form.append("language", "eng"); // أسماء الأدوية غالبًا إنجليزية
  form.append("isOverlayRequired", "false");
  form.append("scale", "true");
  form.append("OCREngine", "2");
  if (isUrl) form.append("url", image);
  else {
    const b64 = image.replace(/^data:.+;base64,/, "");
    form.append("base64Image", "data:image/jpeg;base64," + b64);
  }
  const r = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: OCRSPACE_API_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const j = await r.json();
  if (!r.ok || !j?.ParsedResults?.length) throw new Error("OCR.space failed");
  return (j.ParsedResults.map(x => x.ParsedText || "").join("\n")).trim();
}
async function ocrWithTesseract(image){
  if (!Tesseract) throw new Error("tesseract.js not available");
  let img = image;
  if (!/^data:/.test(img) && /^https?:\/\//.test(img)) {
    const rr = await fetch(img); const buf = Buffer.from(await rr.arrayBuffer());
    img = "data:image/jpeg;base64," + buf.toString("base64");
  }
  const { data } = await Tesseract.recognize(img, "eng+ara", { tessedit_pageseg_mode: 6 });
  return (data?.text || "").trim();
}
async function extractTextFromImages(images = []){
  const chunks = [];
  for (const img of images) {
    try {
      const txt = USE_OCRSPACE ? await ocrWithOcrSpace(img)
                : (Tesseract ? await ocrWithTesseract(img) : "");
      if (txt) chunks.push(txt);
    } catch { /* تجاهل الصورة الفاشلة ونكمل */ }
  }
  return chunks.join("\n").trim();
}

// ------------------ قاعدة مصغّرة لأسماء/فئات/محاذير ------------------
// (مكان مناسب للتوسع لاحقًا/ربطه بقاعدة أكبر)
const ALIASES = {
  aspirin: ["asa","acetylsalicylic","أسبرين","اسبرين"],
  warfarin: ["coumadin","warf","وارفارين","كومادين"],
  apixaban: ["eliquis","أبيكسابان","إليكويس"],
  rivaroxaban: ["xarelto","ريفاروكسابان","زاريلتو"],
  dabigatran: ["pradaxa","دابيغاتران","براداكسا","براداكسـا"],
  edoxaban: ["savaysa","إدوكسابان","سافيسا"],
  amlodipine: ["norvasc","أملوديبين"],
  valsartan: ["فالسارتان"],
  losartan: ["لوسارتان"],
  olmesartan: ["أولميسارتان"],
  candesartan: ["كانديسارتان"],
  lisinopril: ["ليزينوبريل"],
  perindopril: ["بيريندوبريل"],
  hct: ["hydrochlorothiazide","hct","hctz","هيدروكلوروثيازيد"],
  exforge: ["amlodipine/valsartan","exforge","أملوديبين/فالسارتان"],
  rosuvastatin: ["crestor","روزوفاستاتين","rozavi"],
  atorvastatin: ["lipitor","أتورفاستاتين"],
  metformin: ["glucophage","ميتفورمين","metformin xr","glucophage xr"],
  gliclazide: ["diamicron mr","جليكلازايد mr","damicron mr"],
  sitagliptin: ["januvia","سيتاجلبتين"],
  pantoprazole: ["protonix","بانتوبرازول","pantomax"],
  esomeprazole: ["nexium","إيزوميبرازول"],
  ibuprofen: ["advil","brufen","ايبوبروفين"],
  diclofenac: ["voltaren","ديكلوفيناك"],
  tamsulosin: ["flomax","تامسولوسين"],
  "dutasteride/tamsulosin": ["duodart","jalyn","ديوادارت"],
  nitroglycerin: ["nitro","نترات الغليسيريل","glyceryl trinitrate"],
  sildenafil: ["viagra","سيلدينافيل"],
  tadalafil: ["cialis","تادالافيل"],
  spironolactone: ["aldactone","سبيرونولاكتون"],
};

const ORAL_ANTICOAGULANTS = ["warfarin","apixaban","rivaroxaban","dabigatran","edoxaban"];
const NSAIDS = ["ibuprofen","diclofenac"];
const ACEI = ["lisinopril","perindopril","ramipril","captopril","enalapril"];
const ARB  = ["valsartan","losartan","olmesartan","candesartan"];
const STATINS = ["rosuvastatin","atorvastatin","simvastatin","pravastatin"];
const PDE5 = ["sildenafil","tadalafil"];
const NITRATES = ["nitroglycerin"];
const K_SPARING = ["spironolactone"];

// ------------------ بناء قائمة أدوية من الأسطر ------------------
function parseLinesToMeds(allLines = []){
  const meds = [];
  for (const raw of allLines) {
    const line = applyCorrections(raw);
    if (!line) continue;
    // حاول فصل الجرعة
    const mgm = line.match(/(\d+(?:\.\d+)?)\s*mg\b/i);
    let name = line, dose = null;
    if (mgm) { dose = `${mgm[1]} mg`; name = line.replace(mgm[0], "").trim(); }
    meds.push({ name, dose });
  }
  // إزالة تكرارات
  const seen = new Set(); const out = [];
  for (const m of meds) {
    const k = norm(m.name) + "|" + (m.dose||"");
    if (!seen.has(k)) { seen.add(k); out.push(m); }
  }
  return out;
}

// تحويل اسم خام إلى "اسم قياسي" لو أمكن (للربط بالقواعد)
function mapToCanonical(drugName=""){
  const n = norm(drugName);
  for (const key of Object.keys(ALIASES)) {
    if (n.includes(key)) return key;
  }
  for (const [key, arr] of Object.entries(ALIASES)) {
    if (arr.some(a => n.includes(norm(a)))) return key;
  }
  return n.split(/\s+/)[0]; // fallback: أول كلمة
}

// ------------------ القواعد السريرية ------------------
function hasDrug(meds, keyList){ // يقبل مفاتيح canonical
  return meds.some(m => keyList.includes(mapToCanonical(m.name)));
}
function findDrug(meds, key){
  return meds.find(m => mapToCanonical(m.name) === key);
}

// 1) أسبرين + مضاد تخثر فموي ⇒ نزف (شديد)
function ruleAspirinWithOAC(ctx){
  const { meds } = ctx;
  const hasAsp = hasDrug(meds, ["aspirin"]);
  const hasOAC = ORAL_ANTICOAGULANTS.some(k => hasDrug(meds, [k]));
  if (hasAsp && hasOAC) return {applies:true, sev:SEV.HIGH, code:"ASPIRIN_OAC",
    title:"تداخل خطير: أسبرين + مضاد تخثر",
    message:"الجمع يرفع خطر النزف بشكل ملحوظ. راجِع الإيقاف/التعديل فورًا مع الطبيب."};
  if (!hasAsp && hasOAC) return {applies:true, sev:SEV.INFO, code:"ASPIRIN_INFO",
    title:"تنبيه حول إضافة الأسبرين",
    message:"تجنّب إضافة الأسبرين دون استطباب واضح مع مضاد تخثر."};
  return {applies:false};
}

// 2) حمل وإرضاع + NSAIDs/أسبرين
function rulePregnancyLactation(ctx){
  const { conditions, meds } = ctx;
  const pregnant = !!conditions?.pregnancy?.pregnant;
  const weeks = conditions?.pregnancy?.weeks || null;
  const lact = !!conditions?.lactation;

  const hasNSAID = NSAIDS.some(k => hasDrug(meds,[k]));
  const asp = findDrug(meds,"aspirin");
  const aspDose = asp ? parseDoseMg(asp.dose) : null;

  // حمل: بعد الأسبوع 20 تجنّب NSAIDs، والأسبرين العالي خطِر
  if (pregnant) {
    if (weeks!=null && weeks >= 20 && hasNSAID)
      return {applies:true, sev:SEV.HIGH, code:"PREG_NSAID_20W",
        title:"حمل ≥20 أسبوعًا وNSAIDs",
        message:"يُتجنّب NSAIDs بعد الأسبوع 20 لمخاطر كلوية جنينية/انخفاض السائل الأمنيوسي."};
    if (asp && aspDose!=null && aspDose>150)
      return {applies:true, sev:SEV.HIGH, code:"PREG_ASP_HIGH",
        title:"أسبرين عالي الجرعة أثناء الحمل",
        message:"جرعات الأسبرين العالية غير محبذة عمومًا في الحمل. راجِع الإيقاف/التعديل فورًا."};
    if (asp && (aspDose==null || aspDose<=150))
      return {applies:true, sev:SEV.MOD, code:"PREG_ASP_LOW",
        title:"أسبرين منخفض الجرعة أثناء الحمل",
        message:"قد يُستخدم لاستطبابات توليدية خاصة وتحت إشراف نسائية. أكّد الضرورة والمتابعة."};
  }

  // إرضاع: الأسبرين بجرعات عالية غير مفضّل؛ الإيبوبروفين يُعد خيارًا أفضل عادة
  if (lact) {
    if (asp && aspDose && aspDose>100)
      return {applies:true, sev:SEV.MOD, code:"LACT_ASP_HIGH",
        title:"أسبرين عالي الجرعة أثناء الإرضاع",
        message:"فضّل بدائل (مثل إيبوبروفين بجرعات مناسبة) لتقليل مخاطر على الرضيع/النزف."};
    if (hasNSAID)
      return {applies:true, sev:SEV.INFO, code:"LACT_NSAID_INFO",
        title:"NSAIDs والإرضاع",
        message:"إيبوبروفين غالبًا آمن بجرعات معتدلة. التزِم بأقل جرعة لأقصر مدة وتابع أي آثار غير معتادة."};
  }

  return {applies:false};
}

// 3) CKD + NSAIDs / أسبرين جرعات أعلى
function ruleCKD(ctx){
  const { conditions, meds } = ctx;
  const eGFR = conditions?.eGFR;
  const ckdStage = conditions?.ckdStage || (typeof eGFR==="number" ? (eGFR<15?5: eGFR<30?4: eGFR<60?3:2) : null);
  if (!ckdStage || ckdStage < 3) return {applies:false};

  const hasNsaid = NSAIDS.some(k => hasDrug(meds,[k]));
  if (hasNsaid) return {applies:true, sev:(ckdStage>=4?SEV.HIGH:SEV.MOD), code:"CKD_NSAID",
    title:"NSAIDs ومرض كلوي مزمن",
    message:"تُتجنّب NSAIDs في CKD خاصة المراحل المتقدمة؛ قد ترفع الضغط وتضعف وظائف الكلى."};

  const asp = findDrug(meds,"aspirin"); const d = asp?parseDoseMg(asp.dose):null;
  if (asp && d && d>81) return {applies:true, sev:SEV.MOD, code:"CKD_ASP_DOSE",
    title:"أسبرين وCKD",
    message:"الجرعات الأعلى من المنخفضة قد لا تكون مفضلة في CKD. ناقش خفض الجرعة/بدائل ومراقبة النزف."};

  return {applies:false};
}

// 4) كبد
function ruleLiver(ctx){
  const { conditions, meds } = ctx;
  if (!conditions?.liverDisease) return {applies:false};
  const asp = hasDrug(meds,["aspirin"]);
  if (asp) return {applies:true, sev:SEV.MOD, code:"LIVER_ASP",
    title:"أسبرين ومرض كبدي",
    message:"قد ترتفع مخاطر النزف مع اضطرابات التخثر. راجع ضرورة الاستعمال والجرعة والمراقبة."};
  return {applies:true, sev:SEV.INFO, code:"LIVER_INFO",
    title:"تنبيه كبدي عام",
    message:"مع المرض الكبدي، استخدم أقل جرعة ومدة ممكنة وفكّر ببدائل أكثر أمانًا."};
}

// 5) جرعة بالوزن (مثال مبسط على الأسبرين)
function ruleDoseByWeight(ctx){
  const { demographics, meds } = ctx;
  const w = demographics?.weightKg;
  if (!w) return {applies:false};
  const asp = findDrug(meds,"aspirin");
  if (asp) {
    const d = parseDoseMg(asp.dose);
    if (d && d>100) return {applies:true, sev:SEV.MOD, code:"DOSE_ASP_WEIGHT",
      title:"جرعة الأسبرين أعلى من المنخفضة",
      message:`جرعة ${d} mg قد تتجاوز المنخفضة المعتادة للوقاية. تحقّق من الاستطباب وخطر النزف (وزن ${w} كغ).`};
  }
  return {applies:false};
}

// 6) ACEi + ARB (تجنّب)
function ruleDualRAS(ctx){
  const meds = ctx.meds.map(m=>mapToCanonical(m.name));
  const hasAce = meds.some(x => ACEI.includes(x));
  const hasArb = meds.some(x => ARB.includes(x) || x==="valsartan/hydrochlorothiazide");
  if (hasAce && hasArb) return {applies:true, sev:SEV.HIGH, code:"DUAL_RAS",
    title:"تجنّب الجمع ACEi + ARB",
    message:"يزيد مخاطر الكُلى وفرط بوتاسيوم دون فائدة واضحة."};
  return {applies:false};
}

// 7) ARB/ACEi + سبيرونولاكتون + CKD ⇒ فرط بوتاسيوم
function ruleHyperK(ctx){
  const meds = ctx.meds.map(m=>mapToCanonical(m.name));
  const hasRas = meds.some(x => ACEI.includes(x) || ARB.includes(x));
  const hasSpir = meds.some(x => K_SPARING.includes(x));
  const eGFR = ctx.conditions?.eGFR;
  if (hasRas && hasSpir && (eGFR!=null && eGFR<60))
    return {applies:true, sev:SEV.HIGH, code:"HYPERK_RISK",
      title:"خطر فرط بوتاسيوم الدم",
      message:"الجمع مع قصور كلوي يزيد خطر فرط بوتاسيوم. راجع الجرعات/الضرورة والمراقبة اللصيقة."};
  return {applies:false};
}

// 8) PDE5 + نترات ⇒ هبوط ضغط شديد (ممنوع)
function rulePDE5_Nitrates(ctx){
  const hasPDE5 = ctx.meds.some(m => PDE5.includes(mapToCanonical(m.name)));
  const hasNit = ctx.meds.some(m => NITRATES.includes(mapToCanonical(m.name)));
  if (hasPDE5 && hasNit) return {applies:true, sev:SEV.HIGH, code:"PDE5_NIT",
    title:"تداخل خطير: نترات + مثبط PDE5",
    message:"هبوط ضغط شديد/خطر إغماء. يُمنع الجمع."};
  return {applies:false};
}

// 9) Metformin + eGFR
function ruleMetforminRenal(ctx){
  const hasMet = ctx.meds.some(m => mapToCanonical(m.name).startsWith("metformin"));
  const egfr = ctx.conditions?.eGFR;
  if (!hasMet || egfr==null) return {applies:false};
  if (egfr<30) return {applies:true, sev:SEV.HIGH, code:"MET_CONTRA",
    title:"ميتفورمين: eGFR < 30",
    message:"مُضاد استطباب. أوقف/لا تبدأ الميتفورمين."};
  if (egfr>=30 && egfr<45) return {applies:true, sev:SEV.MOD, code:"MET_REDUCE",
    title:"ميتفورمين: تقليل جرعة (eGFR 30–44)",
    message:"حدّ الجرعة ومراقبة B12 والوظائف."};
  return {applies:false};
}

// 10) Rosuvastatin + CKD شديد
function ruleRosuvastatinRenal(ctx){
  const rosu = ctx.meds.find(m => mapToCanonical(m.name)==="rosuvastatin");
  const egfr = ctx.conditions?.eGFR;
  if (!rosu || egfr==null) return {applies:false};
  const mg = parseDoseMg(rosu.dose);
  if (egfr<30 && (!mg || mg>10))
    return {applies:true, sev:SEV.HIGH, code:"ROSU_MAX10",
      title:"روزوفاستاتين والقصور الكلوي",
      message:"في القصور الشديد يُفضّل ≤10 mg (البدء 5 mg) أو بدائل."};
  return {applies:false};
}

// 11) عمر متقدّم + سلفونيل يوريا ⇒ خطر هبوط سكر
function ruleSU_Elderly(ctx){
  const hasSU = ctx.meds.some(m => mapToCanonical(m.name).startsWith("gliclazide"));
  const age = ctx.demographics?.age;
  const egfr = ctx.conditions?.eGFR;
  if (!hasSU) return {applies:false};
  if ((age && age>=65) || (egfr!=null && egfr<60))
    return {applies:true, sev:SEV.MOD, code:"SU_HYPO",
      title:"سلفونيل يوريا في الكبار/CKD",
      message:"خطر هبوط سكر أعلى؛ فكّر ببدائل/جرعات أقل ومراقبة لصيقة."};
  return {applies:false};
}

const RULES = [
  ruleAspirinWithOAC,
  rulePregnancyLactation,
  ruleCKD,
  ruleLiver,
  ruleDoseByWeight,
  ruleDualRAS,
  ruleHyperK,
  rulePDE5_Nitrates,
  ruleMetforminRenal,
  ruleRosuvastatinRenal,
  ruleSU_Elderly,
];

// ------------------ تقديم HTML (عامودان) ------------------
function badge(sev){
  return `<span style="display:inline-flex;align-items:center;gap:6px;
    padding:4px 10px;border-radius:9999px;font-weight:700;color:#fff;background:${sev.color};
    font-size:12px;">${sev.emoji} ${sev.label}</span>`;
}

function renderHTML({ meds, findings }){
  const style = `
  <style>
    .rx-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,'Amiri',serif;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:16px}
    .rx-title{font-size:20px;font-weight:800;margin:12px 0;color:#0b63c2}
    .rx-table{width:100%;border-collapse:separate;border-spacing:0 8px}
    .rx-row{background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,0.06)}
    .rx-cell{padding:12px 14px;vertical-align:top}
    .rx-head{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em}
    .rx-drug{font-weight:800}
    .rx-note{font-size:14px;line-height:1.55}
    .rx-muted{font-size:12px;color:#374151;margin:8px 0 0}
  </style>`;

  const medsRows = (meds||[]).map(m => `
    <tr class="rx-row">
      <td class="rx-cell rx-drug">${escapeHTML(m.name)}${m.dose?` — <span style="color:#475569">${escapeHTML(m.dose)}</span>`:''}</td>
      <td class="rx-cell rx-note">—</td>
    </tr>`).join("");

  const fxRows = (findings||[]).map(f => `
    <tr class="rx-row">
      <td class="rx-cell rx-drug">${escapeHTML(f.title)}</td>
      <td class="rx-cell rx-note">${badge(f.sev)}<div style="height:6px"></div>${escapeHTML(f.message)}</td>
    </tr>`).join("");

  return `
  ${style}
  <div class="rx-wrap">
    <div class="rx-title">🧾 قائمة الأدوية</div>
    <table class="rx-table">
      <thead>
        <tr><th class="rx-cell rx-head">الدواء</th><th class="rx-cell rx-head">ملاحظات</th></tr>
      </thead>
      <tbody>${medsRows || `<tr class="rx-row"><td class="rx-cell" colspan="2">—</td></tr>`}</tbody>
    </table>

    <div class="rx-title" style="margin-top:20px">⚠️ التحذيرات والتداخلات</div>
    <table class="rx-table">
      <thead>
        <tr><th class="rx-cell rx-head">العنوان</th><th class="rx-cell rx-head">التفاصيل / مستوى الخطورة</th></tr>
      </thead>
      <tbody>${fxRows || `<tr class="rx-row"><td class="rx-cell" colspan="2">لا توجد ملاحظات حرجة بناءً على القواعد الحالية.</td></tr>`}</tbody>
    </table>

    <div class="rx-muted">الأساطير اللونية: 🟥 شديد جدًا، 🟧 متوسط، 🟩 منخفض، 🔵 تنبيه.</div>
  </div>`;
}

// ------------------ API Handler ------------------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok:false, error:"method_not_allowed" });
    }

    const { texts = [], images = [], patient = {}, demographics = {} } = req.body || {};

    // 1) OCR من الصور (اختياري)
    let ocrText = "";
    if (images && images.length) {
      ocrText = await extractTextFromImages(images);
    }

    // 2) جمع النصوص وتصحيحها
    const linesFromOCR = splitLines(ocrText);
    const linesFromTexts = splitLines((texts || []).join("\n"));
    const allLines = [...linesFromOCR, ...linesFromTexts];

    // 3) تحويل إلى أدوية
    const meds = parseLinesToMeds(allLines);

    // 4) سياق المريض
    const conditions = {
      pregnancy: patient?.pregnancy || null,                 // { pregnant:true, weeks:22 }
      eGFR: (typeof patient?.eGFR === "number" ? patient.eGFR : null),
      ckdStage: patient?.ckdStage || null,
      liverDisease: !!patient?.liverDisease,
      lactation: !!(patient?.lactation?.breastfeeding || patient?.lactation === true),
    };
    const demo = {
      weightKg: patient?.weight || demographics?.weightKg || null,
      age: patient?.age || demographics?.age || null,
      sex: patient?.sex || demographics?.sex || null,
    };

    // 5) تطبيق القواعد
    const ctx = { meds, conditions, demographics: demo };
    const findings = [];
    for (const rule of RULES) {
      const r = rule(ctx);
      if (r && r.applies) findings.push(r);
    }

    // 6) HTML
    const html = renderHTML({ meds, findings });

    // 7) نتيجة
    return res.status(200).json({
      ok: true,
      meds,
      findings,
      html,
      raw: { ocrText, linesFromOCR, linesFromTexts }
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:"analysis_failed", message:e?.message || "Internal error" });
  }
}
