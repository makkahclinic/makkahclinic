// /api/gpt.js — Ensemble Doctor Analyzer (Gemini + optional OpenAI OCR/Analysis)
// Runtime: Vercel / Next.js API Route (Node 18+)

// ENV (Vercel → Settings → Environment Variables):
// GEMINI_API_KEY = sk-...   (required)
// OPENAI_API_KEY = sk-...   (optional → enables OCR & ensemble)

// =============== ULTIMATE ENHANCEMENTS v19 (OPERATIONAL EXCELLENCE) ===============
// 1. Integrated user's expert-level operational and revenue cycle management feedback.
// 2. Re-engineered the recommendations section to focus on three core business axes:
//    - Reducing Waste (e.g., Claim Denials)
//    - Improving Productivity (e.g., No-show Reduction)
//    - Adding Reimbursable Services (e.g., Chronic Care Programs)
// 3. The model is now a true clinical AND operational consultant.
// ====================================================================================

import { createHash } from 'crypto';

// =============== CONFIG ===============
const GEMINI_MODEL = "gemini-1.5-pro-latest";
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_FILES_PER_REQUEST = 30;
const MAX_INLINE_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

// =============== CACHE ===============
const fileCache = new Map();

// =============== UTILS ===============
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function fetchWithRetry(url, options, {retries=3, timeoutMs=DEFAULT_TIMEOUT_MS}={}){
  const c = new AbortController(); const t = setTimeout(()=>c.abort(), timeoutMs);
  try{
    const r = await fetch(url, { ...options, signal: c.signal });
    if(!r.ok && retries>0 && RETRY_STATUS.has(r.status)){
      await sleep((4 - retries) * 1000);
      return fetchWithRetry(url, options, {retries:retries-1, timeoutMs});
    }
    return r;
  } finally { clearTimeout(t); }
}
function detectMimeFromB64(b64=""){ const h=(b64||"").slice(0,16);
  if(h.includes("JVBERi0")) return "application/pdf";
  if(h.includes("iVBORw0")) return "image/png";
  if(h.includes("/9j/")) return "image/jpeg";
  if(h.includes("UklGR")) return "image/webp";
  return "image/jpeg";
}
// FIX: Corrected typo from sha266 to sha256
function getFileHash(base64Data) {
    return createHash('sha256').update(base64Data).digest('hex');
}


