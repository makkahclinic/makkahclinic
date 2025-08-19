export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

// --- Configuration ---
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o"; 
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest"; 
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// --- Helper Utilities ---
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const parseJsonSafe = async (r) => (r.headers.get("content-type")||"").includes("application/json") ? r.json() : { raw: await r.text() };

// --- Gemini File Uploader ---
async function geminiUploadBase64({ name, mimeType, base64 }) {
  const bin = Buffer.from(base64, "base64");
  const initRes = await fetch(`${GEMINI_FILES_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,{
    method:"POST",
    headers:{
      "X-Goog-Upload-Protocol":"resumable",
      "X-Goog-Upload-Command":"start",
      "X-Goog-Upload-Header-Content-Length":String(bin.byteLength),
      "X-Goog-Upload-Header-Content-Type":mimeType,
      "Content-Type":"application/json",
    },
    body: JSON.stringify({ file:{ display_name:name, mime_type:mimeType } })
  });
  if(!initRes.ok) throw new Error(`Gemini init failed: ${JSON.stringify(await parseJsonSafe(initRes))}`);
  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
  if(!sessionUrl) throw new Error("Gemini upload URL missing");
  const upRes = await fetch(sessionUrl,{
    method:"PUT",
    headers:{
      "Content-Type":mimeType,
      "X-Goog-Upload-Command":"upload, finalize",
      "X-Goog-Upload-Offset":"0",
      "Content-Length":String(bin.byteLength),
    },
    body: bin
  });
  const meta = await parseJsonSafe(upRes);
  if(!upRes.ok) throw new Error(`Gemini finalize failed: ${JSON.stringify(meta)}`);
  return { uri: meta?.file?.uri, mime: meta?.file?.mime_type || mimeType };
}

// --- Gemini Clinical Data Extraction ---
async function geminiSummarize({ text, files }) {
  const userParts = [];
  if (text) userParts.push({ text });
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data||"").split("base64,").pop() || f?.data;
    if (!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({ name: f?.name || "file", mimeType: mime, base64: b64 });
    userParts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }
  if (userParts.length === 0) userParts.push({ text: "لا يوجد نص أو ملفات لتحليلها." });

  const systemPrompt = `أنت خبير في استخلاص البيانات الطبية. مهمتك هي قراءة كل المدخلات (نصوص وملفات) واستخراج المعلومات السريرية بدقة فائقة وتنظيمها تحت العناوين التالية:
- الشكوى الرئيسية والأعراض (Chief Complaint & Symptoms)
- التشخيصات (Diagnoses)
- الحالات المزمنة (Chronic Conditions)
- العلامات الحيوية (Vital Signs)
- قائمة الطلبات الكاملة (Full List of Orders: medications, labs, imaging, procedures)`;
  
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }]
  };

  const resp = await fetch(GEMINI_GEN_URL(GEMINI_MODEL),{
    method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
  });
  const data = await parseJsonSafe(resp);
  if(!resp.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(data)}`);
  return data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("\n") || "";
}

