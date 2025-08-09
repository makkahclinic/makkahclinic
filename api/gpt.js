// /api/gpt_steel.js — النسخة النهائية (Stable, Edge-safe)
// - لا Structured Output -> يختفي خطأ Gemini 400 "Unknown name \"type\"".
// - يدعم uiLang: 'ar'|'en'|'both' (للتقارير الثنائية من الواجهة).
// - يقبل files[] (images/PDF) و imageData[] (قديم).
// - تصحيح % وكلاسات risk-*، وقص أي كلام قبل <h3>، وإزالة أي <style> تسرب.
// - مهلة + إعادة محاولات + حارس حجم لمنع 413.

const MAX_INLINE_REQUEST_MB = 19.0;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60000;

// ============== SYSTEM INSTRUCTION (سريري + تأميني غني) ==============
const systemInstruction =
`أنت "كبير مدققي المطالبات الطبية والتأمين". أخرج تقرير HTML واحد فقط، دون أي CSS أو <style>.

[أ] التحليل الإلزامي
1) حلّل كل النصوص والصور/الملفات؛ اذكر أي تعارض.
2) اكشف: الازدواجية العلاجية، أخطاء الجرعات (XR/MR أكثر من مرة يوميًا؛ تعديل الجرعة حسب eGFR/العمر/الحمل/وظائف الكبد)، التفاعلات الدوائية الحرجة، غياب التشخيص الداعم، المدد غير المناسبة (صرف 90 يوم لحالة حادة)، صلاحية أو تعليمات غير واضحة.
3) عند توصية بإيقاف دواء، قدّم بديلًا آمنًا مع جرعة.

[ب] بنية HTML المطلوبة
<h3>تقرير التدقيق الطبي والمطالبات التأمينية</h3>
<h4>ملخص الحالة</h4><p>لخّص العمر/الجنس/التشخيصات/الملاحظات الحرجة.</p>
<h4>التحليل السريري العميق</h4><p>أبرز الأخطاء وربطها بالحالة (CKD/HTN/DM/عمر/حمل...).</p>
<h4>جدول الأدوية والإجراءات</h4>
<table><thead><tr>
<th>الدواء/الإجراء</th>
<th>الجرعة الموصوفة</th>
<th>الجرعة الصحيحة المقترحة</th>
<th>التصنيف</th>
<th>الغرض الطبي</th>
<th>التداخلات</th>
<th>درجة الخطورة (%)</th>
<th>قرار التأمين</th>
</tr></thead><tbody></tbody></table>

- "درجة الخطورة": رقم مع %؛ وطبِّق كلاس على <td>: risk-high (≥70) / risk-medium (40–69) / risk-low (<40).
- "قرار التأمين" حصراً بإحدى الصيغ الثلاث **مع ذكر التخصص المراجع**:
  ❌ قابل للرفض — السبب: […] — وللقبول يلزم: […] — **التخصص المُراجع: […]**
  ⚠️ قابل للمراجعة — السبب: […] — لتحسين فرص القبول: […] — **التخصص المُراجع: […]**
  ✅ مقبول — **التخصص المُراجع: […]**
- افحص أسماء الأدوية المكتوبة بخط اليد في الصور، وحاول تصحيح الأخطاء الإملائية (مثال: Amlopine → Amlodipine، Rozavi → Rosuvastatin، Co-Taburan 160/12.5 → Losartan/HCT 100/12.5؟ أو Valsartan/HCT؟، Diamicron MR 30، Pantomax 40… إلخ). اذكر إن كان الاسم غير مؤكد.

[ج] فرص تحسين الخدمة (مدعّمة بروابط موثوقة مباشرة)
- صيغة عنصر واحد لكل سطر: **اسم الفحص/الخدمة** — سبب سريري محدد — **رابط مصدر موثوق مباشر**.
- فعّل البنود الشائعة:
  • HbA1c — https://diabetesjournals.org/care
  • eGFR + UACR — https://kdigo.org/
  • Potassium + Creatinine (ACEi/ARB/Spironolactone/CKD) — https://www.ahajournals.org/
  • Chest X-ray (سعال مزمن/مدخّن ≥40 سنة) — https://acsearch.acr.org/
  • LDCT سنوي (50–80 سنة و≥20 باك-سنة) — https://www.uspreventiveservicestaskforce.org/
  • فحص عين سكري/OCT عند اللزوم — https://www.aao.org/preferred-practice-pattern

[د] خطة العمل
- قائمة مرقّمة، واضحة وقابلة للتنفيذ فورًا، مع بدائل الجرعات الآمنة.

[هـ] الخاتمة
<p><strong>الخاتمة:</strong> هذا التقرير تحليل مبدئي ولا يغني عن مراجعة متخصص.</p>
`;