// =============== SYSTEM PROMPTS (OPERATIONAL EXCELLENCE FINAL) ===============
const systemInstruction = `
أنت استشاري "تدقيق طبي وتشغيلي" خبير عالمي. هدفك هو الوصول لدقة 10/10. أخرج كتلة HTML واحدة فقط.

[منهجية التحليل الإلزامية]
- **قاعدة التوافق الديموغرافي المطلق:** تحقق من تطابق جنس المريض مع التشخيصات والأدوية. إذا كانت المريضة **أنثى**، فمن المستحيل أن يكون لديها تضخم البروستاتا (BPH) أو أن توصف لها أدوية مثل **Duodart**. يجب أن يكون القرار **"❌ مرفوض ديموغرافيًا (دواء للرجال فقط)"**.
- **قاعدة الاستنتاج الصيدلاني:**
  - **Triplex:** إذا تم تحديده كدواء (بسبب od x90)، افترضه **Triplixam**.
  - **Form XR:** استنتج أنه **Metformin XR**.
- **قاعدة كبار السن (Geriatrics):** لأي مريض عمره > 65 عامًا، قم بالتحقق الإجباري من:
  1.  **خطر نقص السكر:** عند وجود أدوية Sulfonylurea (مثل Diamicron)، يجب إصدار تحذير قوي.
  2.  **خطر السقوط:** عند وجود دوائين أو أكثر يخفضان الضغط، يجب إصدار تحذير قوي من خطر **هبوط الضغط الانتصابي**.
- **قاعدة أمان الأدوية المحددة:**
  - **Metformin XR:** اذكر بوضوح: "**مضاد استطباب عند eGFR < 30**، وعدم البدء به إذا كان eGFR 30–45 إلا بحذر شديد".
  - **التحالف المحظور (ACEI + ARB):** الجمع بين ACEI (مثل Perindopril في Triplixam) و ARB (مثل Valsartan في Co-Taburan) هو **تعارض خطير وممنوع**.
  - **الازدواجية العلاجية الخفية:** تحقق مما إذا كانت المادة الفعالة في دواء مفرد (مثل Amlodipine) موجودة أيضًا كجزء من دواء مركب في نفس الوصفة (مثل Triplixam).
- **قاعدة منطق الكمية والتأمين (إلزامية):**
  - **للمستلزمات (Strips/Lancets):** صنفها كـ **"مستلزمات قياس سكر الدم"**. إذا كانت الكمية كبيرة (مثال: TID x90)، أشر إلى أن "هذه الكمية قد تتجاوز حدود التغطية وتتطلب تبريرًا طبيًا".

[توصيات سريرية وتشغيلية لرفع الكفاءة (مدعومة بالأدلة) - قسم إلزامي]
- بناءً على تحليل الحالة، قدم توصيات قابلة للقياس ضمن المحاور الثلاثة التالية لرفع دخل العيادة بشكل أخلاقي:
  1.  **تقليل الهدر:**
      - **خفض الرفضات التأمينية (Denials):** شدّد على أهمية التوثيق الطبي المتكامل والمتوافق مع ICD-10/E/M، وإجراء "claim scrubbing" قبل الإرسال. (المصدر: MGMA, CMS).
      - **تقليل غياب المرضى (No-shows):** أوصِ بتفعيل رسائل تذكير نصية تلقائية لتحسين الحضور. (المصدر: PubMed).
  2.  **رفع الإنتاجية:**
      - **تحسين الوصول والجدولة:** اقترح اعتماد نظام "Advanced/Open Access" لتقديم مواعيد في نفس اليوم أو اليوم التالي لتقليل قوائم الانتظار ونسب الغياب. (المصدر: AHRQ).
      - **مصالحة الأدوية (Medication Reconciliation):** أكد على أن هذه العملية تقلل الأخطاء الدوائية، مما يوفر التكاليف ويتجنب الزيارات غير الضرورية. (المصدر: AHRQ, PMC).
  3.  **إضافة خدمات مغطاة:**
      - **برامج الأمراض المزمنة:** إذا كان المريض يعاني من مرض مزمن (مثل السكري)، اقترح تفعيل برامج ممولة مثل DSMES (Diabetes Self-Management Education and Support)، والتي تحسن نتائج المرضى وغالبًا ما تكون مغطاة تأمينيًا. (المصدر: CDC).
      - **استخدام الدعم الإكلينيكي داخل النظام (CDS):** أوصِ باستخدام مجموعات الأوامر (Order sets) لرفع التزام الأطباء بالإرشادات وتقليل الطلبات غير الضرورية التي قد تُرفض لـ "عدم الضرورة الطبية". (المصدر: American College of Physicians).

[التنسيق البصري (Visual Formatting) - إلزامي]
- قم بتضمين كتلة <style> التالية في بداية تقرير الـ HTML.
- لكل قرار تأمين، قم بتغليف النص والرمز داخل <span> مع الكلاس المناسب.

[البنية]
<style>
  .status-green { display: inline-block; background-color: #d4edda; color: #155724; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #c3e6cb; }
  .status-yellow { display: inline-block; background-color: #fff3cd; color: #856404; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #ffeeba; }
  .status-red { display: inline-block; background-color: #f8d7da; color: #721c24; padding: 4px 10px; border-radius: 15px; font-weight: bold; border: 1px solid #f5c6cb; }
</style>
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><h4>تحليل الملفات المرفوعة</h4><h4>التحليل السريري العميق</h4>
<h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr>
<th>الدواء/الإجراء (مع درجة الثقة)</th><th>الجرعة الموصوفة</th><th>الجرعة الصحيحة المقترحة</th><th>التصنيف</th><th>الغرض الطبي</th><th>التداخلات</th><th>درجة الخطورة (%)</th><th>قرار التأمين</th>
</tr></thead><tbody></tbody></table>
<h4>توصيات سريرية وتشغيلية لرفع الكفاءة (مدعومة بالأدلة)</h4><ul></ul>
<h4>خطة العمل</h4><ol></ol>
<p><strong>الخاتمة:</strong> هذا التقرير لا يغني عن المراجعة السريرية.</p>
`;

