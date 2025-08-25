/**
 * خادم بسيط بـ Express يوفّر:
 *  - POST /api/gpt  : تجميع بيانات سريرية (Gemini) + تدقيق خبير (OpenAI) + HTML Report
 *  - POST /api/pdf  : توليد PDF من HTML باستخدام Puppeteer مع دعم العربية الكامل
 *  - GET  /api/health : فحص الصحة
 *
 * المتغيرات البيئية المطلوبة:
 *  - OPENAI_API_KEY
 *  - GEMINI_API_KEY
 *  - اختياري: CORS_ORIGIN (مثل https://www.m2020m.org)
 *
 * تشغيل:
 *   npm i express cors puppeteer
 *   node server.js
 */

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-pro-latest';

const GEMINI_FILES_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

const app = express();

// CORS آمن (نفس-الأصل افتراضيًا في Next/خوادم، لكن هنا نفعّله لأصل محدّد أو للجميع)
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: false }));
app.use(express.json({ limit: '50mb' })); // استقبال ملفات base64 كبيرة

// ===== أدوات مساعدة عامة =====
const ok = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function parseJsonSafe(response) {
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('application/json')) return response.json();
  return { raw: await response.text() };
}

// ===== رفع ملف base64 إلى Gemini =====
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const binaryData = Buffer.from(base64, 'base64');
  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(binaryData.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: name, mime_type: mimeType } }),
  });
  if (!initRes.ok) throw new Error(`Gemini init failed: ${JSON.stringify(await parseJsonSafe(initRes))}`);

  const sessionUrl = initRes.headers.get('X-Goog-Upload-URL');
  if (!sessionUrl) throw new Error('Gemini upload session URL is missing');

  const uploadRes = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': String(binaryData.byteLength),
    },
    body: binaryData,
  });

  const metadata = await parseJsonSafe(uploadRes);
  if (!uploadRes.ok) throw new Error(`Gemini finalize failed: ${JSON.stringify(metadata)}`);
  return { uri: metadata?.file?.uri, mime: metadata?.file?.mime_type || mimeType };
}

// ===== المرحلة 1: تجميع سريري شامل بواسطة Gemini (لا تلخيص) =====
async function aggregateClinicalDataWithGemini({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const file of files || []) {
    const mime = file?.mimeType || 'application/octet-stream';
    const base64Data = file?.data;
    if (!base64Data) continue;
    const { uri, mime: finalMime } = await geminiUploadBase64({
      name: file?.name || 'uploaded_file',
      mimeType: mime,
      base64: base64Data,
    });
    userParts.push({ file_data: { file_uri: uri, mime_type: finalMime } });
  }
  if (userParts.length === 0) userParts.push({ text: 'No text or files to analyze.' });

  const systemPrompt = `You are a meticulous medical data transcriptionist. Your ONLY job is to read all provided inputs (text, PDFs, images) and extract every piece of clinical information into a comprehensive text block.
CRITICAL RULES:
1) DO NOT SUMMARIZE — transcribe everything.
2) List ALL demographics, diagnoses, labs (with units), imaging, vitals, and every medication with exact dose/frequency/duration, on one line (e.g., "Amlodipine 10 mg — 1x1x90").
3) Preserve original language (Arabic or English) and numbers as written.
4) Structure output with sections.`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: userParts }],
  };
  const response = await fetch(GEMINI_GEN_URL(GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);
  const textOut = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p?.text || '')
    .join('\n')
    .trim();
  return textOut;
}

