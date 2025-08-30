// /pages/api/case-analyzer.js  (أو /api/case-analyzer.js حسب إطارك)
// V9.0 - Clinical Consultant Engine (Arabic-first) with Evidence Citations

export const config = { runtime: "nodejs", maxDuration: 60 };

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || "";

const OPENAI_MODEL = "gpt-4o-2024-08-06";
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const MAX_TOKENS = 16384;

/* -------------------- Utilities -------------------- */
async function readJson(req) {
  try {
    if (req.body && typeof req.body === "object" && Object.keys(req.body).length) return req.body;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8") || "{}";
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON payload: ${e.message}`);
  }
}

function extractJSON(text) {
  if (!text) return null;
  const clean = text.trim().replace(/^```(json)?|```$/g, "").trim();
  try {
    const s = clean.indexOf("{");
    const e = clean.lastIndexOf("}");
    if (s !== -1 && e !== -1 && e > s) return JSON.parse(clean.slice(s, e + 1));
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

function unique(arr, key = (x) => JSON.stringify(x).slice(0, 300)) {
  const seen = new Set();
  const out = [];
  for (const it of arr || []) {
    const sig = key(it);
    if (!seen.has(sig)) { out.push(it); seen.add(sig); }
  }
  return out;
}

/* -------------------- Evidence DB (authoritative links) -------------------- */
/** تُضاف تلقائيًا للمخرجات بحسب ما يُكتشف من تشخيص/دواء. */
const EVIDENCE_DB = [
  // Diabetes – Standards of Care
  { tag: "ADA-CVD", title: "ADA SoC 2024 – Cardiovascular Disease & Risk Management", url: "https://diabetesjournals.org/care/article/47/Supplement_1/S179/153957/10-Cardiovascular-Disease-and-Risk-Management" },
  { tag: "ADA-CKD", title: "ADA SoC 2024 – Chronic Kidney Disease & Risk Management", url: "https://diabetesjournals.org/care/article/47/Supplement_1/S219/153938/11-Chronic-Kidney-Disease-and-Risk-Management" },
  { tag: "ADA-TECH", title: "ADA SoC 2024 – Diabetes Technology (BGM/CGM & SMBG)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10725813/" },
  { tag: "ADA-GLYC", title: "ADA SoC 2024 – Glycemic Goals & Hypoglycemia", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10725808/" },

  // KDIGO CKD 2024
  { tag: "KDIGO-2024", title: "KDIGO 2024 CKD Guideline (Full PDF)", url: "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf" },
  { tag: "KDIGO-2024-Exec", title: "KDIGO 2024 CKD Guideline – Executive Summary", url: "https://kdigo.org/wp-content/uploads/2017/02/KDIGO-2024-CKD-Guideline-Executive-Summary.pdf" },

  // Statins intensity
  { tag: "STATIN-INTENSITY", title: "ACC/AHA Statin Intensity Table (NCBI Bookshelf)", url: "https://www.ncbi.nlm.nih.gov/books/NBK583664/table/ch1.tab1/" },

  // BPH / Tamsulosin
  { tag: "AUA-BPH-2023", title: "AUA Guideline (2023) – Management of BPH", url: "https://www.auanet.org/guidelines-and-quality/guidelines/benign-prostatic-hyperplasia-(bph)-guideline" },
  { tag: "TAMSULOSIN-LBL", title: "Tamsulosin – DailyMed (orthostatic hypotension warning)", url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=428b176a-a1b6-2f8a-e054-00144ff8d46c" },

  // NSAIDs / Diclofenac
  { tag: "DICLOFENAC-LBL", title: "Diclofenac – DailyMed (renal/CV/HTN cautions)", url: "https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=ac2b4060-a5da-4ddf-a734-2ff58a1f98c9" },
  { tag: "TRIPLE-WHAMMY", title: "Avoiding the ‘Triple Whammy’ (ACEi/ARB + diuretic + NSAID)", url: "https://bpac.org.nz/2018/triple-whammy.aspx" },

  // PPI deprescribing
  { tag: "AGA-PPI-2022", title: "AGA Clinical Practice Update – De-prescribing PPIs (2022)", url: "https://gastro.org/clinical-guidance/de-prescribing-proton-pump-inhibitors-ppis-clinical-practice-update/" },

  // OA supplements
  { tag: "ACR-OA-2019", title: "2019 ACR Guideline – OA management (glucosamine/chondroitin)", url: "https://onlinelibrary.wiley.com/doi/10.1002/art.41142" },

  // Diabetic eye/foot care (SoC)
  { tag: "ADA-RETIN", title: "ADA SoC – Retinopathy (dilated eye exam)", url: "https://diabetesjournals.org/care/article/48/Supplement_1/S197/157548/12-Retinopathy-Screening-and-Treatment-in-Adults" },
  { tag: "ADA-FOOT", title: "ADA SoC 2024 – Foot Care", url: "https://diabetesjournals.org/care/article/47/Supplement_1/S254/153956/12-Foot-Care-Standards-of-Care-in-Diabetes-2024" },

  // Sulfonylureas in older adults
  { tag: "SULFONYLUREA", title: "Sulfonylureas – StatPearls (hypoglycemia; older adults)", url: "https://www.ncbi.nlm.nih.gov/books/NBK513225/" }
];

function pickEvidence({ meds = [], diagnoses = [] }) {
  const tags = new Set();

  const text = (meds.join(" ") + " " + diagnoses.join(" ")).toLowerCase();
  const has = (s) => text.includes(s);

  // CKD/DM/BP -> KDIGO/ADA
  if (has("ckd") || has("nephropathy") || has("اعتلال") || has("kidney")) tags.add("KDIGO-2024"), tags.add("ADA-CKD");
  if (has("diab") || has("سكري")) tags.add("ADA-GLYC"), tags.add("ADA-TECH");
  if (has("hypertension") || has("ضغط")) tags.add("ADA-CVD");

  // NSAIDs / diclofenac / triple whammy
  if (has("diclac") || has("diclofenac") || has("nsaid")) tags.add("DICLOFENAC-LBL"), tags.add("TRIPLE-WHAMMY"), tags.add("KDIGO-2024");

  // PPI high dose long duration
  if (has("panto") || has("pantoprazole") || has("ppi")) tags.add("AGA-PPI-2022");

  // Statin intensity
  if (has("rosuvastatin") || has("rozavi") || has("ستاتين") || has("statin")) tags.add("STATIN-INTENSITY"), tags.add("ADA-CVD");

  // BPH / tamsulosin
  if (has("duodart") || has("tamsulosin") || has("dutasteride")) tags.add("AUA-BPH-2023"), tags.add("TAMSULOSIN-LBL");

  // OA supplements
  if (has("glucosamine") || has("jointace") || has("chondroitin")) tags.add("ACR-OA-2019");

  // SU (gliclazide / glimepiride / glibenclamide…)
  if (has("gliclazide") || has("glic") || has("diamicron") || has("sulfonylurea") || has("سلفونيل")) tags.add("SULFONYLUREA"), tags.add("ADA-GLYC");

  // eye/foot care gaps for diabetes
  if (has("diab") || has("سكري")) tags.add("ADA-RETIN"), tags.add("ADA-FOOT");

  return EVIDENCE_DB.filter(e => tags.has(e.tag));
}

/* -------------------- Prompt builders -------------------- */
function buildSystemPrompt(lang = "ar", specialty = "") {
  const L = (ar, en) => (lang === "ar" ? ar : en);

  return L(
`أنت "استشاري صيدلة سريرية وتدقيق تأميني". قيّم وصفات بخط اليد/صور وارجع بتقرير JSON مُهيكل فقط (بدون أي شروحات خارج JSON). 
- لا تُظهر أي تفكير داخلي خطوة بخطوة. 
- قدّم تبريرًا موجزًا مبنيًا على الدليل لكل بند في الحقول المخصصة. 
- راعِ: موانع NSAIDs في السكري/الضغط/اعتلال الكلى، خطر السلفونيل يوريا في المسنين/القصور الكلوي، الضربة الثلاثية (NSAID+مدر+ACEi/ARB)، مخاطر بجرعات PPI العالية طويلة المدى، إطالة QT إن وجدت، ومعايير بيرز لكبار السن.
- لا تخترع أسماء أدوية غير واضحة: ضعها كـ "غير واضح" ووسمها YELLOW مع طلب توضيح.
- أعد فقط JSON يطابق المخطط حرفيًا.`,
`You are a clinical pharmacist and insurance auditor. Return only strict JSON per schema, no free text.`
  );
}

function buildUserMessage({ lang, context, text, images }) {
  const L = (ar, en) => (lang === "ar" ? ar : en);
  const truncated = (text || "").slice(0, 100000);
  return L(
`# سياق المراجعة
اللغة: العربية
الهدف: ${context || "مراجعة سريرية/تأمينية وصفية شاملة"}

# المدخلات:
- صور مرفقة: ${images?.length || 0}
- نص مستخرج:
${truncated || "لا يوجد نص مستخرج؛ اعتمد على الصور."}

# المهمة:
حلل الصور/النص وعد إلى JSON فقط وفق المخطط التالي:
{
  "patient_info": { "name":"", "age":"", "gender":"", "file_id":"" },
  "physician_info": { "name":"", "specialty":"" },
  "diagnoses": [],
  "medication_review": [ 
    {
      "medication": "", "dose_frequency":"", "duration_quantity":"",
      "insurance_status_code":"GREEN|YELLOW|RED",
      "status_emoji":"🟢|🟡|🔴",
      "clinical_risk_level":"None|Low|Medium|High|Critical",
      "justification":"تعليل موجز مبني دليل",
      "action_required":"None|Monitor|Stop|Clarify Dose|Switch"
    }
  ],
  "consultative_analysis": {
    "red_flags_immediate_action": [ { "issue":"", "recommendation":"" } ],
    "yellow_flags_monitoring_needed": [ { "issue":"", "recommendation":"" } ],
    "green_flags_appropriate_care": [ { "item":"", "note":"" } ]
  },
  "gap_analysis_missing_interventions": [ { "gap":"", "recommendation":"" } ],
  "executive_summary":"ملخص موجز عملي",
  "sources": [ { "title":"", "url":"" } ],
  "safety_disclaimer":""
}`,
`# Review Context ...`
  );
}

