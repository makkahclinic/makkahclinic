// api/gpt.js — Vercel Serverless Function (Node.js, CommonJS)

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { const e = new Error('Invalid JSON'); e.status = 400; throw e; }
}
function mimeFromName(name, fallback='image/png'){
  const n = (name||'').toLowerCase();
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.heic')) return 'image/heic';
  if (n.endsWith('.heif')) return 'image/heif';
  if (n.endsWith('.tif') || n.endsWith('.tiff')) return 'image/tiff';
  return fallback;
}

// === Prompt template (آمن + مرجعي) ===
function buildSystemInstructions({ language='ar', specialty='', context='' }) {
  return `
أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة، لا تُقدّم تشخيصًا نهائيًا ولا توصيات علاجية دون مراجعة بشرية.
اللغة: ${language==='ar'?'العربية':'English'}
التخصص: ${specialty || 'عام'}
السياق: ${context || '—'}

قواعد:
1) إزالة/تجنّب أي مُعرّفات شخصية (PHI) وفق نهج Safe Harbor لـ HIPAA.
2) أعِد جوابًا بصيغة JSON حصراً بالمفاتيح:
{"patient_summary":"","key_findings":[],"differential_diagnoses":[{"dx":"","why":""}],"severity_red_flags":[],"procedural_issues":[{"issue":"","impact":"","evidence":""}],"missed_opportunities":[{"what":"","why_it_matters":""}],"revenue_quality_opportunities":[{"opportunity":"","category":"documentation|diagnostics|procedure|follow-up","rationale":"","risk_note":""}],"suggested_next_steps":[{"action":"","justification":""}],"patient_safety_note":"هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويُراجع من طبيب مرخّص.","references":[{"title":"","org":"WHO|NICE|CDC|...","link":""}]}
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
    // (0) Health: لعرض حالة البيئة والحزمة من الواجهة
    if (req.method === 'GET' && action === 'health') {
      let pkgBlob = false;
      try { require.resolve('@vercel/blob'); pkgBlob = true; } catch {}
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({
        ok:true,
        hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasGemini: !!process.env.GEMINI_API_KEY,
        pkgBlob
      }));
    }

    // (1) Client Upload token — طبقًا لـ handleUpload في دليل Vercel Blob
    if (req.method === 'POST' && action === 'sign') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        const e = new Error('Server missing BLOB_READ_WRITE_TOKEN. Connect a Blob store and redeploy.');
        e.status = 500; throw e;
      }
      const body = await readJson(req);
      const { handleUpload } = await import('@vercel/blob/client');

      // ملاحظة: handleUpload يقبل IncomingMessage مباشرةً (req) + body (JSON)
      const jsonResponse = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname /*, clientPayload, multipart */) => {
          return {
            addRandomSuffix: true,
            maximumSizeInBytes: 500 * 1024 * 1024,   // 500MB لكل عنصر
            validUntil: Date.now() + 10 * 60 * 1000, // 10 دقائق
            // عدم تحديد allowedContentTypes لتجنب أي تعارض غير مقصود
            tokenPayload: JSON.stringify({ pathname, ts: Date.now() })
          };
        },
        onUploadCompleted: async ({ blob /*, tokenPayload */ }) => {
          console.log('Blob upload completed:', blob.url);
        },
      });

      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify(jsonResponse));
    }

    // (2) التحليل بالنماذج
    if (req.method === 'POST' && action === 'analyze') {
      const body = await readJson(req);
      const { files=[], language='ar', model='both', specialty='', context='' } = body || {};
      if (!Array.isArray(files) || files.length === 0) {
        const e = new Error('لا توجد ملفات للتحليل'); e.status = 400; throw e;
      }

      const systemInstructions = buildSystemInstructions({ language, specialty, context });

      // --- OpenAI GPT‑4o — Responses API (images via image_url) ---
      let openaiText = null;
      if (model === 'both' || model === 'openai') {
        const imageParts = files.map(f => ({ type: "input_image", image_url: f.url }));
        const oaPayload = {
          model: "gpt-4o",
          instructions: systemInstructions,
          input: [
            { role: "user", content: [ { type:"input_text", text:"حلّل هذه الصور/الوثائق وفق التعليمات." }, ...imageParts ] }
          ]
        };
        const oaRes = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(oaPayload)
        });
        const oaJson = await oaRes.json();
        openaiText = extractTextFromOpenAI(oaJson);
      }

      // --- Google Gemini 1.5 — inline_data (Base64) ---
      let geminiText = null;
      if (model === 'both' || model === 'gemini') {
        const parts = [{ text: systemInstructions }];
        for (const f of files) {
          const resp = await fetch(f.url);
          const buf = Buffer.from(await resp.arrayBuffer());
          parts.push({ inline_data: { mime_type: f.mimeType || mimeFromName(f.name), data: buf.toString('base64') } });
        }
        const gemModel = "gemini-1.5-pro";
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