// ===== المرحلة 2: تعليمات المدقق الخبير لـ OpenAI =====
function getExpertAuditorInstructions(lang = 'ar') {
  return `You are an expert, evidence-based clinical pharmacist and medical auditor. Respond with a valid JSON object only.

Primary Guideline Sources (use for reasoning):
- ADA Standards of Care 2025 (retinopathy/neuropathy/foot care, preventive care).
- AHA/ACC 2021 Chest Pain guideline (risk stratification; ECG/troponin).
- KDIGO 2024 CKD guideline (eGFR, albuminuria follow-up).
- GOLD 2025 COPD pocket guide (diagnosis, spirometry, therapy).
- CDC 2025 Adult Immunization Schedule (vaccination by age/condition).
- Gliclazide MR (Diamicron MR) SmPC: once-daily modified-release dosing.

Mandatory Analysis Rules:
Rule 0 (MOST IMPORTANT): The final JSON "table" MUST include EVERY single item (medication/lab/procedure) detected. No omissions. For medications, fill "dosage_written" exactly as transcribed (e.g., "30 mg 1x2x90").
Rule 1: Clinical validity — flag dosing/frequency errors (e.g., Gliclazide MR prescribed bid); unjustified items; contraindications.
Rule 2: 90-day quantity review — if stability not documented or first-time prescription, set "الكمية تحتاج لمراجعة" with justification.
Rule 3: Omissions — add critical omissions expected by standards of care (e.g., ECG+Troponin for chest pain; fundus exam for T2DM; eGFR/ACR follow-up; spirometry for chronic cough/suspected COPD; adult vaccines as indicated).

Language rule: Output all texts in Modern Standard Arabic.

Schema (strict):
{
  "patientSummary": { "text": "..." },
  "overallAssessment": { "text": "..." },
  "table": [
    {
      "name": "string",
      "dosage_written": "string",
      "itemType": "lab|medication|procedure",
      "status": "تم إجراؤه|مفقود ولكنه ضروري",
      "analysisCategory": "صحيح ومبرر|إجراء مكرر|غير مبرر طبياً|إجراء يتعارض مع التشخيص|إغفال خطير|خطأ في الجرعة أو التكرار|الكمية تحتاج لمراجعة",
      "insuranceDecision": { "label": "مقبول|مرفوض|لا ينطبق", "justification": "string" }
    }
  ],
  "recommendations": [
    { "priority": "عاجلة|أفضل ممارسة", "description": "string", "relatedItems": ["string"] }
  ]
}`;
}

// ===== استدعاء OpenAI =====
async function getAuditFromOpenAI(bundle, lang) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: getExpertAuditorInstructions(lang) },
        { role: 'user', content: 'Clinical Data for Audit:\n' + JSON.stringify(bundle, null, 2) },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content || '{}');
}

// ===== renderer: HTML تقرير منظم وثابت الطباعة =====
function renderHtmlReport(structuredData, files, lang = 'ar') {
  const s = structuredData || {};
  const isArabic = lang === 'ar';
  const t = {
    src: isArabic ? 'المستندات المصدرية' : 'Source Documents',
    sum: isArabic ? 'ملخص الحالة والتقييم العام' : 'Case Summary & Overall Assessment',
    det: isArabic ? 'التحليل التفصيلي للإجراءات' : 'Detailed Analysis',
    rec: isArabic ? 'التوصيات والإجراءات المقترحة' : 'Recommendations',
    item: isArabic ? 'الإجراء' : 'Item',
    dose: isArabic ? 'الجرعة المكتوبة' : 'Written Dose',
    status: isArabic ? 'الحالة' : 'Status',
    decision: isArabic ? 'قرار التأمين' : 'Insurance Decision',
    just: isArabic ? 'التبرير' : 'Justification',
    na: isArabic ? 'غير متوفر.' : 'Not available.'
  };

  const getRowClass = (category='')=>{
    const c = category.toLowerCase();
    if (c.includes('إغفال') || c.includes('omission') || c.includes('يتعارض') || c.includes('contrad') || c.includes('خطأ')) return 'risk-critical';
    if (c.includes('مكرر') || c.includes('duplicate') || c.includes('غير مبرر') || c.includes('review')) return 'risk-warning';
    if (c.includes('صحيح') || c.includes('correct')) return 'risk-ok';
    return '';
  };

  const tableRows = (s.table||[]).map(r=>`
    <tr class="${getRowClass(r.analysisCategory)}">
      <td><div style="font-weight:700">${r.name||'-'}</div><small style="color:#5f6368">${r.analysisCategory||''}</small></td>
      <td style="font-family:monospace">${r.dosage_written||'-'}</td>
      <td>${r.status||'-'}</td>
      <td><b>${r.insuranceDecision?.label||'-'}</b></td>
      <td>${r.insuranceDecision?.justification||'-'}</td>
    </tr>`).join('');

  const sourceDocsHtml = (files || []).map(f=>{
    const isImg = (f.mimeType||'').startsWith('image/');
    const src = `data:${f.mimeType};base64,${f.data}`;
    const preview = isImg ? `<img src="${src}" alt="${f.name}" style="max-width:100%;height:auto;border:1px solid #eee;border-radius:8px">`
                          : `<div style="padding:14px;border:1px dashed #e5e7eb;border-radius:8px;color:#6b7280;text-align:center">${f.name}</div>`;
    return `<div style="page-break-inside:avoid"><h3 style="margin:8px 0">${f.name}</h3>${preview}</div>`;
  }).join('');

  return `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
    body { direction:${isArabic?'rtl':'ltr'}; font-family:'Tajawal',system-ui; color:#202124; -webkit-print-color-adjust:exact; }
    .section { border:1px solid #dee2e6; border-radius:12px; margin-bottom:24px; padding:24px; background:#fff; box-shadow:0 4px 6px rgba(0,0,0,.05); }
    h2 { font-size:22px; font-weight:700; color:#0d47a1; margin:0 0 16px; border-bottom:2px solid #1a73e8; padding-bottom:10px }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:14px }
    th,td { border-bottom:1px solid #edf2f7; padding:10px; vertical-align:top; text-align:${isArabic?'right':'left'}; word-wrap:break-word }
    th { background:#f8f9fa; font-weight:700 }
    tr.risk-critical td { background:#fce8e6 }
    tr.risk-warning td { background:#fff0e1 }
    tr.risk-ok td { background:#e6f4ea }
    @page { size:A4; margin:14mm }
  </style>
  <div class="section">
    <h2>${t.src}</h2>
    ${sourceDocsHtml || `<div>${t.na}</div>`}
  </div>
  <div class="section">
    <h2>${t.sum}</h2>
    <p>${s.patientSummary?.text || t.na}</p>
    <p>${s.overallAssessment?.text || t.na}</p>
  </div>
  <div class="section">
    <h2>${t.det}</h2>
    <table>
      <thead><tr><th style="width:28%">${t.item}</th><th style="width:15%">${t.dose}</th><th style="width:15%">${t.status}</th><th style="width:15%">${t.decision}</th><th style="width:27%">${t.just}</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>
  <div class="section">
    <h2>${t.rec}</h2>
    ${(s.recommendations||[]).map(rec=>`<div style="background:#f8f9fa;padding:12px;border-radius:8px;border-${isArabic?'right':'left'}:4px solid ${/عاجلة|urgent/i.test(rec.priority)?'#d93025':'#1e8e3e'};margin-bottom:10px">
      <b style="color:#fff;background:${/عاجلة|urgent/i.test(rec.priority)?'#d93025':'#1e8e3e'};padding:4px 10px;border-radius:6px">${rec.priority||''}</b>
      <div style="margin-top:6px">${rec.description||''}</div>
      ${rec.relatedItems?.length?`<div style="color:#5f6368;font-size:12px;margin-top:6px">مرتبط بـ: ${rec.relatedItems.join(', ')}</div>`:''}
    </div>`).join('')}
  </div>
  `;
}