/* -------------------- Model callers -------------------- */
async function callOpenAI({ lang, specialty, userMsg, images }) {
  if (!OPENAI_API_KEY) return { ok: false, note: "OPENAI_API_KEY missing" };
  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });
    const content = [{ type: "text", text: userMsg }];
    for (const b64 of images || []) {
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" } });
    }
    const system = buildSystemPrompt(lang, specialty);
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.15,
      response_format: { type: "json_object" },
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: system },
        { role: "user", content: content }
      ]
    });
    const raw = completion.choices?.[0]?.message?.content || "";
    const data = extractJSON(raw);
    if (!data) throw new Error("OpenAI returned non-JSON.");
    return { ok: true, raw, data };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function callGemini({ lang, specialty, userMsg, images }) {
  if (!GEMINI_API_KEY) return { ok: false, note: "GEMINI_API_KEY missing" };
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const system = buildSystemPrompt(lang, specialty);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: system,
      generationConfig: { temperature: 0.15, maxOutputTokens: MAX_TOKENS, responseMimeType: "application/json" }
    });
    const parts = [{ text: userMsg }];
    for (const b64 of images || []) parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } });
    const result = await model.generateContent({ contents: [{ role: "user", parts }] });
    const raw = result.response?.text() || "";
    const data = extractJSON(raw);
    if (!data) throw new Error("Gemini returned non-JSON.");
    return { ok: true, raw, data };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/* -------------------- Merger & Post-processing -------------------- */
