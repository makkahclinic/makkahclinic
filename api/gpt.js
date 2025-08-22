// pages/api/gpt.js

// ========== 1) إعدادات Next.js ==========
export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

// ========== 2) مفاتيح ونقاط النهاية ==========
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL     = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// ========== 3) مساعدين عامّين ==========
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (response) =>
  (response.headers.get("content-type") || "").includes("application/json")
    ? response.json()
    : { raw: await response.text() };

// ========== 4) رفع ملف إلى Gemini ==========
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, "base64");
  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(binaryData.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
  });
  if (!initRes.ok) throw new Error(`Gemini init failed: ${JSON.stringify(await parseJsonSafe(initRes))}`);
  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload session URL is missing");
  const uploadRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(binaryData.byteLength),
    },
    body: binaryData,
  });
  const metadata = await parseJsonSafe(uploadRes);
  if (!uploadRes.ok) throw new Error(`Gemini finalize failed: ${JSON.stringify(metadata)}`);
  return { uri: metadata?.file?.uri, mime: metadata?.file?.mime_type || mimeType };
}

// ========== 5) OCR حرفي من Gemini ==========
async function geminiOCRVerbatim({ text, files }) {
  // نحمّل الملفات أولاً
  const parts = [];
  if (text) parts.push({ text }); // يضاف النصّ الحر أيضًا
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const base64 = (f?.data || "").split("base64,").pop() || f?.data;
    if (!base64) continue;
    const { uri, mime: finalMime } = await geminiUploadBase64({
      name: f?.name || "uploaded",
      mimeType: mime,
      base64,
    });
    parts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }

  const system = `
أنت ناسخ طبي دقيق. المطلوب استخراج سطور النص كما هي من الصور/PDF مع الحفاظ على التهجئة، الفراغات، والرموز (مثال: 1 × 2 × 90).
أعد نتيجة واحدة فقط بصيغة JSON بالهيكل:
{
  "files": [
    { "id": 1, "lines": ["سطر1 كما هو", "سطر2 كما هو", ...] }
  ]
}
قواعد:
- لا تُترجم ولا تُلخّص.
- حافظ على الترتيب البصري للسطور قدر الإمكان.
- إذا تعذّر القراءة اكتب "[غير مقروء]".
`;

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: parts.length ? parts : [{ text: "No text or files." }] }],
    generationConfig: { temperature: 0.2 },
  };

  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini OCR error: ${JSON.stringify(data)}`);
  // قد تأتي الأجزاء نصًا واحدًا
  const txt = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "{}";
  let parsed;
  try { parsed = JSON.parse(txt); } catch { parsed = { files: [{ id: 1, lines: (txt || "").split(/\n+/) }] }; }
  return parsed;
}

// ========== 6) محلّل الجرعات ==========
const FREQ_WORDS = [
  { re: /\b(?:od|qd|once(?:\s+a)?\s+day|once\s+daily|مرة(?:\s+يوميًا)?|مره(?:\s+يوميًا)?)\b/iu, val: 1 },
  { re: /\b(?:bid|twice\s+daily|twice\s+a\s+day|مرتين(?:\s+يوميًا)?)\b/iu, val: 2 },
  { re: /\b(?:tid|three\s+times\s+daily|ثلاث\s+مرات(?:\s+يوميًا)?)\b/iu, val: 3 },
  { re: /\b(?:qid|four\s+times\s+daily|أربع\s+مرات(?:\s+يوميًا)?)\b/iu, val: 4 },
];

const BRAND_MAP = [
  { key: "gliclazide_mr", match: /(?:diami?cron\s*mr|gliclazide\s*(?:mr|modified|modified[-\s]*release))/i, display: "Diamicron MR (gliclazide MR)" },
  { key: "metformin_xr", match: /(?:formut|formet|glucophage|metformin)\s*(?:xr|sr|er|cr)?/i, display: "Metformin (±XR)" },
  { key: "amlodipine", match: /amlo(?:dipine)?/i, display: "Amlodipine" },
  { key: "duodart", match: /duodart/i, display: "Duodart (dutasteride/tamsulosin)" },
];

const RULES = {
  // قاعدة محورية: صيغة MR من gliclazide تؤخذ مرّة يوميًا
  gliclazide_mr: {
    maxFreqPerDay: 1,
    cite: [
      "https://www.medicines.org.uk/emc/product/14497/smpc",
      "https://www.tga.gov.au/sites/default/files/auspar-gliclazide-160719.pdf",
      "https://www.geneesmiddeleninformatiebank.nl/pars/h102828.pdf"
    ],
    messageAr: "صيغة Diamicron MR (gliclazide MR) مخصّصة لجرعة مرّة واحدة يوميًا؛ كتابة 1×2 تُخالف دليل الصيغة المعدّلة الإطلاق."
  }
};

function normalizeSpaces(s){ return String(s||"").replace(/\s+/g,' ').trim(); }

function parseDoseFromLine(line) {
  const raw = normalizeSpaces(line);
  const lower = raw.toLowerCase();

  // جرعات على هيئة 1 × 2 × 90
  let qty=null, freq=null, days=null;
  const tri = lower.match(/(\d+)\s*[x×\*]\s*(\d+)\s*[x×\*]\s*(\d{1,3})/i);
  if (tri) { qty = +tri[1]; freq = +tri[2]; days = +tri[3]; }
  const bi  = lower.match(/(\d+)\s*[x×\*]\s*(\d+)/i);
  if (!freq && bi) { qty = +bi[1]; freq = +bi[2]; }

  // 1-0-1 نمط الوجبات
  const dash = lower.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
  if (!freq && dash) { freq = (+dash[1]>0) + (+dash[2]>0) + (+dash[3]>0); qty = 1; }

  // كلمات
  if (!freq){
    for (const f of FREQ_WORDS){ if (f.re.test(lower)) { freq = f.val; break; } }
  }

  // قوة الدواء mg (أول رقم قبل mg)
  const strength = (lower.match(/(\d+(?:\.\d+)?)\s*mg\b/) || [])[1];
  return {
    raw,
    qty: qty || null,
    freqPerDay: freq || null,
    days: days || null,
    strengthMg: strength ? +strength : null
  };
}

function detectBrand(line) {
  for (const b of BRAND_MAP){
    if (b.match.test(line)) return { key: b.key, display: b.display };
  }
  return { key: null, display: null };
}

function buildMedicationItemsFromLines(lines=[]) {
  const items = [];
  for (const ln of lines){
    const raw = normalizeSpaces(ln);
    if (!raw || raw === "[غير مقروء]") continue;
    // heuristic: نبحث عن سطور فيها mg أو أسماء علامات
    if (!/mg\b/i.test(raw) && !/tab|caps?|amp|mr|xr|sr|er|duodart|amlo|diam|metformin/i.test(raw)) continue;
    const dose = parseDoseFromLine(raw);
    const brand = detectBrand(raw);
    items.push({
      rawLine: raw,
      parsedDose: dose,
      brandKey: brand.key,
      displayName: brand.display || raw.replace(/\s{2,}/g,' '),
    });
  }
  return items;
}

function applyRules(items){
  const findings = [];
  for (const it of items){
    if (it.brandKey && RULES[it.brandKey]){
      const rule = RULES[it.brandKey];
      if (it.parsedDose.freqPerDay && it.parsedDose.freqPerDay > rule.maxFreqPerDay){
        findings.push({
          type: "frequency_mismatch",
          severity: "critical",
          brandKey: it.brandKey,
          written: it.rawLine, // كما كُتبت
          parsed: it.parsedDose,
          messageAr: rule.messageAr,
          citations: rule.cite
        });
      }
    }
  }
  // تكرار نفس الدواء بنفس اليوم
  const seen = new Map();
  for (const it of items){
    const key = (it.brandKey || it.displayName || '').toLowerCase().replace(/\s+/g,' ');
    if (seen.has(key)) findings.push({ type: "duplicate", severity: "warning", written: it.rawLine, other: seen.get(key) });
    else seen.set(key, it.rawLine);
  }
  return findings;
}

// ========== 7) تجميع بيانات سريرية (لـ GPT) من Gemini ==========
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "unnamed_file", mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }
  if (userParts.length === 0) userParts.push({ text: "No text or files to analyze." });

  const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every single piece of clinical information into a clean, comprehensive text block.
Rules:
- DO NOT summarize; transcribe.
- Keep dates, measurements, medication lines, and procedures verbatim.
- Produce chronological blocks per document/date.`;

  const body = { system_instruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: userParts }] };

  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
}

