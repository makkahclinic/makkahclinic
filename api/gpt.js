// /api/gpt.js — Final backend matched to NEW front end
// - Reads: locale ("ar" | "en" | "bi"), notes, diagnosis, labResults, medications, packYears, files[] { name, type, data(Base64-no-prefix) }
// - Preserves strict medical/insurance instructions from your old version
// - Handles multiple files (images + PDFs), per-file analysis section
// - Adds maxOutputTokens to reduce truncation; retries; timeout; 20MB inline guard

const MAX_INLINE_REQUEST_MB = 19.0; // keep < ~20MB total inline payload
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;

// ===================== System Instruction (Arabic+English capable) =====================
const systemInstruction = `
You are the "Senior Medical & Insurance Claims Auditor" (clinician level).
Output exactly ONE valid HTML block (no CSS or <style>), using the requested language (see LOCALE below).
If LOCALE = "bi", output a complete Arabic report first, then a complete English report, separated by <hr>.

[LOCALE]
- LOCALE ∈ {"ar","en","bi"}; use Arabic RTL for "ar", English LTR for "en"; for "bi" include both sections fully.

[MANDATORY SCOPE]
1) Analyze ALL text fields AND EACH uploaded file (X-ray, MRI, MRA, CT, Ultrasound, prescription photo, clinic photo, PDFs). If text conflicts with an image, flag a critical note and state which source is more reliable and why.
2) Create a dedicated subsection for EVERY uploaded file under "Per-File Analysis", with findings, clinical implications, safety issues, and what documentation the payer needs.
3) Audit thoroughly:
   • Therapeutic duplication (esp. HTN/DM/anticoag/vertigo)
   • Dose errors (e.g., XR/MR prescribed > once daily)
   • High-risk meds safety & required labs (Metformin/Xigduo XR ⇠ eGFR; Allopurinol ⇠ eGFR + Uric Acid ± HLA-B*58:01; Warfarin ⇠ INR; ACEi/ARB/MRA ⇠ K+Cr)
   • Supporting diagnosis for every drug/procedure (state explicitly if missing)
   • 90-day supply red flags for acute issues
   • Fit to renal/hepatic function, current BP, age/geriatrics
   • Geriatric interactions (vertigo/sedatives ⇒ fall risk)
4) NEVER omit any drug/procedure found in text or images. If unknown, write "غير محدد" (Arabic) / "Unspecified" (English).

[HTML STRUCTURE — produce exactly these sections]
<h3>Medical Audit & Insurance Claims Report</h3>
<h4>Case Summary</h4>
<p>Summarize age/gender/smoking/pack-years/cough duration/visual symptoms/diagnoses/critical notes; include any text–image conflicts and assumptions.</p>

<h4>Per-File Analysis (Images/Scans/PDFs)</h4>
<!-- Create one subsection per file with clear heading and findings -->

<h4>Deep Clinical Analysis</h4>
<p>Explain major issues & tie them to the case (CKD/HTN/age/XR dosing...), and list required safety labs (eGFR/UA/K/Cr/INR...). If chronic cough + smoker, connect to CXR/LDCT rationale.</p>

<h4>Medications & Procedures Table</h4>
<table><thead><tr>
<th>Drug/Procedure</th>
<th>Prescribed Dose</th>
<th>Correct Suggested Dose</th>
<th>Class</th>
<th>Medical Purpose</th>
<th>Interactions</th>
<th>Risk Score (%)</th>
<th>Insurance Decision</th>
</tr></thead><tbody>
<!-- Fill ALL rows, no exceptions -->
</tbody></table>

<h4>Care Opportunities & Clinic Growth (Evidence-Based)</h4>
<ul>
<!-- Each item 1 line: Name — specific clinical reason — patient benefit — operational benefit — credible source + direct link -->
</ul>

<h4>Action Plan</h4>
<ol>
<!-- Immediate, precise corrections (dose fix, stop duplication, request eGFR/UA/K+Cr/INR, add supporting dx...), include specialty for referral when needed -->
</ol>

<p><strong>Conclusion:</strong> Preliminary analysis — not a substitute for specialty clinical review.</p>

[INSURANCE WORDING RULES]
- For every table row compute "Risk Score (0–100%)" and render a %.
- Apply <td> class by risk: risk-high (≥70), risk-medium (40–69), risk-low (<40).
- "Insurance Decision" must be exactly one of:
  • ❌ Deny — reason: [specific medical/procedural] — To approve: [dx/lab/dose fix/stop duplication/follow-up plan…] — Specialty: [name]
  • ⚠️ Review — reason: […] — To improve approval: […] — Specialty: [name]
  • ✅ Approve
- If a drug/procedure lacks a supporting diagnosis, state that explicitly within the decision.

[GUIDELINE SOURCES — cite links in the opportunities list]
• ADA Standards of Care (Diabetes): https://diabetesjournals.org/care
• FDA Metformin & Renal Impairment: https://www.fda.gov/drugs/
• KDIGO CKD Guideline: https://kdigo.org/guidelines/ckd-evaluation-and-management/
• ACR Appropriateness Criteria—Chronic Cough: https://acsearch.acr.org/list
• USPSTF Lung Cancer Screening: https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/lung-cancer-screening
• ACC/AHA Hypertension Guideline: https://www.ahajournals.org/journal/hyp
• ACR Gout Guideline: https://www.rheumatology.org/
• AAO Preferred Practice Patterns (Retina/OCT): https://www.aao.org/clinical-guidelines

[OUTPUT]
- Output a single valid HTML block only. Add % when missing and ensure correct risk <td class="risk-...">.
`;

