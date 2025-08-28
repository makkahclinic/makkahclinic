// api/gpt.js — Vercel Serverless Function (Node.js, CommonJS)

const { createReadStream } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

// تعيين رؤوس CORS
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-vercel-blob-id');
}

// قراءة جسم الطلب كـ JSON
async function readJson(req) {
  const chunks = [];
  
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  
  const rawBody = Buffer.concat(chunks).toString('utf8');
  
  try {
    return JSON.parse(rawBody || '{}');
  } catch (error) {
    const err = new Error('JSON غير صحيح');
    err.status = 400;
    throw err;
  }
}

// تحديد نوع MIME من اسم الملف
function mimeFromName(name, fallback = 'image/png') {
  const normalizedName = (name || '').toLowerCase();
  
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.pdf': 'application/pdf'
  };
  
  for (const [ext, mimeType] of Object.entries(mimeTypes)) {
    if (normalizedName.endsWith(ext)) {
      return mimeType;
    }
  }
  
  return fallback;
}

// بناء التعليمات للنماذج
function buildSystemInstructions({ language = 'ar', specialty = '', context = '', docText = '' }) {
  return `
أنت مساعد سريري لتحسين الجودة والدخل المستند إلى الأدلة، لا تُقدّم تشخيصًا نهائيًا ولا توصيات علاجية دون مراجعة بشرية.
اللغة: ${language === 'ar' ? 'العربية' : 'English'}
التخصص: ${specialty || 'عام'}
السياق: ${context || '—'}
${docText ? `نص المستند: ${docText.substring(0, 2000)}${docText.length > 2000 ? '...' : ''}` : ''}

قواعد:
1) إزالة/تجنّب أي مُعرّفات شخصية (PHI) وفق نهج Safe Harbor لـ HIPAA.
2) أعِد جوابًا بصيغة JSON حصراً بالمفاتيح:
{"patient_summary":"","key_findings":[],"differential_diagnoses":[{"dx":"","why":""}],"severity_red_flags":[],"procedural_issues":[{"issue":"","impact":"","evidence":""}],"missed_opportunities":[{"what":"","why_it_matters":""}],"revenue_quality_opportunities":[{"opportunity":"","category":"documentation|diagnostics|procedure|follow-up","rationale":"","risk_note":""}],"suggested_next_steps":[{"action":"","justification":""}],"patient_safety_note":"هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويُراجع من طبيب مرخّص.","references":[{"title":"","org":"WHO|NICE|CDC|...","link":""}]}
3) استند إلى إرشادات عالمية (WHO, NICE) عند الاقتضاء، واذكر مرجعًا مختصرًا مع رابط حيث أمكن.
`;
}

// محاولة تحويل النص إلى JSON
function coerceJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch {
      // تجاهل الخطأ واستمر
    }
    return null;
  }
}

// دمج التقارير من النماذج المختلفة
function mergeReports(openaiText, geminiText) {
  const openaiJson = openaiText ? coerceJson(openaiText) : null;
  const geminiJson = geminiText ? coerceJson(geminiText) : null;
  
  if (!openaiJson && !geminiJson) {
    return JSON.stringify({ error: 'لم يتم إرجاع بيانات صالحة من أي نموذج' }, null, 2);
  }
  
  if (!openaiJson) return JSON.stringify(geminiJson, null, 2);
  if (!geminiJson) return JSON.stringify(openaiJson, null, 2);
  
  const merged = { ...openaiJson };
  const allKeys = new Set([...Object.keys(openaiJson), ...Object.keys(geminiJson)]);
  
  for (const key of allKeys) {
    const openaiValue = openaiJson[key];
    const geminiValue = geminiJson[key];
    
    if (Array.isArray(openaiValue) || Array.isArray(geminiValue)) {
      // دمج المصفوفات مع إزالة التكرارات
      const openaiArray = Array.isArray(openaiValue) ? openaiValue : [];
      const geminiArray = Array.isArray(geminiValue) ? geminiValue : [];
      
      const combined = [...openaiArray, ...geminiArray];
      
      // إزالة التكرارات بناء على تمثيل JSON للكائنات
      const uniqueItems = Array.from(
        new Map(combined.map(item => [JSON.stringify(item), item])).values()
      );
      
      merged[key] = uniqueItems;
    } else if (typeof openaiValue === 'object' && openaiValue !== null &&
               typeof geminiValue === 'object' && geminiValue !== null) {
      // دمج الكائنات
      merged[key] = { ...openaiValue, ...geminiValue };
    } else {
      // استخدام قيمة Gemini إذا كانت موجودة، وإلا استخدام قيمة OpenAI
      merged[key] = geminiValue !== undefined ? geminiValue : openaiValue;
    }
  }
  
  return JSON.stringify(merged, null, 2);
}

