/* ========================= File: pages/api/gpt.js ========================= */
// تكبير الحجم المسموح به للطلب (ملفات وصور)
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (response) => (response.headers.get("content-type") || "").includes("application/json") ? response.json() : { raw: await response.text() };

/** رفع ملف (base64) إلى Gemini للحصول على URI */
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

/** المرحلة (1): استخلاص مُنظم شامل من النص/الملفات */
async function aggregateClinicalDataWithGeminiStructured({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const file of files || []) {
    const mime = file?.mimeType || "application/octet-stream";
    const base64Data = (file?.data || "").split("base64,").pop() || file?.data;
    if (!base64Data) continue;
    const { uri, mime: finalMime } = await geminiUploadBase64({ name: file?.name || "file", mimeType: mime, base64: base64Data });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }
  if (userParts.length === 0) userParts.push({ text: "No text or files provided." });

  const system = `You are a meticulous medical transcription + structuring engine.
Return ONLY valid JSON with this schema:

{
  "patient": { "name": "string|null", "ageYears": "number|null", "gender": "string|null", "pregnancy": {"isPregnant": "boolean|null", "gestationalWeeks": "number|null"}, "smoking": {"status":"string|null","packYears":"number|null"}, "vitals": {"temperatureC":"number|null","weightKg":"number|null","heightCm":"number|null"} },
  "diagnoses": ["string"],
  "symptoms": ["string"],
  "labs": [ { "name":"string","value":"string|null","unit":"string|null","date":"string|null","raw":"string" } ],
  "imaging": [ { "name":"string","result":"string","date":"string|null" } ],
  "medications": [ { "name":"string","form":"string|null","dose":"string|null","frequency":"string|null","duration":"string|null","quantity":"string|null","route":"string|null","indication":"string|null","raw":"string" } ],
  "procedures": [ { "name":"string","status":"ordered|done","date":"string|null","raw":"string" } ],
  "freeText": "string"
}

Rules:
- DO NOT summarize — transcribe ALL clinical items you see in text or images/PDFs.
- For every medication keep the exact written dose/frequency/duration in "raw" too.
- Languages may be Arabic/English; preserve original spelling in "raw".
`;

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: userParts }],
  };
  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);

  // Gemini sometimes returns text parts; try JSON parse
  const textOut = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "{}";
  try { return JSON.parse(textOut); } catch { return { freeText: textOut }; }
}