// ===================== Build prompt from NEW front-end fields =====================
function buildUserPromptFromFront(body = {}) {
  const locale = (body.locale === 'ar' || body.locale === 'en' || body.locale === 'bi') ? body.locale : 'ar';

  // NEW front-end fields (always present/optional):
  // notes, diagnosis, labResults, medications, packYears, files[]: {name,type,data}
  // We also accept any legacy fields if the FE later adds them (age, gender, etc.)
  return `
LOCALE: ${locale}

Patient-entered (free text):
- Notes: ${body.notes ?? 'Unspecified'}
- Diagnoses: ${body.diagnosis ?? 'Unspecified'}
- Lab/Imaging available: ${body.labResults ?? 'Unspecified'}
- Medications/Procedures: ${body.medications ?? 'Unspecified'}

Smoking exposure:
- Pack-years: ${body.packYears ?? body.smokingPackYears ?? 'Unspecified'}

Legacy structured fields if provided:
- Age: ${body.age ?? 'Unspecified'}; Gender: ${body.gender ?? 'Unspecified'}
- Smoker: ${typeof body.isSmoker === 'boolean' ? (body.isSmoker ? 'Yes' : 'No') : 'Unspecified'}
- Cough duration (weeks): ${body.coughDurationWeeks ?? 'Unspecified'}
- Visual symptoms: ${body.visualSymptoms ?? 'Unspecified'}
- Last eye exam: ${body.lastEyeExamDate ?? 'Unspecified'}
- Visual acuity: ${body.visualAcuity ?? 'Unspecified'}
- Diabetes duration (years): ${body.diabetesDurationYears ?? 'Unspecified'}
- Hypertension duration (years): ${body.htnDurationYears ?? 'Unspecified'}

Uploaded files overview:
- Inline images/PDFs present: ${Array.isArray(body.files) && body.files.length > 0 ? body.files.length : 0}
(Generate a dedicated subsection for EVERY uploaded file.)
`;
}

// ===================== Helpers: size calc, post-process, fetch with retry =====================
const _encoder = new TextEncoder();
function byteLengthUtf8(str) { return _encoder.encode(str || '').length; }

function estimateInlineRequestMB(parts) {
  let bytes = 0;
  for (const p of parts) {
    if (p.text) bytes += byteLengthUtf8(p.text);
    if (p.inline_data?.data) {
      const len = p.inline_data.data.length;
      bytes += Math.floor((len * 3) / 4);
    }
  }
  return bytes / (1024 * 1024);
}

