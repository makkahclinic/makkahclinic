// api/gpt.js
// Vercel Node.js Serverless Function (CommonJS)

const { URL } = require('url');

// CORS بسيط إن لزم
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch (e) {
    const err = new Error('Invalid JSON body');
    err.status = 400; throw err;
  }
}

function buildSystemInstructions({ language='ar', specialty='', context='' }) {
  // تعليمات صارمة لضبط المخرجات (تقرير مُهيكل وقابل للتدقيق)
  return `
أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة، لا تُقدّم تشخيصًا نهائيًا ولا توصيات علاجية دون مراجعة سريرية.
المطلوب: تحليل حالة طبية بناءً على صور/وثائق مُحمّلة (عربي/إنجليزي). 
أخرج النتائج باللغة: ${language === 'ar' ? 'العربية' : 'English'}.
التخصص (إن وُجد): ${specialty || 'عام/غير محدد'}.
سياق إضافي: ${context || '—'}.

قواعد صارمة:
1) التزم بنزع أي معرّفات شخصية محتملة (PHI) وعدم استنتاج هوية المرضى.
2) اعرض تقريرًا منظّمًا بصيغة JSON فقط، بالمفاتيح التالية:
{
  "patient_summary": "...",
  "key_findings": ["...", "..."],
  "differential_diagnoses": [{"dx": "...", "why": "..."}],
  "severity_red_flags": ["..."],
  "procedural_issues": [{"issue": "...", "impact": "...", "evidence": "..."}],
  "missed_opportunities": [{"what": "...", "why_it_matters": "..."}],
  "revenue_quality_opportunities": [
    {"opportunity": "...", "category": "documentation|diagnostics|procedure|follow-up", "rationale": "...", "risk_note": "..."}
  ],
  "suggested_next_steps": [{"action": "...", "justification": "..."}],
  "patient_safety_note": "هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويجب مراجعته من طبيب مرخّص.",
  "references": [
    {"title": "اسم الدليل/الجهة", "org": "WHO|NICE|CDC|...", "link": "https://..."}
  ]
}
3) استند إلى إرشادات عالمية (مثل WHO/NICE) عند الاقتضاء، وإن لم تكن واثقًا من مرجع محدد، قل "Reference to be verified".
4) لا تقترح أي إجراء غير مبرر طبيًا أو مخالف للأخلاقيات؛ ركّز على توثيق أفضل، فحوصات لازمة، متابعة مناسبة، ومسارات إحالة سليمة.
`;
}

function extractTextFromOpenAI(json) {
  // Responses API
  if (json && typeof json.output_text === 'string') return json.output_text;
  // fallback قديم
  try {
    const c = json.choices?.[0];
    if (typeof c?.message?.content === 'string') return c.message.content;
    if (Array.isArray(c?.message?.content)) {
      return c.message.content.map(p => p.text || p).join('\n');
    }
  } catch {}
  return JSON.stringify(json, null, 2);
}

function extractTextFromGemini(json) {
  try {
    const cand = json.candidates?.[0];
    if (!cand) return JSON.stringify(json, null, 2);
    const parts = cand.content?.parts || [];
    return parts.map(p => p.text || '').join('');
  } catch {
    return JSON.stringify(json, null, 2);
  }
}

// محاولة تحويل أي نص JSON جزئي إلى كائن
function coerceJson(text) {
  try { return JSON.parse(text); } catch {}
  // التقط كتلة JSON بين أقواس معقوفة
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function mergeReports(openaiText, geminiText) {
  const o = openaiText ? coerceJson(openaiText) : null;
  const g = geminiText ? coerceJson(geminiText) : null;
  // دمج بسيط إن نجحت البنى
  const base = o || g;
  if (!base) return openaiText || geminiText || '';
  const other = (base === o) ? g : o;
  if (!other) return JSON.stringify(base, null, 2);

  function arr(a){ return Array.isArray(a) ? a : (a? [a] : []); }
  const merged = { ...base };
  const keys = new Set([
    ...Object.keys(base), ...(other? Object.keys(other) : [])
  ]);
  for (const k of keys) {
    const A = base[k], B = other[k];
    if (Array.isArray(A) || Array.isArray(B)) {
      const aa = arr(A), bb = arr(B);
      const joined = [...aa, ...bb];
      // إزالة التكرار نصيًا
      merged[k] = Array.from(new Map(joined.map(x => [JSON.stringify(x), x])).values());
    } else if (typeof A === 'object' && typeof B === 'object') {
      merged[k] = { ...(A||{}), ...(B||{}) };
    } else {
      merged[k] = A ?? B;
    }
  }
  return JSON.stringify(merged, null, 2);
}

// تعيين mime افتراضي
function mimeFromName(name, fallback='image/png'){
  const n = (name||'').toLowerCase();
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  return fallback;
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const u = new URL(req.url, `http://${req.headers.host}`);
  const action = u.searchParams.get('action') || 'analyze';

  try {
    if (req.method === 'POST' && action === 'sign') {
      // إنشاء رابط رفع لملف واحد
      const body = await readJson(req);
      const { filename='file.bin', contentType='application/octet-stream' } = body || {};
      const { generateUploadURL } = await import('@vercel/blob');
      const { url } = await generateUploadURL({
        access: 'public',
        contentType,
        // نحفظ داخل مجلد uploads
        pathname: `uploads/${Date.now()}-${filename}`
      });
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ uploadUrl: url }));
    }

    if (req.method === 'POST' && action === 'analyze') {
      const body = await readJson(req);
      const { files=[], language='ar', model='both', specialty='', context='' } = body || {};
      if (!Array.isArray(files) || files.length === 0) {
        const e = new Error('لا توجد ملفات للتحليل'); e.status = 400; throw e;
      }

      const systemInstructions = buildSystemInstructions({ language, specialty, context });

      // —— OpenAI (GPT‑4o) —— //
      let openaiText = null;
      if (model === 'both' || model === 'openai') {
        const imageParts = files.map(f => ({
          type: "input_image",
          image_url: f.url // يدعم URL مباشر للصورة
        }));

        const oaPayload = {
          model: "gpt-4o", // يمكنك تغييره إلى gpt-4o-mini لخفض التكلفة
          instructions: systemInstructions,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: "حلّل الصور/الوثائق التالية حسب التعليمات." },
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

      // —— Gemini —— //
      let geminiText = null;
      if (model === 'both' || model === 'gemini') {
        // نحضر الصور كـ Base64 inline (متوافق مع generateContent)
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
        const gemModel = "gemini-1.5-pro"; // يمكن استبداله بـ 1.5-flash لسرعة أقل تكلفة
        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${gemModel}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ contents: [{ role: "user", parts }] })
        });
        const gJson = await gRes.json();
        geminiText = extractTextFromGemini(gJson);
      }

      // دمج تقارير النموذجين (عند توفّرهما)
      const merged = mergeReports(openaiText, geminiText);

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({
        merged, openai: openaiText, gemini: geminiText
      }));
    }

    res.statusCode = 404;
    res.end('Not Found');
  } catch (err) {
    res.statusCode = err.status || 500;
    res.end(err.message || 'Internal Error');
  }
};