function scoreReport(r) {
  if (!r || typeof r !== "object") return 0;
  let s = 0;
  s += (r.medication_review?.length || 0) * 40;
  s += (r.consultative_analysis?.red_flags_immediate_action?.length || 0) * 80;
  s += (r.gap_analysis_missing_interventions?.length || 0) * 50;
  s += (r.executive_summary?.length || 0);
  return s;
}

function mergeReports(a = {}, b = {}) {
  const primary = scoreReport(a) >= scoreReport(b) ? a : b;
  const secondary = primary === a ? b : a;

  const merged = {
    patient_info: primary.patient_info || secondary.patient_info || {},
    physician_info: primary.physician_info || secondary.physician_info || {},
    diagnoses: unique([...(primary.diagnoses || []), ...(secondary.diagnoses || [])]),
    medication_review: unique([...(primary.medication_review || []), ...(secondary.medication_review || [])],
      (x) => (x && (x.medication || "")).toLowerCase()),
    consultative_analysis: {
      red_flags_immediate_action: unique([...(primary.consultative_analysis?.red_flags_immediate_action || []),
        ...(secondary.consultative_analysis?.red_flags_immediate_action || [])], (x) => (x.issue || "").toLowerCase()),
      yellow_flags_monitoring_needed: unique([...(primary.consultative_analysis?.yellow_flags_monitoring_needed || []),
        ...(secondary.consultative_analysis?.yellow_flags_monitoring_needed || [])], (x) => (x.issue || "").toLowerCase()),
      green_flags_appropriate_care: unique([...(primary.consultative_analysis?.green_flags_appropriate_care || []),
        ...(secondary.consultative_analysis?.green_flags_appropriate_care || [])], (x) => (x.item || "").toLowerCase())
    },
    gap_analysis_missing_interventions: unique([...(primary.gap_analysis_missing_interventions || []),
      ...(secondary.gap_analysis_missing_interventions || [])], (x) => (x.gap || "").toLowerCase()),
    executive_summary: primary.executive_summary || secondary.executive_summary || "",
    sources: unique([...(primary.sources || []), ...(secondary.sources || [])], (x) => (x.url || "").toLowerCase()),
    safety_disclaimer: primary.safety_disclaimer || secondary.safety_disclaimer ||
      "إخلاء مسؤولية: هذا التقرير آلي للمراجعة السريرية/التأمينية ويجب أن يُراجع من مختص مرخَّص قبل أي قرار علاجي."
  };

  // Auto-attach authoritative citations based on content
  const meds = (merged.medication_review || []).map(m => (m.medication || ""));
  const ev = pickEvidence({ meds, diagnoses: merged.diagnoses || [] });
  const autoSources = ev.map(e => ({ title: e.title, url: e.url }));
  merged.sources = unique([...(merged.sources || []), ...autoSources], (x) => (x.url || "").toLowerCase());

  // Normalize status emojis if missing
  for (const m of merged.medication_review || []) {
    if (!m.status_emoji) {
      m.status_emoji = m.insurance_status_code === "GREEN" ? "🟢" :
                       m.insurance_status_code === "RED"   ? "🔴" : "🟡";
    }
  }
  return merged;
}