/** Ensure % suffix + risk td classes; trim any noise before first <h3> */
function applySafetyPostProcessing(html) {
  try {
    html = String(html || '');
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi,
      (_m, o, n, _s, c) => `${o}${n}%${c}`);
    html = html.replace(/(<td\b(?![^>]*class=)[^>]*>\s*)(\d{1,3})\s*%\s*(<\/td>)/gi,
      (_m, open, numStr, close) => {
        const v = parseInt(numStr, 10);
        const klass = v >= 70 ? 'risk-high' : v >= 40 ? 'risk-medium' : 'risk-low';
        return open.replace('<td', `<td class="${klass}"`) + `${numStr}%` + close;
      });
    const i = html.indexOf('<h3'); if (i > 0) html = html.slice(i);
    return html;
  } catch (e) {
    console.error('Post-processing failed:', e);
    return html;
  }
}

async function fetchWithRetry(url, options, { retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok && retries > 0 && RETRY_STATUS.has(res.status)) {
      await new Promise(r => setTimeout(r, (3 - retries) * 800));
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ===================== API Handler =====================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
    const apiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

    const body = req.body || {};
    const userPrompt = buildUserPromptFromFront(body);

    // Build parts: system instruction + user prompt
    const parts = [{ text: systemInstruction }, { text: userPrompt }];

    // Attach NEW FE "files[]" inline (images or PDFs). Use TRUE mime types; Base64 must be WITHOUT "data:*;base64,".
    if (Array.isArray(body.files)) {
      for (const f of body.files) {
        if (f && typeof f.data === 'string' && f.data.length > 0) {
          const mt = (typeof f.type === 'string' && f.type) ? f.type : 'application/octet-stream';
          parts.push({ inline_data: { mimeType: mt, data: f.data } });
        }
      }
    }

    // Guard total inline size to avoid 413
    const estMB = estimateInlineRequestMB(parts);
    if (estMB > MAX_INLINE_REQUEST_MB) {
      return res.status(413).json({
        error: 'الطلب كبير جدًا',
        detail: `الحجم المقدر ~${estMB.toFixed(2)}MB > ${MAX_INLINE_REQUEST_MB}MB (حد inline ~20MB). 
خفّض جودة/عدد الملفات أو ارفع عبر Files API ثم ارسل fileUri بدلاً من inline.`,
        docs: [
          'https://ai.google.dev/api/generate-content',
          'https://firebase.google.com/docs/ai-logic/analyze-images',
          'https://ai.google.dev/gemini-api/docs/document-processing'
        ]
      });
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192 // helps prevent truncation on long reports
      }
    };

    const response = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    if (!response.ok) {
      console.error('Gemini API Error:', response.status, response.statusText, text);
      if (response.status === 413 || /Request Entity Too Large|Content Too Large/i.test(text)) {
        return res.status(413).json({
          error: 'فشل الاتصال بـ Gemini API بسبب كِبر الحجم',
          detail: 'قلّل حجم الصور/الملفات أو استخدم Files API (fileUri).',
          docs: [
            'https://firebase.google.com/docs/ai-logic/analyze-images',
            'https://ai.google.dev/gemini-api/docs/document-processing'
          ]
        });
      }
      return res.status(response.status).json({
        error: 'فشل الاتصال بـ Gemini API',
        status: response.status,
        statusText: response.statusText,
        detail: text.slice(0, 2000)
      });
    }

    let result;
    try { result = JSON.parse(text); }
    catch {
      console.error('Non-JSON response from Gemini:', text.slice(0, 600));
      return res.status(502).json({ error: 'استجابة غير متوقعة من Gemini', detail: text.slice(0, 1200) });
    }

    // (Optional) check finishReason for diagnostics
    const finishReason = result?.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn('Gemini finishReason:', finishReason);
    }

    const rawHtml =
      result?.candidates?.[0]?.content?.parts?.[0]?.text ||
      '<p>⚠️ لم يتمكن النظام من إنشاء التقرير.</p>';

    const finalizedHtml = applySafetyPostProcessing(rawHtml);
    return res.status(200).json({ htmlReport: finalizedHtml });

  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({
      error: 'حدث خطأ في الخادم أثناء تحليل الحالة',
      detail: err.message,
      stack: err.stack
    });
  }
}
