// api/case-analyzer.js
// يُشغَّل على Node.js (وليس Edge)
export const config = { runtime: 'nodejs', maxDuration: 15 }; // يمكن تعديل المدة حسب خطتك على Vercel

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// نماذج افتراضية
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-2024-08-06";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro";

// أداة مساعدة: قراءة JSON من الطلب (لأننا خارج Next API)
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

// تنظيف/التقاط JSON من النص (لو النموذج لفّه بأسلاك ```json)
function extractJSON(text) {
  if (!text) return null;
  const fence = text.match(/```json([\s\S]*?)```/i);
  const raw = fence ? fence[1].trim() : text.trim();
  try { return JSON.parse(raw); } catch { return null; }
}

// دمج تقارير النموذجين (تجميع مفاتيح مع إزالة التكرار)
function mergeReports(a = {}, b = {}) {
  const arrKeys = [
    "key_findings","differential_diagnoses","severity_red_flags",
    "procedural_issues","missed_opportunities","revenue_quality_opportunities",
    "suggested_next_steps","contradictions","references","icd_suggestions","cpt_suggestions",
    "should_have_been_done"
  ];
  const out = {
    patient_summary: a.patient_summary || b.patient_summary || "",
    executive_summary: a.executive_summary || b.executive_summary || "",
    physician_actions: a.physician_actions || b.physician_actions || {},
    patient_safety_note: a.patient_safety_note || b.patient_safety_note || "هذا المحتوى لأغراض تحسين الجودة والتدقيق التأميني ويُراجع من طبيب مرخّص."
  };
  for (const k of arrKeys) {
    const A = Array.isArray(a[k]) ? a[k] : [];
    const B = Array.isArray(b[k]) ? b[k] : [];
    // إزالة تكرارات مبنية على stringify
    const uniq = Array.from(new Map([...A, ...B].map(x => [JSON.stringify(x), x])).values());
    out[k] = uniq;
  }
  return out;
}

// مخطط JSON مُلزِم للناتج
function buildSchema(language = "ar") {
  const safetyNote =
    language === "ar"
      ? "هذا المحتوى لأغراض تحسين الجودة والتدقيق التأميني فقط، ويُراجع من طبيب مرخّص قبل أي قرار سريري."
      : "This content is for quality-improvement and payer audit support; a licensed clinician must review before decisions.";

  return {
    instruction:
`أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة. أزل أي مُعرِّفات شخصية (PHI).
أعد النتيجة بصيغة JSON *فقط* بالمفاتيح التالية حصراً:

{
  "executive_summary": "",
  "patient_summary": "",
  "physician_actions": { "chief_complaint":"", "vitals":[], "significant_signs":[], "diagnoses":[], "orders":[], "meds":[], "icd10_codes":[] },
  "key_findings": [],
  "contradictions": [ { "item":"", "evidence":"", "impact":"" } ],
  "differential_diagnoses": [ { "dx":"", "why":"" } ],
  "severity_red_flags": [],
  "procedural_issues": [ { "issue":"", "impact":"", "evidence":"" } ],
  "missed_opportunities": [ { "what":"", "why_it_matters":"" } ],
  "revenue_quality_opportunities": [ { "opportunity":"", "category":"documentation|diagnostics|procedure|follow-up|coding", "rationale":"", "risk_note":"" } ],
  "should_have_been_done": [ { "step":"", "reason":"" } ],
  "suggested_next_steps": [ { "action":"", "justification":"" } ],
  "icd_suggestions": [ { "code":"", "label":"", "why":"" } ],
  "cpt_suggestions": [ { "code":"", "label":"", "why":"" } ],
  "references": [ { "title":"", "org":"WHO|NICE|CDC|NHS|IDSA|AAOS|...","link":"" } ],
  "patient_safety_note": "${safetyNote}"
}

قواعد الجودة:
- استشهد فقط بمراجع إكلينيكية موثوقة (NICE/WHO/CDC/NHS/IDSA) وارفق الروابط.
- إن وُجِد تعارض بين الشكوى والتشخيص أو بين التشخيص والأدوية/الأوامر فاذكره ضمن "contradictions".
- قدّم فرص توثيق/فحوص/إجراءات ترفع القبول التأميني والإيراد المبرر.
- أعد JSON صارم بدون أي شرح خارج القوسين.
`,
    langTag: language === "en" ? "English" : "العربية",
  };
}

