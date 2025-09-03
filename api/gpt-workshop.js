// --- START OF CMO GENIUS REPORT API (FULL) ---
// Next.js API Route: /pages/api/cmo-report.js (أو app/api/.../route.js مع تعديلات طفيفة)

/**
 * ميزات أساسية:
 * - Gemini Files + Structured Output (responseSchema/response_mime_type) لاستخراج JSON دقيق من ملفات الزيارة.
 * - Policy Engine: قواعد دليلية (NICE/IDSA/ADA/AAO...) لإصدار حكم تأميني (مقبول/حدّي/مرفوض) + أسباب مع روابط.
 * - تقدير أثر مالي عبر PRICE_MAP (ضع أسعارك المحلية).
 * - OpenAI: تحليل سريري/تأميني بلُغة عربية مع إلزام الاستشهاد بروابط.
 * - HTML ملوّن وجاهز للعرض + JSON منظّم للإدماج مع أي واجهة.
 * - fetch المدمج، مهلة/إعادة محاولة، سلامة HTML، وحماية السجلات من PHI.
 */

export const config = {
  api: {
    bodyParser: { sizeLimit: "50mb" }, // انتبه لحد 4MB (Next.js) و 4.5MB (Vercel)
  },
};

// --------- ENV / CONSTANTS ----------
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

// --------- UTILS ----------
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function parseJsonSafe(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { return await response.json(); } catch {}
  }
  return { raw: await response.text() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new Error("Timeout")), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}
