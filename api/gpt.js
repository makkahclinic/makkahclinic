// /pages/api/gpt.js
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

// ===== الإعدادات =====
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
const GEMINI_FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GEN_URL   = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

const MAX_TOKENS_GEMINI = 2048;
const MAX_RETRIES       = 3;

// ===== Utilities =====
const ok  = (res, json) => res.status(200).json({ ok: true, ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

const parseJsonSafe = async (r) => {
  const ct = (r.headers.get?.("content-type")||"").toLowerCase?.() || "";
  if (ct.includes("application/json")) return r.json();
  return { raw: await r.text() };
};

async function withRetry(fn, label="op"){
  let attempt = 0, lastErr;
  while(attempt < MAX_RETRIES){
    try { return await fn(); }
    catch(e){ lastErr = e; attempt++; if(attempt>=MAX_RETRIES) break; await sleep(500 * attempt); }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts: ${lastErr?.message||String(lastErr)}`);
}

// ===== Gemini Uploader =====
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
  const sessionUrl = initRes.headers.get("X-Goog-Upload-URL");
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

// ===== Schema (fixed brackets) =====
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    medications: { type:"array", items:{ type:"object", properties:{
      name:{type:"string"}, dose:{type:["string","null"]}, route:{type:["string","null"]},
      frequency:{type:["string","null"]}, durationDays:{type:["number","null"]},
      indication:{type:["string","null"]}, source:{type:["string","null"]}
    }, required:["name"], additionalProperties:false }},
    labs: { type:"array", items:{ type:"object", properties:{
      name:{type:"string"}, value:{type:["string","number","null"]}, unit:{type:["string","null"]}
    }, required:["name"], additionalProperties:false }},
    diagnoses: { type:"array", items:{ type:"object", properties:{
      name:{type:"string"}, status:{type:["string","null"]}
    }, required:["name"], additionalProperties:false }},
    symptoms: { type:"array", items:{ type:"object", properties:{
      name:{type:"string"}, severity:{type:["string","null"]}
    }, required:["name"], additionalProperties:false }},
    procedures: { type:"array", items:{ type:"object", properties:{
      name:{type:"string"}
    }, required:["name"], additionalProperties:false }},
    imaging: { type:"array", items:{ type:"object", properties:{
      name:{type:"string"}
    }, required:["name"], additionalProperties:false }},
  },
  required:["medications","labs","diagnoses","symptoms","procedures","imaging"],
  additionalProperties:false
};

// ===== Gemini Extraction =====
const GEMINI_SYSTEM_EXTRACTION = `
Extract all clinical data as JSON only matching schema:
${JSON.stringify(EXTRACTION_SCHEMA, null, 2)}
Output JSON only.
`;

const GEMINI_SAFETY = [
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT",  threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT",         threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH",        threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",  threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY",    threshold: "BLOCK_NONE" },
];

async function geminiStructuredExtract({ text="", files=[] }){
  const userParts = [];
  if (text) userParts.push({ text });
  for (const f of files) {
    const mime = f.mimeType || "application/pdf";
    const b64  = (f.data||"").split("base64,").pop() || f.data;
    if(!b64) continue;
    const { uri, mime: mm } = await geminiUploadBase64({ name: f.name||"file", mimeType: mime, base64: b64 });
    userParts.push({ file_data: { file_uri: uri, mime_type: mm } });
  }

  const body = {
    system_instruction: { parts: [{ text: GEMINI_SYSTEM_EXTRACTION }] },
    contents: [{ role: "user", parts: userParts }],
    safetySettings: GEMINI_SAFETY,
    generationConfig: { response_mime_type: "application/json", max_output_tokens: MAX_TOKENS_GEMINI }
  };

  const data = await withRetry(async()=>{
    const r = await fetch(GEMINI_GEN_URL(GEMINI_MODEL),{method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)});
    const d = await parseJsonSafe(r);
    if(!r.ok) throw new Error(`Gemini error: ${JSON.stringify(d)}`);
    const raw = d?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("\n") || "{}";
    return JSON.parse(raw);
  },"geminiExtract");
  return data;
}

// ===== OpenAI Audit =====
function auditInstructions(lang='ar'){
  return `You are a medical auditor. Output JSON only.`;
}

const AUDIT_JSON_SCHEMA = {
  name: "ClinicalAudit",
  schema: { type:"object", properties:{ patientSummary:{type:"object",properties:{text:{type:"string"}}} }, required:["patientSummary"], additionalProperties:true },
  strict: false
};

async function chatgptAuditJSON(bundle, lang){
  const jsonGuard = "Output must be JSON only.";
  const messages = [
    { role:"system", content: auditInstructions(lang) + "\n" + jsonGuard },
    { role:"user", content: "Return JSON for this clinical data:\n" + JSON.stringify(bundle,null,2) }
  ];

  try {
    const r = await fetch(OPENAI_API_URL,{
      method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, response_format:{ type:"json_schema", json_schema: AUDIT_JSON_SCHEMA } })
    });
    const d = await r.json();
    return JSON.parse(d?.choices?.[0]?.message?.content||"{}");
  } catch {
    const r2 = await fetch(OPENAI_API_URL,{
      method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, response_format:{ type:"json_object" } })
    });
    const d2 = await r2.json();
    return JSON.parse(d2?.choices?.[0]?.message?.content||"{}");
  }
}

// ===== Handler =====
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return bad(res,405,"POST only");
    if(!OPENAI_API_KEY) return bad(res,500,"Missing OPENAI_API_KEY");
    if(!GEMINI_API_KEY)  return bad(res,500,"Missing GEMINI_API_KEY");

    const { text="", files=[], patientInfo=null, lang="ar" } = req.body||{};
    const extracted = await geminiStructuredExtract({ text, files });
    const bundle = { patientInfo, extracted, userText:text };
    const structured = await chatgptAuditJSON(bundle, lang);
    return ok(res,{ structured });
  }catch(e){
    console.error("Handler error:",e);
    return bad(res,500,e.message);
  }
}
