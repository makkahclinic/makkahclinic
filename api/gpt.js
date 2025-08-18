// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → ChatGPT clinical audit (JSON) → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)
// المتطلبات البيئية: OPENAI_API_KEY , GEMINI_API_KEY  (+ اختيارياً OPENAI_MODEL, GEMINI_MODEL)

export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

// ===== مفاتيح ونقاط نهاية =====
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// ===== أدوات مساعدة =====
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (r) =>
  (r.headers.get("content-type") || "").includes("application/json")
    ? r.json()
    : { raw: await r.text() };

// ===== Evidence Pack (guideline snippets for the model) =====
// لا يوجد منطق if/else في السيرفر؛ الأدلة تُغذّى للنموذج ليتخذ القرار ويُبرّره.
const EVIDENCE_PACK = `
[مختصر أدلة تشخيص حمى الضنك]
• للتأكيد في المرحلة المبكرة: NAAT/RT-PCR أو مستضد NS1. 
• IgM يدل على عدوى حديثة؛ بينما IgG قد تبقى لأشهر/سنوات وتدل غالبًا على تعرض سابق؛ لذلك "IgG لوحدها" ليست كافية لتشخيص عدوى حادة.
• تُفسر النتائج مع الأعراض والسياق الوبائي، مع الانتباه للتداخل المصلي مع فيروسات فلافية أخرى.

[مراجع موجزة]
- WHO (Laboratory testing for dengue virus): NS1/NAAT للحالات المبكرة؛ IgM للحديث؛ IgG وحده ليس دليلًا على عدوى حادة.
- CDC (Dengue/Zika testing): إيجابية NAAT أو IgM تُعد دليلًا كافيًا على عدوى الضنك.
- Medscape (Dengue Workup): “single-specimen IgG is not recommended for diagnosing acute dengue”.
`;

// ===== Gemini: رفع ملف Base64 باستخدام جلسة Resumable (Files API) =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");

  // 1) بدء جلسة رفع
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
  if (!initRes.ok) {
    throw new Error("Gemini init failed: " + JSON.stringify(await parseJsonSafe(initRes)));
  }
  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) throw new Error("Gemini upload URL missing");

  // 2) رفع + إنهاء
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
  if (!upRes.ok) {
    throw new Error("Gemini finalize failed: " + JSON.stringify(meta));
  }
  return { uri: meta?.file?.uri, mime: meta?.file?.mime_type || mimeType };
}

// ===== Gemini: استخلاص نص من الملفات + ضمّه مع نص المستخدم =====
async function geminiSummarize({ text, files }) {
  const parts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data || "").split("base64,").pop() || f?.data; // نتوقع base64 صِرف
    if (!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: mime,
      base64: b64,
    });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt = `
أنت مساعد لاستخلاص سريري دقيق.
- استخرج من الصور/PDF نصوص الطلبات والتشخيصات والأدوية والجرعات والاختصارات المخبرية كما هي
  (مثل: "Dengue Ab IgG", "Dengue IgM", "NS1", "CRP", "CBC", "Normal Saline IV", "Pantozol 40 mg IV", "Primperan 10 mg IV").
- اذكر التكرارات إن وُجدت، وحافظ على التهجيّة كما وردت.
- لا تقدّم علاجًا؛ فقط لخّص الموجود نصيًا بدقّة.
`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: "user", parts: [{ text: text || "لا يوجد نص حر." }] },
      ...(parts.length ? [{ role: "user", parts }] : []),
    ],
  };

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(resp);
  if (!resp.ok) throw new Error("Gemini generateContent error: " + JSON.stringify(data));
  const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
  return out;
}

// ===== تعليمات التدقيق (ChatGPT) مع Evidence Pack =====
function auditInstructions() {
  return `
أنت استشاري تدقيق طبي وتأميني. قيِّم الطلبات بناءً على معطيات المريض + النص الحر + الخلاصة المستخرجة (OCR).
استخدم الأدلة التالية بحزم عند إصدار الحكم:
${EVIDENCE_PACK}

أخرج JSON فقط (بدون أي نص خارجه) وفق المخطط الآتي:
{
  "patientSummary": {"ageYears": number|null, "gender": "ذكر"|"أنثى"|null,
    "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null,
    "smoking": {"status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null,
    "chronicConditions": string[]},
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
      "insuranceDecision": {
        "label": "مقبول"|"قابل للرفض"|"مرفوض",
        "justification": string
      },
      "citations": string[] // اختياري: أسماء مصادر الدليل (WHO/CDC/Medscape) عند الحاجة
    }
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}

قواعد تطبيق الدليل (إرشادية وليست منطقًا برمجيًا):
- ظهور "Dengue IgG" فقط بلا أعراض/سياق قوي ولم يُذكر IgM/NS1 → غالبًا "قابل للرفض" أو "مرفوض"، واذكر تعليلًا: "IgG لا يثبت عدوى حادة؛ يُنصح بطلب IgM/NS1 عند الاشتباه".
- وجود "Dengue IgM" أو "NS1" مع أعراض متوافقة → يمكن اعتباره "مقبول" مع تبرير واضح.
- امنع riskPercent=0 إلا لو كان الإجراء روتينيًا منخفض الخطورة وموثّقًا بوضوح.
- املأ insuranceDecision.justification بجملة مفصّلة (≥ سطر واحد) تربط الحكم بالأدلة والسياق.
ONLY JSON.
`;
}