// ============== PROMPT BUILDER ==============
function buildUserPrompt(caseData = {}) {
  const uiLangLine =
    caseData.uiLang === 'en'  ? 'اكتب التقرير بالإنجليزية فقط.'
  : caseData.uiLang === 'both'? 'اكتب العناوين/التسميات بالعربية والإنجليزية مع محتوى موحّد.'
                              : 'اكتب التقرير بالعربية فقط.';

  const filesInfo = summarizeFiles(caseData);

  return `
${uiLangLine}

**بيانات المريض (مدخل يدويًا):**
- العمر: ${caseData.age ?? 'غير محدد'}
- الجنس: ${caseData.gender ?? 'غير محدد'}
- التشخيصات: ${caseData.diagnosis ?? 'غير محدد'}
- الأدوية/الإجراءات المكتوبة: ${caseData.medications ?? 'غير محدد'}
- ملاحظات إضافية: ${caseData.notes ?? 'غير محدد'}

**تحاليل/قيم إن وُجدت:**
- eGFR: ${caseData.eGFR ?? 'غير محدد'} | HbA1c: ${caseData.hba1c ?? 'غير محدد'}
- K+: ${caseData.k ?? 'غير محدد'} | Cr: ${caseData.cr ?? 'غير محدد'} | UA: ${caseData.ua ?? 'غير محدد'} | INR: ${caseData.inr ?? 'غير محدد'}

**نمط حياة وأعراض:**
- مدخّن: ${caseData.isSmoker === true ? 'نعم' : (caseData.isSmoker === false ? 'لا' : 'غير محدد')}
- باك-سنة: ${caseData.smokingPackYears ?? 'غير محدد'}
- سعال (أسابيع): ${caseData.coughDurationWeeks ?? 'غير محدد'}
- أعراض بصرية/فحوص عين: ${caseData.visualSymptoms ?? 'غير محدد'} | آخر قاع عين: ${caseData.lastEyeExamDate ?? 'غير محدد'} | حدة البصر: ${caseData.visualAcuity ?? 'غير محدد'}

**الملفات المرفوعة:**
${filesInfo}
`;
}

function summarizeFiles(caseData){
  const list = []
    .concat(Array.isArray(caseData.files) ? caseData.files : [])
    .concat(Array.isArray(caseData.imageData) ? caseData.imageData.map(b64 => ({ type:'image/jpeg', base64:b64, name:'image.jpg' })) : []);
  if (!list.length) return '- لا توجد ملفات.';
  return list.slice(0,12).map((f,i)=>{
    const mime = f.type || ((f.name||'').toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
    const label = mime.startsWith('image/') ? 'صورة' : (mime==='application/pdf'?'PDF':'ملف');
    const name = f.name || `attachment-${i+1}`;
    const approxKB = Math.round(((f.base64?.length||0)*3)/4/1024);
    return `- ${label}: ${name} (~${approxKB}KB)`;
  }).join('\n');
}

// ============== HELPERS ==============
const _encoder = new TextEncoder();
const byteLen = s => _encoder.encode(s||'').length;
function estimateMB(parts){
  let bytes = 0;
  for (const p of parts){
    if (p.text) bytes += byteLen(p.text);
    if (p.inline_data?.data) bytes += Math.floor((p.inline_data.data.length*3)/4);
  }
  return bytes/(1024*1024);
}
function stripStyles(html){ try{ return String(html||'').replace(/<style[\s\S]*?<\/style>/gi,''); }catch{ return html; } }
function postProcess(html){
  try{
    html = String(html||'');
    // أضف % إذا سقطت
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi, (_m,o,n,_s,c)=> `${o}${n}%${c}`);
    // أضف كلاس المخاطر إن لم يوجد
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_m,open,numStr,close)=>{
        const v = parseInt(numStr,10);
        const k = v>=70?'risk-high': v>=40?'risk-medium':'risk-low';
        return open.replace('<td', `<td class="${k}"`) + `${numStr}%` + close;
      });
    // قص أي مقدمة قبل أول <h3>
    const i = html.indexOf('<h3'); if (i>0) html = html.slice(i);
    return stripStyles(html);
  }catch{ return html; }
}

