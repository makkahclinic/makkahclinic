// /api/gpt.js
/**
 * Serverless endpoint يُعالج طلبات بوابة الطبيب والمريض
 * ويدعم الآن عدداً غير محدود من الصور وملفّات PDF (≤ 20 MB إجمالاً).
 */
export default async function handler(req, res) {
  /* ----------  CORS  ---------- */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  /* ----------  إعداد المتغيرات  ---------- */
  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

  const requestBody = req.body;
  let htmlPrompt = "";

  /* ----------  بوابة المريض  ---------- */
  if (requestBody.analysisType === "patient") {
    const {
      symptoms, age, gender, smoker, vitals, labs, diagnosis,
      currentMedications, weight, height, isPregnant, pregnancyMonth
    } = requestBody;

    htmlPrompt = `
أنت "مستشار طبي ذكي وخبير". مهمتك تحليل بيانات المريض بعمق، وتقديم تقرير HTML مفصّل وآمن.

**بيانات المريض:**
- العمر: ${age}
- الجنس: ${gender}
- الوزن: ${weight || "لم يحدد"} كجم
- الطول: ${height || "لم يحدد"} سم
- مدخن: ${smoker ? "نعم" : "لا"}
- حامل: ${isPregnant ? `نعم، بالشهر ${pregnancyMonth}` : "لا"}
- الأعراض: ${symptoms}
- الأدوية الحالية: ${currentMedications || "لا يوجد"}
- الحرارة/الضغط: ${vitals || "لم تقدّم"}
- نتائج تحاليل: ${labs || "لم تقدّم"}
- تشخيص سابق: ${diagnosis || "لا يوجد"}

---
**هيكل التقرير (HTML فقط):**

<div class="response-section recommendation-box green">
  <!-- توصية نهائية -->
</div>

<div class="response-section">
  <h4>تحليل الحالة والأسباب المحتملة</h4>
  <ul>
    <li><strong>السبب الجذري المحتمل:</strong> [...]</li>
    <li><strong>التشخيصات التفريقية:</strong> [...]</li>
  </ul>
</div>

<div class="response-section">
  <h4>أخطاء طبية محتملة</h4>
  <ul><li>[...]</li><li>[...]</li></ul>
</div>

<div class="response-section">
  <h4>الخطوات التالية المقترحة</h4>
  <ul><li>خطوة عاجلة [...]</li><li>خطوة ثانية [...]</li><li>خطوة ثالثة [...]</li></ul>
</div>

<div class="response-section">
  <h4>أسئلة لمناقشتها مع طبيبك</h4>
  <ul><li>...</li><li>...</li></ul>
</div>

**قاعدة:** ابدأ الرد مباشرةً بعنصر HTML دون \`\`\`.
`;
  }

  /* ----------  بوابة الطبيب (التأمين)  ---------- */
  else {
    const {
      diagnosis, symptoms, age, gender, smoker, beforeProcedure, afterProcedure
    } = requestBody;

    htmlPrompt = `
أنت "صيدلي إكلينيكي وخبير مراجعة طبية وتأمين". حلّل البيانات (نصاً وصوراً) وأخرج تقرير HTML مفصّل.

**البيانات:**
- صور مرفقة: حلّل التشخيصات والأدوية.
- التشخيص المفوتر: ${diagnosis || "لم يحدد"}
- الأعراض: ${symptoms || "لم تحدد"}
- العمر: ${age || "لم يحدد"} / الجنس: ${gender || "لم يحدد"} / مدخن: ${smoker ? "نعم" : "لا"}
- الإجراءات: ${beforeProcedure}, ${afterProcedure}

---
<h3>تقرير تحليلي مُفصّل</h3>

<div class="section"><h4>1. تحليل الإجراءات</h4><p>...</p></div>
<div class="section"><h4>2. احتمالية الرفض</h4><p>...</p></div>
<div class="section"><h4>3. خطوات لرفع الفاتورة</h4><p>...</p></div>
<div class="section financial-summary">
 <h4>4. المؤشر المالي</h4><table><tbody>
   <tr><td>الدخل الحالي</td><td>[...]</td><td>[...]</td></tr>
   <tr><td>بعد الرفض</td><td>[...]</td><td>[...]</td></tr>
   <tr><td>إجمالي محتمل</td><td>[...]</td><td>[...]</td></tr>
 </tbody></table>
</div>
<div class="section"><h4>5. توصيات عامة</h4><p>...</p></div>

**قاعدة:** ابدأ الرد مباشرةً بوسم <h3>.
`;
  }

  /* ----------  تجهيز الأجزاء لإرسالها إلى Gemini  ---------- */
  const parts = [{ text: htmlPrompt }];

  /* أضف ملف (صورة/ PDF) إلى parts */
  const addFile = (bytes, mime) =>
    parts.push({ inline_data: { mime_type: mime, data: bytes } });

  /**
   * يدعم الأنماط التالية فى requestBody.imageData:
   *  1) سلسلة Base64 واحدة
   *  2) مصفوفة سلاسل Base64
   *  3) مصفوفة كائنات {data, mime_type}
   *  4) كائن واحد {data, mime_type}
   */
  if (requestBody.imageData) {
    const img = requestBody.imageData;
    if (Array.isArray(img)) {
      img.forEach((item) => {
        if (typeof item === "string")            addFile(item, "image/jpeg");
        else if (item && item.data)              addFile(item.data, item.mime_type || "image/jpeg");
      });
    } else if (typeof img === "string")          addFile(img, "image/jpeg");
    else if (img && img.data)                    addFile(img.data, img.mime_type || "image/jpeg");
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.5 }
  };

  /* ----------  استدعاء Gemini  ---------- */
  try {
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errBody = await resp.json();
      throw new Error(errBody.error?.message || `API error ${resp.status}`);
    }

    const data = await resp.json();
    const html = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!html) throw new Error("لم يتمكن النموذج من إنشاء التقرير.");

    return res.status(200).json({ htmlReport: html });
  } catch (err) {
    console.error("🔥 Server error:", err);
    return res.status(500).json({
      error: "حدث خطأ في الخادم أثناء تحليل الحالة",
      detail: err.message
    });
  }
}
