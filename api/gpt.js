export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

// --- مفاتيح و إعدادات ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o"; 
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest"; 
const GEMINI_FILES_URL = "https://generativelenanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// --- أدوات مساعدة ---
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const has = (pat, text)=> new RegExp(pat,'i').test(String(text||""));
const parseJsonSafe = async (r) => (r.headers.get("content-type")||"").includes("application/json") ? r.json() : { raw: await r.text() };

// --- رفع الملفات إلى Gemini ---
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");
  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,{
    method:"POST",
    headers:{
      "X-Goog-Upload-Protocol":"resumable",
      "X-Goog-Upload-Command":"start",
      "X-Goog-Upload-Header-Content-Length":String(bin.byteLength),
      "X-Goog-Upload-Header-Content-Type":mimeType,
      "Content-Type":"application/json",
    },
    body: JSON.stringify({ file:{ display_name:name, mime_type:mimeType } })
  });
  if(!initRes.ok) throw new Error("Gemini init failed: "+JSON.stringify(await parseJsonSafe(initRes)));
  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if(!sessionUrl) throw new Error("Gemini upload URL missing");
  const upRes = await fetch(sessionUrl,{
    method:"PUT",
    headers:{
      "Content-Type":mimeType,
      "X-Goog-Upload-Command":"upload, finalize",
      "X-Goog-Upload-Offset":"0",
      "Content-Length":String(bin.byteLength),
    },
    body: bin
  });
  const meta = await parseJsonSafe(upRes);
  if(!upRes.ok) throw new Error("Gemini finalize failed: "+JSON.stringify(meta));
  return { uri: meta?.file?.uri, mime: meta?.file?.mime_type || mimeType };
}

// --- تلخيص Gemini (باستخدام التلقين المحسّن) ---
async function geminiSummarize({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data||"").split("base64,").pop() || f?.data;
    if (!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({ name: f?.name || "file", mimeType: mime, base64: b64 });
    userParts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }
  if (userParts.length === 0) userParts.push({ text: "لا يوجد نص أو ملفات لتحليلها." });

  const systemPrompt = `أنت خبير في تحليل التقارير الطبية. مهمتك هي قراءة النصوص والملفات المرفقة واستخلاص كافة المعلومات السريرية بدقة.
نظم المعلومات المستخرجة تحت العناوين التالية:
- الشكوى الرئيسية والأعراض
- التاريخ المرضي والحالات المزمنة
- العلامات الحيوية (Vitals)
- نتائج الفحوصات المخبرية (Labs)
- نتائج الأشعة (Imaging)
- الأدوية والجرعات
- التشخيصات المذكورة
- الطلبات والإجراءات المقترحة`;
  
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }]
  };

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL),{
    method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
  });
  const data = await parseJsonSafe(resp);
  if(!resp.ok) throw new Error("Gemini generateContent error: "+JSON.stringify(data));
  return data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("\n") || "";
}