function buildUserPrompt(d={}){return `
**بيانات المريض:**
العمر: ${d.age ?? "غير محدد"} | الجنس: ${d.gender ?? "غير محدد"} | حمل: ${
  d.isPregnant===true?"نعم":(d.isPregnant===false?"لا":"غير محدد")
} | شهر الحمل: ${d.pregnancyMonth ?? "غير محدد"}
تدخين: ${d.isSmoker?"مدخّن":"غير مدخّن"} | باك-سنة: ${d.packYears ?? "غير محدد"}
سعال(أسابيع): ${d.coughDurationWeeks ?? "غير محدد"} | أعراض بصرية: ${d.visualSymptoms ?? "غير محدد"}
آخر فحص عين: ${d.lastEyeExamDate ?? "غير محدد"} | حدة الإبصار: ${d.visualAcuity ?? "غير محدد"}

**وصف الحالة/ملاحظات:** ${d.notes || "—"}
**تشخيصات مبدئية:** ${d.diagnosis || "—"}
**تحاليل/أشعة (نصي):** ${d.labResults || "—"}
**أدوية/إجراءات مكتوبة:** ${d.medications || "—"}

**عدد الملفات المرفوعة:** ${Array.isArray(d.files)? d.files.length : 0}
`}

// =============== OpenAI OCR + Analysis (optional) ===============
async function ocrWithOpenAI(apiKey, files){
    const IMG = new Set(["image/jpeg","image/png","image/webp"]);
    const eligibleFiles = files.filter(f => IMG.has(f.type || detectMimeFromB64(f.data)));

    const ocrPromises = eligibleFiles.map(async (f) => {
        try {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: "استخرج نصاً منظماً من هذه الصورة (عربي/إنجليزي). إن كان تقرير مختبر/وصفة فحوّل الجداول إلى عناصر {test,value,unit,ref_low,ref_high} حيثما أمكن، بدون تفسير." },
                            { type: "image_url", image_url: { url: `data:${f.type || detectMimeFromB64(f.data)};base64,${f.data}` } }
                        ]
                    }],
                    temperature: 0.1, max_tokens: 2000
                })
            });
            if (!res.ok) {
                console.warn(`OpenAI OCR fail for ${f.name}:`, await res.text().catch(() => ''));
                return null;
            }
            const j = await res.json();
            const text = j?.choices?.[0]?.message?.content || "";
            return text ? { filename: f.name, mime: f.type, text } : null;
        } catch (e) {
            console.error(`OCR promise failed for ${f.name}:`, e);
            return null;
        }
    });

    const results = await Promise.all(ocrPromises);
    return results.filter(Boolean);
}

async function analyzeWithOpenAI(apiKey, caseData, ocrTextJoined){
  const res = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{ "Authorization":`Bearer ${apiKey}`, "Content-Type":"application/json" },
    body: JSON.stringify({
      model:"gpt-4o-mini",
      temperature:0.2,
      max_tokens:3000,
      messages:[
        { role:"system", content:
          "أنت استشاري باطني. أخرج JSON فقط بالمفاتيح: {summary, finds, meds, risks, plan}. لا HTML." },
        { role:"user", content:
          `حلّل الحالة التالية بعمق (differential/سلامة أدوية/فجوات بيانات).
           بيانات الحالة:\n${buildUserPrompt(caseData)}
           نصوص OCR:\n${ocrTextJoined || "—"}
           أعد JSON فقط.`}
      ]
    })
  });
  if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error(`OpenAI analysis failed: ${t.slice(0,200)}`); }
  const j = await res.json();
  const txt = j?.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(txt); } catch { return { summary: txt }; }
}

// =============== Gemini Files ===============
async function geminiUpload(apiKey, base64Data, mime){
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64Data, "base64");
  const r = await fetchWithRetry(url, { method:"POST", headers:{ "Content-Type": mime }, body: buf });
  if(!r.ok){ const t = await r.text().catch(()=> ""); throw new Error(`Gemini file upload failed (${r.status}): ${t.slice(0,200)}`); }
  const j = await r.json();
  return j?.file?.uri;
}

