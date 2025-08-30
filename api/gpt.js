// api/gpt.js
export const config = { runtime: 'edge' };
// ↑ يعمل على Edge Runtime بدون احتياج لـ multer أو حزم تحميل ملفات.

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ==== أدوات صغيرة
const ok = (data) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const bad = (s, body) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body || { error: s }), {
    status: s,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// ==== برومبت سريري قوي ومهيكل
function clinicalPrompt({ language = 'ar', specialty = '', context = '' }) {
  const lang = language === 'en' ? 'English' : 'Arabic';
  const spec = specialty ? `\nالتخصص: ${specialty}\n` : '';
  const ctx = context ? `\nسياق تأميني/وصف مختصر: ${context}\n` : '';
  return `
أنت مساعد سريري/تأميني لتحسين الجودة والدخل. لا تُصدر تشخيصًا نهائيًا ولا خطة علاج دون مراجعة بشرية.
اللغة المطلوبة: ${lang}
${spec}${ctx}

اقرأ صور المطالبة/الاستمارة (قد تكون صور PDF مُحوَّلة) + النص المستخرج، واستخرج عناصر دقيقة ومُنظمة.
أعد النتيجة بصيغة JSON *فقط* بالمفاتيح التالية وبهذا الترتيب:

{
  "executive_summary": "",                        // ملخص تنفيذي عملي من 3-6 أسطر
  "patient_summary": "",                          // موجز موضوعي لما يظهر في الورقة (الشكوى/العلامات الحيوية/العلامات)
  "physician_actions": {                          // ما فعله الطبيب كما هو موثَّق
    "vitals": [], "chief_complaint": "", "significant_signs": [],
    "diagnoses": [], "orders": [], "meds": []
  },
  "key_findings": [],                             // نقاط مفصلية من الوثيقة
  "contradictions": [ { "item":"", "evidence":"", "impact":"" } ],
  "differential_diagnoses": [ { "dx":"", "why":"" } ],
  "missed_opportunities": [ { "what":"", "why_it_matters":"" } ],
  "procedural_issues": [ { "issue":"", "evidence":"", "impact":"" } ],
  "revenue_quality_opportunities": [              // فرص موثّقة لزيادة الدخل وتحسين الجودة
    { "opportunity":"", "category":"documentation|diagnostics|procedure|follow-up|coding",
      "rationale":"", "risk_note":"" }
  ],
  "should_have_been_done":[ { "step":"", "reason":"" } ],   // ما كان يجب عمله وفق الأدلة
  "severity_red_flags": [],                       // رايات حمراء مهمة
  "suggested_next_steps": [ { "action":"", "justification":"" } ],
  "icd_suggestions": [ { "code":"", "label":"", "why":"" } ],
  "cpt_suggestions": [ { "code":"", "label":"", "why":"" } ],
  "references": [                                 // مراجع موثوقة بدلالة الدليل
    { "title":"", "org":"NICE|CDC|WHO|IDSA|NHS|...", "link":"" }
  ],
  "patient_safety_note": "هذا المحتوى تعليمي لتحسين الجودة ويُراجع سريريًا."
}

قواعد:
- اعتمد على ما يظهر فعليًا في الصور/النص المستخرج؛ لا تُخترع بيانات.
- عند وجود تعارض (مثلاً تشخيص "كدمة" مع "لا صدمة"): اذكره تحت contradictions مع الأثر التأميني.
- اجعل الفرص التأمينية واقعية (documentation/diagnostics/procedure/follow-up/coding) مع تبرير واضح.
- استشهد بإرشادات موثوقة (NICE/CDC/WHO/IDSA/NHS...) عبر "references" مع روابط مباشرة.
- اجعل اللغة عربية فصيحة موجزة إن كانت اللغة=ar؛ وإلا بالإنجليزية.
`;
}

// === طلب GPT‑4o عبر Chat Completions (image_url مدعوم، NOT input_image)
async function callOpenAI({ images, text, prompt }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const content = [{ type: 'text', text: prompt }];

  // أضف النص المُستخرج
  if (text && text.trim()) {
    content.push({ type: 'text', text: `\n\n[Extracted PDF Text]\n${text.substring(0, 15000)}` });
  }

  // أضف الصور (data URLs أو روابط)
  for (const url of images.slice(0, 8)) {
    content.push({ type: 'image_url', image_url: { url } });
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-2024-08-06',
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'You are a meticulous clinical quality & revenue integrity assistant.' },
      { role: 'user', content }
    ],
    response_format: { type: "json_object" }
  });

  const txt = completion?.choices?.[0]?.message?.content || '';
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  return { text: txt, json };
}

