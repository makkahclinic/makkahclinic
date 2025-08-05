// /api/gpt.js  —  نسخة 2025‑08‑05‑b
export default async function handler(req, res) {
  /* CORS */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  /* نُنفّذ كل شئ داخل try واحد لضمان JSON دائمًا */
  try {
    /* مفاتيح */
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) throw new Error("مفتاح GEMINI_API_KEY غير مُعرَّف.");
    const ENDPOINT =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      "gemini-1.5-pro-latest:generateContent?key=" + API_KEY;

    const b = req.body;                               // requestBody
    let prompt = "";

    /* ───────── بوابة المريض ───────── */
    if (b.analysisType === "patient") {
      const { symptoms, age, gender, smoker,
              vitals, labs, diagnosis, currentMedications,
              weight, height, isPregnant, pregnancyMonth } = b;

      prompt = `
أنت استشارى طب باطنى خبير. اتّبع النقاط:

1️⃣ اقرأ جميع الصور والنص – استخرج الرموز والأدوية والقيم المخبرية (OCR).  
2️⃣ 🔬 حلّل الفيزيولوجيا المرضية واذكر ≥3 تشخيصات تفريقية مرتّبة.  
3️⃣ 💊 راجع التداخلات والجرعات والأدوية الممنوعة للحامل.  
4️⃣ ⚖️ صنّف خطورة الحالة بصندوق توصية ملوّن (red/yellow/green) فى أعلى التقرير.  
5️⃣ 📝 اقترح فحوصات وخطوات عملية مع ذكر الدليل الإرشادى الحديث (مثــل NICE NG203 2024).  
6️⃣ ❓ اكتب أسئلة على المريض طرحُها على طبيبه.

(لا تُكرر هذه البيانات حرفيًا فى التقرير، استخدمها للاستدلال فقط)
• العمر: ${age} سنة – الجنس: ${gender} – مدخن: ${smoker ? "نعم" : "لا"}  
• وزن/طول: ${weight||"؟"} كجم / ${height||"؟"} سم – حامل: ${isPregnant?`نعم، شهر ${pregnancyMonth}`:"لا"}  
• الأعراض: ${symptoms}  
• أدوية حالية: ${currentMedications||"لا"}  
• العلامات الحيوية: ${vitals||"—"}  
• المختبر: ${labs||"—"}  
• تشخيص سابق: ${diagnosis||"—"}

💡 **أخرج HTML صالح فقط** — ابدأ بعنصر <div> أو <h3> دون ```.
`;
    }

    /* ───────── بوابة الطبيب (التأمين) ───────── */
    else {
      const { diagnosis, symptoms, age, gender,
              smoker, beforeProcedure, afterProcedure } = b;

      prompt = `
أنت صيدلى إكلينيكى وخبير مطالبات تأمين.  المطلوب تحليل متعمّق:

• OCR للصور لاستخراج ICD‑10 / CPT / جرعات / توقيع.  
• تقييم دوائى: آلية، توافر حيوى، بدائل أقل تكلفة، أخطاء شائعة.  
• مخاطر رفض التأمين بثلاث مستويات وقيمة مالية تقديرية.  
• خطة تصعيد الفاتورة مستندة إلى أدلة UpToDate/AAFP 2024.  
• التقرير HTML فقط يبدأ بـ <h3>.

خلفية مختصرة: التشخيص=${diagnosis||"؟"}؛ الأعراض=${symptoms||"؟"}؛ العمر=${age||"؟"}/الجنس=${gender||"؟"}؛ مدخن=${smoker?"نعم":"لا"}؛ إجراءات=${beforeProcedure||"—"} / ${afterProcedure||"—"}
`;
    }

    /* إعداد الـ parts */
    const parts = [{ text: prompt }];

    /* util لإضافة ملف */
    const addFile = (base64, mime = "image/jpeg") =>
      parts.push({ inlineData: { mimeType: mime, data: base64 } });

    /* معالجة imageData */
    (()=>{
      const img = b.imageData;
      if (!img) return;
      if (Array.isArray(img)) {
        img.forEach(it=>{
          if (typeof it === "string") addFile(it);                    // سلسلة
          else if (it?.data)          addFile(it.data, it.mime_type||"image/jpeg");
        });
      } else if (typeof img === "string")         addFile(img);       // سلسلة واحدة
      else if (img?.data)                         addFile(img.data, img.mime_type||"image/jpeg");
    })();

    const payload = { contents:[{parts}], generationConfig:{temperature:0.3} };

    /* استدعاء Gemini */
    const r = await fetch(ENDPOINT,{
      method:"POST",headers:{ "Content-Type":"application/json" },
      body:JSON.stringify(payload)
    });

    if (!r.ok) {
      const err = await r.json().catch(()=>({}));
      throw new Error(err.error?.message || `Gemini HTTP ${r.status}`);
    }

    const out = await r.json();
    let html = out.candidates?.[0]?.content?.parts?.[0]?.text || "";
    html = html.replace(/^```html\s*/i,"")
               .replace(/^```\s*/i,"")
               .replace(/\s*```$/,"")
               .trim();
    if (!html) throw new Error("لم يرجع النموذج أى محتوى.");

    return res.status(200).json({ htmlReport: html });
  }

  /* أى خطأ يُعاد JSON صالح */
  catch (err) {
    console.error("🔥 gpt.js error:", err);
    return res.status(500).json({ detail: err.message || String(err) });
  }
}
