// /api/gpt.js — النسخة الفولاذيّة النهائية (Edge-safe, 3-Stage Cognitive Architecture)

const MAX_INLINE_REQUEST_MB = 19.0;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 90_000; // 90 ثانية للسماح بالتحليل المعقد

// ================ المرحلة 2: عقل الذكاء الاصطناعي (System Instruction) ================
// تم تعديله ليتفاعل مع مخرجات مرحلة الفرز الأولي
const systemInstruction = `
أنت "كبير المدققين السريريين"، خبير استراتيجي في تقييم المخاطر الطبية والتأمينية. مهمتك تحليل البيانات المعقدة وإنتاج تقرير HTML دقيق وموجز.

[أ] منهجية التحليل الإلزامية
1) سأقوم بتزويدك بـ "بيانات المريض" و "تحذيرات أولية" تم اكتشافها بواسطة نظام قواعد آلي. مهمتك الأولى هي **تأكيد هذه التحذيرات وشرح خطورتها السريرية** ضمن "التحليل السريري العميق".
2) مهمتك الثانية هي **اكتشاف أي أخطاء أو تفاعلات دقيقة إضافية** لم يكتشفها النظام الآلي، خاصة تلك التي تتطلب فهمًا عميقًا للسياق (مثل ملاءمة العلاج لحالة الكلى/الكبد، عمر المريض، إلخ).
3) افحص بدقة:
   • الازدواجية العلاجية.
   • أخطاء الجرعات (خاصة أدوية XR/MR).
   • وجود تشخيص داعم لكل دواء.
   • اقتراح بدائل آمنة عند الضرورة (مثال: Paracetamol بدلاً من NSAIDs في القصور الكلوي).

[ب] قواعد إخراج التقرير الإلزامية
- **جدول الأدوية:** لكل دواء، احسب "درجة الخطورة" (0–100%) وطبّق class لوني (risk-high/medium/low) على خلايا <td> الخاصة بـ "درجة الخطورة" و "قرار التأمين".
- **قرار التأمين:** يجب أن يكون بالصيغة التفصيلية التالية، مع تحديد "التخصص المُراجع":
  • ❌ قابل للرفض — السبب: [توضيح سريري] — وللقبول يلزم: [إجراء محدد] — **التخصص المُراجع: [كلى/قلب/غدد...]**
- **فرص تحسين الخدمة:** اقترح فحوصات إضافية بناءً على المحفزات التالية، مع ذكر المصدر والرابط الإلزامي:
  • سكري نوع 2 ⇒ **HbA1c** كل 3 أشهر — **ADA**: https://diabetesjournals.org/care
  • Metformin/CKD ⇒ **eGFR + UACR** — **KDIGO**: https://kdigo.org/
  • Allopurinol ⇒ **Uric Acid + eGFR** — **ACR**: https://www.rheumatology.org/
  • ACEi/ARB/CKD ⇒ **Potassium + Creatinine** — **ACC/AHA**: https://www.ahajournals.org/
- **خطة العمل:** يجب أن تكون قائمة بإجراءات **فورية، محددة، وقابلة للتنفيذ** (مثال: "إعطاء غلوكونات الكالسيوم IV فوراً").
- **الإخراج النهائي:** كتلة HTML واحدة فقط، بدون أي CSS أو <style>.
`;

// ================ بنّاء الطلب (Prompt Builder) ================
// أصبح الآن يمرر البيانات الخام والتحذيرات الأولية
function buildUserPrompt(caseData = {}, preProcessedAlerts = []) {
  let promptText = `
**بيانات المريض (مدخل يدويًا):**
- العمر: ${caseData.age ?? 'غير محدد'}
- الجنس: ${caseData.gender ?? 'غير محدد'}
- التشخيصات: ${caseData.diagnosis ?? 'غير محدد'}
- الأدوية/الإجراءات المكتوبة: ${caseData.medications ?? 'غير محدد'}
- نتائج مخبرية: eGFR=${caseData.eGFR ?? 'N/A'}, HbA1c=${caseData.hba1c ?? 'N/A'}, K+=${caseData.k ?? 'N/A'}, INR=${caseData.inr ?? 'N/A'}
- ملاحظات إضافية: ${caseData.notes ?? 'غير محدد'}
`;
  if (preProcessedAlerts.length > 0) {
    promptText += `\n**تحذيرات أولية تم اكتشافها بواسطة نظام القواعد (مطلوب تأكيدها وشرحها):**\n`
    promptText += preProcessedAlerts.map(a => `- ⚠️ ${a.type}: ${a.message} -> الإجراء المقترح: ${a.action}`).join('\n');
  }

  promptText += `\n**الملفات المرفوعة:**\n- ${Array.isArray(caseData.imageData) && caseData.imageData.length > 0 ? 'يوجد صور مرفقة للتحليل.' : 'لا توجد صور مرفقة.'}`;
  return promptText;
}

