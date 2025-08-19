// /pages/api/gpt.js
// Backend: Gemini Files (OCR/vision) → OpenAI JSON audit → HTML report
// Runtime: Next.js API Route (Vercel, Node 18+)

export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

// ===== Keys & endpoints =====
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL     = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// ===== Helpers =====
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function parseJsonSafe(r) {
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  try {
    return ct.includes("application/json") ? await r.json() : { raw: await r.text() };
  } catch {
    return { raw: await r.text().catch(()=> "") };
  }
}
const arr = (x) => (Array.isArray(x) ? x : (x ? [x] : []));
const has = (pattern, text) => new RegExp(pattern, "i").test(text || "");

// ===== Gemini: resumable upload (Files API) =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");

  // 1) start resumable session
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

  // 2) upload + finalize
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

// ===== Gemini: extract text from files + merge with user text =====
async function geminiSummarize({ text, files }) {
  const parts = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data || "").split("base64,").pop() || f?.data || "";
    if (!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({
      name: f?.name || "file",
      mimeType: mime,
      base64: b64,
    });
    parts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const systemPrompt =
    "أنت مساعد لاستخلاص سريري (OCR/vision). لخص محتوى الصور/PDF بنقاط موجزة ودقيقة بدون توصيات علاجية. أعِد نصًا عربيًا فقط.";

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: "user", parts: [{ text: (text || "لا يوجد نص حر.") }] },
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
  const out = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n") || "";
  return out;
}

// ===== Audit instructions for ChatGPT (JSON only) =====
function auditInstructions() {
  return `
أنت استشاري تدقيق طبي/تأميني. حلّل معطيات المريض + النص الحر + الخلاصة من OCR.
أخرج JSON فقط، وفق المخطط التالي. لا تضف أي نص خارج JSON. اعتمد أحدث المعايير (WHO/CDC/NIH/NHS) ومراجع الدواء (FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed).

{
  "patientSummary": {"ageYears": number|null, "gender": "ذكر"|"أنثى"|null,
    "pregnant": {"isPregnant": boolean, "gestationalWeeks": number|null}|null,
    "smoking": {"status": "مدخن"|"غير مدخن"|"سابق", "packYears": number|null}|null,
    "chronicConditions": string[]},
  "diagnosis": string[],
  "symptoms": string[],
  "contradictions": string[],
  "table": [
    {"name": string, "itemType": "lab"|"medication"|"procedure"|"device"|"imaging",
     "doseRegimen": string|null, "intendedIndication": string|null,
     "isIndicationDocumented": boolean,
     "conflicts": string[], "riskPercent": number,
     "insuranceDecision": {"label": "مقبول"|"قابل للمراجعة"|"قابل للرفض", "justification": string}}
  ],
  "missingActions": string[],
  "referrals": [{"specialty": string, "whatToDo": string[]}],
  "financialInsights": string[],
  "conclusion": string
}

إرشادات صياغة القرار:
- برّر القرار سريريًا بدقة (Indication/تعارض/توثيق).
- لا تضع نسب 0% إلا إذا كان مبررًا واضحًا. القيم <60 مقبول، 60–74 قابل للمراجعة، ≥75 قابل للرفض.
- إن ذُكر Dengue IgG فقط دون IgM/NS1 فاشرح أنه لا يثبت عدوى حادة.
- إن وُصف Normal Saline I.V دون علامات جفاف/هبوط ضغط فاشرح أنه غير مبرر.
ONLY JSON.`;
}

