// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
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
  (r.headers.get("content-type")||"").includes("application/json")
    ? r.json()
    : { raw: await r.text() };
const A = (x) => Array.isArray(x) ? x : (x ? [x] : []);

// ===== Gemini upload (resumable) =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");
  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bin.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
  });
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
    const { uri, mime: mm } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: mime,
      base64: b64
    });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt =
`أنت مساعد لاستخلاص سريري من ملفات وصور PDF/صور فوتوغرافية.
استخرج النقاط الطبية بدقّة (تشخيصات، أعراض، تحاليل، أدوية، إجراءات، تكرارات)،
ثم لخّص دون وضع توصيات علاجية نهائية. لا تفترض حقائق غير مذكورة.`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { maxOutputTokens: 2048 },
    contents: [
      { role: "user", parts: [{ text: (text || "لا يوجد نص حر.") }] },
      ...(parts.length ? [{ role: "user", parts }] : [])
    ]
  };

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error("Gemini generateContent error: " + JSON.stringify(data));
  const out = data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("\n") || "";
  return out;
}

// ===== Rulebook prompt =====
function auditInstructions() {
  return `
أنت استشاري تدقيق طبي وتأميني.
ادرس الحالة بعمق (العمر/الجنس/الحمل/الكلى/الكبد/ضغط الدم/السكري/الأعراض/علامات الجفاف أو الهبوط/الأعراض التنفسية/الحمّى/ألم البطن…)،
وطابق كل فحص/دواء/إجراء مع الدواعي السريرية الموثقة.

استند إلى روح الأدلة الحديثة (WHO, CDC, NIH, NHS, UpToDate, BNF, Micromedex, Lexicomp, DailyMed, Mayo Clinic, Cochrane, NEJM, Lancet, JAMA, BMJ, Nature, Science)
دون اختلاق مراجع محددة أو أرقام DOI. التبرير يكون سريريًا وتأمينيًا معًا.

IMPORTANT clinical insurance rules (لا تُهملها):
- Normal Saline I.V infusion مقبول فقط إذا وُجد دليل واضح على جفاف/فقدان سوائل/هبوط ضغط.
  إذا لم يوجد مبرر سريري (مثل وجود ارتفاع ضغط الدم أو السكري أو اعتلال الكلى بدون جفاف/هبوط) → القرار "قابل للرفض".
  اكتب التبرير: "استخدام محلول وريدي غير مبرر في حالة ارتفاع ضغط الدم/السكري بدون علامات جفاف أو هبوط ضغط".
- Dengue IgG فقط لا يثبت عدوى حادة → "قابل للرفض" ما لم توجد أعراض/سياق وبائي قوي؛ التشخيص الحاد يحتاج IgM أو NS1.
- Nebulizer/Inhaler يتطلب أعراض/تشخيص تنفسي موثق (صفير/ضيق نفس/ربو/COPD)، وإلا "قابل للرفض".
- Pantoprazole I.V مقبول بمؤشرات قوية (نزف علوي، قرحة معقّدة، قيء شديد مع تعذر الفموي)، وإلا قابل للمراجعة.
- Ultrasound يجب تحديد المنطقة وسبب الفحص. الغموض يقلل القبول.
- راجع التكرارات (تكرار نفس الدواء/الفحص في نفس الزيارة) وقيّمها كقابل للرفض/المراجعة مع تعليل.
- تحاليل HTN/DM المقبولة: HbA1c، وظائف كلوية (Creatinine/Urea/eGFR)، دهون؛ وCRP فقط عند الاشتباه بالالتهاب.

Scoring guide:
- riskPercent: تقدير عدم الملاءمة/المخاطر (0–100). <60 مقبول (أخضر)، 60–74 قابل للمراجعة (عنبر)، ≥75 مرفوض (أحمر).
- لكل صف: insuranceDecision.justification ≥ جملتين (تعليل سريري + تعليل تأميني).

Output: ONLY JSON with this shape (no extra text):
{
  "patientSummary": {
    "ageYears": number|null,
    "gender": "ذكر"|"أنثى"|null,
    "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null,
    "smoking": {"status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null,
    "chronicConditions": string[]
  },
  "diagnosis": string[],
  "symptoms": string[],
  "contradictions": string[],
  "table": [
    {
      "name": string,
      "itemType": "lab"|"medication"|"procedure"|"device"|"imaging",
      "doseRegimen": string|null,
      "intendedIndication": string|null,
      "isIndicationDocumented": boolean,
      "conflicts": string[],
      "riskPercent": number,
      "insuranceDecision": { "label": "مقبول"|"قابل للرفض"|"مرفوض", "justification": string }
    }
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}
`;
}

// ===== Weakness checks =====
function needsRefine(s){
  const rows = Array.isArray(s?.table)? s.table:[]; 
  const badRisk = rows.some(r => !Number.isFinite(r?.riskPercent));
  const weakJust = rows.filter(r=>{
    const j = r?.insuranceDecision?.justification||"";
    return j.trim().split(/[.؟!]\s*/).filter(Boolean).length < 2;
  }).length;
  const missMissing = !Array.isArray(s?.missingActions) || s.missingActions.length < 2;
  const missFinance = !Array.isArray(s?.financialInsights) || s.financialInsights.length < 2;
  return (!rows.length) || badRisk || (weakJust/Math.max(rows.length,1) > 0.25) || missMissing || missFinance;
}

// ===== OpenAI helpers =====
async function openaiChatJSON(messages, response_format={ type:"json_object" }){
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: OPENAI_MODEL, messages, response_format })
  });
  const data = await resp.json();
  if(!resp.ok) throw new Error("OpenAI error: "+JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content||"{}";
  return JSON.parse(txt);
}

