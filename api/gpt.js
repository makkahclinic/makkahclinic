// api/gpt.js
import Tesseract from "tesseract.js";

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;

  const requestBody = req.body;
  let htmlPrompt = "";

  if (requestBody.analysisType === 'doctor') {
    htmlPrompt = `
      أنت \"النظام الطبي المتكامل\" - محرك ذكاء اصطناعي يجمع خبرات:
      [استشاري باطنة، صيدلي إكلينيكي، محلل تأمين طبي، خبير OCR]

      ## التعليمات:
      - استخراج الأدوية فقط من النصوص بدون افتراض
      - كل دواء: الاسم، الجرعة، التكرار، المدة
      - تصحيح الأخطاء الشائعة مثل "ملف" ← "ملغ"
      - لا تضف أدوية غير موجودة في الصورة

      مثال:
      \"سيمغاسنانين 80 ملف يومياً\" ← \"سيمفاستاتين 80 ملغ يومياً\"

      أرسل التحليل النهائي بشكل منسق HTML بدون هلوسة.
    `;
  } else if (requestBody.analysisType === 'patient') {
    htmlPrompt = `أنت مساعد طبي ذكي، حلل الحالة بناء على الأعراض والمعطيات التالية...`;
  }

  // OCR من الصور
  let extractedText = "";
  if (requestBody.imageData && Array.isArray(requestBody.imageData)) {
    for (const base64Image of requestBody.imageData) {
      const buffer = Buffer.from(base64Image, "base64");
      const { data: { text } } = await Tesseract.recognize(buffer, 'ara');
      extractedText += "\n" + text;
    }
  }

  const parts = [{ text: htmlPrompt }];
  if (extractedText) {
    parts.push({ text: extractedText });
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.2,
      topK: 10,
      maxOutputTokens: 5000
    },
    safetySettings: [
      { category: "HARM_CATEGORY_MEDICAL", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }
    ]
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${errorText}`);
    }

    const result = await response.json();
    let reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text || "<p>❌ لم يتم توليد تقرير</p>";

    // منع الهلوسة: تحقق من وجود أدوية في النص الأصلي
    const extractedMeds = extractMedications(extractedText || "");
    if (reportHtml.includes("سيمفاستاتين") && !extractedMeds.includes("سيمفاستاتين")) {
      return res.status(200).json({
        htmlReport: `
          <div class="error-alert">
            <h3>⚠️ تحذير: بيانات غير كافية</h3>
            <p>لم يتم العثور على دواء \"سيمفاستاتين\" في الوثيقة المقدمة</p>
            <ul>
              <li>السبب المحتمل: جودة صورة منخفضة أو خط غير واضح</li>
              <li>التوصية: إعادة رفع صورة أوضح</li>
              <li>الأدوية المكتشفة: ${extractedMeds.join(', ') || 'لا شيء'}</li>
            </ul>
          </div>
        `
      });
    }

    return res.status(200).json({ htmlReport: reportHtml });

  } catch (err) {
    console.error("🔥 خطأ في الخادم:", err);
    return res.status(500).json({
      error: "فشل في تحليل الوثيقة الطبية",
      detail: err.message,
      solution: "الرجاء التحقق من جودة الصورة وإعادة المحاولة"
    });
  }
}

// دالة لاستخراج الأدوية من النص
function extractMedications(text) {
  const drugPatterns = [
    /(سيمفاستاتين|أتورفاستاتين|روزوفاستاتين)/gi,
    /(أوميبرازول|لانسوبرازول|بانتوبرازول)/gi,
    /(ميتفورمين|أنسولين|غليبنكلاميد)/gi
  ];

  const medications = new Set();
  drugPatterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => medications.add(match));
    }
  });

  return Array.from(medications);
}
