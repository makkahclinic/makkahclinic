// api/gpt.js
// Runtime: Node.js (Vercel Serverless)
// Env: OPENAI_API_KEY, GEMINI_API_KEY

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = { runtime: "nodejs" }; // لا نستخدم Edge لأن Gemini SDK يحتاج Node

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genai  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ———————— إعدادات/ثوابت —————————
const GPT_MODEL   = "gpt-4o-2024-08-06";   // يدعم Chat Completions + image_url (data URL).  :contentReference[oaicite:8]{index=8}
const GEM_MODEL   = "gemini-1.5-pro-latest"; // يدعم inlineData للصورة.  :contentReference[oaicite:9]{index=9}
const MAX_OUTPUT  = 1800;

const JSON_SCHEMA = {
  patient_summary: "",
  key_findings: [],
  physician_actions: {
    chief_complaint: "",
    diagnoses: [],
    icd10_codes: [],
    vitals: [],
    significant_signs: [],
    orders: [],
    meds: []
  },
  contradictions: [{ item:"", evidence:"", impact:"" }],
  procedural_issues: [{ issue:"", evidence:"", impact:"" }],
  missed_opportunities: [{ what:"", why_it_matters:"" }],
  revenue_quality_opportunities: [{ opportunity:"", category:"documentation|diagnostics|procedure|follow-up|coding", rationale:"", risk_note:"" }],
  differential_diagnoses: [{ dx:"", why:"" }],
  should_have_been_done: [{ step:"", reason:"" }],
  suggested_next_steps: [{ action:"", justification:"" }],
  severity_red_flags: [],
  icd_suggestions: [{ code:"", label:"", why:"" }],
  cpt_suggestions: [{ code:"", label:"", why:"" }],
  references: [{ title:"", org:"", link:"" }],
  executive_summary: "",
  patient_safety_note: "هذا المحتوى مُعَدّ لتحسين الجودة والتدقيق التأميني، ويُراجع من طبيب مرخّص قبل أي قرار سريري."
};

// مراجع قياسية لإلزام النموذج بالاستشهاد بها في التحليل
const CLINICAL_CITATIONS = [
  {title:"NICE NG84 — Sore throat (acute): antimicrobial prescribing", org:"NICE", link:"https://www.nice.org.uk/guidance/ng84"},
  {title:"NICE NG120 — Cough (acute): antimicrobial prescribing", org:"NICE", link:"https://www.nice.org.uk/guidance/ng120"},
  {title:"NICE NG136 — Hypertension in adults", org:"NICE", link:"https://www.nice.org.uk/guidance/ng136"},
  {title:"NICE NG118 — Renal and ureteric stones", org:"NICE", link:"https://www.nice.org.uk/guidance/ng118"},
  {title:"NICE NG190 — Secondary bacterial infection of eczema", org:"NICE", link:"https://www.nice.org.uk/guidance/ng190"},
  {title:"FGDP/CGDent — Selection Criteria for Dental Radiography", org:"CGDent", link:"https://cgdent.uk/wp-content/uploads/securepdfs/FGDP-SCDR-ALL-Web.pdf"},
  {title:"NICE CG184 — Dyspepsia / H. pylori test-and-treat", org:"NICE", link:"https://www.nice.org.uk/guidance/cg184"}
];

function systemPrompt(lang="ar", specialty="") {
  const arabicHeader = `
أنت "مُدقّق جودة سريري" و"مراجع تأميني" — لا تقدّم تشخيصًا نهائيًا ولا توصيات علاجية دون مراجعة بشرية.
إزالة أي مُعرّفات شخصية (PHI) وفق Safe Harbor.
لغة الإجابة: ${lang==="en"?"English":"العربية"}${specialty?` — التخصص: ${specialty}`:""}.
أخرج **JSON فقط بلا أي Markdown** وبالبنية الحرفية التالية:
${JSON.stringify(JSON_SCHEMA)}
القواعد:
- استخرج "ما فعله الطبيب" (أعراض/علامات، تشخيصات ICD‑10 إن وُجدت، أوامر/تحاليل/أدوية، العلامات الحيوية).
- "التناقضات": اربط كل تناقض بـ"دليل" نصّي مقتبس بإيجاز من النص/الصورة (عند الإمكان).
- "ما كان يجب عمله" و"الخطوات المقترحة": اجعلها قابلة للتنفيذ وقصيرة ومسنودة بمراجع عالمية (NICE/WHO…).
- "فرص الدخل المقبول تأمينيًا": وثّق لماذا تُقبل (documentation/diagnostics/procedure/follow-up/coding).
- إن تضمن PDF عدة زيارات (وجود Date of Visit/Visit No./أطباء متعددين)، اجمعها في تقرير واحد وحدّد التكرار.
- إذا لم تتوفر بيانات كافية لبند معيّن، أعد مصفوفة/حقلًا فارغًا بدل نص عام.
- أدرج على الأقل 3 مراجع موثوقة من القائمة أدناه إن كانت ذات صلة:
${CLINICAL_CITATIONS.map(r=>`- ${r.title} (${r.org}) ${r.link}`).join("\n")}
`;
  return arabicHeader.trim();
}

function userPrompt(lang, context){
  const heading = lang==="en"
    ? "Analyze these clinical documents (images + extracted PDF text). Return JSON only."
    : "حلّل هذه الوثائق السريرية (صور + نص PDF المُستخرج). أعد JSON فقط دون أي نص إضافي.";
  const ctx = context ? `\nسياق إضافي/تأمين: ${context}\n` : "\n";
  return `${heading}${ctx}التزم بالبنية المطلوبة أعلاه حرفيًا.`;
}