// ##############################################################################
// ############## The "Special" Core: Advanced Audit Instructions ###############
// ##############################################################################
function auditInstructions(){ 
  return `أنت رئيس لجنة التدقيق الطبي والتأميني. مهمتك هي إجراء تحليل ثلاثي الأبعاد (سريري، توثيقي، مالي) للبيانات المقدمة. يجب أن تفكر بعمق وتربط بين كل معلومة متاحة.

**خطوات التحليل الفكري المطلوبة منك:**
1.  **الفهم الشامل:** استوعب حالة المريض بالكامل (الأعراض، التشخيصات، الحالات المزمنة).
2.  **التحليل لكل بند:** لكل طلب (دواء، فحص، إجراء)، قم بتقييمه من ثلاث زوايا:
    a.  **الصلاحية السريرية (Clinical Validity):** هل هذا الطلب منطقي طبياً بناءً على حالة المريض؟ هل هو أفضل إجراء متاح؟ (0-100).
    b.  **قوة التوثيق (Documentation Strength):** هل المبرر السريري موثق بشكل واضح وصريح في الملف؟ (0-100).
    c.  **الأثر المالي (Financial Impact):** هل هذا الطلب فعال من حيث التكلفة أم أنه مكلف ويمكن استبداله بخيار أرخص بنفس الفعالية؟ (0-100).
3.  **حساب المخاطرة الإجمالية:** احسب متوسط الدرجات الثلاث لتحديد نسبة المخاطرة الإجمالية.
4.  **إصدار القرار والتبرير:** بناءً على التحليل، أصدر قراراً تأمينياً (مقبول، قابل للمراجعة، قابل للرفض) مع تبرير دقيق وموجز يوضح السبب الرئيسي.
5.  **استنتاج التوصيات:** بناءً على نقاط الضعف التي وجدتها، قم بصياغة توصيات عملية وقابلة للتنفيذ، وصنفها حسب الأولوية.

**أخرج JSON فقط بالمخطط الدقيق التالي:**
{
  "patientSummary": {"text": "string"},
  "overallAssessment": {"text": "string"},
  "table": [
    {
      "name": "string",
      "itemType": "lab"|"medication"|"procedure"|"device"|"imaging",
      "intendedIndication": "string|null",
      "riskAnalysis": {
        "clinicalValidity": {"score": "number", "reasoning": "string"},
        "documentationStrength": {"score": "number", "reasoning": "string"},
        "financialImpact": {"score": "number", "reasoning": "string"}
      },
      "overallRiskPercent": "number",
      "insuranceDecision": {"label": "مقبول"|"قابل للمراجعة"|"قابل للرفض", "justification": "string"}
    }
  ],
  "recommendations": [
    {"priority": "عاجلة"|"أفضل ممارسة", "description": "string", "relatedItems": ["string"]}
  ]
}
ONLY JSON.`;
}

async function chatgptJSON(bundle){
  const resp = await fetch(OPENAI_API_URL,{
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role:"system", content:auditInstructions() },
        { role:"user", content: "البيانات السريرية للتدقيق:\n"+JSON.stringify(bundle,null,2) },
      ],
      response_format:{ type:"json_object" }
    })
  });
  const data = await resp.json();
  if(!resp.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  return JSON.parse(data?.choices?.[0]?.message?.content||"{}");
}


// ##############################################################################
// ############## The "Special" Core Part 2: Advanced HTML Renderer #############
// ##############################################################################
function getRiskColor(p) {
    if (p >= 70) return '#e53935'; // bad
    if (p >= 50) return '#f9a825'; // warn
    return '#2e7d32'; // ok
}

