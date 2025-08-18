// /pages/api/gpt.js
// Backend: Gemini OCR/Vision → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

// ===== Keys & endpoints =====
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) => 
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// ===== Helpers =====
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (r) =>
  (r.headers.get("content-type")||"").includes("application/json") ? r.json() : { raw: await r.text() };

// ===== Gemini upload =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");

  const initRes = await fetch(
    `${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bin.byteLength),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
    }
  );

  if (!initRes.ok) throw new Error("Gemini init failed: " + JSON.stringify(await parseJsonSafe(initRes)));

  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload URL missing");

  const upRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(bin.byteLength),
    },
    body: bin,
  });

  const meta = await parseJsonSafe(upRes);
  if (!upRes.ok) throw new Error("Gemini finalize failed: " + JSON.stringify(meta));

  return { uri: meta?.file?.uri, mime: meta?.file?.mime_type || mimeType };
}

// ===== Gemini summarize =====
async function geminiSummarize({ text, files }) {
  const parts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data||"").split("base64,").pop();
    if (!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({ name: f?.name || "file", mimeType: mime, base64: b64 });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt = "Extract the medical content (OCR). Return structured text of labs, drugs, procedures only.";
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: "user", parts: [{ text: text || "لا يوجد نص حر." }] },
      ...(parts.length ? [{ role: "user", parts }] : [])
    ]
  };

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error("Gemini generateContent error: " + JSON.stringify(data));
  const out = data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("\n") || "";
  return out;
}

// ===== Audit instructions =====
function auditInstructions(){ return `
أنت استشاري تدقيق طبي وتأميني. حلّل معطيات المريض + النص الحر + الخلاصة من OCR.

استند إلى المراجع الطبية العالمية الحديثة عند الحكم، بما في ذلك:
- WHO, CDC, NIH, NHS, SFDA, FDA, EMA
- PubMed, Cochrane Library, UpToDate, Mayo Clinic
- NEJM, The Lancet, JAMA, BMJ, Nature, Science
- Harrison’s Internal Medicine, Gray’s Anatomy
- Micromedex, Lexicomp, BNF, DailyMed, USP
- IDSA, ADA, AHA/ACC, NCCN, KDIGO, GOLD, GINA, EULAR, ACS, ACP
- WHO Essential Medicines List, ICD-11, SNOMED CT
- النشرات الدوائية الرسمية (Package Inserts)

مطلوب منك:
- تبرير كل قرار (مقبول / قابل للرفض / مرفوض) بجملة سريرية قوية تستند إلى هذه المراجع.
- وضع riskPercent واقعي (0–100) بالألوان:
  ✅ أخضر (<60)  ⚠️ أصفر (60–74)  ❌ أحمر (≥75)
- إبراز التعارضات والتكرارات بوضوح.
- ذكر الإجراءات/التحاليل الناقصة التي كان يجب طلبها.
- تقديم استنتاج نهائي (الخاتمة) يوضح ما يلزم لتحسين الخدمة الطبية وزيادة دخل العيادة.

أخرج JSON فقط وبدون أي نص خارجه وفق المخطط التالي:
{
  "patientSummary": {...},
  "diagnosis": [...],
  "symptoms": [...],
  "contradictions": [...],
  "table": [...],
  "missingActions": [...],
  "referrals": [...],
  "financialInsights": [...],
  "conclusion": string
}
`; }

// ===== ChatGPT call =====
async function chatgptJSON(bundle, extra=[]) {
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role:"system", content: auditInstructions() },
        { role:"user", content: "المعطيات:\n"+JSON.stringify(bundle,null,2) },
        ...extra
      ],
      response_format:{ type:"json_object" }
    })
  });
  const data = await resp.json();
  if(!resp.ok) throw new Error("OpenAI error: "+JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content||"{}";
  return JSON.parse(txt);
}

// ===== HTML rendering =====
function colorCell(p){ 
  if(p>=75) return 'style="background:#fee2e2;border:1px solid #fecaca"'; // أحمر
  if(p>=60) return 'style="background:#fff7ed;border:1px solid #ffedd5"'; // أصفر
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';           // أخضر
}

function toHtml(s){
  const rows = (s.table||[]).map(r=>
    `<tr>
      <td>${r.name||"-"}</td>
      <td>${r.itemType||"-"}</td>
      <td>${r.doseRegimen||"-"}</td>
      <td>${r.intendedIndication||"-"}</td>
      <td>${r.isIndicationDocumented?"نعم":"لا"}</td>
      <td>${(r.conflicts||[]).join('<br>')||"-"}</td>
      <td ${colorCell(r.riskPercent||0)}><b>${Math.round(r.riskPercent||0)}%</b></td>
      <td>${r.insuranceDecision?.label||"-"}</td>
      <td>${r.insuranceDecision?.justification||"-"}</td>
    </tr>`
  ).join("");

  return `
    <h2>📋 ملخص الحالة</h2>
    <div><p>${(s.conclusion||"").replace(/\n/g,'<br>')}</p></div>

    <h2>⚠️ التناقضات والأخطاء</h2>
    <ul>${(s.contradictions||[]).map(c=>`<li>${c}</li>`).join("")||"<li>لا يوجد تناقضات واضحة</li>"}</ul>

    <h2>💊 جدول الأدوية والإجراءات</h2>
    <table dir="rtl" style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th>الاسم</th><th>التصنيف</th><th>الجرعة</th><th>المؤشّر</th>
          <th>موثّق؟</th><th>تعارضات</th><th>درجة الخطورة</th>
          <th>قرار التأمين</th><th>التبرير</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <h2>🩺 ما كان يجب القيام به</h2>
    <ul>${(s.missingActions||[]).map(m=>`<li>${m}</li>`).join("")||"<li>لم يتم رصد نواقص واضحة</li>"}</ul>

    <h2>📈 فرص تحسين الدخل والخدمة</h2>
    <ul>${(s.financialInsights||[]).map(f=>`<li>${f}</li>`).join("")||"<li>لا توجد فرص إضافية بارزة</li>"}</ul>
  `;
}

// ===== API handler =====
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return bad(res,405,"POST only");
    if(!OPENAI_API_KEY) return bad(res,500,"Missing OPENAI_API_KEY");
    if(!GEMINI_API_KEY) return bad(res,500,"Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body||{};
    const extracted = await geminiSummarize({ text, files });
    const bundle = { patientInfo, extractedSummary: extracted, userText: text };

    let structured = await chatgptJSON(bundle);
    const html = toHtml(structured);

    return ok(res, { html, structured });
  }catch(err){
    console.error("/api/gpt error:", err);
    return bad(res,500, err?.message || String(err));
  }
}