/** حزمة أدلة موثقة (تُستخدم كمرجع بداخل مخرجات GPT) */
const EVIDENCE_LIBRARY = [
  { id: "ADA2025_RET",  title: "ADA 2025 — Retinopathy, Neuropathy & Foot Care", url: "https://diabetesjournals.org/care/article/48/Supplement_1/S252/157552/12-Retinopathy-Neuropathy-and-Foot-Care-Standards" },
  { id: "ADA2025_CKD",  title: "ADA 2025 — Chronic Kidney Disease & Risk Mgmt",  url: "https://diabetesjournals.org/care/article/48/Supplement_1/S239/157554/11-Chronic-Kidney-Disease-and-Risk-Management" },
  { id: "ADA2025_CARD", title: "ADA 2025 — Cardiovascular Disease & Risk",       url: "https://diabetesjournals.org/care/article/48/Supplement_1/S207/157549/10-Cardiovascular-Disease-and-Risk-Management" },
  { id: "AHA_ACC_2021_CHESTPAIN", title: "AHA/ACC 2021 Chest Pain Guideline",     url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001029" },
  { id: "AHA_ACC_SLIDESET",       title: "AHA/ACC Chest Pain Guideline — Slide Set", url: "https://professional.heart.org/en/guidelines-statements/2021-ahaaccasechestsaemscctscmr-guideline-for-the-evaluation-and-diagnosis-ofcir0000000000001029" },
  { id: "KDIGO_2024", title: "KDIGO 2024 CKD Guideline", url: "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf" },
  { id: "GOLD_2025",  title: "GOLD 2025 COPD Pocket Guide", url: "https://goldcopd.org/2025-gold-report/" },
  { id: "CDC_ADULT_IMM_2025", title: "CDC 2025 Adult Immunization Schedule", url: "https://www.cdc.gov/vaccines/hcp/imz-schedules/adult-age.html" },
  { id: "DIAMICRON_MR_SPC", title: "Diamicron MR (Gliclazide MR) — SmPC", url: "https://myservier-me.com/wp-content/uploads/2023/05/Diamicron-MR-60mg-SmPC-Version-03.2020-LEBANON-IRAQ-JORDAN-SYRIA.pdf" }
];

/** تعليمات المدقق الخبير */
function getExpertAuditorInstructions(lang = 'ar') {
  const ruleLang = (lang === 'ar')
    ? "**قاعدة اللغة: يجب أن تكون جميع المخرجات بالعربية الفصحى المهنية.**"
    : "**Language: reply in professional, clear English.**";

  return `You are an expert, evidence-based clinical pharmacist/medical auditor.
Return ONLY a valid JSON object with this schema:

{
  "patientSummary": {"text": "string"},
  "overallAssessment": {"text": "string"},
  "table": [ { "name":"string", "dosage_written":"string|null", "itemType":"lab|medication|procedure", "status":"تم إجراؤه|مفقود ولكنه ضروري", "analysisCategory":"صحيح ومبرر|إجراء مكرر|غير مبرر طبياً|يتعارض مع التشخيص|إغفال خطير|خطأ في الجرعة أو التكرار|الكمية تحتاج لمراجعة", "insuranceDecision": { "label":"مقبول|مرفوض|لا ينطبق", "justification":"string" }, "guidelineRefs":["ID"] } ],
  "recommendations": [ { "priority":"عاجلة|أفضل ممارسة", "description":"string", "relatedItems":["string"], "citations":[{"id":"ID","quote":"string"}] } ],
  "citations": [ { "id":"ID","title":"string","url":"string" } ]
}

KNOWLEDGE PACK (use if applicable; cite by id in guidelineRefs/citations):
${EVIDENCE_LIBRARY.map(e => `- [${e.id}] ${e.title} — ${e.url}`).join('\n')}

MANDATORY RULES:
- Rule 0 (Exhaustive): Every lab, med, and procedure from the structured input MUST appear once in "table".
- For medications, put the EXACT written dose/frequency/duration in "dosage_written" (copy from source if present).
- Rule 1 (Dose/Contra): Flag dosing/frequency errors and contraindications (e.g., **Diamicron MR** intended as **once-daily** modified-release; BID suggests error). Use [DIAMICRON_MR_SPC].
- Rule 2 (90-day quantities): If 90-day supply without documented stability → "الكمية تحتاج لمراجعة" with justification.
- Rule 3 (Omissions/Standard of Care):
  * Suspected ACS/chest pain in risk profiles ⇒ ECG + high-sensitivity Troponin required. Cite AHA/ACC chest pain guideline.
  * Type 2 DM ⇒ retinal exam program (annual or per ADA 2025 retinopathy section). Cite ADA.
  * CKD/T2DM ⇒ SGLT2i when eGFR ≥20 mL/min/1.73m² unless contraindicated. Cite ADA CKD/KDIGO as appropriate.
  * COPD care items per GOLD when suggested by symptoms/history.
- Only use the above evidence IDs for citations; do not invent URLs.
${ruleLang}`;
}

/** استدعاء OpenAI لإنتاج التدقيق المبني على الأدلة */
async function getAuditFromOpenAI(bundle, lang) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: getExpertAuditorInstructions(lang) },
        { role: "user", content: "Structured Clinical Bundle:\n" + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

/** توليد HTML التقرير (يُعرض داخل الصفحة) */
function renderHtmlReport(structuredData, files, lang = 'ar') {
  const s = structuredData; const isAr = (lang==='ar');
  const T = (ar,en)=> isAr?ar:en;
  const header = T('تقرير تدقيق طبي قائم على الدليل','Evidence-Based Medical Audit Report');
  const detailsTitle = T('التحليل التفصيلي للإجراءات','Detailed Analysis of Procedures');
  const recTitle = T('التوصيات والإجراءات المقترحة','Recommendations & Proposed Actions');

  const rows = (s.table||[]).map(r => {
    const riskClass = (()=> {
      const t = (r.analysisCategory||'').toLowerCase();
      if (t.includes('إغفال') || t.includes('contradict') || t.includes('خطأ')) return 'risk-critical';
      if (t.includes('مكرر') || t.includes('غير مبرر') || t.includes('مراجعة')) return 'risk-warning';
      if (t.includes('صحيح')) return 'risk-ok';
      return '';
    })();
    const refs = (r.guidelineRefs||[]).map(id => `<code title="Ref ID">${id}</code>`).join(isAr?'، ':', ');
    return `<tr class="${riskClass}">
      <td><div style="font-weight:700">${r.name||'-'}</div><small>${r.analysisCategory||''}</small></td>
      <td>${r.dosage_written||'-'}</td>
      <td>${r.status||'-'}</td>
      <td><span class="decision-badge">${r.insuranceDecision?.label||'-'}</span></td>
      <td>${r.insuranceDecision?.justification||'-'} ${refs? `<div style="margin-top:6px; color:#0b4479">${T('مراجع:','Refs:')} ${refs}</div>`:''}</td>
    </tr>`;
  }).join('');

  const recs = (s.recommendations||[]).map(rec=>{
    const cits = (rec.citations||[]).map(c=>`[${c.id}]`).join(isAr?'، ':', ');
    return `<li style="margin-bottom:8px">
      <b>${T('الأولوية:','Priority:')} ${rec.priority||'-'}</b><br/>
      ${rec.description||''}
      ${rec.relatedItems?.length? `<div style="color:#64748b">${T('مرتبط بـ:','Related:')} ${rec.relatedItems.join(isAr?'، ':', ')}</div>`:''}
      ${cits? `<div style="color:#0b4479">${T('مراجع:','Refs:')} ${cits}</div>`:''}
    </li>`;
  }).join('');

  const bib = (s.citations||[]).map(ci => `<div> [${ci.id}] <a href="${ci.url}" target="_blank" rel="noopener">${ci.title}</a></div>`).join('');

  return `
    <section class="card avoid-break">
      <h2 style="margin-top:0">${header}</h2>
      <p>${s.patientSummary?.text || T('ملخص الحالة غير متوفر.','No case summary.')}</p>
      <p style="color:#0b4479">${s.overallAssessment?.text || ''}</p>
    </section>

    <section class="card avoid-break">
      <h2>${detailsTitle}</h2>
      <div style="overflow-x:auto">
        <table class="audit-table">
          <thead>
            <tr>
              <th style="width:28%">${T('الإجراء','Item')}</th>
              <th style="width:15%">${T('الجرعة المكتوبة','Written Dose')}</th>
              <th style="width:15%">${T('الحالة','Status')}</th>
              <th style="width:15%">${T('قرار التأمين','Insurance Decision')}</th>
              <th style="width:27%">${T('التبرير','Justification')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>

    <section class="card avoid-break">
      <h2>${recTitle}</h2>
      <ul style="margin:0; padding-${isAr?'right':'left'}:18px">${recs}</ul>
    </section>

    ${(s.citations||[]).length? `<section class="card avoid-break"><h2>${T('المراجع','References')}</h2>${bib}</section>`: '' }
  `;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Only POST is accepted.");
    if (!OPENAI_API_KEY || !GEMINI_API_KEY) return bad(res, 500, "Server configuration error: API keys missing.");

    const { text = "", files = [], patientInfo = null, lang = 'ar' } = req.body || {};
    const structuredSource = await aggregateClinicalDataWithGeminiStructured({ text, files });

    const auditBundle = { patientInfo, structuredSource, originalUserText: text };
    const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);

    // أضف مكتبة الأدلة إلى المخرجات لعرضها كمراجع في HTML
    const mergedCitations = (structuredAudit.citations && Array.isArray(structuredAudit.citations) && structuredAudit.citations.length)
      ? structuredAudit.citations
      : EVIDENCE_LIBRARY;

    const htmlReport = renderHtmlReport({ ...structuredAudit, citations: mergedCitations }, files, lang);
    return ok(res, { html: htmlReport, structured: { ...structuredAudit, citations: mergedCitations } });
  } catch (err) {
    console.error(err);
    return bad(res, 500, `Internal error: ${err.message}`);
  }
}


