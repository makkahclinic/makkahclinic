// /api/gpt.js — Ensemble Doctor Analyzer (Gemini + optional OpenAI OCR/Analysis)
// Runtime: Vercel / Next.js API Route (Node 18+)

// ENV (Vercel → Settings → Environment Variables):
// GEMINI_API_KEY = sk-...   (required)
// OPENAI_API_KEY = sk-...   (optional → enables OCR & ensemble)

// =============== CONFIG ===============
const GEMINI_MODEL = "gemini-1.5-pro-latest"; // غيّر لاحقاً لـ gemini-2.5-pro إذا رغبت
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_FILES_PER_REQUEST = 30;

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

// =============== SYSTEM PROMPTS ===============
const systemInstruction = `
أنت استشاري "تدقيق طبي ومطالبات تأمينية". أخرج كتلة HTML واحدة فقط (بدون CSS).

[منهجية]
- اربط الأعراض بالأسباب (Differential) مع تبرير سريري.
- راقب أمان الأدوية (eGFR/K/Cr/INR/UA…), ازدواجية, XR/MR, كبار السن.
- طبّق الإرشادات (اذكر المرجع والرابط في قسم الأدلة).
- بيّن فجوات البيانات وما يلزم لسدها.
[الجدول]
- صف لكل بند دون حذف. درجة الخطورة (%) مع كلاس: risk-low / risk-medium / risk-high.
- قرار التأمين: ✅ مقبول | ⚠️ قابل للمراجعة | ❌ قابل للرفض (+سبب وما يلزم + تخصص).
[البنية]
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><p>…</p>
<h4>تحليل الملفات المرفوعة</h4>
<h4>التحليل السريري العميق</h4><p>…</p>
<h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr>
<th>الدواء/الإجراء</th><th>الجرعة الموصوفة</th><th>الجرعة الصحيحة المقترحة</th><th>التصنيف</th><th>الغرض الطبي</th><th>التداخلات</th><th>درجة الخطورة (%)</th><th>قرار التأمين</th>
</tr></thead><tbody></tbody></table>
<h4>فرص تحسين الخدمة (مدعومة بالأدلة)</h4><ul></ul>
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
    return results.filter(Boolean); // لإزالة أي نتائج فاشلة (null)
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
async function geminiUpload(apiKey, base64, mime){
  const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`;
  const buf = Buffer.from(base64, "base64");
  const r = await fetchWithRetry(url, { method:"POST", headers:{ "Content-Type": mime }, body: buf });
  if(!r.ok){ const t = await r.text().catch(()=> ""); throw new Error(`Gemini file upload failed (${r.status}): ${t.slice(0,200)}`); }
  const j = await r.json();
  return j?.file?.uri;
}

async function geminiAnalyze(apiKey, userParts, systemInstructionText){
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ role:"user", parts: userParts }],
        system_instruction: {
            parts: [{ text: systemInstructionText }]
        },
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
  res.setHeader("Access-Control-Allow-Origin","*"); // For development. Change to your domain in production.
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
    
    // ================== التعديل هنا ==================
    // تم تغيير الوضع الافتراضي ليستخدم قراءة النصوص (OCR) دائماً
    const analysisMode = (body.analysisMode || "ocr+gemini").toLowerCase();
    // ===============================================

    // 1) Optional OCR (Parallel)
    let ocrBlocks = [];
    if (openaiKey && (analysisMode === "ocr+gemini" || analysisMode === "ensemble") && files.length){
      try { ocrBlocks = await ocrWithOpenAI(openaiKey, files); }
      catch(e){ console.warn("OCR skipped:", e.message); }
    }
    const ocrJoined = ocrBlocks.length ? ocrBlocks.map(b=>`### ${b.filename}\n${b.text}`).join("\n\n") : "";

    // 2) Upload ALL files to Gemini (Parallel)
    const uploadPromises = files.map(f => {
        const type = f.type || detectMimeFromB64(f.data || "");
        return geminiUpload(geminiKey, f.data, type)
            .then(uri => ({ name: f.name || "file", type, uri, status: 'success' }))
            .catch(e => {
                console.warn(`Upload fail for ${f.name}:`, e.message);
                return { name: f.name || "file", status: 'error', reason: e.message };
            });
    });

    const uploadResults = await Promise.all(uploadPromises);
    const fileUris = uploadResults.filter(r => r.status === 'success');
    const uploadErrors = uploadResults.filter(r => r.status === 'error');

    // 3) Build user-facing parts for Gemini
    const userParts = [{ text: buildUserPrompt(body) }];
    if (ocrJoined) userParts.push({ text: `نصوص OCR المستخرجة:\n\n${ocrJoined}` });
    fileUris.forEach(u => userParts.push({ file_data: { mime_type: u.type, file_uri: u.uri } }));

    // 4) If ensemble → get OpenAI analysis JSON too
    let ensembleJson = null;
    if (openaiKey && analysisMode === "ensemble"){
        try { ensembleJson = await analyzeWithOpenAI(openaiKey, body, ocrJoined); }
        catch(e){ console.warn("Ensemble OpenAI analysis failed:", e.message); }
        if (ensembleJson){
            userParts.push({ text: `تحليل موازٍ (OpenAI) بصيغة JSON — للإستئناس والدمج:\n${JSON.stringify(ensembleJson)}` });
        }
    }

    // 5) Final Gemini analysis → HTML
    const html = await geminiAnalyze(geminiKey, userParts, systemInstruction);
    
    // 6) Final JSON Response
    const responsePayload = {
        htmlReport: html,
        ocrUsed: !!ocrBlocks.length,
        ensembleUsed: !!ensembleJson,
        uploadErrors: uploadErrors.length > 0 ? uploadErrors : undefined
    };

    return res.status(200).json(responsePayload);

  } catch(err){
    console.error("Server error:", err);
    return res.status(500).json({ error:"Internal server error", detail: err.message });
  }
}