async function fetchWithRetry(url, init = {}, { retries = 2, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const t = withTimeout(timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: t.signal });
      t.clear();
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        if (i === retries) return res;
        await sleep(500 * Math.pow(2, i));
        continue;
      }
      return res;
    } catch (e) {
      t.clear();
      lastErr = e;
      if (i === retries) throw e;
      await sleep(500 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --------- PRICING (ضع أسعارك الفعلية هنا) ----------
const PRICE_MAP = {
  // تشخيصات/فحوصات
  "RADT (Strep A)": 120,          // اختبار مستضد سريع للحلق
  "CRP": 90,
  "CBC": 80,
  "Urinalysis (UA)": 60,
  "KUB Ultrasound": 380,
  "CT KUB (low-dose)": 800,
  "ABPM (24h)": 250,
  "HBPM Monitor (loan)": 120,
  "ECG": 150,
  "H. pylori Stool Ag": 180,
  "Urea Breath Test": 300,
  "Vitamin D level": 160,
  "Allergy Panel (basic)": 450,
  "Physiotherapy Session": 200,

  // خدمات/أدوية شائعة الفوترة (أمثلة)
  "IV Antibiotic (OPD)": 250,
  "IM Antibiotic (OPD)": 200,
  "Antibiotic Rx (Oral)": 80,
  "NSAID Injection": 120,
  "Nebulization": 100,
};

// --------- POLICY ENGINE (قواعد دليلية + روابط) ----------
/**
 * كل قاعدة تحتوي:
 * id, title, triggers, checks, opportunities, citations
 * - triggers: مطابقة تشخيص/خدمة/أدوية بالنص المُستخرَج.
 * - checks: شروط قبول/رفض/حدّي (مفقود توثيق، استخدام غير مبرّر...).
 * - opportunities: خدمات/تحاليل مقترحة (زيادة دخل/جودة).
 * - citations: مصادر موثوقة (NICE/IDSA/ADA/AAO...)
 */
const RULES = [
  {
    id: "ng84_pharyngitis",
    title: "التهاب الحلق/اللوز الحاد (NICE NG84 + IDSA)",
    triggers: {
      anyDiagnosis: [/pharyngitis/i, /tonsillitis/i, /sore throat/i, /التهاب.*حلق/i, /التهاب.*لوز/i],
    },
    checks: [
      {
        id: "antibiotic_without_criteria",
        when: { anyMedication: [/amoxicillin/i, /augmentin/i, /penicillin/i, /azithro/i, /ceph/i, /antibiotic/i, /مضاد/i] },
        requireAnyMention: [/centor/i, /feverpain/i, /radt/i, /rapid.*strep/i, /اختبار.*عقدي/i],
        stanceIfMissing: "رفض مرتفع",
        reason:
          "صرف مضاد حيوي دون توثيق درجات Centor/FeverPAIN أو RADT يزيد خطر الرفض ويخالف استراتيجية ترشيد المضادات.",
      },
      {
        id: "no_antibiotic_ok",
        when: { anyDiagnosis: [/pharyngitis/i, /tonsillitis/i] },
        requireNoneMention: [/antibiotic/i, /مضاد/i],
        stanceIfMissing: "مقبول",
        reason: "الامتناع عن المضادات في معظم التهابات الحلق الفيروسية مقبول وموصى به.",
      },
    ],
    opportunities: [
      { name: "RADT (Strep A)", when: { mentionAny: [/sore throat/i, /tonsill/i, /pharyng/i] } },
      { name: "CRP", when: { mentionAny: [/cough/i, /bronch/i, /التهاب.*شعب/i] } },
      { name: "CBC", when: { mentionAny: [/fever/i, /حمى/i] } },
    ],
    citations: [
      { label: "NICE NG84", url: "https://www.nice.org.uk/guidance/ng84" },
      { label: "IDSA GAS Pharyngitis 2012", url: "https://www.idsociety.org/practice-guideline/streptococcal-pharyngitis/" },
    ],
  },
  {
    id: "ng120_cough",
    title: "السعال/التهاب الشعب الحاد (NICE NG120)",
    triggers: { anyDiagnosis: [/cough/i, /bronchitis/i, /acute bronchitis/i, /سعال/i, /التهاب.*شعب/i] },
    checks: [
      {
        id: "antibiotic_for_simple_cough",
        when: { anyMedication: [/antibiotic/i, /مضاد/i] },
        requireAnyMention: [/pneumonia/i, /sepsis/i, /COPD/i, /red flag/i, /X-?ray/i, /CRP/i],
        stanceIfMissing: "رفض مرتفع",
        reason: "مضاد حيوي لالتهاب قصبات/سعال غير مختلط غالبًا غير مبرّر ويرفع خطر الرفض.",
      },
    ],
    opportunities: [{ name: "CRP", when: { mentionAny: [/cough/i, /bronch/i, /سعال/i] } }],
    citations: [{ label: "NICE NG120", url: "https://www.nice.org.uk/guidance/ng120" }],
  },
  {
    id: "ng59_lbp",
    title: "ألم أسفل الظهر غير المعقّد (NICE NG59)",
    triggers: { anyDiagnosis: [/low back pain/i, /lumbago/i, /sciatica/i, /ألم.*أسفل.*ظهر/i] },
    checks: [
      {
        id: "imaging_without_red_flags",
        when: { anyService: [/lumbar.*x-?ray/i, /lumbar.*mri/i, /تصوير.*قطني/i] },
        requireAnyMention: [/red flag/i, /trauma/i, /cancer/i, /fever/i, /neurolog/i, /osteop/i],
        stanceIfMissing: "حدّي",
        reason: "تصوير الظهر الروتيني دون علامات حمراء غير موصى به وقد يُرفض.",
      },
    ],
    opportunities: [{ name: "Physiotherapy Session", when: { mentionAny: [/back/i, /ظهر/i] } }],
    citations: [{ label: "NICE NG59", url: "https://www.nice.org.uk/guidance/ng59" }],
  },
  {
    id: "ng118_renal_colic",
    title: "مغص كلوي/حصاة حالب (NICE NG118)",
    triggers: { anyDiagnosis: [/renal colic/i, /ureteric stone/i, /حصاة/i, /مغص.*كلوي/i] },
    checks: [
      {
        id: "no_imaging_within_24h",
        when: { anyDiagnosis: [/renal colic/i, /ureter/i] },
        requireAnyMention: [/ultrasound/i, /ct/i, /imaging/i, /سونار/i, /تصوير/i],
        stanceIfMissing: "حدّي",
        reason: "تقييم تصويري خلال 24 ساعة موصى به لزيادة الدقّة وتقليل المخاطر.",
      },
    ],
    opportunities: [
      { name: "KUB Ultrasound", when: { mentionAny: [/renal colic/i, /ureter/i, /مغص.*كلوي/i] } },
      { name: "Urinalysis (UA)", when: { mentionAny: [/renal/i, /ureter/i, /حصاة/i] } },
      { name: "NSAID Injection", when: { mentionAny: [/renal/i, /ureter/i, /حصاة/i] } },
    ],
    citations: [{ label: "NICE NG118", url: "https://www.nice.org.uk/guidance/ng118" }],
  },
  {
    id: "ng136_htn",
    title: "ارتفاع الضغط (NICE NG136)",
    triggers: { anyDiagnosis: [/hypertension/i, /htn/i, /ارتفاع.*ضغط/i] },
    checks: [
      {
        id: "confirm_bp",
        when: { anyDiagnosis: [/hypertension/i, /ارتفاع.*ضغط/i] },
        requireAnyMention: [/ABPM/i, /HBPM/i, /home blood/i, /24h/i],
        stanceIfMissing: "حدّي",
        reason: "تأكيد التشخيص بـ ABPM/HBPM عنصر أساسي في الإدارة الدقيقة.",
      },
    ],
    opportunities: [
      { name: "ABPM (24h)", when: { mentionAny: [/hypertension/i, /ضغط/i] } },
      { name: "ECG", when: { mentionAny: [/hypertension/i, /ضغط/i] } },
    ],
    citations: [{ label: "NICE NG136", url: "https://www.nice.org.uk/guidance/ng136" }],
  },
  {
    id: "cg184_hpylori",
    title: "عُسْر الهضم/H. pylori (NICE CG184 + QS96)",
    triggers: { anyDiagnosis: [/dyspepsia/i, /gastr/i, /h\.*\s*pylori/i, /جرثومة.*المعدة/i, /التهاب.*معدة/i] },
    checks: [
      {
        id: "ppi_washout",
        when: { anyService: [/h\.*\s*pylori/i, /stool ag/i, /urea breath/i, /تحليل.*البراز.*جرثومة/i, /اختبار.*اليوريا/i] },
        requireAnyMention: [/washout/i, /2 ?weeks/i, /stop.*ppi/i, /إيقاف.*PPI/i, /اسبوعين/i],
        stanceIfMissing: "حدّي",
        reason: "فترة إيقاف PPI أسبوعين قبل الاختبار مطلوبة لضمان دقة النتيجة.",
      },
    ],
    opportunities: [
      { name: "H. pylori Stool Ag", when: { mentionAny: [/dyspepsia/i, /جرثومة/i, /التهاب.*معدة/i] } },
      { name: "Urea Breath Test", when: { mentionAny: [/جرثومة/i, /h\.*\s*pylori/i] } },
    ],
    citations: [
      { label: "NICE CG184", url: "https://www.nice.org.uk/guidance/cg184" },
      { label: "NICE QS96 (washout 2w)", url: "https://www.nice.org.uk/guidance/qs96/chapter/quality-statement-3-testing-conditions-for-helicobacter-pylori" },
    ],
  },
  {
    id: "aao_dryeye",
    title: "جفاف العين (AAO PPP)",
    triggers: { anyDiagnosis: [/dry eye/i, /keratoconjunctivitis sicca/i, /جفاف.*عين/i] },
    checks: [],
    opportunities: [],
    citations: [{ label: "AAO PPP Dry Eye 2024", url: "https://www.aaojournal.org/article/S0161-6420%2824%2900012-5/pdf" }],
  },
];

// --------- GEMINI FILE UPLOAD ----------
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const base64Payload = base64.includes(",") ? base64.split(",")[1] : base64;
  const binaryData = Buffer.from(base64Payload, "base64");

  const initRes = await fetchWithRetry(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
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
  if (!initRes.ok) {
    const e = await parseJsonSafe(initRes);
    throw new Error(`Gemini init failed: ${JSON.stringify(e)}`);
  }
  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload session URL is missing");

  const uploadRes = await fetchWithRetry(sessionUrl, {
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

// --------- STAGE 1: Structured Extraction (Gemini) ----------
async function extractRichDataFromSingleFile(file) {
  if (!file?.data) return `Error processing ${file?.name || "unnamed"}: No data.`;

  const { uri, mime: finalMime } = await geminiUploadBase64({
    name: file.name,
    mimeType: file.mimeType,
    base64: file.data,
  });

  const userParts = [{ file_data: { file_uri: uri, mime_type: finalMime } }];

  const systemPrompt = `
أنت مُستخرِج بيانات طبي دقيق. أرجِع فقط JSON يطابق المخطط أدناه دون أي نص زائد.
إذا غاب حقل، استخدم "غير متوفر".
`.trim();

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
    generation_config: {
      response_mime_type: "application/json",
      response_schema: {
        type: "object",
        properties: {
          visitCard: {
            type: "object",
            properties: {
              sourceFile: { type: "string" },
              patientName: { type: "string" },
              visitDate: { type: "string" },
              doctor: { type: "string" },
              diagnoses: { type: "array", items: { type: "string" } },
              medsAndServices: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    item: { type: "string" },
                    code: { type: "string" },
                    wrongCode: { type: "boolean" },
                  },
                  required: ["item"],
                },
              },
              notes: { type: "string" },
            },
            required: ["patientName", "visitDate"],
          },
        },
        required: ["visitCard"],
      },
    },
  };

  const response = await fetchWithRetry(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini extraction error: ${JSON.stringify(data)}`);

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n");
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  if (!parsed?.visitCard) {
    return {
      rawMarkdown:
        `### Visit Card: ${escapeHtml(file.name)}\n- **Patient Name:** غير متوفر\n- **Date of Visit:** غير متوفر\n- **Diagnoses:**\n    - غير متوفر\n- **Medications & Services:**\n    - غير متوفر`,
      json: null,
    };
  }

  const vc = parsed.visitCard;
  vc.sourceFile = file.name;
  return { rawMarkdown: toVisitMarkdown(vc), json: vc };
}

