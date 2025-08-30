// api/gpt.js
// Edge Function بدون مكتبات Node. تأكد من ضبط مفاتيح البيئة في Vercel:
// OPENAI_API_KEY, GEMINI_API_KEY

export const runtime = 'edge'; // نتجنب Node imports غير المدعومة على Edge

/** helper: قراءة JSON آمن */
async function readJSON(req) {
  try { return await req.json(); }
  catch { return {}; }
}

/** helper: استخراج JSON من نص قد يحتوي على ```json ... ``` */
function extractJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = String(text).match(/```json([\s\S]*?)```/i) || String(text).match(/```([\s\S]*?)```/i);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  return null;
}

/** دمج بسيط لحقلين JSON */
function smartMerge(a, b) {
  const out = { ...(a||{}) };
  for (const [k,v] of Object.entries(b || {})) {
    if (Array.isArray(v)) {
      out[k] = Array.from(new Set([...(out[k]||[]), ...v]));
    } else if (v && typeof v === 'object') {
      out[k] = smartMerge(out[k], v);
    } else if (v != null) {
      out[k] = v;
    }
  }
  return out;
}

/** Prompt نظام موحّد لإخراج JSON قوي مؤسّس على أدلة */
function buildSystemPrompt(lang='ar', specialty='عام') {
  const L = lang === 'en' ? 'English' : 'العربية';
  return `
أنت مساعد سريري لتحسين الجودة والإيرادات مبني على الأدلة. اللغة: ${L}. التخصص: ${specialty}.
القواعد:
- أزل/أخفِ أي معلومات تعريف شخصية (PHI) (نهج Safe Harbor).
- لا تشخيص نهائي؛ تقرير تعليمي يُراجع من طبيب.
- اعتمد على الإرشادات العالمية (NICE/WHO/CDC/IDSA) حيث يلزم، واذكر المراجع بعناوين وروابط مختصرة.
- أعد **JSON فقط** بالمفاتيح التالية:
{
 "executive_summary":"",
 "patient_summary":"",
 "physician_actions":{"chief_complaint":"","vitals":[],"significant_signs":[],"diagnoses":[],"icd10_codes":[],"orders":[],"meds":[]},
 "key_findings":[],
 "contradictions":[{"item":"","evidence":"","impact":""}],
 "differential_diagnoses":[{"dx":"","why":""}],
 "severity_red_flags":[],
 "procedural_issues":[{"issue":"","impact":"","evidence":""}],
 "missed_opportunities":[{"what":"","why_it_matters":""}],
 "revenue_quality_opportunities":[{"opportunity":"","category":"documentation|diagnostics|procedure|follow-up|coding","rationale":"","risk_note":""}],
 "should_have_been_done":[{"step":"","reason":""}],
 "suggested_next_steps":[{"action":"","justification":""}],
 "references":[{"title":"","org":"","link":""}],
 "patient_safety_note":"هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويُراجع من طبيب مرخّص."
}
مهم: إن لم تكن المعلومات كافية، اذكر ذلك صراحةً ضمن key_findings وmissed_opportunities.
`;
}

/** بنية رسالة المستخدم */
function buildUserContent(language, insuranceContext, pdfText) {
  const intro = language === 'en'
    ? `Analyze the following clinical documents (images + extracted PDF text).`
    : `حلّل المستندات السريرية التالية (صور + نص PDF مُستخرج).`;
  const ctx = insuranceContext ? `\n\nسياق/تأمين: ${insuranceContext}` : '';
  const textBlock = pdfText ? `\n\nنص من المستند (قد يحتوي تشخيص/علامات/أدوية/رموز):\n${pdfText.slice(0, 40000)}` : '';
  return `${intro}${ctx}${textBlock}\n\nأعد الناتج بصيغة JSON فقط حسب القالب المطلوب.`;
}

/** استدعاء OpenAI Chat Completions (GPT‑4o) برؤية */
async function callOpenAI({ apiKey, systemPrompt, userText, imagesDataURLs, language }) {
  const content = [{ type: "text", text: userText }];
  // نضيف حتى 8 صور كحد معقول
  (imagesDataURLs || []).slice(0, 8).forEach(url => {
    content.push({ type: "image_url", image_url: { url } });
  });

  const body = {
    model: "gpt-4o-mini", // يدعم رؤية عبر chat.completions
    temperature: 0.2,
    max_tokens: 1400,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content }
    ]
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${t}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const json = extractJSON(text);
  return { text, json, model: "gpt-4o-mini" };
}

/** استدعاء Gemini REST بـ inlineData (Base64) */
function dataUrlToBase64(dataUrl) {
  return dataUrl.split(",")[1] || "";
}

async function callGemini({ apiKey, systemPrompt, userText, imagesDataURLs }) {
  const parts = [{ text: systemPrompt + "\n\n" + userText }];
  (imagesDataURLs || []).slice(0, 8).forEach(url => {
    const b64 = dataUrlToBase64(url);
    parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } });
  });

  const body = { contents: [{ role: "user", parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 1400 } };
  const endpoint = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=" + encodeURIComponent(apiKey);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini error ${res.status}: ${t}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  const json = extractJSON(text);
  return { text, json, model: "gemini-1.5-pro" };
}

/** دمج النتيجتين */
function mergeOutputs(g, m) {
  const gJson = g?.json || extractJSON(g?.text);
  const mJson = m?.json || extractJSON(m?.text);
  const merged = smartMerge(gJson || {}, mJson || {});
  // نضيف ملخصًا سريعًا إذا مفقود
  if (!merged.executive_summary) {
    const es = (gJson?.executive_summary || mJson?.executive_summary || "").trim();
    if (es) merged.executive_summary = es;
  }
  return merged;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const body = await readJSON(req);
  const {
    language = "ar",
    modelChoice = "both",
    specialty = "",
    insuranceContext = "",
    images = [],
    pdfText = ""
  } = body || {};

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!OPENAI_API_KEY && (modelChoice === "both" || modelChoice === "gpt")) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY مفقود" }), { status: 500, headers: {"Content-Type":"application/json"}});
  }
  if (!GEMINI_API_KEY && (modelChoice === "both" || modelChoice === "gemini")) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY مفقود" }), { status: 500, headers: {"Content-Type":"application/json"}});
  }
  if (!images.length && !pdfText.trim()) {
    return new Response(JSON.stringify({ error: "لا صور ولا نص PDF مُقدَّم للتحليل" }), { status: 400, headers: {"Content-Type":"application/json"}});
  }

  const systemPrompt = buildSystemPrompt(language, specialty);
  const userText    = buildUserContent(language, insuranceContext, pdfText);

  const results = { debug: { images: images.length, pdfChars: (pdfText||"").length } };
  try {
    if (modelChoice === "both" || modelChoice === "gpt") {
      results.gpt = await callOpenAI({
        apiKey: OPENAI_API_KEY, systemPrompt, userText, imagesDataURLs: images, language
      });
    }
  } catch (e) { results.gpt = { error: e.message }; }

  try {
    if (modelChoice === "both" || modelChoice === "gemini") {
      results.gemini = await callGemini({
        apiKey: GEMINI_API_KEY, systemPrompt, userText, imagesDataURLs: images
      });
    }
  } catch (e) { results.gemini = { error: e.message }; }

  // دمج (إن وُجد ناتج)
  try {
    if (results.gpt || results.gemini) {
      results.merged = mergeOutputs(results.gpt, results.gemini);
    }
  } catch (e) {
    results.merged = { note: "تعذر دمج JSON؛ أعرض النصوص الخام.", error: e.message };
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