// ##############################################################################
// ############## التعديل الجوهري والمميز هنا في هذه الدالة ######################
// ##############################################################################
function auditInstructions(){ 
  return `أنت مدقق طبي خبير لدى شركة تأمين. مهمتك هي تحليل البيانات السريرية التالية وإصدار حكم تأميني بناءً على المنطق الطبي والمبررات الموثقة.
مهمتك الأساسية هي **الاستنتاج والربط** بين شكوى المريض وتشخيصه وبين كل إجراء أو دواء مطلوب.

**خطوات التحليل المطلوبة منك:**
1.  اقرأ ملخص الحالة جيداً (الشكوى، التشخيص، العلامات الحيوية).
2.  لكل دواء أو فحص أو إجراء في القائمة، ابحث عن مبرر له في ملخص الحالة.
3.  **املأ حقل "intendedIndication"** بالمبرر السريري الذي استنتجته. مثال: إذا كانت الشكوى "ألم شرسوفي" والدواء هو "Pantozol"، اكتب في الحقل "علاج الألم الشرسوفي الموثق". إذا لم تجد أي مبرر، اترك الحقل فارغاً (null).
4.  **حدد "isIndicationDocumented"** بـ \`true\` إذا وجدت مبرراً واضحاً، وبـ \`false\` إذا لم تجد.
5.  **اكتب قرار التأمين "insuranceDecision"** مع تبرير واضح ومختصر. مثال: "مقبول لوجود أعراض موثقة" أو "قابل للرفض لعدم توثيق أي أعراض تنفسية".
6.  **استنتج "contradictions"** وهي التناقضات الواضحة (مثل طلب فحص خاطئ أو دواء لا يناسب الحالة).
7.  **استنتج "missingActions"** وهي الإجراءات التي كان يجب القيام بها (مثل توثيق عرض معين أو طلب فحص أدق).

أخرج JSON فقط بالمخطط التالي ولا شيء غيره:
{
  "patientSummary":{"ageYears":number|null,"gender":"ذكر"|"أنثى"|null,"chronicConditions":string[]},
  "diagnosis":string[], "symptoms":string[], "contradictions":string[],
  "table":[
    {"name":string,"itemType":"lab"|"medication"|"procedure"|"device"|"imaging",
     "doseRegimen":string|null,
     "intendedIndication":string|null,
     "isIndicationDocumented":boolean,
     "conflicts":string[],
     "riskPercent":number,
     "insuranceDecision":{"label":"مقبول"|"قابل للمراجعة"|"قابل للرفض","justification":string}}
  ],
  "missingActions":string[], "referrals":[{"specialty":string,"whatToDo":string[]}],
  "financialInsights":string[], "conclusion":string
}
ONLY JSON.`;
}

async function chatgptJSON(bundle, extra=[]){
  const resp = await fetch(OPENAI_API_URL,{
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role:"system", content:auditInstructions() },
        { role:"user", content: "البيانات السريرية للتدقيق:\n"+JSON.stringify(bundle,null,2) },
        ...extra
      ],
      response_format:{ type:"json_object" }
    })
  });
  const data = await resp.json();
  if(!resp.ok) throw new Error("OpenAI error: "+JSON.stringify(data));
  return JSON.parse(data?.choices?.[0]?.message?.content||"{}");
}

// --- قواعد التحقق النهائية (تبقى كما هي كشبكة أمان) ---
function applyGuardrails(structured, ctx){
  const s = structured || {};
  const ctxText = [ctx?.userText, ctx?.extractedSummary].filter(Boolean).join(" ");
  s.table = Array.isArray(s.table)? s.table : [];
  s.contradictions = Array.isArray(s.contradictions)? s.contradictions : [];
  s.missingActions = Array.isArray(s.missingActions)? s.missingActions : [];
  s.financialInsights = Array.isArray(s.financialInsights)? s.financialInsights : [];

  const pushContra=(m)=>{ if(!s.contradictions.includes(m)) s.contradictions.push(m); };

  s.table = s.table.map((r)=>{
    const name=String(r?.name||"").trim();
    const lower=name.toLowerCase();
    
    // إذا قام الذكاء الاصطناعي بعمله بشكل صحيح، يجب ألا نحتاج لتعديل كبير هنا
    // لكن هذه القواعد تضمن عدم حدوث أخطاء واضحة
    if (/dengue/i.test(lower) && /igg/i.test(lower) && !has("\\b(igm|ns\\s*-?1)\\b", ctxText)){
      r.riskPercent=Math.max(r.riskPercent||0, 80);
      r.insuranceDecision = {label:"قابل للرفض", justification:"فحص IgG لوحده لا يشخص عدوى حادة. يجب طلب IgM/NS1."};
      pushContra("طلب Dengue IgG منفردًا دون IgM/NS1 لتشخيص حالة حادة.");
    }
    const isIVFluid = /\b(normal\s*saline|\bi\.?v\.?\s*infusion\b)/i.test(lower);
    const hasDehydration = has("جفاف|dehydrat|vomit|diarrhea", ctxText);
    const hasHypotension = has("هبوط\\s*ضغط|hypotens", ctxText);
    if (isIVFluid && !(hasDehydration||hasHypotension)){
      r.riskPercent=Math.max(r.riskPercent||0, 80);
      r.insuranceDecision = {label:"قابل للرفض", justification:"لا يوجد دليل على جفاف أو هبوط ضغط يبرر استخدام المحلول الوريدي."};
      pushContra("وصف محلول وريدي دون دليل على الجفاف أو هبوط الضغط.");
    }
    return r;
  });

  if (s.financialInsights.length===0){
    s.financialInsights.push(
      "توثيق المبررات السريرية لكل طلب بشكل واضح يقلل من نسبة الرفض ويسرّع دورة التحصيل المالي.",
      "تطبيق بروتوكولات واضحة للحالات الشائعة (مثل آلام البطن) يضمن طلب الفحوصات الضرورية فقط."
    );
  }
  return s;
}