// ====== مسارات API ======
app.get('/api/health', (req, res) => ok(res, { alive: true, ts: Date.now() }));

app.post('/api/gpt', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return bad(res, 500, 'Missing OPENAI_API_KEY');
    if (!GEMINI_API_KEY) return bad(res, 500, 'Missing GEMINI_API_KEY');

    const { text = '', files = [], patientInfo = null, lang = 'ar' } = req.body || {};

    const aggregatedClinicalText = await aggregateClinicalDataWithGemini({ text, files });

    const auditBundle = { patientInfo, aggregatedClinicalText, originalUserText: text };
    const structuredAudit = await getAuditFromOpenAI(auditBundle, lang);

    const htmlReport = renderHtmlReport(structuredAudit, files, lang);
    return ok(res, { html: htmlReport, structured: structuredAudit });
  } catch (err) {
    console.error('GPT API error:', err);
    return bad(res, 500, err.message || 'Internal error');
  }
});

// توليد PDF بخط عربي فعلي (بدون تكسّر الحروف)
app.post('/api/pdf', async (req, res) => {
  try {
    const { html = '', lang = 'ar' } = req.body || {};
    if (!html) return bad(res, 400, 'No html');

    const fullHtml = `<!doctype html>
<html lang="${lang}" dir="${lang==='ar'?'rtl':'ltr'}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet"/>
  <style>
    html,body{font-family:'Tajawal',system-ui; -webkit-print-color-adjust:exact; print-color-adjust:exact; background:#fff; margin:0}
    #wrap{width:794px; margin:0 auto}
    @page{size:A4; margin:14mm}
  </style>
</head>
<body><div id="wrap">${html}</div></body></html>`;

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox','--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('screen');

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,             // تضمين الخلفيات
      preferCSSPageSize: true,           // احترام @page
      margin: { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' }
    });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Medical_Audit_Report.pdf"');
    return res.status(200).send(pdf);
  } catch (err) {
    console.error('PDF API error:', err);
    return bad(res, 500, err.message || 'PDF generation failed');
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