/* -------------------- Handler -------------------- */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

    const body = await readJson(req);
    const { lang = "ar", modelChoice = "both", specialty = "", context = "", images = [], text = "" } = body || {};
    if (!images.length && !text.trim()) return res.status(400).json({ ok: false, error: "No content provided." });
    if (!OPENAI_API_KEY && !GEMINI_API_KEY) return res.status(500).json({ ok: false, error: "Missing API keys." });

    const userMsg = buildUserMessage({ lang, context, text: text.slice(0, 100000), images });
    const wantsGPT = (modelChoice === "both" || modelChoice === "gpt") && !!OPENAI_API_KEY;
    const wantsGem = (modelChoice === "both" || modelChoice === "gemini") && !!GEMINI_API_KEY;

    const [gpt, gem] = await Promise.all([
      wantsGPT ? callOpenAI({ lang, specialty, userMsg, images }) : Promise.resolve({ ok: false, note: "GPT disabled/key missing" }),
      wantsGem ? callGemini({ lang, specialty, userMsg, images }) : Promise.resolve({ ok: false, note: "Gemini disabled/key missing" })
    ]);

    if (!gpt?.data && !gem?.data) {
      return res.status(500).json({ ok: false, error: "Both models failed.", gpt, gemini: gem });
    }

    const merged = mergeReports(gpt?.data || {}, gem?.data || {});
    return res.status(200).json({
      ok: true,
      version: "v9.0.0",
      merged,
      gpt: { ok: gpt.ok, raw: gpt.raw, error: gpt.error, note: gpt.note },
      gemini: { ok: gem.ok, raw: gem.raw, error: gem.error, note: gem.note }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