// استدعاء GPT‑4o عبر Chat Completions (يدعم image_url + نص)
async function callOpenAI(apiKey, language, specialty, insuranceContext, images, texts) {
  const client = new OpenAI({ apiKey });
  const { instruction, langTag } = buildSchema(language);

  const parts = [];
  parts.push({ type: "text", text: `${instruction}\nاللغة المطلوبة: ${langTag}\nالتخصص: ${specialty || "عام"}\nسياق التأمين: ${insuranceContext || "—"}` });
  (images || []).forEach(img => {
    parts.push({ type: "image_url", image_url: { url: img.dataUrl } }); // يدعم data URL
  });
  if (texts && texts.trim()) {
    parts.push({ type: "text", text: `نص PDF (مستخرج محليًا):\n${texts.slice(0, 12000)}` }); // حدود الأمان
  }

  const resp = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: "You are a meticulous clinical quality & revenue-improvement assistant. Return STRICT JSON only." },
      { role: "user", content: parts }
    ]
  });

  const text = resp.choices?.[0]?.message?.content || "";
  const parsed = extractJSON(text);
  return { raw: text, parsed };
}

// استدعاء Gemini 1.5 Pro (inline base64 images)
async function callGemini(apiKey, language, specialty, insuranceContext, images, texts) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { temperature: 0.2 } });
  const { instruction, langTag } = buildSchema(language);

  const parts = [
    { text: `${instruction}\nLanguage: ${langTag}\nSpecialty: ${specialty || "General"}\nInsurance context: ${insuranceContext || "—"}` }
  ];
  for (const img of (images || [])) {
    const b64 = img.dataUrl.split(",")[1];
    parts.push({ inlineData: { data: b64, mimeType: img.contentType || "image/jpeg" } });
  }
  if (texts && texts.trim()) parts.push({ text: `PDF text (locally extracted):\n${texts.slice(0, 12000)}` });

  const resp = await model.generateContent({ contents: [{ role: "user", parts }] });
  const text = resp.response?.text?.() || "";
  const parsed = extractJSON(text);
  return { raw: text, parsed };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" }); return;
  }

  try {
    const body = await readJson(req);
    const {
      language = "ar",
      modelChoice = "both",
      specialty = "عام",
      insuranceContext = "",
      images = [],
      texts = ""
    } = body || {};

    if ((!images || images.length === 0) && !texts) {
      return res.status(400).json({ error: "لا توجد صور أو نص للتحليل" });
    }

    const doGPT = modelChoice === "both" || modelChoice === "gpt";
    const doGem = modelChoice === "both" || modelChoice === "gemini";

    const results = {};
    if (doGPT) {
      try {
        results.gpt = await callOpenAI(process.env.OPENAI_API_KEY, language, specialty, insuranceContext, images, texts);
        if (!results.gpt.parsed) results.gpt.error = "Failed to parse GPT JSON";
      } catch (e) {
        results.gpt = { error: e?.message || String(e) };
      }
    }
    if (doGem) {
      try {
        results.gemini = await callGemini(process.env.GEMINI_API_KEY, language, specialty, insuranceContext, images, texts);
        if (!results.gemini.parsed) results.gemini.error = "Failed to parse Gemini JSON";
      } catch (e) {
        results.gemini = { error: e?.message || String(e) };
      }
    }

    // دمج
    const merged = mergeReports(results.gpt?.parsed, results.gemini?.parsed);
    // ملخص تنفيذي بسيط من العناصر المتاحة
    if (!merged.executive_summary) {
      merged.executive_summary =
        (merged.patient_summary ? (merged.patient_summary + " — ") : "") +
        "أهم النتائج: " + (merged.key_findings?.slice(0,4).join("، ") || "—") +
        " | أخطاء/تعارضات: " + (merged.contradictions?.length || 0) +
        " | فرص جودة/دخل: " + (merged.revenue_quality_opportunities?.length || 0);
    }

    res.status(200).json({
      combined: merged,
      gpt: results.gpt || null,
      gemini: results.gemini || null
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
}