// ================ الدوال المساعدة (Helpers) ================
const _encoder = new TextEncoder();
function byteLengthUtf8(str) { return _encoder.encode(str || '').length; }

function estimateInlineRequestMB(parts) {
  let bytes = 0;
  for (const p of parts) {
    if (p.text) bytes += byteLengthUtf8(p.text);
    if (p.inline_data?.data) bytes += Math.floor((p.inline_data.data.length * 3) / 4);
  }
  return bytes / (1024 * 1024);
}

// المرحلة 3: التدقيق النهائي (Post-processing)
function applySafetyPostProcessing(html) {
  try {
    html = String(html || '');
    html = html.replace(/(<td\b[^>]*>\s*)(\d{1,3})(\s*)(<\/td>)/gi, (_m, o, n, _s, c) => `${o}${n}%${c}`);
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
  // ... (This function remains the same, it's already excellent)
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

// ================ API Handler (The Conductor of the 3-Stage Pipeline) ================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const caseData = req.body || {};
    const meds = caseData.medications || '';
    const eGFR = caseData.eGFR;
    const criticalAlerts = [];

    // --- المرحلة 1: الفرز الأولي (Pre-processing Rules Engine) ---
    if (/ciprofloxacin|سيبروفلوكساسين/i.test(meds) && /warfarin|وارفارين/i.test(meds)) {
      criticalAlerts.push({
        type: 'تفاعل دوائي خطير',
        message: 'السيبروفلوكساسين مع الوارفارين يزيد بشكل حاد من خطر النزيف.',
        action: 'مراقبة INR يوميًا وتعديل جرعة الوارفارين.'
      });
    }
    if (/ibuprofen|إيبوبروفين/i.test(meds) && eGFR && eGFR < 60) {
      criticalAlerts.push({
        type: 'دواء غير آمن',
        message: 'مضادات الالتهاب غير الستيرويدية (NSAIDs) مثل الإيبوبروفين قد تزيد من تدهور وظائف الكلى.',
        action: 'إيقاف واستبدال بـ Paracetamol.'
      });
    }
    // يمكنك إضافة المزيد من القواعد الصارمة هنا

    // --- بناء الطلب وإرساله للذكاء الاصطناعي ---
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
    
    // تمرير البيانات الخام + التحذيرات الأولية
    const userPrompt = buildUserPrompt(caseData, criticalAlerts);
    const parts = [{ text: systemInstruction }, { text: userPrompt }];

    if (Array.isArray(caseData.imageData)) {
      for (const img of caseData.imageData) {
        if (typeof img === 'string' && img.length > 0) {
          parts.push({ inline_data: { mimeType: 'image/jpeg', data: img } });
        }
      }
    }
    
    // فحص الحجم لتفادي 413
    const estMB = estimateInlineRequestMB(parts);
    if (estMB > MAX_INLINE_REQUEST_MB) {
      return res.status(413).json({ error: 'الطلب كبير جدًا', detail: `الحجم المقدر ~${estMB.toFixed(2)}MB. خفّض جودة الصور.`});
    }

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, topP: 0.95, topK: 40 }
    };

    const response = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    if (!response.ok) {
      console.error('Gemini API Error:', text);
      return res.status(response.status).json({ error: 'فشل الاتصال بـ Gemini API', detail: text });
    }

    let result;
    try { result = JSON.parse(text); }
    catch {
      console.error('Non-JSON response from Gemini:', text);
      return res.status(502).json({ error: 'استجابة غير متوقعة من Gemini' });
    }

    const rawHtml = result?.candidates?.[0]?.content?.parts?.[0]?.text || '<p>⚠️ لم يتمكن النظام من إنشاء التقرير.</p>';

    // --- المرحلة 3: تطبيق التدقيق النهائي ---
    const finalizedHtml = applySafetyPostProcessing(rawHtml);
    return res.status(200).json({ htmlReport: finalizedHtml });

  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({ error: 'حدث خطأ في الخادم', detail: err.message });
  }
}