function toVisitMarkdown(vc) {
  const diagLines =
    vc.diagnoses?.length ? vc.diagnoses.map((d) => `    - ${escapeHtml(d)}`).join("\n") : "    - غير متوفر";
  const medLines = vc.medsAndServices?.length
    ? vc.medsAndServices.map((m) => `    - ${escapeHtml(m.item)}${m.wrongCode ? " (WRONG CODE)" : ""}`).join("\n")
    : "    - غير متوفر";
  return [
    `### Visit Card: ${escapeHtml(vc.sourceFile || "")}`,
    `- **Patient Name:** ${escapeHtml(vc.patientName || "غير متوفر")}`,
    `- **Date of Visit:** ${escapeHtml(vc.visitDate || "غير متوفر")}`,
    vc.doctor ? `- **Doctor:** ${escapeHtml(vc.doctor)}` : null,
    `- **Diagnoses:**`,
    diagLines,
    `- **Medications & Services:**`,
    medLines,
    vc.notes ? `- **Notes:** ${escapeHtml(vc.notes)}` : null,
  ].filter(Boolean).join("\n");
}

// --------- POLICY ENGINE EVALUATION ----------
function textContainsAny(hay, regexList = []) {
  if (!hay) return false;
  return regexList.some((r) => new RegExp(r).test(hay));
}