function needsRefine(s) {
  const rows = Array.isArray(s?.table) ? s.table : [];
  if (!rows.length) return true;
  const weak = rows.filter(r =>
    !Number.isFinite(r?.riskPercent) ||
    !r?.insuranceDecision?.justification ||
    String(r.insuranceDecision.justification).trim().length < 12
  ).length;
  return weak / (rows.length || 1) > 0.35;
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
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error("OpenAI error: " + JSON.stringify(data));
  const txt = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

// ===== Clinical guardrails (post-model) =====
function applyClinicalGuardrails(structured, ctx) {
  const s = structured || {};
  const ctxText = [ctx?.userText, ctx?.extractedSummary].filter(Boolean).join(" ");

  s.table = arr(s.table).map((r) => normalizeRow(r));
  s.contradictions = [...new Set(arr(s.contradictions))];
  s.missingActions = arr(s.missingActions);
  s.financialInsights = arr(s.financialInsights);

  // إذا ذُكر الضنك ولم نجد IgM/NS1
  if (has("\\bdengue\\b", ctxText) && !has("\\b(igm|ns\\s*-?1)\\b", ctxText)) {
    s.missingActions.push("طلب IgM/NS1 لتأكيد عدوى حمى الضنك إذا وُجد اشتباه سريري/وبائي.");
  }

  // لو ما في رؤى مالية، أضف افتراضيات مفيدة
  if (s.financialInsights.length === 0) {
    s.financialInsights.push(
      "تقليل الطلبات غير المبررة (IgG منفرد / سوائل بلا دليل) لخفض الرفض التأميني.",
      "توحيد قوالب توثيق المؤشّر السريري يرفع نسب الموافقة ويزيد إيراد العيادة."
    );
  }

  return s;

  function pushContra(msg) {
    if (!s.contradictions.includes(msg)) s.contradictions.push(msg);
  }

  function normalizeRow(r) {
    const name = String(r?.name || "").trim();
    const lower = name.toLowerCase();
    const documented = !!r?.isIndicationDocumented;

    let risk = Number.isFinite(r?.riskPercent) ? Number(r.riskPercent) : 55; // baseline
    let label = r?.insuranceDecision?.label || "قابل للمراجعة";
    let just  = String(r?.insuranceDecision?.justification || "").trim();

    // تشديد على غياب التوثيق
    if (!documented) {
      risk = Math.max(risk, 60);
      if (label === "مقبول") label = "قابل للمراجعة";
      if (!just) just = "غياب توثيق المؤشّر السريري؛ يلزم توثيق واضح للقبول التأميني.";
    }

    // Dengue IgG منفردًا
    if (/dengue/i.test(lower) && /igg/i.test(lower) && !has("\\b(igm|ns\\s*-?1)\\b", ctxText)) {
      risk = Math.max(risk, 80);
      label = "قابل للرفض";
      if (!just) just = "تحليل Dengue IgG لوحده لا يثبت عدوى حادة؛ التشخيص الحاد يحتاج IgM أو NS1 وسياق وبائي.";
      pushContra("طلب Dengue IgG منفردًا دون IgM/NS1.");
    }

    // Normal Saline / I.V infusion بلا جفاف/هبوط
    const isIVFluid = /\b(normal\s*saline|\bi\.?v\.?\s*infusion\b)/i.test(lower);
    const hasDehydration = has("جفاف|dehydrat", ctxText);
    const hasHypotension = has("هبوط\\s*ضغط|hypotens", ctxText);
    if (isIVFluid && !(hasDehydration || hasHypotension)) {
      risk = Math.max(risk, 80);
      label = "قابل للرفض";
      if (!just) just = "استخدام المحلول الوريدي غير مبرر بدون علامات جفاف/هبوط ضغط — خاصة مع HTN/DM/اعتلال كلوي.";
      pushContra("وصف محلول وريدي دون دليل على الجفاف/هبوط ضغط.");
    }

    // Nebulizer/Inhaler بلا أعراض تنفسية
    if (/nebulizer|inhal/i.test(lower) && !has("ضيق\\s*نفس|أزيز|wheez|o2|sat", ctxText)) {
      risk = Math.max(risk, 65);
      if (label === "مقبول") label = "قابل للمراجعة";
      if (!just) just = "يتطلب توثيق أعراض تنفسية (ضيق نفس/أزيز/تشبع O₂) لتبرير الإجراء.";
    }

    // مواءمة القرار مع العتبات
    if (risk >= 75) label = "قابل للرفض";
    else if (risk >= 60 && label === "مقبول") label = "قابل للمراجعة";

    return {
      ...r,
      riskPercent: Math.round(risk),
      insuranceDecision: { label, justification: just },
      conflicts: arr(r?.conflicts),
    };
  }
}

// ===== HTML rendering =====
function colorCell(p) {
  if (p >= 75) return 'style="background:#fee2e2;border:1px solid #fecaca"';   // أحمر
  if (p >= 60) return 'style="background:#fff7ed;border:1px solid #ffedd5"';   // أصفر
  return 'style="background:#ecfdf5;border:1px solid #d1fae5"';                // أخضر
}

function toHtml(s) {
  const contradictions = arr(s?.contradictions);
  const missing = arr(s?.missingActions);
  const fin = arr(s?.financialInsights);

  const rows = arr(s?.table).map(r => `
    <tr>
      <td>${r.name || "-"}</td>
      <td>${r.itemType || "-"}</td>
      <td>${r.doseRegimen || "-"}</td>
      <td>${r.intendedIndication || "-"}</td>
      <td>${r.isIndicationDocumented ? "نعم" : "لا"}</td>
      <td>${arr(r.conflicts).join("<br>") || "-"}</td>
      <td ${colorCell(r.riskPercent || 0)}><b>${Math.round(r.riskPercent || 0)}%</b></td>
      <td>${r.insuranceDecision?.label || "-"}</td>
      <td>${r.insuranceDecision?.justification || "-"}</td>
    </tr>
  `).join("");

  const contrHtml = contradictions.length
    ? `<ul>${contradictions.map(c => `<li>${c}</li>`).join("")}</ul>`
    : `<div class="muted">لا شيء بارز</div>`;

  const missingHtml = missing.length
    ? `<ul>${missing.map(m => `<li>${m}</li>`).join("")}</ul>`
    : `<div class="muted">—</div>`;

  const finHtml = fin.length
    ? `<ul>${fin.map(m => `<li>${m}</li>`).join("")}</ul>`
    : `<div class="muted">—</div>`;

  return `
  <div class="kvs" style="margin-bottom:12px; font-size:13px; color:#334155;">
    📎 التحليل موجّه بإرشادات WHO/CDC/NIH/NHS ومراجع الدواء (FDA/EMA/SFDA, Micromedex, Lexicomp, BNF, DailyMed).
  </div>

  <h2>📋 ملخص الحالة</h2>
  <div class="kvs"><p>${(s?.conclusion || "لا توجد معلومات كافية لتقديم تحليل دقيق أو قرارات تأمينية.").replace(/\n/g,'<br>')}</p></div>

  <h2>⚠️ التناقضات والأخطاء</h2>
  ${contrHtml}

  <h2>💊 جدول الأدوية والإجراءات</h2>
  <table dir="rtl" style="width:100%;border-collapse:collapse">
    <thead>
      <tr>
        <th>الاسم</th><th>التصنيف</th><th>الجرعة</th><th>المؤشّر</th>
        <th>موثّق؟</th><th>تعارضات</th><th>درجة الخطورة</th><th>قرار التأمين</th><th>التبرير</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>🩺 ما كان يجب القيام به</h2>
  ${missingHtml}

  <h2>📈 فرص تحسين الدخل والخدمة</h2>
  ${finHtml}
  `;
}

// ===== API Handler =====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "POST only");
    if (!OPENAI_API_KEY) return bad(res, 500, "Missing OPENAI_API_KEY");
    if (!GEMINI_API_KEY) return bad(res, 500, "Missing GEMINI_API_KEY");

    const { text = "", files = [], patientInfo = null } = req.body || {};

    const extracted = await geminiSummarize({ text, files });
    const bundle = { patientInfo, extractedSummary: extracted, userText: text };

    let structured = await chatgptJSON(bundle);
    if (needsRefine(structured)) {
      structured = await chatgptJSON(bundle, [
        {
          role: "user",
          content:
            "أعد التدقيق مع ملء النِّسَب والتبريرات الدقيقة لكل صف، واربط القرار بالسياق السريري (HTN/DM/جفاف/هبوط/تنفسي) وأبرز التعارضات.",
        },
      ]);
    }

    // Post-processing guardrails
    structured = applyClinicalGuardrails(structured, {
      userText: text,
      extractedSummary: extracted,
    });

    const html = toHtml(structured);
    return ok(res, { html, structured });
  } catch (err) {
    console.error("/api/gpt error:", err);
    return bad(res, 500, err?.message || String(err));
  }
}