// استخراج النص من استجابة OpenAI
function extractTextFromOpenAI(json) {
  if (json && typeof json.output_text === 'string') {
    return json.output_text;
  }
  
  const choice = json?.choices?.[0];
  if (!choice) return JSON.stringify(json, null, 2);
  
  if (typeof choice.message?.content === 'string') {
    return choice.message.content;
  }
  
  if (Array.isArray(choice.message?.content)) {
    return choice.message.content
      .map(part => part.text || (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  
  return JSON.stringify(json, null, 2);
}

// استخراج النص من استجابة Gemini
function extractTextFromGemini(json) {
  try {
    const candidate = json?.candidates?.[0];
    if (!candidate) return JSON.stringify(json, null, 2);
    
    const parts = candidate.content?.parts || [];
    return parts
      .map(part => part.text || '')
      .filter(Boolean)
      .join('');
  } catch (error) {
    return JSON.stringify(json, null, 2);
  }
}

// معالجة طلبات الرفع
async function handleUpload(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    const error = new Error('BLOB_READ_WRITE_TOKEN مفقود من البيئة');
    error.status = 500;
    throw error;
  }
  
  try {
    const { createBlobClient } = await import('@vercel/blob');
    const blobClient = createBlobClient(process.env.BLOB_READ_WRITE_TOKEN);
    
    const body = await readJson(req);
    const { pathname, clientPayload, multipart } = body;
    
    // إنشاء token الرفع
    const blobToken = await blobClient.createUploadToken({
      pathname,
      clientPayload,
      maxSizeInBytes: 500 * 1024 * 1024, // 500MB
      validUntil: Date.now() + 10 * 60 * 1000, // 10 دقائق
      addRandomSuffix: true
    });
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(blobToken));
  } catch (error) {
    console.error('Error handling upload:', error);
    const err = new Error('فشل في إنشاء token الرفع');
    err.status = 500;
    throw err;
  }
}

// معالجة طلبات التحليل
async function handleAnalysis(req, res) {
  const body = await readJson(req);
  const { files = [], docText = '', language = 'ar', model = 'both', specialty = '', context = '' } = body;
  
  if (!Array.isArray(files) || files.length === 0) {
    const error = new Error('لا توجد ملفات للتحليل');
    error.status = 400;
    throw error;
  }
  
  const systemInstructions = buildSystemInstructions({
    language,
    specialty,
    context,
    docText: docText.substring(0, 4000) // تحديد كمية النص المرسلة
  });
  
  let openaiText = null;
  let geminiText = null;
  
  // معالجة OpenAI إذا كان مطلوبًا
  if (model === 'both' || model === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY مفقود من البيئة');
    }
    
    try {
      const imageParts = files.map(file => ({
        type: "input_image",
        image_url: file.url
      }));
      
      const payload = {
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
      
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }
      
      const responseData = await response.json();
      openaiText = extractTextFromOpenAI(responseData);
    } catch (error) {
      console.error('Error calling OpenAI:', error);
      openaiText = `Error: ${error.message}`;
    }
  }
  
  // معالجة Gemini إذا كان مطلوبًا
  if (model === 'both' || model === 'gemini') {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY مفقود من البيئة');
    }
    
    try {
      const parts = [{ text: systemInstructions }];
      
      // إضافة البيانات الثنائية للصور
      for (const file of files) {
        const response = await fetch(file.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${file.url}`);
        }
        
        const buffer = await response.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString('base64');
        
        parts.push({
          inline_data: {
            mime_type: file.mimeType || mimeFromName(file.name),
            data: base64Data
          }
        });
      }
      
      const modelName = "gemini-1.5-pro";
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 2048
            }
          })
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }
      
      const responseData = await response.json();
      geminiText = extractTextFromGemini(responseData);
    } catch (error) {
      console.error('Error calling Gemini:', error);
      geminiText = `Error: ${error.message}`;
    }
  }
  
  // دمج النتائج
  const merged = mergeReports(openaiText, geminiText);
  
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    merged,
    openai: openaiText,
    gemini: geminiText
  }));
}

// نقطة النهاية الرئيسية
module.exports = async (req, res) => {
  setCORS(res);
  
  // معالجة طلبات OPTIONS لـ CORS
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const action = url.searchParams.get('action') || 'analyze';
    
    // فحص صحة الخادم
    if (req.method === 'GET' && action === 'health') {
      let hasBlobPackage = false;
      try {
        require.resolve('@vercel/blob');
        hasBlobPackage = true;
      } catch (e) {
        hasBlobPackage = false;
      }
      
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({
        ok: true,
        hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasGemini: !!process.env.GEMINI_API_KEY,
        pkgBlob: hasBlobPackage
      }));
    }
    
    // معالجة طلبات الرفع
    if (req.method === 'POST' && action === 'sign') {
      return await handleUpload(req, res);
    }
    
    // معالجة طلبات التحليل
    if (req.method === 'POST' && action === 'analyze') {
      return await handleAnalysis(req, res);
    }
    
    // إذا لم يتطابق أي مسار
    res.statusCode = 404;
    res.end('Not Found');
    
  } catch (error) {
    console.error('API Error:', error);
    res.statusCode = error.status || 500;
    res.end(error.message || 'Internal Server Error');
  }
};
