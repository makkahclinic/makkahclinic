// /api/gpt.js — Final integrated backend (bilingual, multi-file, evidence, inline+Files API, 413 guard, retries)
const MAX_INLINE_REQUEST_MB = 19.0; // safety margin below ~20MB inline limit
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;

// ===================== System Instruction (bilingual, strict, single HTML block) =====================
const systemInstruction = `
You are the "Senior Medical & Insurance Claims Auditor" (clinician level).
Output exactly ONE valid HTML block (no CSS, no <style>), in the language requested by the user (see LOCALE below). 
If LOCALE = "bi", output Arabic section first, then English section, separated by a clear <hr>.

[LOCALE & OUTPUT RULES]
- LOCALE will be one of: "ar" (Arabic RTL), "en" (English LTR), or "bi" (both).
- Match the requested LOCALE for all headings, paragraphs, table headers/cells, and conclusions.
- For "bi": produce a complete Arabic report followed by a complete English report (not a summary).

[MANDATORY SCOPE]
1) Analyze ALL textual data AND ALL uploaded files. If any text contradicts an image, flag it as a critical note and state which source is more reliable and why.
2) For EACH FILE (X-ray, MRI, MRA, CT, Ultrasound, prescription photo, clinic photo, or any image):
   - Create a dedicated subsection describing findings, clinical implications, safety issues, and what documentation is needed for payer approval.
3) Audit thoroughly:
   • Therapeutic duplication (esp. HTN/DM/anticoag/vertigo drugs)
   • Dose errors (e.g., XR/MR given > once daily)
   • High-risk meds safety with required labs (Metformin/Xigduo XR ⇠ eGFR; Allopurinol ⇠ eGFR + Uric Acid ± HLA-B*58:01; Warfarin ⇠ INR; ACEi/ARB/MRA ⇠ K+Cr)
   • Supporting diagnosis for every drug/procedure (if lacking, say so explicitly)
   • 90-day supply red flags for acute conditions
   • Fit to renal/hepatic function, current BP, age/geriatrics
   • Geriatric interactions (vertigo/sedatives ⇒ fall risk)
4) NEVER omit any drug/procedure found in text or images; if unknown, write "غير محدد" (Arabic) or "Unspecified" (English).

[HTML STRUCTURE — produce exactly these sections]
<h3>Medical Audit & Insurance Claims Report</h3>
<h4>Case Summary</h4>
<p>Summarize age/gender/smoking/pack-years/cough duration/visual symptoms/diagnoses/critical notes (including any text-vs-image conflicts and assumptions).</p>

<h4>Per-File Analysis (Images/Scans)</h4>
<!-- Create one subsection per file with clear heading and findings -->

<h4>Deep Clinical Analysis</h4>
<p>Explain major issues & tie them to the case context (CKD/HTN/age/XR dosing...), and list required safety labs (eGFR/UA/K/Cr/INR...). If chronic cough + smoking, connect to CXR/LDCT rationale.</p>

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
<!-- Each item 1 line: Name — specific clinical reason (age/symptom/disease/med) — patient benefit — operational benefit — credible source + direct link -->
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

[GUIDELINE SOURCES — cite in the opportunities list (use latest you know)]
• ADA Standards of Care (Diabetes): https://diabetesjournals.org/care
• FDA Metformin & Renal Impairment: https://www.fda.gov/drugs/
• KDIGO CKD Guideline: https://kdigo.org/guidelines/ckd-evaluation-and-management/
• ACR Appropriateness Criteria—Chronic Cough: https://acsearch.acr.org/list
• USPSTF Lung Cancer Screening: https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/lung-cancer-screening
• ACC/AHA Hypertension Guideline: https://www.ahajournals.org/journal/hyp
• ACR Gout Guideline: https://www.rheumatology.org/
• AAO Preferred Practice Patterns (Retina/OCT): https://www.aao.org/clinical-guidelines

[OUTPUT]
- Output one valid HTML block only.
- Add % sign if the model forgot it, and ensure correct <td class="risk-..."> according to the numeric %.

`;

