// /pages/api/gpt.js
// Backend: Gemini OCR/vision (Files API) → تدقيق سريري/تأميني بـ ChatGPT → HTML تقرير

// ====== Next.js route config (ثابتة) ======
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb", // حد البودي للطلبات الكبيرة
    },
  },
};

// ====== مفاتيح ونماذج ======
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// ====== أدوات مساعدة صغيرة ======
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function parseJsonSafe(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  return { raw: await res.text() };
}

// ====== رفع الملفات إلى Gemini Files API ======
async function geminiUploadFile({ name, mimeType, base64Data }) {
  // خطوة 1: init (resumable)
  const init = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Header-Content-Length": String(Buffer.byteLength(base64Data, "base64")), "X-Goog-Upload-Header-Content-Type": mimeType },
    body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
  });
  if (!init.ok) throw new Error("Gemini init upload failed: " + JSON.stringify(await parseJsonSafe(init)));

  const uploadUrl = init.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Gemini upload URL missing");

  // خطوة 2: actual upload (base64 → binary)
  const bin = Buffer.from(base64Data, "base64");
  const up = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType, "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0" },
    body: bin,
  });
  if (!up.ok) throw new Error("Gemini finalize failed: " + JSON.stringify(await parseJsonSafe(up)));
  const meta = await up.json();
  return meta; // يحتوي على file.uri
}

// ====== استدعاء Gemini: OCR/تلخيص الملفات + النص الحر ======
async function geminiSummarize({ text, files }) {
  const fileParts = [];
  for (const f of files || []) {
    const meta = await geminiUploadFile({ name: f.name || "file", mimeType: f.mimeType || "application/octet-stream", base64Data: f.data });
    fileParts.push({ file_data: { file_uri: meta.file.uri, mime_type: meta.file.mime_type } });
  }

  const systemPrompt = [
    "أنت مساعد لاستخلاص سريري.",
    "ادمج ما تقرأه من الملفات (OCR/نصوص PDFs وصور) مع النص الحر الذي يرسله المستخدم.",
    "أخرج خلاصة منسقة للنقاط المهمة فقط: التشخيصات المذكورة، المؤشرات السريرية، علامات حيوية، أدوية/إجراءات مطلوبة، وتكرارات الطلبات."
  ].join("\n");

  const userText = (text || "").trim() || "لا يوجد نص حر.";

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] }, // ← REST field الصحيح
    contents: [
      { role: "user", parts: [{ text: "نص المستخدم:\n" + userText }] },
      ...(fileParts.length ? [{ role: "user", parts: fileParts }] : []),
    ],
  };

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error("Gemini generateContent error: " + JSON.stringify(data));

  const textOut = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
  return { text: textOut };
}

// ====== برومبت ChatGPT للتدقيق + JSON منظّم ======
function buildAuditInstructions() {
  return `
أنت استشاري تدقيق طبي وتأميني. حلّل معطيات المريض + النص الحر + الخلاصة المستخرجة من الملفات (OCR).
أخرج JSON فقط، بلا أي نص خارجه.

قواعد صارمة:
- صنّف كل بند: itemType = lab | medication | procedure | device | imaging.
- intendedIndication = المؤشّر السريري المتوقع. isIndicationDocumented = هل المؤشّر مذكور فعليًا في المعطيات.
- riskPercent:
  <60 = "مقبول" (أخضر)
  60–74 = "قابل للرفض – يحتاج تبرير" (أصفر)
  ≥75 = "مرفوض" (أحمر)
- insuranceDecision.justification = تعليل سريري محدد (اذكر لماذا وما المطلوب للقبول).
- اعتبر التكرار تعارضًا وارفع الخطورة (≥75).
- اذكر contradictions واضحة بين النص الحر والملفات (مثال: لا قيء ومع ذلك طلب مضاد قيء).

عند تقييم أمثلة شائعة:
- Dengue: التشخيص الحاد يعتمد NAAT/NS1 + IgM، IgG منفردة لا تكفي. (CDC/WHO) 
- IV Fluids: تُوصف ضمن 5Rs (Resuscitation/Maintenance/Replacement/Redistribution/Reassessment) وليس روتينيًا دون مؤشّر. (NICE)
- Paracetamol IV: يُفضّل عندما يتعذّر المسار الفموي/هناك حاجة واضحة للوريدي. (إرشادات أدوية)
- Metoclopramide: تحذير TD صندوق أسود؛ استخدمه لمؤشّر واضح ولمدد قصيرة. (FDA)

أخرج فقط هذا القالب:
{
 "patientSummary": { "ageYears": number|null, "gender": "ذكر"|"أنثى"|null, "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null, "smoking": {"status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null, "chronicConditions": string[] },
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
ONLY JSON.
`.trim();
}

function needsRefine(structured) {
  const rows = Array.isArray(structured?.table) ? structured.table : [];
  if (!rows.length) return true;
  const zero = rows.filter(r => !Number.isFinite(r?.riskPercent) || r.riskPercent === 0).length;
  const weak = rows.filter(r => !r?.insuranceDecision?.justification || r.insuranceDecision.justification.trim().length < 20).length;
  return (zero/rows.length > 0.4) || (weak/rows.length > 0.4);
}

async function chatgptAuditJSON(bundle, extraMessages = []) {
  const messages = [
    { role: "system", content: buildAuditInstructions() },
    { role: "user", content: "المعطيات الموحدة للتحليل:\n" + JSON.stringify(bundle, null, 2) },
    ...extraMessages
  ];

  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      // يمكن رفع الانضباط إلى json_schema (Structured Outputs) حسب الوثائق
      response_format: { type: "json_object" } // راجع Structured Outputs للمخططات الصارمة.   
- **حد استجابة API Routes ~4MB** للتنبيه. :contentReference[oaicite:7]{index=7}  
- **Gemini API – generateContent & System Instructions** (REST). :contentReference[oaicite:8]{index=8}  
- **Gemini Files API** (رفع الملف ثم استعمال `file_uri`). :contentReference[oaicite:9]{index=9}  
- **OpenAI Structured Outputs** (JSON Schema/انضباط المخرجات). :contentReference[oaicite:10]{index=10}  
- **Dengue (تشخيص حاد: NAAT/NS1 + IgM)** — CDC/WHO. :contentReference[oaicite:11]{index=11}  
- **IV Fluids** — NICE 5Rs ومبادئ الوصف. :contentReference[oaicite:12]{index=12}  
- **Paracetamol IV** — دلائل الاستخدام الوريدي. :contentReference[oaicite:13]{index=13}  
- **Metoclopramide** — تحذير Tardive Dyskinesia (FDA). :contentReference[oaicite:14]{index=14}

---

إذا وافقت، أقدر الآن أحاول **تحديث ملف الواجهة على الكانفاس** بإضافة تحسينات عرض الخطأ وزرّ “نسخ JSON”، أو أتركه كما هو ونركّز على اختبار الـ API بهذا الكود.