async function fetchWithRetry(url, options, {retries=2, timeoutMs=DEFAULT_TIMEOUT_MS}={}){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try{
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok && retries>0 && RETRY_STATUS.has(res.status)){
      await new Promise(r=>setTimeout(r,(3-retries)*800));
      return fetchWithRetry(url, options, {retries:retries-1, timeoutMs});
    }
    return res;
  } finally { clearTimeout(timer); }
}

// ============== HANDLER ==============
export default async function handler(req,res){
  // CORS
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, x-api-version');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({ error:'Method Not Allowed' });

  try{
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

    const body = req.body || {};
    const parts = [{ text: systemInstruction }, { text: buildUserPrompt(body) }];

    // اجمع المرفقات (صور/PDF)
    const attachments = [];
    if (Array.isArray(body.files)){
      for (const f of body.files){
        if (!f || typeof f.base64!=='string') continue;
        let mime = f.type || '';
        if (!mime) mime = (f.name||'').toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
        attachments.push({ mimeType:mime, data:f.base64 });
      }
    }
    if (Array.isArray(body.imageData)){
      for (const b64 of body.imageData){
        if (typeof b64 === 'string' && b64.length>0) attachments.push({ mimeType:'image/jpeg', data:b64 });
      }
    }
    for (const a of attachments){ parts.push({ inline_data:a }); }

    // حارس الحجم
    const est = estimateMB(parts);
    if (est > MAX_INLINE_REQUEST_MB){
      return res.status(413).json({
        error:'الطلب كبير جداً',
        detail:`الحجم ~${est.toFixed(2)}MB > ${MAX_INLINE_REQUEST_MB}MB. قلل حجم/عدد الملفات.`
      });
    }

    const payload = {
      contents: [{ role:'user', parts }],
      generationConfig: { temperature: 0.2, topP: 0.95, topK: 40 }
      // لا تضع response_schema/responseMimeType هنا — سبب خطأ 400 "Unknown name \"type\"".
    };

    const gRes = await fetchWithRetry(apiUrl, {
      method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    }, { retries:2, timeoutMs: DEFAULT_TIMEOUT_MS });

    const text = await gRes.text();
    if (!gRes.ok){
      // رجّع رسالة واضحة للفرونت
      return res.status(gRes.status).json({ error:'فشل الاتصال بـ Gemini API', detail: text.slice(0, 2000) });
    }

    let json; try{ json = JSON.parse(text); }
    catch{ return res.status(502).json({ error:'استجابة غير متوقعة من Gemini', detail: text.slice(0,1200) }); }

    const rawHtml = json?.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text
      || '<p>⚠️ لم يتمكن النظام من إنشاء التقرير.</p>';
    const finalizedHtml = postProcess(rawHtml);

    // عرّف رأس بسيط يفيدنا بالنسخة لتفادي الكاش القديم
    res.setHeader('x-api-version','steel-1.0.0');
    return res.status(200).json({ htmlReport: finalizedHtml });

  }catch(err){
    console.error('Server Error:', err);
    return res.status(500).json({ error:'حدث خطأ في الخادم أثناء تحليل الحالة', detail: err.message, stack: err.stack });
  }
}