function needsRefine(s) {
  const rows = Array.isArray(s?.table) ? s.table : [];
  if (!rows.length) return true;
  const zero = rows.filter((r) => !Number.isFinite(r?.riskPercent) || r.riskPercent === 0).length;
  const weak = rows.filter((r) => !r?.insuranceDecision?.justification || r.insuranceDecision.justification.trim().length < 20).length;
  return zero / rows.length > 0.4 || weak / rows.length > 0.4;
}

async function chatgptJSON(bundle, extra = []) {
  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: auditInstructions() },
        { role: "user", content: "المعطيات:\n" + JSON.stringify(bundle, null, 2) },
        ...extra,
      ],
      response_format: { type: "json_object" },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error("OpenAI error: " + JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

// ===== تحويل JSON → HTML (مع تلوين المخاطر) =====
function colorCell(p) {
  if (p >= 75) return 'style="background:#fee2e2;border:1px solid #fecaca"';
  if (p >= 60) return 'style="background:#fff7ed;border:1px solid #ffedd5"';
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';
}

function toHtml(s) {
  const rows = (s.table || [])
    .map(
      (r) => `<tr>
        <td>${r.name || "-"}</td>
        <td>${r.itemType || "-"}</td>
        <td>${r.doseRegimen || "-"}</td>
        <td>${r.intendedIndication || "-"}</td>
        <td>${r.isIndicationDocumented ? "نعم" : "لا"}</td>
        <td>${(r.conflicts || []).join("<br>") || "-"}</td>
        <td ${colorCell(r.riskPercent || 0)}><b>${Math.round(r.riskPercent || 0)}%</b></td>
        <td>${r.insuranceDecision?.label || "-"}</td>
        <td>${r.insuranceDecision?.justification || "-"}</td>
      </tr>`
    )
    .join("");

  const contradictions =
    (s.contradictions || []).map((c) => `<li>${c}</li>`).join("") || "<li>لا شيء بارز</li>";

  const miss =
    (s.missingActions || []).map((m) => `<li>${m}</li>`).join("") || "";

  const refs =
    (s.referrals || [])
      .map(
        (r) =>
          `<li><b>${r.specialty}</b>: ${(r.whatToDo || []).join("، ")}</li>`
      )
      .join("") || "";

  return `
  <!-- شارة الدليل داخل التقرير (غير البانر العام في الواجهة) -->
  <div style="margin:4px 0 12px; padding:10px 12px; background:#eef6ff; border:1px solid #bfdbfe; border-radius:10px; color:#0b4479; font-size:13px">
    تم توليد الحكم بالاستناد إلى أدلة موجزة من: <b>WHO</b>، <b>CDC</b>، <b>Medscape</b> — مع تبريرات ظاهرة في جدول القرار.
  </div>

  <h2>ملخص الحالة</h2>
  <div class="kvs"><p>${(s.conclusion || "").replace(/\n/g, "<br>")}</p></div>

  <h2>التناقضات</h2>
  <ul>${contradictions}</ul>

  <h2>جدول الأدوية والإجراءات</h2>
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

  ${
    miss
      ? `<h2>ما كان يجب عمله</h2><ul>${miss}</ul>`
      : ""
  }
  ${
    refs
      ? `<h2>إحالات مقترحة</h2><ul>${refs}</ul>`
      : ""
  }
  `;
}

// ===== المعالج الرئيسي =====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "POST only");
    if (!OPENAI_API_KEY) return bad(res, 500, "Missing OPENAI_API_KEY");
    if (!GEMINI_API_KEY) return bad(res, 500, "Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body || {};

    const extracted = await geminiSummarize({ text, files });
    const bundle = {
      patientInfo,
      extractedSummary: extracted,
      userText: text,
      evidenceNotice: "Apply WHO/CDC/Medscape guidance per Evidence Pack.",
    };

    let structured = await chatgptJSON(bundle);

    // إعادة تدقيق قائمة على الدليل إذا وُجدت نسب صفرية كثيرة أو مبررات ضعيفة
    if (needsRefine(structured)) {
      structured = await chatgptJSON(bundle, [
        {
          role: "user",
          content:
            "أعد التدقيق الصارم بالاستناد إلى Evidence Pack. رجاءً عدّل riskPercent إلى قيم ذات معنى، " +
            "واكتب تبريرًا واضحًا لكل صف، وأبرز التكرارات والتعارضات. تذكير: Dengue IgG لوحده لا يثبت عدوى حادة؛ يوصى بـ IgM/NS1 عند الاشتباه.",
        },
      ]);
    }

    const html = toHtml(structured);
    return ok(res, { html, structured });
  } catch (err) {
    console.error("/api/gpt error:", err);
    return bad(res, 500, err?.message || String(err));
  }
}