// --- تحويل المخرجات إلى HTML (بدون تغيير) ---
function badge(p){ if(p>=75) return 'badge badge-bad'; if(p>=60) return 'badge badge-warn'; return 'badge badge-ok'; }
function toHtml(s){
  const rows = (s.table||[]).map(r=>`<tr>
      <td>${r.name||"-"}</td>
      <td>${r.itemType||"-"}</td>
      <td>${r.doseRegimen||"-"}</td>
      <td>${r.intendedIndication||"-"}</td>
      <td>${r.isIndicationDocumented?"نعم":"لا"}</td>
      <td>${(r.conflicts||[]).join('<br>')||"-"}</td>
      <td><span class="${badge(r.riskPercent||0)}"><b>${Math.round(r.riskPercent||0)}%</b></span></td>
      <td>${r.insuranceDecision?.label||"-"}</td>
      <td>${r.insuranceDecision?.justification||"-"}</td>
    </tr>`
  ).join("");
  const contra = (s.contradictions||[]).map(x=>`<li>• ${x}</li>`).join("") || "<li>لا توجد تناقضات بارزة.</li>";
  const missing = (s.missingActions||[]).map(x=>`<li>• ${x}</li>`).join("") || "<li>لا توجد إجراءات ناقصة مقترحة.</li>";
  const fin = (s.financialInsights||[]).map(x=>`<li>• ${x}</li>`).join("") || "<li>—</li>";

  return `<h2>📋 ملخص الحالة</h2>
  <div class="kvs"><p>${(s.conclusion||"").replace(/\n/g,'<br>')}</p></div>
  <h2>⚠️ التناقضات والفجوات</h2>
  <ul>${contra}</ul>
  <h2>💊 جدول الأدوية والإجراءات</h2>
  <table class="table" dir="rtl">
    <thead><tr>
      <th>الاسم</th><th>التصنيف</th><th>الجرعة</th><th>المؤشّر المستنتج</th>
      <th>المؤشر موثّق؟</th><th>تعارضات</th><th>درجة الخطورة</th><th>قرار التأمين</th><th>التبرير</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>🩺 الإجراءات المقترحة</h2>
  <ul>${missing}</ul>
  <h2>📈 رؤى مالية وتشغيلية</h2>
  <ul>${fin}</ul>`;
}

// --- المتحكم الرئيسي في الطلب ---
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return bad(res,405,"POST only");
    if(!OPENAI_API_KEY) return bad(res,500,"Missing OPENAI_API_KEY");
    if(!GEMINI_API_KEY)  return bad(res,500,"Missing GEMINI_API_KEY");

    const { text="", files=[], patientInfo=null } = req.body||{};
    const extracted = await geminiSummarize({ text, files });
    const bundle = { patientInfo, extractedSummary: extracted, userText: text };

    let structured = await chatgptJSON(bundle);

    // تطبيق القواعد النهائية كخطوة تحقق أخيرة
    structured = applyGuardrails(structured, { userText:text, extractedSummary:extracted });
    
    const html = toHtml(structured);
    return ok(res,{ html, structured });
  }catch(err){
    console.error("/api/gpt error:", err);
    return bad(res,500, err?.message || String(err));
  }
}
