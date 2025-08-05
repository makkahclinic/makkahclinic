// /api/gpt.js

/**
 * @description A multi-purpose serverless API endpoint. It now intelligently handles
 * requests from both the Doctor's Portal and the new Patient's Portal, providing
 * tailored responses for each. It also correctly handles single or multiple image uploads.
 */
export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("🔥 Server-side Error: GEMINI_API_KEY is not set.");
        return res.status(500).json({
            error: "خطأ في إعدادات الخادم",
            detail: "مفتاح واجهة برمجة التطبيقات (API Key) غير موجود. يرجى مراجعة المسؤول.",
        });
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
    
    let htmlPrompt;
    const requestBody = req.body;

    // --- Logic to select the correct prompt based on the request source ---
    if (requestBody.analysisType === 'patient') {
        // --- PATIENT PORTAL PROMPT ---
        const { symptoms, age, gender, smoker, vitals, labs, diagnosis, currentMedications } = requestBody;
        htmlPrompt = `
        أنت "مساعد صحي ذكي" ومهمتك تحليل الأعراض التي يصفها المستخدم وتقديم نصائح أولية واضحة ومفيدة بصيغة HTML. يجب أن يكون تحليلك متعاطفاً، علمياً، وآمناً.
        **بيانات المريض:**
        - العمر: ${age}
        - الجنس: ${gender}
        - مدخن: ${smoker ? 'نعم' : 'لا'}
        - الأعراض الرئيسية: ${symptoms}
        - الأدوية الحالية: ${currentMedications || "لا يوجد"}
        - الحرارة والضغط (إن وجدت): ${vitals || "لم يتم تقديمها"}
        - نتائج تحاليل (إن وجدت): ${labs || "لم يتم تقديمها"}
        - تشخيص سابق (إن وجد): ${diagnosis || "لا يوجد"}
        ---
        **هيكل التقرير المطلوب (يجب إنتاج كود HTML فقط بدون أي إضافات):**
        <div class="response-section recommendation-box ${/* Use 'red', 'yellow', or 'green' */ ''}">...</div>
        <div class="response-section"><h4>...</h4>...</div>
        <div class="response-section"><h4>...</h4>...</div>
        <div class="response-section"><h4>...</h4>...</div>
        `; // (Prompt continues as you wrote it)
    } else {
        // --- DOCTOR PORTAL PROMPT ---
        const { diagnosis, symptoms, age, gender, smoker, beforeProcedure, afterProcedure } = requestBody;
        htmlPrompt = `
        أنت "صيدلي إكلينيكي وخبير مراجعة طبية وتأمين". مهمتك تحليل البيانات الطبية المقدمة (سواء كانت نصاً أو صورة وصفة طبية) وتقديم تقرير HTML مفصل.
        **البيانات لتحليلها:**
        - **الصور المرفقة (إن وجدت):** قم بقراءة وتحليل كل صورة مرفقة. استخرج منها التشخيصات، الأدوية، والجرعات.
        - **البيانات النصية (للسياق الإضافي):**
          - التشخيص المفوتر: ${diagnosis || "لم يحدد"}
          - الأعراض: ${symptoms || "لم تحدد"}
          - العمر: ${age || "لم يحدد"}
          - الجنس: ${gender || "لم يحدد"}
          - مدخن: ${smoker ? 'نعم' : 'لا'}
          - الإجراءات المتخذة: ${beforeProcedure}, ${afterProcedure}
        ---
        **هيكل التقرير المطلوب (يجب إنتاج كود HTML فقط):**
        <h3>تقرير تحليلي مُفصل</h3>
        <div class="section"><h4>...</h4>...</div>
        <div class="section"><h4>...</h4>...</div>
        <div class="section"><h4>...</h4>...</div>
        <div class="section financial-summary"><h4>...</h4>...</div>
        <div class="section"><h4>...</h4>...</div>
        **قاعدة مهمة:** لا تضع أبداً أي رموز تنسيق مثل \`\`\`html في بداية ردك. يجب أن يبدأ ردك مباشرة بوسم \`<h3>\`.
        `; // (Prompt continues as you wrote it)
    }

    // ✅ **FIX 1: Wrap the prompt string in a text object.**
    const parts = [{ text: htmlPrompt }];

    // ✅ **FIX 2: Handle both single image (string) and multiple images (array).**
    if (requestBody.imageData) {
        // Case 1: Multiple images from patient portal (it's an array)
        if (Array.isArray(requestBody.imageData)) {
            requestBody.imageData.forEach(imgData => {
                parts.push({ inline_data: { mime_type: "image/jpeg", data: imgData } });
            });
        } 
        // Case 2: Single image from insurance portal (it's a string)
        else if (typeof requestBody.imageData === 'string') {
            parts.push({ inline_data: { mime_type: "image/jpeg", data: requestBody.imageData } });
        }
    }

    const payload = {
        contents: [{ parts: parts }],
        generationConfig: {
            temperature: 0.5,
        },
    };

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const result = await response.json(); // Read the JSON response once

        if (!response.ok) {
            // If response is not OK, throw the error message from Gemini API
            const errorMessage = result.error?.message || `API request failed: ${response.statusText}`;
            throw new Error(errorMessage);
        }

        const reportHtml = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reportHtml) {
            console.error("🔥 Server-side Warning: Gemini API returned a successful response but no content.", result);
            throw new Error("لم يتمكن النموذج من إنشاء التقرير. قد تكون الاستجابة فارغة.");
        }
        
        return res.status(200).json({ htmlReport: reportHtml });

    } catch (err) {
        console.error("🔥 Server-side Error:", err);
        return res.status(500).json({
            error: "حدث خطأ في الخادم أثناء تحليل الحالة",
            detail: err.message, // err.message will now contain the specific error from Google
        });
    }
}