/* ========================= File: pages/api/pdf.js ========================= */
import puppeteer from "puppeteer";

export const config = { api: { bodyParser: { sizeLimit: "20mb" } } };

// جلب CSS خطوط Google ثم تحويل روابط woff2 إلى data: لتفادي CORS داخل Chromium headless
async function inlineGoogleFontsCSS(familyQueryList = []) {
  const cssPieces = [];
  for (const q of familyQueryList) {
    const cssRes = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(q)}&display=swap`);
    const css = await cssRes.text();
    // اجلب كل url(...) للخطوط وبدّلها ببيانات base64
    const urls = [...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map(m => m[1]);
    let inlined = css;
    for (const u of urls) {
      const f = await fetch(u);
      const buf = Buffer.from(await f.arrayBuffer());
      const b64 = `data:font/woff2;base64,${buf.toString('base64')}`;
      inlined = inlined.replaceAll(u, b64);
    }
    cssPieces.push(inlined);
  }
  return cssPieces.join('\n');
}

function wrapHtml(html, lang='ar') {
  const isAr = (lang==='ar');
  return `<!doctype html>
<html lang="${isAr?'ar':'en'}" dir="${isAr?'rtl':'ltr'}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  /* سيتم حقن CSS الخطوط هنا ديناميكياً */
  @page { size: A4; margin: 12mm; }
  html, body { height: 100%; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: 'Amiri','Tajawal',system-ui; }
  .avoid-break, table, tr, td, th { break-inside: avoid; page-break-inside: avoid; }
</style>
</head>
<body>${html}</body></html>`;
}

export default async function handler(req, res){
  try{
    if(req.method!=='POST') return res.status(405).end();
    const { html = "", lang = 'ar' } = req.body || {};
    if(!html) return res.status(400).json({ ok:false, error:"No html" });

    const fams = [
      // نستخدم خطين عربيين شائعين
      "Amiri:wght@400;700",
      "Tajawal:wght@400;700"
    ];
    const fontCss = await inlineGoogleFontsCSS(fams);
    const doc = wrapHtml(html, lang).replace("</style>", `${fontCss}\n</style>`);

    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox","--disable-setuid-sandbox",
        "--font-render-hinting=none" // يحسّن التباعد والكرننغ في headless
      ]
    });
    const page = await browser.newPage();
    await page.setContent(doc, { waitUntil: "networkidle0" });
    await page.emulateMediaType('screen');

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top:"12mm", right:"12mm", bottom:"14mm", left:"12mm" }
    });
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Medical_Audit_Report.pdf"`);
    return res.status(200).send(pdf);
  }catch(e){
    console.error(e);
    return res.status(500).json({ ok:false, error: e.message });
  }
}