function evaluateVisitAgainstRules(visit, priceMap = PRICE_MAP) {
  const fullText = [
    ...(visit.diagnoses || []),
    ...((visit.medsAndServices || []).map((m) => [m.item, m.code, m.wrongCode ? "WRONG CODE" : "" ]).flat()),
    visit.notes || "",
  ].join(" | ");

  let stance = "مقبول";
  const reasons = [];
  const codingErrors = [];
  const missedRevenue = [];

  for (const rule of RULES) {
    // triggers match?
    const trigger = rule.triggers || {};
    const diagMatch = trigger.anyDiagnosis ? textContainsAny((visit.diagnoses || []).join(" | "), trigger.anyDiagnosis) : false;
    const medMatch = trigger.anyMedication ? textContainsAny(fullText, trigger.anyMedication) : false;
    const trigOK = diagMatch || medMatch;
    if (!trigOK) continue;

    // checks
    for (const chk of rule.checks || []) {
      const whenOk =
        (!chk.when?.anyMedication || textContainsAny(fullText, chk.when.anyMedication)) &&
        (!chk.when?.anyService || textContainsAny(fullText, chk.when.anyService)) &&
        (!chk.when?.anyDiagnosis || textContainsAny((visit.diagnoses || []).join(" | "), chk.when.anyDiagnosis));

      if (!whenOk) continue;

      const hasRequiredAny =
        !chk.requireAnyMention || textContainsAny(fullText, chk.requireAnyMention);

      const hasForbiddenAny =
        chk.requireNoneMention && textContainsAny(fullText, chk.requireNoneMention);

      let violated = false;
      if (chk.requireAnyMention && !hasRequiredAny) violated = true;
      if (chk.requireNoneMention && hasForbiddenAny) violated = true;

      if (violated) {
        const s = chk.stanceIfMissing || "حدّي";
        stance = worseStance(stance, s);
        reasons.push({
          text: `${rule.title}: ${chk.reason}`,
          citations: rule.citations || [],
        });
      }
    }

    // opportunities
    for (const opp of rule.opportunities || []) {
      const oppOk = !opp.when?.mentionAny || textContainsAny(fullText, opp.when.mentionAny);
      if (!oppOk) continue;
      const price = priceMap[opp.name] || 0;
      missedRevenue.push({ name: opp.name, estimated: price, sourceRule: rule.title, citations: rule.citations || [] });
    }

    // coding errors (من النص نفسه)
    for (const m of visit.medsAndServices || []) {
      if (m.wrongCode) {
        codingErrors.push({ item: m.item, code: m.code || "", note: "WRONG CODE", citations: rule.citations || [] });
        stance = worseStance(stance, "رفض مرتفع");
      }
    }
  }

  const estMissed = missedRevenue.reduce((s, x) => s + (x.estimated || 0), 0);
  return { stance, reasons, missedRevenue, estMissed, codingErrors };
}