async function chatgptJSON(bundle, extra=[]) {
  return openaiChatJSON([
    { role:"system", content: auditInstructions() },
    { role:"user", content: "المعطيات:\n"+JSON.stringify(bundle,null,2) },
    ...extra
  ]);
}

// ===== NEW: إذا الجدول فاضي، اطلب استخراج العناصر المذكورة ثم أعد التدقيق =====
async function extractCandidateItems(bundle){
  const sys = `
أنت مساعد استخراج عناصر فقط.
اقرأ نصوص OCR والنص الحر، ثم أخرج JSON فيه مصفوفة items تحتوي أسماء العناصر المذكورة حرفيًا تقريبًا
(تحاليل، أدوية، إجراءات، أجهزة، تصوير)، بدون أحكام أو نسب.
ONLY JSON: {"items": string[]}`;
  const j = await openaiChatJSON([
    { role:"system", content: sys },
    { role:"user", content: JSON.stringify(bundle,null,2) }
  ]);
  const items = A(j?.items).map(x=>String(x).trim()).filter(Boolean);
  return [...new Set(items)].slice(0, 40); // حد أعلى معقول
}

// ===== HTML rendering =====
function cellColor(p){
  if(!Number.isFinite(p)) return 'style="background:#f1f5f9;border:1px solid #e5e7eb"';
  if(p>=75) return 'style="background:#fee2e2;border:1px solid #fecaca"';
  if(p>=60) return 'style="background:#fff7ed;border:1px solid #ffedd5"';
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';
}
function esc(x){ return String(x??"").replace(/[&<>]/g, s=>({ "&":"&amp;","<":"&lt;",">":"&gt;" }[s])); }
function toHtml(s){
  const contradictions = A(s?.contradictions);
  const rows = A(s?.table).map(r=>`
    <tr>
      <td>${esc(r?.name||"-")}</td>
      <td>${esc(r?.itemType||"-")}</td>
      <td>${esc(r?.doseRegimen||"-")}</td>
      <td>${esc(r?.intendedIndication||"-")}</td>
      <td>${r?.isIndicationDocumented ? "نعم" : "لا"}</td>
      <td>${A(r?.conflicts).map(esc).join("<br>")||"-"}</td>
      <td ${cellColor(r?.riskPercent)}><b>${Number.isFinite(r?.riskPercent)? Math.round(r.riskPercent)+"%" : "-"}</b></td>
      <td>${esc(r?.insuranceDecision?.label||"-")}</td>
      <td>${esc(r?.insuranceDecision?.justification||"-")}</td>
    </tr>`).join("");

  const missing = A(s?.missingActions);
  const fin = A(s?.financialInsights);

  return `
  <h2>📋 ملخص الحالة</h2>
  <div class="kvs"><p>${esc(s?.conclusion||"")}</p></div>

  <h2>⚠️ التناقضات والأخطاء</h2>
  <ul>${contradictions.length? contradictions.map(c=>`<li>${esc(c)}</li>`).join("") : "<li>لا يوجد تناقضات واضحة</li>"}</ul>

  <h2>💊 جدول الأدوية والإجراءات</h2>
  <table dir="rtl" style="width:100%;border-collapse:collapse">
    <thead>
      <tr>
        <th>الاسم</th><th>التصنيف</th><th>الجرعة</th><th>المؤشّر</th>
        <th>موثّق؟</th><th>تعارضات</th><th>درجة الخطورة</th><th>قرار التأمين</th><th>التبرير</th>
      </tr>
    </thead>
    <tbody>${rows || ""}</tbody>
  </table>

  <h2>🩺 ما كان يجب القيام به</h2>
  <ul>${missing.length? missing.map(m=>`<li>${esc(m)}</li>`).join("") : "<li>—</li>"}</ul>

  <h2>📈 فرص تحسين الدخل والخدمة</h2>
  <ul>${fin.length? fin.map(m=>`<li>${esc(m)}</li>`).join("") : "<li>—</li>"}</ul>
  `;
}

// ===== Handler =====
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return bad(res,405,"POST only");
    if(!OPENAI_API_KEY) return bad(res,500,"Missing OPENAI_API_KEY");
    if(!GEMINI_API_KEY) return bad(res,500,"Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body||{};

    // 1) OCR from Gemini
    const extracted = await geminiSummarize({ text, files });

    // 2) Bundle
    const bundle = { patientInfo, extractedSummary: extracted, userText: text };

    // 3) First pass
    let structured = await chatgptJSON(bundle);

    // 4) If weak/empty table → extract candidates then refine with a hard requirement
    if (needsRefine(structured)) {
      const candidates = await extractCandidateItems(bundle);
      const forceMsg = {
        role: "user",
        content:
          "هذه قائمة عناصر مذكورة في الوثائق: \n" +
          JSON.stringify({ candidateItems: candidates }, null, 2) +
          "\nسجّل صفًا لكل عنصر تم ذكره (إن كان ذا صلة سريرية) ولا ترجع جدولًا فارغًا. " +
          "ابدأ الخلاصة بذكر الأمراض المزمنة والأعراض الرئيسية. " +
          "املأ حقول 'ما كان يجب القيام به' و'فرص تحسين الدخل' (٢–٣ نقاط على الأقل لكل منهما). " +
          "لكل صف: اجعل التبرير ≥ جملتين (سريرية + تأمينية). لا تنسِ قاعدة Normal Saline وDengue IgG."
      };
      structured = await chatgptJSON({ ...bundle, candidateItems: candidates }, [forceMsg]);
    }

    // 5) HTML
    const html = toHtml(structured);
    return ok(res, { html, structured });
  }catch(err){
    console.error("/api/gpt error:", err);
    return bad(res,500, err?.message || String(err));
  }
}