// ========== 8) تعليمات المدقق الخبير (GPT) ==========
function getExpertAuditorInstructions(lang = 'ar') {
  const schema = lang === 'ar'
    ? {
        patientSummary: { text: "ملخص تفصيلي للحالة." },
        overallAssessment: { text: "تقييم شامل للأخطاء والإيجابيات." },
        table: [
          {
            written: "string", // السطر كما كُتب
            parsedDose: "string", // تحويل قياسي مثل: 1 قرص مرتين/اليوم لمدة 90 يومًا
            name: "string",
            itemType: "lab|medication|procedure",
            status: "تم إجراؤه|مفقود ولكنه ضروري",
            analysisCategory: "صحيح ومبرر|إجراء مكرر|غير مبرر طبياً|إجراء يتعارض مع التشخيص|إغفال خطير",
            insuranceDecision: { label: "مقبول|مرفوض|لا ينطبق", justification: "string" }
          }
        ],
        recommendations: [ { priority: "عاجلة|أفضل ممارسة", description: "string", relatedItems: ["string"] } ]
      }
    : {
        patientSummary: { text: "Detailed case summary." },
        overallAssessment: { text: "Overall audit with errors and positives." },
        table: [
          {
            written: "string",
            parsedDose: "string",
            name: "string",
            itemType: "lab|medication|procedure",
            status: "Performed|Missing but Necessary",
            analysisCategory: "Correct and Justified|Duplicate Procedure|Not Medically Justified|Procedure Contradicts Diagnosis|Critical Omission",
            insuranceDecision: { label: "Accepted|Rejected|Not Applicable", justification: "string" }
          }
        ],
        recommendations: [ { priority: "Urgent|Best Practice", description: "string", relatedItems: ["string"] } ]
      };

  const langRule = lang === 'ar'
    ? "**قاعدة اللغة: أعد كل المخرجات بالعربية الفصحى الواضحة.**"
    : "**Language: Output must be in clear, professional English.**";

  return `
أنت مدقق طبي وصيدلي سريري يستند إلى الدلائل. حلّل الحالة بدقة، وادمج تلميحات OCR أدناه.
قواعد إلزامية:
1) أعرض "written" بالضبط كما في OCR، بلا أي تعديل أو ترجمة.
2) إذا وُجدت مخالفات صريحة من "hints.rules" (مثل Diamicron MR يُؤخذ مرّة/اليوم)، عدّها "إجراء يتعارض مع التشخيص/الدليل" ووضّح السبب.
3) لأي عنصر مكرر أظهر الظهور الثاني كـ"إجراء مكرر".
4) أدرج العناصر المفقودة الضرورية كـ"مفقود ولكنه ضروري" وقرار التأمين "لا ينطبق".

${langRule}
أجب فقط بـ JSON يطابق هذا المخطط:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`
`.trim();
}

// ========== 9) استدعاء OpenAI ==========
async function getAuditFromOpenAI(bundle, lang) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: getExpertAuditorInstructions(lang) },
        { role: "user", content: "Clinical Data for Audit:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

// ========== 10) Renderer HTML ==========
function renderHtmlReport(s, lang='ar'){
  const isArabic = lang === 'ar';
  const t = {
    summaryTitle: isArabic ? "ملخص الحالة والتقييم العام" : "Case Summary & Overall Assessment",
    detailsTitle: isArabic ? "التحليل التفصيلي" : "Detailed Analysis",
    recommendationsTitle: isArabic ? "التوصيات" : "Recommendations",
    colWritten: isArabic ? "المكتوب بالنص" : "Written (verbatim)",
    colParsed: isArabic ? "الجرعة المعيارية" : "Standardized Dose",
    colItem:    isArabic ? "العنصر" : "Item",
    colStatus:  isArabic ? "الحالة" : "Status",
    colDecision:isArabic ? "قرار التأمين" : "Insurance Decision",
    colJust:    isArabic ? "التبرير" : "Justification",
  };
  const decisionStyle = (label='')=>{
    const n = label.toLowerCase();
    if (n.includes('مقبول') || n.includes('accepted')) return 'background:#e6f4ea;color:#1e8e3e;';
    if (n.includes('مرفوض') || n.includes('rejected')) return 'background:#fce8e6;color:#d93025;';
    if (n.includes('لا ينطبق') || n.includes('not applicable')) return 'background:#e8eaed;color:#5f6368;';
    return 'background:#e8eaed;color:#3c4043;';
  };

  const rows = (s.table||[]).map(r=>`
    <tr>
      <td style="font-weight:700">${r.written||'-'}</td>
      <td>${r.parsedDose||'-'}</td>
      <td>${r.name||'-'}<div style="font-size:12px;color:#5f6368">${r.itemType||''} — ${r.analysisCategory||''}</div></td>
      <td>${r.status||'-'}</td>
      <td><span style="padding:6px 10px;border-radius:12px;border:1px solid #cbd5e1;${decisionStyle(r.insuranceDecision?.label)}">${r.insuranceDecision?.label||'-'}</span></td>
      <td>${r.insuranceDecision?.justification||'-'}</td>
    </tr>
  `).join('');

  return `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
    .report-section { border: 1px solid #dee2e6; border-radius: 12px; margin-bottom: 18px; padding: 18px; background:#fff; }
    .report-section h2 { font-size: 20px; font-weight:700; color:#0d47a1; border-bottom:2px solid #1a73e8; padding-bottom:8px; margin:0 0 12px }
    table { width:100%; border-collapse:collapse; }
    th, td { padding:10px; border-bottom:1px solid #eee; vertical-align:top; }
  </style>
  <div class="report-section">
    <h2>${t.summaryTitle}</h2>
    <p>${s.patientSummary?.text || ''}</p>
    <p>${s.overallAssessment?.text || ''}</p>
  </div>
  <div class="report-section">
    <h2>${t.detailsTitle}</h2>
    <table class="audit-table">
      <thead>
        <tr><th>${t.colWritten}</th><th>${t.colParsed}</th><th>${t.colItem}</th><th>${t.colStatus}</th><th>${t.colDecision}</th><th>${t.colJust}</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="report-section">
    <h2>${t.recommendationsTitle}</h2>
    <ul>${(s.recommendations||[]).map(r=>`<li><b>${r.priority}:</b> ${r.description}</li>`).join('')}</ul>
  </div>
  `;
}

// ========== 11) API Handler ==========
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed: Only POST is accepted.");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) return bad(res, 500, "Server Configuration Error: API Key is missing.");

    const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body || {};

    // Step A: OCR حرفي
    const ocr = await geminiOCRVerbatim({ text, files });
    const lines = (ocr?.files?.[0]?.lines || []).filter(Boolean);

    // Step B: استخراج عناصر الأدوية والجرعات كما كُتبت
    const meds = buildMedicationItemsFromLines(lines);
    const ruleFindings = applyRules(meds);

    // Step C: تجميع نص سريري عام ليتعامل معه GPT (يساعده على السياق)
    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });

    // سنرسل إلى GPT الحزمة التالية (تشمل "hints" ليسترشد بها):
    const auditBundle = {
      patientInfo,
      aggregatedClinicalText,
      verbatim: { lines, meds },
      hints: { rules: RULES, findings: ruleFindings }
    };

    // Step D: تدقيق GPT
    const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);

    // ضمان وجود "written" و "parsedDose" عند الحاجة: نُسقط من مدخلاتنا إذا نسيها النموذج
    const table = (structuredAudit.table || []).map(row => {
      const m = meds.find(mm => row.name && (row.name.toLowerCase().includes((mm.displayName||'').toLowerCase()) || row.name.toLowerCase().includes('gliclazide')));
      return {
        ...row,
        written: row.written || m?.rawLine || row.name,
        parsedDose: row.parsedDose || (m ? `${m.parsedDose.qty||'?'} قرص × ${m.parsedDose.freqPerDay||'?'} / اليوم${m.parsedDose.days?` لمدة ${m.parsedDose.days} يومًا`:''}` : '')
      };
    });

    // إدراج مخالفة صريحة إذا لم تُذكر
    for (const f of ruleFindings.filter(x=>x.type==='frequency_mismatch')){
      const exists = table.some(r => (r.written||'').includes(f.written));
      if (!exists){
        table.push({
          written: f.written,
          parsedDose: `${f.parsed.qty||'?'} قرص × ${f.parsed.freqPerDay||'?'} / اليوم`,
          name: "Diamicron MR (gliclazide MR) 30 mg",
          itemType: "medication",
          status: "تم إجراؤه",
          analysisCategory: "إجراء يتعارض مع التشخيص",
          insuranceDecision: {
            label: "مرفوض",
            justification: `${f.messageAr} — مراجع: ${f.citations.join(' , ')}`
          }
        });
      }
    }

    const finalStructured = { ...structuredAudit, table };

    // Step E: توليد HTML
    const htmlReport = renderHtmlReport(finalStructured, lang);

    return ok(res, { html: htmlReport, structured: finalStructured });

  } catch (err) {
    console.error(err);
    return bad(res, 500, `Internal error: ${err.message}`);
  }
}