function worseStance(a, b) {
  const order = ["مقبول", "حدّي", "رفض مرتفع"];
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}

function stanceBadge(stance) {
  const color =
    stance === "مقبول" ? "#22c55e" : stance === "حدّي" ? "#f59e0b" : "#ef4444";
  return `<span style="background:${color};color:white;padding:2px 8px;border-radius:999px;font-weight:600">${stance}</span>`;
}

function sar(n) {
  const v = Number(n || 0);
  return isFinite(v) ? `${v.toFixed(0)} SAR` : "—";
}

// --------- STAGE 2A: Clinical Analysis (OpenAI) ----------
async function getClinicalAnalysis(fullExtractedText) {
  const systemPrompt = `
You are a Senior Clinical Physician. Produce a purely clinical, evidence-based analysis in Arabic.
After every clinical assertion or recommendation, add a short citation with a reputable link (e.g., NICE NG84/NG120/NG59/NG118/NG136, IDSA, ADA, AAO).`.trim();

  const response = await fetchWithRetry(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `سجل الزيارات:\n\n${fullExtractedText}` },
      ],
      max_tokens: 2000,
      temperature: 0.2,
    }),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`OpenAI Clinical Analysis error: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "لا يوجد تحليل سريري.";
}

// --------- STAGE 2B: Insurance/Admin Analysis (OpenAI) ----------
async function getInsuranceAnalysis(fullExtractedText) {
  const systemPrompt = `
You are a precise Insurance Auditor & Medical Biller. In Arabic, identify documentation gaps, missed revenue, coding errors, and prioritized admin recommendations.
Require guideline/payer-policy citations with links where relevant.`.trim();

  const response = await fetchWithRetry(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `سجل الزيارات:\n\n${fullExtractedText}` },
      ],
      max_tokens: 2000,
      temperature: 0.2,
    }),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`OpenAI Insurance Analysis error: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "لا يوجد تحليل إداري/تأميني.";
}