// === طلب Gemini 1.5 Pro (يدعم صور + نص)
async function callGemini({ images, text, prompt }) {
  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genai.getGenerativeModel({ model: 'gemini-1.5-pro' });

  // مكوّنات الإدخال: نص البرومبت + الصور + نص PDF
  const parts = [prompt];
  if (text && text.trim()) parts.push({ text: `\n\n[Extracted PDF Text]\n${text.substring(0, 15000)}` });

  // الصور (data URL -> inlineData)
  for (const dataUrl of images.slice(0, 8)) {
    const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!m) continue;
    parts.push({
      inlineData: { data: m[2], mimeType: m[1] }
    });
  }

  const resp = await model.generateContent({ contents:[{ role:'user', parts }] });
  const txt = resp.response?.text() || '';
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  return { text: txt, json };
}

// دمج ذكي: يفضّل الحقول الممتلئة ويجمع المراجع والرايات
function mergeReports(a, b) {
  const pick = (k) => a?.[k] ?? b?.[k];
  const arr = (k) => {
    const aa = Array.isArray(a?.[k]) ? a[k] : [];
    const bb = Array.isArray(b?.[k]) ? b[k] : [];
    // دمج مع إزالة التكرار البسيط
    const seen = new Set();
    const out = [];
    for (const item of [...aa, ...bb]) {
      const key = JSON.stringify(item || {});
      if (!seen.has(key) && key !== '{}') { seen.add(key); out.push(item); }
    }
    return out;
  };

  return {
    executive_summary: pick('executive_summary') || '',
    patient_summary: pick('patient_summary') || '',
    physician_actions: {
      vitals: arr('physician_actions?.vitals') // سيبقى فارغ إن لم يوجد
    },
    key_findings: arr('key_findings'),
    contradictions: arr('contradictions'),
    differential_diagnoses: arr('differential_diagnoses'),
    missed_opportunities: arr('missed_opportunities'),
    procedural_issues: arr('procedural_issues'),
    revenue_quality_opportunities: arr('revenue_quality_opportunities'),
    should_have_been_done: arr('should_have_been_done'),
    severity_red_flags: arr('severity_red_flags'),
    suggested_next_steps: arr('suggested_next_steps'),
    icd_suggestions: arr('icd_suggestions'),
    cpt_suggestions: arr('cpt_suggestions'),
    references: arr('references'),
    patient_safety_note: pick('patient_safety_note') || 'هذا المحتوى تعليمي لتحسين الجودة ويُراجع سريريًا.'
  };
}

// ==== المعالج الرئيسي
export default async function handler(req) {
  if (req.method !== 'POST') return bad(405, { error: 'Method not allowed' });

  let body;
  try { body = await req.json(); }
  catch { return bad(400, { error: 'Bad JSON body' }); }

  const {
    language = 'ar',
    modelChoice = 'both',     // both | gpt | gemini
    specialty = '',
    context = '',
    images = [],
    pdf_text = '',
    api_version = 'v6.0'
  } = body || {};

  if ((!images || images.length === 0) && !pdf_text) {
    return bad(400, { error: 'No images or text provided.' });
  }

  // برومبت
  const prompt = clinicalPrompt({ language, specialty, context });

  // استدعاءات النماذج
  const doGPT = modelChoice === 'both' || modelChoice === 'gpt';
  const doGem = modelChoice === 'both' || modelChoice === 'gemini';

  let gpt4o = null, gemini = null, merged = null;

  try {
    if (doGPT) gpt4o = await callOpenAI({ images, text: pdf_text, prompt });
  } catch (e) {
    gpt4o = { error: e?.message || String(e) };
  }
  try {
    if (doGem) gemini = await callGemini({ images, text: pdf_text, prompt });
  } catch (e) {
    gemini = { error: e?.message || String(e) };
  }

  // تكوين تقرير نهائي
  const a = gpt4o?.json || {};
  const b = gemini?.json || {};
  merged = mergeReports(a, b);

  return ok({
    api_version,
    merged,
    gpt4o,
    gemini,
  });
}
