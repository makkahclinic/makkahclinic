// /pages/api/gpt.js
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

/* =========================
   الإعدادات العامة
========================= */
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// حدود تشغيلية
const MAX_TOKENS_GEMINI = 2048;
const MAX_RETRIES       = 3;

/* =========================
   أدوات مساعدة
========================= */
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

const parseJsonSafe = async (r) => {
  const ct = (r.headers.get?.("content-type")||"").toLowerCase?.() || "";
  if (ct.includes("application/json")) return r.json();
  return { raw: await r.text() };
};

async function withRetry(fn, label="op"){
  let attempt = 0, lastErr;
  const base = 400;
  while(attempt < MAX_RETRIES){
    try { return await fn(); }
    catch(e){ lastErr = e; attempt++; if(attempt>=MAX_RETRIES) break; await sleep(base * Math.pow(2,attempt-1)); }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts: ${lastErr?.message||String(lastErr)}`);
}

/* =========================
   رفع الملفات إلى Gemini (Resumable)
========================= */
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
  const initData = await parseJsonSafe(initRes);
  if(!initRes.ok) throw new Error(`Gemini init failed: ${JSON.stringify(initData)}`);
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

/* =========================
   مخطط الاستخراج القياسي (JSON) — تم تصحيح الأقواس
========================= */
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    medications: { type: "array", items: {
      type:"object", properties:{
        name:{type:"string"}, dose:{type:["string","null"]}, route:{type:["string","null"]},
        frequency:{type:["string","null"]}, durationDays:{type:["number","null"]}, startDate:{type:["string","null"]},
        indication:{type:["string","null"]}, source:{type:["string","null"]}
      }, required:["name"], additionalProperties:false
    }},
    labs: { type:"array", items:{
      type:"object", properties:{
        name:{type:"string"}, value:{type:["string","number","null"]}, unit:{type:["string","null"]},
        refRange:{type:["string","null"]}, date:{type:["string","null"]}, source:{type:["string","null"]}
      }, required:["name"], additionalProperties:false
    }},
    diagnoses: { type:"array", items:{
      type:"object", properties:{
        name:{type:"string"}, status:{type:["string","null"]}, certainty:{type:["string","null"]}, source:{type:["string","null"]}
      }, required:["name"], additionalProperties:false
    }},
    symptoms: { type:"array", items:{
      type:"object", properties:{
        name:{type:"string"}, status:{type:["string","null"]}, severity:{type:["string","null"]},
        onsetDate:{type:["string","null"]}, source:{type:["string","null"]}
      }, required:["name"], additionalProperties:false
    }},
    procedures: { type:"array", items:{
      type:"object", properties:{
        name:{type:"string"}, date:{type:["string","null"]}, source:{type:["string","null"]}
      }, required:["name"], additionalProperties:false
    }},
    imaging: { type:"array", items:{
      type:"object", properties:{
        name:{type:"string"}, findings:{type:["string","null"]}, date:{type:["string","null"]}, source:{type:["string","null"]}
      }, required:["name"], additionalProperties:false
    }}
  },
  required:["medications","labs","diagnoses","symptoms","procedures","imaging"],
  additionalProperties:false
};

// متحقق JSON بسيط
function simpleValidate(schema, obj){
  for(const req of schema.required||[]){
    if(!(req in obj)) return { ok:false, error:`Missing key: ${req}` };
  }
  return { ok:true };
}

/* =========================
   استخراج منظّم بواسطة Gemini (مع تقسيم/دمج)
========================= */
const GEMINI_SYSTEM_EXTRACTION = `
أنت مساعد استخلاص سريري احترافي. استخرج معلومات سريرية مُهيكلة STRICT JSON وفق المخطط التالي (لا تُضيف حقولًا خارج المخطط، ولا شرحًا خارج JSON):
${JSON.stringify(EXTRACTION_SCHEMA, null, 2)}
أعد الاستجابة بـ MIME "application/json" فقط دون أي تعليق.
عند وجود أسماء أدوية/جرعات مختلفة لنفس الدواء، احتفظ بها كما وردت مع الإشارة إلى المصدر.
`;

// الفئات المدعومة فقط — Developer API
// https://ai.google.dev/gemini-api/docs/safety-settings
const GEMINI_SAFETY = [
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT",  threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT",         threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH",        threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",  threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY",    threshold: "BLOCK_NONE" },
];

function splitTextSmart(s, maxLen=6000){
  if(!s) return [];
  if(s.length <= maxLen) return [s];
  const parts = [];
  let start = 0;
  while(start < s.length){
    let end = Math.min(start + maxLen, s.length);
    const cut = s.lastIndexOf("\n", end);
    if(cut > start + 1000) end = cut;
    parts.push(s.slice(start, end));
    start = end;
  }
  return parts;
}

function mergeExtractionBlocks(blocks){
  const out = { medications:[], labs:[], diagnoses:[], symptoms:[], procedures:[], imaging:[] };
  for(const b of blocks){
    for(const k of Object.keys(out)) if(Array.isArray(b[k])) out[k] = out[k].concat(b[k]);
  }
  const dedup = (arr, keyFn)=>{
    const seen = new Set(); const res=[];
    for(const it of arr){ const key=keyFn(it); if(seen.has(key)) continue; seen.add(key); res.push(it); }
    return res;
  };
  out.medications = dedup(out.medications, (m)=> `${(m.name||"").toLowerCase()}|${m.dose||""}|${m.source||""}`);
  out.labs        = dedup(out.labs,        (l)=> `${(l.name||"").toLowerCase()}|${l.date||""}|${l.source||""}`);
  out.diagnoses   = dedup(out.diagnoses,   (d)=> `${(d.name||"").toLowerCase()}|${d.status||""}|${d.source||""}`);
  out.symptoms    = dedup(out.symptoms,    (s)=> `${(s.name||"").toLowerCase()}|${s.onsetDate||""}|${s.source||""}`);
  out.procedures  = dedup(out.procedures,  (p)=> `${(p.name||"").toLowerCase()}|${p.date||""}|${p.source||""}`);
  out.imaging     = dedup(out.imaging,     (i)=> `${(i.name||"").toLowerCase()}|${i.date||""}|${i.source||""}`);
  return out;
}

async function geminiExtractChunked({ textParts = [], fileParts = [] }){
  const userParts = [];
  for (const t of textParts) { if(t?.trim()) userParts.push({ text: t }); }
  for (const f of fileParts) { userParts.push({ file_data: { file_uri: f.uri, mime_type: f.mime } }); }
  if (userParts.length === 0) userParts.push({ text: "لا يوجد نص أو ملفات." });

  const body = {
    system_instruction: { parts: [{ text: GEMINI_SYSTEM_EXTRACTION }] },
    contents: [{ role: "user", parts: userParts }],
    safetySettings: GEMINI_SAFETY,
    generationConfig: {
      response_mime_type: "application/json",  // JSON Mode
      max_output_tokens: MAX_TOKENS_GEMINI
    }
  };

  const data = await withRetry(async()=> {
    const r = await fetch(GEMINI_GEN_URL(GEMINI_MODEL),{
      method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
    });
    const d = await parseJsonSafe(r);
    if(!r.ok) throw new Error(`Gemini generateContent error: ${JSON.stringify(d)}`);
    const raw = d?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("\n") || "{}";
    return JSON.parse(raw);
  }, "geminiExtract");

  const v = simpleValidate(EXTRACTION_SCHEMA, data);
  if(!v.ok){
    return {
      medications: data.medications || [],
      labs: data.labs || [],
      diagnoses: data.diagnoses || [],
      symptoms: data.symptoms || [],
      procedures: data.procedures || [],
      imaging: data.imaging || []
    };
  }
  return data;
}

async function geminiStructuredExtract({ text="", files=[] }){
  const textParts = splitTextSmart(text, 6000);

  // رفع الملفات
  const uploaded = [];
  for (const f of files || []) {
    const mime = f?.mimeType || "application/octet-stream";
    const b64  = (f?.data||"").split("base64,").pop() || f?.data;
    if (!b64) continue;
    const { uri, mime: mm } = await withRetry(
      ()=>geminiUploadBase64({ name: f?.name || "file", mimeType: mime, base64: b64 }),
      "geminiUpload"
    );
    uploaded.push({ uri, mime:mm });
  }

  // map-reduce
  const blocks = [];
  const batches = textParts.length ? textParts.map(t => [t]) : [[]];
  for (const batch of batches){
    const resp = await geminiExtractChunked({ textParts: batch, fileParts: uploaded });
    blocks.push(resp);
  }
  return mergeExtractionBlocks(blocks);
}

/* =========================
   توجيهات التدقيق السريري (OpenAI)
========================= */
function auditInstructions(lang='ar'){
  const langRule = lang === 'en'
    ? "**Language Rule: All outputs MUST be in clear, professional English.**"
    : "**قاعدة اللغة: يجب أن تكون جميع المخرجات باللغة العربية الفصحى.**";

  return `You are an expert, evidence-based clinical pharmacist and medical auditor. Analyze the case strictly against major guidelines (AHA/ACC/HFSA 2022; ESC 2021 for HF; KDIGO 2022 for CKD; ADA 2024/2025 for diabetes; ESC 2023/ACC 2024 for HTN). Provide traceable, actionable output in a STRICT JSON format. Do not add any commentary or explanation outside of the JSON structure.

Rules:
- Evaluate dose/frequency/duration for each medication vs renal/hepatic function and indication.
- Flag excessive initial durations (>30 days) as "Subject to Rejection" unless justified.
- Identify missing monitoring (e.g., ACEi/ARB ⇒ Creatinine & K+; Statins ⇒ LFTs).
- Strongly flag: IV fluids in acute decompensated HF without hypotension/shock; NSAIDs in HF/CKD; Metformin if eGFR<30, caution 30–45.
- Always include citations array with short references for critical recommendations.

${langRule}`;
}

// مخطط مخرجات التدقيق (Structured Outputs)
const AUDIT_JSON_SCHEMA = {
  name: "ClinicalAudit",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      patientSummary: { type:"object", additionalProperties:false, properties:{ text:{type:"string"} }, required:["text"] },
      overallAssessment: { type:"object", additionalProperties:false, properties:{ text:{type:"string"} }, required:["text"] },
      table: {
        type:"array",
        items:{
          type:"object",
          additionalProperties:false,
          properties:{
            name:{type:"string"},
            itemType:{ type:"string", enum:["lab","medication","procedure","device","imaging"] },
            doseRegimen:{ type:["string","null"] },
            durationDays:{ type:["number","null"] },
            intendedIndication:{ type:["string","null"] },
            riskAnalysis:{
              type:"object", additionalProperties:false, properties:{
                clinicalValidity:{ type:"object", additionalProperties:false, properties:{ score:{type:"number"}, reasoning:{type:"string"} }, required:["score","reasoning"] },
                documentationStrength:{ type:"object", additionalProperties:false, properties:{ score:{type:"number"}, reasoning:{type:"string"} }, required:["score","reasoning"] },
                financialImpact:{ type:"object", additionalProperties:false, properties:{ score:{type:"number"}, reasoning:{type:"string"} }, required:["score","reasoning"] },
              }, required:["clinicalValidity","documentationStrength","financialImpact"]
            },
            overallRiskPercent:{ type:"number" },
            insuranceDecision:{
              type:"object", additionalProperties:false,
              properties:{ label:{type:"string"}, justification:{type:"string"} },
              required:["label","justification"]
            }
          },
          required:["name","itemType","riskAnalysis","overallRiskPercent","insuranceDecision"]
        }
      },
      recommendations: {
        type:"array",
        items:{ type:"object", additionalProperties:false, properties:{
          priority:{ type:"string" },
          description:{ type:"string" },
          relatedItems:{ type:"array", items:{type:"string"} }
        }, required:["priority","description"] }
      },
      citations: { type:"array", items:{ type:"object", additionalProperties:false, properties:{
        label:{type:"string"}, url:{type:"string"}
      }, required:["label","url"] } }
    },
    required:["patientSummary","overallAssessment","table","recommendations","citations"]
  },
  strict: true
};

async function chatgptAuditJSON(bundle, lang){
  const messages = [
    { role:"system", content: auditInstructions(lang) },
    { role:"user", content: "Clinical Data for Audit:\n"+JSON.stringify(bundle,null,2) },
  ];

  // المحاولة 1: json_schema strict
  try{
    const resp = await withRetry(async()=> {
      const r = await fetch(OPENAI_API_URL,{
        method:"POST",
        headers:{ "Content-Type":"application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages,
          response_format:{ type:"json_schema", json_schema: AUDIT_JSON_SCHEMA }
        })
      });
      const data = await r.json();
      if(!r.ok) throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
      return JSON.parse(data?.choices?.[0]?.message?.content||"{}");
    }, "openaiStructured");
    return resp;
  }catch(e){
    // المحاولة 2: json_object
    const resp2 = await withRetry(async()=> {
      const r = await fetch(OPENAI_API_URL,{
        method:"POST",
        headers:{ "Content-Type":"application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages,
          response_format:{ type:"json_object" }
        })
      });
      const data = await r.json();
      if(!r.ok) throw new Error(`OpenAI error(fallback): ${JSON.stringify(data)}`);
      return JSON.parse(data?.choices?.[0]?.message?.content||"{}");
    }, "openaiJSONObj");
    return resp2;
  }
}

/* =========================
   طبقة قواعد بسيطة (Post-Validation)
========================= */
function applyRuleEngine(structured, { patientInfo, extracted }){
  const eGFR = Number(patientInfo?.labs?.eGFR ?? NaN);

  // متفورمين مقابل eGFR
  for(const r of structured.table||[]){
    if(r.itemType === "medication" && /metformin/i.test(r.name||"")){
      if(!Number.isNaN(eGFR) && eGFR < 30){
        r.insuranceDecision.label = "Rejected";
        r.insuranceDecision.justification = (r.insuranceDecision.justification||"") + " | Metformin contraindicated if eGFR < 30.";
        r.overallRiskPercent = Math.max(r.overallRiskPercent||0, 90);
      }
    }
  }

  // سوائل IV في ADHF
  const hasADHF = (extracted?.diagnoses||[]).some(d=> /acute decompensated heart failure|adhf|قصور قلب حاد/i.test(d.name||""));
  if(hasADHF){
    for(const r of structured.table||[]){
      if(r.itemType === "procedure" && /(IV\s*fluids|Normal\s*saline|Bolus|محاليل)/i.test(r.name||"")){
        r.insuranceDecision.label = "Rejected";
        r.insuranceDecision.justification = (r.insuranceDecision.justification||"") + " | IV fluids in ADHF without shock is harmful.";
        r.overallRiskPercent = Math.max(r.overallRiskPercent||0, 95);
      }
    }
  }

  // NSAIDs في HF/CKD
  const hasHF  = (extracted?.diagnoses||[]).some(d=> /heart failure|قصور قلب/i.test(d.name||""));
  const hasCKD = (extracted?.diagnoses||[]).some(d=> /(ckd|chronic kidney|مرض كلى مزمن)/i.test(d.name||""));
  if(hasHF || hasCKD){
    for(const r of structured.table||[]){
      if(r.itemType === "medication" && /(ibuprofen|diclofenac|naproxen|ketorolac|nsaid|مسكنات غير ستيرويدية)/i.test(r.name||"")){
        r.insuranceDecision.label = "Rejected";
        r.insuranceDecision.justification = (r.insuranceDecision.justification||"") + " | NSAIDs increase risk in HF/CKD.";
        r.overallRiskPercent = Math.max(r.overallRiskPercent||0, 90);
      }
    }
  }

  // مدد > 30 يوم بدون مبرر
  for(const r of structured.table||[]){
    if(r.itemType === "medication" && (r.durationDays ?? null) && r.durationDays > 30){
      if(!/chronic|maintenance/i.test(r.intendedIndication||"")){
        r.insuranceDecision.label = /Subject to Rejection|معرض للرفض|Rejected|قابل للرفض/.test(r.insuranceDecision.label||"")
          ? r.insuranceDecision.label : "Subject to Rejection";
        r.insuranceDecision.justification = (r.insuranceDecision.justification||"") + " | Initial long duration without re-evaluation.";
      }
    }
  }

  return structured;
}

/* =========================
   تحسين العرض HTML
========================= */
function pctColor(p){
  if(p==null || Number.isNaN(Number(p))) return '#64748b';
  const n = Number(p);
  if(n >= 75) return '#e53935';
  if(n >= 50) return '#f9a825';
  return '#2e7d32';
}
function getDecisionColor(label) {
  switch (label) {
    case 'مقبول':
    case 'Accepted':
      return '#2e7d32';
    case 'معرض للرفض':
    case 'Subject to Rejection':
    case 'إيقاف مؤقت / إعادة تقييم':
    case 'Temporary Stop / Re-evaluate':
      return '#f9a825';
    case 'قابل للرفض':
    case 'Rejected':
      return '#e53935';
    default:
      return '#64748b';
  }
}

function toHtml(s){
  const tableRows = (s.table||[]).map(r => {
    const decisionColor = getDecisionColor(r.insuranceDecision?.label);
    const riskC = pctColor(r.overallRiskPercent);
    const doseInfo = (r.doseRegimen && r.doseRegimen !== '-') ? r.doseRegimen : (r.itemType === 'medication' ? '-' : (r.doseRegimen || '-'));
    return `
      <tr>
        <td>
          <div class="item-name">${r.name || '-'}</div>
          <div class="item-type">${r.itemType || ''}</div>
        </td>
        <td>${doseInfo}</td>
        <td>${r.intendedIndication || '-'}</td>
        <td><span class="decision-badge" style="background-color:${decisionColor};">${r.insuranceDecision?.label || '-'}</span></td>
        <td style="color:${riskC}; font-weight:600;">${typeof r.overallRiskPercent==='number'? r.overallRiskPercent+'%':'-'}</td>
        <td>${r.insuranceDecision?.justification || '-'}</td>
      </tr>
    `;
  }).join("");

  const recommendationsList = (s.recommendations||[]).map(rec => `
    <div class="rec-item">
        <span class="rec-priority ${/عاجلة|Urgent/.test(rec.priority||'') ? 'urgent' : 'best-practice'}">${rec.priority}</span>
        <div class="rec-desc">${rec.description}</div>
        ${rec.relatedItems && rec.relatedItems.length > 0 ? `<div class="rec-related">مرتبط بـ: ${rec.relatedItems.join(', ')}</div>` : ''}
    </div>
  `).join("");

  const citationsList = (s.citations||[]).map(c => `
    <li><a href="${c.url}" target="_blank" rel="noopener noreferrer">${c.label}</a></li>
  `).join("");

  return `
  <style>
    .report-section { border: 1px solid #e0e0e0; border-radius: 12px; margin-bottom: 24px; padding: 20px; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .report-section h2 { font-size: 22px; color: #0d47a1; margin: 0 0 16px; display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; }
    .report-section h2 svg { width: 26px; height: 26px; fill: #1a73e8; }
    .summary-text { font-size: 16px; line-height: 1.8; color: #333; }
    .audit-table { width: 100%; border-collapse: collapse; }
    .audit-table th, .audit-table td { padding: 14px 12px; text-align: right; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
    .audit-table th { background-color: #f5f7f9; color: #0d47a1; font-weight: 600; font-size: 14px; }
    .audit-table tr:last-child td { border-bottom: none; }
    .audit-table tr:hover { background-color: #f8f9fa; }
    .item-name { font-weight: 600; color: #202124; margin-bottom: 4px; }
    .item-type { font-size: 12px; color: #5f6368; }
    .decision-badge { color: #fff; font-weight: 600; padding: 5px 10px; border-radius: 16px; font-size: 13px; display: inline-block; }
    .rec-item { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; padding: 12px; border-radius: 8px; background: #f8f9fa; }
    .rec-priority { flex-shrink: 0; font-weight: 700; padding: 4px 10px; border-radius: 8px; font-size: 12px; color: #fff; }
    .rec-priority.urgent { background: #ea4335; }
    .rec-priority.best-practice { background: #34a853; }
    .rec-desc { color: #333; }
    .rec-related { font-size: 11px; color: #5f6368; margin-top: 4px; }
    .citations ul { padding-right: 18px; }
  </style>

  <div class="report-section" id="summary-section">
    <h2><svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>ملخص الحالة والتقييم العام</h2>
    <p class="summary-text">${s.patientSummary?.text || 'غير متوفر.'}</p>
    <p class="summary-text">${s.overallAssessment?.text || 'غير متوفر.'}</p>
  </div>

  <div class="report-section" id="details-section">
    <h2><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 16H6c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1h12c.55 0 1 .45 1 1zM8 11h8v2H8zm0-4h8v2H8z"/></svg>التحليل التفصيلي للطلبات</h2>
    <table class="audit-table">
      <thead>
        <tr>
          <th>الطلب</th>
          <th>الجرعة / النظام</th>
          <th>المؤشر المستنتج</th>
          <th>قرار التأمين</th>
          <th>% المخاطر</th>
          <th>التبرير</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>

  <div class="report-section" id="recommendations-section">
    <h2><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2h-2zm2-4h-2V7h2v6z"/></svg>التوصيات والإجراءات المقترحة</h2>
    ${recommendationsList}
  </div>

  <div class="report-section citations" id="citations-section">
    <h2><svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5z"/></svg>المراجع</h2>
    <ul>${citationsList || ""}</ul>
  </div>
  `;
}

/* =========================
   المعالج الرئيسي
========================= */
export default async function handler(req, res){
  try{
    if(req.method!=="POST") return bad(res,405,"POST only");
    if(!OPENAI_API_KEY) return bad(res,500,"Missing OPENAI_API_KEY");
    if(!GEMINI_API_KEY)  return bad(res,500,"Missing GEMINI_API_KEY");

    const { text="", files=[], patientInfo=null, lang = 'ar' } = req.body||{};

    // 1) استخراج مُنظّم من Gemini (مع تقسيم/دمج)
    const extracted = await geminiStructuredExtract({ text, files });

    // 2) بناء الحزمة لـ OpenAI
    const bundle = {
      patientInfo: patientInfo || {},
      extracted,
      userText: String(text||"").slice(0, 5000)
    };

    // 3) تدقيق سريري مُهيكل
    let structured = await chatgptAuditJSON(bundle, lang);

    // 4) قواعد بعديّة
    structured = applyRuleEngine(structured, { patientInfo, extracted });

    // 5) حراسة: إن غابت المراجع نضيف الأساسية
    if(!Array.isArray(structured.citations) || !structured.citations.length){
      structured.citations = [
        { label: "AHA/ACC/HFSA 2022 Heart Failure Guideline", url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001063" },
        { label: "ESC 2021 Heart Failure Guideline", url: "https://academic.oup.com/eurheartj/article/42/36/3599/6358045" },
        { label: "KDIGO 2022 Diabetes in CKD Guideline", url: "https://kdigo.org/guidelines/diabetes-ckd/" },
        { label: "ADA Standards of Care 2025 (Diabetes)", url: "https://diabetesjournals.org/care/issue" },
        { label: "ESC/ACC Hypertension (2023/2024)", url: "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines" }
      ];
    }

    // 6) تحويل إلى HTML
    const html = toHtml(structured);

    return ok(res,{ html, structured, extracted });
  }catch(err){
    console.error("/api/gpt error:", err);
    return bad(res,500, err?.message || String(err));
  }
}