// --------- STAGE 3: Final Synthesis (Arabic) ----------
async function getFinalReport(clinicalAnalysis, insuranceAnalysis, patientName = "غير محدد") {
  const systemPrompt = `
أنت المدير الطبي التنفيذي (CMO). امزج التحليل السريري والتحليل التأميني في تقرير عربي احترافي واحد (Markdown)،
يتضمن: ملخص استشاري للحالة، تحليل سريري متعمق، تحليل إداري/تأميني، وتوصيات متكاملة للفريق الطبي والإداري.
أبقِ الروابط المرجعية ضمن النص حيثما لزم.`.trim();

  const response = await fetchWithRetry(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `**CLINICAL REPORT DRAFT:**\n${clinicalAnalysis}\n\n**INSURANCE REPORT DRAFT:**\n${insuranceAnalysis}\n\nالاسم: ${patientName}` },
      ],
      max_tokens: 4000,
      temperature: 0.2,
    }),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`OpenAI Final Synthesis error: ${JSON.stringify(data)}`);
  return data?.choices?.[0]?.message?.content || "تعذّر توليد التقرير النهائي.";
}

// --------- HTML TABLE BUILDER ----------
function buildColoredTable(evals = []) {
  const rows = evals.map((ev) => {
    const diagTxt = (ev.visit.diagnoses || []).join("<br/>") || "—";
    const medsTxt = (ev.visit.medsAndServices || []).map(m => escapeHtml(m.item) + (m.wrongCode ? " (WRONG CODE)" : "")).join("<br/>") || "—";
    const reasonsHtml = ev.reasons.map(r =>
      `${escapeHtml(r.text)} ` + (r.citations?.length ? r.citations.map(c => `(<a href="${c.url}" target="_blank">${escapeHtml(c.label)}</a>)`).join(" ") : "")
    ).join("<br/>") || "—";

    const missedHtml = ev.missedRevenue.length
      ? ev.missedRevenue.map(x => `${escapeHtml(x.name)} — <b>${sar(x.estimated)}</b> ${(x.citations||[]).map(c => `(<a href="${c.url}" target="_blank">${escapeHtml(c.label)}</a>)`).join(" ")}`).join("<br/>")
      : "—";

    const codingHtml = ev.codingErrors.length
      ? ev.codingErrors.map(c => `${escapeHtml(c.item)} ${c.code ? `(${escapeHtml(c.code)})` : ""} — <b>WRONG CODE</b>`).join("<br/>")
      : "—";

    return `
      <tr>
        <td>${escapeHtml(ev.visit.visitDate || "—")}</td>
        <td>${escapeHtml(ev.visit.doctor || "—")}</td>
        <td>${diagTxt}</td>
        <td>${medsTxt}</td>
        <td>${stanceBadge(ev.stance)}</td>
        <td>${reasonsHtml}</td>
        <td>${codingHtml}</td>
        <td><b>${sar(ev.estMissed)}</b><br/>${missedHtml}</td>
      </tr>
    `;
  }).join("");

  return `
  <div style="margin-top:16px;margin-bottom:8px;font-weight:700">جدول سياسات التأمين (حُكم كل زيارة، أسباب، وأثر مالي تقديري):</div>
  <div style="overflow:auto;border:1px solid #eee;border-radius:12px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb">التاريخ</th>
          <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb">الطبيب</th>
          <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb">التشخيص</th>
          <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb">الأدوية/الخدمات</th>
          <th style="text-align:center;padding:8px;border-bottom:1px solid #e5e7eb">موقف التأمين</th>
          <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb">الأسباب + مراجع</th>
          <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb">أخطاء الترميز</th>
          <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb">فرص/أثر مالي</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// --------- MAIN HANDLER ----------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed.");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) return bad(res, 500, "Server Configuration Error.");

    const { files = [], lang = "ar", priceMap } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) return bad(res, 400, "No files provided.");

    // Stage 1: extract all
    const extracted = await Promise.all(files.map((file) => extractRichDataFromSingleFile(file)));

    const visitJSON = extracted.map((x) => x.json).filter(Boolean);
    const visitMD = extracted.map((x) => (typeof x === "string" ? x : x.rawMarkdown)).join("\n\n---\n\n");
    const fullExtractedText = visitMD;

    // patient name (من أول بطاقة مع اسم)
    let patientName = "غير محدد";
    for (const v of visitJSON) {
      if (v?.patientName) { patientName = v.patientName.trim(); break; }
    }
    if (patientName === "غير محدد") {
      const m = fullExtractedText.match(/\*\*Patient Name:\*\*\s*(.+)\s*$/m);
      if (m?.[1]) patientName = m[1].trim();
    }

    // Stage: Policy Engine per visit
    const appliedPriceMap = { ...PRICE_MAP, ...(priceMap || {}) };
    const evals = visitJSON.map((visit) => {
      const ev = evaluateVisitAgainstRules(visit, appliedPriceMap);
      return { visit, ...ev };
    });

    // Aggregate
    const totals = {
      count: evals.length,
      accepted: evals.filter((e) => e.stance === "مقبول").length,
      borderline: evals.filter((e) => e.stance === "حدّي").length,
      rejected: evals.filter((e) => e.stance === "رفض مرتفع").length,
      estMissedTotal: evals.reduce((s, e) => s + e.estMissed, 0),
    };

    // Stage 2: AI analyses
    const [clinicalAnalysis, insuranceAnalysis] = await Promise.all([
      getClinicalAnalysis(fullExtractedText),
      getInsuranceAnalysis(fullExtractedText),
    ]);

    // Stage 3: final synthesis
    const finalNarrative = await getFinalReport(clinicalAnalysis, insuranceAnalysis, patientName);

    // Build HTML with colored table and executive financial box
    const tableHtml = buildColoredTable(evals);
    const executiveBox = `
      <div style="border:1px solid #ddd;border-radius:12px;padding:12px;background:#fcfcfc;margin-bottom:12px">
        <div style="font-weight:700;margin-bottom:6px">ملخص تنفيذي رقمي</div>
        <div>عدد الزيارات: <b>${totals.count}</b> — مقبول: <b>${totals.accepted}</b> | حدّي: <b>${totals.borderline}</b> | مرفوض مرتفع: <b>${totals.rejected}</b></div>
        <div>إجمالي الفرص المالية المقدّرة: <b style="color:#0ea5e9">${sar(totals.estMissedTotal)}</b></div>
      </div>
    `;

    const htmlReport =
      `<div style="white-space:pre-wrap;line-height:1.7;font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
         ${executiveBox}
         ${tableHtml}
         <hr style="margin:16px 0"/>
         ${escapeHtml(finalNarrative)}
         <hr style="margin:16px 0"/>
         <div style="font-size:12px;color:#64748b">
           <b>تنبيه:</b> هذا التقرير يدعم القرار ولا يستبدل الحكم السريري المباشر. تمت إحالة الأحكام الدليلية إلى مصادر علنية (NICE/IDSA/ADA/AAO).
         </div>
       </div>`;

    // حد الحجم (قبل 4MB/4.5MB)
    const approxBytes = Buffer.byteLength(htmlReport, "utf-8");
    let payload = {
      html: htmlReport,
      structured: {
        patientName,
        totals,
        visits: evals,
        extractedMarkdown: fullExtractedText,
        clinicalAnalysis,
        insuranceAnalysis,
      },
    };
    if (approxBytes > 3.8 * 1024 * 1024) {
      payload = {
        structured: {
          patientName,
          totals,
          snippet: finalNarrative.slice(0, 700000) + "\n\n[...truncated due to size...]",
        },
        note: "تم تقصير الاستجابة لتجنّب حدّ الحجم في Next.js/Vercel. ننصح بحفظ التقرير في تخزين خارجي وإرجاع رابط تنزيل.",
      };
    }

    return ok(res, payload);
  } catch (err) {
    console.error("CMO Genius Error:", err?.message); // لا تطبع محتوى طبي
    return bad(res, 500, `An internal server error occurred: ${err?.message}`);
  }
}
// --- END OF CMO GENIUS REPORT API (FULL) ---