function toHtml(s){
  const tableRows = (s.table||[]).map(r => {
    const ra = r.riskAnalysis || {};
    const cv = ra.clinicalValidity || {};
    const ds = ra.documentationStrength || {};
    const fi = ra.financialImpact || {};
    const decisionColor = getRiskColor(100 - (r.overallRiskPercent || 0));

    return `
    <div class="audit-row">
        <div class="row-header">
            <div class="item-name">${r.name || '-'} <span class="item-type">${r.itemType || ''}</span></div>
            <div class="decision" style="background-color:${decisionColor};">
                ${r.insuranceDecision?.label || '-'}
            </div>
        </div>
        <div class="row-body">
            <div class="indication">
                <strong>المؤشر السريري المستنتج:</strong>
                <p>${r.intendedIndication || '<em>لم يتمكن النظام من استنتاج مؤشر واضح.</em>'}</p>
            </div>
            <div class="risk-grid">
                <div class="risk-cell">
                    <div class="risk-title">
                        <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                        الصلاحية السريرية
                    </div>
                    <div class="risk-score" style="color:${getRiskColor(cv.score || 0)}">${cv.score || 0}%</div>
                    <div class="risk-reasoning">${cv.reasoning || '-'}</div>
                </div>
                <div class="risk-cell">
                    <div class="risk-title">
                        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                        قوة التوثيق
                    </div>
                    <div class="risk-score" style="color:${getRiskColor(ds.score || 0)}">${ds.score || 0}%</div>
                    <div class="risk-reasoning">${ds.reasoning || '-'}</div>
                </div>
                <div class="risk-cell">
                    <div class="risk-title">
                        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-12h2v4h-2zm0 6h2v2h-2z"/></svg>
                        الأثر المالي
                    </div>
                    <div class="risk-score" style="color:${getRiskColor(fi.score || 0)}">${fi.score || 0}%</div>
                    <div class="risk-reasoning">${fi.reasoning || '-'}</div>
                </div>
            </div>
            <div class="justification">
                <strong>الخلاصة والتبرير:</strong>
                <p>${r.insuranceDecision?.justification || '-'}</p>
            </div>
        </div>
    </div>
    `;
  }).join("");

  const recommendationsList = (s.recommendations||[]).map(rec => `
    <div class="rec-item">
        <span class="rec-priority ${rec.priority === 'عاجلة' ? 'urgent' : 'best-practice'}">${rec.priority}</span>
        <div class="rec-desc">${rec.description}</div>
        ${rec.relatedItems && rec.relatedItems.length > 0 ? `<div class="rec-related">مرتبط بـ: ${rec.relatedItems.join(', ')}</div>` : ''}
    </div>
  `).join("");

  return `
  <style>
    .report-section { border: 1px solid #e5e7eb; border-radius: 16px; margin-bottom: 20px; padding: 18px; background: #fff; }
    .report-section h2 { font-size: 20px; color: #105ca5; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }
    .report-section h2 svg { width: 24px; height: 24px; fill: #105ca5; }
    .summary-text { font-size: 15px; line-height: 1.7; color: #334155; }
    
    .audit-row { border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
    .row-header { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
    .item-name { font-size: 18px; font-weight: 700; color: #0b4479; }
    .item-type { font-size: 12px; font-weight: 500; color: #64748b; margin-right: 8px; background: #eef7ff; padding: 2px 6px; border-radius: 6px;}
    .decision { color: #fff; font-weight: 700; padding: 6px 12px; border-radius: 8px; font-size: 14px; }
    .row-body { padding: 16px; }
    .indication { margin-bottom: 16px; }
    .indication p { margin: 4px 0 0; color: #475569; }
    
    .risk-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .risk-cell { background: #f8fbff; border: 1px dashed #dbeafe; border-radius: 10px; padding: 12px; }
    .risk-title { display: flex; align-items: center; gap: 6px; font-weight: 500; color: #105ca5; margin-bottom: 8px; font-size: 14px; }
    .risk-title svg { width: 18px; height: 18px; fill: #87c7ff; }
    .risk-score { font-size: 24px; font-weight: 700; margin-bottom: 4px; text-align: center; }
    .risk-reasoning { font-size: 12px; color: #64748b; text-align: center; line-height: 1.5; }
    
    .justification { margin-top: 12px; background: #eef7ff; padding: 12px; border-radius: 8px; border-left: 4px solid #1e90ff; }
    .justification p { margin: 4px 0 0; color: #0b4479; }
    
    .rec-item { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
    .rec-priority { flex-shrink: 0; font-weight: 700; padding: 4px 10px; border-radius: 8px; font-size: 12px; color: #fff; }
    .rec-priority.urgent { background: #e53935; }
    .rec-priority.best-practice { background: #2e7d32; }
    .rec-desc { color: #334155; }
    .rec-related { font-size: 11px; color: #64748b; margin-top: 2px; }
  </style>

  <div class="report-section">
    <h2><svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>ملخص الحالة والتقييم العام</h2>
    <p class="summary-text">${s.patientSummary?.text || 'غير متوفر.'}</p>
    <p class="summary-text">${s.overallAssessment?.text || 'غير متوفر.'}</p>
  </div>
  
  <div class="report-section">
    <h2><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 16H6c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1zM8 11h8v2H8zm0-4h8v2H8z"/></svg>التحليل التفصيلي للطلبات</h2>
    ${tableRows}
  </div>

  <div class="report-section">
    <h2><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2h-2zm2-4h-2V7h2v6z"/></svg>التوصيات والإجراءات المقترحة</h2>
    ${recommendationsList}
  </div>
  `;
}


// --- Main Request Handler ---
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return bad(res,405,"POST only");
    if(!OPENAI_API_KEY) return bad(res,500,"Missing OPENAI_API_KEY");
    if(!GEMINI_API_KEY)  return bad(res,500,"Missing GEMINI_API_KEY");

    const { text="", files=[], patientInfo=null } = req.body||{};
    
    // Step 1: Extract clinical data with Gemini
    const extractedSummary = await geminiSummarize({ text, files });
    const bundle = { patientInfo, extractedSummary, userText: text };

    // Step 2: Perform advanced audit with OpenAI
    const structured = await chatgptJSON(bundle);
    
    // Step 3: Convert the rich JSON into a beautiful HTML report
    const html = toHtml(structured);
    
    return ok(res,{ html, structured });
  }catch(err){
    console.error("/api/gpt error:", err);
    return bad(res,500, err?.message || String(err));
  }
}
