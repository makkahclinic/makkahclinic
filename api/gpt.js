// /api/gpt.js  – 2025‑08‑05 نسخة مُحدَّثة
export default async function handler(req, res) {
  /* ----------  CORS  ---------- */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  /* ----------  مفاتيح و متغيرات  ---------- */
  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

  const reqBody = req.body;
  let htmlPrompt = "";

  /* ================  1) بوابة المريض  ================ */
  if (reqBody.analysisType === "patient") {
    const {
      symptoms, age, gender, smoker,
      vitals, labs, diagnosis,
      currentMedications, weight, height,
      isPregnant, pregnancyMonth
    } = reqBody;

    htmlPrompt = `
أنت استشارى طب باطنى خبير و«مساعد صحى ذكى». المطلوب:

1️⃣ ✅ **اقرأ كل نص وصورة مرفقة** – استخرج منها الأدوية، الجرعات، القيم المخبرية، أى ملاحظة مكتوبة يدويًّا.  
2️⃣ 🔬 **حلّل الحالة بعمق**: اشرح الفيزيولوجيا المرضية المحتملة، واذكر على الأقل ثلاثة تشخيصات تفريقية مرتبة حسب الإحتمال.  
3️⃣ 💊 **مراجعة دوائية دقيقة**: امنع الأخطاء الشائعة (جرعات خطأ، تداخلات، أدوية ممنوعة للحامل، …).  
4️⃣ ⚖️ **خطورة الحالة**: استخدم صندوق توصية ملوَّن (red / yellow / green) واجعله أول عنصر.  
5️⃣ 📝 **خطوات عملية**: فحوصات مقترحة وفق أدلّة (مثــل: AHA 2024، NICE CKD NG203…).  
6️⃣ ❓ **أسئلة للطبيب** كى يستفيد المريض فى الزيارة القادمة.  

**بيانات المريض كى تستخدمها فى التحليل (لا تكررها حرفيًّا فى التقرير):**
- العمر: ${age} سنة
- الجنس: ${gender}
- الوزن/الطول: ${weight||"؟"} كجم / ${height||"؟"} سم
- مدخن: ${smoker?"نعم":"لا"}
- حامل: ${isPregnant ? `نعم (الشهر ${pregnancyMonth})` : "لا"}
- الأعراض: ${symptoms}
- الأدوية الحالية: ${currentMedications||"لا يوجد"}
- العلامات الحيوية: ${vitals||"لم تُذكر"}
- المختبر: ${labs||"لم يُذكر"}
- تشخيص سابق: ${diagnosis||"لا يوجد"}

💡 **مخرجاتك يجب أن تكون HTML صالح فقط** – ابدأ مباشرةً بعنصر <div> أو <h3> بلا أى ``` أو &lt;html&gt;. استخدم عناوين فرعية واضحة وأيقونات (⚠️ / 💊 / 🔬).`;
  }

  /* ================  2) بوابة الطبيب (التأمين)  ================ */
  else {
    const {
      diagnosis, symptoms, age, gender, smoker,
      beforeProcedure, afterProcedure
    } = reqBody;

    htmlPrompt = `
أنت صيدلى إكلينيكى ومراجع تأمين طبى. المطلوب تحليل مفصَّل مع أقصى عمق ممكن:

• **قراءة جميع الصور (OCR)** واستخراج: التشخيص، رموز ICD‑10, CPT, الأدوية والجرعات، توقيع الطبيب، أختام.  
• **تحليل الأدوية**: آلية العمل، التوافر الحيوى، الوصول لموقع العدوى، التداخلات، بدائل أقل تكلفة إذا وُجدت.  
• **تقييم الإجراءات**: هل تتفق مع إرشادات UpToDate / AAFP 2024؟ أى ثغرة توثيق قد تُعرّضها للرفض.  
• **مؤشر الرفض التأمينى**: حوّله إلى ثلاث مستويات (مرتفع/متوسط/منخفض)، مع قيمة مالية تقديرية.  
• **خطة تصعيد الفاتورة دون مخالفة**: فحوصات إضافية مبرَّرة طبيًّا، إستشارات متخصصة مناسبة.  
• أخرج **تقرير HTML فقط**، يبدأ بـ <h3>، بلا ```، وبعناوين مرقّمة.

**خلفية مختصرة:**
- تشخيص مفوتر: ${diagnosis||"؟"}
- الأعراض: ${symptoms||"؟"}
- عُمر/جنس: ${age||"؟"} / ${gender||"؟"} – مدخن: ${smoker?"نعم":"لا"}
- إجراءات مُسجَّلة: ${beforeProcedure||"—"} / ${afterProcedure||"—"} `;
  }

  /* ----------  تحويل الملفات  ---------- */
  const parts = [{ text: htmlPrompt }];

  const addFile = (bytes, mime = "image/jpeg") =>
    parts.push({ inline_data: { mime_type: mime, data: bytes } });

  (()=>{
    const img=reqBody.imageData;
    if(!img) return;
    if(Array.isArray(img)){
      img.forEach(o=>{
        if(typeof o==="string") addFile(o);
        else if(o?.data) addFile(o.data, o.mime_type||"image/jpeg");
      });
    }else if(typeof img==="string"){
      addFile(img);
    }else if(img?.data){
      addFile(img.data, img.mime_type||"image/jpeg");
    }
  })();

  const payload = { contents:[{parts}], generationConfig:{temperature:0.3} };

  /* ----------  استدعاء Gemini  ---------- */
  try{
    const response = await fetch(apiUrl,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    if(!response.ok){
      const e=await response.json();
      throw new Error(e.error?.message || `Gemini error ${response.status}`);
    }
    const data=await response.json();
    let html=data.candidates?.[0]?.content?.parts?.[0]?.text||"";

    /* إزالة أى ```html ... ``` لو ظهر */
    html = html.replace(/^```html\s*/i,"").replace(/^```\s*/i,"")
               .replace(/\s*```$/,"").trim();

    if(!html) throw new Error("لم يُنشئ النموذج تقريراً.");

    return res.status(200).json({htmlReport:html});
  }catch(err){
    console.error("🔥 ServerError:",err);
    return res.status(500).json({error:"خطأ فى الخادم",detail:err.message});
  }
}