async function geminiAnalyze(apiKey, allParts){
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ role:"user", parts: allParts }],
        generationConfig: { temperature:0.2, topP:0.9, topK:40, maxOutputTokens:8192 }
    };
    const r = await fetchWithRetry(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
    const raw = await r.text();
    if(!r.ok) throw new Error(`Gemini error ${r.status}: ${raw.slice(0,500)}`);
    try {
        const j = JSON.parse(raw);
        return (j?.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/```html|```/g,"").trim();
    } catch { return raw; }
}

// =============== API Handler ===============
export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"Method Not Allowed"});

  try{
    const geminiKey = process.env.GEMINI_API_KEY;
    if(!geminiKey) throw new Error("GEMINI_API_KEY missing.");
    const openaiKey = process.env.OPENAI_API_KEY || null;

    const body = req.body || {};
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES_PER_REQUEST) : [];
    
    const defaultMode = openaiKey ? "ensemble" : "gemini-only";
    const analysisMode = (body.analysisMode || defaultMode).toLowerCase();

    // 1) Optional OCR (Parallel)
    let ocrBlocks = [];
    if (openaiKey && (analysisMode === "ocr+gemini" || analysisMode === "ensemble") && files.length){
      try { ocrBlocks = await ocrWithOpenAI(openaiKey, files); }
      catch(e){ console.warn("OCR skipped:", e.message); }
    }
    const ocrJoined = ocrBlocks.length ? ocrBlocks.map(b=>`### ${b.filename}\n${b.text}`).join("\n\n") : "";

    // 2) Process ALL files for Gemini (Parallel, with size check and Caching)
    const fileProcessingPromises = files.map(f => {
        return new Promise(async (resolve) => {
            try {
                const mimeType = f.type || detectMimeFromB64(f.data || "");
                const fileBuffer = Buffer.from(f.data, 'base64');
                const hash = getFileHash(f.data);

                if (fileCache.has(hash)) {
                    console.log(`Cache HIT for file ${f.name}`);
                    resolve(fileCache.get(hash));
                    return;
                }
                console.log(`Cache MISS for file ${f.name}`);

                let part;
                if (fileBuffer.byteLength > MAX_INLINE_FILE_BYTES) {
                    const uri = await geminiUpload(geminiKey, f.data, mimeType);
                    part = { file_data: { mime_type: mimeType, file_uri: uri } };
                } else {
                    part = { inline_data: { mime_type: mimeType, data: f.data } };
                }
                
                fileCache.set(hash, part);
                resolve(part);

            } catch (e) {
                console.warn(`File processing failed for ${f.name}:`, e.message);
                resolve(null);
            }
        });
    });

    const processedFileParts = (await Promise.all(fileProcessingPromises)).filter(p => p);

    // 3) Build all parts together for Gemini
    const allParts = [
        { text: systemInstruction },
        { text: buildUserPrompt(body) }
    ];
    allParts.push(...processedFileParts);

    // 4) If ensemble → get OpenAI analysis JSON and add it to allParts
    let ensembleJson = null;
    if (openaiKey && analysisMode === "ensemble"){
        try { ensembleJson = await analyzeWithOpenAI(openaiKey, body, ocrJoined); }
        catch(e){ console.warn("Ensemble OpenAI analysis failed:", e.message); }
        if (ensembleJson){
            allParts.push({ text: `[تحليل أولي من نموذج مساعد]\n${JSON.stringify(ensembleJson)}` });
        }
    }

    // 5) Final Gemini analysis → HTML
    const html = await geminiAnalyze(geminiKey, allParts);
    
    // 6) Final JSON Response
    const responsePayload = {
        htmlReport: html,
        ocrUsed: !!ocrBlocks.length,
        ensembleUsed: !!ensembleJson,
    };

    return res.status(200).json(responsePayload);

  } catch(err){
    console.error("Server error:", err);
    return res.status(500).json({ error:"Internal server error", detail: err.message });
  }
}