// ===================== Prompt Builder (locale-aware text wrappers) =====================
function buildUserPrompt(caseData = {}) {
  // We pass LOCALE value explicitly and also mirror key facts to keep the model on track
  const locale = caseData.locale === 'ar' || caseData.locale === 'bi' ? caseData.locale : 'en';
  return `
LOCALE: ${locale}

Patient-entered data:
- Age: ${caseData.age ?? 'Unspecified'}
- Gender: ${caseData.gender ?? 'Unspecified'}
- Smoker: ${caseData.isSmoker === true ? 'Yes' : caseData.isSmoker === false ? 'No' : 'Unspecified'}
- Pack-years: ${caseData.smokingPackYears ?? 'Unspecified'}
- Cough duration (weeks): ${caseData.coughDurationWeeks ?? 'Unspecified'}
- Visual symptoms: ${caseData.visualSymptoms ?? 'Unspecified'}
- Last eye exam date: ${caseData.lastEyeExamDate ?? 'Unspecified'}
- Visual acuity: ${caseData.visualAcuity ?? 'Unspecified'}
- Diabetes duration (years): ${caseData.diabetesDurationYears ?? 'Unspecified'}
- Hypertension duration (years): ${caseData.htnDurationYears ?? 'Unspecified'}
- Diagnoses: ${caseData.diagnosis ?? 'Unspecified'}
- Meds/Procedures written: ${caseData.medications ?? 'Unspecified'}
- Notes: ${caseData.notes ?? 'Unspecified'}

Labs (optional):
- eGFR: ${caseData.eGFR ?? 'Unspecified'}
- HbA1c: ${caseData.hba1c ?? 'Unspecified'}
- Potassium: ${caseData.k ?? 'Unspecified'}
- Creatinine: ${caseData.cr ?? 'Unspecified'}
- Uric Acid: ${caseData.ua ?? 'Unspecified'}
- INR: ${caseData.inr ?? 'Unspecified'}

Uploaded files:
- ${Array.isArray(caseData.imagesInline) && caseData.imagesInline.length > 0 ? 'There are inline images to analyze (create a dedicated subsection per file).' : 'No inline images.'}
- ${Array.isArray(caseData.fileUris) && caseData.fileUris.length > 0 ? 'There are file URIs (Files API) to analyze; include them like any image with a dedicated subsection.' : 'No Files API URIs.'}
`;
}

// ===================== Helpers: size calc, post-process, fetch with retry =====================
const _encoder = new TextEncoder();
function byteLengthUtf8(str) { return _encoder.encode(str || '').length; }

// Estimate total inline payload size in MB (Base64 overhead ~33%)
function estimateInlineRequestMB(parts) {
  let bytes = 0;
  for (const p of parts) {
    if (p.text) bytes += byteLengthUtf8(p.text);
    if (p.inline_data?.data) {
      const len = p.inline_data.data.length; // Base64 length
      bytes += Math.floor((len * 3) / 4);    // estimated real bytes
    }
  }
  return bytes / (1024 * 1024);
}

/** Post-process: ensure % suffix and risk td classes when missing; trim noise before first <h3> */
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
    const userPrompt = buildUserPrompt(body);

    // Build parts: system instruction + user prompt
    const parts = [{ text: systemInstruction }, { text: userPrompt }];

    // Attach Files API URIs, if any (preferred for large media)
    if (Array.isArray(body.fileUris)) {
      for (const f of body.fileUris) {
        if (f && typeof f.fileUri === 'string' && f.fileUri.length > 0) {
          const mt = typeof f.mimeType === 'string' && f.mimeType ? f.mimeType : 'application/octet-stream';
          parts.push({ file_data: { mimeType: mt, fileUri: f.fileUri } });
        }
      }
    }

    // Attach inline Base64 images for small items (no data: prefix)
    if (Array.isArray(body.imagesInline)) {
      for (const img of body.imagesInline) {
        if (img && typeof img.data === 'string' && img.data.length > 0) {
          const mt = typeof img.mimeType === 'string' && img.mimeType ? img.mimeType : 'image/jpeg';
          parts.push({ inline_data: { mimeType: mt, data: img.data } });
        }
      }
    }

    // Guard inline size
    const estMB = estimateInlineRequestMB(parts);
    if (estMB > MAX_INLINE_REQUEST_MB) {
      return res.status(413).json({
        error: 'الطلب كبير جدًا',
        detail: `الحجم المقدر ~${estMB.toFixed(2)}MB > ${MAX_INLINE_REQUEST_MB}MB (حد inline ~20MB). 
استخدم Files API (ارفع الملف أولاً واحصل على fileUri) أو خفّض جودة الصور.`,
        docs: [
          'https://ai.google.dev/gemini-api/docs/image-understanding',
          'https://ai.google.dev/gemini-api/docs/files'
        ]
      });
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192
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
          detail: 'قلّل حجم الصور أو استخدم Files API.',
          docs: [
            'https://ai.google.dev/gemini-api/docs/image-understanding',
            'https://ai.google.dev/gemini-api/docs/files'
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

    // (Optional) Inspect finishReason for debugging
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
