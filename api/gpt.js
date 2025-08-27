// api/gpt.js
// Vercel Serverless Function (Node.js, CommonJS)

const { URL } = require('url');

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch {
    const e = new Error('Invalid JSON'); e.status = 400; throw e;
  }
}
function mimeFromName(name, fallback='image/png'){
  const n = (name||'').toLowerCase();
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endswith?.('.heic') || n.includes('.heic')) return 'image/heic';
  if (n.endswith?.('.heif') || n.includes('.heif')) return 'image/heif';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.tif') || n.endsWith('.tiff')) return 'image/tiff';
  return fallback;
}

function buildSystemInstructions({ language='ar', specialty='', context='' }) {
  return `
أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة، لا تُقدّم تشخيصًا نهائيًا ولا توصيات علاجية دون مراجعة بشرية.
اللغة: ${language==='ar'?'العربية':'English'}
التخصص: ${specialty || 'عام'}
السياق: ${context || '—'}

قواعد:
1) إزالة/تجنّب ذكر أي مُعرّفات شخصية (PHI) وفق نهج Safe Harbor لـ HIPAA.
2) أعِد جوابًا بصيغة JSON حصراً بالمفاتيح التالية:
{
  "patient_summary": "...",
  "key_findings": ["..."],
  "differential_diagnoses": [{"dx":"...","why":"..."}],
  "severity_red_flags": ["..."],
  "procedural_issues": [{"issue":"...","impact":"...","evidence":"..."}],
  "missed_opportunities": [{"what":"...","why_it_matters":"..."}],
  "revenue_quality_opportunities": [
    {"opportunity":"...","category":"documentation|diagnostics|procedure|follow-up","rationale":"...","risk_note":"..."}
  ],
  "suggested_next_steps": [{"action":"...","justification":"..."}],
  "patient_safety_note":"هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويُراجع من طبيب مرخّص.",
  "references":[{"title":"...","org":"WHO|NICE|CDC|...","link":"https://..."}]
}
3) استند إلى إرشادات عالمية (WHO, NICE) عند الاقتضاء، واذكر مرجعًا مختصرًا مع رابط حيث أمكن.
`;
}

function coerceJson(text){ try{ return JSON.parse(text); }catch{ const m = text?.match?.(/\{[\s\S]*\}/); if(m){ try{ return JSON.parse(m[0]); }catch{} } return null; } }
function mergeReports(openaiText, geminiText){
  const A = openaiText ? coerceJson(openaiText) : null;
  const B = geminiText ? coerceJson(geminiText) : null;
  const base = A || B; if(!base) return openaiText || geminiText || '';
  const other = (base===A)?B:A; if(!other) return JSON.stringify(base,null,2);
  const merged = { ...base };
  const keys = new Set([...Object.keys(base), ...Object.keys(other)]);
  const asArr = (x)=>Array.isArray(x)?x:(x?[x]:[]);
  for(const k of keys){
    const x = base[k], y = other[k];
    if(Array.isArray(x) || Array.isArray(y)){
      const v = [...asArr(x), ...asArr(y)];
      merged[k] = Array.from(new Map(v.map(o=>[JSON.stringify(o),o])).values());
    }else if(typeof x==='object' && typeof y==='object'){ merged[k]={...(x||{}), ...(y||{})};
    }else{ merged[k]= x ?? y; }
  }
  return JSON.stringify(merged,null,2);
}

function extractTextFromOpenAI(json){
  if(json && typeof json.output_text === 'string') return json.output_text;
  const c = json?.choices?.[0];
  if(typeof c?.message?.content === 'string') return c.message.content;
  if(Array.isArray(c?.message?.content)) return c.message.content.map(p=>p.text||p).join('\n');
  return JSON.stringify(json,null,2);
}
function extractTextFromGemini(json){
  try{
    const cand = json?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    return parts.map(p=>p.text||'').join('');
  }catch{ return JSON.stringify(json,null,2); }
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const u = new URL(req.url, `http://${req.headers.host}`);
  const action = u.searchParams.get('action') || 'analyze';

  try {
    // ========= 1) توقيع رفع عميل Vercel Blob =========
    if (req.method === 'POST' && action === 'sign') {
      const body = await readJson(req);
      const { handleUpload } = await import('@vercel/blob/client'); // توجيه توكنات الرفع
      // نصنع Request متوافقًا مع Web Fetch API كما يتوقعها handleUpload
      const headers = new Headers();
      Object.entries(req.headers).forEach(([k,v]) => { if(v!==undefined) headers.set(k, String(v)); });
      const request = new Request(`https://${req.headers.host}${req.url}`, {
        method: 'POST', headers, body: JSON.stringify(body)
      });

      const jsonResponse = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname /*, clientPayload */) => {
          return {
            allowedContentTypes: [
              'application/pdf','image/png','image/jpeg','image/webp',
              'image/heic','image/heif','image/tiff'
            ],
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ ts: Date.now(), pathname })
          };
        },
        onUploadCompleted: async ({ blob /*, tokenPayload */ }) => {
          console.log('Blob uploaded:', blob.url);
        },
      });

      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify(jsonResponse));
    }

    // ========= 2) التحليل عبر النماذج =========
    if (req.method === 'POST' && action === 'analyze') {
      const body = await readJson(req);
      const { files=[], language='ar', model='both', specialty='', context='' } = body || {};
      if (!Array.isArray(files) || files.length === 0) {
        const e = new Error('لا توجد ملفات للتحليل'); e.status = 400; throw e;
      }

      const systemInstructions = buildSystemInstructions({ language, specialty, context });

      // --- OpenAI GPT‑4o ---
      let openaiText = null;
      if (model === 'both' || model === 'openai') {
        const imageParts = files.map(f => ({
          type: "input_image",
          image_url: f.url   // URL عام من Vercel Blob
        }));
        const oaPayload = {
          model: "gpt-4o",
          instructions: systemInstructions,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: "حلّل هذه الصور/الوثائق وفق التعليمات." },
                ...imageParts
              ]
            }
          ]
        };
        const oaRes = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(oaPayload)
        });
        const oaJson = await oaRes.json();
        openaiText = extractTextFromOpenAI(oaJson);
      }

      // --- Google Gemini ---
      let geminiText = null;
      if (model === 'both' || model === 'gemini') {
        const parts = [{ text: systemInstructions }];
        for (const f of files) {
          const resp = await fetch(f.url);
          const buf = Buffer.from(await resp.arrayBuffer());
          const b64 = buf.toString('base64');
          parts.push({
            inline_data: {
              mime_type: f.mimeType || mimeFromName(f.name),
              data: b64
            }
          });
        }
        const gemModel = "gemini-1.5-pro"; // بدّل إلى 1.5‑flash للتكلفة الأقل
        const gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${gemModel}:generateContent?key=${process.env.GEMINI_API_KEY}`,
          { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ contents:[{ role:"user", parts }] }) }
        );
        const gJson = await gRes.json();
        geminiText = extractTextFromGemini(gJson);
      }

      const merged = mergeReports(openaiText, geminiText);
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ merged, openai: openaiText, gemini: geminiText }));
    }

    res.statusCode = 404;
    res.end('Not Found');
  } catch (err) {
    res.statusCode = err.status || 500;
    res.end(err.message || 'Internal Error');
  }
};