// ———————— أدوات مساعدة —————————
const tryParseJSON = (s) => {
  if (!s) return null;
  // التقط كتلة JSON إن لُفّت بـ ```json
  const m = String(s).match(/\{[\s\S]*\}$/);
  try { return JSON.parse(m?m[0]:s); } catch { return null; }
};

function mergeReports(a,b){
  // دمج بسيط: يفضل الحقول غير الفارغة، ويجمع القوائم مع إزالة التكرار
  const merged = structuredClone(JSON_SCHEMA);
  const pick = (x,y) => (x && (Array.isArray(x)?x.length:typeof x==="object"?Object.keys(x).length:x)) ? x : y;

  merged.patient_summary       = pick(a?.patient_summary, b?.patient_summary) || "";
  merged.key_findings          = [...new Set([...(a?.key_findings||[]), ...(b?.key_findings||[])])];
  merged.physician_actions     = pick(a?.physician_actions, b?.physician_actions) || JSON_SCHEMA.physician_actions;
  const listKeys = ["contradictions","procedural_issues","missed_opportunities","revenue_quality_opportunities","differential_diagnoses","should_have_been_done","suggested_next_steps","severity_red_flags","icd_suggestions","cpt_suggestions"];
  for (const k of listKeys){
    merged[k] = dedupeObjects([...(a?.[k]||[]), ...(b?.[k]||[])]);
  }
  const refs = [...(a?.references||[]), ...(b?.references||[])];
  // أضف المراجع الأساسية إن غابت
  merged.references = dedupeObjects([...(refs||[]), ...CLINICAL_CITATIONS]).slice(0,12);

  // ملخص تنفيذي تلقائي
  merged.executive_summary = [
    (a?.executive_summary||""),
    (b?.executive_summary||""),
    merged.patient_summary
  ].filter(Boolean).join(" — ").slice(0, 800);

  // ملاحظة السلامة ثابتة
  merged.patient_safety_note = JSON_SCHEMA.patient_safety_note;
  return merged;
}

function dedupeObjects(list){
  const seen = new Set(); const out=[];
  for (const it of list||[]){
    const key = JSON.stringify(it);
    if (!seen.has(key) && Object.values(it||{}).some(Boolean)){ seen.add(key); out.push(it); }
  }
  return out;
}

// ———————— معالِج الطلب —————————
export default async function handler(req, res){
  try{
    if (req.method !== "POST"){ res.status(405).json({error:"Method not allowed"}); return; }
    const { language="ar", model="both", specialty="", context="", images=[], pdfText="" } = await readJSON(req);

    const sys = systemPrompt(language, specialty);
    const usr = userPrompt(language, context);

    // محتوى المستخدم: نص التوجيه + الصور + نص الـPDF
    const gptUserContent = [
      { type: "text", text: usr },
      // تم تمرير الصور كـ Data URL داخل image_url — الشكل الصحيح لدى Chat Completions.  :contentReference[oaicite:10]{index=10}
      ...images.map(u => ({ type:"image_url", image_url: { url: u } })),
      { type: "text", text: `\n[PDF_TEXT]\n${pdfText.slice(0, 90_000)}` }
    ];

    const tasks = [];

    if (model === "gpt" || model === "both"){
      tasks.push(runGPT(sys, gptUserContent));
    } else {
      tasks.push(Promise.resolve({ ok:false }));
    }

    if (model === "gemini" || model === "both"){
      tasks.push(runGemini(sys, usr, images, pdfText));
    } else {
      tasks.push(Promise.resolve({ ok:false }));
    }

    const [gpt, gem] = await Promise.all(tasks);

    const gpt_json = tryParseJSON(gpt?.text);
    const gem_json = tryParseJSON(gem?.text);

    const merged = mergeReports(gpt_json||{}, gem_json||{});

    res.status(200).json({
      ok:true,
      gpt_json, gem_json, merged
    });

  } catch(err){
    console.error(err);
    res.status(200).json({ error: err.message || "Server error" });
  }
}

// ———————— استدعاءات النماذج —————————
async function runGPT(systemText, userContent){
  const completion = await openai.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: "system", content: systemText },
      { role: "user",   content: userContent }
    ],
    temperature: 0.2,
    max_tokens: MAX_OUTPUT
  });
  const text = completion.choices?.[0]?.message?.content || "";
  return { ok:true, text };
}

async function runGemini(systemText, userText, images, pdfText){
  const model = genai.getGenerativeModel({ model: GEM_MODEL });
  // الصور كـ inlineData Base64 — وفق وثائق Gemini.  :contentReference[oaicite:11]{index=11}
  const imageParts = images.map(url => {
    const [m, base64] = url.split(",");
    const mime = (m.match(/data:(.*?);base64/)||[])[1] || "image/jpeg";
    return { inlineData: { data: base64, mimeType: mime } };
  });

  const parts = [{ text: systemText }, { text: userText }, ...imageParts, { text: `\n[PDF_TEXT]\n${pdfText.slice(0, 90_000)}` }];

  const resp = await model.generateContent({
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: MAX_OUTPUT, temperature: 0.2 }
  });

  const text = resp.response?.text?.() || resp.response?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("\n") || "";
  return { ok:true, text };
}

// ———————— أدوات قراءة الطلب —————————
function readJSON(req){
  return new Promise((resolve,reject)=>{
    let b=""; req.on("data",c=>b+=c); req.on("end",()=>{ try{ resolve(JSON.parse(b||"{}")); }catch(e){ reject(e); }});
  });
}
