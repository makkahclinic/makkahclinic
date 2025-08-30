// api/gpt.js  — Node.js Serverless Function على Vercel
// ملاحظة: تأكد أن بيئة Vercel تحتوي OPENAI_API_KEY و GEMINI_API_KEY
// Package dependencies (في package.json):  "openai": "^4", "@google/generative-ai": "^0.24"

export default async function handler(req, res) {
  // السماح بالـ CORS (عند فتح الصفحة من دومين نفس المشروع لا حاجة، لكنه آمن)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { language = 'ar', modelChoice = 'both', specialty = '', insuranceContext = '', images = [], texts = [] } = req.body || {};
    if ((!images || !images.length) && (!texts || !texts.length)) {
      return res.status(400).json({ error: 'No input (images or texts).' });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!openaiKey && (modelChoice === 'both' || modelChoice === 'gpt')) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is missing on server' });
    }
    if (!geminiKey && (modelChoice === 'both' || modelChoice === 'gemini')) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is missing on server' });
    }

    // بناء تعليمات سريرية دقيقة مع مخطط JSON صارم
    const schemaKeys = [
      'executive_summary','patient_summary','key_findings','physician_actions','contradictions',
      'differential_diagnoses','severity_red_flags','procedural_issues','missed_opportunities',
      'revenue_quality_opportunities','should_have_been_done','suggested_next_steps',
      'icd_suggestions','cpt_suggestions','references','patient_safety_note'
    ];
    const systemInstruction = `
أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة. لا تُقدّم تشخيصًا نهائيًا
ولا توصيات علاجية دون مراجعة بشرية. أزل أي معرّفات شخصية (نهج Safe Harbor).
اللغة: ${language === 'en' ? 'English' : 'العربية'}
التخصص: ${specialty || 'عام'}
السياق التأميني/الإداري (إن وُجد): ${insuranceContext || '—'}

أعد استجابة JSON فقط بالحقول التالية (لا تزيد ولا تُنقص)، كلها إن أمكن:
{
  "executive_summary": "",
  "patient_summary": "",
  "key_findings": [],
  "physician_actions": { "chief_complaint":"", "vitals":[], "significant_signs":[], "diagnoses":[], "orders":[], "meds":[], "icd10_codes":[] },
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
  "references": [ { "title":"", "org":"WHO|NICE|CDC|AAO|IDSA|...", "link":"" } ],
  "patient_safety_note": "هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويُراجع من طبيب مرخّص."
}
استخدم الأدلة والإرشادات (NICE/WHO/CDC..) عند الاقتضاء، وأدرج مرجعًا مختصرًا مع رابط.
رجاءً أعِد JSON صالحًا فقط.`;

    // نجهّز نصًا مجمعًا (إن كان هناك استخراج نص من PDF)
    const joinedText = texts && texts.length ? `\n\n[Extracted PDF text]\n${texts.join('\n\n').slice(0, 18000)}` : '';

    // نحول الصور إلى "image_url" (data URL) لتوافق Chat Completions (مدعوم للـ GPT‑4o) 
    // راجع التوثيق: يمكن إرسال مصفوفة Content تحتوي نصًا وصورًا. 

---

## ما الذي أصلحناه بالتحديد؟

- **خطأ PDF.js (pdfjsLib)**: حمّلنا مكتبة PDF.js من CDN وضبطنا `GlobalWorkerOptions.workerSrc` بوضوح — هذا الشرط مذكور في أمثلة PDF.js الرسمية ونقاشاتهم (بدونه تظهر رسالة “is not defined / fake worker”). :contentReference[oaicite:4]{index=4}
- **عرض كود الخادم كنص في الصفحة**: أزلنا أي `<script src="/api/gpt.js">`. الاستدعاء الآن عبر `fetch('/api/gpt')` فقط.
- **فشل نشر Vercel “Edge Function is referencing unsupported modules”**: تجنّبنا Edge runtime. Node.js runtime هو الأنسب لهذه المكتبات. :contentReference[oaicite:5]{index=5}
- **دعم الصور + النص مع GPT‑4o**: استخدمنا **Chat Completions** بمحتوى يحتوي عناصر `{type:"text"}` و`{type:"image_url"}` (مسموح للـ GPT‑4o) بدل صيغة `input_image` التي تعود إلى شكل Responses المختلف — إرشادات رسمية لـ"رسائل متعددة الوسائط" موجودة ضمن أدلة المحادثات للرؤية (أزور توثق ذلك بوضوح). :contentReference[oaicite:6]{index=6}
- **Gemini SDK الرسمي**: استخدمنا Google GenAI SDK الأحدث كما توصي جوجل، مع `inlineData` للصور. :contentReference[oaicite:7]{index=7}

---

## تذكير سريع (قد يلزم تعديل بسيط في مشروعك)

- في **Vercel → Settings → Environment Variables**:  
  `OPENAI_API_KEY` و `GEMINI_API_KEY` (موجودتان بالفعل حسب صورك).  
- في `package.json` تأكد من وجود الاعتمادات:
  ```json
  {
    "dependencies": {
      "openai": "^4.57.0",
      "@google/generative-ai": "^0.24.1"
    }
  }
